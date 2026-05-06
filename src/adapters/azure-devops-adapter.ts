/**
 * Azure DevOps Repository Adapter
 *
 * Fetches prompt bundles from Azure DevOps (ADO) Git repositories.
 * Supports both Azure DevOps Services (cloud) and Azure DevOps Server (on-premises).
 *
 * ## Bundle discovery strategy — "full-tree collection scan"
 *
 * Rather than listing directories one-by-one and probing each for a manifest
 * (an N+1 HTTP pattern), the adapter retrieves the **entire repository tree
 * in a single API call** using `recursionLevel=Full`, then filters the
 * returned item list in memory for blob entries (files) whose filename ends in
 * `.collection.yml`.
 *
 * Only collection files that sit **exactly one directory level** beneath
 * `collectionsPath` are treated as bundle roots.  This prevents deeply-nested
 * files from accidentally being picked up as separate bundles.
 *
 * After finding collection blob paths, the adapter fetches the **content** of
 * each `.collection.yml` file (one request per bundle) and parses it to
 * construct `Bundle` objects.
 *
 * **API call count**: 1 (full tree) + N (one per discovered bundle)
 *
 * ## Downloading bundles
 * Bundles are assembled on the fly: the adapter re-fetches the `.collection.yml`,
 * individually downloads each item listed there, and packages them — together
 * with a synthesised `deployment-manifest.yml` — into an in-memory ZIP archive.
 * No `deployment-manifest.yml` needs to exist in the repository.
 *
 * ## Configuration example
 *
 * ### Azure DevOps Services (cloud)
 * ```json
 * {
 *   "id": "my-ado-source",
 *   "name": "My ADO Prompts",
 *   "type": "azure-devops",
 *   "url": "https://dev.azure.com/myorg/myproject/_git/myrepo",
 *   "enabled": true,
 *   "priority": 1,
 *   "private": true,
 *   "token": "<personal-access-token>",
 *   "config": {
 *     "branch": "main",
 *     "collectionsPath": "/"
 *   }
 * }
 * ```
 *
 * ### Azure DevOps Server (on-premises)
 * ```json
 * {
 *   "id": "my-ado-server-source",
 *   "name": "My ADO Server Prompts",
 *   "type": "azure-devops",
 *   "url": "https://ado.mycompany.com/DefaultCollection/myproject/_git/myrepo",
 *   "enabled": true,
 *   "priority": 1,
 *   "private": true,
 *   "token": "<personal-access-token>",
 *   "config": {
 *     "branch": "main",
 *     "collectionsPath": "/prompt-bundles"
 *   }
 * }
 * ```
 *
 * ## Authentication
 * Configure authentication in priority order — the first option that succeeds is used:
 *
 * 1. **Personal Access Token (PAT)**: Set `token` on the source. Generate a PAT with
 *    "Code (read)" scope at https://dev.azure.com/{org}/_usersettings/tokens.
 *    Produces an `Authorization: Basic base64(":"+PAT)` header.
 *
 * 2. **VS Code Microsoft auth**: Sign in to VS Code with your Microsoft/Entra account.
 *    No CLI tooling needed. The adapter calls `vscode.authentication.getSession('microsoft', ...)`
 *    silently and produces an `Authorization: Bearer <token>` header.
 *
 * 3. **Azure CLI**: Run `az login` before using the extension. The adapter calls
 *    `az account get-access-token` automatically and produces a Bearer header.
 */

import * as https from 'node:https';
import archiver from 'archiver';
import * as yaml from 'js-yaml';
import {
  AzureDevOpsAuthMethod,
  AzureDevOpsAuthService,
} from '../services/azure-devops-auth';
import {
  Bundle,
  RegistrySource,
  SourceMetadata,
  ValidationResult,
} from '../types/registry';
import {
  Logger,
} from '../utils/logger';
import {
  RepositoryAdapter,
} from './repository-adapter';

/** Maximum redirect depth to prevent infinite loops */
const MAX_REDIRECTS = 10;

/** ADO REST API version used for all requests */
const ADO_API_VERSION = '7.0';

// ---------------------------------------------------------------------------
// Collection manifest schema (shared with awesome-copilot-adapter)
// ---------------------------------------------------------------------------

/**
 * Schema for a `.collection.yml` file — a lightweight manifest that lists
 * the individual prompt/instruction/chat-mode files that make up a bundle.
 * The adapter reads this file from the ADO repository and synthesises a
 * standard `deployment-manifest.yml` on the fly during download.
 */
interface CollectionManifest {
  id: string;
  name: string;
  description: string;
  version?: string;
  author?: string;
  tags?: string[];
  items: CollectionItem[];
}

interface CollectionItem {
  path: string;
  kind: 'prompt' | 'instruction' | 'chat-mode' | 'agent' | 'skill';
}

/**
 * ADO Items API response for a single item
 */
interface AdoItem {
  objectId: string;
  gitObjectType: 'blob' | 'tree' | 'commit' | 'tag';
  commitId: string;
  path: string;
  isFolder: boolean;
  url: string;
}

/**
 * ADO Items API list response
 */
interface AdoItemsResponse {
  count: number;
  value: AdoItem[];
}

/**
 * ADO Repository metadata response
 */
interface AdoRepository {
  id: string;
  name: string;
  project: {
    name: string;
    description?: string;
  };
  remoteUrl: string;
  defaultBranch?: string;
}

/**
 * Parsed components extracted from an Azure DevOps repository URL.
 *
 * Supported URL formats:
 * - `https://dev.azure.com/{org}/{project}/_git/{repo}`
 * - `https://{org}.visualstudio.com/{project}/_git/{repo}`
 * - `https://{server}/{collection}/{project}/_git/{repo}`  (on-premises)
 */
interface ParsedAdoUrl {
  /** Full base URL up to and including the project segment */
  projectBaseUrl: string;
  /** Project name (last path segment of projectBaseUrl) */
  project: string;
  /** Repository name */
  repository: string;
}

/**
 * Azure DevOps repository adapter.
 *
 * Implements `IRepositoryAdapter` to expose prompt bundles stored in an ADO Git
 * repository. Bundles are discovered by scanning for `deployment-manifest.yml`
 * files under the configured `collectionsPath`.
 */
export class AzureDevOpsAdapter extends RepositoryAdapter {
  public readonly type = 'azure-devops';

  private readonly logger: Logger;
  private readonly authService: AzureDevOpsAuthService;

  /** Cached resolved auth token — set after the first successful authentication */
  private authToken: string | undefined;
  /** How the cached token was obtained */
  private authMethod: AzureDevOpsAuthMethod = 'none';

  constructor(source: RegistrySource) {
    super(source);
    this.logger = Logger.getInstance();
    this.authService = new AzureDevOpsAuthService();

    if (!this.isValidAdoUrl(source.url)) {
      throw new Error(
        `Invalid Azure DevOps URL: "${source.url}". `
        + 'Expected format: https://dev.azure.com/{org}/{project}/_git/{repo} '
        + 'or https://{org}.visualstudio.com/{project}/_git/{repo}'
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Private getters
  // ---------------------------------------------------------------------------

  /**
   * Branch to use when fetching from the repository.
   * Defaults to `'main'` if not specified in source config.
   */
  private get branch(): string {
    return (this.source.config?.branch) ?? 'main';
  }

  /**
   * Root path within the repository to scan for bundles.
   * Defaults to `'/'` (repository root) if not specified in source config.
   */
  private get collectionsPath(): string {
    const p = (this.source.config?.collectionsPath) ?? '/';
    return p.startsWith('/') ? p : `/${p}`;
  }

  // ---------------------------------------------------------------------------
  // URL parsing
  // ---------------------------------------------------------------------------

  /**
   * Validate that the given URL looks like an Azure DevOps repository URL.
   *
   * Accepted patterns:
   * - `https://dev.azure.com/.../_git/...`
   * - `https://*.visualstudio.com/.../_git/...`
   * - Any other HTTPS URL containing `/_git/` (covers on-premises deployments)
   *
   * Only HTTPS URLs are accepted to ensure credentials are never sent in plain text.
   * @param urlString - URL to validate
   */
  private isValidAdoUrl(urlString: string): boolean {
    if (!urlString.startsWith('https://')) {
      return false;
    }
    return urlString.includes('/_git/');
  }

  /**
   * Parse the Azure DevOps repository URL into components used for API calls.
   *
   * For `https://dev.azure.com/org/project/_git/repo`:
   * - projectBaseUrl = `https://dev.azure.com/org/project`
   * - repository = `repo`
   *
   * For `https://org.visualstudio.com/project/_git/repo`:
   * - projectBaseUrl = `https://org.visualstudio.com/project`
   * - repository = `repo`
   *
   * For on-premises `https://server/collection/project/_git/repo`:
   * - projectBaseUrl = `https://server/collection/project`
   * - repository = `repo`
   */
  private parseAdoUrl(): ParsedAdoUrl {
    const gitIdx = this.source.url.indexOf('/_git/');
    if (gitIdx === -1) {
      throw new Error(`Cannot parse Azure DevOps URL: "${this.source.url}"`);
    }

    const projectBaseUrl = this.source.url.substring(0, gitIdx);
    const afterGit = this.source.url.substring(gitIdx + '/_git/'.length);
    const repository = afterGit.split(/[?#/]/)[0];

    if (!repository) {
      throw new Error(`Cannot extract repository name from URL: "${this.source.url}"`);
    }

    const project = projectBaseUrl.split('/').pop() ?? projectBaseUrl;

    return { projectBaseUrl, project, repository };
  }

  /**
   * Build the ADO Git API base URL for this repository.
   * Example: `https://dev.azure.com/org/project/_apis/git/repositories/repo`
   */
  private buildApiBase(): string {
    const { projectBaseUrl, repository } = this.parseAdoUrl();
    return `${projectBaseUrl}/_apis/git/repositories/${encodeURIComponent(repository)}`;
  }

  // ---------------------------------------------------------------------------
  // Authentication
  // ---------------------------------------------------------------------------

  /**
   * Resolve and cache the authentication token.
   * Uses `source.token` (PAT) first, then Azure CLI fallback.
   */
  private async getAuthenticationToken(): Promise<{ token: string; method: AzureDevOpsAuthMethod } | undefined> {
    if (this.authToken !== undefined) {
      this.logger.debug(`[AzureDevOpsAdapter] Using cached token (method: ${this.authMethod})`);
      return { token: this.authToken, method: this.authMethod };
    }

    const result = await this.authService.getToken(this.getAuthToken());
    if (result) {
      this.authToken = result.token;
      this.authMethod = result.method;
    }
    return result ?? undefined;
  }

  // ---------------------------------------------------------------------------
  // HTTP helpers
  // ---------------------------------------------------------------------------

  /**
   * Build request headers including the Authorization header when a token is available.
   * @param accept - Accept header value
   */
  private async buildHeaders(accept: string): Promise<Record<string, string>> {
    const headers: Record<string, string> = {
      'User-Agent': 'Prompt-Registry-VSCode-Extension/1.0',
      Accept: accept
    };

    const auth = await this.getAuthenticationToken();
    if (auth) {
      headers.Authorization = this.authService.buildAuthHeader(auth.token, auth.method);
      this.logger.debug(`[AzureDevOpsAdapter] Auth header set (method: ${auth.method})`);
    } else {
      this.logger.debug('[AzureDevOpsAdapter] No auth header — unauthenticated request');
    }

    return headers;
  }

  /**
   * Construct a user-friendly HTTP error message.
   * @param statusCode - HTTP status code
   * @param requestUrl - URL that returned the error
   */
  private buildHttpErrorMessage(statusCode: number, requestUrl: string): string {
    switch (statusCode) {
      case 401: {
        return `Azure DevOps authentication failed (HTTP 401) for ${requestUrl}. `
          + 'Check that your PAT has "Code (read)" scope, sign in to VS Code with your '
          + 'Microsoft account, or run `az login`.';
      }
      case 403: {
        return `Azure DevOps access denied (HTTP 403) for ${requestUrl}. `
          + 'Your token may lack the required permissions.';
      }
      case 404: {
        return `Azure DevOps resource not found (HTTP 404) for ${requestUrl}. `
          + 'Verify the organization, project, repository name, and branch.';
      }
      default: {
        return `Azure DevOps API error (HTTP ${statusCode}) for ${requestUrl}.`;
      }
    }
  }

  /**
   * Make an HTTPS GET request and return the response body as a string.
   * Follows redirects up to `MAX_REDIRECTS` levels deep.
   * @param requestUrl - Full URL to request
   * @param accept - Accept header value
   * @param depth - Current redirect depth (used internally)
   */
  private async fetchString(requestUrl: string, accept = 'application/json', depth = 0): Promise<string> {
    if (depth >= MAX_REDIRECTS) {
      throw new Error(`[AzureDevOpsAdapter] Maximum redirect depth (${MAX_REDIRECTS}) exceeded for ${requestUrl}`);
    }

    const headers = await this.buildHeaders(accept);
    const parsedUrl = new URL(requestUrl);

    const sanitized = { ...headers };
    if (sanitized.Authorization) {
      // Log only the auth scheme (e.g. "Basic" or "Bearer") to avoid token exposure
      sanitized.Authorization = sanitized.Authorization.split(' ')[0] + ' [redacted]';
    }
    this.logger.debug(`[AzureDevOpsAdapter] GET ${requestUrl} headers: ${JSON.stringify(sanitized)}`);

    return new Promise((resolve, reject) => {
      const options: https.RequestOptions = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || 443,
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'GET',
        headers
      };

      const req = https.request(options, (res) => {
        if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
          const redirectUrl = res.headers.location.startsWith('http')
            ? res.headers.location
            : new URL(res.headers.location, requestUrl).toString();
          this.logger.debug(`[AzureDevOpsAdapter] Redirect (${depth + 1}) → ${redirectUrl}`);
          this.fetchString(redirectUrl, accept, depth + 1).then(resolve).catch(reject);
          return;
        }

        let data = '';
        res.on('data', (chunk: string) => {
          data += chunk;
        });
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 400) {
            this.logger.error(`[AzureDevOpsAdapter] HTTP ${res.statusCode} for ${requestUrl}: ${data.substring(0, 300)}`);
            reject(new Error(this.buildHttpErrorMessage(res.statusCode, requestUrl)));
            return;
          }
          resolve(data);
        });
      });

      req.on('error', (err) => {
        this.logger.error(`[AzureDevOpsAdapter] Network error for ${requestUrl}: ${err.message}`);
        reject(new Error(`Azure DevOps request failed: ${err.message}`));
      });

      req.end();
    });
  }

  /**
   * Make an HTTPS GET request and return the response body as a Buffer.
   * Used for binary downloads (ZIP archives).
   * Follows redirects up to `MAX_REDIRECTS` levels deep.
   * @param requestUrl - Full URL to request
   * @param depth - Current redirect depth (used internally)
   */
  private async fetchBuffer(requestUrl: string, depth = 0): Promise<Buffer> {
    if (depth >= MAX_REDIRECTS) {
      throw new Error(`[AzureDevOpsAdapter] Maximum redirect depth (${MAX_REDIRECTS}) exceeded for ${requestUrl}`);
    }

    const headers = await this.buildHeaders('application/zip');
    const parsedUrl = new URL(requestUrl);

    this.logger.debug(`[AzureDevOpsAdapter] GET (binary) ${requestUrl}`);

    return new Promise((resolve, reject) => {
      const options: https.RequestOptions = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || 443,
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'GET',
        headers
      };

      const req = https.request(options, (res) => {
        if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
          const redirectUrl = res.headers.location.startsWith('http')
            ? res.headers.location
            : new URL(res.headers.location, requestUrl).toString();
          this.logger.debug(`[AzureDevOpsAdapter] Redirect (binary, ${depth + 1}) → ${redirectUrl}`);
          this.fetchBuffer(redirectUrl, depth + 1).then(resolve).catch(reject);
          return;
        }

        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
        });
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 400) {
            const body = Buffer.concat(chunks).toString('utf8').substring(0, 300);
            this.logger.error(`[AzureDevOpsAdapter] HTTP ${res.statusCode} for ${requestUrl}: ${body}`);
            reject(new Error(this.buildHttpErrorMessage(res.statusCode, requestUrl)));
            return;
          }
          resolve(Buffer.concat(chunks));
        });
      });

      req.on('error', (err) => {
        this.logger.error(`[AzureDevOpsAdapter] Network error (binary) for ${requestUrl}: ${err.message}`);
        reject(new Error(`Azure DevOps download failed: ${err.message}`));
      });

      req.end();
    });
  }

  // ---------------------------------------------------------------------------
  // ADO API helpers
  // ---------------------------------------------------------------------------

  /**
   * Encode a repository path for use as a query-string parameter value.
   *
   * `URLSearchParams` percent-encodes forward slashes (`/` → `%2F`), but the
   * Azure DevOps Items API returns HTTP 400 when it receives `path=%2Fskills`
   * instead of `path=/skills`.  This helper percent-encodes each path segment
   * individually so that slashes remain literal in the query string.
   * @param path - Repository path, e.g. `/my-bundle/deployment-manifest.yml`
   */
  private encodePath(path: string): string {
    return path.split('/').map((segment) => encodeURIComponent(segment)).join('/');
  }

  /**
   * Fetch **all** Git items in the repository in a **single API call** using
   * `recursionLevel=Full`.
   *
   * The ADO Items API returns a flat list of every blob (file) and tree
   * (directory) in the repository, together with their `path`, `isFolder`,
   * and `gitObjectType` fields.  Retrieving the full tree in one request is
   * the foundation of the efficient blob-scan discovery strategy.
   *
   * The `path` query parameter is intentionally **omitted** from this call.
   * Passing `path=<folder>` with `recursionLevel=Full` is unreliable across
   * ADO versions and on-premises installations — some return HTTP 400 for any
   * path value, others reject only `path=/` or percent-encoded slashes.
   * Fetching the whole tree from root and filtering in memory via
   * {@link findManifestBlobs} is simpler, correct on every ADO version, and
   * has no correctness cost (prompt bundle repos are typically small).
   * @returns Flat array of every item (blob or tree) in the repository
   */
  private async fetchFullTree(): Promise<AdoItem[]> {
    const apiBase = this.buildApiBase();
    const params = new URLSearchParams({
      recursionLevel: 'Full',
      'versionDescriptor.version': this.branch,
      'versionDescriptor.versionType': 'branch',
      'api-version': ADO_API_VERSION
    });
    const requestUrl = `${apiBase}/items?${params.toString()}`;

    this.logger.debug(
      `[AzureDevOpsAdapter] Fetching full tree at "${this.collectionsPath}" `
      + `(branch: ${this.branch})`
    );
    const responseText = await this.fetchString(requestUrl);
    const response = JSON.parse(responseText) as AdoItemsResponse;
    return response.value ?? [];
  }

  /**
   * Filter a flat item list for **collection blobs** that are at most one
   * directory level beneath `collectionsPath`.
   *
   * Two layouts are supported:
   *
   * **Depth-0 (flat layout)** — the `.collection.yml` sits directly inside
   * `collectionsPath`.  Items at this depth have exactly one non-empty segment
   * after the base prefix:
   * ```
   * /collections/my-collection.collection.yml   → depth 0 ✓
   * ```
   *
   * **Depth-1 (bundle-directory layout)** — the `.collection.yml` sits one
   * level deeper, inside a dedicated bundle subdirectory.  Items at this depth
   * have exactly two non-empty segments after the base prefix:
   * ```
   * /collections/my-bundle/my-bundle.collection.yml  → depth 1 ✓
   * ```
   *
   * Files nested more than one level deep are silently ignored.
   *
   * Examples (collectionsPath = '/prompts'):
   * ```
   * /prompts/my-collection.collection.yml          → depth 0 ✓
   * /prompts/my-bundle/my-bundle.collection.yml    → depth 1 ✓
   * /prompts/nested/inner/other.collection.yml     → depth 2 ✗ (skipped)
   * ```
   * @param items - All items returned by {@link fetchFullTree}
   * @returns Items that are `.collection.yml` blobs at depth-0 or depth-1 under `collectionsPath`
   */
  private findCollectionBlobs(items: AdoItem[]): AdoItem[] {
    // Strip trailing slash from the base so the depth calculation is consistent
    // for both '/' (which becomes '') and '/bundles' (which stays '/bundles').
    const base = this.collectionsPath.replace(/\/$/, '');

    return items.filter((item) => {
      // Only blobs (files) — skip trees (directories)
      if (item.isFolder) {
        return false;
      }

      // File must be a .collection.yml file
      const filename = item.path.split('/').pop() ?? '';
      if (!filename.endsWith('.collection.yml')) {
        return false;
      }

      // Compute the path relative to collectionsPath.  We then split on '/'
      // and count non-empty segments.
      // segments.length === 1 → depth-0: <collection-file> directly in collectionsPath
      // segments.length === 2 → depth-1: <bundleDir>/<collection-file>
      // length > 2            → nested too deep, skip
      const relative = item.path.startsWith(base)
        ? item.path.substring(base.length).replace(/^\//, '')
        : item.path.replace(/^\//, '');

      const segments = relative.split('/').filter(Boolean);

      return segments.length === 1 || segments.length === 2;
    });
  }

  /**
   * Fetch a single text file from the repository.
   * @param path - Repository path of the file
   */
  private async fetchFileContent(path: string): Promise<string> {
    const apiBase = this.buildApiBase();
    // Path must be appended outside URLSearchParams to keep '/' characters literal.
    // URLSearchParams encodes '/' as '%2F', which the ADO Items API rejects (HTTP 400).
    const params = new URLSearchParams({
      'versionDescriptor.version': this.branch,
      'versionDescriptor.versionType': 'branch',
      'api-version': ADO_API_VERSION
    });
    const requestUrl = `${apiBase}/items?${params.toString()}&path=${this.encodePath(path)}`;

    this.logger.debug(`[AzureDevOpsAdapter] Fetching file "${path}"`);
    return this.fetchString(requestUrl, 'text/plain');
  }

  /**
   * Download a directory as a ZIP archive from the ADO Items API.
   * @param path - Repository path of the directory to zip
   */
  private async downloadDirectoryAsZip(path: string): Promise<Buffer> {
    const apiBase = this.buildApiBase();
    // Path must be appended outside URLSearchParams to keep '/' characters literal.
    // URLSearchParams encodes '/' as '%2F', which the ADO Items API rejects (HTTP 400).
    const params = new URLSearchParams({
      download: 'true',
      recursionLevel: 'Full',
      'versionDescriptor.version': this.branch,
      'versionDescriptor.versionType': 'branch',
      'api-version': ADO_API_VERSION
    });
    // `$format` uses a dollar sign which URLSearchParams encodes as %24.
    // Appending it as a literal string is safe here since `$` is a valid
    // query-string character (RFC 3986 §3.4) and ADO requires the exact string.
    const requestUrl = `${apiBase}/items?${params.toString()}&path=${this.encodePath(path)}&$format=zip`;

    this.logger.debug(`[AzureDevOpsAdapter] Downloading directory "${path}" as ZIP`);
    return this.fetchBuffer(requestUrl);
  }

  // ---------------------------------------------------------------------------
  // Bundle discovery helpers
  // ---------------------------------------------------------------------------

  /**
   * Parse the raw YAML text of a `.collection.yml` file.
   * Returns `null` if the text cannot be parsed (malformed file).
   * @param text - Raw YAML content of the collection file
   * @param collectionPath - Repository path (used in log messages)
   */
  private parseCollectionManifest(text: string, collectionPath: string): CollectionManifest | null {
    try {
      return yaml.load(text) as CollectionManifest;
    } catch (err) {
      this.logger.warn(`[AzureDevOpsAdapter] Failed to parse collection "${collectionPath}": ${err}`);
      return null;
    }
  }

  /**
   * Build a `Bundle` object from a parsed `CollectionManifest` and bundle directory path.
   *
   * **Depth-0 (flat layout)**: when `dirPath` equals the `collectionsPath` base the
   * collection file lives directly inside `collectionsPath` (e.g.
   * `/collections/my-collection.collection.yml`).  In that case `dirPath` alone would
   * be the same for every collection in the folder, so the manifest `id` field is
   * appended to make each bundle ID unique and stable.
   *
   * **Depth-1 (bundle-directory layout)**: `dirPath` is the dedicated bundle
   * subdirectory (e.g. `/collections/my-bundle`), which is already unique per bundle.
   * @param collection - Parsed collection manifest
   * @param dirPath - Repository path of the directory containing the `.collection.yml`
   * @param dirName - Basename of that directory
   * @param collectionPath - Full path to the `.collection.yml` file (used for manifestUrl)
   */
  private buildBundleFromCollection(
    collection: CollectionManifest,
    dirPath: string,
    dirName: string,
    collectionPath: string
  ): Bundle {
    const { project, repository } = this.parseAdoUrl();
    const collectionId = collection.id ?? dirName;

    // Bundle ID format: {project}-{repository}-{collectionId}
    // This is short, slash-free, and safe to use as a filename.
    const bundleId = `${project}-${repository}-${collectionId}`;

    return {
      id: bundleId,
      name: collection.name ?? dirName,
      version: collection.version ?? '1.0.0',
      description: collection.description ?? '',
      author: collection.author ?? '',
      sourceId: this.source.id,
      environments: ['vscode'],
      tags: collection.tags ?? [],
      lastUpdated: new Date().toISOString(),
      size: `${collection.items.length} items`,
      dependencies: [],
      license: 'Unknown',
      manifestUrl: this.getCollectionFileUrl(collectionPath),
      downloadUrl: this.getCollectionFileUrl(collectionPath),
      repository: this.source.url
    };
  }

  /**
   * Map a `.collection.yml` item kind to the deployment-manifest prompt type.
   * @param kind - Item kind from the collection manifest
   */
  private mapKindToType(kind: string): 'prompt' | 'instructions' | 'chatmode' | 'agent' | 'skill' {
    const kindMap: Record<string, 'prompt' | 'instructions' | 'chatmode' | 'agent' | 'skill'> = {
      prompt: 'prompt',
      instruction: 'instructions',
      'chat-mode': 'chatmode',
      agent: 'agent',
      skill: 'skill'
    };
    return kindMap[kind] ?? 'prompt';
  }

  /**
   * Convert kebab-case or space-separated words to Title Case.
   * @param str - Input string
   */
  private titleCase(str: string): string {
    return str
      .split(' ')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  }

  /**
   * Synthesise a `deployment-manifest.yml` payload from a parsed collection.
   * This manifest is embedded into the downloaded ZIP so the bundle installer
   * can process it without any changes to the installation pipeline.
   * @param collection - Parsed collection manifest
   * @param dirName - Bundle directory name (used as fallback ID)
   */
  private createDeploymentManifest(collection: CollectionManifest, dirName: string): Record<string, unknown> {
    const prompts = collection.items.map((item) => {
      // Skills are directories — derive the skill name from the directory portion of the path
      // and preserve the full path so the installer can locate the skill folder.
      if (item.kind === 'skill') {
        const skillDirPath = item.path.endsWith('.md')
          ? item.path.substring(0, item.path.lastIndexOf('/'))
          : item.path;
        const skillName = skillDirPath.split('/').pop() ?? 'unknown-skill';
        return {
          id: skillName,
          name: this.titleCase(skillName.replace(/-/g, ' ')),
          description: `Skill from ${collection.name}`,
          file: skillDirPath,
          type: 'skill' as const,
          tags: collection.tags ?? []
        };
      }

      const filename = item.path.split('/').pop() ?? 'unknown';
      const id = filename.replace(/\.(prompt|instructions|chatmode|agent)\.md$/, '');
      return {
        id,
        name: this.titleCase(id.replace(/-/g, ' ')),
        description: `From ${collection.name}`,
        file: `prompts/${filename}`,
        type: this.mapKindToType(item.kind),
        tags: collection.tags ?? []
      };
    });

    return {
      id: collection.id ?? dirName,
      name: collection.name,
      version: collection.version ?? '1.0.0',
      description: collection.description ?? '',
      author: collection.author ?? '',
      repository: this.source.url,
      license: 'Unknown',
      tags: collection.tags ?? [],
      prompts
    };
  }

  /**
   * Fetch each file listed in a collection manifest from the ADO repository and
   * package them — together with a synthesised `deployment-manifest.yml` — into
   * an in-memory ZIP archive.
   *
   * This is the ADO equivalent of `AwesomeCopilotAdapter.createBundleArchive()`.
   * Rather than using the ADO `$format=zip` endpoint (which requires a
   * pre-existing directory), this method assembles the archive from individual
   * file fetches so that repos using the `.collection.yml` convention do not need
   * to maintain any `deployment-manifest.yml` files at all.
   *
   * **Skill items** are directories rather than single files.  For each item with
   * `kind === 'skill'`, all blobs under the skill directory are collected from the
   * already-fetched `allItems` tree and added to the archive preserving their
   * repo-root-relative paths (e.g. `skills/my-skill/SKILL.md`).
   * @param collection - Parsed collection manifest
   * @param dirName - Bundle directory basename (used as fallback in the manifest)
   * @param allItems - Full repository item tree (from {@link fetchFullTree}); used to
   *   discover skill directory contents without an extra API call
   */
  private async createBundleArchive(
    collection: CollectionManifest,
    dirName: string,
    allItems: AdoItem[]
  ): Promise<Buffer> {
    this.logger.debug(`[AzureDevOpsAdapter] Creating archive for collection: ${collection.name}`);

    return new Promise<Buffer>((resolve, reject) => {
      void (async () => {
        try {
          const archive = archiver('zip', { zlib: { level: 9 } });
          const chunks: Buffer[] = [];

          archive.on('data', (chunk: Buffer) => {
            chunks.push(chunk);
          });
          archive.on('finish', () => {
            resolve(Buffer.concat(chunks));
          });
          archive.on('error', (err: Error) => {
            reject(err);
          });

          // Embed the synthesised deployment manifest
          const manifest = this.createDeploymentManifest(collection, dirName);
          archive.append(yaml.dump(manifest), { name: 'deployment-manifest.yml' });

          // Fetch and add each item file
          for (const item of collection.items) {
            try {
              if (item.kind === 'skill') {
                // Skills are directories — collect all blobs under the skill dir from
                // the already-fetched full tree and add them preserving repo-root paths.
                const skillDirPath = item.path.endsWith('.md')
                  ? item.path.substring(0, item.path.lastIndexOf('/'))
                  : item.path;
                // allItems paths always have a leading '/'; normalise item.path accordingly.
                const normalizedSkillDir = skillDirPath.startsWith('/')
                  ? skillDirPath
                  : `/${skillDirPath}`;
                const skillFiles = allItems.filter(
                  (treeItem) => !treeItem.isFolder
                    && treeItem.path.startsWith(normalizedSkillDir + '/')
                );
                for (const skillFile of skillFiles) {
                  const fileContent = await this.fetchFileContent(skillFile.path);
                  // Strip leading '/' to get a repo-root-relative archive path
                  archive.append(fileContent, { name: skillFile.path.replace(/^\//, '') });
                  this.logger.debug(`[AzureDevOpsAdapter] Added skill file ${skillFile.path} to archive`);
                }
              } else {
                const fileContent = await this.fetchFileContent(item.path);
                const filename = item.path.split('/').pop() ?? 'unknown';
                archive.append(fileContent, { name: `prompts/${filename}` });
                this.logger.debug(`[AzureDevOpsAdapter] Added ${filename} to archive`);
              }
            } catch (err) {
              this.logger.warn(`[AzureDevOpsAdapter] Skipping item "${item.path}": ${err}`);
            }
          }

          void archive.finalize();
        } catch (error) {
          // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- rejection value is handled by caller
          reject(error);
        }
      })();
    });
  }

  /**
   * Build the ADO Items API URL for a specific file in the repository.
   * Used as the manifestUrl and downloadUrl for collection-based bundles — the
   * `.collection.yml` file itself is the canonical descriptor.
   * @param filePath - Repository path of the collection file
   */
  private getCollectionFileUrl(filePath: string): string {
    const apiBase = this.buildApiBase();
    const params = new URLSearchParams({
      'versionDescriptor.version': this.branch,
      'api-version': ADO_API_VERSION
    });
    return `${apiBase}/items?${params.toString()}&path=${this.encodePath(filePath)}`;
  }

  // ---------------------------------------------------------------------------
  // IRepositoryAdapter — public methods
  // ---------------------------------------------------------------------------

  /**
   * Force re-authentication by clearing the cached token.
   * The next request will re-attempt the full authentication fallback chain.
   */
  public override forceAuthentication(): Promise<void> {
    this.logger.info('[AzureDevOpsAdapter] Invalidating cached authentication token');
    this.authToken = undefined;
    this.authMethod = 'none';
    return Promise.resolve();
  }

  /**
   * Fetch all bundles from the Azure DevOps repository.
   *
   * Uses the **full-tree blob-scan** strategy for efficient discovery:
   *
   * 1. **Fetch the full tree** — one `GET /items?recursionLevel=Full` call
   *    retrieves every file and directory in the repository at once.
   *
   * 2. **Filter collection blobs** — scan the returned item list in memory for
   *    `.collection.yml` files that sit exactly one level beneath
   *    `collectionsPath`.  This avoids probing every subdirectory individually.
   *
   * 3. **Fetch collection content** — for each `.collection.yml` blob found,
   *    one `GET /items?path=…` call retrieves the file content, which is then
   *    parsed and converted to a `Bundle`.
   *
   * Total API calls: **1** (full tree) + **N** (one per discovered bundle).
   * @returns Array of discovered bundles
   */
  public async fetchBundles(): Promise<Bundle[]> {
    this.logger.info(
      `[AzureDevOpsAdapter] Fetching bundles from "${this.source.url}" `
      + `(branch: ${this.branch}, path: ${this.collectionsPath})`
    );

    try {
      // ── Step 1: Retrieve the full repository tree in a single API call ──────
      const allItems = await this.fetchFullTree();

      // ── Step 2: Filter for .collection.yml blobs exactly one level deep ─────
      const collectionBlobs = this.findCollectionBlobs(allItems);

      this.logger.debug(
        `[AzureDevOpsAdapter] Full tree: ${allItems.length} item(s), `
        + `${collectionBlobs.length} collection blob(s) found`
      );

      // ── Step 3: Fetch and parse each collection file ─────────────────────────
      const bundles: Bundle[] = [];

      for (const blob of collectionBlobs) {
        try {
          const fileContent = await this.fetchFileContent(blob.path);
          const collection = this.parseCollectionManifest(fileContent, blob.path);

          if (collection) {
            // The bundle directory is the parent of the .collection.yml file
            const dirPath = blob.path.substring(0, blob.path.lastIndexOf('/'));
            const dirName = dirPath.split('/').pop() ?? dirPath;
            const bundle = this.buildBundleFromCollection(collection, dirPath, dirName, blob.path);
            bundles.push(bundle);
            this.logger.debug(
              `[AzureDevOpsAdapter] Found bundle: ${bundle.id} `
              + `(${bundle.name} v${bundle.version})`
            );
          }
        } catch (err) {
          // Log and continue — a single bad collection file should not block others
          this.logger.warn(
            `[AzureDevOpsAdapter] Failed to load collection at "${blob.path}": ${err}`
          );
        }
      }

      this.logger.info(`[AzureDevOpsAdapter] Discovered ${bundles.length} bundle(s)`);
      return bundles;
    } catch (error) {
      throw new Error(`Failed to fetch bundles from Azure DevOps: ${error}`);
    }
  }

  /**
   * Download a bundle from Azure DevOps as an in-memory ZIP archive.
   *
   * Rather than using the ADO `$format=zip` endpoint (which requires a
   * pre-existing directory with a `deployment-manifest.yml`), this method
   * re-fetches the `.collection.yml` for the bundle, then individually
   * downloads each listed item and packages them — together with a synthesised
   * `deployment-manifest.yml` — into an archive that the standard bundle
   * installer can process without modification.
   * @param bundle - Bundle to download
   * @returns Buffer containing the ZIP archive
   */
  public async downloadBundle(bundle: Bundle): Promise<Buffer> {
    this.logger.info(`[AzureDevOpsAdapter] Downloading bundle: ${bundle.id}`);
    try {
      // Recover the collection file path from the bundle's manifestUrl.
      // manifestUrl is the ADO Items API URL for the .collection.yml, e.g.:
      //   https://.../items?...&path=/my-bundle/my-bundle.collection.yml
      const collectionFilePath = new URL(bundle.manifestUrl).searchParams.get('path');
      if (!collectionFilePath) {
        throw new Error(`Cannot determine collection file path from bundle manifestUrl: "${bundle.manifestUrl}"`);
      }

      const dirPath = collectionFilePath.substring(0, collectionFilePath.lastIndexOf('/'));
      const dirName = dirPath.split('/').pop() ?? dirPath;

      // The full tree is still needed for skill directory resolution in createBundleArchive.
      const allItems = await this.fetchFullTree();

      const fileContent = await this.fetchFileContent(collectionFilePath);
      const collection = this.parseCollectionManifest(fileContent, collectionFilePath);

      if (!collection) {
        throw new Error(`Failed to parse collection file at "${collectionFilePath}"`);
      }

      return await this.createBundleArchive(collection, dirName, allItems);
    } catch (error) {
      throw new Error(`Failed to download bundle "${bundle.id}" from Azure DevOps: ${error}`);
    }
  }

  /**
   * Fetch metadata about the Azure DevOps repository.
   * @returns Source metadata including repository name, description, and bundle count
   */
  public async fetchMetadata(): Promise<SourceMetadata> {
    const apiBase = this.buildApiBase();
    const params = new URLSearchParams({ 'api-version': ADO_API_VERSION });
    const requestUrl = `${apiBase}?${params.toString()}`;

    try {
      const responseText = await this.fetchString(requestUrl);
      const repo = JSON.parse(responseText) as AdoRepository;
      const bundles = await this.fetchBundles();

      return {
        name: repo.name,
        description: repo.project?.description ?? '',
        bundleCount: bundles.length,
        lastUpdated: new Date().toISOString(),
        version: '1.0.0'
      };
    } catch (error) {
      throw new Error(`Failed to fetch Azure DevOps metadata: ${error}`);
    }
  }

  /**
   * Validate that the configured Azure DevOps repository is accessible.
   *
   * Checks that:
   * 1. The URL is a valid Azure DevOps repository URL
   * 2. The repository API endpoint returns successfully
   * 3. At least one bundle was found (warning if none, not an error)
   * @returns Validation result
   */
  public async validate(): Promise<ValidationResult> {
    if (!this.isValidAdoUrl(this.source.url)) {
      return {
        valid: false,
        errors: [
          `Invalid Azure DevOps URL: "${this.source.url}". `
          + 'Expected format: https://dev.azure.com/{org}/{project}/_git/{repo}'
        ],
        warnings: [],
        bundlesFound: 0
      };
    }

    try {
      const apiBase = this.buildApiBase();
      const params = new URLSearchParams({ 'api-version': ADO_API_VERSION });
      await this.fetchString(`${apiBase}?${params.toString()}`);

      const bundles = await this.fetchBundles();
      return {
        valid: true,
        errors: [],
        warnings: bundles.length === 0
          ? [`No bundles found in "${this.collectionsPath}" on branch "${this.branch}"`]
          : [],
        bundlesFound: bundles.length
      };
    } catch (error) {
      return {
        valid: false,
        errors: [`Azure DevOps validation failed: ${error}`],
        warnings: [],
        bundlesFound: 0
      };
    }
  }

  /**
   * Get the collection manifest URL for a bundle.
   * Bundle IDs are no longer URL-encoded paths, so this returns the ADO repository
   * URL as a stable reference. The actual collection file URL is stored in
   * `bundle.manifestUrl` and used directly by `downloadBundle`.
   * @param _bundleId - Bundle identifier (not used)
   * @param _version - Not used; ADO uses branch-based versioning
   * @returns ADO repository URL
   */
  public getManifestUrl(_bundleId: string, _version?: string): string {
    return this.source.url;
  }

  /**
   * Get the download URL for a bundle.
   * @param _bundleId - Bundle identifier (not used)
   * @param _version - Not used; ADO uses branch-based versioning
   * @returns ADO repository URL
   */
  public getDownloadUrl(_bundleId: string, _version?: string): string {
    return this.source.url;
  }
}

/**
 * Azure DevOps Repository Adapter
 *
 * Fetches prompt bundles from Azure DevOps (ADO) Git repositories.
 * Supports both Azure DevOps Services (cloud) and Azure DevOps Server (on-premises).
 *
 * ## How bundles are discovered
 * The adapter scans the repository at the configured `collectionsPath` (default: root `/`).
 * Each top-level subdirectory that contains a `deployment-manifest.yml` (or `.yaml` / `.json`)
 * is treated as a prompt bundle.
 *
 * ## Downloading bundles
 * Bundles are downloaded as ZIP archives using the ADO Items API's `$format=zip` option,
 * which packages the entire bundle directory on demand.
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
 * Configure authentication in one of two ways:
 * 1. **Personal Access Token (PAT)**: Set `token` on the source. Generate a PAT with
 *    "Code (read)" scope at https://dev.azure.com/{org}/_usersettings/tokens
 * 2. **Azure CLI**: Ensure the Azure CLI is installed and run `az login` before using
 *    the extension. The adapter will call `az account get-access-token` automatically.
 */

import * as https from 'node:https';
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

    return { projectBaseUrl, repository };
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
          + 'Check that your PAT is valid and has "Code (read)" scope, or run `az login`.';
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
   * List all items directly under `path` in the repository (one level deep).
   * Returns only items of type `tree` (directories) and `blob` (files).
   * @param path - Repository path to list (e.g. `/` or `/prompt-bundles`)
   */
  private async listItems(path: string): Promise<AdoItem[]> {
    const apiBase = this.buildApiBase();
    const params = new URLSearchParams({
      path,
      recursionLevel: 'OneLevel',
      'versionDescriptor.version': this.branch,
      'versionDescriptor.versionType': 'branch',
      'api-version': ADO_API_VERSION
    });
    const requestUrl = `${apiBase}/items?${params.toString()}`;

    this.logger.debug(`[AzureDevOpsAdapter] Listing items at path "${path}"`);
    const responseText = await this.fetchString(requestUrl);
    const response = JSON.parse(responseText) as AdoItemsResponse;
    return response.value ?? [];
  }

  /**
   * Fetch a single text file from the repository.
   * @param path - Repository path of the file
   */
  private async fetchFileContent(path: string): Promise<string> {
    const apiBase = this.buildApiBase();
    const params = new URLSearchParams({
      path,
      'versionDescriptor.version': this.branch,
      'versionDescriptor.versionType': 'branch',
      'api-version': ADO_API_VERSION
    });
    const requestUrl = `${apiBase}/items?${params.toString()}`;

    this.logger.debug(`[AzureDevOpsAdapter] Fetching file "${path}"`);
    return this.fetchString(requestUrl, 'text/plain');
  }

  /**
   * Download a directory as a ZIP archive from the ADO Items API.
   * @param path - Repository path of the directory to zip
   */
  private async downloadDirectoryAsZip(path: string): Promise<Buffer> {
    const apiBase = this.buildApiBase();
    const params = new URLSearchParams({
      path,
      download: 'true',
      recursionLevel: 'Full',
      'versionDescriptor.version': this.branch,
      'versionDescriptor.versionType': 'branch',
      'api-version': ADO_API_VERSION
    });
    // `$format` uses a dollar sign which URLSearchParams encodes as %24.
    // Appending it as a literal string is safe here since `$` is a valid
    // query-string character (RFC 3986 §3.4) and ADO requires the exact string.
    const requestUrl = `${apiBase}/items?${params.toString()}&$format=zip`;

    this.logger.debug(`[AzureDevOpsAdapter] Downloading directory "${path}" as ZIP`);
    return this.fetchBuffer(requestUrl);
  }

  // ---------------------------------------------------------------------------
  // Bundle discovery helpers
  // ---------------------------------------------------------------------------

  /**
   * Attempt to parse a deployment manifest from YAML or JSON text.
   * Returns `null` if the text cannot be parsed.
   * @param text - Raw file content
   * @param filename - Filename used to determine parse format
   */
  private parseManifest(text: string, filename: string): Record<string, unknown> | null {
    try {
      if (filename.endsWith('.json')) {
        return JSON.parse(text) as Record<string, unknown>;
      }
      return yaml.load(text) as Record<string, unknown>;
    } catch (err) {
      this.logger.warn(`[AzureDevOpsAdapter] Failed to parse manifest "${filename}": ${err}`);
      return null;
    }
  }

  /**
   * Try to load `deployment-manifest.yml`, `.yaml`, or `.json` from a directory.
   * Returns `{ manifest, filename }` for the first one found, or `null` if none exist.
   * @param dirPath - Repository path of the directory to check
   */
  private async loadManifestFromDir(dirPath: string): Promise<{ manifest: Record<string, unknown>; filename: string } | null> {
    const candidates = [
      `${dirPath}/deployment-manifest.yml`,
      `${dirPath}/deployment-manifest.yaml`,
      `${dirPath}/deployment-manifest.json`
    ];

    for (const candidate of candidates) {
      try {
        const content = await this.fetchFileContent(candidate);
        const manifest = this.parseManifest(content, candidate);
        if (manifest) {
          const filename = candidate.split('/').pop()!;
          return { manifest, filename };
        }
      } catch {
        // File not found — try next candidate
      }
    }
    return null;
  }

  /**
   * Build a `Bundle` object from a discovered manifest and directory path.
   * @param manifest - Parsed deployment manifest
   * @param dirPath - Repository path of the bundle directory
   * @param dirName - Basename of the bundle directory
   */
  private buildBundle(manifest: Record<string, unknown>, dirPath: string, dirName: string): Bundle {
    const { projectBaseUrl, repository } = this.parseAdoUrl();
    // dirPath already starts with '/', so concatenate directly to avoid double slashes
    const bundleId = `${projectBaseUrl}/${repository}${dirPath}`.replace(/https?:\/\//, '');

    return {
      id: bundleId,
      name: (manifest.name as string | undefined) ?? dirName,
      version: (manifest.version as string | undefined) ?? '1.0.0',
      description: (manifest.description as string | undefined) ?? '',
      author: (manifest.author as string | undefined) ?? '',
      sourceId: this.source.id,
      environments: (manifest.environments as string[] | undefined) ?? ['vscode'],
      tags: (manifest.tags as string[] | undefined) ?? [],
      lastUpdated: new Date().toISOString(),
      size: 'Unknown',
      dependencies: (manifest.dependencies as Bundle['dependencies'] | undefined) ?? [],
      license: (manifest.license as string | undefined) ?? 'Unknown',
      manifestUrl: this.getManifestUrl(bundleId),
      downloadUrl: this.getDownloadUrl(bundleId),
      repository: this.source.url
    };
  }

  /**
   * Decode a bundle ID back to the repository path of the bundle directory.
   * Bundle IDs are encoded as `{host}/{org}/{project}/{repo}{path}` with the
   * `https://` prefix stripped. The path always begins with `/`.
   * @param bundleId - Bundle identifier
   */
  private decodeBundleId(bundleId: string): string {
    const { projectBaseUrl, repository } = this.parseAdoUrl();
    // Prefix has no trailing slash; the path portion starts with '/'
    const prefix = `${projectBaseUrl}/${repository}`.replace(/https?:\/\//, '');
    if (bundleId.startsWith(prefix)) {
      return bundleId.substring(prefix.length); // keeps leading '/'
    }
    return `/${bundleId}`;
  }

  /**
   * Extract the bundle directory path from a download URL.
   * Used by `downloadBundle()` to recover the path from the stored URL.
   * @param downloadUrl - Download URL produced by `getDownloadUrl()`
   */
  private getBundlePathFromUrl(downloadUrl: string): string {
    try {
      const parsed = new URL(downloadUrl);
      const pathParam = parsed.searchParams.get('path');
      if (pathParam) {
        return pathParam;
      }
    } catch {
      // Fall through to default
    }
    return this.collectionsPath;
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
   * Scans the `collectionsPath` for subdirectories containing a
   * `deployment-manifest.yml` (or `.yaml` / `.json`) and returns a `Bundle`
   * for each one found.
   * @returns Array of discovered bundles
   */
  public async fetchBundles(): Promise<Bundle[]> {
    this.logger.info(
      `[AzureDevOpsAdapter] Fetching bundles from "${this.source.url}" `
      + `(branch: ${this.branch}, path: ${this.collectionsPath})`
    );

    try {
      const items = await this.listItems(this.collectionsPath);

      const directories = items.filter(
        (item) => item.isFolder && item.path !== this.collectionsPath && item.path !== '/'
      );

      this.logger.debug(`[AzureDevOpsAdapter] Found ${directories.length} candidate directories`);

      const bundles: Bundle[] = [];

      for (const dir of directories) {
        const result = await this.loadManifestFromDir(dir.path);
        if (result) {
          const dirName = dir.path.split('/').pop() ?? dir.path;
          const bundle = this.buildBundle(result.manifest, dir.path, dirName);
          bundles.push(bundle);
          this.logger.debug(`[AzureDevOpsAdapter] Found bundle: ${bundle.id} (${bundle.name} v${bundle.version})`);
        }
      }

      this.logger.info(`[AzureDevOpsAdapter] Discovered ${bundles.length} bundle(s)`);
      return bundles;
    } catch (error) {
      throw new Error(`Failed to fetch bundles from Azure DevOps: ${error}`);
    }
  }

  /**
   * Download a bundle from Azure DevOps as a ZIP archive.
   * @param bundle - Bundle to download
   * @returns Buffer containing the ZIP archive
   */
  public async downloadBundle(bundle: Bundle): Promise<Buffer> {
    this.logger.info(`[AzureDevOpsAdapter] Downloading bundle: ${bundle.id}`);
    try {
      const bundlePath = this.getBundlePathFromUrl(bundle.downloadUrl);
      return await this.downloadDirectoryAsZip(bundlePath);
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
   * Get the deployment manifest URL for a bundle.
   * @param bundleId - Bundle identifier (encodes the repository path)
   * @param _version - Not used; ADO uses branch-based versioning
   * @returns URL string for the manifest item
   */
  public getManifestUrl(bundleId: string, _version?: string): string {
    const apiBase = this.buildApiBase();
    const bundlePath = this.decodeBundleId(bundleId);
    const params = new URLSearchParams({
      path: `${bundlePath}/deployment-manifest.yml`,
      'versionDescriptor.version': this.branch,
      'api-version': ADO_API_VERSION
    });
    return `${apiBase}/items?${params.toString()}`;
  }

  /**
   * Get the download URL for a bundle.
   *
   * The download URL encodes the bundle directory path so that `downloadBundle()`
   * can reconstruct the path when fetching the ZIP.
   * @param bundleId - Bundle identifier (encodes the repository path)
   * @param _version - Not used; ADO uses branch-based versioning
   * @returns Download URL string
   */
  public getDownloadUrl(bundleId: string, _version?: string): string {
    const apiBase = this.buildApiBase();
    const bundlePath = this.decodeBundleId(bundleId);
    const params = new URLSearchParams({
      path: bundlePath,
      download: 'true',
      recursionLevel: 'Full',
      'versionDescriptor.version': this.branch,
      'api-version': ADO_API_VERSION
    });
    return `${apiBase}/items?${params.toString()}&$format=zip`;
  }
}

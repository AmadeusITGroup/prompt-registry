/* eslint-disable @typescript-eslint/member-ordering --
 * Methods are grouped by role (public IRepositoryAdapter surface first,
 * then discovery/parsing, item resolution, archive creation, HTTP/auth)
 * rather than access modifier, which makes this large adapter easier to read.
 */
/**
 * Awesome Copilot Plugin Adapter
 *
 * Adapter for `github/awesome-copilot`–style repositories that use the new
 * plugin format (post PR #717). Discovers `plugins/<id>/.github/plugin/plugin.json`
 * files and exposes them as Prompt Registry bundles.
 *
 * Pure helpers and shared types live in `./plugin-adapter-shared.ts`.
 */

import {
  exec,
} from 'node:child_process';
import * as https from 'node:https';
import {
  promisify,
} from 'node:util';
import archiver from 'archiver';
import * as vscode from 'vscode';
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
  calculateBreakdown,
  createDeploymentManifest,
  derivePluginItems,
  deriveSimpleItemId,
  inferEnvironments,
  PluginItem,
  PluginManifest,
  ResolvedPluginFile,
  stripLeadingDotSlash,
  stripMdExtension,
  toYaml,
} from './plugin-adapter-shared';
import {
  RepositoryAdapter,
} from './repository-adapter';

const execAsync = promisify(exec);

/** GitHub `/contents` API directory listing entry. */
interface GitHubContent {
  name: string;
  path: string;
  type: 'file' | 'dir';
  // eslint-disable-next-line @typescript-eslint/naming-convention -- GitHub API field
  download_url: string;
}

/** AwesomeCopilotPluginAdapter configuration. */
export interface AwesomeCopilotPluginConfig {
  /** Branch name (default: `main`). */
  branch?: string;
  /** Plugins directory (default: `plugins`). */
  pluginsPath?: string;
}

/**
 * Remote adapter for awesome-copilot plugin format repositories.
 */
export class AwesomeCopilotPluginAdapter extends RepositoryAdapter {
  public readonly type = 'awesome-copilot-plugin';
  protected logger: Logger;

  private readonly config: Required<AwesomeCopilotPluginConfig>;
  private readonly pluginsCache: Map<string, { bundles: Bundle[]; timestamp: number }> = new Map();
  private static readonly CACHE_TTL_MS = 5 * 60 * 1000;
  private static readonly FETCH_CONCURRENCY = 5;
  private static readonly MAX_REDIRECTS = 10;

  private authToken: string | undefined;
  private authMethod: 'vscode' | 'gh-cli' | 'explicit' | 'none' = 'none';

  constructor(source: RegistrySource) {
    super(source);
    this.logger = Logger.getInstance();

    const userConfig = (source as any).config || {};
    this.config = {
      branch: userConfig.branch || 'main',
      pluginsPath: userConfig.pluginsPath || 'plugins'
    };

    this.logger.info(`AwesomeCopilotPluginAdapter initialized for: ${source.url}`);
  }

  // ===== IRepositoryAdapter =====

  public async fetchBundles(): Promise<Bundle[]> {
    this.logger.debug('Listing bundles from awesome-copilot plugin repository');

    const cacheKey = `${this.source.url}-${this.config.branch}`;
    const cached = this.pluginsCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < AwesomeCopilotPluginAdapter.CACHE_TTL_MS) {
      this.logger.debug('Using cached plugins');
      return cached.bundles;
    }

    try {
      const pluginDirs = await this.listPluginDirectories();
      this.logger.debug(`Found ${pluginDirs.length} plugin directories`);

      const bundles: Bundle[] = [];
      const { FETCH_CONCURRENCY } = AwesomeCopilotPluginAdapter;

      for (let i = 0; i < pluginDirs.length; i += FETCH_CONCURRENCY) {
        const chunk = pluginDirs.slice(i, i + FETCH_CONCURRENCY);
        const chunkResults = await Promise.all(chunk.map(async (dir) => {
          try {
            return await this.parsePlugin(dir);
          } catch (error) {
            this.logger.warn(`Failed to parse plugin ${dir}:`, error as Error);
            return null;
          }
        }));
        for (const bundle of chunkResults) {
          if (bundle) {
            bundles.push(bundle);
          }
        }
      }

      this.pluginsCache.set(cacheKey, { bundles, timestamp: Date.now() });
      return bundles;
    } catch (error) {
      this.logger.error('Failed to list bundles', error as Error);
      throw new Error(`Failed to list awesome-copilot plugins: ${(error as Error).message}`);
    }
  }

  public async downloadBundle(bundle: Bundle): Promise<Buffer> {
    this.logger.debug(`Downloading bundle: ${bundle.id}`);

    try {
      const pluginDir = (bundle as any).pluginDir || bundle.id;
      const pluginItems: PluginItem[] = (bundle as any).pluginItems || [];

      if (pluginItems.length === 0) {
        const pluginJsonUrl = this.buildRawUrl(`${this.config.pluginsPath}/${pluginDir}/.github/plugin/plugin.json`);
        const jsonContent = await this.fetchUrl(pluginJsonUrl);
        const manifest = JSON.parse(jsonContent) as PluginManifest;
        pluginItems.push(...derivePluginItems(manifest));
      }

      const resolved = await this.resolveItemsToFiles(pluginDir, pluginItems);
      this.logger.debug(`Resolved ${pluginItems.length} items into ${resolved.length} deployable files`);

      const buffer = await this.createBundleArchive(bundle, resolved);
      this.logger.debug(`Archive created: ${buffer.length} bytes`);
      return buffer;
    } catch (error) {
      this.logger.error('Failed to download bundle', error as Error);
      throw new Error(`Failed to download bundle: ${(error as Error).message}`);
    }
  }

  public async fetchMetadata(): Promise<SourceMetadata> {
    try {
      const { owner, repo } = this.parseGitHubUrl();
      const pluginDirs = await this.listPluginDirectories();

      return {
        name: `${owner}/${repo}`,
        description: `Awesome Copilot plugins from ${this.source.url}`,
        bundleCount: pluginDirs.length,
        lastUpdated: new Date().toISOString(),
        version: '1.0.0'
      };
    } catch (error) {
      throw new Error(`Failed to fetch metadata: ${(error as Error).message}`);
    }
  }

  public getManifestUrl(bundleId: string, _version?: string): string {
    return this.buildRawUrl(`${this.config.pluginsPath}/${bundleId}/.github/plugin/plugin.json`);
  }

  public getDownloadUrl(bundleId: string, version?: string): string {
    return this.getManifestUrl(bundleId, version);
  }

  public async validate(): Promise<ValidationResult> {
    try {
      const apiUrl = this.buildApiUrl(this.config.pluginsPath);
      const content = await this.fetchUrl(apiUrl);
      const files = JSON.parse(content) as GitHubContent[];
      const pluginDirs = files.filter((f) => f.type === 'dir');

      if (pluginDirs.length === 0) {
        return {
          valid: false,
          errors: ['No plugin directories found in plugins directory'],
          warnings: [],
          bundlesFound: 0
        };
      }

      return { valid: true, errors: [], warnings: [], bundlesFound: pluginDirs.length };
    } catch (error) {
      return {
        valid: false,
        errors: [`Failed to validate repository: ${(error as Error).message}`],
        warnings: [],
        bundlesFound: 0
      };
    }
  }

  public async forceAuthentication(): Promise<void> {
    this.logger.info('[AwesomeCopilotPluginAdapter] Forcing re-authentication...');
    this.authToken = undefined;
    this.authMethod = 'none';

    try {
      const session = await vscode.authentication.getSession('github', ['repo'], {
        forceNewSession: true
      });
      if (session) {
        this.authToken = session.accessToken;
        this.authMethod = 'vscode';
        this.logger.info('[AwesomeCopilotPluginAdapter] Re-authentication successful');
      }
    } catch (error) {
      this.logger.error(`[AwesomeCopilotPluginAdapter] Re-authentication failed: ${error}`);
      throw error;
    }
  }

  // ===== Discovery / parsing =====

  private async listPluginDirectories(): Promise<string[]> {
    const apiUrl = this.buildApiUrl(this.config.pluginsPath);
    const content = await this.fetchUrl(apiUrl);
    const files = JSON.parse(content) as GitHubContent[];
    return files.filter((f) => f.type === 'dir').map((f) => f.name);
  }

  private async parsePlugin(pluginDir: string): Promise<Bundle | null> {
    try {
      const pluginJsonUrl = this.buildRawUrl(
        `${this.config.pluginsPath}/${pluginDir}/.github/plugin/plugin.json`
      );
      const jsonContent = await this.fetchUrl(pluginJsonUrl);
      const manifest = JSON.parse(jsonContent) as PluginManifest;

      const pluginId = manifest.id || manifest.name || pluginDir;
      if (!pluginId) {
        this.logger.warn(`Skipping plugin with missing id/name in ${pluginDir}`);
        return null;
      }
      if (manifest.external) {
        this.logger.debug(`Skipping external plugin: ${manifest.id}`);
        return null;
      }

      const items = derivePluginItems(manifest);
      const breakdown = calculateBreakdown(items);
      const tags = manifest.tags || manifest.keywords || [];

      const bundle: Bundle = {
        id: pluginId,
        name: manifest.name || pluginDir,
        version: manifest.version || '1.0.0',
        description: manifest.description,
        author: manifest.author?.name || this.extractRepoOwner(),
        repository: manifest.repository || this.source.url,
        tags,
        environments: inferEnvironments(tags),
        sourceId: this.source.id,
        manifestUrl: pluginJsonUrl,
        downloadUrl: pluginJsonUrl,
        lastUpdated: new Date().toISOString(),
        size: `${(manifest.itemCount && manifest.itemCount > 0) ? manifest.itemCount : items.length} items`,
        dependencies: [],
        license: manifest.license || 'MIT'
      };

      (bundle as any).pluginDir = pluginDir;
      (bundle as any).pluginItems = items;
      (bundle as any).breakdown = breakdown;

      return bundle;
    } catch (error) {
      this.logger.error(`Failed to parse plugin ${pluginDir}`, error as Error);
      return null;
    }
  }

  // ===== Item resolution (upstream directory refs -> concrete files) =====

  private async resolveItemsToFiles(
    pluginDir: string,
    items: PluginItem[]
  ): Promise<ResolvedPluginFile[]> {
    const resolved: ResolvedPluginFile[] = [];
    for (const item of items) {
      try {
        if (item.kind === 'skill') {
          resolved.push(...(await this.resolveSkillItem(pluginDir, item.path)));
        } else if (item.kind === 'agent') {
          resolved.push(...(await this.resolveAgentItem(pluginDir, item.path)));
        } else {
          resolved.push(this.resolveSimpleFileItem(pluginDir, item));
        }
      } catch (error) {
        this.logger.warn(`Failed to resolve item ${item.kind}:${item.path}: ${(error as Error).message}`);
      }
    }
    return resolved;
  }

  private async resolveSkillItem(pluginDir: string, itemPath: string): Promise<ResolvedPluginFile[]> {
    const skillDirPath = this.resolveItemPath(pluginDir, itemPath);
    const relativeDirPath = this.relativizeToPluginRoot(pluginDir, skillDirPath);
    const skillName = relativeDirPath.split('/').pop() || 'skill';

    const allFiles = await this.listDirectoryContentsRecursively(skillDirPath);
    if (allFiles.length === 0) {
      this.logger.warn(`Skill directory empty or inaccessible: ${skillDirPath}`);
      return [];
    }

    return [{
      kind: 'skill',
      id: skillName,
      entryFile: `${relativeDirPath}/SKILL.md`,
      files: allFiles.map((p) => ({
        sourcePath: p,
        archivePath: this.relativizeToPluginRoot(pluginDir, p)
      }))
    }];
  }

  private async resolveAgentItem(pluginDir: string, itemPath: string): Promise<ResolvedPluginFile[]> {
    const agentPath = this.resolveItemPath(pluginDir, itemPath);

    // Case 1: specific .md file
    if (agentPath.endsWith('.md')) {
      const relativePath = this.relativizeToPluginRoot(pluginDir, agentPath);
      const filename = relativePath.split('/').pop() || 'agent.md';
      return [{
        kind: 'agent',
        id: stripMdExtension(filename),
        entryFile: relativePath,
        files: [{ sourcePath: agentPath, archivePath: relativePath }]
      }];
    }

    // Case 2 & 3: directory — list top-level contents to decide
    const contents = await this.listDirectoryContents(agentPath);
    if (contents.length === 0) {
      this.logger.warn(`Agent directory empty or inaccessible: ${agentPath}`);
      return [];
    }

    // Case 2: directory contains AGENT.md — treat as one agent
    const agentMdEntry = contents.find((c) => c.type === 'file' && c.name.toLowerCase() === 'agent.md');
    if (agentMdEntry) {
      const agentDirRelPath = this.relativizeToPluginRoot(pluginDir, agentPath);
      const agentName = agentDirRelPath.split('/').pop() || 'agent';
      const allFiles = await this.listDirectoryContentsRecursively(agentPath);
      return [{
        kind: 'agent',
        id: agentName,
        entryFile: `${agentDirRelPath}/${agentMdEntry.name}`,
        files: allFiles.map((p) => ({
          sourcePath: p,
          archivePath: this.relativizeToPluginRoot(pluginDir, p)
        }))
      }];
    }

    // Case 3: flat directory of .md files — one agent per file
    const relativeDirPath = this.relativizeToPluginRoot(pluginDir, agentPath);
    const mdFiles = contents.filter((c) =>
      c.type === 'file'
      && c.name.toLowerCase().endsWith('.md')
      && c.name.toLowerCase() !== 'readme.md'
    );
    return mdFiles.map((f) => {
      const archivePath = `${relativeDirPath}/${f.name}`;
      return {
        kind: 'agent' as const,
        id: stripMdExtension(f.name),
        entryFile: archivePath,
        files: [{ sourcePath: f.path, archivePath }]
      };
    });
  }

  private resolveSimpleFileItem(pluginDir: string, item: PluginItem): ResolvedPluginFile {
    const resolvedPath = this.resolveItemPath(pluginDir, item.path);
    const filename = resolvedPath.split('/').pop() || 'unknown.md';
    const archivePath = `prompts/${filename}`;
    return {
      kind: item.kind,
      id: deriveSimpleItemId(filename),
      entryFile: archivePath,
      files: [{ sourcePath: resolvedPath, archivePath }]
    };
  }

  private resolveItemPath(pluginDir: string, itemPath: string): string {
    return `${this.config.pluginsPath}/${pluginDir}/${stripLeadingDotSlash(itemPath)}`;
  }

  private relativizeToPluginRoot(pluginDir: string, repoPath: string): string {
    return repoPath.replace(`${this.config.pluginsPath}/${pluginDir}/`, '');
  }

  // ===== Archive creation =====

  private async createBundleArchive(
    bundle: Bundle,
    resolved: ResolvedPluginFile[]
  ): Promise<Buffer> {
    this.logger.debug(`Creating archive for plugin: ${bundle.name}`);

    return new Promise<Buffer>((resolve, reject) => {
      const archive = archiver('zip', { zlib: { level: 9 } });
      const chunks: Buffer[] = [];

      archive.on('data', (chunk: Buffer) => chunks.push(chunk));
      archive.on('finish', () => {
        const buffer = Buffer.concat(chunks);
        this.logger.debug(`Archive finalized: ${buffer.length} bytes`);
        resolve(buffer);
      });
      archive.on('error', (err: Error) => {
        this.logger.error('Archive error', err);
        reject(err);
      });
      archive.on('warning', (warning: Error) => {
        this.logger.warn('Archive warning', warning);
      });

      void (async () => {
        try {
          const manifest = createDeploymentManifest(bundle, resolved);
          archive.append(toYaml(manifest), { name: 'deployment-manifest.yml' });

          const addedPaths = new Set<string>();
          for (const res of resolved) {
            for (const file of res.files) {
              if (addedPaths.has(file.archivePath)) {
                continue;
              }
              addedPaths.add(file.archivePath);
              const fileUrl = this.buildRawUrl(file.sourcePath);
              const content = await this.fetchUrl(fileUrl);
              archive.append(content, { name: file.archivePath });
            }
          }
          await archive.finalize();
        } catch (error) {
          this.logger.error('Failed to create archive', error as Error);
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      })();
    });
  }

  // ===== HTTP + auth =====

  private buildApiUrl(apiPath: string): string {
    const { owner, repo } = this.parseGitHubUrl();
    return `https://api.github.com/repos/${owner}/${repo}/contents/${apiPath}?ref=${this.config.branch}`;
  }

  private buildRawUrl(rawPath: string): string {
    const { owner, repo } = this.parseGitHubUrl();
    return `https://raw.githubusercontent.com/${owner}/${repo}/${this.config.branch}/${rawPath}`;
  }

  private async listDirectoryContents(dirPath: string): Promise<GitHubContent[]> {
    try {
      const apiUrl = this.buildApiUrl(dirPath);
      const response = await this.fetchUrl(apiUrl);
      return JSON.parse(response) as GitHubContent[];
    } catch (error) {
      this.logger.warn(`Failed to list directory ${dirPath}: ${(error as Error).message}`);
      return [];
    }
  }

  private async listDirectoryContentsRecursively(dirPath: string): Promise<string[]> {
    const filePaths: string[] = [];
    try {
      const contents = await this.listDirectoryContents(dirPath);
      for (const item of contents) {
        if (item.type === 'file') {
          filePaths.push(item.path);
        } else if (item.type === 'dir') {
          filePaths.push(...(await this.listDirectoryContentsRecursively(item.path)));
        }
      }
    } catch (error) {
      this.logger.warn(`Failed to list directory ${dirPath}: ${(error as Error).message}`);
    }
    return filePaths;
  }

  private parseGitHubUrl(): { owner: string; repo: string } {
    const url = this.source.url.replace(/\.git$/, '');
    const match = url.match(/github\.com[/:]([^/]+)\/([^/]+)/);
    if (!match) {
      throw new Error(`Invalid GitHub URL: ${this.source.url}`);
    }
    return { owner: match[1], repo: match[2] };
  }

  private extractRepoOwner(): string {
    return this.parseGitHubUrl().owner;
  }

  private async getAuthenticationToken(): Promise<string | undefined> {
    if (this.authToken !== undefined) {
      return this.authToken;
    }

    this.logger.info('[AwesomeCopilotPluginAdapter] Attempting authentication...');

    try {
      const session = await vscode.authentication.getSession('github', ['repo'], { createIfNone: true });
      if (session) {
        this.authToken = session.accessToken;
        this.authMethod = 'vscode';
        this.logger.info('[AwesomeCopilotPluginAdapter] Using VSCode GitHub authentication');
        return this.authToken;
      }
    } catch (error) {
      this.logger.warn(`[AwesomeCopilotPluginAdapter] VSCode auth failed: ${error}`);
    }

    try {
      const { stdout } = await execAsync('gh auth token');
      const token = stdout.trim();
      if (token && token.length > 0) {
        this.authToken = token;
        this.authMethod = 'gh-cli';
        this.logger.info('[AwesomeCopilotPluginAdapter] Using gh CLI authentication');
        return this.authToken;
      }
    } catch (error) {
      this.logger.warn(`[AwesomeCopilotPluginAdapter] gh CLI auth failed: ${error}`);
    }

    const explicitToken = this.getAuthToken();
    if (explicitToken) {
      this.authToken = explicitToken;
      this.authMethod = 'explicit';
      this.logger.info('[AwesomeCopilotPluginAdapter] Using explicit token from configuration');
      return this.authToken;
    }

    this.authMethod = 'none';
    this.logger.warn('[AwesomeCopilotPluginAdapter] No authentication available');
    return undefined;
  }

  private async fetchUrl(url: string, redirectDepth = 0): Promise<string> {
    const { MAX_REDIRECTS } = AwesomeCopilotPluginAdapter;
    if (redirectDepth >= MAX_REDIRECTS) {
      throw new Error(`Maximum redirect depth (${MAX_REDIRECTS}) exceeded`);
    }

    const token = await this.getAuthenticationToken();
    const headers: Record<string, string> = {
      'User-Agent': 'VSCode-Prompt-Registry'
    };
    if (token) {
      headers.Authorization = `token ${token}`;
    }

    return new Promise((resolve, reject) => {
      https.get(url, { headers }, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          const redirectUrl = res.headers.location;
          if (redirectUrl) {
            this.fetchUrl(redirectUrl, redirectDepth + 1).then(resolve).catch(reject);
            return;
          }
        }

        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          if (res.statusCode === 200) {
            resolve(data);
          } else {
            let errorMsg = `HTTP ${res.statusCode}: ${res.statusMessage}`;
            switch (res.statusCode) {
              case 404: {
                errorMsg += ' - Not found. Check path and authentication.';
                break;
              }
              case 401: {
                errorMsg += ' - Authentication failed.';
                break;
              }
              case 403: {
                errorMsg += ' - Access forbidden.';
                break;
              }
            }
            reject(new Error(errorMsg));
          }
        });
      }).on('error', (error) => reject(error));
    });
  }
}

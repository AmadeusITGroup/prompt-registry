/* eslint-disable @typescript-eslint/member-ordering --
 * Methods are grouped by role (public IRepositoryAdapter surface first,
 * then discovery/parsing, item resolution, archive creation) rather than
 * access modifier, which makes this large adapter easier to read.
 */
/**
 * Local Awesome Copilot Plugin Adapter
 *
 * Adapter for local directories that use the awesome-copilot plugin format
 * (post PR #717). Discovers `plugins/<id>/.github/plugin/plugin.json` files
 * on the local filesystem and exposes them as Prompt Registry bundles.
 *
 * Directory Structure:
 * ```
 * /home/user/my-plugins/
 *   plugins/
 *     azure-cloud-development/
 *       .github/plugin/plugin.json
 *       agents/
 *       skills/
 *         azure-resource-health-diagnose/
 *           SKILL.md
 * ```
 *
 * Pure helpers and shared types live in `./plugin-adapter-shared.ts`.
 */

import * as fs from 'node:fs';
import {
  access,
  readdir,
  readFile,
  stat,
} from 'node:fs/promises';
import * as path from 'node:path';
import archiver from 'archiver';
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
  toPosixPath,
  toYaml,
} from './plugin-adapter-shared';
import {
  RepositoryAdapter,
} from './repository-adapter';

/** LocalAwesomeCopilotPluginAdapter configuration. */
export interface LocalAwesomeCopilotPluginConfig {
  /** Plugins directory relative to root (default: `plugins`). */
  pluginsPath?: string;
}

/**
 * Local adapter for awesome-copilot plugin format directories.
 */
export class LocalAwesomeCopilotPluginAdapter extends RepositoryAdapter {
  public readonly type = 'local-awesome-copilot-plugin';
  protected logger: Logger;

  private readonly config: Required<LocalAwesomeCopilotPluginConfig>;
  private readonly pluginsCache: Map<string, { bundles: Bundle[]; timestamp: number }> = new Map();
  private static readonly CACHE_TTL_MS = 5 * 60 * 1000;

  constructor(source: RegistrySource) {
    super(source);
    this.logger = Logger.getInstance();

    const userConfig = (source as any).config || {};
    this.config = {
      pluginsPath: userConfig.pluginsPath || 'plugins'
    };

    if (!this.isValidUrl(source.url)) {
      throw new Error(`Invalid local path: ${source.url}`);
    }

    this.logger.info(`LocalAwesomeCopilotPluginAdapter initialized for: ${source.url}`);
  }

  // ===== Public helpers =====

  public isValidUrl(url: string): boolean {
    return url.startsWith('file://')
      || path.isAbsolute(url)
      || url.startsWith('~/')
      || url.startsWith('./');
  }

  // ===== IRepositoryAdapter =====

  public async fetchBundles(): Promise<Bundle[]> {
    this.logger.debug('Listing bundles from local awesome-copilot plugin directory');

    const cacheKey = `${this.source.url}-${this.config.pluginsPath}`;
    const cached = this.pluginsCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < LocalAwesomeCopilotPluginAdapter.CACHE_TTL_MS) {
      this.logger.debug('Using cached plugins');
      return cached.bundles;
    }

    try {
      const pluginDirs = await this.listPluginDirectories();
      this.logger.debug(`Found ${pluginDirs.length} plugin directories`);

      const bundles: Bundle[] = [];
      for (const dir of pluginDirs) {
        try {
          const bundle = await this.parsePlugin(dir);
          if (bundle) {
            bundles.push(bundle);
          }
        } catch (error) {
          this.logger.warn(`Failed to parse plugin ${dir}:`, error as Error);
        }
      }

      this.pluginsCache.set(cacheKey, { bundles, timestamp: Date.now() });
      return bundles;
    } catch (error) {
      this.logger.error('Failed to list bundles', error as Error);
      throw new Error(`Failed to list local awesome-copilot plugins: ${(error as Error).message}`);
    }
  }

  public async downloadBundle(bundle: Bundle): Promise<Buffer> {
    this.logger.debug(`Downloading bundle: ${bundle.id}`);

    try {
      const pluginDir = (bundle as any).pluginDir || bundle.id;
      let pluginItems: PluginItem[] = (bundle as any).pluginItems || [];

      if (pluginItems.length === 0) {
        const pluginJsonPath = path.join(
          this.getPluginsPath(), pluginDir, '.github', 'plugin', 'plugin.json'
        );
        const jsonContent = await readFile(pluginJsonPath, 'utf8');
        const manifest = JSON.parse(jsonContent) as PluginManifest;
        pluginItems = derivePluginItems(manifest);
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
      const localPath = this.getLocalPath();
      const pluginDirs = await this.listPluginDirectories();
      const stats = await stat(localPath);

      return {
        name: path.basename(localPath),
        description: `Local Awesome Copilot plugins from ${localPath}`,
        bundleCount: pluginDirs.length,
        lastUpdated: stats.mtime.toISOString(),
        version: '1.0.0'
      };
    } catch (error) {
      throw new Error(`Failed to fetch metadata: ${(error as Error).message}`);
    }
  }

  public getManifestUrl(bundleId: string, _version?: string): string {
    return `file://${path.join(this.getPluginsPath(), bundleId, '.github', 'plugin', 'plugin.json')}`;
  }

  public getDownloadUrl(bundleId: string, version?: string): string {
    return this.getManifestUrl(bundleId, version);
  }

  public async validate(): Promise<ValidationResult> {
    try {
      const pluginsPath = this.getPluginsPath();
      if (!await this.directoryExists(pluginsPath)) {
        return {
          valid: false,
          errors: [`Plugins directory does not exist: ${pluginsPath}`],
          warnings: [],
          bundlesFound: 0
        };
      }

      const pluginDirs = await this.listPluginDirectories();
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
        errors: [`Failed to validate directory: ${(error as Error).message}`],
        warnings: [],
        bundlesFound: 0
      };
    }
  }

  // ===== Private helpers =====

  private getLocalPath(): string {
    let localPath = this.source.url;
    if (localPath.startsWith('file://')) {
      localPath = localPath.slice(7);
    }
    return path.normalize(localPath);
  }

  private getPluginsPath(): string {
    return path.join(this.getLocalPath(), this.config.pluginsPath);
  }

  private async directoryExists(dirPath: string): Promise<boolean> {
    try {
      await access(dirPath, fs.constants.R_OK);
      const stats = await stat(dirPath);
      return stats.isDirectory();
    } catch {
      return false;
    }
  }

  private async listPluginDirectories(): Promise<string[]> {
    const pluginsPath = this.getPluginsPath();

    if (!await this.directoryExists(pluginsPath)) {
      throw new Error(`Plugins directory does not exist: ${pluginsPath}`);
    }

    const entries = await readdir(pluginsPath, { withFileTypes: true });
    const dirs: string[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const pluginJsonPath = path.join(pluginsPath, entry.name, '.github', 'plugin', 'plugin.json');
      try {
        await access(pluginJsonPath, fs.constants.R_OK);
        dirs.push(entry.name);
      } catch {
        this.logger.debug(`Skipping directory ${entry.name}: no plugin.json found`);
      }
    }
    return dirs;
  }

  private async parsePlugin(pluginDir: string): Promise<Bundle | null> {
    try {
      const pluginJsonPath = path.join(
        this.getPluginsPath(), pluginDir, '.github', 'plugin', 'plugin.json'
      );
      const jsonContent = await readFile(pluginJsonPath, 'utf8');
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
      const stats = await stat(pluginJsonPath);
      const tags = manifest.tags || manifest.keywords || [];

      const bundle: Bundle = {
        id: pluginId,
        name: manifest.name || pluginDir,
        version: manifest.version || '1.0.0',
        description: manifest.description,
        author: manifest.author?.name || 'Local Developer',
        repository: this.source.url,
        tags,
        environments: inferEnvironments(tags),
        sourceId: this.source.id,
        manifestUrl: `file://${pluginJsonPath}`,
        downloadUrl: `file://${pluginJsonPath}`,
        lastUpdated: stats.mtime.toISOString(),
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

  private async resolveItemsToFiles(
    pluginDir: string,
    items: PluginItem[]
  ): Promise<ResolvedPluginFile[]> {
    const resolved: ResolvedPluginFile[] = [];
    const pluginBasePath = path.join(this.getLocalPath(), this.config.pluginsPath, pluginDir);

    for (const item of items) {
      try {
        if (item.kind === 'skill') {
          resolved.push(...(await this.resolveSkillItem(pluginBasePath, item.path)));
        } else if (item.kind === 'agent') {
          resolved.push(...(await this.resolveAgentItem(pluginBasePath, item.path)));
        } else {
          resolved.push(this.resolveSimpleFileItem(pluginBasePath, item));
        }
      } catch (error) {
        this.logger.warn(`Failed to resolve item ${item.kind}:${item.path}: ${(error as Error).message}`);
      }
    }
    return resolved;
  }

  private async resolveSkillItem(pluginBasePath: string, itemPath: string): Promise<ResolvedPluginFile[]> {
    const relativeDirPath = stripLeadingDotSlash(itemPath);
    const skillDirAbs = path.join(pluginBasePath, relativeDirPath);
    const skillName = relativeDirPath.split('/').pop() || 'skill';

    if (!await this.directoryExists(skillDirAbs)) {
      this.logger.warn(`Skill directory not found: ${skillDirAbs}`);
      return [];
    }

    const allFiles = await this.listFilesRecursively(skillDirAbs);
    if (allFiles.length === 0) {
      return [];
    }

    return [{
      kind: 'skill',
      id: skillName,
      entryFile: `${relativeDirPath}/SKILL.md`,
      files: allFiles.map((absPath) => ({
        sourcePath: absPath,
        archivePath: toPosixPath(path.join(relativeDirPath, path.relative(skillDirAbs, absPath)))
      }))
    }];
  }

  private async resolveAgentItem(pluginBasePath: string, itemPath: string): Promise<ResolvedPluginFile[]> {
    const relativePath = stripLeadingDotSlash(itemPath);
    const agentPathAbs = path.join(pluginBasePath, relativePath);

    // Case 1: path points to a specific .md file
    if (relativePath.endsWith('.md')) {
      try {
        await access(agentPathAbs);
      } catch {
        this.logger.warn(`Agent file not found: ${agentPathAbs}`);
        return [];
      }
      const filename = path.basename(relativePath);
      const archivePath = toPosixPath(relativePath);
      return [{
        kind: 'agent',
        id: stripMdExtension(filename),
        entryFile: archivePath,
        files: [{ sourcePath: agentPathAbs, archivePath }]
      }];
    }

    // Case 2 & 3: directory
    if (!await this.directoryExists(agentPathAbs)) {
      this.logger.warn(`Agent directory not found: ${agentPathAbs}`);
      return [];
    }

    const entries = await readdir(agentPathAbs, { withFileTypes: true });

    // Case 2: directory containing AGENT.md — treat as one agent
    const agentMdEntry = entries.find((e) => e.isFile() && e.name.toLowerCase() === 'agent.md');
    if (agentMdEntry) {
      const agentName = relativePath.split('/').pop() || 'agent';
      const allFiles = await this.listFilesRecursively(agentPathAbs);
      return [{
        kind: 'agent',
        id: agentName,
        entryFile: toPosixPath(path.join(relativePath, agentMdEntry.name)),
        files: allFiles.map((absPath) => ({
          sourcePath: absPath,
          archivePath: toPosixPath(path.join(relativePath, path.relative(agentPathAbs, absPath)))
        }))
      }];
    }

    // Case 3: flat directory of .md files — one agent per file
    const mdFiles = entries.filter((e) =>
      e.isFile()
      && e.name.toLowerCase().endsWith('.md')
      && e.name.toLowerCase() !== 'readme.md'
    );

    return mdFiles.map((e) => {
      const archivePath = toPosixPath(path.join(relativePath, e.name));
      return {
        kind: 'agent' as const,
        id: stripMdExtension(e.name),
        entryFile: archivePath,
        files: [{ sourcePath: path.join(agentPathAbs, e.name), archivePath }]
      };
    });
  }

  private resolveSimpleFileItem(pluginBasePath: string, item: PluginItem): ResolvedPluginFile {
    const relativePath = stripLeadingDotSlash(item.path);
    const sourcePath = path.join(pluginBasePath, relativePath);
    const filename = path.basename(relativePath);
    const archivePath = `prompts/${filename}`;
    return {
      kind: item.kind,
      id: deriveSimpleItemId(filename),
      entryFile: archivePath,
      files: [{ sourcePath, archivePath }]
    };
  }

  private async listFilesRecursively(dirAbsPath: string): Promise<string[]> {
    const out: string[] = [];
    const entries = await readdir(dirAbsPath, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(dirAbsPath, entry.name);
      if (entry.isFile()) {
        out.push(entryPath);
      } else if (entry.isDirectory()) {
        out.push(...(await this.listFilesRecursively(entryPath)));
      }
    }
    return out;
  }

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

      // Append manifest + files, then finalize.
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
              try {
                const content = await readFile(file.sourcePath);
                archive.append(content, { name: file.archivePath });
              } catch (error) {
                this.logger.warn(`Failed to read ${file.sourcePath}: ${(error as Error).message}`);
              }
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
}

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  promisify,
} from 'node:util';
import * as vscode from 'vscode';
import * as yauzl from 'yauzl';
import {
  BundleInfo,
} from '../types/github';
import {
  InstallationScope,
  Platform,
} from '../types/platform';
import {
  Logger,
} from '../utils/logger';
import {
  PlatformDetector,
} from './platform-detector';

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const mkdir = promisify(fs.mkdir);
const access = promisify(fs.access);
const unlink = promisify(fs.unlink);
// const rmdir = promisify(fs.rmdir); // Deprecated - using fs.promises.rmdir directly

/**
 * Installation result information
 */
export interface InstallationResult {
  success: boolean;
  installedPath: string;
  installedFiles: string[];
  version: string;
  scope: InstallationScope;
  platform: Platform;
  error?: string;
}

/**
 * Service for managing Prompt Registry component installations
 */
export class InstallationManager {
  private static instance: InstallationManager;

  public static getInstance(): InstallationManager {
    if (!InstallationManager.instance) {
      InstallationManager.instance = new InstallationManager();
    }
    return InstallationManager.instance;
  }

  private readonly logger: Logger;
  private readonly platformDetector: PlatformDetector;

  private constructor() {
    this.logger = Logger.getInstance();
    this.platformDetector = PlatformDetector.getInstance();
  }

  /**
   * Helper method to remove a directory if it's empty
   * @param dirPath - The directory path to check and potentially remove
   */
  private async removeIfEmpty(dirPath: string): Promise<void> {
    try {
      // Check if directory exists
      await access(dirPath);

      // Read directory contents
      const files = await fs.promises.readdir(dirPath);

      if (files.length === 0) {
        // Directory is empty, remove it
        await fs.promises.rmdir(dirPath);
        this.logger.info(`Removed empty directory: ${dirPath}`);
      } else {
        this.logger.debug(`Directory not empty, keeping: ${dirPath} (${files.length} items)`);
      }
    } catch (error) {
      if ((error as any).code === 'ENOENT') {
        this.logger.debug(`Directory does not exist: ${dirPath}`);
      } else if ((error as any).code === 'ENOTEMPTY') {
        this.logger.debug(`Directory not empty: ${dirPath}`);
      } else {
        this.logger.debug(`Failed to check/remove directory: ${dirPath}`, error as Error);
      }
    }
  }

  /**
   * Recursively remove empty parent directories up to a root path
   * @param dirPath - Starting directory path
   * @param rootPath - Root path to stop at (won't remove this)
   */
  private async removeEmptyParentsRecursively(dirPath: string, rootPath: string): Promise<void> {
    if (dirPath === rootPath || dirPath === path.dirname(dirPath)) {
      return; // Reached root or filesystem root
    }

    try {
      await access(dirPath);
      const files = await fs.promises.readdir(dirPath);

      if (files.length === 0) {
        await fs.promises.rmdir(dirPath);
        this.logger.info(`Removed empty parent directory: ${dirPath}`);

        // Recursively check parent directory
        const parentDir = path.dirname(dirPath);
        await this.removeEmptyParentsRecursively(parentDir, rootPath);
      }
    } catch (error) {
      // Directory doesn't exist or can't be read/removed - stop recursion
      this.logger.debug(`Stopped recursive removal at: ${dirPath}`, error as Error);
    }
  }

  private async ensureDirectoryExists(dirPath: string): Promise<void> {
    try {
      await access(dirPath);
    } catch {
      await mkdir(dirPath, { recursive: true });
      this.logger.debug(`Created directory: ${dirPath}`);
    }
  }

  private async extractBundle(
    bundleBuffer: Buffer,
    extractPath: string,
    onProgress?: (progress: number, message: string) => void
  ): Promise<string[]> {
    return new Promise((resolve, reject) => {
      const extractedFiles: string[] = [];
      let processedEntries = 0;
      let totalEntries = 0;

      yauzl.fromBuffer(bundleBuffer, { lazyEntries: true }, (err: Error | null, zipfile?: yauzl.ZipFile) => {
        if (err) {
          reject(err);
          return;
        }

        if (!zipfile) {
          reject(new Error('Failed to open zip file'));
          return;
        }

        totalEntries = zipfile.entryCount;
        this.logger.debug(`Extracting ${totalEntries} entries from bundle to ${extractPath}`);

        zipfile.readEntry();

        zipfile.on('entry', (entry: yauzl.Entry) => {
          const fileName = entry.fileName;

          // Skip directories
          if (fileName.endsWith('/')) {
            processedEntries++;
            zipfile.readEntry();
            return;
          }

          // Skip common hidden files but allow important dot directories like .github
          const isHiddenFile = fileName.startsWith('.')
            && !fileName.startsWith('.github/')
            && !fileName.startsWith('.vscode/')
            && !fileName.startsWith('.windsurf/')
            && !fileName.startsWith('.kiro/')
            && !fileName.startsWith('.cursor/');

          if (isHiddenFile) {
            processedEntries++;
            zipfile.readEntry();
            return;
          }

          const outputPath = path.join(extractPath, fileName);
          const outputDir = path.dirname(outputPath);

          // Ensure output directory exists
          fs.mkdir(outputDir, { recursive: true }, (mkdirErr) => {
            if (mkdirErr) {
              reject(mkdirErr);
              return;
            }

            zipfile.openReadStream(entry, (streamErr: Error | null, readStream?: NodeJS.ReadableStream) => {
              if (streamErr) {
                reject(streamErr);
                return;
              }

              if (!readStream) {
                reject(new Error('Failed to open read stream'));
                return;
              }

              const writeStream = fs.createWriteStream(outputPath);

              readStream.pipe(writeStream);

              writeStream.on('close', () => {
                extractedFiles.push(fileName);
                processedEntries++;

                // Update progress
                const progress = 20 + (processedEntries / totalEntries) * 60; // 20-80% for extraction
                onProgress?.(progress, `Extracting: ${fileName}`);

                this.logger.debug(`Extracted: ${fileName}`);

                if (processedEntries === totalEntries) {
                  resolve(extractedFiles);
                } else {
                  zipfile.readEntry();
                }
              });

              writeStream.on('error', (writeErr) => {
                reject(writeErr);
              });
            });
          });
        });

        zipfile.on('end', () => {
          if (processedEntries === totalEntries) {
            resolve(extractedFiles);
          }
        });

        zipfile.on('error', (zipErr: Error) => {
          reject(zipErr);
        });
      });
    });
  }

  private async createInstallationMetadata(
    metadataPath: string,
    bundleInfo: BundleInfo,
    scope: InstallationScope,
    platform: Platform,
    installedFiles: string[],
    extractionPath: string
  ): Promise<void> {
    const metadata = {
      version: bundleInfo.version,
      platform: platform,
      scope: scope,
      installedAt: new Date().toISOString(),
      bundleInfo: {
        filename: bundleInfo.filename,
        size: bundleInfo.size,
        platform: bundleInfo.platform
      },
      installedFiles: installedFiles,
      extractionPath: extractionPath
    };

    const metadataFilePath = path.join(metadataPath, '.prompt-registry-metadata.json');
    await writeFile(metadataFilePath, JSON.stringify(metadata, null, 2));

    this.logger.debug(`Created installation metadata at: ${metadataFilePath}`);
  }

  private async readInstallationMetadata(installationPath: string): Promise<any> {
    const metadataPath = path.join(installationPath, '.prompt-registry-metadata.json');
    const metadataContent = await readFile(metadataPath, 'utf8');
    return JSON.parse(metadataContent);
  }

  private async updatePlatformConfiguration(
    platform: Platform,
    scope: InstallationScope,
    installationPath: string
  ): Promise<void> {
    try {
      // Platform-specific configuration updates
      switch (platform) {
        case Platform.VSCODE: {
          await this.updateVSCodeConfiguration(scope, installationPath);
          break;
        }
        case Platform.WINDSURF: {
          await this.updateWindsurfConfiguration(scope, installationPath);
          break;
        }
        case Platform.KIRO: {
          await this.updateKiroConfiguration(scope, installationPath);
          break;
        }
        case Platform.CURSOR: {
          await this.updateCursorConfiguration(scope, installationPath);
          break;
        }
        default: {
          this.logger.debug('No platform-specific configuration updates needed');
        }
      }
    } catch (error) {
      this.logger.warn('Failed to update platform configuration', error as Error);
      // Don't fail the installation for configuration updates
    }
  }

  private async updateVSCodeConfiguration(scope: InstallationScope, _installationPath: string): Promise<void> {
    // Add VSCode-specific configuration updates here
    this.logger.debug(`Updating VSCode configuration for scope: ${scope}`);
  }

  private async updateWindsurfConfiguration(scope: InstallationScope, _installationPath: string): Promise<void> {
    // Add Windsurf-specific configuration updates here
    this.logger.debug(`Updating Windsurf configuration for scope: ${scope}`);
  }

  private async updateKiroConfiguration(scope: InstallationScope, _installationPath: string): Promise<void> {
    // Add Kiro-specific configuration updates here
    this.logger.debug(`Updating Kiro configuration for scope: ${scope}`);
  }

  private async updateCursorConfiguration(scope: InstallationScope, _installationPath: string): Promise<void> {
    // Add Cursor-specific configuration updates here
    this.logger.debug(`Updating Cursor configuration for scope: ${scope}`);
  }

  /**
   * Install Prompt Registry components from a bundle
   * @param bundleBuffer
   * @param bundleInfo
   * @param scope
   * @param onProgress
   */
  public async installBundle(
    bundleBuffer: Buffer,
    bundleInfo: BundleInfo,
    scope: InstallationScope,
    onProgress?: (progress: number, message: string) => void
  ): Promise<InstallationResult> {
    try {
      this.logger.info(`Starting installation of ${bundleInfo.filename} with scope: ${scope}`);

      const platform = await this.platformDetector.detectPlatform();
      const metadataPath = this.platformDetector.getInstallationPath(platform.platform, scope);

      // For project scope, extract files to project root; for others use the standard path
      const extractionPath = scope === InstallationScope.PROJECT
        ? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || ''
        : metadataPath;

      // Update progress
      onProgress?.(10, 'Preparing installation directory...');

      // Ensure metadata directory exists
      await this.ensureDirectoryExists(metadataPath);

      // Ensure extraction directory exists (if different from metadata)
      if (extractionPath !== metadataPath) {
        await this.ensureDirectoryExists(extractionPath);
      }

      // Update progress
      onProgress?.(20, 'Extracting bundle...');

      // Extract bundle to the appropriate location
      const extractedFiles = await this.extractBundle(bundleBuffer, extractionPath, onProgress);

      // Update progress
      onProgress?.(80, 'Finalizing installation...');

      // Create installation metadata (always in metadata path)
      await this.createInstallationMetadata(metadataPath, bundleInfo, scope, platform.platform, extractedFiles, extractionPath);

      // Update progress
      onProgress?.(90, 'Updating configuration...');

      // Update platform-specific configuration if needed
      await this.updatePlatformConfiguration(platform.platform, scope, extractionPath);

      // Update progress
      onProgress?.(100, 'Installation completed successfully!');

      const result: InstallationResult = {
        success: true,
        installedPath: extractionPath,
        installedFiles: extractedFiles,
        version: bundleInfo.version,
        scope,
        platform: platform.platform
      };

      this.logger.info(`Installation completed successfully at: ${extractionPath}`);
      return result;
    } catch (error) {
      this.logger.error('Installation failed', error as Error);

      return {
        success: false,
        installedPath: '',
        installedFiles: [],
        version: bundleInfo.version,
        scope,
        platform: Platform.UNKNOWN,
        error: (error as Error).message
      };
    }
  }

  /**
   * Prune empty directories from the extraction path as well as the metadata folder
   * This method recursively removes empty directories after file removal to ensure
   * no installation remnants are left behind.
   * @param scope
   */
  public async pruneEmptyDirs(scope: InstallationScope): Promise<void> {
    this.logger.info(`Starting to prune empty directories for scope: ${scope}`);

    const platform = await this.platformDetector.detectPlatform();
    const installationPath = this.platformDetector.getInstallationPath(platform.platform, scope);

    // Check if installation exists
    try {
      await access(installationPath);
    } catch {
      this.logger.warn(`No installation found at: ${installationPath}`);
      return; // Nothing to prune
    }

    let extractionPath = installationPath;
    let installedFiles: string[] = [];

    // Read installation metadata to get extraction path and installed files
    try {
      const metadata = await this.readInstallationMetadata(installationPath);
      extractionPath = metadata.extractionPath ?? extractionPath;
      installedFiles = metadata.installedFiles || [];
      this.logger.info(`Extraction path: ${extractionPath}`);
      this.logger.info(`Files that were installed: ${installedFiles.length} files`);
    } catch {
      this.logger.warn('Could not read installation metadata for pruning');
    }

    // Collect all directories that contained files
    const directoriesToCheck = new Set<string>();

    // Add directories from installed files
    for (const file of installedFiles) {
      const filePath = path.join(extractionPath, file);
      let dir = path.dirname(filePath);

      // Add all parent directories up to the extraction path
      while (dir !== extractionPath && dir !== path.dirname(dir)) {
        directoriesToCheck.add(dir);
        dir = path.dirname(dir);
      }
    }

    // Also add the extraction path itself if it's different from installation path
    if (extractionPath !== installationPath) {
      directoriesToCheck.add(extractionPath);
    }

    // Convert to array and sort by depth (deepest first) for proper removal order
    const sortedDirectories = Array.from(directoriesToCheck).toSorted((a, b) => {
      const depthA = a.split(path.sep).length;
      const depthB = b.split(path.sep).length;
      return depthB - depthA; // Sort by depth, deepest first
    });

    this.logger.debug(`Checking ${sortedDirectories.length} directories for emptiness`);

    // Remove empty directories, starting from the deepest
    for (const dir of sortedDirectories) {
      await this.removeIfEmpty(dir);
    }

    // Finally, remove the installation/metadata directory if it's different from extraction path
    if (installationPath !== extractionPath) {
      // Remove metadata file first if it exists
      try {
        const metadataPath = path.join(installationPath, '.prompt-registry-metadata.json');
        await fs.promises.unlink(metadataPath);
        this.logger.info(`Removed metadata file: ${metadataPath}`);
      } catch {
        // Metadata file might not exist or already removed, which is fine
        this.logger.debug(`Metadata file not found or already removed: ${installationPath}`);
      }
      await this.removeIfEmpty(installationPath);
    }

    this.logger.info(`Completed pruning empty directories for scope: ${scope}`);
  }

  /**
   * Uninstall Prompt Registry components
   * @param scope
   */
  public async uninstall(scope: InstallationScope): Promise<boolean> {
    try {
      this.logger.info(`Starting uninstallation with scope: ${scope}`);

      const platform = await this.platformDetector.detectPlatform();
      const installationPath = this.platformDetector.getInstallationPath(platform.platform, scope);

      // Check if installation exists
      try {
        await access(installationPath);
      } catch {
        this.logger.warn(`No installation found at: ${installationPath}`);
        return true; // Nothing to uninstall
      }

      // Read installation metadata to get list of installed files
      let installedFiles: string[] = [];
      let extractionPath = installationPath;

      try {
        const metadata = await this.readInstallationMetadata(installationPath);
        installedFiles = metadata.installedFiles || [];
        this.logger.info(`Files to be removed: ${installedFiles.join(', ')}`);
        this.logger.info(`Extraction path from metadata: ${metadata.extractionPath}`);
        extractionPath = metadata.extractionPath ?? extractionPath;
      } catch {
        this.logger.warn('Could not read installation metadata, removing entire directory');
      }

      // Remove installed files
      if (installedFiles.length > 0) {
        for (const file of installedFiles) {
          try {
            await unlink(path.join(extractionPath, file));
          } catch (error) {
            this.logger.warn(`Failed to remove file: ${file}`, error as Error);
          }
        }
      }

      // Remove empty directories using the comprehensive pruning method
      await this.pruneEmptyDirs(scope);

      // Remove the installation path with metadata
      try {
        await access(installationPath);
        await fs.promises.rm(installationPath, { recursive: true });
      } catch (error) {
        this.logger.error(`It was not possible to remove the installation path: ${installationPath}`, error as Error);
      }

      this.logger.info(`Uninstallation completed successfully from: ${installationPath}`);
      return true;
    } catch (error) {
      this.logger.error('Uninstallation failed', error as Error);
      return false;
    }
  }

  /**
   * Get current installation information
   * @param scope
   */
  // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents -- union type kept for documentation clarity
  public async getInstallationInfo(scope: InstallationScope): Promise<any | null> {
    try {
      const platform = await this.platformDetector.detectPlatform();
      const installationPath = this.platformDetector.getInstallationPath(platform.platform, scope);

      return await this.readInstallationMetadata(installationPath);
    } catch {
      return null;
    }
  }

  /**
   * Check if Prompt Registry is installed in a specific scope
   * @param scope
   */
  public async isInstalled(scope: InstallationScope): Promise<boolean> {
    try {
      const platform = await this.platformDetector.detectPlatform();
      const installationPath = this.platformDetector.getInstallationPath(platform.platform, scope);
      const metadataPath = path.join(installationPath, '.prompt-registry-metadata.json');

      await access(metadataPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get all installation scopes where Prompt Registry is installed
   */
  public async getInstalledScopes(): Promise<InstallationScope[]> {
    const scopes = [InstallationScope.USER, InstallationScope.WORKSPACE, InstallationScope.PROJECT];
    const installedScopes: InstallationScope[] = [];

    for (const scope of scopes) {
      if (await this.isInstalled(scope)) {
        installedScopes.push(scope);
      }
    }

    return installedScopes;
  }
}

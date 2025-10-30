/**
 * Local filesystem adapter
 * Fetches bundles from local filesystem directories
 */

import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import * as yaml from 'js-yaml';
import { RepositoryAdapter } from './RepositoryAdapter';
import { Bundle, SourceMetadata, ValidationResult, RegistrySource } from '../types/registry';

// Promisified fs functions
const readdir = promisify(fs.readdir);
const readFile = promisify(fs.readFile);
const stat = promisify(fs.stat);
const access = promisify(fs.access);

/**
 * Local deployment manifest
 */
interface LocalManifest {
    id: string;
    name: string;
    version: string;
    description: string;
    author: string;
    environments: string[];
    tags: string[];
    size: string;
    dependencies: Array<{
        bundleId: string;
        versionRange: string;
        optional: boolean;
    }>;
    license: string;
}

/**
 * Local filesystem adapter implementation
 * Expects a directory structure with bundles in subdirectories
 */
export class LocalAdapter extends RepositoryAdapter {
    readonly type = 'local';

    constructor(source: RegistrySource) {
        super(source);
        
        if (!this.isValidUrl(source.url)) {
            throw new Error(`Invalid local path: ${source.url}`);
        }
    }

    /**
     * Get local directory path from file:// URL or direct path
     */
    private getLocalPath(): string {
        let localPath = this.source.url;
        
        // Handle file:// URL
        if (localPath.startsWith('file://')) {
            localPath = localPath.substring(7);
        }
        
        // Normalize path
        return path.normalize(localPath);
    }

    /**
     * Check if path is valid local filesystem path
     */
    isValidUrl(url: string): boolean {
        // Accept file:// URLs or absolute paths
        return url.startsWith('file://') || 
               path.isAbsolute(url) ||
               url.startsWith('~/') ||
               url.startsWith('./');
    }

    /**
     * Check if directory exists and is accessible
     */
    private async directoryExists(dirPath: string): Promise<boolean> {
        try {
            await access(dirPath, fs.constants.R_OK);
            const stats = await stat(dirPath);
            return stats.isDirectory();
        } catch {
            return false;
        }
    }

    /**
     * Read and parse JSON file
     */
    private async readJsonFile(filePath: string): Promise<any> {
        try {
            const content = await readFile(filePath, 'utf-8');
            return JSON.parse(content);
        } catch (error) {
            console.error(`[LocalAdapter] ✗ Failed to read JSON file: ${error}`);
            throw new Error(`Failed to read JSON file ${filePath}: ${error}`);
        }
    }

    /**
     * Read and parse YAML file
     */
    private async readYamlFile(filePath: string): Promise<any> {
        try {
            const content = await readFile(filePath, 'utf-8');
            return yaml.load(content);
        } catch (error) {
            console.error(`[LocalAdapter] ✗ Failed to read YAML file: ${error}`);
            throw new Error(`Failed to read YAML file ${filePath}: ${error}`);
        }
    }

    /**
     * Get list of bundle directories in local path
     */
    private async getBundleDirectories(): Promise<string[]> {
        const localPath = this.getLocalPath();

        console.log(`[LocalAdapter] Scanning directory: ${localPath}`);

        try {
            // Check if directory exists and is accessible
            try {
                await access(localPath, fs.constants.R_OK);
                console.log(`[LocalAdapter] ✓ Directory exists and is readable`);
            } catch (error) {
                console.error(`[LocalAdapter] ✗ Cannot access directory: ${error}`);
                throw new Error(`Cannot access local directory: ${localPath}`);
            }

            const entries = await readdir(localPath, { withFileTypes: true });
            console.log(`[LocalAdapter] Found ${entries.length} entries in directory`);
            
            const bundleDirs: string[] = [];

            for (const entry of entries) {
                console.log(`[LocalAdapter] Checking entry: ${entry.name} (isDirectory: ${entry.isDirectory()})`);
                
                if (entry.isDirectory()) {
                    const bundleDir = path.join(localPath, entry.name);
                    const manifestPath = path.join(bundleDir, 'deployment-manifest.yml');
                    
                    console.log(`[LocalAdapter]   Looking for manifest: ${manifestPath}`);
                    
                    // Check if manifest exists
                    try {
                        await access(manifestPath, fs.constants.R_OK);
                        console.log(`[LocalAdapter]   ✓ Found manifest, adding bundle: ${entry.name}`);
                        bundleDirs.push(bundleDir);
                    } catch {
                        console.log(`[LocalAdapter]   ✗ No manifest found, skipping`);
                        continue;
                    }
                } else {
                    console.log(`[LocalAdapter]   Skipping non-directory entry`);
                }
            }

            console.log(`[LocalAdapter] Discovered ${bundleDirs.length} valid bundles`);
            return bundleDirs;
        } catch (error) {
            console.error(`[LocalAdapter] Failed to read local directory: ${error}`);
            throw new Error(`Failed to read local directory: ${error}`);
        }
    }

    /**
     * Calculate directory size recursively
     */
    private async calculateDirectorySize(dirPath: string): Promise<number> {
        let totalSize = 0;

        try {
            const entries = await readdir(dirPath, { withFileTypes: true });

            for (const entry of entries) {
                const fullPath = path.join(dirPath, entry.name);
                
                if (entry.isFile()) {
                    const stats = await stat(fullPath);
                    totalSize += stats.size;
                } else if (entry.isDirectory()) {
                    totalSize += await this.calculateDirectorySize(fullPath);
                }
            }
        } catch (error) {
            // Ignore errors for inaccessible files
        }

        return totalSize;
    }

    /**
     * Format bytes to human-readable size
     */
    private formatSize(bytes: number): string {
        const units = ['B', 'KB', 'MB', 'GB'];
        let size = bytes;
        let unitIndex = 0;

        while (size >= 1024 && unitIndex < units.length - 1) {
            size /= 1024;
            unitIndex++;
        }

        return `${size.toFixed(2)} ${units[unitIndex]}`;
    }

    /**
     * Fetch repository metadata from local filesystem
     * Scans the local directory and reads registry.json if available.
     * 
     * @returns Promise resolving to SourceMetadata with directory info
     * @throws Error if directory doesn't exist or is not accessible
     */
    async fetchMetadata(): Promise<SourceMetadata> {
        try {
            const localPath = this.getLocalPath();
            const exists = await this.directoryExists(localPath);

            if (!exists) {
                throw new Error(`Directory does not exist: ${localPath}`);
            }

            const bundleDirs = await this.getBundleDirectories();
            
            // Try to read registry metadata if it exists
            const metadataPath = path.join(localPath, 'registry.json');
            let metadata = {
                name: path.basename(localPath),
                description: 'Local bundle registry',
                version: '1.0.0',
            };

            try {
                const registryData = await this.readJsonFile(metadataPath);
                metadata = {
                    name: registryData.name || metadata.name,
                    description: registryData.description || metadata.description,
                    version: registryData.version || metadata.version,
                };
            } catch {
                // Use default metadata if registry.json doesn't exist
            }

            // Get directory modification time
            const stats = await stat(localPath);

            return {
                name: metadata.name,
                description: metadata.description,
                bundleCount: bundleDirs.length,
                lastUpdated: stats.mtime.toISOString(),
                version: metadata.version,
            };
        } catch (error) {
            throw new Error(`Failed to fetch local registry metadata: ${error}`);
        }
    }

    /**
     * Fetch bundles from local filesystem
     * Scans subdirectories for deployment-manifest.yml files and creates Bundle objects.
     * 
     * @returns Promise resolving to array of Bundle objects found in local directory
     * @throws Error if directory is not accessible or manifest parsing fails
     */
    async fetchBundles(): Promise<Bundle[]> {
        try {
            const bundleDirs = await this.getBundleDirectories();
            const bundles: Bundle[] = [];

            for (const bundleDir of bundleDirs) {
                const manifestPath = path.join(bundleDir, 'deployment-manifest.yml');
                
                console.log(`[LocalAdapter] Reading manifest: ${manifestPath}`);
                
                try {
                    const manifest = await this.readYamlFile(manifestPath) as LocalManifest;
                    console.log(`[LocalAdapter] ✓ Parsed manifest for bundle: ${manifest.id} v${manifest.version}`);
                    const stats = await stat(bundleDir);
                    const size = await this.calculateDirectorySize(bundleDir);

                    // Create bundle entry
                    bundles.push({
                        id: manifest.id,
                        name: manifest.name,
                        version: manifest.version,
                        description: manifest.description,
                        author: manifest.author,
                        sourceId: this.source.id,
                        environments: manifest.environments || [],
                        tags: manifest.tags || [],
                        lastUpdated: stats.mtime.toISOString(),
                        size: manifest.size || this.formatSize(size),
                        dependencies: manifest.dependencies || [],
                        license: manifest.license || 'Unknown',
                        downloadUrl: `file://${bundleDir}`,
                        manifestUrl: `file://${manifestPath}`,
                    });
                } catch (error) {
                    console.error(`[LocalAdapter] ✗ Failed to load bundle from ${bundleDir}: ${error}`);
                    continue;
                }
            }

            return bundles;
        } catch (error) {
            throw new Error(`Failed to fetch bundles from local registry: ${error}`);
        }
    }

    /**
     * Validate local registry accessibility
     * Checks if the directory exists and contains at least one valid bundle.
     * 
     * @returns Promise resolving to ValidationResult with status and any warnings
     */
    async validate(): Promise<ValidationResult> {
        try {
            const localPath = this.getLocalPath();
            const exists = await this.directoryExists(localPath);

            if (!exists) {
                return {
                    valid: false,
                    errors: [`Directory does not exist: ${localPath}`],
                    warnings: [],
                };
            }

            // Try to read at least one bundle
            const bundleDirs = await this.getBundleDirectories();
            
            if (bundleDirs.length === 0) {
                return {
                    valid: true,
                    errors: [],
                    warnings: ['No bundles found in directory'],
                };
            }

            return {
                valid: true,
                errors: [],
                warnings: [],
            };
        } catch (error) {
            return {
                valid: false,
                errors: [`Local registry validation failed: ${error}`],
                warnings: [],
            };
        }
    }

    /**
     * Get manifest URL for a bundle
     * Returns a file:// URL pointing to the local deployment manifest.
     * 
     * @param bundleId - Bundle directory name
     * @param version - Optional version (not used for local bundles)
     * @returns file:// URL string pointing to deployment-manifest.yml
     */
    getManifestUrl(bundleId: string, version?: string): string {
        const localPath = this.getLocalPath();
        return `file://${path.join(localPath, bundleId, 'deployment-manifest.yml')}`;
    }

    /**
     * Get download URL for a bundle
     * Returns a file:// URL pointing to the local bundle directory.
     * 
     * @param bundleId - Bundle directory name
     * @param version - Optional version (not used for local bundles)
     * @returns file:// URL string pointing to bundle directory
     */
    getDownloadUrl(bundleId: string, version?: string): string {
        const localPath = this.getLocalPath();
        return `file://${path.join(localPath, bundleId)}`;
    }

    /**
     * Download a bundle (for local bundles, no actual download needed)
     * Local bundles are accessed directly from the filesystem, so this returns an empty buffer.
     * The installer can work directly with the local directory path.
     * 
     * @param bundle - Bundle object with local file:// path
     * @returns Promise resolving to empty Buffer (local bundles don't need downloading)
     */
    async downloadBundle(bundle: Bundle): Promise<Buffer> {
        // For local bundles, we don't actually need to download
        // The installer can work directly with the local directory
        // Return empty buffer as the download URL already points to the local path
        return Buffer.alloc(0);
    }
}

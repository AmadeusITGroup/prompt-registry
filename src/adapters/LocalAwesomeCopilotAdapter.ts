/**
 * Local Awesome Copilot Collection Adapter
 * 
 * Adapter for local awesome-copilot style collection repositories.
 * Discovers .collection.yml files from local filesystem and exposes them as Prompt Registry bundles.
 * 
 * This adapter is useful for developing and testing collections locally before publishing to GitHub.
 * 
 * Collection Format (same as AwesomeCopilotAdapter):
 * ```yaml
 * id: azure-cloud-development
 * name: Azure & Cloud Development
 * description: Comprehensive Azure cloud development tools...
 * tags: [azure, cloud, infrastructure]
 * items:
 *   - path: prompts/azure-resource-health.prompt.md
 *     kind: prompt
 *   - path: instructions/bicep-best-practices.instructions.md
 *     kind: instruction
 *   - path: chatmodes/azure-architect.chatmode.md
 *     kind: chat-mode
 * ```
 * 
 * Usage:
 * ```typescript
 * const source: RegistrySource = {
 *   id: 'my-local-collections',
 *   name: 'My Local Collections',
 *   url: 'file:///home/user/my-collections',  // or '/home/user/my-collections'
 *   type: 'local-awesome-copilot',
 *   config: { collectionsPath: 'collections' }
 * };
 * const adapter = new LocalAwesomeCopilotAdapter(source);
 * const bundles = await adapter.listBundles();
 * ```
 */

import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import * as yaml from 'js-yaml';
import archiver from 'archiver';
import { RepositoryAdapter } from './RepositoryAdapter';
import { Bundle, RegistrySource, ValidationResult, SourceMetadata } from '../types/registry';
import { Logger } from '../utils/logger';

// Promisified fs functions
const readdir = promisify(fs.readdir);
const readFile = promisify(fs.readFile);
const stat = promisify(fs.stat);
const access = promisify(fs.access);

/**
 * Awesome Copilot Collection Schema
 */
interface CollectionManifest {
    id: string;
    name: string;
    description: string;
    tags?: string[];
    items: CollectionItem[];
    display?: {
        ordering?: string;
        show_badge?: boolean;
    };
}

interface CollectionItem {
    path: string;
    kind: 'prompt' | 'instruction' | 'chat-mode' | 'agent';
}

/**
 * LocalAwesomeCopilotAdapter Configuration
 */
export interface LocalAwesomeCopilotConfig {
    /** Collections directory relative to root (default: collections) */
    collectionsPath?: string;
}

/**
 * LocalAwesomeCopilotAdapter
 * 
 * Fetches bundles from local awesome-copilot style collection repositories.
 * 
 * Features:
 * - Local filesystem access
 * - Automatic collection discovery
 * - Content type mapping (prompt/instruction/chatmode/agent)
 * - Dynamic bundle archive creation
 * - No network dependencies
 * 
 * Directory Structure:
 * ```
 * /home/user/my-collections/
 *   collections/
 *     azure-cloud.collection.yml
 *     python-dev.collection.yml
 *   prompts/
 *     azure-resource-health.prompt.md
 *     python-testing.prompt.md
 *   instructions/
 *     bicep-best-practices.instructions.md
 * ```
 */
export class LocalAwesomeCopilotAdapter extends RepositoryAdapter {
    readonly type = 'local-awesome-copilot';
    private config: Required<LocalAwesomeCopilotConfig>;
    private collectionsCache: Map<string, { bundles: Bundle[]; timestamp: number }> = new Map();
    private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes
    protected logger: Logger;

    constructor(source: RegistrySource) {
        super(source);
        this.logger = Logger.getInstance();
        
        // Parse config
        const userConfig = (source as any).config || {};
        this.config = {
            collectionsPath: userConfig.collectionsPath || 'collections'
        };

        if (!this.isValidUrl(source.url)) {
            throw new Error(`Invalid local path: ${source.url}`);
        }

        this.logger.info(`LocalAwesomeCopilotAdapter initialized for: ${source.url}`);
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
     * Get collections directory path
     */
    private getCollectionsPath(): string {
        const localPath = this.getLocalPath();
        return path.join(localPath, this.config.collectionsPath);
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
     * Fetch list of available bundles from the local filesystem
     * Scans the collections directory for .collection.yml files and creates Bundle objects.
     * Results are cached for 5 minutes to reduce filesystem operations.
     * 
     * @returns Promise resolving to array of Bundle objects from collection files
     * @throws Error if directory access fails or collection parsing fails
     */
    async fetchBundles(): Promise<Bundle[]> {
        this.logger.debug('Listing bundles from local awesome-copilot repository');

        // Check cache
        const cacheKey = `${this.source.url}-${this.config.collectionsPath}`;
        const cached = this.collectionsCache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
            this.logger.debug('Using cached collections');
            return cached.bundles;
        }

        try {
            // Step 1: List .collection.yml files
            const collectionFiles = await this.listCollectionFiles();
            this.logger.debug(`Found ${collectionFiles.length} collection files`);
            
            // Step 2: Parse each collection
            const bundles: Bundle[] = [];
            for (const file of collectionFiles) {
                try {
                    const bundle = await this.parseCollection(file);
                    if (bundle) {
                        bundles.push(bundle);
                    }
                } catch (error) {
                    this.logger.warn(`Failed to parse collection ${file}:`, error as Error);
                }
            }

            // Cache results
            this.collectionsCache.set(cacheKey, { bundles, timestamp: Date.now() });
            
            return bundles;

        } catch (error) {
            this.logger.error('Failed to list bundles', error as Error);
            throw new Error(`Failed to list local awesome-copilot collections: ${(error as Error).message}`);
        }
    }

    /**
     * Download a bundle as a dynamically-created zip archive
     * Fetches all items referenced in the collection from local filesystem and creates a ZIP file.
     * The archive includes prompts, instructions, and a deployment manifest.
     * 
     * @param bundle - Bundle object containing collection metadata
     * @returns Promise resolving to Buffer containing the ZIP archive
     * @throws Error if collection fetch fails or archive creation fails
     */
    async downloadBundle(bundle: Bundle): Promise<Buffer> {
        this.logger.debug(`Downloading bundle: ${bundle.id}`);

        try {
            // Find collection file from bundle metadata
            const collectionFile = (bundle as any).collectionFile || `${bundle.id}.collection.yml`;
            this.logger.debug(`Collection file: ${collectionFile}`);
            
            // Parse collection
            const collectionsPath = this.getCollectionsPath();
            const collectionFilePath = path.join(collectionsPath, collectionFile);
            this.logger.debug(`Reading collection from: ${collectionFilePath}`);
            
            const yamlContent = await readFile(collectionFilePath, 'utf-8');
            const collection = yaml.load(yamlContent) as CollectionManifest;
            this.logger.debug(`Collection loaded: ${collection.name}, items: ${collection.items.length}`);
            
            // Create zip archive
            const buffer = await this.createBundleArchive(collection, collectionFile);
            this.logger.debug(`Archive created: ${buffer.length} bytes`);
            return buffer;

        } catch (error) {
            this.logger.error('Failed to download bundle', error as Error);
            throw new Error(`Failed to download bundle: ${(error as Error).message}`);
        }
    }

    /**
     * Fetch repository metadata
     * Retrieves information about the local collection directory including collection count.
     * 
     * @returns Promise resolving to SourceMetadata with directory info
     * @throws Error if directory access fails or collection listing fails
     */
    async fetchMetadata(): Promise<SourceMetadata> {
        try {
            const localPath = this.getLocalPath();
            const collectionFiles = await this.listCollectionFiles();
            const stats = await stat(localPath);

            return {
                name: path.basename(localPath),
                description: `Local Awesome Copilot collections from ${localPath}`,
                bundleCount: collectionFiles.length,
                lastUpdated: stats.mtime.toISOString(),
                version: '1.0.0'
            };
        } catch (error) {
            throw new Error(`Failed to fetch metadata: ${(error as Error).message}`);
        }
    }

    /**
     * Get manifest URL for a bundle
     * Returns the file:// URL to the collection YAML file.
     * 
     * @param bundleId - Bundle identifier matching the collection filename
     * @param version - Optional version (not used for local collections)
     * @returns file:// URL string pointing to collection .yml file
     */
    getManifestUrl(bundleId: string, version?: string): string {
        const collectionsPath = this.getCollectionsPath();
        const collectionFile = `${bundleId}.collection.yml`;
        return `file://${path.join(collectionsPath, collectionFile)}`;
    }

    /**
     * Get download URL for a bundle
     * Returns the collection YAML file:// URL (bundles are created dynamically, not pre-packaged).
     * 
     * @param bundleId - Bundle identifier matching the collection filename
     * @param version - Optional version (not used for local collections)
     * @returns file:// URL string pointing to collection .yml file
     */
    getDownloadUrl(bundleId: string, version?: string): string {
        // For local awesome-copilot, download URL is same as manifest URL
        // (we download and package on the fly)
        return this.getManifestUrl(bundleId, version);
    }

    /**
     * Validate directory structure
     * Checks if the collections directory exists and contains at least one collection file.
     * 
     * @returns Promise resolving to ValidationResult with status and any errors/warnings
     */
    async validate(): Promise<ValidationResult> {
        try {
            const collectionsPath = this.getCollectionsPath();
            const exists = await this.directoryExists(collectionsPath);
            
            if (!exists) {
                return {
                    valid: false,
                    errors: [`Collections directory does not exist: ${collectionsPath}`],
                    warnings: [],
                    bundlesFound: 0
                };
            }

            const collectionFiles = await this.listCollectionFiles();
            
            if (collectionFiles.length === 0) {
                return {
                    valid: false,
                    errors: ['No .collection.yml files found in collections directory'],
                    warnings: [],
                    bundlesFound: 0
                };
            }

            return {
                valid: true,
                errors: [],
                warnings: [],
                bundlesFound: collectionFiles.length
            };

        } catch (error) {
            return {
                valid: false,
                errors: [`Failed to validate directory: ${(error as Error).message}`],
                warnings: [],
                bundlesFound: 0
            };
        }
    }

    /**
     * List all .collection.yml files in collections directory
     */
    private async listCollectionFiles(): Promise<string[]> {
        const collectionsPath = this.getCollectionsPath();
        
        const exists = await this.directoryExists(collectionsPath);
        if (!exists) {
            throw new Error(`Collections directory does not exist: ${collectionsPath}`);
        }

        const entries = await readdir(collectionsPath, { withFileTypes: true });
        return entries
            .filter(entry => entry.isFile() && entry.name.endsWith('.collection.yml'))
            .map(entry => entry.name);
    }

    /**
     * Parse a collection file into a Bundle
     */
    private async parseCollection(collectionFile: string): Promise<Bundle | null> {
        try {
            const collectionsPath = this.getCollectionsPath();
            const collectionFilePath = path.join(collectionsPath, collectionFile);
            
            const yamlContent = await readFile(collectionFilePath, 'utf-8');
            const collection = yaml.load(yamlContent) as CollectionManifest;

            // Count items by kind
            const breakdown = this.calculateBreakdown(collection.items);

            // Get file stats for timestamp
            const stats = await stat(collectionFilePath);

            const bundle: Bundle = {
                id: collection.id,
                name: collection.name,
                version: '1.0.0',
                description: collection.description,
                author: 'Local Developer',
                repository: this.source.url,
                tags: collection.tags || [],
                environments: this.inferEnvironments(collection.tags || []),
                sourceId: this.source.id,
                manifestUrl: `file://${collectionFilePath}`,
                downloadUrl: `file://${collectionFilePath}`,
                lastUpdated: stats.mtime.toISOString(),
                size: `${collection.items.length} items`,
                dependencies: [],
                license: 'MIT'
            };

            // Store collection file name for download
            (bundle as any).collectionFile = collectionFile;
            (bundle as any).breakdown = breakdown;

            return bundle;

        } catch (error) {
            this.logger.error(`Failed to parse collection ${collectionFile}`, error as Error);
            return null;
        }
    }

    /**
     * Create a zip archive containing collection files
     */
    private async createBundleArchive(collection: CollectionManifest, collectionFile: string): Promise<Buffer> {
        this.logger.debug(`Creating archive for collection: ${collection.name}`);
        
        return new Promise<Buffer>((resolve, reject) => {
            // Use IIFE to handle async operations within Promise executor
            (async () => {
                try {
                    const archive = archiver('zip', { zlib: { level: 9 } });
                    const chunks: Buffer[] = [];
                    let totalSize = 0;

                    // Collect data chunks
                    archive.on('data', (chunk: Buffer) => {
                        chunks.push(chunk);
                        totalSize += chunk.length;
                    });

                    // Resolve when archive is finalized
                    archive.on('finish', () => {
                        const buffer = Buffer.concat(chunks);
                        this.logger.debug(`Archive finalized: ${buffer.length} bytes (${chunks.length} chunks)`);
                        resolve(buffer);
                    });

                    // Handle errors
                    archive.on('error', (err: Error) => {
                        this.logger.error('Archive error', err);
                        reject(err);
                    });

                    // Log warnings
                    archive.on('warning', (warning: Error) => {
                        this.logger.warn('Archive warning', warning);
                    });

                    // Add deployment-manifest.yml
                    const manifest = this.createDeploymentManifest(collection);
                    const manifestYaml = yaml.dump(manifest);
                    archive.append(manifestYaml, { name: 'deployment-manifest.yml' });
                    this.logger.debug(`Added manifest (${manifestYaml.length} bytes)`);
                    
                    // Add each item file
                    const localPath = this.getLocalPath();
                    for (const item of collection.items) {
                        const itemPath = path.join(localPath, item.path);
                        const content = await readFile(itemPath, 'utf-8');
                        const filename = path.basename(item.path);
                        archive.append(content, { name: `prompts/${filename}` });
                        this.logger.debug(`Added ${filename} (${content.length} bytes)`);
                    }

                    // Finalize the archive (this triggers 'finish' event when complete)
                    this.logger.debug('Finalizing archive...');
                    archive.finalize();

                } catch (error) {
                    this.logger.error('Failed to create archive', error as Error);
                    reject(error);
                }
            })();
        });
    }

    /**
     * Create deployment manifest from collection
     */
    private createDeploymentManifest(collection: CollectionManifest): any {
        const prompts = collection.items.map(item => {
            const filename = path.basename(item.path);
            const id = filename.replace(/\.(prompt|instructions|chatmode|agent)\.md$/, '');
            
            return {
                id,
                name: this.titleCase(id.replace(/-/g, ' ')),
                description: `From ${collection.name}`,
                file: `prompts/${filename}`,
                type: this.mapKindToType(item.kind),
                tags: collection.tags || []
            };
        });

        return {
            id: collection.id,
            name: collection.name,
            version: '1.0.0',
            description: collection.description,
            author: 'Local Developer',
            repository: this.source.url,
            license: 'MIT',
            tags: collection.tags || [],
            prompts
        };
    }

    /**
     * Map collection kind to Prompt Registry type
     */
    private mapKindToType(kind: string): 'prompt' | 'instructions' | 'chatmode' | 'agent' {
        const kindMap: Record<string, 'prompt' | 'instructions' | 'chatmode' | 'agent'> = {
            'prompt': 'prompt',
            'instruction': 'instructions',
            'chat-mode': 'chatmode',
            'agent': 'agent'
        };
        return kindMap[kind] || 'prompt';
    }

    /**
     * Calculate content breakdown from items
     */
    private calculateBreakdown(items: CollectionItem[]): Record<string, number> {
        const breakdown = {
            prompts: 0,
            instructions: 0,
            chatmodes: 0,
            agents: 0
        };

        for (const item of items) {
            switch (item.kind) {
                case 'prompt':
                    breakdown.prompts++;
                    break;
                case 'instruction':
                    breakdown.instructions++;
                    break;
                case 'chat-mode':
                    breakdown.chatmodes++;
                    break;
                case 'agent':
                    breakdown.agents++;
                    break;
            }
        }

        return breakdown;
    }

    /**
     * Infer environments from tags
     */
    private inferEnvironments(tags: string[]): string[] {
        const envMap: Record<string, string> = {
            'azure': 'cloud',
            'aws': 'cloud',
            'gcp': 'cloud',
            'frontend': 'web',
            'backend': 'server',
            'database': 'data',
            'devops': 'infrastructure',
            'testing': 'testing'
        };

        const environments = new Set<string>();
        for (const tag of tags) {
            const env = envMap[tag.toLowerCase()];
            if (env) {
                environments.add(env);
            }
        }

        return environments.size > 0 ? Array.from(environments) : ['general'];
    }

    /**
     * Convert kebab-case to Title Case
     */
    private titleCase(str: string): string {
        return str
            .split(' ')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
            .join(' ');
    }
}

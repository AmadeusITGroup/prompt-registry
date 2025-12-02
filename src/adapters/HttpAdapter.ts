/**
 * HTTP/HTTPS repository adapter
 * Fetches bundles from generic HTTP endpoints with index.json
 */

import * as https from 'https';
import * as http from 'http';
import { RepositoryAdapter } from './RepositoryAdapter';
import { Bundle, SourceMetadata, ValidationResult, RegistrySource } from '../types/registry';

/**
 * HTTP registry index format
 */
interface HttpRegistryIndex {
    name: string;
    description: string;
    version: string;
    bundles: Array<{
        id: string;
        name: string;
        version: string;
        description: string;
        author: string;
        environments: string[];
        tags: string[];
        lastUpdated: string;
        size: string;
        dependencies: Array<{
            id: string;
            version: string;
            optional?: boolean;
        }>;
        license: string;
        downloadUrl: string;
        manifestUrl: string;
    }>;
}

/**
 * HTTP repository adapter implementation
 * Expects an index.json file at the root URL listing all available bundles
 */
export class HttpAdapter extends RepositoryAdapter {
    readonly type = 'http';

    constructor(source: RegistrySource) {
        super(source);
        
        if (!this.isValidUrl(source.url)) {
            throw new Error(`Invalid HTTP URL: ${source.url}`);
        }
    }

    /**
     * Make HTTP/HTTPS request
     */
    private async makeRequest(url: string): Promise<any> {
        return new Promise((resolve, reject) => {
            const protocol = url.startsWith('https') ? https : http;
            const headers = this.getHeaders();
            
            // Add auth header if token provided
            if (this.getAuthToken()) {
                headers['Authorization'] = `Bearer ${this.getAuthToken()}`;
            }

            protocol.get(url, { headers }, (res) => {
                // Handle redirects
                if (res.statusCode === 301 || res.statusCode === 302) {
                    if (res.headers.location) {
                        this.makeRequest(res.headers.location)
                            .then(resolve)
                            .catch(reject);
                        return;
                    }
                }

                let data = '';

                res.on('data', (chunk) => {
                    data += chunk;
                });

                res.on('end', () => {
                    if (res.statusCode !== 200) {
                        reject(new Error(`HTTP error: ${res.statusCode} - ${data}`));
                        return;
                    }

                    try {
                        resolve(JSON.parse(data));
                    } catch (error) {
                        reject(new Error(`Failed to parse JSON response: ${error}`));
                    }
                });
            }).on('error', (error) => {
                reject(new Error(`HTTP request failed: ${error.message}`));
            });
        });
    }

    /**
     * Download binary data from URL
     */
    private async downloadBinary(url: string): Promise<Buffer> {
        return new Promise((resolve, reject) => {
            const protocol = url.startsWith('https') ? https : http;
            const headers = this.getHeaders();
            
            if (this.getAuthToken()) {
                headers['Authorization'] = `Bearer ${this.getAuthToken()}`;
                console.log(`[HttpAdapter] Downloading with authentication: ${url}`);
            } else {
                console.log(`[HttpAdapter] Downloading without authentication: ${url}`);
            }

            protocol.get(url, { headers }, (res) => {
                // Handle redirects
                if (res.statusCode === 301 || res.statusCode === 302) {
                    if (res.headers.location) {
                        console.log(`[HttpAdapter] Following redirect: ${res.statusCode} -> ${res.headers.location}`);
                        this.downloadBinary(res.headers.location)
                            .then(resolve)
                            .catch(reject);
                        return;
                    }
                }

                const chunks: Buffer[] = [];

                res.on('data', (chunk) => {
                    chunks.push(chunk);
                });

                res.on('end', () => {
                    if (res.statusCode !== 200) {
                        console.error(`[HttpAdapter] Download failed with status ${res.statusCode}`);
                        reject(new Error(`Failed to download: ${res.statusCode}`));
                        return;
                    }
                    const buffer = Buffer.concat(chunks);
                    console.log(`[HttpAdapter] Download complete: ${buffer.length} bytes received`);
                    resolve(buffer);
                });
            }).on('error', (error) => {
                console.error(`[HttpAdapter] Download error: ${error.message}`);
                reject(new Error(`Download failed: ${error.message}`));
            });
        });
    }

    /**
     * Get index URL for the registry
     */
    private getIndexUrl(): string {
        let url = this.source.url.replace(/\/$/, ''); // Remove trailing slash
        
        // Add /index.json if not already present
        if (!url.endsWith('index.json') && !url.endsWith('.json')) {
            url += '/index.json';
        }
        
        return url;
    }

    /**
     * Check if URL is valid HTTP/HTTPS URL
     */
    isValidUrl(url: string): boolean {
        return url.startsWith('http://') || url.startsWith('https://');
    }

    /**
     * Fetch repository metadata from index.json
     */
    async fetchMetadata(): Promise<SourceMetadata> {
        try {
            const indexUrl = this.getIndexUrl();
            const index = await this.makeRequest(indexUrl) as HttpRegistryIndex;

            return {
                name: index.name || 'HTTP Registry',
                description: index.description || '',
                bundleCount: index.bundles?.length || 0,
                lastUpdated: new Date().toISOString(),
                version: index.version || '1.0.0',
            };
        } catch (error) {
            throw new Error(`Failed to fetch HTTP registry metadata: ${error}`);
        }
    }

    /**
     * Fetch bundles from index.json
     */
    async fetchBundles(): Promise<Bundle[]> {
        try {
            const indexUrl = this.getIndexUrl();
            const index = await this.makeRequest(indexUrl) as HttpRegistryIndex;
            
            if (!index.bundles || !Array.isArray(index.bundles)) {
                return [];
            }

            // Convert index bundles to Bundle format
            return index.bundles.map(bundle => ({
                id: bundle.id,
                name: bundle.name,
                version: bundle.version,
                description: bundle.description,
                author: bundle.author,
                sourceId: this.source.id,
                environments: bundle.environments || [],
                tags: bundle.tags || [],
                lastUpdated: bundle.lastUpdated,
                size: bundle.size,
                dependencies: (bundle.dependencies || []).map(dep => ({
                    bundleId: dep.id,
                    versionRange: dep.version,
                    optional: dep.optional || false,
                })),
                license: bundle.license,
                downloadUrl: this.resolveUrl(bundle.downloadUrl),
                manifestUrl: this.resolveUrl(bundle.manifestUrl),
            }));
        } catch (error) {
            throw new Error(`Failed to fetch bundles from HTTP registry: ${error}`);
        }
    }

    /**
     * Resolve relative URLs to absolute
     */
    private resolveUrl(url: string): string {
        // If already absolute, return as-is
        if (url.startsWith('http://') || url.startsWith('https://')) {
            return url;
        }

        // Resolve relative URL based on source URL
        const baseUrl = this.source.url.replace(/\/[^/]*$/, ''); // Remove last segment
        return `${baseUrl}/${url.replace(/^\//, '')}`;
    }

    /**
     * Validate HTTP registry
     */
    async validate(): Promise<ValidationResult> {
        try {
            const indexUrl = this.getIndexUrl();
            await this.makeRequest(indexUrl);
            
            return {
                valid: true,
                errors: [],
                warnings: [],
            };
        } catch (error) {
            return {
                valid: false,
                errors: [`HTTP registry validation failed: ${error}`],
                warnings: [],
            };
        }
    }

    /**
     * Get manifest URL for a bundle
     */
    getManifestUrl(bundleId: string, version?: string): string {
        // Try to fetch from index to get the manifest URL
        const baseUrl = this.source.url.replace(/\/$/, '');
        return `${baseUrl}/${bundleId}/${version || 'latest'}/deployment-manifest.yml`;
    }

    /**
     * Get download URL for a bundle
     */
    getDownloadUrl(bundleId: string, version?: string): string {
        const baseUrl = this.source.url.replace(/\/$/, '');
        return `${baseUrl}/${bundleId}/${version || 'latest'}/bundle.zip`;
    }

    /**
     * Download a bundle
     */
    async downloadBundle(bundle: Bundle): Promise<Buffer> {
        try {
            return await this.downloadBinary(bundle.downloadUrl);
        } catch (error) {
            throw new Error(`Failed to download bundle: ${error}`);
        }
    }
}

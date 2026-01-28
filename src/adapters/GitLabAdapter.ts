/**
 * GitLab repository adapter
 * Fetches bundles from GitLab repositories
 */

import * as https from 'https';
import { RepositoryAdapter } from './RepositoryAdapter';
import { Bundle, SourceMetadata, ValidationResult, RegistrySource } from '../types/registry';

/**
 * GitLab API response types
 */
interface GitLabRelease {
    tag_name: string;
    name: string;
    description: string;
    assets: {
        links: Array<{
            name: string;
            url: string;
        }>;
    };
    released_at: string;
}

interface GitLabFile {
    file_name: string;
    file_path: string;
    type: string;
}

/**
 * GitLab repository adapter implementation
 */
export class GitLabAdapter extends RepositoryAdapter {
    readonly type = 'gitlab';
    private apiBase = 'https://gitlab.com/api/v4';

    constructor(source: RegistrySource) {
        super(source);
        
        if (!this.isValidUrl(source.url)) {
            throw new Error(`Invalid GitLab URL: ${source.url}`);
        }

        // Support custom GitLab instances
        if (source.url.includes('gitlab.com/')) {
            this.apiBase = 'https://gitlab.com/api/v4';
        } else {
            // Extract base URL for self-hosted GitLab
            const match = source.url.match(/(https?:\/\/[^/]+)/);
            if (match) {
                this.apiBase = `${match[1]}/api/v4`;
            }
        }
    }

    /**
     * Parse GitLab URL to extract project path
     */
    private parseGitLabUrl(): string {
        const url = this.source.url.replace(/\.git$/, '');
        
        // Handle gitlab.com URLs
        let match = url.match(/gitlab\.com[/:](.+)/);
        if (match) {
            return encodeURIComponent(match[1]);
        }
        
        // Handle self-hosted GitLab URLs
        match = url.match(/https?:\/\/[^/]+\/(.+)/);
        if (match) {
            return encodeURIComponent(match[1]);
        }
        
        throw new Error(`Invalid GitLab URL format: ${this.source.url}`);
    }

    /**
     * Make HTTP request to GitLab API
     */
    private async makeRequest(url: string): Promise<any> {
        return new Promise((resolve, reject) => {
            const headers = this.getHeaders();
            
            // GitLab uses different auth header
            if (this.getAuthToken()) {
                headers['PRIVATE-TOKEN'] = this.getAuthToken() || '';
            }

            https.get(url, { headers }, (res) => {
                let data = '';

                res.on('data', (chunk) => {
                    data += chunk;
                });

                res.on('end', () => {
                    if (res.statusCode !== 200) {
                        reject(new Error(`GitLab API error: ${res.statusCode} - ${data}`));
                        return;
                    }

                    try {
                        resolve(JSON.parse(data));
                    } catch (error) {
                        reject(new Error(`Failed to parse GitLab API response: ${error}`));
                    }
                });
            }).on('error', (error) => {
                reject(new Error(`GitLab API request failed: ${error.message}`));
            });
        });
    }

    /**
     * Check if URL is valid GitLab URL
     */
    isValidUrl(url: string): boolean {
        return url.includes('gitlab.com') || 
               url.match(/https?:\/\/[^/]+\/[^/]+\/[^/]+/) !== null;
    }

    /**
     * Fetch repository metadata
     */
    async fetchMetadata(): Promise<SourceMetadata> {
        try {
            const projectPath = this.parseGitLabUrl();
            const url = `${this.apiBase}/projects/${projectPath}`;
            
            const project = await this.makeRequest(url);

            return {
                name: project.name || 'Unknown',
                description: project.description || '',
                bundleCount: 0, // Will be updated when fetching bundles
                lastUpdated: project.last_activity_at || new Date().toISOString(),
                version: '1.0.0',
            };
        } catch (error) {
            throw new Error(`Failed to fetch GitLab metadata: ${error}`);
        }
    }

    /**
     * Fetch bundles from repository
     */
    async fetchBundles(): Promise<Bundle[]> {
        try {
            const projectPath = this.parseGitLabUrl();
            const releasesUrl = `${this.apiBase}/projects/${projectPath}/releases`;
            
            const releases = await this.makeRequest(releasesUrl) as GitLabRelease[];
            
            if (!Array.isArray(releases)) {
                return [];
            }

            const bundles: Bundle[] = [];

            for (const release of releases) {
                // Look for bundle zip in release assets
                const bundleAsset = release.assets?.links?.find(
                    link => link.name.endsWith('.zip') || link.name.includes('bundle')
                );

                if (bundleAsset) {
                    // Fetch manifest for this release
                    const manifestUrl = `${this.apiBase}/projects/${projectPath}/repository/files/deployment-manifest.yml/raw?ref=${release.tag_name}`;
                    
                    try {
                        const manifest = await this.makeRequest(manifestUrl);
                        
                        const bundle: Bundle = {
                            id: manifest.id || release.tag_name,
                            name: manifest.name || release.name,
                            version: manifest.version || release.tag_name,
                            description: manifest.description || release.description || '',
                            author: manifest.author || 'Unknown',
                            tags: manifest.tags || [],
                            sourceId: this.source.id,
                            environments: manifest.environments || [],
                            lastUpdated: release.released_at,
                            size: manifest.size || 'Unknown',
                            dependencies: manifest.dependencies || [],
                            license: manifest.license || 'Unknown',
                            downloadUrl: bundleAsset.url,
                            manifestUrl: manifestUrl,
                        };

                        // Attach prompts array from manifest for content breakdown display
                        if (manifest?.prompts && Array.isArray(manifest.prompts)) {
                            (bundle as any).prompts = manifest.prompts;
                        }

                        // Attach MCP servers from manifest for content breakdown display
                        if (manifest?.mcpServers && typeof manifest.mcpServers === 'object') {
                            (bundle as any).mcpServers = manifest.mcpServers;
                        }

                        bundles.push(bundle);
                    } catch (manifestError) {
                        // Skip this release if manifest is not found
                        console.warn(`No manifest found for release ${release.tag_name}`);
                    }
                }
            }

            return bundles;
        } catch (error) {
            throw new Error(`Failed to fetch bundles from GitLab: ${error}`);
        }
    }

    /**
     * Validate repository
     */
    async validate(): Promise<ValidationResult> {
        try {
            await this.fetchMetadata();
            return {
                valid: true,
                errors: [],
                warnings: [],
            };
        } catch (error) {
            return {
                valid: false,
                errors: [`GitLab validation failed: ${error}`],
                warnings: [],
            };
        }
    }

    /**
     * Get manifest URL for a bundle
     */
    getManifestUrl(bundleId: string, version?: string): string {
        const projectPath = this.parseGitLabUrl();
        const ref = version || 'main';
        return `${this.apiBase}/projects/${projectPath}/repository/files/deployment-manifest.yml/raw?ref=${ref}`;
    }

    /**
     * Get download URL for a bundle
     */
    getDownloadUrl(bundleId: string, version?: string): string {
        const projectPath = this.parseGitLabUrl();
        const tag = version || 'latest';
        return `${this.apiBase}/projects/${projectPath}/repository/archive.zip?ref=${tag}`;
    }

    /**
     * Download a bundle
     */
    async downloadBundle(bundle: Bundle): Promise<Buffer> {
        return new Promise((resolve, reject) => {
            const headers = this.getHeaders();
            
            if (this.getAuthToken()) {
                headers['PRIVATE-TOKEN'] = this.getAuthToken() || '';
            }

            https.get(bundle.downloadUrl, { headers }, (res) => {
                const chunks: Buffer[] = [];

                res.on('data', (chunk) => {
                    chunks.push(chunk);
                });

                res.on('end', () => {
                    if (res.statusCode !== 200) {
                        reject(new Error(`Failed to download bundle: ${res.statusCode}`));
                        return;
                    }
                    resolve(Buffer.concat(chunks));
                });
            }).on('error', (error) => {
                reject(new Error(`Download failed: ${error.message}`));
            });
        });
    }
}

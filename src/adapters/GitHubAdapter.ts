/**
 * GitHub repository adapter
 * Fetches bundles from GitHub repositories
 */

import * as https from 'https';
import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';
import { RepositoryAdapter } from './RepositoryAdapter';
import { Bundle, SourceMetadata, ValidationResult, RegistrySource } from '../types/registry';
import { Logger } from '../utils/logger';

const execAsync = promisify(exec);

/**
 * GitHub API response types
 */
interface GitHubRelease {
    tag_name: string;
    name: string;
    body: string;
    assets: Array<{
        name: string;
        browser_download_url: string;
        size: number;
    }>;
    published_at: string;
}

interface GitHubContent {
    name: string;
    path: string;
    download_url: string;
    type: string;
}

/**
 * GitHub repository adapter implementation
 */
export class GitHubAdapter extends RepositoryAdapter {
    readonly type = 'github';
    private apiBase = 'https://api.github.com';
    private authToken: string | undefined;
    private authMethod: 'vscode' | 'gh-cli' | 'explicit' | 'none' = 'none';
    private logger: Logger;

    constructor(source: RegistrySource) {
        super(source);
        this.logger = Logger.getInstance();
        
        if (!this.isValidGitHubUrl(source.url)) {
            throw new Error(`Invalid GitHub URL: ${source.url}`);
        }
    }

    /**
     * Validate GitHub URL (supports both HTTPS and SSH formats)
     */
    private isValidGitHubUrl(url: string): boolean {
        // HTTPS format: https://github.com/owner/repo
        if (url.startsWith('https://')) {
            return url.includes('github.com');
        }
        // SSH format: git@github.com:owner/repo.git
        if (url.startsWith('git@')) {
            return url.includes('github.com:');
        }
        return false;
    }

    /**
     * Parse GitHub URL to extract owner and repo
     */
    private parseGitHubUrl(): { owner: string; repo: string } {
        const url = this.source.url.replace(/\.git$/, '');
        const match = url.match(/github\.com[/:]([^/]+)\/([^/]+)/);
        
        if (!match) {
            throw new Error(`Invalid GitHub URL format: ${this.source.url}`);
        }

        return {
            owner: match[1],
            repo: match[2],
        };
    }

    /**
     * Get authentication token using fallback chain:
     * 1. VSCode GitHub API (if user is logged in)
     * 2. gh CLI (if installed and authenticated)
     * 3. Explicit token from source configuration
     */
    private async getAuthenticationToken(): Promise<string | undefined> {
        // Return cached token if already resolved
        if (this.authToken !== undefined) {
            this.logger.debug(`[GitHubAdapter] Using cached token (method: ${this.authMethod})`);
            return this.authToken;
        }

        this.logger.info('[GitHubAdapter] Attempting authentication...');

        // Try VSCode GitHub authentication first
        try {
            this.logger.debug('[GitHubAdapter] Trying VSCode GitHub authentication...');
            const session = await vscode.authentication.getSession('github', ['repo'], { createIfNone: true });
            if (session) {
                this.authToken = session.accessToken;
                this.authMethod = 'vscode';
                this.logger.info('[GitHubAdapter] ✓ Using VSCode GitHub authentication');
                this.logger.debug(`[GitHubAdapter] Token preview: ${this.authToken.substring(0, 8)}...`);
                return this.authToken;
            }
            this.logger.debug('[GitHubAdapter] VSCode auth session not found');
        } catch (error) {
            this.logger.warn(`[GitHubAdapter] VSCode auth failed: ${error}`);
        }

        // Try gh CLI authentication
        try {
            this.logger.debug('[GitHubAdapter] Trying gh CLI authentication...');
            const { stdout } = await execAsync('gh auth token');
            const token = stdout.trim();
            if (token && token.length > 0) {
                this.authToken = token;
                this.authMethod = 'gh-cli';
                this.logger.info('[GitHubAdapter] ✓ Using gh CLI authentication');
                this.logger.debug(`[GitHubAdapter] Token preview: ${this.authToken.substring(0, 8)}...`);
                return this.authToken;
            }
            this.logger.debug('[GitHubAdapter] gh CLI returned empty token');
        } catch (error) {
            this.logger.warn(`[GitHubAdapter] gh CLI auth failed: ${error}`);
        }

        // Fall back to explicit token from source configuration
        const explicitToken = this.getAuthToken();
        if (explicitToken) {
            this.authToken = explicitToken;
            this.authMethod = 'explicit';
            this.logger.info('[GitHubAdapter] ✓ Using explicit token from configuration');
            this.logger.debug(`[GitHubAdapter] Token preview: ${this.authToken.substring(0, 8)}...`);
            return this.authToken;
        }

        // No authentication available
        this.authMethod = 'none';
        this.logger.warn('[GitHubAdapter] ✗ No authentication available - API rate limits will apply and private repos will be inaccessible');
        return undefined;
    }

    /**
     * Make HTTP request to GitHub API with authentication
     */
    private async makeRequest(url: string): Promise<any> {
        const headers = this.getHeaders();
        
        // Get authentication token using fallback chain
        const token = await this.getAuthenticationToken();
        if (token) {
            // Use Bearer token format for OAuth tokens (recommended)
            headers['Authorization'] = `Bearer ${token}`;
            this.logger.debug(`[GitHubAdapter] Request to ${url} with auth (method: ${this.authMethod})`);
        } else {
            this.logger.debug(`[GitHubAdapter] Request to ${url} WITHOUT auth`);
        }

        // Log headers (sanitized)
        const sanitizedHeaders = { ...headers };
        if (sanitizedHeaders['Authorization']) {
            sanitizedHeaders['Authorization'] = sanitizedHeaders['Authorization'].substring(0, 15) + '...';
        }
        this.logger.debug(`[GitHubAdapter] Request headers: ${JSON.stringify(sanitizedHeaders)}`);

        return new Promise((resolve, reject) => {
            https.get(url, { headers }, (res) => {
                let data = '';

                res.on('data', (chunk) => {
                    data += chunk;
                });

                res.on('end', () => {
                    if (res.statusCode && res.statusCode >= 400) {
                        this.logger.error(`[GitHubAdapter] HTTP ${res.statusCode}: ${res.statusMessage}`);
                        this.logger.error(`[GitHubAdapter] URL: ${url}`);
                        this.logger.error(`[GitHubAdapter] Auth method: ${this.authMethod}`);
                        this.logger.error(`[GitHubAdapter] Response: ${data.substring(0, 500)}`);
                        
                        // Provide helpful error messages
                        let errorMsg = `GitHub API error: ${res.statusCode} ${res.statusMessage}`;
                        if (res.statusCode === 404) {
                            errorMsg += ' - Repository not found or not accessible. Check authentication.';
                        } else if (res.statusCode === 401) {
                            errorMsg += ' - Authentication failed. Token may be invalid or expired.';
                        } else if (res.statusCode === 403) {
                            errorMsg += ' - Access forbidden. Token may lack required scopes (repo).';
                        }
                        reject(new Error(errorMsg));
                        return;
                    }

                    this.logger.debug(`[GitHubAdapter] Response OK (${res.statusCode})`);
                    try {
                        resolve(JSON.parse(data));
                    } catch (error) {
                        this.logger.error(`[GitHubAdapter] Failed to parse response: ${error}`);
                        reject(new Error(`Failed to parse GitHub response: ${error}`));
                    }
                });
            }).on('error', (error) => {
                this.logger.error(`[GitHubAdapter] Network error: ${error.message}`);
                reject(new Error(`GitHub API request failed: ${error.message}`));
            });
        });
    }

    /**
     * Download file from URL with authentication
     */
    private async downloadFile(url: string): Promise<Buffer> {
        // Include authentication for private repos
        const token = await this.getAuthenticationToken();
        const headers: any = {
            'User-Agent': 'Prompt-Registry-VSCode-Extension',
        };
        
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
            this.logger.debug(`[GitHubAdapter] Downloading ${url} with auth (method: ${this.authMethod})`);
        } else {
            this.logger.debug(`[GitHubAdapter] Downloading ${url} WITHOUT auth`);
        }

        return new Promise((resolve, reject) => {
            https.get(url, { headers }, (res) => {
                // Handle redirects (GitHub may redirect downloads)
                if (res.statusCode === 302 || res.statusCode === 301) {
                    const redirectUrl = res.headers.location;
                    if (redirectUrl) {
                        this.logger.debug(`[GitHubAdapter] Following redirect to: ${redirectUrl}`);
                        // Recursive call to follow redirect
                        this.downloadFile(redirectUrl).then(resolve).catch(reject);
                        return;
                    }
                }

                const chunks: Buffer[] = [];

                res.on('data', (chunk: Buffer) => {
                    chunks.push(chunk);
                });

                res.on('end', () => {
                    if (res.statusCode && res.statusCode >= 400) {
                        this.logger.error(`[GitHubAdapter] Download failed: HTTP ${res.statusCode}`);
                        this.logger.error(`[GitHubAdapter] URL: ${url}`);
                        this.logger.error(`[GitHubAdapter] Auth method: ${this.authMethod}`);
                        reject(new Error(`Download failed: ${res.statusCode} ${res.statusMessage}`));
                        return;
                    }
                    this.logger.debug(`[GitHubAdapter] Download complete: ${chunks.length} chunks, ${Buffer.concat(chunks).length} bytes`);
                    resolve(Buffer.concat(chunks));
                });
            }).on('error', (error) => {
                this.logger.error(`[GitHubAdapter] Download error: ${error.message}`);
                reject(new Error(`Download failed: ${error.message}`));
            });
        });
    }

    /**
     * Fetch bundles from GitHub releases
     * Scans all releases in the repository and creates Bundle objects for those
     * that contain both a deployment manifest and a bundle archive.
     * 
     * @returns Promise resolving to array of Bundle objects
     * @throws Error if GitHub API request fails or authentication issues occur
     */
    async fetchBundles(): Promise<Bundle[]> {
        const { owner, repo } = this.parseGitHubUrl();
        const url = `${this.apiBase}/repos/${owner}/${repo}/releases`;

        try {
            const releases: GitHubRelease[] = await this.makeRequest(url);
            const bundles: Bundle[] = [];

            for (const release of releases) {
                // Look for deployment manifest in release assets
                const manifestAsset = release.assets.find(a => 
                    a.name === 'deployment-manifest.yml' || 
                    a.name === 'deployment-manifest.yaml' ||
                    a.name === 'deployment-manifest.json'
                );

                if (!manifestAsset) {
                    continue; // Skip releases without manifest
                }

                // Find bundle archive (zip file)
                const bundleAsset = release.assets.find(a => 
                    a.name.endsWith('.zip') || 
                    a.name.endsWith('.tar.gz')
                );

                if (!bundleAsset) {
                    continue; // Skip releases without bundle archive
                }

                // Create bundle metadata
                const bundle: Bundle = {
                    id: `${owner}-${repo}-${release.tag_name}`,
                    name: release.name || `${repo} ${release.tag_name}`,
                    version: release.tag_name.replace(/^v/, ''),
                    description: this.extractDescription(release.body),
                    author: owner,
                    sourceId: this.source.id,
                    environments: this.extractEnvironments(release.body),
                    tags: this.extractTags(release.body),
                    lastUpdated: release.published_at,
                    size: this.formatSize(bundleAsset.size),
                    dependencies: [],
                    license: 'Unknown', // Would need to fetch from repo
                    manifestUrl: manifestAsset.browser_download_url,
                    downloadUrl: bundleAsset.browser_download_url,
                    repository: this.source.url,
                };

                bundles.push(bundle);
            }

            return bundles;
        } catch (error) {
            throw new Error(`Failed to fetch bundles from GitHub: ${error}`);
        }
    }

    /**
     * Download a bundle from GitHub release assets
     * 
     * @param bundle - Bundle object containing downloadUrl
     * @returns Promise resolving to Buffer containing bundle ZIP file
     * @throws Error if download fails or network issues occur
     */
    async downloadBundle(bundle: Bundle): Promise<Buffer> {
        try {
            return await this.downloadFile(bundle.downloadUrl);
        } catch (error) {
            throw new Error(`Failed to download bundle: ${error}`);
        }
    }

    /**
     * Fetch repository metadata from GitHub API
     * Retrieves repository information including name, description, and release count.
     * 
     * @returns Promise resolving to SourceMetadata object
     * @throws Error if repository not found or API request fails
     */
    async fetchMetadata(): Promise<SourceMetadata> {
        const { owner, repo } = this.parseGitHubUrl();
        const url = `${this.apiBase}/repos/${owner}/${repo}`;

        try {
            const repoData: any = await this.makeRequest(url);
            const releasesUrl = `${this.apiBase}/repos/${owner}/${repo}/releases`;
            const releases: GitHubRelease[] = await this.makeRequest(releasesUrl);

            return {
                name: repoData.name,
                description: repoData.description || '',
                bundleCount: releases.length,
                lastUpdated: repoData.updated_at,
                version: '1.0.0', // Could extract from latest release
            };
        } catch (error) {
            throw new Error(`Failed to fetch GitHub metadata: ${error}`);
        }
    }

    /**
     * Validate GitHub repository accessibility
     * Checks if the repository exists and is accessible with current authentication.
     * 
     * @returns Promise resolving to ValidationResult with status and any errors/warnings
     */
    async validate(): Promise<ValidationResult> {
        try {
            const { owner, repo } = this.parseGitHubUrl();
            const url = `${this.apiBase}/repos/${owner}/${repo}`;
            
            await this.makeRequest(url);
            
            // Try to fetch releases
            const releasesUrl = `${this.apiBase}/repos/${owner}/${repo}/releases`;
            const releases: GitHubRelease[] = await this.makeRequest(releasesUrl);

            return {
                valid: true,
                errors: [],
                warnings: releases.length === 0 ? ['No releases found in repository'] : [],
                bundlesFound: releases.length,
            };
        } catch (error) {
            return {
                valid: false,
                errors: [`GitHub validation failed: ${error}`],
                warnings: [],
                bundlesFound: 0,
            };
        }
    }

    /**
     * Get manifest URL for a bundle
     * Constructs the GitHub release asset URL for the deployment manifest.
     * 
     * @param bundleId - Bundle identifier (not used, URL based on repo)
     * @param version - Optional version tag (defaults to 'latest')
     * @returns URL string pointing to deployment-manifest.json in release assets
     */
    getManifestUrl(bundleId: string, version?: string): string {
        const { owner, repo } = this.parseGitHubUrl();
        const tag = version ? `v${version}` : 'latest';
        return `https://github.com/${owner}/${repo}/releases/download/${tag}/deployment-manifest.json`;
    }

    /**
     * Get download URL for a bundle
     * Constructs the GitHub release asset URL for the bundle ZIP file.
     * 
     * @param bundleId - Bundle identifier (not used, URL based on repo)
     * @param version - Optional version tag (defaults to 'latest')
     * @returns URL string pointing to bundle.zip in release assets
     */
    getDownloadUrl(bundleId: string, version?: string): string {
        const { owner, repo } = this.parseGitHubUrl();
        const tag = version ? `v${version}` : 'latest';
        return `https://github.com/${owner}/${repo}/releases/download/${tag}/bundle.zip`;
    }

    /**
     * Get the authentication method currently in use
     */
    public getAuthenticationMethod(): string {
        return this.authMethod;
    }

    /**
     * Extract description from release body
     */
    private extractDescription(body: string): string {
        if (!body) {
            return '';
        }
        
        // Take first paragraph
        const lines = body.split('\n');
        const descLines = [];
        
        for (const line of lines) {
            if (line.trim() === '' && descLines.length > 0) {
                break;
            }
            if (line.trim()) {
                descLines.push(line.trim());
            }
        }
        
        return descLines.join(' ').substring(0, 200);
    }

    /**
     * Extract environments from release body
     */
    private extractEnvironments(body: string): string[] {
        const envs = [];
        const envRegex = /(?:environments?|platforms?):\s*([^\n]+)/i;
        const match = body?.match(envRegex);
        
        if (match) {
            const envString = match[1];
            envs.push(...envString.split(/[,\s]+/).filter(e => e.trim()));
        }
        
        return envs.length > 0 ? envs : ['vscode']; // Default to vscode
    }

    /**
     * Extract tags from release body
     */
    private extractTags(body: string): string[] {
        const tags = [];
        const tagRegex = /(?:tags?):\s*([^\n]+)/i;
        const match = body?.match(tagRegex);
        
        if (match) {
            const tagString = match[1];
            tags.push(...tagString.split(/[,\s]+/).filter(t => t.trim()));
        }
        
        return tags;
    }

    /**
     * Format byte size to human readable
     */
    private formatSize(bytes: number): string {
        if (bytes < 1024) {
            return `${bytes} B`;
        }
        if (bytes < 1024 * 1024) {
            return `${(bytes / 1024).toFixed(1)} KB`;
        }
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }
}

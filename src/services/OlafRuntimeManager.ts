/**
 * OlafRuntimeManager
 * 
 * Manages OLAF runtime installation and lifecycle using a user-space installation 
 * with project-level symbolic links.
 * 
 * Installation Strategy:
 * - User-Space Installation: Install runtime once in user's global extension storage
 * - Project-Level Links: Create symbolic links in workspace for project-specific access
 * - Version Management: Support multiple runtime versions with automatic cleanup
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as https from 'https';
import * as os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import AdmZip = require('adm-zip');
import { Logger } from '../utils/logger';
import { OlafRuntimeInfo, OlafWorkspaceConfig } from '../types/olaf';

const execAsync = promisify(exec);

/**
 * Cache TTL for runtime status checks (5 minutes)
 */
const RUNTIME_STATUS_CACHE_TTL = 5 * 60 * 1000;

/**
 * Command timeout for external commands (30 seconds)
 */
const COMMAND_TIMEOUT = 30 * 1000;

/**
 * Maximum download size for runtime bundles (500MB)
 */
const MAX_DOWNLOAD_SIZE = 500 * 1024 * 1024;

/**
 * OlafRuntimeManager - Singleton manager for OLAF runtime
 */
export class OlafRuntimeManager {
    private static instance: OlafRuntimeManager | null = null;
    private logger: Logger;
    private context: vscode.ExtensionContext | undefined;
    private runtimeStatusCache: Map<string, { info: OlafRuntimeInfo; timestamp: number }> = new Map();
    private workspaceConfigCache: Map<string, OlafWorkspaceConfig> = new Map();

    private constructor() {
        this.logger = Logger.getInstance();
    }

    /**
     * Get singleton instance
     */
    static getInstance(): OlafRuntimeManager {
        if (!OlafRuntimeManager.instance) {
            OlafRuntimeManager.instance = new OlafRuntimeManager();
        }
        return OlafRuntimeManager.instance;
    }

    /**
     * Initialize manager with extension context
     */
    initialize(context: vscode.ExtensionContext): void {
        this.context = context;
        this.logger.info('[OlafRuntime] Manager initialized');
    }

    /**
     * Detect current IDE type
     * Uses multiple detection methods for reliability
     */
    private detectIDE(): 'vscode' | 'kiro' | 'windsurf' {
        // Method 1: Check executable path
        const executablePath = process.execPath.toLowerCase();
        if (executablePath.includes('kiro')) {
            this.logger.debug('[OlafRuntime] IDE detected via executable path: Kiro');
            return 'kiro';
        }
        if (executablePath.includes('windsurf')) {
            this.logger.debug('[OlafRuntime] IDE detected via executable path: Windsurf');
            return 'windsurf';
        }

        // Method 2: Check environment variables
        const env = process.env;
        if (env.KIRO_PID || env.KIRO_IPC_HOOK) {
            this.logger.debug('[OlafRuntime] IDE detected via environment: Kiro');
            return 'kiro';
        }
        if (env.WINDSURF_PID || env.WINDSURF_IPC_HOOK) {
            this.logger.debug('[OlafRuntime] IDE detected via environment: Windsurf');
            return 'windsurf';
        }

        // Method 3: Check VSCode API app name
        try {
            const appName = vscode.env.appName?.toLowerCase();
            if (appName?.includes('kiro')) {
                this.logger.debug('[OlafRuntime] IDE detected via VSCode API: Kiro');
                return 'kiro';
            }
            if (appName?.includes('windsurf')) {
                this.logger.debug('[OlafRuntime] IDE detected via VSCode API: Windsurf');
                return 'windsurf';
            }
        } catch (error) {
            this.logger.warn('[OlafRuntime] Failed to detect IDE via VSCode API', error as Error);
        }

        // Default to VSCode
        this.logger.debug('[OlafRuntime] IDE detected: VSCode (default)');
        return 'vscode';
    }

    /**
     * Get user runtime path for a specific version
     */
    private getUserRuntimePath(version: string): string {
        if (!this.context) {
            throw new Error('OlafRuntimeManager not initialized. Call initialize() first.');
        }
        
        const globalStoragePath = this.context.globalStorageUri.fsPath;
        return path.join(globalStoragePath, 'olaf-runtime', version);
    }

    /**
     * Get workspace runtime path (where symbolic links will be created)
     */
    private getWorkspaceRuntimePath(workspacePath: string): string {
        return workspacePath;
    }

    /**
     * Get IDE-specific folder name for symbolic links
     */
    private getIdeSpecificFolderName(): string {
        const ide = this.detectIDE();
        return `.${ide}`;
    }

    /**
     * Check if runtime is installed for a specific version
     */
    isRuntimeInstalled(version: string = 'latest'): boolean {
        try {
            const runtimePath = this.getUserRuntimePath(version);
            const olafPath = path.join(runtimePath, '.olaf');
            const idePath = path.join(runtimePath, this.getIdeSpecificFolderName());
            
            return fs.existsSync(olafPath) && fs.existsSync(idePath);
        } catch (error) {
            this.logger.error(`[OlafRuntime] Error checking runtime installation: ${error}`);
            return false;
        }
    }

    /**
     * Get runtime information for a specific version
     */
    async getRuntimeInfo(version: string = 'latest', forceRefresh: boolean = false): Promise<OlafRuntimeInfo> {
        const cacheKey = version;
        const cached = this.runtimeStatusCache.get(cacheKey);
        
        // Return cached result if valid and not forcing refresh
        if (!forceRefresh && cached && Date.now() - cached.timestamp < RUNTIME_STATUS_CACHE_TTL) {
            return cached.info;
        }

        const ideType = this.detectIDE();
        const installPath = this.getUserRuntimePath(version);
        const isInstalled = this.isRuntimeInstalled(version);
        
        const info: OlafRuntimeInfo = {
            version,
            installPath,
            isInstalled,
            ideType,
            installedAt: isInstalled ? await this.getInstallationTimestamp(installPath) : undefined
        };

        // Cache the result
        this.runtimeStatusCache.set(cacheKey, {
            info,
            timestamp: Date.now()
        });

        return info;
    }

    /**
     * Get installation timestamp from runtime directory
     */
    private async getInstallationTimestamp(installPath: string): Promise<string | undefined> {
        try {
            const stats = await fs.promises.stat(installPath);
            return stats.mtime.toISOString();
        } catch (error) {
            return undefined;
        }
    }

    /**
     * Clear runtime status cache
     */
    clearCache(): void {
        this.runtimeStatusCache.clear();
        this.workspaceConfigCache.clear();
        this.logger.debug('[OlafRuntime] Cache cleared');
    }

    /**
     * Ensure runtime is installed for the current workspace
     * Downloads and installs if not present
     */
    async ensureRuntimeInstalled(workspacePath?: string): Promise<boolean> {
        const version = 'latest'; // For now, always use latest
        const runtimeInfo = await this.getRuntimeInfo(version);
        
        if (runtimeInfo.isInstalled) {
            this.logger.info(`[OlafRuntime] Runtime v${version} already installed`);
            return true;
        }

        this.logger.info(`[OlafRuntime] Runtime v${version} not found, installing...`);
        
        try {
            await this.installRuntime(version);
            
            // Verify installation
            const updatedInfo = await this.getRuntimeInfo(version, true);
            if (updatedInfo.isInstalled) {
                this.logger.info(`[OlafRuntime] Runtime v${version} installed successfully`);
                return true;
            } else {
                throw new Error('Runtime installation verification failed');
            }
        } catch (error) {
            this.logger.error(`[OlafRuntime] Failed to install runtime: ${error}`);
            return false;
        }
    }

    /**
     * Install OLAF runtime for a specific version
     */
    async installRuntime(version: string = 'latest'): Promise<void> {
        if (!this.context) {
            throw new Error('OlafRuntimeManager not initialized. Call initialize() first.');
        }

        const ideType = this.detectIDE();
        this.logger.info(`[OlafRuntime] Installing runtime v${version} for ${ideType}`);

        // Download runtime bundle
        const runtimeBuffer = await this.downloadRuntimeBundle(ideType, version);
        
        // Extract runtime to user space
        const runtimePath = this.getUserRuntimePath(version);
        await this.extractRuntime(runtimeBuffer, runtimePath);
        
        // Clear cache to reflect new installation
        this.clearCache();
        
        this.logger.info(`[OlafRuntime] Runtime v${version} installed to ${runtimePath}`);
    }

    /**
     * Download OLAF runtime bundle from GitHub releases
     */
    private async downloadRuntimeBundle(ide: string, version: string): Promise<Buffer> {
        const owner = 'AmadeusITGroup';
        const repo = 'olaf';
        
        this.logger.info(`[OlafRuntime] Attempting to download OLAF runtime for IDE: ${ide}, version: ${version}`);
        this.logger.info(`[OlafRuntime] Target repository: ${owner}/${repo}`);
        
        // Get release information
        const releaseUrl = version === 'latest' 
            ? `https://api.github.com/repos/${owner}/${repo}/releases/latest`
            : `https://api.github.com/repos/${owner}/${repo}/releases/tags/${version}`;
        
        this.logger.info(`[OlafRuntime] Fetching release info from: ${releaseUrl}`);
        
        try {
            const releaseInfo = await this.makeGitHubRequest(releaseUrl);
            const actualVersion = releaseInfo.tag_name;
            
            this.logger.info(`[OlafRuntime] Found release: ${actualVersion}`);
            this.logger.info(`[OlafRuntime] Available assets: ${releaseInfo.assets?.map((a: any) => a.name).join(', ') || 'none'}`);
        } catch (error) {
            this.logger.error(`[OlafRuntime] Failed to fetch release information: ${error}`);
            throw error;
        }
        
        const releaseInfo = await this.makeGitHubRequest(releaseUrl);
        const actualVersion = releaseInfo.tag_name;
        
        // Find IDE-specific asset using the correct naming pattern
        const assetName = `${ide}-installation-bundle-${actualVersion}.zip`;
        this.logger.info(`[OlafRuntime] Looking for IDE-specific asset: ${assetName}`);
        
        const asset = releaseInfo.assets?.find((a: any) => a.name === assetName);
        
        if (!asset) {
            // Fallback to common bundle if IDE-specific not found
            const commonAssetName = `common-${actualVersion}.zip`;
            this.logger.info(`[OlafRuntime] IDE-specific asset not found, looking for common asset: ${commonAssetName}`);
            
            const commonAsset = releaseInfo.assets?.find((a: any) => a.name === commonAssetName);
            
            if (!commonAsset) {
                throw new Error(`No runtime bundle found for ${ide} in release ${actualVersion}. Looking for: ${assetName} or ${commonAssetName}. Available assets: ${releaseInfo.assets?.map((a: any) => a.name).join(', ')}`);
            }
            
            this.logger.warn(`[OlafRuntime] IDE-specific asset not found, using common bundle: ${commonAsset.name}`);
            return await this.downloadFile(commonAsset.browser_download_url);
        }
        
        this.logger.info(`[OlafRuntime] Downloading runtime bundle: ${asset.name}`);
        return await this.downloadFile(asset.browser_download_url);
    }

    /**
     * Make authenticated GitHub API request
     */
    private async makeGitHubRequest(url: string): Promise<any> {
        return new Promise((resolve, reject) => {
            const options = {
                headers: {
                    'User-Agent': 'Prompt-Registry-Extension',
                    'Accept': 'application/vnd.github.v3+json'
                }
            };

            // Add authentication if available
            const token = this.getGitHubToken();
            if (token) {
                (options.headers as any)['Authorization'] = `token ${token}`;
            }

            https.get(url, options, (response) => {
                let data = '';
                
                response.on('data', (chunk) => {
                    data += chunk;
                });
                
                response.on('end', () => {
                    if (response.statusCode === 200) {
                        try {
                            resolve(JSON.parse(data));
                        } catch (error) {
                            this.logger.error(`[OlafRuntime] Failed to parse GitHub API response from ${url}: ${error}`);
                            this.logger.error(`[OlafRuntime] Response data: ${data.substring(0, 500)}`);
                            reject(new Error(`Failed to parse GitHub API response: ${error}`));
                        }
                    } else {
                        this.logger.error(`[OlafRuntime] GitHub API request failed for ${url}: ${response.statusCode} ${response.statusMessage}`);
                        this.logger.error(`[OlafRuntime] Response body: ${data.substring(0, 500)}`);
                        
                        if (response.statusCode === 404) {
                            reject(new Error(`Repository or release not found: ${url}. Please verify the repository exists and has releases.`));
                        } else if (response.statusCode === 403) {
                            reject(new Error(`Access denied to repository: ${url}. The repository may be private or rate limited.`));
                        } else {
                            reject(new Error(`GitHub API request failed: ${response.statusCode} ${response.statusMessage}`));
                        }
                    }
                });
            }).on('error', (error) => {
                reject(new Error(`GitHub API request failed: ${error.message}`));
            });
        });
    }

    /**
     * Get GitHub authentication token
     * Uses the same fallback chain as GitHubAdapter
     */
    private getGitHubToken(): string | undefined {
        // Try VS Code configuration first
        const config = vscode.workspace.getConfiguration('promptregistry');
        const globalToken = config.get<string>('githubToken', '');
        
        if (globalToken && globalToken.trim().length > 0) {
            return globalToken.trim();
        }

        // Could extend to try VSCode auth session or gh CLI like GitHubAdapter
        // For now, just use configuration token
        return undefined;
    }

    /**
     * Download file from URL with progress tracking
     */
    private async downloadFile(url: string): Promise<Buffer> {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Download timeout'));
            }, COMMAND_TIMEOUT);

            https.get(url, (response) => {
                // Handle redirects
                if (response.statusCode === 301 || response.statusCode === 302) {
                    clearTimeout(timeout);
                    const redirectUrl = response.headers.location;
                    if (redirectUrl) {
                        this.downloadFile(redirectUrl).then(resolve).catch(reject);
                        return;
                    }
                }

                if (response.statusCode !== 200) {
                    clearTimeout(timeout);
                    reject(new Error(`Download failed: HTTP ${response.statusCode}`));
                    return;
                }

                const contentLength = parseInt(response.headers['content-length'] || '0', 10);
                if (contentLength > MAX_DOWNLOAD_SIZE) {
                    clearTimeout(timeout);
                    reject(new Error(`File too large: ${contentLength} bytes (max: ${MAX_DOWNLOAD_SIZE})`));
                    return;
                }

                const chunks: Buffer[] = [];
                let downloadedBytes = 0;

                response.on('data', (chunk: Buffer) => {
                    chunks.push(chunk);
                    downloadedBytes += chunk.length;
                    
                    if (downloadedBytes > MAX_DOWNLOAD_SIZE) {
                        clearTimeout(timeout);
                        reject(new Error(`Download size exceeded limit: ${downloadedBytes} bytes`));
                        return;
                    }
                });

                response.on('end', () => {
                    clearTimeout(timeout);
                    const buffer = Buffer.concat(chunks);
                    this.logger.debug(`[OlafRuntime] Downloaded ${buffer.length} bytes`);
                    resolve(buffer);
                });

                response.on('error', (error) => {
                    clearTimeout(timeout);
                    reject(new Error(`Download failed: ${error.message}`));
                });
            }).on('error', (error) => {
                clearTimeout(timeout);
                reject(new Error(`Download request failed: ${error.message}`));
            });
        });
    }

    /**
     * Extract runtime bundle to target directory
     */
    private async extractRuntime(buffer: Buffer, targetPath: string): Promise<void> {
        try {
            // Ensure target directory exists
            await fs.promises.mkdir(targetPath, { recursive: true });
            
            // Extract ZIP archive
            const zip = new AdmZip(buffer);
            zip.extractAllTo(targetPath, true);
            
            // Verify extraction
            const olafPath = path.join(targetPath, '.olaf');
            const idePath = path.join(targetPath, this.getIdeSpecificFolderName());
            
            if (!fs.existsSync(olafPath)) {
                throw new Error('Runtime extraction failed: .olaf directory not found');
            }
            
            // IDE-specific directory is optional for generic bundles
            if (!fs.existsSync(idePath)) {
                this.logger.warn(`[OlafRuntime] IDE-specific directory not found: ${idePath}`);
                // Create empty IDE directory as placeholder
                await fs.promises.mkdir(idePath, { recursive: true });
            }
            
            this.logger.debug(`[OlafRuntime] Runtime extracted to ${targetPath}`);
        } catch (error) {
            throw new Error(`Runtime extraction failed: ${(error as Error).message}`);
        }
    }

    /**
     * Create workspace symbolic links to runtime
     */
    async createWorkspaceLinks(workspacePath: string, version: string = 'latest'): Promise<void> {
        if (!this.context) {
            throw new Error('OlafRuntimeManager not initialized. Call initialize() first.');
        }

        // Ensure runtime is installed
        const runtimeInfo = await this.getRuntimeInfo(version);
        if (!runtimeInfo.isInstalled) {
            throw new Error(`Runtime v${version} is not installed. Install it first.`);
        }

        const runtimePath = this.getUserRuntimePath(version);
        const workspaceOlafPath = path.join(workspacePath, '.olaf');
        const workspaceIdePath = path.join(workspacePath, this.getIdeSpecificFolderName());
        
        this.logger.info(`[OlafRuntime] Creating workspace links in ${workspacePath}`);

        try {
            // Create symbolic link for .olaf directory
            await this.createSymbolicLink(
                path.join(runtimePath, '.olaf'),
                workspaceOlafPath
            );

            // Create symbolic link for IDE-specific directory
            await this.createSymbolicLink(
                path.join(runtimePath, this.getIdeSpecificFolderName()),
                workspaceIdePath
            );

            // Cache workspace configuration
            const config: OlafWorkspaceConfig = {
                workspacePath,
                runtimeVersion: version,
                hasSymbolicLinks: true,
                symbolicLinks: {
                    olafPath: workspaceOlafPath,
                    idePath: workspaceIdePath
                },
                configuredAt: new Date().toISOString()
            };
            
            this.workspaceConfigCache.set(workspacePath, config);
            
            this.logger.info(`[OlafRuntime] Workspace links created successfully`);
        } catch (error) {
            this.logger.error(`[OlafRuntime] Failed to create workspace links: ${error}`);
            throw error;
        }
    }

    /**
     * Create a symbolic link with conflict detection and fallback
     */
    private async createSymbolicLink(source: string, target: string): Promise<void> {
        try {
            // Check if target already exists
            if (fs.existsSync(target)) {
                const stats = await fs.promises.lstat(target);
                
                if (stats.isSymbolicLink()) {
                    // Check if it points to the correct location
                    const currentTarget = await fs.promises.readlink(target);
                    const resolvedCurrent = path.resolve(path.dirname(target), currentTarget);
                    const resolvedSource = path.resolve(source);
                    
                    if (resolvedCurrent === resolvedSource) {
                        this.logger.debug(`[OlafRuntime] Symbolic link already exists and is correct: ${target}`);
                        return;
                    } else {
                        this.logger.warn(`[OlafRuntime] Symbolic link exists but points to wrong location: ${target} -> ${currentTarget}`);
                        await fs.promises.unlink(target);
                    }
                } else {
                    // Handle existing file/directory conflict
                    await this.handleExistingPath(target);
                }
            }

            // Ensure source exists
            if (!fs.existsSync(source)) {
                throw new Error(`Source path does not exist: ${source}`);
            }

            // Create the symbolic link
            await fs.promises.symlink(source, target, 'dir');
            this.logger.debug(`[OlafRuntime] Created symbolic link: ${target} -> ${source}`);
            
        } catch (error) {
            // If symbolic link creation fails, try fallback to directory copying
            if ((error as NodeJS.ErrnoException).code === 'EPERM' || 
                (error as NodeJS.ErrnoException).code === 'ENOTSUP') {
                this.logger.warn(`[OlafRuntime] Symbolic link not supported, falling back to directory copy: ${target}`);
                await this.fallbackToCopy(source, target);
            } else {
                throw new Error(`Failed to create symbolic link ${target}: ${(error as Error).message}`);
            }
        }
    }

    /**
     * Handle existing file or directory at target path
     */
    private async handleExistingPath(target: string): Promise<void> {
        const stats = await fs.promises.lstat(target);
        const targetName = path.basename(target);
        
        if (stats.isDirectory()) {
            // Check if directory is empty
            const entries = await fs.promises.readdir(target);
            if (entries.length === 0) {
                // Remove empty directory
                await fs.promises.rmdir(target);
                this.logger.debug(`[OlafRuntime] Removed empty directory: ${target}`);
            } else {
                // Backup non-empty directory
                const backupPath = `${target}.backup.${Date.now()}`;
                await fs.promises.rename(target, backupPath);
                this.logger.warn(`[OlafRuntime] Backed up existing directory: ${target} -> ${backupPath}`);
            }
        } else {
            // Backup existing file
            const backupPath = `${target}.backup.${Date.now()}`;
            await fs.promises.rename(target, backupPath);
            this.logger.warn(`[OlafRuntime] Backed up existing file: ${target} -> ${backupPath}`);
        }
    }

    /**
     * Fallback to copying directory when symbolic links are not supported
     */
    private async fallbackToCopy(source: string, target: string): Promise<void> {
        try {
            await this.copyDirectory(source, target);
            this.logger.info(`[OlafRuntime] Copied directory as fallback: ${target}`);
        } catch (error) {
            throw new Error(`Fallback directory copy failed: ${(error as Error).message}`);
        }
    }

    /**
     * Recursively copy directory
     */
    private async copyDirectory(source: string, target: string): Promise<void> {
        await fs.promises.mkdir(target, { recursive: true });
        
        const entries = await fs.promises.readdir(source, { withFileTypes: true });
        
        for (const entry of entries) {
            const sourcePath = path.join(source, entry.name);
            const targetPath = path.join(target, entry.name);
            
            if (entry.isDirectory()) {
                await this.copyDirectory(sourcePath, targetPath);
            } else {
                await fs.promises.copyFile(sourcePath, targetPath);
            }
        }
    }

    /**
     * Check if workspace has OLAF runtime links
     */
    async hasWorkspaceLinks(workspacePath: string): Promise<boolean> {
        const olafPath = path.join(workspacePath, '.olaf');
        const idePath = path.join(workspacePath, this.getIdeSpecificFolderName());
        
        try {
            const olafExists = fs.existsSync(olafPath);
            const ideExists = fs.existsSync(idePath);
            
            return olafExists && ideExists;
        } catch (error) {
            return false;
        }
    }

    /**
     * Get workspace configuration
     */
    getWorkspaceConfig(workspacePath: string): OlafWorkspaceConfig | undefined {
        return this.workspaceConfigCache.get(workspacePath);
    }

    /**
     * Remove workspace links
     */
    async removeWorkspaceLinks(workspacePath: string): Promise<void> {
        const olafPath = path.join(workspacePath, '.olaf');
        const idePath = path.join(workspacePath, this.getIdeSpecificFolderName());
        
        try {
            // Remove .olaf link/directory
            if (fs.existsSync(olafPath)) {
                const stats = await fs.promises.lstat(olafPath);
                if (stats.isSymbolicLink()) {
                    await fs.promises.unlink(olafPath);
                    this.logger.debug(`[OlafRuntime] Removed symbolic link: ${olafPath}`);
                } else {
                    // If it's a copied directory, remove it
                    await fs.promises.rm(olafPath, { recursive: true, force: true });
                    this.logger.debug(`[OlafRuntime] Removed copied directory: ${olafPath}`);
                }
            }

            // Remove IDE-specific link/directory
            if (fs.existsSync(idePath)) {
                const stats = await fs.promises.lstat(idePath);
                if (stats.isSymbolicLink()) {
                    await fs.promises.unlink(idePath);
                    this.logger.debug(`[OlafRuntime] Removed symbolic link: ${idePath}`);
                } else {
                    // If it's a copied directory, remove it
                    await fs.promises.rm(idePath, { recursive: true, force: true });
                    this.logger.debug(`[OlafRuntime] Removed copied directory: ${idePath}`);
                }
            }

            // Clear workspace config cache
            this.workspaceConfigCache.delete(workspacePath);
            
            this.logger.info(`[OlafRuntime] Workspace links removed from ${workspacePath}`);
        } catch (error) {
            this.logger.error(`[OlafRuntime] Failed to remove workspace links: ${error}`);
            throw error;
        }
    }

    /**
     * Reset singleton instance (for testing)
     */
    static resetInstance(): void {
        OlafRuntimeManager.instance = null;
    }
}
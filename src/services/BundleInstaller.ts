/**
 * Bundle Installer Service
 * Handles downloading, extracting, and installing bundle files
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import * as https from 'https';
import * as yaml from 'js-yaml';
import AdmZip = require('adm-zip');
import { Logger } from '../utils/logger';
import { Bundle, InstallOptions, InstalledBundle, DeploymentManifest } from '../types/registry';
import { CopilotSyncService } from './CopilotSyncService';

import { McpServerManager } from './McpServerManager';
const mkdir = promisify(fs.mkdir);
const writeFile = promisify(fs.writeFile);
const readFile = promisify(fs.readFile);
const readdir = promisify(fs.readdir);
const stat = promisify(fs.stat);
const unlink = promisify(fs.unlink);
const rmdir = promisify(fs.rmdir);

/**
 * Bundle Installer
 */
export class BundleInstaller {
    private logger: Logger;
    private copilotSync: CopilotSyncService;
    private mcpManager: McpServerManager;

    constructor(private context: vscode.ExtensionContext) {
        this.logger = Logger.getInstance();
        this.copilotSync = new CopilotSyncService(context);
        this.mcpManager = new McpServerManager();
    }

    /**
     * Install a bundle
     */
    async install(
        bundle: Bundle,
        downloadUrl: string,
        options: InstallOptions
    ): Promise<InstalledBundle> {
        this.logger.info(`Installing bundle: ${bundle.name} v${bundle.version}`);

        try {
            // Check if this is a local bundle (file:// URL)
            const isLocalBundle = downloadUrl.startsWith('file://');
            this.logger.debug(`Bundle type: ${isLocalBundle ? 'local' : 'remote'}`);

            let extractDir: string;
            let tempDir: string | null = null;

            if (isLocalBundle) {
                // Local bundle: use the directory directly
                extractDir = downloadUrl.replace('file://', '');
                this.logger.debug(`Using local bundle directory: ${extractDir}`);
            } else {
                // Remote bundle: download and extract
                // Step 1: Create temp directory
                tempDir = await this.createTempDir();
                this.logger.debug(`Created temp directory: ${tempDir}`);

                // Step 2: Download bundle
                const bundleFile = path.join(tempDir, `${bundle.id}.zip`);
                await this.downloadFile(downloadUrl, bundleFile);
                this.logger.debug(`Downloaded bundle to: ${bundleFile}`);

                // Step 3: Extract bundle
                extractDir = path.join(tempDir, 'extracted');
                await this.extractBundle(bundleFile, extractDir);
                this.logger.debug(`Extracted bundle to: ${extractDir}`);
            }

            // Step 4: Validate bundle structure
            const manifest = await this.validateBundle(extractDir, bundle);
            this.logger.debug('Bundle validation passed');

            // Step 5: Get installation directory
            const installDir = this.getInstallDirectory(bundle.id, options.scope);
            await this.ensureDirectory(installDir);
            this.logger.debug(`Installation directory: ${installDir}`);

            // Step 6: Copy files to installation directory
            await this.copyBundleFiles(extractDir, installDir);
            this.logger.debug('Files copied to installation directory');

            // Step 7: Clean up temp directory (only for remote bundles)
            if (tempDir) {
                await this.cleanupTempDir(tempDir);
                this.logger.debug('Temp directory cleaned up');
            }

            // Step 8: Create installation record
            const installed: InstalledBundle = {
                bundleId: bundle.id,
                version: bundle.version,
                installedAt: new Date().toISOString(),
                scope: options.scope,
                installPath: installDir,
                manifest: manifest,
            };

            // Step 9: Sync to GitHub Copilot native directory
            // Step 10: Install MCP servers if defined
            await this.installMcpServers(bundle.id, bundle.version, installDir, manifest, options.scope);
            this.logger.debug('MCP servers installation completed');
            await this.copilotSync.syncBundle(bundle.id, installDir);
            // Step 10: Install MCP servers if defined
            await this.installMcpServers(bundle.id, bundle.version, installDir, manifest, options.scope);
            this.logger.debug('MCP servers installation completed');
            this.logger.debug('Synced to GitHub Copilot');
            // Step 10: Install MCP servers if defined
            await this.installMcpServers(bundle.id, bundle.version, installDir, manifest, options.scope);
            this.logger.debug('MCP servers installation completed');

            this.logger.info(`Bundle installed successfully: ${bundle.name}`);
            return installed;

        } catch (error) {
            this.logger.error('Bundle installation failed', error as Error);
            throw error;
        }
    }

    /**
     * Install a bundle from a Buffer (for adapters that create bundles on-the-fly)
     */
    async installFromBuffer(
        bundle: Bundle,
        bundleBuffer: Buffer,
        options: InstallOptions
    ): Promise<InstalledBundle> {
        this.logger.info(`Installing bundle from buffer: ${bundle.name} v${bundle.version}`);

        try {
            // Step 1: Create temp directory
            const tempDir = await this.createTempDir();
            this.logger.debug(`Created temp directory: ${tempDir}`);

            // Step 2: Write buffer to temp file
            const bundleFile = path.join(tempDir, `${bundle.id}.zip`);
            await writeFile(bundleFile, bundleBuffer);
            this.logger.debug(`Wrote bundle buffer to: ${bundleFile} (${bundleBuffer.length} bytes)`);

            // Step 3: Extract bundle
            const extractDir = path.join(tempDir, 'extracted');
            await this.extractBundle(bundleFile, extractDir);
            this.logger.debug(`Extracted bundle to: ${extractDir}`);

            // Step 4: Validate bundle structure
            const manifest = await this.validateBundle(extractDir, bundle);
            this.logger.debug('Bundle validation passed');

            // Step 5: Get installation directory
            const installDir = this.getInstallDirectory(bundle.id, options.scope);
            await this.ensureDirectory(installDir);
            this.logger.debug(`Installation directory: ${installDir}`);

            // Step 6: Copy files to installation directory
            await this.copyBundleFiles(extractDir, installDir);
            this.logger.debug('Files copied to installation directory');

            // Step 7: Clean up temp directory
            await this.cleanupTempDir(tempDir);
            this.logger.debug('Temp directory cleaned up');

            // Step 8: Create installation record
            const installed: InstalledBundle = {
                bundleId: bundle.id,
                version: bundle.version,
                installedAt: new Date().toISOString(),
                scope: options.scope,
                installPath: installDir,
                manifest: manifest,
            };

            // Step 9: Sync to GitHub Copilot native directory
            // Step 10: Install MCP servers if defined
            await this.installMcpServers(bundle.id, bundle.version, installDir, manifest, options.scope);
            this.logger.debug('MCP servers installation completed');
            await this.copilotSync.syncBundle(bundle.id, installDir);
            // Step 10: Install MCP servers if defined
            await this.installMcpServers(bundle.id, bundle.version, installDir, manifest, options.scope);
            this.logger.debug('MCP servers installation completed');
            this.logger.debug('Synced to GitHub Copilot');
            // Step 10: Install MCP servers if defined
            await this.installMcpServers(bundle.id, bundle.version, installDir, manifest, options.scope);
            this.logger.debug('MCP servers installation completed');

            this.logger.info(`Bundle installed successfully from buffer: ${bundle.name}`);
            return installed;

        } catch (error) {
            this.logger.error('Bundle installation from buffer failed', error as Error);
            throw error;
        }
    }

    /**
     * Uninstall a bundle
     */
    async uninstall(installed: InstalledBundle): Promise<void> {
        this.logger.info(`Uninstalling bundle: ${installed.bundleId}`);

        try {
            // Remove from GitHub Copilot native directory
            // Uninstall MCP servers
            await this.uninstallMcpServers(installed.bundleId, installed.scope);
            this.logger.debug('MCP servers uninstalled');
            await this.copilotSync.unsyncBundle(installed.bundleId);
            this.logger.debug('Removed from GitHub Copilot');

            // Remove installation directory
            if (installed.installPath && fs.existsSync(installed.installPath)) {
                await this.removeDirectory(installed.installPath);
                this.logger.debug(`Removed directory: ${installed.installPath}`);
            }

            this.logger.info('Bundle uninstalled successfully');

        } catch (error) {
            this.logger.error('Bundle uninstallation failed', error as Error);
            throw error;
        }
    }

    /**
     * Update a bundle
     */
    async update(
        installed: InstalledBundle,
        bundle: Bundle,
        downloadUrl: string
    ): Promise<InstalledBundle> {
        this.logger.info(`Updating bundle: ${installed.bundleId} to v${bundle.version}`);

        try {
            // Uninstall old version
            await this.uninstall(installed);

            // Install new version
            const newInstalled = await this.install(bundle, downloadUrl, {
                scope: installed.scope,
                version: bundle.version
            });

            this.logger.info('Bundle updated successfully');
            return newInstalled;

        } catch (error) {
            this.logger.error('Bundle update failed', error as Error);
            throw error;
        }
    }

    // ===== Helper Methods =====

    /**
     * Create temporary directory
     */
    private async createTempDir(): Promise<string> {
        const tempBase = path.join(this.context.globalStorageUri.fsPath, 'temp');
        await this.ensureDirectory(tempBase);

        const tempDir = path.join(tempBase, `bundle-${Date.now()}`);
        await mkdir(tempDir, { recursive: true });

        return tempDir;
    }

    /**
     * Download file from URL
     */
    private async downloadFile(url: string, destination: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const file = fs.createWriteStream(destination);

            https.get(url, (response) => {
                // Handle redirects
                if (response.statusCode === 301 || response.statusCode === 302) {
                    const redirectUrl = response.headers.location;
                    if (redirectUrl) {
                        file.close();
                        this.downloadFile(redirectUrl, destination).then(resolve).catch(reject);
                        return;
                    }
                }

                if (response.statusCode !== 200) {
                    file.close();
                    reject(new Error(`Download failed with status ${response.statusCode}`));
                    return;
                }

                response.pipe(file);

                file.on('finish', () => {
                    file.close();
                    resolve();
                });

            }).on('error', (error) => {
                fs.unlink(destination, () => {
                    reject(error);
                });
            });
        });
    }

    /**
     * Extract bundle archive
     */
    private async extractBundle(bundleFile: string, extractDir: string): Promise<void> {
        await this.ensureDirectory(extractDir);

        try {
            // Use adm-zip for extraction
            const zip = new AdmZip(bundleFile);
            zip.extractAllTo(extractDir, true);

        } catch (error) {
            throw new Error(`Failed to extract bundle: ${(error as Error).message}`);
        }
    }

    /**
     * Validate bundle structure
     */
    private async validateBundle(extractDir: string, bundle: Bundle): Promise<DeploymentManifest> {
        // Check if deployment-manifest.yml exists
        const manifestPath = path.join(extractDir, 'deployment-manifest.yml');
        
        if (!fs.existsSync(manifestPath)) {
            throw new Error('Bundle missing deployment-manifest.yml');
        }

        this.logger.debug(`Validating manifest: ${manifestPath}`);

        // Validate manifest content (parse YAML)
        const manifestContent = await readFile(manifestPath, 'utf-8');
        const manifest = yaml.load(manifestContent) as any;

        // Basic validation
        if (!manifest.id || !manifest.version || !manifest.name) {
            throw new Error('Invalid deployment manifest - missing required fields');
        }

        // Verify ID matches
        if (manifest.id !== bundle.id) {
            throw new Error(`Bundle ID mismatch: expected ${bundle.id}, got ${manifest.id}`);
        }

        // Verify version matches (allow "latest" to match any)
        if (bundle.version !== 'latest' && manifest.version !== bundle.version) {
            throw new Error(`Bundle version mismatch: expected ${bundle.version}, got ${manifest.version}`);
        }

        this.logger.debug('Bundle manifest validation passed');
        
        return manifest as DeploymentManifest;
    }

    /**
     * Get installation directory for bundle
     */
    private getInstallDirectory(bundleId: string, scope: 'user' | 'workspace'): string {
        if (scope === 'user') {
            // User scope: global storage
            return path.join(this.context.globalStorageUri.fsPath, 'bundles', bundleId);
        } else {
            // Workspace scope: workspace storage
            const workspaceStorage = this.context.storageUri?.fsPath;
            if (!workspaceStorage) {
                throw new Error('Workspace storage not available');
            }
            return path.join(workspaceStorage, 'bundles', bundleId);
        }
    }

    /**
     * Copy bundle files to installation directory
     */
    private async copyBundleFiles(sourceDir: string, targetDir: string): Promise<void> {
        const files = await readdir(sourceDir);

        for (const file of files) {
            const sourcePath = path.join(sourceDir, file);
            const targetPath = path.join(targetDir, file);

            const stats = await stat(sourcePath);

            if (stats.isDirectory()) {
                await this.ensureDirectory(targetPath);
                await this.copyBundleFiles(sourcePath, targetPath);
            } else {
                const content = await readFile(sourcePath);
                await writeFile(targetPath, content);
            }
        }
    }

    /**
     * Ensure directory exists
     */
    private async ensureDirectory(dir: string): Promise<void> {
        if (!fs.existsSync(dir)) {
            await mkdir(dir, { recursive: true });
        }
    }

    /**
     * Remove directory recursively
     */
    private async removeDirectory(dir: string): Promise<void> {
        if (!fs.existsSync(dir)) {
            return;
        }

        const files = await readdir(dir);

        for (const file of files) {
            const filePath = path.join(dir, file);
            const stats = await stat(filePath);

            if (stats.isDirectory()) {
                await this.removeDirectory(filePath);
            } else {
                await unlink(filePath);
            }
        }

        await rmdir(dir);
    }

    /**
     * Clean up temporary directory
     */
    private async cleanupTempDir(tempDir: string): Promise<void> {
        try {
            await this.removeDirectory(tempDir);
        } catch (error) {
            this.logger.warn('Failed to cleanup temp directory', error as Error);
            // Don't fail the installation if cleanup fails
        }
    }

    /**
     * Install MCP servers from manifest
     */
    private async installMcpServers(
        bundleId: string,
        bundleVersion: string,
        installPath: string,
        manifest: DeploymentManifest,
        scope: 'user' | 'workspace'
    ): Promise<void> {
        if (!manifest.mcpServers || Object.keys(manifest.mcpServers).length === 0) {
            this.logger.debug(`No MCP servers to install for bundle ${bundleId}`);
            return;
        }

        this.logger.info(`Installing MCP servers for bundle ${bundleId}`);

        try {
            const result = await this.mcpManager.installServers(
                bundleId,
                bundleVersion,
                installPath,
                manifest.mcpServers,
                {
                    scope,
                    overwrite: false,
                    skipOnConflict: false,
                    createBackup: true
                }
            );

            if (!result.success) {
                this.logger.warn(`MCP server installation had issues: ${result.errors?.join(', ')}`);
            } else {
                this.logger.info(`Successfully installed ${result.serversInstalled} MCP servers`);
            }

            if (result.warnings && result.warnings.length > 0) {
                this.logger.warn(`MCP installation warnings: ${result.warnings.join(', ')}`);
            }
        } catch (error) {
            this.logger.error(`Failed to install MCP servers for bundle ${bundleId}`, error as Error);
            // Don't fail the entire bundle installation if MCP installation fails
        }
    }

    /**
     * Uninstall MCP servers for a bundle
     */
    private async uninstallMcpServers(bundleId: string, scope: 'user' | 'workspace'): Promise<void> {
        this.logger.info(`Uninstalling MCP servers for bundle ${bundleId}`);

        try {
            const result = await this.mcpManager.uninstallServers(bundleId, scope);

            if (!result.success) {
                this.logger.warn(`MCP server uninstallation had issues: ${result.errors?.join(', ')}`);
            } else if (result.serversRemoved > 0) {
                this.logger.info(`Successfully uninstalled ${result.serversRemoved} MCP servers`);
            } else {
                this.logger.debug(`No MCP servers found for bundle ${bundleId}`);
            }
        } catch (error) {
            this.logger.error(`Failed to uninstall MCP servers for bundle ${bundleId}`, error as Error);
            // Don't fail the entire bundle uninstallation if MCP uninstallation fails
        }
    }
}

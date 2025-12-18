/**
 * Bundle Installer Service
 * Handles extracting and installing bundle files
 * 
 * Architecture Note:
 * - Remote bundles use the unified architecture: adapter.downloadBundle() -> installFromBuffer()
 * - Each adapter (GitHub, HTTP, Local, etc.) handles its own download logic and authentication
 * - This service focuses on extraction, validation, and installation from Buffer
 * - The install() method is only used for local file:// URLs
 * - The downloadFile() method has been removed as downloads are now handled by adapters
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
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
     * Install a bundle from a local file:// URL
     * Note: Remote bundles should use installFromBuffer() via the unified adapter architecture
     * @deprecated for remote bundles - use installFromBuffer() instead
     */
    async install(
        bundle: Bundle,
        downloadUrl: string,
        options: InstallOptions
    ): Promise<InstalledBundle> {
        this.logger.info(`Installing bundle: ${bundle.name} v${bundle.version}`);

        try {
            // This method is now only used for local file:// URLs
            // Remote bundles use the unified architecture: adapter.downloadBundle() -> installFromBuffer()
            if (!downloadUrl.startsWith('file://')) {
                throw new Error('install() method is only for local file:// URLs. Use installFromBuffer() for remote bundles.');
            }

            // Local bundle: use the directory directly
            const extractDir = downloadUrl.replace('file://', '');
            this.logger.debug(`Using local bundle directory: ${extractDir}`);

            // Validate bundle structure
            const manifest = await this.validateBundle(extractDir, bundle);
            this.logger.debug('Bundle validation passed');

            // Get installation directory (pass undefined for sourceType since it's not available in install method)
            const installDir = this.getInstallDirectory(bundle.id, options.scope, undefined, undefined, bundle.name);
            await this.ensureDirectory(installDir);
            this.logger.debug(`Installation directory: ${installDir}`);

            // Copy files to installation directory
            await this.copyBundleFiles(extractDir, installDir);
            this.logger.debug('Files copied to installation directory');

            // Create installation record
            const installed: InstalledBundle = {
                bundleId: bundle.id,
                version: bundle.version,
                installedAt: new Date().toISOString(),
                scope: options.scope,
                profileId: options.profileId,
                installPath: installDir,
                manifest: manifest,
                sourceId: bundle.sourceId,
                sourceType: undefined,  // Will be set by RegistryManager
            };

            // Install MCP servers if defined
            await this.installMcpServers(bundle.id, bundle.version, installDir, manifest, options.scope);
            this.logger.debug('MCP servers installation completed');
            
            // Sync to GitHub Copilot native directory
            await this.copilotSync.syncBundle(bundle.id, installDir);
            this.logger.debug('Synced to GitHub Copilot');

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
        options: InstallOptions,
        sourceType?: string,
        sourceName?: string
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
            const installDir = this.getInstallDirectory(bundle.id, options.scope, sourceType, sourceName, bundle.name);
            await this.ensureDirectory(installDir);
            this.logger.debug(`Installation directory: ${installDir}`);

            // Step 6: Copy files to installation directory
            // For OLAF bundles, the ZIP contains a skill folder, so we need to copy from inside it
            const isOlafBundle = sourceType === 'olaf' || bundle.id.startsWith('olaf-');
            if (isOlafBundle && bundle.name) {
                // Check if there's a subfolder with the skill name
                const skillSubfolder = path.join(extractDir, bundle.name);
                if (require('fs').existsSync(skillSubfolder)) {
                    this.logger.debug(`[BundleInstaller] OLAF bundle detected, copying from skill subfolder: ${skillSubfolder}`);
                    await this.copyBundleFiles(skillSubfolder, installDir);
                } else {
                    // Fallback to normal copy if subfolder doesn't exist
                    await this.copyBundleFiles(extractDir, installDir);
                }
            } else {
                await this.copyBundleFiles(extractDir, installDir);
            }
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
                profileId: options.profileId,
                installPath: installDir,
                manifest: manifest,
                sourceId: bundle.sourceId,
                sourceType: undefined,  // Will be set by RegistryManager
            };

            // Step 9: Install MCP servers if defined
            await this.installMcpServers(bundle.id, bundle.version, installDir, manifest, options.scope);
            this.logger.debug('MCP servers installation completed');
            
            // Step 10: Sync to GitHub Copilot native directory
            await this.copilotSync.syncBundle(bundle.id, installDir);
            this.logger.debug('Synced to GitHub Copilot');

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
     * Note: This method expects a Buffer for remote bundles via the unified architecture
     * @deprecated - RegistryManager should handle updates directly using downloadBundle() + installFromBuffer()
     */
    async update(
        installed: InstalledBundle,
        bundle: Bundle,
        bundleBuffer: Buffer
    ): Promise<InstalledBundle> {
        this.logger.info(`Updating bundle: ${installed.bundleId} to v${bundle.version}`);

        try {
            // Uninstall old version
            await this.uninstall(installed);

            // Install new version using the unified architecture
            const newInstalled = await this.installFromBuffer(bundle, bundleBuffer, {
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
            // For local bundles (like awesome-copilot), deployment-manifest.yml is optional
            // Create a minimal manifest from the bundle info
            this.logger.info(`No deployment-manifest.yml found for ${bundle.id}, creating minimal manifest`);
            return {
                common: {
                    directories: [],
                    files: [],
                    include_patterns: ['**/*'],
                    exclude_patterns: []
                },
                bundle_settings: {
                    include_common_in_environment_bundles: true,
                    create_common_bundle: true,
                    compression: 'none' as any,
                    naming: {
                        environment_bundle: bundle.id
                    }
                },
                metadata: {
                    manifest_version: '1.0',
                    description: bundle.description || bundle.name || bundle.id,
                    author: 'awesome-copilot',
                    last_updated: new Date().toISOString()
                }
            } as DeploymentManifest;
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
     * OLAF bundles are installed in .olaf/external-skills/<source-name>/<skill-name> in the workspace
     */
    private getInstallDirectory(bundleId: string, scope: 'user' | 'workspace', sourceType?: string, sourceName?: string, bundleName?: string): string {
        // Check if this is an OLAF bundle
        const isOlafBundle = sourceType === 'olaf' || bundleId.startsWith('olaf-');
        
        if (isOlafBundle) {
            // OLAF bundles must be installed in workspace .olaf/external-skills directory
            const workspaceFolders = require('vscode').workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                throw new Error('OLAF skills require an open workspace. Please open a workspace and try again.');
            }
            
            const workspacePath = workspaceFolders[0].uri.fsPath;
            
            // Use bundle name (from skill manifest) as the skill directory name
            // This ensures we use the clean skill name like "create-prompt" instead of the folder name
            const skillName = bundleName || bundleId;
            
            // Use source name for directory organization, fallback to 'default' if not provided
            const sourceDir = sourceName || 'default';
            
            this.logger.info(`[BundleInstaller] Installing OLAF skill '${skillName}' to .olaf/external-skills/${sourceDir}`);
            return path.join(workspacePath, '.olaf', 'external-skills', sourceDir, skillName);
        }
        
        // Standard bundle installation
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

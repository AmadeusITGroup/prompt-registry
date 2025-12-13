import { GitHubService } from './githubService';
import { InstallationManager, InstallationResult } from './installationManager';
import { PlatformDetector } from './platformDetector';
import { Platform, InstallationScope } from '../types/platform';
import { GitHubRelease, BundleInfo } from '../types/github';
import { Logger } from '../utils/logger';

/**
 * Update check result for EXTENSION updates
 * 
 * NOTE: This is different from bundle UpdateCheckResult in UpdateCache.ts
 * This interface is for extension/platform updates, not bundle updates.
 */
export interface UpdateCheckResult {
    hasUpdate: boolean;
    currentVersion?: string;
    latestVersion?: string;
    releaseInfo?: GitHubRelease;
    bundleInfo?: BundleInfo;
    scope?: InstallationScope;
}

/**
 * Update options
 */
export interface UpdateOptions {
    scope?: InstallationScope;
    prerelease?: boolean;
    force?: boolean;
}

/**
 * Service for managing Prompt Registry EXTENSION updates
 * 
 * NOTE: This is for updating the Prompt Registry extension/platform installation itself,
 * NOT for updating prompt bundles. For bundle updates, see:
 * - UpdateChecker (src/services/UpdateChecker.ts)
 * - UpdateScheduler (src/services/UpdateScheduler.ts)
 * - AutoUpdateService (src/services/AutoUpdateService.ts)
 */
export class ExtensionUpdateManager {
    private static instance: ExtensionUpdateManager;
    private readonly logger: Logger;
    private readonly githubService: GitHubService;
    private readonly installationManager: InstallationManager;
    private readonly platformDetector: PlatformDetector;

    private constructor() {
        this.logger = Logger.getInstance();
        this.githubService = GitHubService.getInstance();
        this.installationManager = InstallationManager.getInstance();
        this.platformDetector = PlatformDetector.getInstance();
    }

    public static getInstance(): ExtensionUpdateManager {
        if (!ExtensionUpdateManager.instance) {
            ExtensionUpdateManager.instance = new ExtensionUpdateManager();
        }
        return ExtensionUpdateManager.instance;
    }

    /**
     * Check for updates across all installed scopes
     */
    public async checkForUpdates(options: UpdateOptions = {}): Promise<UpdateCheckResult[]> {
        try {
            this.logger.info('Checking for updates...');

            // Get all installed scopes
            const installedScopes = await this.installationManager.getInstalledScopes();
            
            if (installedScopes.length === 0) {
                this.logger.info('No Prompt Registry installations found');
                return [];
            }

            // Check connectivity first
            const isConnected = await this.githubService.checkConnectivity();
            if (!isConnected) {
                throw new Error('Unable to connect to GitHub API');
            }

            // Get latest release
            const latestRelease = await this.githubService.getLatestRelease();
            const platform = await this.platformDetector.detectPlatform();
            const bundleInfo = this.githubService.findPlatformBundle(latestRelease, platform.platform);

            if (!bundleInfo) {
                throw new Error(`No bundle found for platform: ${platform.platform}`);
            }

            const results: UpdateCheckResult[] = [];

            // Check each installed scope
            for (const scope of installedScopes) {
                const updateResult = await this.checkScopeForUpdate(
                    scope,
                    latestRelease,
                    bundleInfo,
                    options
                );
                
                if (updateResult) {
                    results.push(updateResult);
                }
            }

            this.logger.info(`Update check completed. Found ${results.filter(r => r.hasUpdate).length} updates available`);
            return results;

        } catch (error) {
            this.logger.error('Failed to check for updates', error as Error);
            throw error;
        }
    }

    /**
     * Update Prompt Registry in a specific scope
     */
    public async updateScope(
        scope: InstallationScope,
        options: UpdateOptions = {},
        onProgress?: (progress: number, message: string) => void
    ): Promise<InstallationResult> {
        try {
            this.logger.info(`Starting update for scope: ${scope}`);

            // Check if update is available
            const updateCheck = await this.checkForUpdates({ scope, ...options });
            const scopeUpdate = updateCheck.find(u => u.scope === scope);

            if (!scopeUpdate || (!scopeUpdate.hasUpdate && !options.force)) {
                throw new Error(`No update available for scope: ${scope}`);
            }

            if (!scopeUpdate.bundleInfo) {
                throw new Error('Bundle information not available');
            }

            onProgress?.(10, 'Downloading update...');

            // Download the bundle
            const bundleBuffer = await this.githubService.downloadBundle(
                scopeUpdate.bundleInfo,
                (downloadProgress) => {
                    // Map download progress to 10-70% of total progress
                    const mappedProgress = 10 + (downloadProgress * 0.6);
                    onProgress?.(mappedProgress, `Downloading... ${downloadProgress.toFixed(1)}%`);
                }
            );

            onProgress?.(70, 'Preparing installation...');

            // Backup current installation if it exists
            const backupPath = await this.createBackup(scope);

            try {
                onProgress?.(75, 'Installing update...');

                // Install the update
                const installResult = await this.installationManager.installBundle(
                    bundleBuffer,
                    scopeUpdate.bundleInfo,
                    scope,
                    (installProgress, message) => {
                        // Map install progress to 75-100% of total progress
                        const mappedProgress = 75 + (installProgress * 0.25);
                        onProgress?.(mappedProgress, message);
                    }
                );

                if (installResult.success) {
                    // Clean up backup on successful installation
                    if (backupPath) {
                        await this.cleanupBackup(backupPath);
                    }
                    
                    this.logger.info(`Update completed successfully for scope: ${scope}`);
                    return installResult;
                } else {
                    throw new Error(installResult.error || 'Installation failed');
                }

            } catch (error) {
                // Restore backup on failure
                if (backupPath) {
                    await this.restoreBackup(backupPath, scope);
                }
                throw error;
            }

        } catch (error) {
            this.logger.error(`Update failed for scope: ${scope}`, error as Error);
            throw error;
        }
    }

    /**
     * Update all installed scopes
     */
    public async updateAll(
        options: UpdateOptions = {},
        onProgress?: (progress: number, message: string, scope?: InstallationScope) => void
    ): Promise<InstallationResult[]> {
        try {
            this.logger.info('Starting update for all scopes...');

            const updateChecks = await this.checkForUpdates(options);
            const scopesToUpdate = updateChecks.filter(u => u.hasUpdate || options.force);

            if (scopesToUpdate.length === 0) {
                this.logger.info('No updates available');
                return [];
            }

            const results: InstallationResult[] = [];
            const totalScopes = scopesToUpdate.length;

            for (let i = 0; i < scopesToUpdate.length; i++) {
                const scopeUpdate = scopesToUpdate[i];
                if (!scopeUpdate.scope) {continue;}

                const baseProgress = (i / totalScopes) * 100;
                const scopeProgressRange = 100 / totalScopes;

                try {
                    const result = await this.updateScope(
                        scopeUpdate.scope,
                        options,
                        (scopeProgress, message) => {
                            const totalProgress = baseProgress + (scopeProgress / 100) * scopeProgressRange;
                            onProgress?.(totalProgress, message, scopeUpdate.scope);
                        }
                    );

                    results.push(result);

                } catch (error) {
                    this.logger.error(`Failed to update scope: ${scopeUpdate.scope}`, error as Error);
                    
                    // Continue with other scopes even if one fails
                    results.push({
                        success: false,
                        installedPath: '',
                        installedFiles: [],
                        version: scopeUpdate.latestVersion || '',
                        scope: scopeUpdate.scope,
                        platform: Platform.UNKNOWN,
                        error: (error as Error).message
                    });
                }
            }

            this.logger.info(`Update all completed. ${results.filter(r => r.success).length}/${results.length} successful`);
            return results;

        } catch (error) {
            this.logger.error('Update all failed', error as Error);
            throw error;
        }
    }

    /**
     * Get update notification message
     */
    public getUpdateNotificationMessage(updateResults: UpdateCheckResult[]): string {
        const updatesAvailable = updateResults.filter(r => r.hasUpdate);
        
        if (updatesAvailable.length === 0) {
            return 'Prompt Registry is up to date';
        }

        if (updatesAvailable.length === 1) {
            const update = updatesAvailable[0];
            return `Prompt Registry update available: ${update.currentVersion} → ${update.latestVersion} (${update.scope})`;
        }

        return `Prompt Registry updates available for ${updatesAvailable.length} scopes`;
    }

    private async checkScopeForUpdate(
        scope: InstallationScope,
        latestRelease: GitHubRelease,
        bundleInfo: BundleInfo,
        options: UpdateOptions
    ): Promise<UpdateCheckResult | null> {
        try {
            // Get current installation info
            const installationInfo = await this.installationManager.getInstallationInfo(scope);
            
            if (!installationInfo) {
                this.logger.debug(`No installation found for scope: ${scope}`);
                return null;
            }

            const currentVersion = installationInfo.version;
            const latestVersion = bundleInfo.version;

            // Parse versions for comparison
            const currentVersionInfo = this.githubService.parseVersion(currentVersion);
            const latestVersionInfo = this.githubService.parseVersion(latestVersion);

            if (!currentVersionInfo || !latestVersionInfo) {
                this.logger.warn(`Invalid version format. Current: ${currentVersion}, Latest: ${latestVersion}`);
                return null;
            }

            // Check if prerelease is allowed
            if (latestVersionInfo.isPrerelease && !options.prerelease) {
                this.logger.debug(`Skipping prerelease version: ${latestVersion}`);
                return null;
            }

            // Compare versions
            const hasUpdate = this.githubService.isNewerVersion(latestVersion, currentVersion);

            return {
                hasUpdate,
                currentVersion,
                latestVersion,
                releaseInfo: latestRelease,
                bundleInfo,
                scope
            };

        } catch (error) {
            this.logger.error(`Failed to check update for scope: ${scope}`, error as Error);
            return null;
        }
    }

    private async createBackup(scope: InstallationScope): Promise<string | null> {
        try {
            // Implementation for creating backup would go here
            // For now, just log the intent
            this.logger.debug(`Creating backup for scope: ${scope}`);
            return null; // Return backup path when implemented
        } catch (error) {
            this.logger.warn('Failed to create backup', error as Error);
            return null;
        }
    }

    private async cleanupBackup(backupPath: string): Promise<void> {
        try {
            // Implementation for cleaning up backup would go here
            this.logger.debug(`Cleaning up backup: ${backupPath}`);
        } catch (error) {
            this.logger.warn('Failed to cleanup backup', error as Error);
        }
    }

    private async restoreBackup(backupPath: string, scope: InstallationScope): Promise<void> {
        try {
            // Implementation for restoring backup would go here
            this.logger.info(`Restoring backup for scope: ${scope} from: ${backupPath}`);
        } catch (error) {
            this.logger.error('Failed to restore backup', error as Error);
        }
    }
}

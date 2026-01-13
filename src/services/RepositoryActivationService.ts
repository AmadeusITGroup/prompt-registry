/**
 * RepositoryActivationService
 * 
 * Handles detection of lockfiles on workspace open and prompts users to enable
 * repository bundles. Manages "Don't ask again" persistence and missing source/hub detection.
 * 
 * Requirements covered:
 * - 13.1-13.7: Repository bundle activation prompt
 * - 12.4-12.5: Missing source/hub detection
 * - 13.6: Missing bundle installation
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { LockfileManager } from './LockfileManager';
import { HubManager } from './HubManager';
import { RegistryStorage } from '../storage/RegistryStorage';
import { Lockfile } from '../types/lockfile';
import { Logger } from '../utils/logger';
import { InstallOptions } from '../types/registry';
import { IBundleInstaller } from '../types/bundleInstaller';

/**
 * Result of missing source/hub detection
 */
export interface MissingSourcesResult {
    missingSources: string[];
    missingHubs: string[];
    offeredToAdd: boolean;
}

/**
 * Result of missing bundle installation
 * Requirements: 13.6
 */
export interface MissingBundleInstallResult {
    /** Bundle IDs that were successfully installed */
    succeeded: string[];
    /** Bundle IDs that failed to install with error messages */
    failed: Array<{ bundleId: string; error: string }>;
    /** Bundle IDs that were skipped (not found in lockfile) */
    skipped: string[];
    /** Whether the operation was cancelled by the user */
    cancelled?: boolean;
}

/**
 * RepositoryActivationService
 * 
 * Detects lockfiles on workspace open and prompts users to enable repository bundles.
 * Uses a per-workspace instance pattern to properly handle workspace switches and
 * multi-root workspaces (similar to LockfileManager).
 */
export class RepositoryActivationService {
    private static instances: Map<string, RepositoryActivationService> = new Map();
    private logger: Logger;
    private readonly DECLINED_KEY = 'repositoryActivation.declined';
    private workspaceRoot: string;
    private bundleInstaller?: IBundleInstaller;

    constructor(
        private lockfileManager: LockfileManager,
        private hubManager: HubManager,
        private storage: RegistryStorage,
        workspaceRoot: string,
        bundleInstaller?: IBundleInstaller
    ) {
        this.logger = Logger.getInstance();
        this.workspaceRoot = workspaceRoot;
        this.bundleInstaller = bundleInstaller;
    }

    /**
     * Get or create a RepositoryActivationService instance for a workspace.
     * Supports multi-root workspaces by maintaining separate instances per workspace.
     * 
     * @param workspaceRoot - Path to the workspace root (required)
     * @param lockfileManager - LockfileManager instance for the workspace
     * @param hubManager - HubManager instance
     * @param storage - RegistryStorage instance
     * @param bundleInstaller - Optional IBundleInstaller instance for bundle installation
     * @returns RepositoryActivationService instance for the workspace
     * @throws Error if workspaceRoot is not provided on first call
     */
    static getInstance(
        workspaceRoot?: string,
        lockfileManager?: LockfileManager,
        hubManager?: HubManager,
        storage?: RegistryStorage,
        bundleInstaller?: IBundleInstaller
    ): RepositoryActivationService {
        if (!workspaceRoot) {
            throw new Error('Workspace root path required for RepositoryActivationService.getInstance()');
        }

        // Normalize path for consistent key lookup
        const normalizedPath = path.normalize(workspaceRoot);

        if (!RepositoryActivationService.instances.has(normalizedPath)) {
            if (!lockfileManager || !hubManager || !storage) {
                throw new Error('Dependencies required on first call to RepositoryActivationService.getInstance() for a workspace');
            }
            RepositoryActivationService.instances.set(
                normalizedPath,
                new RepositoryActivationService(lockfileManager, hubManager, storage, normalizedPath, bundleInstaller)
            );
        }
        return RepositoryActivationService.instances.get(normalizedPath)!;
    }

    /**
     * Get an existing instance for a workspace without creating a new one.
     * Returns undefined if no instance exists for the workspace.
     * 
     * @param workspaceRoot - Path to the workspace root
     * @returns RepositoryActivationService instance or undefined
     */
    static getExistingInstance(workspaceRoot: string): RepositoryActivationService | undefined {
        const normalizedPath = path.normalize(workspaceRoot);
        return RepositoryActivationService.instances.get(normalizedPath);
    }

    /**
     * Reset instance(s) (for testing purposes)
     * @param workspaceRoot - If provided, reset only that workspace's instance. Otherwise, reset all instances.
     */
    static resetInstance(workspaceRoot?: string): void {
        if (workspaceRoot) {
            const normalizedPath = path.normalize(workspaceRoot);
            RepositoryActivationService.instances.delete(normalizedPath);
        } else {
            // Reset all instances
            RepositoryActivationService.instances.clear();
        }
    }

    /**
     * Get the workspace root path for this instance
     */
    getWorkspaceRoot(): string {
        return this.workspaceRoot;
    }

    /**
     * Check for lockfile and prompt activation if appropriate
     * Called on workspace open
     */
    async checkAndPromptActivation(): Promise<void> {
        try {
            // Check if lockfile exists
            const lockfile = await this.lockfileManager.read();
            if (!lockfile) {
                this.logger.debug('No lockfile found, skipping activation prompt');
                return;
            }

            // Check if this repository was previously declined
            const lockfilePath = this.lockfileManager.getLockfilePath();
            const repositoryPath = this.getRepositoryPath(lockfilePath);
            
            if (await this.wasDeclined(repositoryPath)) {
                this.logger.debug(`Repository ${repositoryPath} was previously declined, skipping prompt`);
                return;
            }

            // Show activation prompt
            const choice = await this.showActivationPrompt(lockfile);

            switch (choice) {
                case 'enable':
                    await this.enableRepositoryBundles(lockfile);
                    break;
                case 'never':
                    await this.rememberDeclined(repositoryPath);
                    break;
                case 'decline':
                default:
                    // User declined or dismissed - do nothing
                    break;
            }
        } catch (error) {
            this.logger.error('Failed to check and prompt activation:', error instanceof Error ? error : undefined);
        }
    }

    /**
     * Show activation prompt to user
     * @param lockfile - The lockfile to activate
     * @returns User's choice: 'enable', 'decline', or 'never'
     */
    async showActivationPrompt(lockfile: Lockfile): Promise<'enable' | 'decline' | 'never'> {
        const bundleCount = Object.keys(lockfile.bundles).length;
        const profileCount = lockfile.profiles ? Object.keys(lockfile.profiles).length : 0;

        let message = `This repository has ${bundleCount} bundle${bundleCount !== 1 ? 's' : ''} configured`;
        if (profileCount > 0) {
            message += ` and ${profileCount} profile${profileCount !== 1 ? 's' : ''}`;
        }
        message += '. Would you like to enable them?';

        const choice = await vscode.window.showInformationMessage(
            message,
            'Enable',
            'Not now',
            'Don\'t ask again'
        );

        switch (choice) {
            case 'Enable':
                return 'enable';
            case 'Don\'t ask again':
                return 'never';
            case 'Not now':
            default:
                return 'decline';
        }
    }

    /**
     * Enable repository bundles
     * Verifies bundles are installed and checks for missing sources/hubs
     * 
     * @param lockfile - The lockfile to enable
     */
    async enableRepositoryBundles(lockfile: Lockfile): Promise<void> {
        try {
            this.logger.debug('Enabling repository bundles...');
            
            // Check which bundles are installed - this MUST be called for proper activation
            const installedBundles = await this.storage.getInstalledBundles('repository');
            this.logger.debug(`Found ${installedBundles.length} installed bundles at repository scope`);
            
            const installedBundleIds = new Set(installedBundles.map(b => b.bundleId));
            
            const lockfileBundleIds = Object.keys(lockfile.bundles);
            const missingBundleIds = lockfileBundleIds.filter(id => !installedBundleIds.has(id));

            // Offer to install missing bundles
            if (missingBundleIds.length > 0) {
                this.logger.debug(`Found ${missingBundleIds.length} missing bundles`);
                const choice = await vscode.window.showInformationMessage(
                    `${missingBundleIds.length} bundle${missingBundleIds.length !== 1 ? 's are' : ' is'} not installed. Would you like to install them?`,
                    'Install',
                    'Skip'
                );

                if (choice === 'Install') {
                    this.logger.info(`User chose to install ${missingBundleIds.length} missing bundles`);
                    // Install missing bundles using RegistryManager
                    const result = await this.installMissingBundles(lockfile, missingBundleIds);
                    
                    // Report results to user
                    if (result.succeeded.length > 0) {
                        this.logger.info(`Successfully installed ${result.succeeded.length} bundles`);
                    }
                    if (result.failed.length > 0) {
                        this.logger.warn(`Failed to install ${result.failed.length} bundles`);
                        vscode.window.showWarningMessage(
                            `${result.failed.length} bundle${result.failed.length !== 1 ? 's' : ''} failed to install. See logs for details.`
                        );
                    }
                    if (result.cancelled) {
                        this.logger.info('Bundle installation was cancelled by user');
                    }
                }
            } else {
                this.logger.debug('All bundles from lockfile are already installed');
            }

            // Check for missing sources and hubs
            await this.checkAndOfferMissingSources(lockfile);

        } catch (error) {
            this.logger.error('Failed to enable repository bundles:', error instanceof Error ? error : undefined);
            vscode.window.showErrorMessage('Failed to enable repository bundles. See logs for details.');
        }
    }

    /**
     * Install missing bundles from the lockfile
     * 
     * @param lockfile - The lockfile containing bundle information
     * @param missingBundleIds - Array of bundle IDs to install
     * @returns Result with succeeded, failed, and skipped bundles
     * 
     * Requirements: 13.6 - "IF bundles are missing from the repository, THE Extension SHALL offer to download and install them"
     */
    async installMissingBundles(lockfile: Lockfile, missingBundleIds: string[]): Promise<MissingBundleInstallResult> {
        const result: MissingBundleInstallResult = {
            succeeded: [],
            failed: [],
            skipped: []
        };

        // Return early if no bundles to install
        if (missingBundleIds.length === 0) {
            return result;
        }

        // Check if IBundleInstaller is available
        if (!this.bundleInstaller) {
            this.logger.warn('Bundle installer not available, cannot install missing bundles');
            // Mark all as skipped since we can't install
            result.skipped = [...missingBundleIds];
            return result;
        }

        // Show progress notification during installation
        return await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: 'Installing missing bundles',
                cancellable: true
            },
            async (progress, token) => {
                const total = missingBundleIds.length;
                let completed = 0;

                for (const bundleId of missingBundleIds) {
                    // Check for cancellation
                    if (token.isCancellationRequested) {
                        this.logger.info('Bundle installation cancelled by user');
                        result.cancelled = true;
                        break;
                    }

                    // Get bundle info from lockfile
                    const bundleEntry = lockfile.bundles[bundleId];
                    if (!bundleEntry) {
                        this.logger.warn(`Bundle ${bundleId} not found in lockfile, skipping`);
                        result.skipped.push(bundleId);
                        continue;
                    }

                    // Update progress
                    progress.report({
                        message: `Installing ${bundleId} (${completed + 1}/${total})`,
                        increment: (1 / total) * 100
                    });

                    try {
                        // Build install options from lockfile entry
                        const installOptions: InstallOptions = {
                            scope: 'repository',
                            version: bundleEntry.version,
                            commitMode: bundleEntry.commitMode
                        };

                        this.logger.debug(`Installing bundle ${bundleId} with options:`, installOptions);
                        
                        // Install the bundle (bundleInstaller is guaranteed to exist here due to earlier check)
                        await this.bundleInstaller!.installBundle(bundleId, installOptions, true);
                        
                        result.succeeded.push(bundleId);
                        this.logger.info(`Successfully installed bundle ${bundleId}`);
                    } catch (error) {
                        const errorMessage = error instanceof Error ? error.message : String(error);
                        result.failed.push({ bundleId, error: errorMessage });
                        this.logger.error(`Failed to install bundle ${bundleId}:`, error instanceof Error ? error : undefined);
                    }

                    completed++;
                }

                return result;
            }
        );
    }

    /**
     * Check for missing sources and hubs, offer to add them
     * @param lockfile - The lockfile to check
     * @returns Result with missing sources/hubs and whether offer was made
     */
    async checkAndOfferMissingSources(lockfile: Lockfile): Promise<MissingSourcesResult> {
        const result: MissingSourcesResult = {
            missingSources: [],
            missingHubs: [],
            offeredToAdd: false
        };

        try {
            // Get configured sources
            const configuredSources = await this.storage.getSources();
            const configuredSourceIds = new Set(configuredSources.map(s => s.id));

            // Check for missing sources
            const lockfileSourceIds = Object.keys(lockfile.sources);
            result.missingSources = lockfileSourceIds.filter(id => !configuredSourceIds.has(id));

            // Check for missing hubs
            if (lockfile.hubs) {
                const configuredHubs = await this.hubManager.listHubs();
                const configuredHubIds = new Set(configuredHubs.map(h => h.id));
                
                const lockfileHubIds = Object.keys(lockfile.hubs);
                result.missingHubs = lockfileHubIds.filter(id => !configuredHubIds.has(id));
            }

            // Offer to add missing sources/hubs
            if (result.missingSources.length > 0 || result.missingHubs.length > 0) {
                const totalMissing = result.missingSources.length + result.missingHubs.length;
                const itemType = result.missingHubs.length > 0 ? 'sources and hubs' : 'sources';
                
                const choice = await vscode.window.showInformationMessage(
                    `${totalMissing} ${itemType} from the lockfile are not configured. Would you like to add them?`,
                    'Add Sources',
                    'Not now'
                );

                result.offeredToAdd = true;

                if (choice === 'Add Sources') {
                    this.logger.info(`User chose to add ${totalMissing} missing ${itemType}`);
                    // Note: Actual addition would be handled by RegistryManager/HubManager
                    // For now, just log the intent
                }
            }

        } catch (error) {
            this.logger.error('Failed to check for missing sources/hubs:', error instanceof Error ? error : undefined);
        }

        return result;
    }

    /**
     * Remember that user declined activation for this repository
     * @param repositoryPath - Path to the repository
     */
    async rememberDeclined(repositoryPath: string): Promise<void> {
        try {
            const declined = await this.getDeclinedRepositories();
            
            if (!declined.includes(repositoryPath)) {
                declined.push(repositoryPath);
                await this.storage.getContext().globalState.update(this.DECLINED_KEY, declined);
                this.logger.debug(`Remembered declined activation for: ${repositoryPath}`);
            }
        } catch (error) {
            this.logger.error('Failed to remember declined repository:', error instanceof Error ? error : undefined);
        }
    }

    /**
     * Check if user previously declined activation for this repository
     * @param repositoryPath - Path to the repository
     * @returns True if previously declined
     */
    private async wasDeclined(repositoryPath: string): Promise<boolean> {
        const declined = await this.getDeclinedRepositories();
        return declined.includes(repositoryPath);
    }

    /**
     * Get list of declined repositories from global state
     * @returns Array of repository paths
     */
    private async getDeclinedRepositories(): Promise<string[]> {
        const context = this.storage.getContext();
        return context.globalState.get<string[]>(this.DECLINED_KEY, []);
    }

    /**
     * Extract repository path from lockfile path
     * @param lockfilePath - Full path to lockfile
     * @returns Repository root path
     */
    private getRepositoryPath(lockfilePath: string): string {
        return path.dirname(lockfilePath);
    }
}

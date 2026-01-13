/**
 * Bundle Scope Commands
 * 
 * Provides commands for managing bundle installation scope:
 * - Move bundles between user and repository scopes
 * - Switch commit mode for repository-scoped bundles
 * - Context menu actions based on current scope/mode
 * 
 * Requirements: 7.1-7.10
 */

import * as vscode from 'vscode';
import { RegistryManager } from '../services/RegistryManager';
import { ScopeConflictResolver } from '../services/ScopeConflictResolver';
import { RepositoryScopeService } from '../services/RepositoryScopeService';
import { LockfileManager } from '../services/LockfileManager';
import { InstallationScope, RepositoryCommitMode, InstalledBundle } from '../types/registry';
import { Logger } from '../utils/logger';
import { ErrorHandler } from '../utils/errorHandler';
import { hasOpenWorkspace, getWorkspaceRoot } from '../utils/scopeSelectionUI';
import { getInstalledBundleForScope } from '../utils/bundleScopeUtils';

/**
 * Context menu action definition
 */
export interface ContextMenuAction {
    /** Unique identifier for the action */
    id: string;
    /** Display label for the action */
    label: string;
    /** Description of the action */
    description: string;
    /** Whether the action is disabled */
    disabled: boolean;
    /** Icon for the action (VS Code codicon) */
    icon?: string;
}

/**
 * Bundle Scope Commands Handler
 * 
 * Manages bundle scope transitions and commit mode switching.
 * Provides context menu actions based on bundle state.
 */
export class BundleScopeCommands {
    private logger: Logger;

    constructor(
        private registryManager: RegistryManager,
        private scopeConflictResolver: ScopeConflictResolver,
        private repositoryScopeService: RepositoryScopeService
    ) {
        this.logger = Logger.getInstance();
    }

    /**
     * Get installed bundle from the appropriate source based on scope.
     * Delegates to shared utility that handles lockfile vs storage lookup.
     */
    private async getBundleForScope(bundleId: string, scope: InstallationScope): Promise<InstalledBundle | undefined> {
        return getInstalledBundleForScope(this.registryManager.getStorage(), bundleId, scope);
    }

    /**
     * Move a bundle from user scope to repository scope.
     * 
     * @param bundleId - The bundle ID to move
     * @param commitMode - The commit mode for repository installation
     * 
     * Requirements: 7.2, 7.3
     */
    async moveToRepository(bundleId: string, commitMode: RepositoryCommitMode): Promise<void> {
        try {
            this.logger.debug(`[BundleScopeCommands] Moving bundle ${bundleId} to repository scope (${commitMode})`);

            // Check if workspace is open
            if (!hasOpenWorkspace()) {
                vscode.window.showErrorMessage('Cannot move to repository scope: No workspace is open.');
                return;
            }

            // Get storage and check if bundle is installed at user scope
            const storage = this.registryManager.getStorage();
            const userBundle = await storage.getInstalledBundle(bundleId, 'user');

            if (!userBundle) {
                vscode.window.showErrorMessage(`Bundle "${bundleId}" is not installed at user scope.`);
                return;
            }

            // Get bundle name for display
            let bundleName = bundleId;
            try {
                bundleName = await this.registryManager.getBundleName(bundleId);
            } catch {
                // Use bundleId if name not available
            }

            // Confirm with user
            const modeDescription = commitMode === 'commit' 
                ? 'tracked in version control' 
                : 'excluded from Git';
            
            const confirmation = await vscode.window.showWarningMessage(
                `Move "${bundleName}" to repository scope (${modeDescription})?`,
                { modal: true },
                'Move', 'Cancel'
            );

            if (confirmation !== 'Move') {
                return;
            }

            // Perform migration
            const result = await this.scopeConflictResolver.migrateBundle(
                bundleId,
                'user',
                'repository',
                async () => {
                    await this.registryManager.uninstallBundle(bundleId, 'user');
                },
                async (_installedBundle: InstalledBundle, targetScope: InstallationScope) => {
                    await this.registryManager.installBundle(bundleId, {
                        scope: targetScope,
                        version: userBundle.version,
                        commitMode
                    });
                }
            );

            if (result.success) {
                vscode.window.showInformationMessage(
                    `✓ "${bundleName}" moved to repository scope (${commitMode}).`
                );
            } else {
                vscode.window.showErrorMessage(
                    `Failed to move "${bundleName}": ${result.error}`
                );
            }

        } catch (error) {
            await ErrorHandler.handle(error, {
                operation: 'move bundle to repository',
                showUserMessage: true,
                userMessagePrefix: 'Move failed'
            });
        }
    }

    /**
     * Move a bundle from repository scope to user scope.
     * 
     * @param bundleId - The bundle ID to move
     * 
     * Requirements: 7.4, 7.6
     */
    async moveToUser(bundleId: string): Promise<void> {
        try {
            this.logger.debug(`[BundleScopeCommands] Moving bundle ${bundleId} to user scope`);

            // Get bundle from repository scope (uses lockfile)
            const repoBundle = await this.getBundleForScope(bundleId, 'repository');

            if (!repoBundle) {
                vscode.window.showErrorMessage(`Bundle "${bundleId}" is not installed at repository scope.`);
                return;
            }

            // Get bundle name for display
            let bundleName = bundleId;
            try {
                bundleName = await this.registryManager.getBundleName(bundleId);
            } catch {
                // Use bundleId if name not available
            }

            // Confirm with user
            const confirmation = await vscode.window.showWarningMessage(
                `Move "${bundleName}" to user scope? It will be available across all workspaces.`,
                { modal: true },
                'Move', 'Cancel'
            );

            if (confirmation !== 'Move') {
                return;
            }

            // Perform migration
            const result = await this.scopeConflictResolver.migrateBundle(
                bundleId,
                'repository',
                'user',
                async () => {
                    await this.registryManager.uninstallBundle(bundleId, 'repository');
                },
                async (_installedBundle: InstalledBundle, targetScope: InstallationScope) => {
                    await this.registryManager.installBundle(bundleId, {
                        scope: targetScope,
                        version: repoBundle.version
                    });
                }
            );

            if (result.success) {
                vscode.window.showInformationMessage(
                    `✓ "${bundleName}" moved to user scope.`
                );
            } else {
                vscode.window.showErrorMessage(
                    `Failed to move "${bundleName}": ${result.error}`
                );
            }

        } catch (error) {
            await ErrorHandler.handle(error, {
                operation: 'move bundle to user',
                showUserMessage: true,
                userMessagePrefix: 'Move failed'
            });
        }
    }

    /**
     * Switch the commit mode for a repository-scoped bundle.
     * 
     * @param bundleId - The bundle ID to switch
     * @param newMode - The new commit mode
     * 
     * Requirements: 7.5, 7.7, 7.8, 7.9
     */
    async switchCommitMode(bundleId: string, newMode: RepositoryCommitMode): Promise<void> {
        try {
            this.logger.debug(`[BundleScopeCommands] Switching commit mode for ${bundleId} to ${newMode}`);

            // Get bundle from repository scope (uses lockfile)
            const repoBundle = await this.getBundleForScope(bundleId, 'repository');

            if (!repoBundle) {
                vscode.window.showErrorMessage(`Bundle "${bundleId}" is not installed at repository scope.`);
                return;
            }

            // Check if already in target mode
            const currentMode = repoBundle.commitMode ?? 'commit';
            if (currentMode === newMode) {
                vscode.window.showInformationMessage(`Bundle is already in ${newMode} mode.`);
                return;
            }

            // Get bundle name for display
            let bundleName = bundleId;
            try {
                bundleName = await this.registryManager.getBundleName(bundleId);
            } catch {
                // Use bundleId if name not available
            }

            // Confirm with user
            const modeDescription = newMode === 'commit'
                ? 'Files will be tracked in version control.'
                : 'Files will be excluded from Git via .git/info/exclude.';

            const confirmation = await vscode.window.showWarningMessage(
                `Switch "${bundleName}" to ${newMode} mode? ${modeDescription}`,
                { modal: true },
                'Switch', 'Cancel'
            );

            if (confirmation !== 'Switch') {
                return;
            }

            // Perform switch (updates git exclude entries)
            await this.repositoryScopeService.switchCommitMode(bundleId, newMode);

            // Update lockfile with new commit mode using atomic write
            const workspaceRoot = getWorkspaceRoot();
            if (workspaceRoot) {
                const lockfileManager = LockfileManager.getInstance(workspaceRoot);
                await lockfileManager.updateCommitMode(bundleId, newMode);
            }

            vscode.window.showInformationMessage(
                `✓ "${bundleName}" switched to ${newMode} mode.`
            );

        } catch (error) {
            await ErrorHandler.handle(error, {
                operation: 'switch commit mode',
                showUserMessage: true,
                userMessagePrefix: 'Switch failed'
            });
        }
    }

    /**
     * Get available context menu actions for a bundle.
     * 
     * Returns appropriate actions based on:
     * - Current installation scope
     * - Current commit mode (for repository scope)
     * - Whether a workspace is open
     * 
     * @param bundleId - The bundle ID to get actions for
     * @returns Array of available context menu actions
     * 
     * Requirements: 7.1-7.7
     */
    async getContextMenuActions(bundleId: string): Promise<ContextMenuAction[]> {
        const actions: ContextMenuAction[] = [];
        const workspaceOpen = hasOpenWorkspace();

        // Check where bundle is installed (uses scope-aware lookup)
        const userBundle = await this.getBundleForScope(bundleId, 'user');
        const repoBundle = await this.getBundleForScope(bundleId, 'repository');

        if (!userBundle && !repoBundle) {
            // Bundle not installed - no actions
            return actions;
        }

        if (userBundle) {
            // User-scoped bundle: show repository move options
            // Requirements 7.2, 7.3
            actions.push({
                id: 'moveToRepositoryCommit',
                label: '$(repo) Move to Repository (Commit)',
                description: 'Move to .github/, tracked in version control',
                disabled: !workspaceOpen,
                icon: 'repo'
            });

            actions.push({
                id: 'moveToRepositoryLocalOnly',
                label: '$(eye-closed) Move to Repository (Local Only)',
                description: 'Move to .github/, excluded from Git',
                disabled: !workspaceOpen,
                icon: 'eye-closed'
            });
        }

        if (repoBundle) {
            const currentMode = repoBundle.commitMode ?? 'commit';

            // Repository-scoped bundle: show move to user option
            // Requirements 7.4, 7.6
            actions.push({
                id: 'moveToUser',
                label: '$(account) Move to User',
                description: 'Move to user config, available everywhere',
                disabled: false,
                icon: 'account'
            });

            // Show switch mode option based on current mode
            if (currentMode === 'commit') {
                // Requirement 7.5
                actions.push({
                    id: 'switchToLocalOnly',
                    label: '$(eye-closed) Switch to Local Only',
                    description: 'Exclude from Git via .git/info/exclude',
                    disabled: false,
                    icon: 'eye-closed'
                });
            } else {
                // Requirement 7.7
                actions.push({
                    id: 'switchToCommit',
                    label: '$(git-commit) Switch to Commit',
                    description: 'Track in version control',
                    disabled: false,
                    icon: 'git-commit'
                });
            }
        }

        return actions;
    }

    /**
     * Execute a context menu action.
     * 
     * @param bundleId - The bundle ID
     * @param actionId - The action ID to execute
     */
    async executeAction(bundleId: string, actionId: string): Promise<void> {
        switch (actionId) {
            case 'moveToRepositoryCommit':
                await this.moveToRepository(bundleId, 'commit');
                break;
            case 'moveToRepositoryLocalOnly':
                await this.moveToRepository(bundleId, 'local-only');
                break;
            case 'moveToUser':
                await this.moveToUser(bundleId);
                break;
            case 'switchToLocalOnly':
                await this.switchCommitMode(bundleId, 'local-only');
                break;
            case 'switchToCommit':
                await this.switchCommitMode(bundleId, 'commit');
                break;
            default:
                this.logger.warn(`[BundleScopeCommands] Unknown action: ${actionId}`);
        }
    }
}

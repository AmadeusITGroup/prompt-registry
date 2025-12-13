import * as vscode from 'vscode';
import { ExtensionUpdateManager } from '../services/updateManager';
import { InstallationManager } from '../services/installationManager';
import { InstallationScope } from '../types/platform';
import { Logger } from '../utils/logger';

/**
 * Command handler for updating Prompt Registry components
 */
export class UpdateCommand {
    private readonly logger: Logger;
    private readonly updateManager: ExtensionUpdateManager;
    private readonly installationManager: InstallationManager;

    constructor() {
        this.logger = Logger.getInstance();
        this.updateManager = ExtensionUpdateManager.getInstance();
        this.installationManager = InstallationManager.getInstance();
    }

    /**
     * Execute the update command
     */
    public async execute(): Promise<void> {
        try {
            this.logger.info('Starting Prompt Registry update...');

            // Check if Prompt Registry is installed
            const installedScopes = await this.installationManager.getInstalledScopes();
            if (installedScopes.length === 0) {
                await vscode.window.showWarningMessage(
                    'Prompt Registry is not installed. Would you like to install it now?',
                    'Install Prompt Registry'
                ).then((action) => {
                    if (action === 'Install Prompt Registry') {
                        vscode.commands.executeCommand('promptregistry.enhancedInstall');
                    }
                });
                return;
            }

            // Check for updates
            const updateChecks = await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: 'Checking for updates...',
                    cancellable: false
                },
                async () => {
                    return await this.updateManager.checkForUpdates();
                }
            );

            const updatesAvailable = updateChecks.filter(check => check.hasUpdate);

            if (updatesAvailable.length === 0) {
                await vscode.window.showInformationMessage(
                    'Prompt Registry is up to date!',
                    'Show Version Info'
                ).then((action) => {
                    if (action === 'Show Version Info') {
                        vscode.commands.executeCommand('promptregistry.showVersion');
                    }
                });
                return;
            }

            // Show update options
            const updateOption = await this.selectUpdateOption(updatesAvailable);
            if (!updateOption) {
                return; // User cancelled
            }

            // Perform update
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: 'Updating Prompt Registry',
                    cancellable: true
                },
                async (progress, token) => {
                    try {
                        if (updateOption === 'all') {
                            // Update all scopes
                            const results = await this.updateManager.updateAll(
                                {},
                                (progressValue, message, scope) => {
                                    const scopeText = scope ? ` (${scope})` : '';
                                    progress.report({
                                        increment: 0,
                                        message: `${message}${scopeText}`
                                    });
                                }
                            );

                            const successCount = results.filter(r => r.success).length;
                            const totalCount = results.length;

                            if (successCount === totalCount) {
                                await vscode.window.showInformationMessage(
                                    `Prompt Registry updated successfully in ${successCount} scope(s)!`
                                );
                            } else {
                                await vscode.window.showWarningMessage(
                                    `Prompt Registry update completed with ${successCount}/${totalCount} successful updates.`,
                                    'Show Logs'
                                ).then((action) => {
                                    if (action === 'Show Logs') {
                                        this.logger.show();
                                    }
                                });
                            }

                        } else {
                            // Update specific scope
                            const scope = updateOption as InstallationScope;
                            const result = await this.updateManager.updateScope(
                                scope,
                                {},
                                (progressValue, message) => {
                                    progress.report({
                                        increment: 0,
                                        message
                                    });
                                }
                            );

                            if (result.success) {
                                await vscode.window.showInformationMessage(
                                    `Prompt Registry updated successfully in ${scope} scope!\n\nVersion: ${result.version}`,
                                    'Show in Explorer'
                                ).then((action) => {
                                    if (action === 'Show in Explorer') {
                                        vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(result.installedPath));
                                    }
                                });
                            } else {
                                throw new Error(result.error || 'Update failed');
                            }
                        }

                    } catch (error) {
                        if (token.isCancellationRequested) {
                            this.logger.info('Update cancelled by user');
                            return;
                        }
                        throw error;
                    }
                }
            );

        } catch (error) {
            this.logger.error('Update failed', error as Error);
            
            await vscode.window.showErrorMessage(
                `Failed to update Prompt Registry: ${(error as Error).message}`,
                'Show Logs'
            ).then((action) => {
                if (action === 'Show Logs') {
                    this.logger.show();
                }
            });
        }
    }

    private async selectUpdateOption(availableUpdates: any[]): Promise<string | undefined> {
        if (availableUpdates.length === 1) {
            // Only one scope has updates, ask for confirmation
            const update = availableUpdates[0];
            const confirm = await vscode.window.showInformationMessage(
                `Update available for ${update.scope} scope: ${update.currentVersion} → ${update.latestVersion}`,
                'Update Now',
                'Cancel'
            );

            return confirm === 'Update Now' ? update.scope : undefined;
        }

        // Multiple scopes have updates, show selection
        const quickPickItems: vscode.QuickPickItem[] = [
            {
                label: '🔄 Update All',
                description: `Update all ${availableUpdates.length} scopes`,
                detail: 'Recommended'
            },
            ...availableUpdates.map(update => ({
                label: `📁 Update ${update.scope}`,
                description: `${update.currentVersion} → ${update.latestVersion}`,
                detail: update.scope
            }))
        ];

        const selectedItem = await vscode.window.showQuickPick(quickPickItems, {
            title: 'Select Update Option',
            placeHolder: 'Choose which installations to update',
            ignoreFocusOut: true
        });

        if (!selectedItem) {
            return undefined;
        }

        if (selectedItem.label === '🔄 Update All') {
            return 'all';
        }

        return selectedItem.detail;
    }
}

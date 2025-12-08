import * as vscode from 'vscode';
import { GitHubService } from '../services/githubService';
import { Logger } from '../utils/logger';
import { ExtensionNotifications } from '../notifications/ExtensionNotifications';

/**
 * Command to select and install a specific version of Prompt Registry
 */
export async function selectVersionCommand(): Promise<void> {
    const logger = Logger.getInstance();
    const githubService = GitHubService.getInstance();
    const notifications = ExtensionNotifications.getInstance();

    try {
        logger.info('Fetching available versions...');

        // Get available versions with progress indicator
        const versions = await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Fetching available versions...',
            cancellable: false
        }, async () => {
            return await githubService.getAvailableVersions(20);
        });
        
        if (versions.length === 0) {
            await notifications.showWarning('No versions found in repository');
            return;
        }

        // Create quick pick items with version information
        const quickPickItems: vscode.QuickPickItem[] = versions.map(version => ({
            label: version.tagName || version.version,  // Use tag name if available, otherwise use parsed version
            description: version.isPrerelease ? '(Prerelease)' : '(Release)',
            detail: `Version ${version.version}${version.prerelease ? ' - ' + version.prerelease : ''}`
        }));

        // Add latest option at the top
        quickPickItems.unshift({
            label: 'latest',
            description: '(Recommended)',
            detail: 'Install the latest stable release'
        });

        // Show version picker
        const selectedItem = await vscode.window.showQuickPick(quickPickItems, {
            placeHolder: 'Select a version to install',
            title: 'Prompt Registry Version Selection',
            matchOnDescription: true,
            matchOnDetail: true,
            ignoreFocusOut: true
        });

        if (!selectedItem) {
            logger.debug('Version selection cancelled by user');
            return;
        }

        const selectedVersion = selectedItem.label;
        logger.info(`User selected version: ${selectedVersion}`);

        // Update configuration with selected version
        const config = vscode.workspace.getConfiguration('olaf');
        await config.update('defaultVersion', selectedVersion, vscode.ConfigurationTarget.Global);

        // Ask if user wants to install immediately
        const installNow = await vscode.window.showInformationMessage(
            `Version ${selectedVersion} selected. Install now?`,
            'Install Now',
            'Later'
        );

        if (installNow === 'Install Now') {
            // Reset GitHub service instance to pick up new configuration
            GitHubService.resetInstance();
            
            // Execute install command
            await vscode.commands.executeCommand('promptregistry.enhancedInstall');
        }

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error('Failed to select version', error as Error);
        
        // Provide helpful error messages
        if (errorMessage.includes('401') || errorMessage.includes('authentication')) {
            await notifications.showError('Authentication failed. Please validate your repository access settings.');
            
            // Offer to open validation command
            const validate = await vscode.window.showErrorMessage(
                'Authentication failed. Would you like to validate your repository access?',
                'Validate Access',
                'Open Settings'
            );
            
            if (validate === 'Validate Access') {
                await vscode.commands.executeCommand('promptregistry.validateAccess');
            } else if (validate === 'Open Settings') {
                await vscode.commands.executeCommand('workbench.action.openSettings', 'olaf');
            }
        } else if (errorMessage.includes('404') || errorMessage.includes('not found')) {
            await notifications.showError('Repository or releases not found. Please check your repository settings.');
        } else {
            await notifications.showError(`Failed to fetch versions: ${errorMessage}`);
        }
    }
}

import * as vscode from 'vscode';
import { GitHubService } from '../services/githubService';
import { PlatformDetector } from '../services/platformDetector';
import { InstallationManager } from '../services/installationManager';
import { InstallationScope } from '../types/platform';
import { Logger } from '../utils/logger';

/**
 * Command to install a specific version of Prompt Registry
 */
export class InstallSpecificVersionCommand {
    private static instance: InstallSpecificVersionCommand;
    private readonly logger: Logger;
    private readonly githubService: GitHubService;
    private readonly platformDetector: PlatformDetector;
    private readonly installationManager: InstallationManager;

    private constructor() {
        this.logger = Logger.getInstance();
        this.githubService = GitHubService.getInstance();
        this.platformDetector = PlatformDetector.getInstance();
        this.installationManager = InstallationManager.getInstance();
    }

    public static getInstance(): InstallSpecificVersionCommand {
        if (!InstallSpecificVersionCommand.instance) {
            InstallSpecificVersionCommand.instance = new InstallSpecificVersionCommand();
        }
        return InstallSpecificVersionCommand.instance;
    }

    /**
     * Execute the install specific version command
     */
    public async execute(): Promise<void> {
        try {
            this.logger.info('Starting specific version installation command');

            // Check connectivity first
            const isConnected = await this.githubService.checkConnectivity();
            if (!isConnected) {
                throw new Error('Unable to connect to GitHub API. Please check your internet connection and GitHub settings.');
            }

            // Validate access for private repos
            const config = vscode.workspace.getConfiguration('olaf');
            const usePrivateRepo = config.get<boolean>('usePrivateRepository');
            
            if (usePrivateRepo) {
                const validation = await this.githubService.validateAccess();
                if (!validation.valid) {
                    throw new Error(validation.message);
                }
            }

            // Get available versions
            const versions = await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Loading available versions...',
                cancellable: false
            }, async () => {
                return await this.githubService.getAvailableVersions(50);
            });

            if (versions.length === 0) {
                vscode.window.showInformationMessage('No versions available for installation.');
                return;
            }

            // Show version picker
            const versionItems = versions.map(version => ({
                label: version.version,
                description: version.isPrerelease ? 'Pre-release' : 'Release',
                detail: `Version ${version.version}`,
                version: version.version
            }));

            const selectedItem = await vscode.window.showQuickPick(versionItems, {
                placeHolder: 'Select a version to install',
                title: 'Choose Prompt Registry Version',
                ignoreFocusOut: true
            });

            if (!selectedItem) {
                return; // User cancelled
            }

            // Get installation scope
            const scopeItems = [
                { label: 'User', description: 'Install for current user', scope: InstallationScope.USER },
                { label: 'Workspace', description: 'Install for current workspace', scope: InstallationScope.WORKSPACE },
                { label: 'Project', description: 'Install in current project folder', scope: InstallationScope.PROJECT }
            ];

            const selectedScope = await vscode.window.showQuickPick(scopeItems, {
                placeHolder: 'Select installation scope',
                title: 'Installation Scope',
                ignoreFocusOut: true
            });

            if (!selectedScope) {
                return; // User cancelled
            }

            // Start installation process
            await this.performInstallation(selectedItem.version, selectedScope.scope);

        } catch (error) {
            this.logger.error('Install specific version command failed', error as Error);
            vscode.window.showErrorMessage(`Installation failed: ${(error as Error).message}`);
        }
    }

    /**
     * Perform the actual installation
     */
    private async performInstallation(version: string, scope: InstallationScope): Promise<void> {
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Installing Prompt Registry ${version}...`,
            cancellable: false
        }, async (progress) => {
            try {
                // Update progress - getting release information
                progress.report({ increment: 10, message: 'Getting release information...' });

                const release = await this.githubService.getReleaseByVersionPreference(version);
                
                // Update progress - detecting platform
                progress.report({ increment: 15, message: 'Detecting platform...' });

                const platform = await this.platformDetector.detectPlatform();
                const bundle = this.githubService.findPlatformBundle(release, platform.platform);

                if (!bundle) {
                    throw new Error(`No compatible bundle found for platform: ${platform.platform}`);
                }

                // Update progress - downloading bundle
                progress.report({ increment: 25, message: `Downloading ${bundle.filename}...` });

                const bundleData = await this.githubService.downloadBundle(bundle, (downloadProgress) => {
                    const currentProgress = 25 + (downloadProgress * 0.5); // Download takes 50% of remaining progress
                    progress.report({ increment: 0, message: `Downloading... ${Math.round(downloadProgress)}%` });
                });

                // Update progress - installing
                progress.report({ increment: 25, message: 'Installing bundle...' });

                const result = await this.installationManager.installBundle(
                    bundleData,
                    bundle,
                    scope,
                    (installProgress: number, message: string) => {
                        progress.report({ increment: 0, message: message || `Installing... ${Math.round(installProgress)}%` });
                    }
                );

                if (result.success) {
                    const scopeText = scope === InstallationScope.USER ? 'user' : 
                                   scope === InstallationScope.WORKSPACE ? 'workspace' : 'project';
                    
                    vscode.window.showInformationMessage(
                        `Prompt Registry ${version} installed successfully! (${scopeText} scope)\nPath: ${result.installedPath}`
                    );
                    
                    this.logger.info(`Installation completed: ${result.installedPath}`);
                } else {
                    throw new Error(result.error || 'Installation failed for unknown reason');
                }

            } catch (error) {
                this.logger.error('Installation process failed', error as Error);
                throw error;
            }
        });
    }
}

import * as vscode from 'vscode';
import {
  GitHubService,
} from '../services/github-service';
import {
  InstallationManager,
} from '../services/installation-manager';
import {
  PlatformDetector,
} from '../services/platform-detector';
import {
  InstallationScope,
} from '../types/platform';
import {
  Logger,
} from '../utils/logger';

/**
 * Command handler for installing Prompt Registry components
 */
export class InstallCommand {
  private readonly logger: Logger;
  private readonly installationManager: InstallationManager;
  private readonly githubService: GitHubService;
  private readonly platformDetector: PlatformDetector;

  constructor() {
    this.logger = Logger.getInstance();
    this.installationManager = InstallationManager.getInstance();
    this.githubService = GitHubService.getInstance();
    this.platformDetector = PlatformDetector.getInstance();
  }

  private async selectInstallationScope(): Promise<InstallationScope | undefined> {
    const scopeItems: vscode.QuickPickItem[] = [
      {
        label: '👤 User',
        description: 'Install for current user across all workspaces',
        detail: 'Recommended for personal use',
        picked: true
      },
      {
        label: '📁 Workspace',
        description: 'Install for current workspace only',
        detail: 'Shared with team members'
      },
      {
        label: '📂 Project',
        description: 'Install for current project only',
        detail: 'Project-specific configuration'
      }
    ];

    const selectedItem = await vscode.window.showQuickPick(scopeItems, {
      title: 'Select Installation Scope',
      placeHolder: 'Choose where to install Prompt Registry components',
      ignoreFocusOut: true
    });

    if (!selectedItem) {
      return undefined;
    }

    switch (selectedItem.label) {
      case '👤 User': {
        return InstallationScope.USER;
      }
      case '📁 Workspace': {
        return InstallationScope.WORKSPACE;
      }
      case '📂 Project': {
        return InstallationScope.PROJECT;
      }
      default: {
        return InstallationScope.USER;
      }
    }
  }

  /**
   * Execute the install command
   */
  public async execute(): Promise<void> {
    try {
      this.logger.info('Starting Prompt Registry installation...');

      // Show scope selection
      const scope = await this.selectInstallationScope();
      if (!scope) {
        return; // User cancelled
      }

      // Check if already installed in this scope
      const isInstalled = await this.installationManager.isInstalled(scope);
      if (isInstalled) {
        const overwrite = await vscode.window.showWarningMessage(
          `Prompt Registry is already installed in ${scope} scope. Do you want to overwrite it?`,
          'Yes', 'No'
        );

        if (overwrite !== 'Yes') {
          return;
        }
      }

      // Show progress
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Installing Prompt Registry',
          cancellable: true
        },
        async (progress, token) => {
          try {
            // Check connectivity
            progress.report({ increment: 10, message: 'Checking GitHub connectivity...' });

            const isConnected = await this.githubService.checkConnectivity();
            if (!isConnected) {
              throw new Error('Unable to connect to GitHub. Please check your internet connection.');
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

            // Get release based on default version preference
            progress.report({ increment: 15, message: 'Fetching release information...' });

            const release = await this.githubService.getReleaseByVersionPreference();
            const platform = await this.platformDetector.detectPlatform();

            // Find platform bundle
            const bundleInfo = this.githubService.findPlatformBundle(release, platform.platform);
            if (!bundleInfo) {
              throw new Error(`No installation bundle found for your platform (${platform.platform})`);
            }

            // Download bundle
            progress.report({ increment: 25, message: 'Downloading installation bundle...' });

            const bundleBuffer = await this.githubService.downloadBundle(
              bundleInfo,
              (downloadProgress) => {
                progress.report({
                  increment: 0,
                  message: `Downloading... ${downloadProgress.toFixed(1)}%`
                });
              }
            );

            // Install bundle
            progress.report({ increment: 25, message: 'Installing Prompt Registry components...' });

            const installResult = await this.installationManager.installBundle(
              bundleBuffer,
              bundleInfo,
              scope,
              (installProgress, message) => {
                progress.report({
                  increment: 0,
                  message
                });
              }
            );

            if (installResult.success) {
              progress.report({ increment: 25, message: 'Installation completed!' });

              await vscode.window.showInformationMessage(
                `Prompt Registry installed successfully!\n\nLocation: ${installResult.installedPath}\nVersion: ${installResult.version}\nScope: ${installResult.scope}`,
                'Show in Explorer'
              ).then((action) => {
                if (action === 'Show in Explorer') {
                  vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(installResult.installedPath));
                }
              });

              this.logger.info(`Installation completed successfully: ${installResult.installedPath}`);
            } else {
              throw new Error(installResult.error || 'Installation failed');
            }
          } catch (error) {
            if (token.isCancellationRequested) {
              this.logger.info('Installation cancelled by user');
              return;
            }
            throw error;
          }
        }
      );
    } catch (error) {
      this.logger.error('Installation failed', error as Error);

      await vscode.window.showErrorMessage(
        `Failed to install Prompt Registry: ${(error as Error).message}`,
        'Show Logs'
      ).then((action) => {
        if (action === 'Show Logs') {
          this.logger.show();
        }
      });
    }
  }
}

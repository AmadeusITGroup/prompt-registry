import * as vscode from 'vscode';
import {
  GitHubService,
} from '../services/github-service';
import {
  Logger,
} from '../utils/logger';

/**
 * Command handler for validating GitHub access and authentication
 */
export class ValidateAccessCommand {
  private readonly logger: Logger;
  private readonly githubService: GitHubService;

  constructor() {
    this.logger = Logger.getInstance();
    this.githubService = GitHubService.getInstance();
  }

  /**
   * Show detailed validation results to the user
   * @param results
   * @param results.owner
   * @param results.repo
   * @param results.usePrivateRepo
   * @param results.hasToken
   * @param results.accessValid
   * @param results.accessMessage
   * @param results.connectivity
   */
  private async showValidationResults(results: {
    owner: string;
    repo: string;
    usePrivateRepo: boolean;
    hasToken: boolean;
    accessValid: boolean;
    accessMessage: string;
    connectivity: boolean;
  }): Promise<void> {
    const statusItems: string[] = [
      `**Repository**: ${results.owner}/${results.repo}`,
      `**Private Repository Mode**: ${results.usePrivateRepo ? 'Enabled' : 'Disabled'}`,
      `**Authentication Token**: ${results.hasToken ? 'Configured' : 'Not set'}`,
      ''
    ];

    // Repository configuration

    // Connectivity status
    const connectivityIcon = results.connectivity ? '✅' : '❌';
    statusItems.push(`**Connectivity**: ${connectivityIcon} ${results.connectivity ? 'Connected' : 'No connection'}`);

    // Access validation
    const accessIcon = results.accessValid ? '✅' : '❌';
    statusItems.push(`**Repository Access**: ${accessIcon} ${results.accessValid ? 'Valid' : 'Invalid'}`, `**Details**: ${results.accessMessage}`, '');

    // Recommendations
    if (!results.connectivity) {
      statusItems.push('**❗ Recommendations**:', '- Check your internet connection', '- Verify GitHub API URL in settings');
    } else if (results.accessValid) {
      statusItems.push('**✅ All checks passed!** Repository access is working correctly.');
    } else {
      statusItems.push('**❗ Recommendations**:');
      if (results.usePrivateRepo && !results.hasToken) {
        statusItems.push('- Set your GitHub token: generate with `gh auth token`', '- Configure token in VSCode settings: `promptregistry.githubToken`');
      } else if (results.hasToken) {
        statusItems.push('- Verify token has correct permissions', '- Check repository owner and name settings', '- Ensure you have access to the repository');
      } else {
        statusItems.push('- Verify repository owner and name are correct', '- Check if repository is public or enable private mode');
      }
    }

    // Create and show information document
    const content = statusItems.join('\n');
    const doc = await vscode.workspace.openTextDocument({
      content,
      language: 'markdown'
    });

    await vscode.window.showTextDocument(doc, {
      preview: true,
      viewColumn: vscode.ViewColumn.Beside
    });

    // Also show a summary notification
    if (results.accessValid && results.connectivity) {
      vscode.window.showInformationMessage(
        `✅ Repository access validated: ${results.owner}/${results.repo}`,
        'Open Settings'
      ).then((selection) => {
        if (selection === 'Open Settings') {
          vscode.commands.executeCommand('workbench.action.openSettings', 'olaf');
        }
      });
    } else {
      const message = results.connectivity
        ? '❌ Repository access failed'
        : '❌ No connection to GitHub';

      vscode.window.showWarningMessage(
        message,
        'Open Settings',
        'View Details'
      ).then((selection) => {
        if (selection === 'Open Settings') {
          vscode.commands.executeCommand('workbench.action.openSettings', 'olaf');
        }
        // Details are already shown in the document
      });
    }
  }

  /**
   * Execute the validate access command
   */
  public async execute(): Promise<void> {
    try {
      this.logger.info('Validating GitHub repository access...');

      // Show progress while validating
      await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Prompt Registry: Validating Repository Access',
        cancellable: false
      }, async (progress) => {
        progress.report({ increment: 20, message: 'Checking repository configuration...' });

        // Get current configuration
        const config = vscode.workspace.getConfiguration('olaf');
        const owner = config.get<string>('repositoryOwner') || 'AmadeusITGroup';
        const repo = config.get<string>('repositoryName') || 'olaf';
        const usePrivateRepo = config.get<boolean>('usePrivateRepository') || false;
        const hasToken = !!config.get<string>('githubToken');

        progress.report({ increment: 30, message: 'Testing repository access...' });

        // Validate access
        const result = await this.githubService.validateAccess();

        progress.report({ increment: 40, message: 'Checking connectivity...' });

        // Check basic connectivity
        const isConnected = await this.githubService.checkConnectivity();

        progress.report({ increment: 10, message: 'Preparing results...' });

        // Show detailed results
        await this.showValidationResults({
          owner,
          repo,
          usePrivateRepo,
          hasToken,
          accessValid: result.valid,
          accessMessage: result.message,
          connectivity: isConnected
        });
      });
    } catch (error) {
      this.logger.error('Failed to validate GitHub access', error as Error);
      vscode.window.showErrorMessage(`Failed to validate GitHub access: ${error}`);
    }
  }
}

import * as path from 'path';
import * as vscode from 'vscode';
import { SkillWizard } from '../commands/SkillWizard';
import { Logger } from '../utils/logger';
import { TemplateEngine, TemplateContext } from '../services/TemplateEngine';
import { FileUtils } from '../utils/fileUtils';
import { generateSanitizedId } from '../utils/bundleNameUtils';


export enum ScaffoldType {
    Skill = 'skill',
    GitHub = 'github',
    Apm = 'apm',
}

/**
 * Migration scenario detected in existing project
 */
export enum MigrationScenario {
    /** No migration needed */
    None = 'none',
    /** Has collections but no publish workflow */
    MissingWorkflow = 'missing-workflow',
    /** Has chatmode references that need updating */
    ChatmodeReferences = 'chatmode-references',
}

/**
 * Migration recommendation interface
 */
export interface MigrationRecommendation {
    scenario: MigrationScenario;
    message: string;
    documentationUrl: string;
}

export interface ScaffoldOptions {
    projectName?: string;
    skipExamples?: boolean;
    type?: ScaffoldType;
    githubRunner?: string;
    description?: string;
    author?: string;
    tags?: string[];
}

/**
 * Command to scaffold project structures with different types
 */
export class ScaffoldCommand {
    private readonly logger: Logger;
    private readonly templateEngine: TemplateEngine;
    private readonly scaffoldType: ScaffoldType;

    constructor(extensionPathOrTemplateRoot?: string, scaffoldType: ScaffoldType = ScaffoldType.GitHub) {
        this.logger = Logger.getInstance();
        this.scaffoldType = scaffoldType;
        
        // Initialize template engine with scaffold templates
        // If path includes 'templates/scaffolds', use it directly (for tests)
        // Otherwise treat as extensionPath and append templates/scaffolds path
        let templatesPath: string;
        if (extensionPathOrTemplateRoot) {
            if (extensionPathOrTemplateRoot.includes('templates/scaffolds')) {
                templatesPath = extensionPathOrTemplateRoot;
            } else {
                templatesPath = path.join(extensionPathOrTemplateRoot, 'templates/scaffolds', scaffoldType);
            }
        } else {
            templatesPath = path.join(__dirname, '../templates/scaffolds', scaffoldType);
        }
        this.templateEngine = new TemplateEngine(templatesPath);
    }

    /**
     * Execute the scaffold command
     * 
     * @param targetPath - Target directory path or URI
     * @param options - Scaffold options
     */
    async execute(targetPath: string | vscode.Uri, options?: ScaffoldOptions): Promise<void> {
        try {
            const targetUri = typeof targetPath === 'string' ? vscode.Uri.file(targetPath) : targetPath;
            this.logger.info(`Scaffolding ${this.scaffoldType} structure at: ${targetUri.fsPath}`);
            
            // Resolve project name from path if not provided
            const projectDirName = path.basename(targetUri.fsPath);

            // Prepare template context
            const context: TemplateContext = {
                projectName: options?.projectName || projectDirName || 'github-prompts',
                collectionId: generateSanitizedId(options?.projectName || projectDirName),
                githubRunner: options?.githubRunner || 'ubuntu-latest',
                description: options?.description,
                author: options?.author,
                tags: options?.tags,
            };

            // Use template engine to scaffold the entire project
            await this.templateEngine.scaffoldProject(targetUri, context);

            this.logger.info('Scaffold completed successfully');
            
            // Note: npm install prompt is handled by the caller (extension.ts)
            // to ensure it runs AFTER the progress indicator closes

        } catch (error) {
            this.logger.error('Scaffold failed', error as Error);
            throw error;
        }
    }

    /**
     * Detect migration scenario for an existing project
     * Checks for collections folder and determines what migration is needed
     * 
     * @param targetPath - Directory path to check
     * @returns Migration scenario detected
     */
    static async detectMigrationScenario(targetPath: string): Promise<MigrationScenario> {
        try {
            const collectionsDir = path.join(targetPath, 'collections');
            
            // Check if collections directory exists
            if (!await FileUtils.exists(collectionsDir) || !await FileUtils.isDirectory(collectionsDir)) {
                return MigrationScenario.None;
            }

            // Check for collection files
            const entries = await FileUtils.listDirectory(collectionsDir);
            const collectionFiles = entries.filter(f => 
                f.endsWith('.collection.yml') || f.endsWith('.collection.yaml')
            );
            
            if (collectionFiles.length === 0) {
                return MigrationScenario.None;
            }

            // Check for chatmode references in collection files
            for (const file of collectionFiles) {
                try {
                    const content = await FileUtils.readFile(path.join(collectionsDir, file));
                    if (/kind:\s*chatmode/i.test(content)) {
                        return MigrationScenario.ChatmodeReferences;
                    }
                } catch {
                    // Ignore read errors
                }
            }

            // Check if publish workflow exists
            const workflowPath = path.join(targetPath, '.github', 'workflows', 'publish.yml');
            if (!await FileUtils.exists(workflowPath)) {
                return MigrationScenario.MissingWorkflow;
            }

            return MigrationScenario.None;
        } catch {
            return MigrationScenario.None;
        }
    }

    /**
     * Get migration recommendation for a scenario
     */
    static getMigrationRecommendation(scenario: MigrationScenario): MigrationRecommendation | undefined {
        switch (scenario) {
            case MigrationScenario.MissingWorkflow:
                return {
                    scenario,
                    message: 'This project has collections but no GitHub publish workflow.',
                    documentationUrl: 'https://github.com/prompt-registry/docs/blob/main/docs/migration-guide.md'
                };
            case MigrationScenario.ChatmodeReferences:
                return {
                    scenario,
                    message: 'This project uses deprecated chatmode references. Please migrate to agent format.',
                    documentationUrl: 'https://github.com/prompt-registry/docs/blob/main/docs/migration-guide.md#chatmode-to-agent'
                };
            default:
                return undefined;
        }
    }

    /**
     * Show migration recommendation warning message
     * 
     * @param recommendation - Migration recommendation to display
     */
    static async showMigrationRecommendation(recommendation: MigrationRecommendation): Promise<void> {
        const action = await vscode.window.showWarningMessage(
            recommendation.message,
            'View Migration Guide',
            'Dismiss'
        );
        
        if (action === 'View Migration Guide') {
            await vscode.env.openExternal(vscode.Uri.parse(recommendation.documentationUrl));
        }
    }

    /**
     * Check for migration scenarios and show recommendation if needed
     * 
     * @param targetPath - Directory path to check
     * @returns The detected scenario
     */
    static async checkAndShowMigrationRecommendation(targetPath: string): Promise<MigrationScenario> {
        const scenario = await ScaffoldCommand.detectMigrationScenario(targetPath);
        const recommendation = ScaffoldCommand.getMigrationRecommendation(scenario);
        
        if (recommendation) {
            await ScaffoldCommand.showMigrationRecommendation(recommendation);
        }
        
        return scenario;
    }

    /**
     * Run the scaffold command with full UI flow
     */
    static async runWithUI(): Promise<void> {
        const logger = Logger.getInstance();

        try {
            // Step 1: Select scaffold type
            const scaffoldType = await ScaffoldCommand.promptForScaffoldType();
            if (!scaffoldType) {return;}

            // Step 2: Handle skill creation in existing project
            if (scaffoldType.value === ScaffoldType.Skill && await ScaffoldCommand.handleSkillInExistingProject()) {
                return;
            }

            // Step 3: Select target directory
            const targetPath = await ScaffoldCommand.promptForTargetDirectory(scaffoldType.label);
            if (!targetPath) {return;}

            // Step 4: Collect project details
            const options = await ScaffoldCommand.promptForProjectDetails(scaffoldType.value);
            if (!options) {return;}

            // Step 5: Execute scaffold with progress
            await vscode.window.withProgress(
                { location: vscode.ProgressLocation.Notification, title: `Scaffolding ${scaffoldType.label}...` },
                async () => {
                    const cmd = new ScaffoldCommand(undefined, scaffoldType.value);
                    await cmd.execute(targetPath, options);
                }
            );

            // Step 6: Post-scaffold actions
            await ScaffoldCommand.handlePostScaffoldActions(scaffoldType.label, targetPath);
        } catch (error) {
            logger.error('Scaffold failed', error as Error);
            vscode.window.showErrorMessage(`Scaffold failed: ${(error as Error).message}`);
        }
    }

    /**
     * Handle skill creation within existing project
     * @returns true if handled (wizard executed), false to continue normal flow
     */
    private static async handleSkillInExistingProject(): Promise<boolean> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {return false;}

        const workspaceRoot = workspaceFolders[0].uri.fsPath;
        const skillWizard = new SkillWizard();
        
        if (skillWizard.isAwesomeCopilotProject(workspaceRoot)) {
            await skillWizard.execute(workspaceRoot);
            return true;
        }
        return false;
    }

    /**
     * Prompt user to select scaffold type
     */
    private static async promptForScaffoldType(): Promise<{ label: string; value: ScaffoldType } | undefined> {
        return vscode.window.showQuickPick(
            [
                {
                    label: 'GitHub',
                    description: 'GitHub-based prompt library with CI/CD workflows',
                    value: ScaffoldType.GitHub
                },
                {
                    label: 'APM Package',
                    description: 'Distributable prompt package (apm.yml)',
                    value: ScaffoldType.Apm
                },
                {
                    label: 'Agent Skill',
                    description: 'Create a new Agent Skill with SKILL.md',
                    value: ScaffoldType.Skill
                }
            ],
            {
                placeHolder: 'Select project type',
                title: 'Scaffold Project',
                ignoreFocusOut: true
            }
        );
    }

    /**
     * Prompt user to select target directory
     */
    private static async promptForTargetDirectory(typeLabel: string): Promise<vscode.Uri | undefined> {
        // Default to first workspace folder if available
        const defaultUri = vscode.workspace.workspaceFolders?.[0]?.uri;
        
        const targetPath = await vscode.window.showOpenDialog({
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            defaultUri,
            title: `Select Target Directory for ${typeLabel}`
        });
        return targetPath?.[0];
    }

    /**
     * Collect project details from user input
     */
    private static async promptForProjectDetails(type: ScaffoldType): Promise<ScaffoldOptions | undefined> {
        // Get project name
        const projectName = await vscode.window.showInputBox({
            prompt: 'Enter project name (optional)',
            placeHolder: 'example',
            value: 'example',
            ignoreFocusOut: true
        });

        // Get GitHub runner choice
        const githubRunner = await ScaffoldCommand.promptForGitHubRunner();
        let details: { description?: string; author?: string; tags?: string[] } = {};
        // Collect additional details if needed
        
        if (type === ScaffoldType.Apm) {
            const apmDetails = await ScaffoldCommand.promptForApmDetails();
            if (apmDetails) {
                details = apmDetails;
            }
        }

        if (type === ScaffoldType.Skill) {
            const skillsDetails = await ScaffoldCommand.promptForSkillsDetails();
            if (skillsDetails) {
                details = skillsDetails;
            }
        }

        return {
            projectName,
            githubRunner,
            ...details
        };
    }

    /**
     * Prompt for GitHub Actions runner configuration
     */
    private static async promptForGitHubRunner(): Promise<string> {
        const runnerChoice = await vscode.window.showQuickPick(
            [
                {
                    label: 'GitHub-hosted (ubuntu-latest)',
                    description: 'Free GitHub-hosted runner',
                    value: 'ubuntu-latest'
                },
                {
                    label: 'Self-hosted',
                    description: 'Use self-hosted runner',
                    value: 'self-hosted'
                },
                {
                    label: 'Custom',
                    description: 'Specify custom runner label',
                    value: 'custom'
                }
            ],
            {
                placeHolder: 'Select GitHub Actions runner type',
                title: 'GitHub Actions Runner',
                ignoreFocusOut: true
            }
        );

        if (runnerChoice?.value === 'self-hosted') {
            return 'self-hosted';
        }
        
        if (runnerChoice?.value === 'custom') {
            const customRunner = await vscode.window.showInputBox({
                prompt: 'Enter custom runner label',
                placeHolder: 'my-runner or [self-hosted, linux, x64]',
                validateInput: (value) => {
                    if (!value || value.trim().length === 0) {
                        return 'Runner label cannot be empty';
                    }
                    return undefined;
                },
                ignoreFocusOut: true
            });
            return customRunner || 'ubuntu-latest';
        }

        return 'ubuntu-latest';
    }

    /**
     * Prompt for project metadata (description, author, tags)
     * Shared by APM and Skill scaffold types
     * 
     * @param type - The scaffold type ('apm' or 'skill')
     */
    private static async promptForProjectMetadata(type: 'apm' | 'skill'): Promise<{ description?: string; author?: string; tags?: string[] }> {
        const typeLabel = type === 'apm' ? 'package' : 'skill';
        const defaultTags = type === 'apm' ? 'apm, prompts' : 'skill, prompts';
        
        const description = await vscode.window.showInputBox({
            prompt: `Enter ${typeLabel} description`,
            placeHolder: `A short description of your ${typeLabel}`,
            ignoreFocusOut: true
        });

        const author = await vscode.window.showInputBox({
            prompt: 'Enter author name',
            placeHolder: 'Your Name <email@example.com>',
            value: process.env.USER || 'user',
            ignoreFocusOut: true
        });

        const tagsInput = await vscode.window.showInputBox({
            prompt: 'Enter tags (comma separated)',
            placeHolder: 'ai, prompts, coding',
            value: defaultTags,
            ignoreFocusOut: true
        });

        const tags = tagsInput
            ? tagsInput.split(',').map(t => t.trim()).filter(t => t.length > 0)
            : undefined;

        return { description, author, tags };
    }

    /**
     * Prompt for APM-specific project details
     */
    private static async promptForApmDetails(): Promise<{ description?: string; author?: string; tags?: string[] }> {
        return ScaffoldCommand.promptForProjectMetadata('apm');
    }

    /**
     * Prompt for Skill-specific project details
     */
    private static async promptForSkillsDetails(): Promise<{ description?: string; author?: string; tags?: string[] }> {
        return ScaffoldCommand.promptForProjectMetadata('skill');
    }

    /**
     * Handle post-scaffold actions: npm install and folder opening
     */
    private static async handlePostScaffoldActions(typeLabel: string, targetPath: vscode.Uri): Promise<void> {
        // For GitHub scaffold, show authentication setup instructions first
        // The @prompt-registry/collection-scripts package requires GitHub Packages auth
        const setupChoice = await vscode.window.showInformationMessage(
            `${typeLabel} scaffolded successfully! Before running npm install, you need to set up GitHub Packages authentication.`,
            'View Setup Instructions',
            'Open Folder',
            'Skip'
        );

        if (setupChoice === 'View Setup Instructions') {
            // Show detailed instructions
            const instructions = `
## GitHub Packages Authentication Setup

The scaffolded project uses \`@prompt-registry/collection-scripts\` from GitHub Packages, which requires authentication.

### Option 1: Environment Variable (Recommended)
Set the \`GITHUB_TOKEN\` environment variable with a GitHub Personal Access Token (PAT) that has \`read:packages\` scope:

\`\`\`bash
export GITHUB_TOKEN=ghp_your_token_here
npm install
\`\`\`

### Option 2: .npmrc with Token
Edit the \`.npmrc\` file in your project and replace \`\${GITHUB_TOKEN}\` with your actual token:

\`\`\`
@prompt-registry:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=ghp_your_token_here
\`\`\`

### Creating a GitHub PAT
1. Go to GitHub Settings → Developer settings → Personal access tokens
2. Generate a new token with \`read:packages\` scope
3. Copy the token and use it as described above

After setting up authentication, run \`npm install\` in the project directory.
`;
            // Create a virtual document to show instructions
            const doc = await vscode.workspace.openTextDocument({
                content: instructions,
                language: 'markdown'
            });
            await vscode.window.showTextDocument(doc, { preview: true });
            
            // Also offer to open the folder
            const openAfter = await vscode.window.showInformationMessage(
                'Would you like to open the project folder?',
                'Open Folder',
                'No'
            );
            if (openAfter === 'Open Folder') {
                await vscode.commands.executeCommand('vscode.openFolder', targetPath);
            }
        } else if (setupChoice === 'Open Folder') {
            await vscode.commands.executeCommand('vscode.openFolder', targetPath);
            vscode.window.showInformationMessage(
                'Remember to set up GitHub Packages authentication before running npm install. See the .npmrc file for details.'
            );
        }
    }
}

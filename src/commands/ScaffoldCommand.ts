import * as path from 'path';
import * as vscode from 'vscode';
import { SkillWizard } from '../commands/SkillWizard';
import { Logger } from '../utils/logger';
import { TemplateEngine, TemplateContext } from '../services/TemplateEngine';
import { FileUtils } from '../utils/fileUtils';
import { generateSanitizedId } from '../utils/bundleNameUtils';
import { ScaffoldDefaults } from '../types/hub';
import { HubManager } from '../services/HubManager';
import { resolveRunnerPattern } from '../utils/scaffoldUtils';
import { NpmCliWrapper } from '../utils/NpmCliWrapper';


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
    // Organization details for InnerSource LICENSE and docs
    githubOrg?: string;
    organizationName?: string;
    internalContact?: string;
    legalContact?: string;
    organizationPolicyLink?: string;
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
                // Organization details for InnerSource LICENSE and docs
                githubOrg: options?.githubOrg,
                organizationName: options?.organizationName,
                internalContact: options?.internalContact,
                legalContact: options?.legalContact,
                organizationPolicyLink: options?.organizationPolicyLink,
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
    static async runWithUI(hubManager?: HubManager): Promise<void> {
        const logger = Logger.getInstance();

        try {
            // Step 1: Select scaffold type
            const scaffoldType = await ScaffoldCommand.promptForScaffoldType();
            if (!scaffoldType) {return;}

            // Step 2: Load scaffold defaults from active hub
            let scaffoldDefaults: ScaffoldDefaults | undefined;
            if (hubManager) {
                try {
                    const activeHub = await hubManager.getActiveHub();
                    scaffoldDefaults = activeHub?.config?.scaffoldDefaults;
                } catch {
                    // No active hub or hub load failed — proceed without defaults
                }
            }

            // Step 3: Handle skill creation in existing project
            if (scaffoldType.value === ScaffoldType.Skill && await ScaffoldCommand.handleSkillInExistingProject()) {
                return;
            }

            // Step 4: Select target directory
            const targetPath = await ScaffoldCommand.promptForTargetDirectory(scaffoldType.label);
            if (!targetPath) {return;}

            // Step 5: Collect project details
            const options = await ScaffoldCommand.promptForProjectDetails(scaffoldType.value, scaffoldDefaults);
            if (!options) {return;}

            // Step 6: Execute scaffold with progress
            await vscode.window.withProgress(
                { location: vscode.ProgressLocation.Notification, title: `Scaffolding ${scaffoldType.label}...` },
                async () => {
                    const cmd = new ScaffoldCommand(undefined, scaffoldType.value);
                    await cmd.execute(targetPath, options);
                }
            );

            // Step 7: Post-scaffold actions
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
    private static async promptForProjectDetails(type: ScaffoldType, scaffoldDefaults?: ScaffoldDefaults): Promise<ScaffoldOptions | undefined> {
        // Get project name
        const projectName = await vscode.window.showInputBox({
            prompt: 'Enter project name (optional)',
            placeHolder: 'example',
            value: 'example',
            ignoreFocusOut: true
        });

        let details: { description?: string; author?: string; tags?: string[] } = {};
        let orgDetails: { author?: string; githubOrg?: string; organizationName?: string; internalContact?: string; legalContact?: string; organizationPolicyLink?: string } = {};

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

        // For GitHub type, collect organization details for InnerSource LICENSE
        if (type === ScaffoldType.GitHub) {
            orgDetails = await ScaffoldCommand.promptForOrganizationDetails(scaffoldDefaults);
        }

        // Get GitHub runner choice (always asked, prefilled from hub defaults)
        const githubRunner = await ScaffoldCommand.promptForGitHubRunner(scaffoldDefaults, orgDetails.githubOrg);

        return {
            projectName,
            githubRunner,
            ...details,
            ...orgDetails
        };
    }

    /**
     * Prompt for GitHub Actions runner configuration
     */
    private static async promptForGitHubRunner(scaffoldDefaults?: ScaffoldDefaults, githubOrg?: string): Promise<string> {
        // If hub provides a runner default, resolve the pattern and pre-fill
        if (scaffoldDefaults?.githubRunner) {
            const resolvedRunner = githubOrg
                ? resolveRunnerPattern(scaffoldDefaults.githubRunner, githubOrg)
                : scaffoldDefaults.githubRunner;
            const customRunner = await vscode.window.showInputBox({
                prompt: 'Enter GitHub Actions runner label',
                placeHolder: 'my-runner or [self-hosted, linux, x64]',
                value: resolvedRunner,
                validateInput: (value) => {
                    if (!value || value.trim().length === 0) {
                        return 'Runner label cannot be empty';
                    }
                    return undefined;
                },
                ignoreFocusOut: true
            });
            // undefined means the user pressed Escape — use resolved default
            // empty string is prevented by validateInput
            return customRunner ?? resolvedRunner;
        }

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
     * Prompt for organization details for InnerSource LICENSE and docs.
     * When hub scaffoldDefaults are present, individual org-level fields are
     * skipped (hub value used directly). Fields without a hub default are still prompted.
     */
    private static async promptForOrganizationDetails(
        scaffoldDefaults?: ScaffoldDefaults
    ): Promise<{
        author?: string;
        githubOrg?: string;
        organizationName?: string;
        internalContact?: string;
        legalContact?: string;
        organizationPolicyLink?: string
    }> {
        const author = await vscode.window.showInputBox({
            prompt: 'Enter author name (for package.json)',
            placeHolder: 'Your Name or Team Name',
            ignoreFocusOut: true
        });

        // githubOrg: always asked, prefilled from hub defaults if present
        const githubOrg = await vscode.window.showInputBox({
            prompt: 'Enter GitHub organization/username (for repository URLs)',
            placeHolder: 'your-org',
            value: scaffoldDefaults?.githubOrg || '',
            ignoreFocusOut: true
        });

        // Each org field: use hub default if present, otherwise prompt
        const organizationName = scaffoldDefaults?.organizationName ?? await vscode.window.showInputBox({
            prompt: 'Enter organization name (for LICENSE)',
            placeHolder: 'Your Organization Name',
            value: 'Your Organization',
            ignoreFocusOut: true
        });

        const internalContact = scaffoldDefaults?.internalContact ?? await vscode.window.showInputBox({
            prompt: 'Enter internal contact email (for security/support inquiries)',
            placeHolder: 'security@yourorg.com',
            value: 'security@yourorg.com',
            ignoreFocusOut: true
        });

        const legalContact = scaffoldDefaults?.legalContact ?? await vscode.window.showInputBox({
            prompt: 'Enter legal contact email (for licensing questions)',
            placeHolder: 'legal@yourorg.com',
            value: 'legal@yourorg.com',
            ignoreFocusOut: true
        });

        const organizationPolicyLink = scaffoldDefaults?.organizationPolicyLink ?? await vscode.window.showInputBox({
            prompt: 'Enter organization policy URL (optional)',
            placeHolder: 'https://yourorg.com/policies',
            ignoreFocusOut: true
        });

        return {
            author,
            githubOrg,
            organizationName, 
            internalContact, 
            legalContact, 
            organizationPolicyLink 
        };
    }

    /**
     * Handle post-scaffold actions: npm install and folder opening
     */
    private static async handlePostScaffoldActions(typeLabel: string, targetPath: vscode.Uri): Promise<void> {
        const npmWrapper = NpmCliWrapper.getInstance();
        await npmWrapper.installWithProgress(targetPath.fsPath);
        // The @prompt-registry/collection-scripts package is now available on npmjs
        const setupChoice = await vscode.window.showInformationMessage(
            `${typeLabel} scaffolded successfully!`,
            'Open Folder',
            'Skip'
        );
        if (setupChoice === 'Open Folder') {
            await vscode.commands.executeCommand('vscode.openFolder', targetPath);
        }
    }
}

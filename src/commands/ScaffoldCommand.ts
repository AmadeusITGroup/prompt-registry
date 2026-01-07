import * as path from 'path';
import * as vscode from 'vscode';
import { Logger } from '../utils/logger';
import { TemplateEngine, TemplateContext } from '../services/TemplateEngine';

export enum ScaffoldType {
    Skill = 'skill',
    AwesomeCopilot = 'awesome-copilot',
    Apm = 'apm',
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

    constructor(templateRoot?: string, scaffoldType: ScaffoldType = ScaffoldType.AwesomeCopilot) {
        this.logger = Logger.getInstance();
        this.scaffoldType = scaffoldType;
        // Initialize template engine with scaffold templates
        // Use provided path or default to project's template directory with type
        const templatesPath = templateRoot || path.join(__dirname, '../templates/scaffolds', scaffoldType);
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
            const projectDirName = path.basename(targetUri.path); // Use path instead of fsPath for consistency across platforms

            // Prepare template context
            const context: TemplateContext = {
                projectName: options?.projectName || projectDirName || 'awesome-copilot',
                collectionId: this.generateCollectionId(options?.projectName || projectDirName),
                githubRunner: options?.githubRunner || 'ubuntu-latest',
                description: options?.description,
                author: options?.author,
                tags: options?.tags,
            };

            // Use template engine to scaffold the entire project
            await this.templateEngine.scaffoldProject(targetUri, context);

            this.logger.info('Scaffold completed successfully');
        } catch (error) {
            this.logger.error('Scaffold failed', error as Error);
            throw error;
        }
    }

    /**
     * Generate collection ID from project name (kebab-case)
     */
    private generateCollectionId(name: string): string {
        return name.toLowerCase().replace(/\s+/g, '-');
    }
}

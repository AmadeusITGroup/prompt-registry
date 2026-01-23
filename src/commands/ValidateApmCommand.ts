import * as vscode from 'vscode';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { SchemaValidator } from '../services/SchemaValidator';
import { TextDecoder } from 'util';
import { validateCollectionFile, validateAllCollections, listCollectionFiles } from '@prompt-registry/collection-scripts';

interface ValidationResult {
    errors: string[];
    warnings: string[];
    manifest: any | null;
}

/**
 * Command to validate APM packages in the workspace
 */
export class ValidateApmCommand {
    private outputChannel: vscode.OutputChannel;
    private schemaValidator: SchemaValidator;
    private context: vscode.ExtensionContext;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.outputChannel = vscode.window.createOutputChannel('APM Validator');
        this.schemaValidator = new SchemaValidator(context.extensionPath);
    }

    async execute(): Promise<void> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        
        if (!workspaceFolders || workspaceFolders.length === 0) {
            vscode.window.showErrorMessage('No workspace folder open. Please open a folder first.');
            return;
        }

        const workspaceRoot = workspaceFolders[0].uri;
        const manifestUri = vscode.Uri.joinPath(workspaceRoot, 'apm.yml');

        try {
            await vscode.workspace.fs.stat(manifestUri);
        } catch (error) {
            vscode.window.showErrorMessage(`apm.yml not found in workspace root: ${workspaceRoot.fsPath}`);
            return;
        }

        this.outputChannel.clear();
        this.outputChannel.show();

        this.log('🔍 APM Package Validation\n');

        const result = await this.validateManifest(manifestUri);

        if (result.manifest) {
            this.log(`📦 ${result.manifest.name} v${result.manifest.version}`);
            this.log(`   ${result.manifest.description}`);
            this.log('');
        }

        if (result.errors.length === 0 && result.warnings.length === 0) {
            this.log('✅ APM Manifest is valid', 'success');
            vscode.window.showInformationMessage('APM package validated successfully!');
        } else {
            if (result.errors.length > 0) {
                result.errors.forEach(err => this.log(`❌ Error: ${err}`, 'error'));
            }
            if (result.warnings.length > 0) {
                result.warnings.forEach(warn => this.log(`⚠️  Warning: ${warn}`, 'warning'));
            }
            
            if (result.errors.length > 0) {
                vscode.window.showErrorMessage(`Validation failed with ${result.errors.length} error(s)`);
            } else {
                vscode.window.showWarningMessage(`Validation passed with ${result.warnings.length} warning(s)`);
            }
        }
        
        // Also check .apm directory
        const apmDir = vscode.Uri.joinPath(workspaceRoot, '.apm');
        try {
             await vscode.workspace.fs.stat(apmDir);
             // Basic directory check (could be expanded)
             this.log('\nChecking .apm directory structure...');
             const files = await this.scanPrompts(apmDir);
             if (files.length > 0) {
                 this.log(`Found ${files.length} prompt file(s) in .apm directory`);
             } else {
                 this.log('⚠️  .apm directory exists but contains no prompt files', 'warning');
             }
        } catch (error) {
            this.log('\n⚠️  .apm directory not found (no prompts)', 'warning');
        }
    }

    private async validateManifest(fileUri: vscode.Uri): Promise<ValidationResult> {
        const errors: string[] = [];
        const warnings: string[] = [];
        let manifest: any = null;

        try {
            const contentBytes = await vscode.workspace.fs.readFile(fileUri);
            const content = new TextDecoder().decode(contentBytes);
            manifest = yaml.load(content);

            if (!manifest || typeof manifest !== 'object') {
                errors.push('Empty or invalid YAML file');
                return { errors, warnings, manifest: null };
            }

            // Use SchemaValidator
            const validationResult = await this.schemaValidator.validateApm(manifest);
            
            errors.push(...validationResult.errors);
            warnings.push(...validationResult.warnings);

            return { errors, warnings, manifest };

        } catch (error) {
            if (error instanceof yaml.YAMLException) {
                errors.push(`Failed to parse YAML: ${error.message}`);
            } else {
                errors.push(`Failed to validate: ${(error as Error).message}`);
            }
            return { errors, warnings, manifest: null };
        }
    }
    
    private async scanPrompts(dirUri: vscode.Uri, fileList: string[] = []): Promise<string[]> {
        const PROMPT_EXTENSIONS = ['.prompt.md', '.instructions.md', '.chatmode.md', '.agent.md'];
        
        try {
            const entries = await vscode.workspace.fs.readDirectory(dirUri);
            
            for (const [name, type] of entries) {
                const entryUri = vscode.Uri.joinPath(dirUri, name);
                
                if (type === vscode.FileType.Directory && !name.startsWith('.')) {
                    await this.scanPrompts(entryUri, fileList);
                } else {
                    if (PROMPT_EXTENSIONS.some(ext => name.endsWith(ext))) {
                        fileList.push(entryUri.fsPath);
                    }
                }
            }
        } catch (e) {
            // ignore
        }
        return fileList;
    }

    private log(message: string, type?: 'error' | 'warning' | 'success'): void {
        let prefix = '';
        switch (type) {
            case 'error': prefix = '❌ '; break;
            case 'warning': prefix = '⚠️  '; break;
            case 'success': prefix = '✅ '; break;
        }
        this.outputChannel.appendLine(prefix + message);
    }
    
    dispose(): void {
        this.outputChannel.dispose();
    }
}

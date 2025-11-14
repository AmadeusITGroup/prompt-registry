import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { SchemaValidator } from '../services/SchemaValidator';

interface CollectionItem {
    path: string;
    kind: string;
}

interface Collection {
    id?: string;
    name?: string;
    description?: string;
    tags?: string[];
    items?: CollectionItem[];
    version?: string;
    author?: string;
    display?: {
        ordering?: string;
        show_badge?: boolean;
    };
}

interface ValidationResult {
    errors: string[];
    warnings: string[];
    collection: Collection | null;
}

/**
 * Command to validate collection files in the workspace
 * 
 * Attribution: Validation logic inspired by github/awesome-copilot
 * https://github.com/github/awesome-copilot
 */
export class ValidateCollectionsCommand {
    private outputChannel: vscode.OutputChannel;
    private schemaValidator: SchemaValidator;
    private context: vscode.ExtensionContext;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.outputChannel = vscode.window.createOutputChannel('Collection Validator');
        this.schemaValidator = new SchemaValidator(context.extensionPath);
    }

    async execute(options?: { checkRefs?: boolean; listOnly?: boolean }): Promise<void> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        
        if (!workspaceFolders || workspaceFolders.length === 0) {
            vscode.window.showErrorMessage('No workspace folder open. Please open a folder first.');
            return;
        }

        const workspaceRoot = workspaceFolders[0].uri.fsPath;
        const collectionsDir = path.join(workspaceRoot, 'collections');

        if (!fs.existsSync(collectionsDir)) {
            vscode.window.showErrorMessage(`Collections directory not found: ${collectionsDir}`);
            return;
        }

        this.outputChannel.clear();
        this.outputChannel.show();

        this.log('📋 Collection Validation Tool\n');
        this.log('Attribution: Inspired by github/awesome-copilot');
        this.log('https://github.com/github/awesome-copilot\n');

        const files = fs.readdirSync(collectionsDir)
            .filter(f => f.endsWith('.collection.yml'))
            .sort();

        if (files.length === 0) {
            this.log('⚠️  No collection files found in ' + collectionsDir, 'warning');
            vscode.window.showWarningMessage('No collection files found');
            return;
        }

        this.log(`Found ${files.length} collection(s)\n`);

        let totalErrors = 0;
        let totalWarnings = 0;
        let validCollections = 0;

        const diagnostics: vscode.Diagnostic[] = [];

        for (const file of files) {
            const filePath = path.join(collectionsDir, file);
            const result = await this.validateCollection(filePath, workspaceRoot, options?.checkRefs || false);
            
            if (options?.listOnly && result.collection) {
                this.log(`📦 ${result.collection.name} (id: ${result.collection.id})`);
                this.log(`   Description: ${result.collection.description}`);
                this.log(`   Items: ${result.collection.items ? result.collection.items.length : 0}`);
                if (result.collection.tags && result.collection.tags.length > 0) {
                    this.log(`   Tags: ${result.collection.tags.join(', ')}`);
                }
                this.log('');
            } else {
                this.log(`Validating: ${file}`);

                if (result.errors.length === 0 && result.warnings.length === 0) {
                    this.log('  ✅ Valid', 'success');
                    validCollections++;
                } else {
                    if (result.errors.length > 0) {
                        result.errors.forEach(err => {
                            this.log(`  ❌ Error: ${err}`, 'error');
                            // Create diagnostic for VS Code Problems panel
                            const diagnostic = new vscode.Diagnostic(
                                new vscode.Range(0, 0, 0, 0),
                                err,
                                vscode.DiagnosticSeverity.Error
                            );
                            diagnostic.source = 'Collection Validator';
                            diagnostics.push(diagnostic);
                        });
                        totalErrors += result.errors.length;
                    }

                    if (result.warnings.length > 0) {
                        result.warnings.forEach(warn => {
                            this.log(`  ⚠️  Warning: ${warn}`, 'warning');
                            // Create diagnostic for warnings
                            const diagnostic = new vscode.Diagnostic(
                                new vscode.Range(0, 0, 0, 0),
                                warn,
                                vscode.DiagnosticSeverity.Warning
                            );
                            diagnostic.source = 'Collection Validator';
                            diagnostics.push(diagnostic);
                        });
                        totalWarnings += result.warnings.length;
                    }

                    if (result.errors.length === 0) {
                        validCollections++;
                    }
                }

                this.log('');
            }
        }

        if (!options?.listOnly) {
            this.log('─'.repeat(50));
            this.log(`\n📊 Summary:`);
            this.log(`   Total collections: ${files.length}`);
            this.log(`   Valid: ${validCollections}`);
            this.log(`   Errors: ${totalErrors}`);
            this.log(`   Warnings: ${totalWarnings}\n`);

            if (totalErrors === 0 && totalWarnings === 0) {
                this.log('🎉 All collections are valid!', 'success');
                vscode.window.showInformationMessage(`All ${files.length} collection(s) validated successfully!`);
            } else if (totalErrors === 0) {
                vscode.window.showWarningMessage(`Validation complete with ${totalWarnings} warning(s)`);
            } else {
                vscode.window.showErrorMessage(`Validation failed with ${totalErrors} error(s)`);
            }
        }
    }

    private async validateCollection(
        filePath: string,
        workspaceRoot: string,
        checkRefs: boolean
    ): Promise<ValidationResult> {
        const errors: string[] = [];
        const warnings: string[] = [];
        let collection: Collection | null = null;

        try {
            const content = fs.readFileSync(filePath, 'utf8');
            collection = yaml.load(content) as Collection;

            if (!collection || typeof collection !== 'object') {
                errors.push('Empty or invalid YAML file');
                return { errors, warnings, collection: null };
            }

            // Use SchemaValidator for validation
            const validationResult = await this.schemaValidator.validateCollection(
                collection,
                {
                    checkFileReferences: checkRefs,
                    workspaceRoot: workspaceRoot
                }
            );

            // Add schema validation errors
            errors.push(...validationResult.errors);
            
            // Add schema validation warnings
            warnings.push(...validationResult.warnings);

            // Additional tag-specific validation (not in schema)
            if (collection.tags) {
                if (!Array.isArray(collection.tags)) {
                    errors.push('Tags must be an array');
                } else {
                    if (collection.tags.length > 10) {
                        warnings.push('More than 10 tags (recommended max)');
                    }
                    collection.tags.forEach((tag: any, index: number) => {
                        if (typeof tag !== 'string') {
                            errors.push(`Tag ${index + 1}: Must be a string`);
                        } else if (tag.length > 30) {
                            warnings.push(`Tag ${index + 1}: Longer than 30 characters`);
                        }
                    });
                }
            }

            return { errors, warnings, collection };

        } catch (error) {
            if (error instanceof yaml.YAMLException) {
                errors.push(`Failed to parse YAML: ${error.message}`);
            } else {
                errors.push(`Failed to validate: ${(error as Error).message}`);
            }
            return { errors, warnings, collection: null };
        }
    }

    private log(message: string, type?: 'error' | 'warning' | 'success'): void {
        let prefix = '';
        switch (type) {
            case 'error':
                prefix = '❌ ';
                break;
            case 'warning':
                prefix = '⚠️  ';
                break;
            case 'success':
                prefix = '✅ ';
                break;
        }
        this.outputChannel.appendLine(prefix + message);
    }

    dispose(): void {
        this.outputChannel.dispose();
    }
}

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { SchemaValidator } from '../services/SchemaValidator';
import { UrlValidator, UrlCheckResult } from '../services/UrlValidator';
import { HubConfig, HubSource } from '../types/hub';

interface ValidationResult {
    errors: string[];
    warnings: string[];
    hubConfig: HubConfig | null;
}

/**
 * Command to validate hub configuration files in the workspace
 */
export class ValidateHubCommand {
    private outputChannel: vscode.OutputChannel;
    private schemaValidator: SchemaValidator;
    private urlValidator: UrlValidator;
    private context: vscode.ExtensionContext;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.outputChannel = vscode.window.createOutputChannel('Hub Validator');
        this.schemaValidator = new SchemaValidator(context.extensionPath);
        this.urlValidator = new UrlValidator();
    }

    async execute(options?: { filePath?: string }): Promise<void> {
        let hubConfigPath: string | undefined;

        if (options?.filePath) {
            // Use provided file path
            hubConfigPath = options.filePath;
        } else {
            // Look for hub-config.yml in workspace root or prompt user
            const workspaceFolders = vscode.workspace.workspaceFolders;
            
            if (!workspaceFolders || workspaceFolders.length === 0) {
                // No workspace, prompt for file
                const fileUri = await vscode.window.showOpenDialog({
                    canSelectFiles: true,
                    canSelectFolders: false,
                    canSelectMany: false,
                    filters: {
                        'YAML files': ['yml', 'yaml'],
                        'All files': ['*']
                    },
                    title: 'Select hub-config.yml file'
                });

                if (!fileUri || fileUri.length === 0) {
                    return;
                }

                hubConfigPath = fileUri[0].fsPath;
            } else {
                const workspaceRoot = workspaceFolders[0].uri.fsPath;
                const defaultPath = path.join(workspaceRoot, 'hub-config.yml');

                if (fs.existsSync(defaultPath)) {
                    hubConfigPath = defaultPath;
                } else {
                    // Prompt user to select file or use default location
                    const choice = await vscode.window.showQuickPick(
                        [
                            { label: '$(file) Select hub-config.yml file', value: 'select' },
                            { label: '$(close) Cancel', value: 'cancel' }
                        ],
                        {
                            placeHolder: 'hub-config.yml not found in workspace root. What would you like to do?'
                        }
                    );

                    if (!choice || choice.value === 'cancel') {
                        return;
                    }

                    const fileUri = await vscode.window.showOpenDialog({
                        canSelectFiles: true,
                        canSelectFolders: false,
                        canSelectMany: false,
                        filters: {
                            'YAML files': ['yml', 'yaml'],
                            'All files': ['*']
                        },
                        title: 'Select hub-config.yml file',
                        defaultUri: vscode.Uri.file(workspaceRoot)
                    });

                    if (!fileUri || fileUri.length === 0) {
                        return;
                    }

                    hubConfigPath = fileUri[0].fsPath;
                }
            }
        }

        if (!hubConfigPath || !fs.existsSync(hubConfigPath)) {
            vscode.window.showErrorMessage(`Hub configuration file not found: ${hubConfigPath}`);
            return;
        }

        this.outputChannel.clear();
        this.outputChannel.show();

        this.log('🔍 Hub Configuration Validation\n');
        this.log(`Validating: ${hubConfigPath}\n`);

        const result = await this.validateHubConfig(hubConfigPath);

        this.log('═'.repeat(60) + '\n');

        if (result.hubConfig) {
            this.log('📊 Hub Information:');
            this.log(`   Name: ${result.hubConfig.metadata.name}`);
            this.log(`   Description: ${result.hubConfig.metadata.description}`);
            this.log(`   Maintainer: ${result.hubConfig.metadata.maintainer}`);
            this.log(`   Version: ${result.hubConfig.version}`);
            this.log(`   Updated: ${result.hubConfig.metadata.updatedAt}`);
            this.log(`   Sources: ${result.hubConfig.sources?.length || 0}`);
            this.log(`   Profiles: ${result.hubConfig.profiles?.length || 0}\n`);

            // Display sources summary
            if (result.hubConfig.sources && result.hubConfig.sources.length > 0) {
                this.log('📦 Sources:');
                for (const source of result.hubConfig.sources) {
                    const status = source.enabled ? '✅' : '❌';
                    this.log(`   ${status} ${source.id} (${source.type}) - Priority: ${source.priority}`);
                }
                this.log('');
            }

            // Display profiles summary
            if (result.hubConfig.profiles && result.hubConfig.profiles.length > 0) {
                this.log('👤 Profiles:');
                for (const profile of result.hubConfig.profiles) {
                    const icon = profile.icon || '📋';
                    const status = profile.active ? '(active)' : '';
                    this.log(`   ${icon} ${profile.name} ${status} - ${profile.bundles?.length || 0} bundles`);
                }
                this.log('');
            }
        }

        this.log('─'.repeat(60) + '\n');

        // Display validation results
        if (result.errors.length === 0 && result.warnings.length === 0) {
            this.log('✅ Hub configuration is valid!', 'success');
            vscode.window.showInformationMessage('✅ Hub configuration validated successfully!');
        } else {
            if (result.errors.length > 0) {
                this.log('❌ Validation Errors:\n', 'error');
                result.errors.forEach(err => {
                    this.log(`   • ${err}`, 'error');
                });
                this.log('');
            }

            if (result.warnings.length > 0) {
                this.log('⚠️  Validation Warnings:\n', 'warning');
                result.warnings.forEach(warn => {
                    this.log(`   • ${warn}`, 'warning');
                });
                this.log('');
            }

            this.log('─'.repeat(60) + '\n');
            this.log(`📊 Summary: ${result.errors.length} error(s), ${result.warnings.length} warning(s)\n`);

            if (result.errors.length > 0) {
                vscode.window.showErrorMessage(`Hub validation failed with ${result.errors.length} error(s). Check output for details.`);
            } else {
                vscode.window.showWarningMessage(`Hub validation completed with ${result.warnings.length} warning(s). Check output for details.`);
            }
        }
    }

    private async validateHubConfig(filePath: string): Promise<ValidationResult> {
        const errors: string[] = [];
        const warnings: string[] = [];
        let hubConfig: HubConfig | null = null;

        try {
            const content = fs.readFileSync(filePath, 'utf8');
            hubConfig = yaml.load(content) as HubConfig;

            if (!hubConfig || typeof hubConfig !== 'object') {
                errors.push('Empty or invalid YAML file');
                return { errors, warnings, hubConfig: null };
            }

            // Level 1: Schema Validation
            this.log('📋 Level 1: Schema Validation');
            const schemaResult = await this.schemaValidator.validateHub(hubConfig);
            
            if (schemaResult.errors.length > 0) {
                this.log('   ❌ Schema validation failed\n', 'error');
                errors.push(...schemaResult.errors);
            } else {
                this.log('   ✅ Schema validation passed\n', 'success');
            }
            
            warnings.push(...schemaResult.warnings);

            // Level 2: Profile-Source Reference Validation
            this.log('🔗 Level 2: Profile-Source Reference Validation');
            const profileSourceResult = this.validateProfileSourceReferences(hubConfig);
            
            if (profileSourceResult.errors.length > 0) {
                this.log('   ❌ Profile-source validation failed\n', 'error');
                errors.push(...profileSourceResult.errors);
            } else {
                this.log('   ✅ All profile bundles reference valid sources\n', 'success');
            }
            
            warnings.push(...profileSourceResult.warnings);

            // Level 3: URL Accessibility Validation
            this.log('🌐 Level 3: URL Accessibility Validation');
            const urlResult = await this.validateUrls(hubConfig);
            
            if (urlResult.errors.length > 0) {
                this.log('   ❌ Some URLs are broken\n', 'error');
                errors.push(...urlResult.errors);
            } else if (urlResult.warnings.length > 0) {
                this.log('   ⚠️  Some URLs are inaccessible (private repos expected)\n', 'warning');
            } else {
                this.log('   ✅ All URLs are accessible\n', 'success');
            }
            
            warnings.push(...urlResult.warnings);

            return { errors, warnings, hubConfig };

        } catch (error) {
            if (error instanceof yaml.YAMLException) {
                errors.push(`Failed to parse YAML: ${error.message}`);
            } else {
                errors.push(`Failed to validate: ${(error as Error).message}`);
            }
            return { errors, warnings, hubConfig: null };
        }
    }

    /**
     * Validate that all profile bundles reference existing sources
     */
    private validateProfileSourceReferences(config: HubConfig): { errors: string[]; warnings: string[] } {
        const errors: string[] = [];
        const warnings: string[] = [];

        // Build set of valid source IDs
        const sourceIds = new Set<string>();
        if (config.sources) {
            config.sources.forEach(source => sourceIds.add(source.id));
        }

        // Check each profile's bundles
        if (config.profiles && Array.isArray(config.profiles)) {
            for (const profile of config.profiles) {
                if (!profile.bundles || !Array.isArray(profile.bundles)) {
                    continue;
                }

                for (const bundle of profile.bundles) {
                    if (!bundle.source) {
                        errors.push(`Profile "${profile.name}" (${profile.id}): Bundle "${bundle.id}" is missing source reference`);
                        continue;
                    }

                    if (!sourceIds.has(bundle.source)) {
                        errors.push(`Profile "${profile.name}" (${profile.id}): Bundle "${bundle.id}" references non-existent source "${bundle.source}"`);
                    }
                }
            }
        }

        return { errors, warnings };
    }

    /**
     * Validate URL accessibility for all sources
     */
    private async validateUrls(config: HubConfig): Promise<{ errors: string[]; warnings: string[] }> {
        const errors: string[] = [];
        const warnings: string[] = [];

        if (!config.sources || config.sources.length === 0) {
            return { errors, warnings };
        }

        // Extract URLs from sources
        const urlChecks: Array<{ source: HubSource; url: string }> = [];
        
        for (const source of config.sources) {
            if (source.url) {
                urlChecks.push({ source, url: source.url });
            } else if ((source as any).repository) {
                // For GitHub/GitLab repositories, construct URL
                if (source.type === 'github') {
                    urlChecks.push({ source, url: `https://github.com/${(source as any).repository}` });
                } else if (source.type === 'gitlab') {
                    urlChecks.push({ source, url: `https://gitlab.com/${(source as any).repository}` });
                }
            }
        }

        if (urlChecks.length === 0) {
            this.log('   ℹ️  No URLs to validate\n');
            return { errors, warnings };
        }

        this.log(`   Checking ${urlChecks.length} URL(s)...\n`);

        // Check URLs in parallel
        const results = await this.urlValidator.checkUrls(
            urlChecks.map(uc => uc.url)
        );

        // Process results
        for (let i = 0; i < results.length; i++) {
            const result = results[i];
            const sourceInfo = urlChecks[i];
            const icon = result.severity === 'success' ? '✅' : result.severity === 'warning' ? '⚠️' : '❌';
            
            this.log(`   ${icon} ${sourceInfo.source.id} (${result.url})`);
            this.log(`      ${result.message}${result.statusCode ? ` (${result.statusCode})` : ''}`);

            if (result.severity === 'error') {
                errors.push(`Source "${sourceInfo.source.id}": ${result.message}`);
            } else if (result.severity === 'warning') {
                warnings.push(`Source "${sourceInfo.source.id}": ${result.message}`);
            }
        }

        this.log('');
        return { errors, warnings };
    }

    private log(message: string, type?: 'error' | 'warning' | 'success'): void {
        this.outputChannel.appendLine(message);
    }

    dispose(): void {
        this.outputChannel.dispose();
    }
}

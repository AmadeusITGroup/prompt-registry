/* eslint-disable @typescript-eslint/member-ordering --
 * Methods are grouped by role (public execute / dispose first, then private
 * helpers) which aids readability of this command.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import {
  SchemaValidator,
} from '../services/schema-validator';

interface PluginItem {
  kind: string;
  path: string;
}

interface Plugin {
  id?: string;
  name?: string;
  description?: string;
  tags?: string[];
  items?: PluginItem[];
  version?: string;
  author?: string | { name: string; url?: string; email?: string };
  display?: {
    ordering?: string;
    // eslint-disable-next-line @typescript-eslint/naming-convention -- external JSON field
    show_badge?: boolean;
  };
  external?: boolean;
  repository?: string;
  homepage?: string;
  license?: string;
}

interface PluginValidationResult {
  errors: string[];
  warnings: string[];
  plugin: Plugin | null;
}

/**
 * Command to validate plugin directories in the workspace
 *
 * Validates plugins/<id>/.github/plugin/plugin.json files against the plugin schema.
 * Mirrors ValidateCollectionsCommand for the new plugin format.
 */
export class ValidatePluginsCommand {
  private readonly outputChannel: vscode.OutputChannel;
  private readonly schemaValidator: SchemaValidator;
  private readonly context: vscode.ExtensionContext;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.outputChannel = vscode.window.createOutputChannel('Plugin Validator');
    this.schemaValidator = new SchemaValidator(context.extensionPath);
  }

  public async execute(options?: { listOnly?: boolean }): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;

    if (!workspaceFolders || workspaceFolders.length === 0) {
      vscode.window.showErrorMessage('No workspace folder open. Please open a folder first.');
      return;
    }

    const workspaceRoot = workspaceFolders[0].uri.fsPath;
    const pluginsDir = path.join(workspaceRoot, 'plugins');

    if (!fs.existsSync(pluginsDir)) {
      vscode.window.showErrorMessage(`Plugins directory not found: ${pluginsDir}`);
      return;
    }

    this.outputChannel.clear();
    this.outputChannel.show();

    this.log('🔌 Plugin Validation Tool\n');

    // Find plugin directories (each should have .github/plugin/plugin.json)
    const pluginDirs = this.findPluginDirectories(pluginsDir);

    if (pluginDirs.length === 0) {
      this.log('⚠️  No plugin directories found in ' + pluginsDir, 'warning');
      vscode.window.showWarningMessage('No plugin directories found');
      return;
    }

    this.log(`Found ${pluginDirs.length} plugin(s)\n`);

    let totalErrors = 0;
    let totalWarnings = 0;
    let validPlugins = 0;

    // Track IDs for duplicate detection
    const seenIds = new Map<string, string>();

    for (const dir of pluginDirs) {
      const pluginJsonPath = path.join(pluginsDir, dir, '.github', 'plugin', 'plugin.json');
      const result = await this.validatePlugin(pluginJsonPath, path.join(pluginsDir, dir));

      // Check for duplicate IDs
      if (result.plugin?.id) {
        if (seenIds.has(result.plugin.id)) {
          result.errors.push(`Duplicate plugin ID '${result.plugin.id}' (also in ${seenIds.get(result.plugin.id)})`);
        } else {
          seenIds.set(result.plugin.id, dir);
        }
      }

      if (options?.listOnly && result.plugin) {
        this.log(`🔌 ${result.plugin.name || dir} (id: ${result.plugin.id})`);
        this.log(`   Description: ${result.plugin.description}`);
        this.log(`   Items: ${result.plugin.items ? result.plugin.items.length : 0}`);
        if (result.plugin.tags && result.plugin.tags.length > 0) {
          this.log(`   Tags: ${result.plugin.tags.join(', ')}`);
        }
        this.log('');
      } else {
        this.log(`Validating: ${dir}/`);

        if (result.errors.length === 0 && result.warnings.length === 0) {
          this.log('  ✅ Valid', 'success');
          validPlugins++;
        } else {
          if (result.errors.length > 0) {
            result.errors.forEach((err) => {
              this.log(`  ❌ Error: ${err}`, 'error');
            });
            totalErrors += result.errors.length;
          }

          if (result.warnings.length > 0) {
            result.warnings.forEach((warn) => {
              this.log(`  ⚠️  Warning: ${warn}`, 'warning');
            });
            totalWarnings += result.warnings.length;
          }

          if (result.errors.length === 0) {
            validPlugins++;
          }
        }

        this.log('');
      }
    }

    if (!options?.listOnly) {
      this.log('─'.repeat(50));
      this.log(`\n📊 Summary:`);
      this.log(`   Total plugins: ${pluginDirs.length}`);
      this.log(`   Valid: ${validPlugins}`);
      this.log(`   Errors: ${totalErrors}`);
      this.log(`   Warnings: ${totalWarnings}\n`);

      if (totalErrors === 0 && totalWarnings === 0) {
        this.log('🎉 All plugins are valid!', 'success');
        vscode.window.showInformationMessage(`All ${pluginDirs.length} plugin(s) validated successfully!`);
      } else if (totalErrors === 0) {
        vscode.window.showWarningMessage(`Validation complete with ${totalWarnings} warning(s)`);
      } else {
        vscode.window.showErrorMessage(`Validation failed with ${totalErrors} error(s)`);
      }
    }
  }

  /**
   * Find plugin directories that contain .github/plugin/plugin.json
   * @param pluginsDir
   */
  private findPluginDirectories(pluginsDir: string): string[] {
    const entries = fs.readdirSync(pluginsDir, { withFileTypes: true });
    return entries
      .filter((entry) => {
        if (!entry.isDirectory()) {
          return false;
        }
        const pluginJsonPath = path.join(pluginsDir, entry.name, '.github', 'plugin', 'plugin.json');
        return fs.existsSync(pluginJsonPath);
      })
      .map((entry) => entry.name)
      .toSorted();
  }

  private async validatePlugin(
    pluginJsonPath: string,
    pluginDir: string
  ): Promise<PluginValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];
    let plugin: Plugin | null = null;

    try {
      const content = fs.readFileSync(pluginJsonPath, 'utf8');
      plugin = JSON.parse(content) as Plugin;

      if (!plugin || typeof plugin !== 'object') {
        errors.push('Empty or invalid JSON file');
        return { errors, warnings, plugin: null };
      }

      // Schema validation
      const validationResult = await this.schemaValidator.validatePlugin(plugin);
      errors.push(...validationResult.errors);
      warnings.push(...validationResult.warnings);

      // Validate item file references
      if (plugin.items && Array.isArray(plugin.items)) {
        for (const item of plugin.items) {
          if (item.path) {
            const relativePath = item.path.startsWith('./') ? item.path.substring(2) : item.path;
            const fullPath = path.join(pluginDir, relativePath);
            if (!fs.existsSync(fullPath)) {
              errors.push(`Referenced path not found: ${item.path}`);
            }
          }
        }
      }

      // Additional warnings
      if (plugin.tags && Array.isArray(plugin.tags) && plugin.tags.length > 10) {
        warnings.push('More than 10 tags (recommended max)');
      }

      return { errors, warnings, plugin };
    } catch (error) {
      if (error instanceof SyntaxError) {
        errors.push(`Failed to parse JSON: ${error.message}`);
      } else {
        errors.push(`Failed to validate: ${(error as Error).message}`);
      }
      return { errors, warnings, plugin: null };
    }
  }

  private log(message: string, type?: 'error' | 'warning' | 'success'): void {
    let prefix = '';
    switch (type) {
      case 'error': {
        prefix = '❌ ';
        break;
      }
      case 'warning': {
        prefix = '⚠️  ';
        break;
      }
      case 'success': {
        prefix = '✅ ';
        break;
      }
    }
    this.outputChannel.appendLine(prefix + message);
  }

  public dispose(): void {
    this.outputChannel.dispose();
  }
}

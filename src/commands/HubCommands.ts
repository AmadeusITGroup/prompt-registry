/**
 * HubCommands - VS Code commands for hub management
 * Provides user interface for importing, listing, syncing, and deleting hubs
 */

import * as vscode from 'vscode';
import { Logger } from '../utils/logger';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { HubManager } from '../services/HubManager';
import { RegistryManager } from '../services/RegistryManager';
import { HubReference } from '../types/hub';

/**
 * Hub source type for user selection
 */
interface HubSourceOption {
    label: string;
    description: string;
    value: 'github' | 'url' | 'local';
}

/**
 * Hub list item for display
 */
interface HubListItem extends vscode.QuickPickItem {
    hubId: string;
    action?: string;
}

/**
 * HubCommands manages VS Code commands for hub operations
 */
export class HubCommands {
    private hubManager: HubManager;
    private registryManager: RegistryManager;

    /**
     * Initialize HubCommands and register commands
     * @param hubManager HubManager instance
     * @param context Extension context for command registration
     */
    private logger: Logger;

    constructor(
        hubManager: HubManager,
        registryManager: RegistryManager,
        context: vscode.ExtensionContext
    ) {
        this.logger = Logger.getInstance();
        this.hubManager = hubManager;
        this.registryManager = registryManager;
        this.context = context;
        this.registerCommands();
    }

    private context: vscode.ExtensionContext;

    /**
     * Register all hub-related commands
     */
    registerCommands(): void {
        // Skip registration if vscode.commands is not available (e.g., in unit tests)
        if (!vscode.commands || !vscode.commands.registerCommand) {
            return;
        }
        
        this.context.subscriptions.push(
            vscode.commands.registerCommand('promptregistry.importHub', () => this.importHub()),
            vscode.commands.registerCommand('promptregistry.listHubs', () => this.listHubs()),
            vscode.commands.registerCommand('promptregistry.syncHub', (hubId?: string) => this.syncHub(hubId)),
            vscode.commands.registerCommand('promptregistry.deleteHub', (hubId?: string) => this.deleteHub(hubId)),
            vscode.commands.registerCommand('promptregistry.exportHubConfig', () => this.exportHubConfig())
        );
    }

    /**
     * Import a hub from various sources
     */
    async importHub(): Promise<string | undefined> {
        try {
            // Step 1: Select source type
            const sourceType = await this.selectSourceType();
            if (!sourceType) {
                return undefined;
            }

            // Step 2: Get hub reference based on source type
            const reference = await this.getHubReference(sourceType);
            if (!reference) {
                return undefined;
            }

            // Step 3: Get hub ID (optional, will auto-generate if not provided)
            const hubId = await this.getHubId();
            if (hubId === null) {
                return undefined; // User cancelled
            }

            // Step 4: Import hub with progress
            return await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: 'Importing Hub',
                    cancellable: false
                },
                async (progress) => {
                    progress.report({ message: 'Loading hub configuration...' });

                    try {
                        const importedHubId = await this.hubManager.importHub(reference, hubId || undefined);
                        
                        progress.report({ message: 'Creating profiles...' });
                        
                        // Load the hub and create profiles
                        const importedHubConfig = await this.hubManager.loadHub(importedHubId);
                        if (importedHubConfig.config.profiles && importedHubConfig.config.profiles.length > 0) {
                            for (const profileConfig of importedHubConfig.config.profiles) {
                                try {
                                    await this.registryManager.createProfile({
                                        id: profileConfig.id,
                                        name: profileConfig.name,
                                        description: profileConfig.description || '',
                                        icon: profileConfig.icon || '📦',
                                        bundles: profileConfig.bundles || [],
                                        active: false
                                    });
                                } catch (error) {
                                    this.logger.error(`Failed to create profile ${profileConfig.id}`, error as Error);
                                }
                            }
                            this.logger.info(`Created ${importedHubConfig.config.profiles.length} profiles from hub`);
                        }
                        

                        vscode.window.showInformationMessage(
                            `Successfully imported hub: ${importedHubId}`
                        );

                        // Refresh the tree view to show the new hub
                        vscode.commands.executeCommand('promptregistry.refresh');
                        
                        return importedHubId;
                    } catch (error) {
                        const message = error instanceof Error ? error.message : String(error);
                        vscode.window.showErrorMessage(`Failed to import hub: ${message}`);
                        throw error;
                    }
                }
            );
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Hub import failed: ${message}`);
            return undefined;
        }
    }

    /**
     * List all imported hubs
     */
    async listHubs(): Promise<void> {
        try {
            const hubs = await this.hubManager.listHubs();

            if (hubs.length === 0) {
                vscode.window.showInformationMessage('No hubs imported yet. Use "Import Hub" to add one.');
                return;
            }

            // Create quick pick items
            const items: HubListItem[] = hubs.map(hub => ({
                label: hub.name,
                description: hub.description,
                detail: `ID: ${hub.id} | Source: ${hub.reference.type}`,
                hubId: hub.id
            }));

            // Show quick pick
            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: 'Select a hub to view details',
                matchOnDescription: true,
                matchOnDetail: true
            });

            if (selected) {
                await this.showHubDetails(selected.hubId);
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to list hubs: ${message}`);
        }
    }

    /**
     * Sync a hub from its source
     * @param hubId Optional hub ID to sync (if not provided, user selects)
     */
    async syncHub(hubId?: string | any): Promise<void> {
        try {
            // Extract hub ID from tree item if object is passed
            let targetHubId: string | undefined;
            if (typeof hubId === 'string') {
                targetHubId = hubId;
            } else if (hubId && typeof hubId === 'object' && hubId.data) {
                // Tree item passed from context menu
                targetHubId = hubId.data.id;
            }

            // If no hub ID provided, let user select
            if (!targetHubId) {
                const hubs = await this.hubManager.listHubs();

                if (hubs.length === 0) {
                    vscode.window.showInformationMessage('No hubs to sync.');
                    return;
                }

                // Add "Sync All" option
                const items: HubListItem[] = [
                    {
                        label: '$(sync) Sync All Hubs',
                        description: 'Synchronize all imported hubs',
                        hubId: '',
                        action: 'all'
                    },
                    ...hubs.map(hub => ({
                        label: hub.name,
                        description: `Sync from ${hub.reference.type}`,
                        detail: `ID: ${hub.id}`,
                        hubId: hub.id
                    }))
                ];

                const selected = await vscode.window.showQuickPick(items, {
                    placeHolder: 'Select hub to sync'
                });

                if (!selected) {
                    return;
                }

                if (selected.action === 'all') {
                    await this.syncAllHubs();
                    return;
                }

                targetHubId = selected.hubId;
            }

            // Sync single hub
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: `Syncing hub: ${targetHubId}`,
                    cancellable: false
                },
                async () => {
                    await this.hubManager.syncHub(targetHubId!);
                    vscode.window.showInformationMessage(`Successfully synced hub: ${targetHubId}`);
                }
            );
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.logger.error('Failed to sync hub', error as Error);
            vscode.window.showErrorMessage(`Failed to sync hub: ${message}`);
        }
    }

    /**
     * Delete a hub
     * @param hubId Optional hub ID to delete (if not provided, user selects)
     */
    async deleteHub(hubId?: string | any): Promise<void> {
        try {
            // Extract hub ID from tree item if object is passed
            let targetHubId: string | undefined;
            if (typeof hubId === 'string') {
                targetHubId = hubId;
            } else if (hubId && typeof hubId === 'object' && hubId.data) {
                // Tree item passed from context menu
                targetHubId = hubId.data.id;
            }

            // If no hub ID provided, let user select
            if (!targetHubId) {
                const hubs = await this.hubManager.listHubs();

                if (hubs.length === 0) {
                    vscode.window.showInformationMessage('No hubs to delete.');
                    return;
                }

                const items: HubListItem[] = hubs.map(hub => ({
                    label: hub.name,
                    description: hub.description,
                    detail: `ID: ${hub.id}`,
                    hubId: hub.id
                }));

                const selected = await vscode.window.showQuickPick(items, {
                    placeHolder: 'Select hub to delete'
                });

                if (!selected) {
                    return;
                }

                targetHubId = selected.hubId;
            }

            // Confirm deletion
            const hubInfo = await this.hubManager.getHubInfo(targetHubId);
            const confirmation = await vscode.window.showWarningMessage(
                `Delete hub "${hubInfo.config.metadata.name}"? This cannot be undone.`,
                { modal: true },
                'Delete'
            );

            if (confirmation !== 'Delete') {
                return;
            }

            // Delete hub
            await this.hubManager.deleteHub(targetHubId);
            
            // Refresh the tree view
            vscode.commands.executeCommand('promptregistry.refresh');
            
            vscode.window.showInformationMessage(`Deleted hub: ${targetHubId}`);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.logger.error('Failed to delete hub', error as Error);
            vscode.window.showErrorMessage(`Failed to delete hub: ${message}`);
        }
    }

    /**
     * Export current registry state as a hub configuration file
     * Useful for creating a seed hub config from existing setup
     */
    /**
     * Map internal source type to hub schema-compliant type
     */
    private mapSourceTypeForHub(sourceType: string): 'github' | 'local' | 'url' {
        // Map internal source types to schema-compliant types
        switch (sourceType) {
            case 'github':
            case 'gitlab':
                return 'github';
            case 'local':
            case 'local-awesome-copilot':
            case 'awesome-copilot':
                return 'local';
            case 'http':
            case 'url':
                return 'url';
            default:
                return 'url'; // Default fallback
        }
    }

    async exportHubConfig(): Promise<void> {
        try {
            // Get current profiles and sources
            const profiles = await this.registryManager.listProfiles();
            const sources = await this.registryManager.listSources();
            const installedBundles = await this.registryManager.listInstalledBundles();

            // Prompt for hub metadata
            const hubName = await vscode.window.showInputBox({
                prompt: 'Enter hub name',
                placeHolder: 'My Awesome Hub',
                validateInput: (value) => value.trim() ? null : 'Hub name is required'
            });
            if (!hubName) { return; }

            const hubDescription = await vscode.window.showInputBox({
                prompt: 'Enter hub description',
                placeHolder: 'A curated collection of prompts for...'
            });

            const maintainer = await vscode.window.showInputBox({
                prompt: 'Enter maintainer name/email',
                placeHolder: 'Your Name <email@example.com>'
            });

            // Build hub config
            const hubConfig: any = {
                version: '1.0.0',
                metadata: {
                    name: hubName,
                    description: hubDescription || 'Exported hub configuration',
                    maintainer: maintainer || 'Unknown',
                    updatedAt: new Date().toISOString()
                },
                sources: sources.map(s => ({
                    id: s.id,
                    name: s.name,
                    type: this.mapSourceTypeForHub(s.type),
                    url: s.url,
                    enabled: s.enabled,
                    priority: s.priority,
                    ...(s.metadata && { metadata: s.metadata })
                })),
                profiles: profiles.map(p => ({
                    id: p.id,
                    name: p.name,
                    description: p.description || '',
                    bundles: (Array.isArray(p.bundles) ? p.bundles : Object.values(p.bundles || {}) as any[]).map((bundle: any) => ({
                        id: bundle.id,
                        version: bundle.version,
                        source: sources[0]?.id || 'unknown',
                        required: bundle.required
                    }))
                }))
            };

            // Convert to YAML using js-yaml library
            const yamlStr = yaml.dump(hubConfig, {
                indent: 2,
                lineWidth: -1,
                noRefs: true,
                sortKeys: false
            });

            // Show in new editor
            const doc = await vscode.workspace.openTextDocument({
                content: yamlStr,
                language: 'yaml'
            });
            await vscode.window.showTextDocument(doc);

            vscode.window.showInformationMessage(
                `✅ Hub config exported! Save as 'hub-config.yml' for local testing.`,
                'Save As...'
            ).then(action => {
                if (action === 'Save As...') {
                    vscode.commands.executeCommand('workbench.action.files.saveAs');
                }
            });

        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to export hub config: ${message}`);
        }
    }

    /**
     * Convert object to YAML format (simple implementation)
     */
    private objectToYaml(obj: any, indent: number = 0): string {
        const spaces = ' '.repeat(indent);
        let yaml = '';

        for (const [key, value] of Object.entries(obj)) {
            if (value === null || value === undefined) {
                continue;
            }

            if (Array.isArray(value)) {
                if (value.length === 0) {
                    yaml += `${spaces}${key}: []\n`;
                } else {
                    yaml += `${spaces}${key}:\n`;
                    for (const item of value) {
                        if (typeof item === 'object' && item !== null) {
                            yaml += `${spaces}- `;
                            // Get object keys and format inline for first property
                            const entries = Object.entries(item);
                            if (entries.length > 0) {
                                const [firstKey, firstValue] = entries[0];
                                // Check if first value is an object - if so, use recursive formatting
                                if (typeof firstValue === 'object' && firstValue !== null) {
                                    yaml += `${firstKey}:\n`;
                                    yaml += this.objectToYaml(firstValue, indent + 4);
                                } else {
                                    yaml += `${firstKey}: ${this.formatYamlValue(firstValue)}\n`;
                                }
                                // Add remaining properties with proper indentation
                                for (let i = 1; i < entries.length; i++) {
                                    const [k, v] = entries[i];
                                    if (typeof v === 'object' && v !== null) {
                                        yaml += `${spaces}  ${k}:\n`;
                                        yaml += this.objectToYaml(v, indent + 4);
                                    } else {
                                        yaml += `${spaces}  ${k}: ${this.formatYamlValue(v)}\n`;
                                    }
                                }
                            }
                        } else {
                            yaml += `${spaces}- ${item}\n`;
                        }
                    }
                }
            } else if (typeof value === 'object') {
                yaml += `${spaces}${key}:\n`;
                yaml += this.objectToYaml(value, indent + 2);
            } else {
                yaml += `${spaces}${key}: ${this.formatYamlValue(value)}\n`;
            }
        }

        return yaml;
    }

    /**
     * Format a value for YAML output
     */
    private formatYamlValue(value: any): string {
        if (typeof value === 'string') {
            // Quote strings that contain special characters
            if (value.includes(':') || value.includes('#') || value.includes('\n') || 
                value.startsWith('*') || value.startsWith('&') || value.startsWith('!')) {
                return '"'  + value.replace(/"/g, '\\\\"') + '"';
            }
            return value;
        } else if (typeof value === 'boolean') {
            return value ? 'true' : 'false';
        } else if (typeof value === 'number') {
            return String(value);
        }
        return String(value);
    }

    /**



    /**
     * Select hub source type
     */
    private async selectSourceType(): Promise<'github' | 'url' | 'local' | undefined> {
        const options: HubSourceOption[] = [
            {
                label: '$(github) GitHub Repository',
                description: 'Import from a GitHub repository',
                value: 'github'
            },
            // {
            //     label: '$(link) HTTPS URL',
            //     description: 'Import from a direct URL',
            //     value: 'url'
            // },
            {
                label: '$(file) Local File',
                description: 'Import from a local hub-config.yml file',
                value: 'local'
            }
        ];

        const selected = await vscode.window.showQuickPick(options, {
            placeHolder: 'Select hub source type'
        });

        return selected?.value;
    }

    /**
     * Get hub reference based on source type
     */
    private async getHubReference(sourceType: 'github' | 'url' | 'local'): Promise<HubReference | undefined> {
        switch (sourceType) {
            case 'github': {
                const location = await vscode.window.showInputBox({
                    prompt: 'Enter GitHub repository (e.g., owner/repo)',
                    placeHolder: 'owner/repo',
                    validateInput: (value) => {
                        if (!value || !value.includes('/')) {
                            return 'Please enter a valid GitHub repository (owner/repo)';
                        }
                        return null;
                    }
                });

                if (!location) {
                    return undefined;
                }

                const ref = await vscode.window.showInputBox({
                    prompt: 'Enter branch, tag, or commit (optional, default: main)',
                    placeHolder: 'main'
                });

                return {
                    type: 'github',
                    location,
                    ref: ref || undefined
                };
            }

            case 'url': {
                const location = await vscode.window.showInputBox({
                    prompt: 'Enter HTTPS URL to hub-config.yml',
                    placeHolder: 'https://example.com/hub-config.yml',
                    validateInput: (value) => {
                        if (!value || !value.startsWith('https://')) {
                            return 'Please enter a valid HTTPS URL';
                        }
                        return null;
                    }
                });

                return location ? { type: 'url', location } : undefined;
            }

            case 'local': {
                const uris = await vscode.window.showOpenDialog({
                    canSelectFiles: true,
                    canSelectFolders: false,
                    canSelectMany: false,
                    filters: {
                        'YAML Files': ['yml', 'yaml']
                    },
                    title: 'Select hub-config.yml file'
                });

                if (!uris || uris.length === 0) {
                    return undefined;
                }

                return {
                    type: 'local',
                    location: uris[0].fsPath
                };
            }
        }
    }

    /**
     * Get hub ID from user (optional)
     */
    private async getHubId(): Promise<string | null | undefined> {
        const hubId = await vscode.window.showInputBox({
            prompt: 'Enter hub ID (optional, will auto-generate if empty)',
            placeHolder: 'my-hub',
            validateInput: (value) => {
                if (value && !/^[a-z0-9-]+$/.test(value)) {
                    return 'Hub ID must contain only lowercase letters, numbers, and hyphens';
                }
                if (value && (value.startsWith('-') || value.endsWith('-'))) {
                    return 'Hub ID cannot start or end with a hyphen';
                }
                return null;
            }
        });

        return hubId === undefined ? null : (hubId || '');
    }

    /**
     * Show detailed information about a hub
     */
    private async showHubDetails(hubId: string): Promise<void> {
        try {
            const info = await this.hubManager.getHubInfo(hubId);

            const message = [
                `**${info.config.metadata.name}**`,
                '',
                `**Description:** ${info.config.metadata.description}`,
                `**Maintainer:** ${info.config.metadata.maintainer}`,
                `**Version:** ${info.config.version}`,
                `**Sources:** ${info.config.sources.length}`,
                `**Profiles:** ${info.config.profiles.length}`,
                '',
                `**Hub ID:** ${info.id}`,
                `**Source Type:** ${info.reference.type}`,
                `**Last Modified:** ${info.metadata.lastModified.toLocaleString()}`,
                `**Size:** ${(info.metadata.size / 1024).toFixed(2)} KB`
            ].join('\n');

            // Show in output channel or quick pick with actions
            const action = await vscode.window.showInformationMessage(
                `Hub: ${info.config.metadata.name}`,
                'Sync',
                'Delete',
                'Close'
            );

            if (action === 'Sync') {
                await this.syncHub(hubId);
            } else if (action === 'Delete') {
                await this.deleteHub(hubId);
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to get hub details: ${message}`);
        }
    }

    /**
     * Sync all imported hubs
     */
    private async syncAllHubs(): Promise<void> {
        const hubs = await this.hubManager.listHubs();

        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: 'Syncing all hubs',
                cancellable: false
            },
            async (progress) => {
                let completed = 0;
                for (const hub of hubs) {
                    progress.report({
                        message: `Syncing ${hub.name} (${completed + 1}/${hubs.length})`,
                        increment: (100 / hubs.length)
                    });

                    try {
                        await this.hubManager.syncHub(hub.id);
                    } catch (error) {
                        vscode.window.showWarningMessage(
                            `Failed to sync ${hub.name}: ${error instanceof Error ? error.message : String(error)}`
                        );
                    }

                    completed++;
                }

                vscode.window.showInformationMessage(
                    `Synced ${completed} of ${hubs.length} hubs successfully`
                );
            }
        );
    }
}

/**
 * Source Management Commands
 * Handles adding, editing, removing, and syncing registry sources
 */

import * as vscode from 'vscode';
import { RegistryManager } from '../services/RegistryManager';
import { RegistrySource, SourceType } from '../types/registry';
import { Logger } from '../utils/logger';

/**
 * Source Commands Handler
 */
export class SourceCommands {
    private logger: Logger;

    constructor(private registryManager: RegistryManager) {
        this.logger = Logger.getInstance();
    }

    /**
     * Add a new registry source
     */
    async addSource(): Promise<void> {
        try {
            // Step 1: Select source type
            const sourceType = await vscode.window.showQuickPick(
                [
                    {
                        label: '$(github) GitHub Releases',
                        description: 'Versioned releases with zip file in the assets for both public or private GitHub repository',
                        value: 'github' as SourceType
                    },
                    // {
                    //     label: '$(repo) GitLab Repository',
                    //     description: 'Public or private GitLab repository',
                    //     value: 'gitlab' as SourceType
                    // },
                    // {
                    //     label: '$(globe) HTTP Registry',
                    //     description: 'HTTP/HTTPS registry server',
                    //     value: 'http' as SourceType
                    // },
                    // {
                    //     label: '$(folder) Local Directory',
                    //     description: 'Local filesystem directory',
                    //     value: 'local' as SourceType
                    // },
                    {
                        label: '$(package) Collection from GitHub repository',
                        description: 'GitHub repository with .collection.yml files based on Awesome Copilot specification',
                        value: 'awesome-copilot' as SourceType
                    },
                    {
                        label: '$(folder-library) Local Collection',
                        description: 'Local filesystem directory with .collection.yml files  based on Awesome Copilot specification',
                        value: 'local-awesome-copilot' as SourceType
                    },
                    {
                        label: '$(package) APM Repository',
                        description: 'Remote APM repository (GitHub) containing apm.yml',
                        value: 'apm' as SourceType
                    },
                    {
                        label: '$(folder-library) Local APM Package',
                        description: 'Local filesystem directory containing apm.yml',
                        value: 'local-apm' as SourceType
                    },
                    {
                        label: '$(robot) OLAF Skills Repository',
                        description: 'GitHub repository with AI skills in .olaf/core/skills directory structure',
                        value: 'olaf' as SourceType
                    },
                ],
                {
                    placeHolder: 'Select source type',
                    title: 'Add Registry Source',
                    ignoreFocusOut: true
                }
            );

            if (!sourceType) {
                return;
            }

            // Step 2: Get source name
            const name = await vscode.window.showInputBox({
                prompt: 'Enter source name',
                placeHolder: 'e.g., Company Prompt Library',
                validateInput: (value) => {
                    if (!value || value.trim().length === 0) {
                        return 'Source name is required';
                    }
                    return undefined;
                },
                ignoreFocusOut: true
            });

            if (!name) {
                return;
            }

            // Step 3: Get source URL based on type
            const url = await this.getSourceUrl(sourceType.value);
            if (!url) {
                return;
            }

            // Step 3.5: Get additional config for awesome-copilot and local-awesome-copilot
            let config: any = undefined;
            if (sourceType.value === 'awesome-copilot') {
                const branch = await vscode.window.showInputBox({
                    prompt: 'Enter branch name (or press Enter for "main")',
                    placeHolder: 'main',
                    value: 'main',
                    ignoreFocusOut: true
                });

                const collectionsPath = await vscode.window.showInputBox({
                    prompt: 'Enter collections directory path (or press Enter for "collections")',
                    placeHolder: 'collections',
                    value: 'collections',
                    ignoreFocusOut: true
                });

                config = {
                    branch: branch || 'main',
                    collectionsPath: collectionsPath || 'collections'
                };
            } else if (sourceType.value === 'local-awesome-copilot') {
                const collectionsPath = await vscode.window.showInputBox({
                    prompt: 'Enter collections directory path (or press Enter for "collections")',
                    placeHolder: 'collections',
                    value: 'collections',
                    ignoreFocusOut: true
                });

                config = {
                    collectionsPath: collectionsPath || 'collections'
                };
            } else if (sourceType.value === 'apm') {
                const branch = await vscode.window.showInputBox({
                    prompt: 'Enter branch name (or press Enter for "main")',
                    placeHolder: 'main',
                    value: 'main',
                    ignoreFocusOut: true
                });
                
                config = {
                    branch: branch || 'main'
                };
            }

            // Step 4: Check if private/authentication needed (skip for local sources)
            let token: string | undefined;
            let isPrivate: { label: string; description: string; value: boolean } | undefined;
            const isLocalSource = sourceType.value === 'local' || sourceType.value === 'local-awesome-copilot' || sourceType.value === 'local-apm';
            
            if (!isLocalSource) {
                isPrivate = await vscode.window.showQuickPick(
                    [
                        { label: 'Public', description: 'No authentication required', value: false },
                        { label: 'Private', description: 'Requires authentication', value: true }
                    ],
                    {
                        placeHolder: 'Is this source private?',
                        title: 'Source Access',
                        ignoreFocusOut: true
                    }
                );

                if (isPrivate?.value) {
                    token = await vscode.window.showInputBox({
                        prompt: 'Enter access token (optional - can be configured later)',
                        password: true,
                        placeHolder: 'Leave empty to configure later',
                        ignoreFocusOut: true
                    });
                }
            }

            // Step 5: Get priority
            const priority = await vscode.window.showInputBox({
                prompt: 'Enter priority (1 = highest)',
                value: '10',
                validateInput: (value) => {
                    const num = parseInt(value, 10);
                    if (isNaN(num) || num < 1) {
                        return 'Priority must be a positive number';
                    }
                    return undefined;
                },
                ignoreFocusOut: true
            });

            if (!priority) {
                return;
            }

            // Create source
            const source: RegistrySource = {
                id: this.generateSourceId(name),
                name: name.trim(),
                type: sourceType.value,
                url: url.trim(),
                enabled: true,
                priority: parseInt(priority, 10),
                private: isPrivate?.value || false,
                token: token && token.trim() ? token.trim() : undefined,
                metadata: {}
            };

            // Add config if present (for awesome-copilot and other types)
            if (config) {
                (source as any).config = config;
            }

            // Validate source before adding
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: `Validating source "${name}"...`,
                    cancellable: false
                },
                async () => {
                    const validation = await this.registryManager.validateSource(source);
                    
                    if (!validation.valid) {
                        throw new Error(`Source validation failed: ${validation.errors.join(', ')}`);
                    }

                    if (validation.warnings.length > 0) {
                        const proceed = await vscode.window.showWarningMessage(
                            `Source has warnings: ${validation.warnings.join(', ')}. Add anyway?`,
                            'Yes', 'No'
                        );
                        
                        if (proceed !== 'Yes') {
                            return;
                        }
                    }

                    await this.registryManager.addSource(source);
                }
            );

            vscode.window.showInformationMessage(
                `Source "${name}" added successfully!`,
                'Sync Now', 'View Sources'
            ).then(action => {
                if (action === 'Sync Now') {
                    this.syncSource(source.id);
                } else if (action === 'View Sources') {
                    this.listSources();
                }
            });

        } catch (error) {
            this.logger.error('Failed to add source', error as Error);
            vscode.window.showErrorMessage(`Failed to add source: ${(error as Error).message}`);
        }
    }

    /**
     * Edit an existing source
     */
    async editSource(sourceId?: string | any): Promise<void> {
        try {
            // Extract source ID from tree item or string parameter
            const extractedId = this.extractSourceId(sourceId);
            
            let finalId: string;
            // If no sourceId, let user select
            if (!extractedId) {
                const sources = await this.registryManager.listSources();
                
                if (sources.length === 0) {
                    vscode.window.showInformationMessage('No sources found. Add one first.');
                    return;
                }

                const selected = await vscode.window.showQuickPick(
                    sources.map(s => ({
                        label: s.enabled ? `✓ ${s.name}` : `○ ${s.name}`,
                        description: s.url,
                        detail: `${s.type} • Priority: ${s.priority}${s.private ? ' • Private' : ''}`,
                        source: s
                    })),
                    {
                        placeHolder: 'Select source to edit',
                        title: 'Edit Source',
                        ignoreFocusOut: true
                    }
                );

                if (!selected) {
                    return;
                }

                finalId = selected.source.id;
            } else {
                finalId = extractedId!;
            }

            const sources = await this.registryManager.listSources();
            const source = sources.find(s => s.id === finalId);

            if (!source) {
                vscode.window.showErrorMessage('Source not found');
                return;
            }

            // Show edit options
            const action = await vscode.window.showQuickPick(
                [
                    { label: '$(edit) Rename', value: 'rename' },
                    { label: '$(link) Change URL', value: 'url' },
                    { label: '$(key) Configure Token', value: 'token' },
                    { label: '$(sort-precedence) Change Priority', value: 'priority' },
                    { label: source.enabled ? '$(circle-slash) Disable' : '$(check) Enable', value: 'toggle' },
                ],
                {
                    placeHolder: `Edit "${source.name}"`,
                    title: 'Source Edit Options',
                    ignoreFocusOut: true
                }
            );

            if (!action) {
                return;
            }

            switch (action.value) {
                case 'rename':
                    await this.renameSource(finalId);
                    break;
                case 'url':
                    await this.changeSourceUrl(finalId);
                    break;
                case 'token':
                    await this.configureToken(finalId);
                    break;
                case 'priority':
                    await this.changePriority(finalId);
                    break;
                case 'toggle':
                    await this.toggleSource(finalId);
                    break;
            }

        } catch (error) {
            this.logger.error('Failed to edit source', error as Error);
            vscode.window.showErrorMessage(`Failed to edit source: ${(error as Error).message}`);
        }
    }

    /**
     * Remove a source
     */
    async removeSource(sourceId?: string | any): Promise<void> {
        try {
            // Extract source ID from tree item or string parameter
            const extractedId = this.extractSourceId(sourceId);
            
            let finalId: string;
            // If no sourceId, let user select
            if (!extractedId) {
                const sources = await this.registryManager.listSources();
                
                if (sources.length === 0) {
                    vscode.window.showInformationMessage('No sources found.');
                    return;
                }

                const selected = await vscode.window.showQuickPick(
                    sources.map(s => ({
                        label: s.name,
                        description: s.url,
                        source: s
                    })),
                    {
                        placeHolder: 'Select source to remove',
                        title: 'Remove Source',
                        ignoreFocusOut: true
                    }
                );

                if (!selected) {
                    return;
                }

                finalId = selected.source.id;
            } else {
                finalId = extractedId!;
            }

            const sources = await this.registryManager.listSources();
            const source = sources.find(s => s.id === finalId);

            if (!source) {
                vscode.window.showErrorMessage('Source not found');
                return;
            }

            // Confirm removal
            const confirmation = await vscode.window.showWarningMessage(
                `Are you sure you want to remove source "${source.name}"?`,
                { modal: true },
                'Remove', 'Cancel'
            );

            if (confirmation !== 'Remove') {
                return;
            }

            await this.registryManager.removeSource(finalId);

            vscode.window.showInformationMessage(
                `Source "${source.name}" removed successfully`
            );

        } catch (error) {
            this.logger.error('Failed to remove source', error as Error);
            vscode.window.showErrorMessage(`Failed to remove source: ${(error as Error).message}`);
        }
    }

    /**
     * Sync a source (refresh bundle list)
     */
    async syncSource(sourceId?: string | any): Promise<void> {
        try {
            // Extract source ID from tree item or string parameter
            const extractedId = this.extractSourceId(sourceId);
            
            let finalId: string;
            // If no sourceId, let user select
            if (!extractedId) {
                const sources = await this.registryManager.listSources();
                
                if (sources.length === 0) {
                    vscode.window.showInformationMessage('No sources found.');
                    return;
                }

                const selected = await vscode.window.showQuickPick(
                    sources.filter(s => s.enabled).map(s => ({
                        label: s.name,
                        description: s.url,
                        source: s
                    })),
                    {
                        placeHolder: 'Select source to sync',
                        title: 'Sync Source',
                        ignoreFocusOut: true
                    }
                );

                if (!selected) {
                    return;
                }

                finalId = selected.source.id;
            } else {
                finalId = extractedId!;
            }

            const sources = await this.registryManager.listSources();
            const source = sources.find(s => s.id === finalId);

            if (!source) {
                vscode.window.showErrorMessage('Source not found');
                return;
            }

            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: `Syncing "${source.name}"...`,
                    cancellable: false
                },
                async () => {
                    await this.registryManager.syncSource(finalId!);
                }
            );

            vscode.window.showInformationMessage(
                `Source "${source.name}" synced successfully`
            );

        } catch (error) {
            this.logger.error('Failed to sync source', error as Error);
            vscode.window.showErrorMessage(`Failed to sync source: ${(error as Error).message}`);
        }
    }

    /**
     * Sync all sources
     */
    async syncAllSources(): Promise<void> {
        try {
            const sources = await this.registryManager.listSources();
            const enabledSources = sources.filter(s => s.enabled);

            if (enabledSources.length === 0) {
                vscode.window.showInformationMessage('No enabled sources to sync.');
                return;
            }

            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: `Syncing ${enabledSources.length} source(s)...`,
                    cancellable: false
                },
                async (progress) => {
                    for (let i = 0; i < enabledSources.length; i++) {
                        const source = enabledSources[i];
                        progress.report({
                            message: `Syncing "${source.name}" (${i + 1}/${enabledSources.length})`,
                            increment: (100 / enabledSources.length)
                        });
                        
                        try {
                            await this.registryManager.syncSource(source.id);
                        } catch (error) {
                            this.logger.warn(`Failed to sync source "${source.name}"`, error as Error);
                        }
                    }
                }
            );

            vscode.window.showInformationMessage(
                `Synced ${enabledSources.length} source(s) successfully`
            );

        } catch (error) {
            this.logger.error('Failed to sync all sources', error as Error);
            vscode.window.showErrorMessage(`Failed to sync sources: ${(error as Error).message}`);
        }
    }

    /**
     * List all sources
     */
    async listSources(): Promise<void> {
        try {
            const sources = await this.registryManager.listSources();

            if (sources.length === 0) {
                vscode.window.showInformationMessage(
                    'No sources found. Add one to get started!',
                    'Add Source'
                ).then(action => {
                    if (action === 'Add Source') {
                        this.addSource();
                    }
                });
                return;
            }

            const selected = await vscode.window.showQuickPick(
                sources.map(s => ({
                    label: s.enabled ? `✓ ${s.name}` : `○ ${s.name}`,
                    description: s.url,
                    detail: `${s.type} • Priority: ${s.priority}${s.private ? ' • Private' : ''}`,
                    source: s
                })),
                {
                    placeHolder: 'Select a source to view actions',
                    title: 'Registry Sources',
                    ignoreFocusOut: true
                }
            );

            if (selected) {
                // Show source actions
                const action = await vscode.window.showQuickPick([
                    { label: '$(sync) Sync', value: 'sync', enabled: selected.source.enabled },
                    { label: '$(edit) Edit', value: 'edit', enabled: true },
                    { label: selected.source.enabled ? '$(circle-slash) Disable' : '$(check) Enable', value: 'toggle', enabled: true },
                    { label: '$(trash) Remove', value: 'remove', enabled: true },
                ].filter(a => a.enabled), {
                    placeHolder: `Actions for "${selected.source.name}"`,
                    title: 'Source Actions',
                    ignoreFocusOut: true
                });

                if (action) {
                    switch (action.value) {
                        case 'sync':
                            await this.syncSource(selected.source.id);
                            break;
                        case 'edit':
                            await this.editSource(selected.source.id);
                            break;
                        case 'toggle':
                            await this.toggleSource(selected.source.id);
                            break;
                        case 'remove':
                            await this.removeSource(selected.source.id);
                            break;
                    }
                }
            }

        } catch (error) {
            this.logger.error('Failed to list sources', error as Error);
            vscode.window.showErrorMessage(`Failed to list sources: ${(error as Error).message}`);
        }
    }

    // ===== Helper Methods =====

    /**
     * Get source URL based on type
     */
    private async getSourceUrl(type: SourceType): Promise<string | undefined> {
        switch (type) {
            case 'github':
                return await vscode.window.showInputBox({
                    prompt: 'Enter GitHub repository URL',
                    placeHolder: 'https://github.com/owner/repo',
                    validateInput: (value) => {
                        if (!value || !value.match(/github\.com/)) {
                            return 'Please enter a valid GitHub URL';
                        }
                        return undefined;
                    },
                    ignoreFocusOut: true
                });

            case 'gitlab':
                return await vscode.window.showInputBox({
                    prompt: 'Enter GitLab repository URL',
                    placeHolder: 'https://gitlab.com/owner/repo',
                    validateInput: (value) => {
                        if (!value || value.trim().length === 0) {
                            return 'URL is required';
                        }
                        return undefined;
                    },
                    ignoreFocusOut: true
                });

            case 'http':
                return await vscode.window.showInputBox({
                    prompt: 'Enter HTTP registry URL',
                    placeHolder: 'https://registry.example.com',
                    validateInput: (value) => {
                        if (!value || !value.match(/^https?:\/\//)) {
                            return 'Please enter a valid HTTP/HTTPS URL';
                        }
                        return undefined;
                    },
                    ignoreFocusOut: true
                });

            case 'local': {
                const uris = await vscode.window.showOpenDialog({
                    canSelectFolders: true,
                    canSelectFiles: false,
                    canSelectMany: false,
                    title: 'Select local registry directory'
                });
                
                return uris && uris.length > 0 ? uris[0].fsPath : undefined;
            }

            case 'awesome-copilot':
                return await vscode.window.showInputBox({
                    prompt: 'Enter GitHub repository URL (or press Enter for official awesome-copilot)',
                    placeHolder: 'https://github.com/github/awesome-copilot',
                    value: 'https://github.com/github/awesome-copilot',
                    validateInput: (value) => {
                        if (!value || !value.match(/github\.com/)) {
                            return 'Please enter a valid GitHub URL';
                        }
                        return undefined;
                    },
                    ignoreFocusOut: true
                });

            case 'local-awesome-copilot': {
                const uris = await vscode.window.showOpenDialog({
                    canSelectFolders: true,
                    canSelectFiles: false,
                    canSelectMany: false,
                    title: 'Select local awesome-copilot collections directory'
                });
                
                return uris && uris.length > 0 ? uris[0].fsPath : undefined;
            }

            case 'apm':
                return await vscode.window.showInputBox({
                    prompt: 'Enter GitHub repository URL',
                    placeHolder: 'https://github.com/owner/repo',
                    validateInput: (value) => {
                        if (!value || !value.match(/github\.com/)) {
                            return 'Please enter a valid GitHub URL';
                        }
                        return undefined;
                    },
                    ignoreFocusOut: true
                });

            case 'local-apm': {
                const uris = await vscode.window.showOpenDialog({
                    canSelectFolders: true,
                    canSelectFiles: false,
                    canSelectMany: false,
                    title: 'Select local APM package directory'
                });
                
                return uris && uris.length > 0 ? uris[0].fsPath : undefined;
            }

            case 'olaf':
                return await vscode.window.showInputBox({
                    prompt: 'Enter GitHub repository URL containing OLAF skills',
                    placeHolder: 'https://github.com/owner/repo',
                    validateInput: (value) => {
                        if (!value || !value.match(/github\.com/)) {
                            return 'Please enter a valid GitHub URL';
                        }
                        return undefined;
                    },
                    ignoreFocusOut: true
                });

            default:
                return undefined;
        }
    }

    /**
     * Generate source ID from name
     */
    private generateSourceId(name: string): string {
        return name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    }

    /**
     * Rename source
     */
    private async renameSource(sourceId: string): Promise<void> {
        const sources = await this.registryManager.listSources();
        const source = sources.find(s => s.id === sourceId);

        if (!source) {
            return;
        }

        const newName = await vscode.window.showInputBox({
            prompt: 'Enter new source name',
            value: source.name,
            validateInput: (value) => {
                if (!value || value.trim().length === 0) {
                    return 'Source name is required';
                }
                return undefined;
            },
            ignoreFocusOut: true
        });

        if (newName && newName !== source.name) {
            await this.registryManager.updateSource(sourceId, { name: newName });
            vscode.window.showInformationMessage(`Source renamed to "${newName}"`);
        }
    }

    /**
     * Change source URL
     */
    private async changeSourceUrl(sourceId: string): Promise<void> {
        const sources = await this.registryManager.listSources();
        const source = sources.find(s => s.id === sourceId);

        if (!source) {
            return;
        }

        const newUrl = await this.getSourceUrl(source.type);

        if (newUrl && newUrl !== source.url) {
            await this.registryManager.updateSource(sourceId, { url: newUrl });
            vscode.window.showInformationMessage('Source URL updated');
        }
    }

    /**
     * Configure access token
     */
    private async configureToken(sourceId: string): Promise<void> {
        const token = await vscode.window.showInputBox({
            prompt: 'Enter access token (leave empty to remove)',
            password: true,
            placeHolder: 'Access token',
            ignoreFocusOut: true
        });

        if (token !== undefined) {
            await this.registryManager.updateSource(sourceId, {
                token: token.trim() || undefined,
                private: !!token.trim()
            });
            vscode.window.showInformationMessage('Token configuration updated');
        }
    }

    /**
     * Change source priority
     */
    private async changePriority(sourceId: string): Promise<void> {
        const sources = await this.registryManager.listSources();
        const source = sources.find(s => s.id === sourceId);

        if (!source) {
            return;
        }

        const newPriority = await vscode.window.showInputBox({
            prompt: 'Enter new priority (1 = highest)',
            value: source.priority.toString(),
            validateInput: (value) => {
                const num = parseInt(value, 10);
                if (isNaN(num) || num < 1) {
                    return 'Priority must be a positive number';
                }
                return undefined;
            },
            ignoreFocusOut: true
        });

        if (newPriority) {
            await this.registryManager.updateSource(sourceId, { priority: parseInt(newPriority, 10) });
            vscode.window.showInformationMessage('Source priority updated');
        }
    }

    /**
     * Toggle source enabled/disabled
     */
    async toggleSource(sourceId?: string | any): Promise<void> {
        try {
            // Extract source ID from tree item or string parameter
            const extractedId = this.extractSourceId(sourceId);
            
            let finalId: string;
            // If no sourceId, let user select
            if (!extractedId) {
                const sources = await this.registryManager.listSources();
                
                if (sources.length === 0) {
                    vscode.window.showInformationMessage('No sources found.');
                    return;
                }

                const selected = await vscode.window.showQuickPick(
                    sources.map(s => ({
                        label: s.enabled ? `✓ ${s.name}` : `○ ${s.name}`,
                        description: s.url,
                        detail: `${s.type} • Priority: ${s.priority}`,
                        source: s
                    })),
                    {
                        placeHolder: 'Select source to toggle',
                        title: 'Toggle Source',
                        ignoreFocusOut: true
                    }
                );

                if (!selected) {
                    return;
                }

                finalId = selected.source.id;
            } else {
                finalId = extractedId!;
            }

            const sources = await this.registryManager.listSources();
            const source = sources.find(s => s.id === finalId);

            if (!source) {
                vscode.window.showErrorMessage('Source not found');
                return;
            }

            await this.registryManager.updateSource(finalId, { enabled: !source.enabled });
            vscode.window.showInformationMessage(
                `Source "${source.name}" ${source.enabled ? 'disabled' : 'enabled'}`
            );
        } catch (error) {
            this.logger.error('Failed to toggle source', error as Error);
            vscode.window.showErrorMessage(`Failed to toggle source: ${(error as Error).message}`);
        }
    }

    /**
     * Extract source ID from tree item or string parameter
     * Context menu passes tree item object, command palette passes string
     */
    private extractSourceId(sourceIdOrItem?: string | any): string | undefined {
        if (!sourceIdOrItem) {
            return undefined;
        }
        
        // Handle tree item object from context menu
        if (typeof sourceIdOrItem === 'object' && 'data' in sourceIdOrItem) {
            return sourceIdOrItem.data?.id;
        }
        
        // Handle direct string ID
        if (typeof sourceIdOrItem === 'string') {
            return sourceIdOrItem;
        }
        
        return undefined;
    }
}

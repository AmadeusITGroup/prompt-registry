/**
 * Marketplace View Provider
 * Displays a visual marketplace for browsing and installing prompt bundles
 * Similar to open-vsx.org marketplace experience
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { Logger } from '../utils/logger';
import { RegistryManager } from '../services/RegistryManager';
import { Bundle, InstalledBundle } from '../types/registry';
import { extractAllTags, extractBundleSources } from '../utils/filterUtils';

export class MarketplaceViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'promptregistry.marketplace';

    private _view?: vscode.WebviewView;
    private logger: Logger;

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly registryManager: RegistryManager
    ) {
        this.logger = Logger.getInstance();
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.context.extensionUri]
        };

        webviewView.webview.html = this.getHtmlContent(webviewView.webview);

        // Handle messages from webview
        webviewView.webview.onDidReceiveMessage(async (message) => {
            await this.handleMessage(message);
        });

        // Load and send bundles data
        this.loadBundles();
    }

    /**
     * Load bundles from registries and send to webview
     */
    private async loadBundles(): Promise<void> {
        try {
            this.logger.debug('Loading bundles for marketplace');

            // Search for all bundles (empty query)
            const bundles = await this.registryManager.searchBundles({});
            const installedBundles = await this.registryManager.listInstalledBundles();
            const sources = await this.registryManager.listSources();
            
            const enhancedBundles = bundles.map(bundle => {
                const installed = installedBundles.find(ib => ib.bundleId === bundle.id);
                // Use manifest from installed bundle if available
                const contentBreakdown = this.getContentBreakdown(bundle, installed?.manifest);

                return {
                    ...bundle,
                    installed: !!installed,
                    installedVersion: installed?.version,
                    contentBreakdown
                };
            });

            // Extract dynamic filter options
            const availableTags = extractAllTags(bundles);
            const availableSources = extractBundleSources(bundles, sources);

            // Send to webview
            this._view?.webview.postMessage({
                type: 'bundlesLoaded',
                bundles: enhancedBundles,
                filterOptions: {
                    tags: availableTags,
                    sources: availableSources
                }
            });

            this.logger.debug(`Loaded ${enhancedBundles.length} bundles for marketplace`);
            this.logger.debug(`Available tags: ${availableTags.length}, sources: ${availableSources.length}`);

        } catch (error) {
            this.logger.error('Failed to load marketplace bundles', error as Error);
        }
    }

    /**
     * Calculate content breakdown from bundle metadata
     */
    private getContentBreakdown(bundle: Bundle, manifest?: any): {
        prompts: number;
        instructions: number;
        chatmodes: number;
        agents: number;
    } {
        const breakdown = {
            prompts: 0,
            instructions: 0,
            chatmodes: 0,
            agents: 0
        };

        // First: Use manifest if provided (from installed bundle)
        if (manifest?.prompts && Array.isArray(manifest.prompts)) {
            for (const prompt of manifest.prompts) {
                const type = prompt.type || 'prompt';
                if (type === 'prompt') {breakdown.prompts++;}
                else if (type === 'instructions') {breakdown.instructions++;}
                else if (type === 'chatmode') {breakdown.chatmodes++;}
                else if (type === 'agent') {breakdown.agents++;}
            }
            return breakdown;
        }

        // Second: Try to parse from bundle data (some sources embed this)
        const bundleData = bundle as any;
        if (bundleData.prompts && Array.isArray(bundleData.prompts)) {
            for (const prompt of bundleData.prompts) {
                const type = prompt.type || 'prompt';
                if (type === 'prompt') {breakdown.prompts++;}
                else if (type === 'instructions') {breakdown.instructions++;}
                else if (type === 'chatmode') {breakdown.chatmodes++;}
                else if (type === 'agent') {breakdown.agents++;}
            }
            return breakdown;
        }

        // Fallback: estimate from tags (better than nothing)
        // Fallback: Don't show estimates for uninstalled bundles
        // If we don't have manifest data, return zeros instead of misleading estimates
        // Users can install the bundle to see accurate counts
        
        return breakdown;
    }

    /**
     * Handle messages from webview
     */
    private async handleMessage(message: any): Promise<void> {
        switch (message.type) {
            case 'refresh':
                await this.loadBundles();
                break;
            case 'install':
                await this.handleInstall(message.bundleId);
                break;
            case 'uninstall':
                await this.handleUninstall(message.bundleId);
                break;
            case 'openDetails':
                await this.openBundleDetails(message.bundleId);
                break;
            case 'openPromptFile':
                await this.openPromptFileInEditor(message.installPath, message.filePath);
                break;
            default:
                this.logger.warn(`Unknown message type: ${message.type}`);
        }
    }

    /**
     * Open a prompt file in the editor
     */
    private async openPromptFileInEditor(installPath: string, filePath: string): Promise<void> {
        try {
            const path = require('path');
            const fullPath = path.join(installPath, filePath);
            
            this.logger.debug(`Opening prompt file: ${fullPath}`);
            
            // Open the file in the editor using Uri for cross-platform compatibility
            const fileUri = vscode.Uri.file(fullPath);
            const document = await vscode.workspace.openTextDocument(fileUri);
            await vscode.window.showTextDocument(document, {
                preview: false,
                viewColumn: vscode.ViewColumn.One
            });
            
        } catch (error) {
            this.logger.error('Failed to open prompt file', error as Error);
            vscode.window.showErrorMessage(`Failed to open file: ${(error as Error).message}`);
        }
    }

    /**
     * Install a bundle
     */
    private async handleInstall(bundleId: string): Promise<void> {
        try {
            this.logger.info(`Installing bundle from marketplace: ${bundleId}`);

            // Use RegistryManager to install
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `Installing bundle...`,
                cancellable: false
            }, async () => {
                await this.registryManager.installBundle(bundleId, {
                    scope: 'user',
                    version: 'latest'
                });
            });

            vscode.window.showInformationMessage(`✅ Bundle installed successfully!`);

            // Refresh marketplace
            await this.loadBundles();

        } catch (error) {
            this.logger.error('Failed to install bundle from marketplace', error as Error);
            vscode.window.showErrorMessage(`Failed to install bundle: ${(error as Error).message}`);
        }
    }

    /**
     * Uninstall a bundle
     */
    private async handleUninstall(bundleId: string): Promise<void> {
        try {
            this.logger.info(`Uninstalling bundle from marketplace: ${bundleId}`);

            await this.registryManager.uninstallBundle(bundleId, 'user');

            vscode.window.showInformationMessage(`✅ Bundle uninstalled successfully!`);

            // Refresh marketplace
            await this.loadBundles();

        } catch (error) {
            this.logger.error('Failed to uninstall bundle from marketplace', error as Error);
            vscode.window.showErrorMessage(`Failed to uninstall bundle: ${(error as Error).message}`);
        }
    }

    /**
     * Open bundle details in a new webview panel
     */
    async openBundleDetails(bundleId: string): Promise<void> {
        try {
            this.logger.debug(`Opening details for bundle: ${bundleId}`);

            // Get bundle info
            const bundles = await this.registryManager.searchBundles({});
            const bundle = bundles.find(b => b.id === bundleId);
            
            if (!bundle) {
                vscode.window.showErrorMessage('Bundle not found');
                return;
            }

            // Check if installed to get manifest
            const installedBundles = await this.registryManager.listInstalledBundles();
            const installed = installedBundles.find(ib => ib.bundleId === bundleId);
            const breakdown = this.getContentBreakdown(bundle, installed?.manifest);

            // Create webview panel
            const panel = vscode.window.createWebviewPanel(
                'bundleDetails',
                `📦 ${bundle.name}`,
                vscode.ViewColumn.One,
                {
                    enableScripts: true
                }
            );

            // Set HTML content
            panel.webview.html = this.getBundleDetailsHtml(bundle, installed, breakdown);

            // Handle messages from the details panel
            panel.webview.onDidReceiveMessage(
                async (message) => {
                    if (message.type === 'openPromptFile') {
                        await this.openPromptFileInEditor(message.installPath, message.filePath);
                    }
                },
                undefined,
                this.context.subscriptions
            );

        } catch (error) {
            this.logger.error('Failed to open bundle details', error as Error);
            vscode.window.showErrorMessage('Failed to open bundle details');
        }
    }

    /**
     * Get HTML for bundle details panel
     */
    private getBundleDetailsHtml(bundle: Bundle, installed: InstalledBundle | undefined, breakdown: any): string {
        const isInstalled = !!installed;
        const installPath = installed?.installPath || 'Not installed';
        // Escape backslashes and quotes for safe embedding in HTML onclick attributes
        const escapedInstallPath = installPath.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${bundle.name}</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            padding: 20px;
            line-height: 1.6;
        }
        .header {
            border-bottom: 1px solid var(--vscode-panel-border);
            padding-bottom: 20px;
            margin-bottom: 24px;
        }
        h1 {
            font-size: 28px;
            margin: 0 0 8px 0;
        }
        .meta {
            color: var(--vscode-descriptionForeground);
            font-size: 14px;
        }
        .badge {
            display: inline-block;
            background: var(--vscode-gitDecoration-addedResourceForeground);
            color: white;
            padding: 4px 12px;
            border-radius: 12px;
            font-size: 12px;
            font-weight: 600;
            margin-left: 12px;
        }
        .section {
            margin-bottom: 32px;
        }
        .section h2 {
            font-size: 20px;
            margin-bottom: 12px;
            border-bottom: 1px solid var(--vscode-panel-border);
            padding-bottom: 8px;
        }
        .breakdown {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 16px;
            margin-top: 16px;
        }
        .breakdown-item {
            background: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
            border-radius: 8px;
            padding: 16px;
            text-align: center;
        }
        .breakdown-icon {
            font-size: 32px;
            margin-bottom: 8px;
        }
        .breakdown-count {
            font-size: 24px;
            font-weight: 600;
            margin-bottom: 4px;
        }
        .breakdown-label {
            font-size: 13px;
            color: var(--vscode-descriptionForeground);
        }
        .tags {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            margin-top: 12px;
        }
        .tag {
            background: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            padding: 4px 12px;
            border-radius: 12px;
            font-size: 12px;
        }
        .info-grid {
            display: grid;
            gap: 12px;
            margin-top: 12px;
        }
        .info-row {
            display: grid;
            grid-template-columns: 140px 1fr;
            gap: 16px;
        }
        .info-label {
            font-weight: 600;
            color: var(--vscode-descriptionForeground);
        }
        .info-value {
            color: var(--vscode-foreground);
        }
        code {
            background: var(--vscode-textCodeBlock-background);
            padding: 2px 6px;
            border-radius: 3px;
            font-family: var(--vscode-editor-font-family);
            font-size: 13px;
        }
        .prompt-item:hover {
            background: var(--vscode-list-hoverBackground);
            border-radius: 4px;
        }
        .mcp-server-card {
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 6px;
            padding: 12px;
            margin-bottom: 12px;
        }
        .mcp-server-header {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 8px;
            font-weight: 600;
            font-size: 14px;
        }
        .mcp-server-command {
            background: var(--vscode-textCodeBlock-background);
            padding: 8px 12px;
            border-radius: 4px;
            font-family: var(--vscode-editor-font-family);
            font-size: 12px;
            margin-bottom: 8px;
            word-break: break-all;
        }
        .mcp-env-vars {
            margin-top: 8px;
            padding-left: 12px;
        }
        .mcp-env-var {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
            margin: 4px 0;
        }
        .mcp-status-badge {
            display: inline-block;
            padding: 2px 8px;
            border-radius: 12px;
            font-size: 11px;
            font-weight: 500;
        }
        .mcp-status-enabled {
            background: var(--vscode-testing-iconPassed);
            color: var(--vscode-editor-background);
        }
        .mcp-status-disabled {
            background: var(--vscode-descriptionForeground);
            color: var(--vscode-editor-background);
        }
    </style>
    <script>
        const vscode = acquireVsCodeApi();
        
        function openPromptFile(installPath, filePath) {
            vscode.postMessage({
                type: 'openPromptFile',
                installPath: installPath,
                filePath: filePath
            });
        }
    </script>
</head>
<body>
    <div class="header">
        <h1>
            📦 ${bundle.name}
            ${isInstalled ? '<span class="badge">✓ Installed</span>' : ''}
        </h1>
        <div class="meta">
            by ${bundle.author || 'Unknown'} • Version ${bundle.version}
        </div>
    </div>

    <div class="section">
        <h2>Description</h2>
        <p>${bundle.description || 'No description available'}</p>
    </div>

    <div class="section">
        <h2>📊 Content Breakdown</h2>
        ${isInstalled ? `
        <div class="breakdown">
            <div class="breakdown-item">
                <div class="breakdown-icon">💬</div>
                <div class="breakdown-count">${breakdown.prompts}</div>
                <div class="breakdown-label">Prompts</div>
            </div>
            <div class="breakdown-item">
                <div class="breakdown-icon">📋</div>
                <div class="breakdown-count">${breakdown.instructions}</div>
                <div class="breakdown-label">Instructions</div>
            </div>
            <div class="breakdown-item">
                <div class="breakdown-icon">🎭</div>
                <div class="breakdown-count">${breakdown.chatmodes}</div>
                <div class="breakdown-label">Chat Modes</div>
            </div>
            <div class="breakdown-item">
                <div class="breakdown-icon">🤖</div>
                <div class="breakdown-count">${breakdown.agents}</div>
                <div class="breakdown-label">Agents</div>
            </div>
        </div>
        ` : `
        <div class="info-message">
            <p style="text-align: center; padding: 20px; color: var(--vscode-descriptionForeground);">
                📦 Install this bundle to see the detailed content breakdown.
            </p>
        </div>
        `}
    </div>
    <div class="section">
        <h2>ℹ️ Information</h2>
        <div class="info-grid">
            <div class="info-row">
                <div class="info-label">Bundle ID:</div>
                <div class="info-value"><code>${bundle.id}</code></div>
            </div>
            <div class="info-row">
                <div class="info-label">Version:</div>
                <div class="info-value">${bundle.version}</div>
            </div>
            <div class="info-row">
                <div class="info-label">Author:</div>
                <div class="info-value">${bundle.author || 'Unknown'}</div>
            </div>
            ${isInstalled ? `
            <div class="info-row">
                <div class="info-label">Installed At:</div>
                <div class="info-value">${new Date(installed!.installedAt).toLocaleString()}</div>
            </div>
            <div class="info-row">
                <div class="info-label">Install Path:</div>
                <div class="info-value"><code>${installPath}</code></div>
            </div>
            ` : ''}
            <div class="info-row">
                <div class="info-label">Environments:</div>
                <div class="info-value">${(bundle.environments || ['any']).join(', ')}</div>
            </div>
        </div>
    </div>

    ${bundle.tags && bundle.tags.length > 0 ? `
    <div class="section">
        <h2>🏷️ Tags</h2>
        <div class="tags">
            ${bundle.tags.map(tag => `<span class="tag">${tag}</span>`).join('')}
        </div>
    </div>
    ` : ''}

    ${installed?.manifest?.mcpServers && Object.keys(installed.manifest.mcpServers).length > 0 ? `
    <div class="section">
        <h2>🔌 MCP Servers</h2>
        <p style="color: var(--vscode-descriptionForeground); margin-bottom: 16px; font-size: 13px;">
            This bundle includes ${Object.keys(installed.manifest.mcpServers).length} Model Context Protocol server${Object.keys(installed.manifest.mcpServers).length > 1 ? 's' : ''} that will be automatically integrated with VS Code.
        </p>
        ${Object.entries(installed.manifest.mcpServers).map(([serverName, config]) => `
            <div class="mcp-server-card">
                <div class="mcp-server-header">
                    <span>⚡ ${serverName}</span>
                    ${config.disabled ? '<span class="mcp-status-badge mcp-status-disabled">Disabled</span>' : '<span class="mcp-status-badge mcp-status-enabled">Enabled</span>'}
                </div>
                ${config.description ? `<div style="color: var(--vscode-descriptionForeground); font-size: 12px; margin-bottom: 8px;">${config.description}</div>` : ''}
                <div class="mcp-server-command">
                    <strong>Command:</strong> ${config.command}
                    ${config.args && config.args.length > 0 ? ` ${config.args.join(' ')}` : ''}
                </div>
                ${config.env && Object.keys(config.env).length > 0 ? `
                <div class="mcp-env-vars">
                    <strong style="font-size: 12px;">Environment Variables:</strong>
                    ${Object.entries(config.env).map(([key, value]) => `
                        <div class="mcp-env-var">• <code>${key}</code> = <code>${value}</code></div>
                    `).join('')}
                </div>
                ` : ''}
            </div>
        `).join('')}
    </div>
    ` : ''}

    ${installed?.manifest?.prompts ? `
    <div class="section">
        <h2>📝 Included Prompts</h2>
        <div class="info-grid">
            ${installed.manifest.prompts.map(p => `
                <div class="info-row prompt-item" onclick="openPromptFile('${escapedInstallPath}', '${p.file}')" style="cursor: pointer;">
                    <div class="info-label">${p.id}:</div>
                    <div class="info-value">
                        ${p.name} 
                        <em style="color: var(--vscode-descriptionForeground);">(${p.type || 'prompt'})</em>
                        <span style="color: var(--vscode-textLink-foreground); margin-left: 8px;">📄 Open</span>
                    </div>
                </div>
            `).join('')}
        </div>
    </div>
    ` : ''}
</body>
</html>`;
    }

    /**
     * Get HTML content for marketplace webview
     */
    private getHtmlContent(webview: vscode.Webview): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Prompt Marketplace</title>
    <style>
        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }

        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            padding: 20px;
        }

        .header {
            margin-bottom: 24px;
        }

        .header h1 {
            font-size: 24px;
            font-weight: 600;
            margin-bottom: 8px;
        }

        .header p {
            color: var(--vscode-descriptionForeground);
            font-size: 14px;
        }

        .controls {
            display: flex;
            gap: 8px;
            margin-bottom: 20px;
            flex-wrap: wrap;
            align-items: center;
        }

        .search-box {
            flex: 1;
            min-width: 180px;
            max-width: 300px;
            padding: 6px 10px;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 3px;
            font-size: 13px;
            height: 28px;
        }

        .search-box:focus {
            outline: 1px solid var(--vscode-focusBorder);
            outline-offset: -1px;
        }

        .filter-group {
            display: flex;
            align-items: center;
            gap: 6px;
        }

        .filter-label {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
            white-space: nowrap;
            font-weight: 500;
        }

        .filter-select {
            padding: 4px 8px;
            background: var(--vscode-dropdown-background);
            color: var(--vscode-dropdown-foreground);
            border: 1px solid var(--vscode-dropdown-border);
            border-radius: 3px;
            font-size: 12px;
            cursor: pointer;
            min-width: 120px;
            max-width: 160px;
            height: 28px;
        }

        .filter-select:focus {
            outline: 1px solid var(--vscode-focusBorder);
            outline-offset: -1px;
        }

        /* Custom Tag Selector */
        .tag-selector {
            position: relative;
            display: inline-block;
        }

        .tag-selector-btn {
            padding: 4px 8px;
            background: var(--vscode-dropdown-background);
            color: var(--vscode-dropdown-foreground);
            border: 1px solid var(--vscode-dropdown-border);
            border-radius: 3px;
            font-size: 12px;
            cursor: pointer;
            min-width: 120px;
            max-width: 200px;
            height: 28px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .tag-selector-btn:hover {
            background: var(--vscode-dropdown-listBackground);
        }

        .tag-selector-btn:focus {
            outline: 1px solid var(--vscode-focusBorder);
            outline-offset: -1px;
        }

        .dropdown-arrow {
            margin-left: 8px;
            font-size: 10px;
            color: var(--vscode-descriptionForeground);
        }

        .tag-dropdown {
            position: absolute;
            top: 100%;
            left: 0;
            margin-top: 4px;
            background: var(--vscode-dropdown-background);
            border: 1px solid var(--vscode-dropdown-border);
            border-radius: 3px;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
            z-index: 1000;
            min-width: 220px;
            max-width: 300px;
        }

        .tag-search-container {
            padding: 8px;
            border-bottom: 1px solid var(--vscode-dropdown-border);
        }

        .tag-search {
            width: 100%;
            padding: 4px 8px;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 3px;
            font-size: 12px;
            box-sizing: border-box;
        }

        .tag-search:focus {
            outline: 1px solid var(--vscode-focusBorder);
            outline-offset: -1px;
        }

        .tag-list {
            max-height: 240px;
            overflow-y: auto;
            padding: 4px 0;
        }

        .tag-item {
            display: flex;
            align-items: center;
            padding: 6px 12px;
            cursor: pointer;
            font-size: 12px;
            user-select: none;
        }

        .tag-item:hover {
            background: var(--vscode-list-hoverBackground);
        }

        .tag-item input[type="checkbox"] {
            margin-right: 8px;
            cursor: pointer;
        }

        .tag-item.hidden {
            display: none;
        }

        /* Source selector styles (mirror of tag selector) */
        .source-selector {
            position: relative;
            display: inline-block;
        }

        .source-selector-btn {
            padding: 4px 8px;
            background: var(--vscode-dropdown-background);
            color: var(--vscode-dropdown-foreground);
            border: 1px solid var(--vscode-dropdown-border);
            border-radius: 3px;
            font-size: 12px;
            cursor: pointer;
            min-width: 140px;
            max-width: 240px;
            height: 28px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .source-selector-btn:hover {
            background: var(--vscode-dropdown-listBackground);
        }

        .source-selector-btn:focus {
            outline: 1px solid var(--vscode-focusBorder);
            outline-offset: -1px;
        }

        .source-dropdown {
            position: absolute;
            top: 100%;
            left: 0;
            margin-top: 4px;
            background: var(--vscode-dropdown-background);
            border: 1px solid var(--vscode-dropdown-border);
            border-radius: 3px;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
            z-index: 1000;
            min-width: 240px;
            max-width: 320px;
        }

        .source-search-container {
            padding: 8px;
            border-bottom: 1px solid var(--vscode-dropdown-border);
        }

        .source-search {
            width: 100%;
            padding: 4px 8px;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 3px;
            font-size: 12px;
            box-sizing: border-box;
        }

        .source-search:focus {
            outline: 1px solid var(--vscode-focusBorder);
            outline-offset: -1px;
        }

        .source-list {
            max-height: 240px;
            overflow-y: auto;
            padding: 4px 0;
        }

        .source-item {
            display: flex;
            align-items: center;
            padding: 6px 12px;
            cursor: pointer;
            font-size: 12px;
            user-select: none;
        }

        .source-item:hover {
            background: var(--vscode-list-hoverBackground);
        }

        .source-item input[type="radio"] {
            margin-right: 8px;
            cursor: pointer;
        }

        .source-item.hidden {
            display: none;
        }

        .source-item.active {
            background: var(--vscode-list-activeSelectionBackground);
            color: var(--vscode-list-activeSelectionForeground);
        }

        /* Installed checkbox filter */
        .installed-filter {
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 4px 8px;
            background: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
            border-radius: 3px;
            cursor: pointer;
            user-select: none;
            height: 28px;
            white-space: nowrap;
        }

        .installed-filter:hover {
            background: var(--vscode-list-hoverBackground);
        }

        .installed-filter input[type="checkbox"] {
            cursor: pointer;
            width: 14px;
            height: 14px;
        }

        .installed-filter label {
            cursor: pointer;
            font-size: 12px;
            color: var(--vscode-foreground);
            font-weight: 500;
        }

        .filter-btn {
            padding: 5px 12px;
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: none;
            border-radius: 3px;
            cursor: pointer;
            font-size: 12px;
            transition: background 0.15s;
            height: 28px;
            white-space: nowrap;
        }

        .filter-btn:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }

        .filter-btn:active {
            transform: translateY(1px);
        }

        .refresh-btn {
            padding: 5px 12px;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 3px;
            cursor: pointer;
            font-size: 12px;
            height: 28px;
            white-space: nowrap;
        }

        .refresh-btn:hover {
            background: var(--vscode-button-hoverBackground);
        }

        .marketplace-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
            gap: 20px;
            margin-bottom: 24px;
        }

        .bundle-card {
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 8px;
            padding: 20px;
            cursor: pointer;
            transition: all 0.2s;
            position: relative;
        }

        .bundle-card:hover {
            border-color: var(--vscode-focusBorder);
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
            transform: translateY(-2px);
        }

        .bundle-card.installed {
            border-color: var(--vscode-gitDecoration-addedResourceForeground);
        }

        .installed-badge {
            position: absolute;
            top: 12px;
            right: 12px;
            background: var(--vscode-gitDecoration-addedResourceForeground);
            color: white;
            padding: 4px 8px;
            border-radius: 12px;
            font-size: 11px;
            font-weight: 600;
        }

        .bundle-header {
            margin-bottom: 12px;
        }

        .bundle-title {
            font-size: 18px;
            font-weight: 600;
            margin-bottom: 4px;
        }

        .bundle-author {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
        }

        .bundle-description {
            font-size: 14px;
            color: var(--vscode-foreground);
            margin-bottom: 16px;
            line-height: 1.5;
            display: -webkit-box;
            -webkit-line-clamp: 3;
            -webkit-box-orient: vertical;
            overflow: hidden;
        }

        .content-breakdown {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 8px;
            margin-bottom: 16px;
        }

        .content-item {
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 13px;
            color: var(--vscode-descriptionForeground);
        }

        .content-icon {
            font-size: 16px;
        }

        .content-count {
            font-weight: 600;
            color: var(--vscode-foreground);
        }

        .bundle-tags {
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
            margin-bottom: 16px;
        }

        .tag {
            background: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            padding: 4px 8px;
            border-radius: 12px;
            font-size: 11px;
            font-weight: 500;
        }

        .bundle-actions {
            display: flex;
            gap: 8px;
        }

        .btn {
            flex: 1;
            padding: 8px 16px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 13px;
            font-weight: 500;
            transition: background 0.2s;
        }

        .btn-primary {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }

        .btn-primary:hover {
            background: var(--vscode-button-hoverBackground);
        }

        .btn-secondary {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }

        .btn-secondary:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }

        .btn-danger {
            background: var(--vscode-errorForeground);
            color: white;
        }

        .btn-danger:hover {
            opacity: 0.9;
        }

        .empty-state {
            text-align: center;
            padding: 60px 20px;
            color: var(--vscode-descriptionForeground);
        }

        .empty-state-icon {
            font-size: 48px;
            margin-bottom: 16px;
        }

        .empty-state-title {
            font-size: 18px;
            font-weight: 600;
            margin-bottom: 8px;
        }

        .loading {
            text-align: center;
            padding: 40px;
            color: var(--vscode-descriptionForeground);
        }

        .spinner {
            display: inline-block;
            width: 24px;
            height: 24px;
            border: 3px solid var(--vscode-descriptionForeground);
            border-top-color: transparent;
            border-radius: 50%;
            animation: spin 1s linear infinite;
        }

        @keyframes spin {
            to { transform: rotate(360deg); }
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>🎨 Prompt Marketplace</h1>
        <p>Discover and install curated prompt bundles for GitHub Copilot</p>
    </div>

    <div class="controls">
        <input type="text" class="search-box" id="searchBox" placeholder="Search bundles...">
        
        <div class="filter-group">
            <label class="filter-label">Source:</label>
            <div class="source-selector">
                <button class="source-selector-btn" id="sourceSelectorBtn">
                    <span id="sourceSelectorText">All Sources</span>
                    <span class="dropdown-arrow">▾</span>
                </button>
                <div class="source-dropdown" id="sourceDropdown" style="display: none;">
                    <div class="source-search-container">
                        <input type="text" class="source-search" id="sourceSearch" placeholder="Search sources...">
                    </div>
                    <div class="source-list" id="sourceList">
                        <div class="source-item active" data-source="all">
                            <input type="radio" name="source" id="source-all" value="all" checked>
                            <label for="source-all">All Sources</label>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        
        <div class="filter-group">
            <label class="filter-label">Tags:</label>
            <div class="tag-selector">
                <button class="tag-selector-btn" id="tagSelectorBtn">
                    <span id="tagSelectorText">All Tags</span>
                    <span class="dropdown-arrow">▾</span>
                </button>
                <div class="tag-dropdown" id="tagDropdown" style="display: none;">
                    <div class="tag-search-container">
                        <input type="text" class="tag-search" id="tagSearch" placeholder="Search tags...">
                    </div>
                    <div class="tag-list" id="tagList">
                        <!-- Tags will be populated here -->
                    </div>
                </div>
            </div>
        </div>
        
        <div class="installed-filter" id="installedFilter">
            <input type="checkbox" id="installedCheckbox">
            <label for="installedCheckbox">Installed</label>
        </div>
        
        <button class="filter-btn" id="clearFiltersBtn">Clear</button>
        <button class="refresh-btn" id="refreshBtn">Refresh</button>
    </div>

    <div id="marketplace" class="marketplace-grid">
        <div class="loading">
            <div class="spinner"></div>
            <p>Loading bundles...</p>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        let allBundles = [];
        let filterOptions = { tags: [], sources: [] };
        let selectedSource = 'all';
        let selectedTags = [];
        let showInstalledOnly = false;

        // Handle messages from extension
        window.addEventListener('message', event => {
            const message = event.data;
            
            if (message.type === 'bundlesLoaded') {
                allBundles = message.bundles;
                filterOptions = message.filterOptions || { tags: [], sources: [] };
                updateFilterUI();
                renderBundles();
            }
        });

        // Update filter dropdowns with dynamic data
        function updateFilterUI() {
            const sourceList = document.getElementById('sourceList');
            const tagList = document.getElementById('tagList');

            // Populate source dropdown with radio buttons
            sourceList.innerHTML = '';
            
            // Add "All Sources" option
            const allItem = document.createElement('div');
            allItem.className = 'source-item' + (selectedSource === 'all' ? ' active' : '');
            allItem.dataset.source = 'all';
            allItem.innerHTML = \`
                <input type="radio" name="source" id="source-all" value="all" \${selectedSource === 'all' ? 'checked' : ''}>
                <label for="source-all">All Sources</label>
            \`;
            sourceList.appendChild(allItem);
            
            // Add source options
            filterOptions.sources.forEach(source => {
                const sourceItem = document.createElement('div');
                sourceItem.className = 'source-item' + (selectedSource === source.id ? ' active' : '');
                sourceItem.dataset.source = source.id;
                sourceItem.innerHTML = \`
                    <input type="radio" name="source" id="source-\${source.id}" value="\${source.id}" \${selectedSource === source.id ? 'checked' : ''}>
                    <label for="source-\${source.id}">\${source.name} (\${source.bundleCount})</label>
                \`;
                sourceList.appendChild(sourceItem);
                
                // Add click handler
                sourceItem.addEventListener('click', () => {
                    document.querySelectorAll('.source-item').forEach(i => i.classList.remove('active'));
                    sourceItem.classList.add('active');
                    selectedSource = source.id;
                    document.getElementById('sourceSelectorText').textContent = \`\${source.name} (\${source.bundleCount})\`;
                    sourceItem.querySelector('input[type="radio"]').checked = true;
                    document.getElementById('sourceDropdown').style.display = 'none';
                    renderBundles();
                });
            });
            
            // Add click handler for "All Sources"
            allItem.addEventListener('click', () => {
                document.querySelectorAll('.source-item').forEach(i => i.classList.remove('active'));
                allItem.classList.add('active');
                selectedSource = 'all';
                document.getElementById('sourceSelectorText').textContent = 'All Sources';
                allItem.querySelector('input[type="radio"]').checked = true;
                document.getElementById('sourceDropdown').style.display = 'none';
                renderBundles();
            });

            // Populate tag list with checkboxes
            tagList.innerHTML = '';
            filterOptions.tags.forEach(tag => {
                const tagItem = document.createElement('div');
                tagItem.className = 'tag-item';
                tagItem.dataset.tag = tag;
                
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.id = 'tag-' + tag;
                checkbox.value = tag;
                
                const label = document.createElement('label');
                label.htmlFor = 'tag-' + tag;
                label.textContent = tag;
                label.style.cursor = 'pointer';
                label.style.flex = '1';
                
                tagItem.appendChild(checkbox);
                tagItem.appendChild(label);
                
                // Toggle checkbox on item click
                tagItem.addEventListener('click', (e) => {
                    if (e.target !== checkbox) {
                        checkbox.checked = !checkbox.checked;
                    }
                    updateSelectedTags();
                });
                
                tagList.appendChild(tagItem);
            });
        }

        // Update selected tags from checkboxes
        function updateSelectedTags() {
            const checkboxes = document.querySelectorAll('#tagList input[type="checkbox"]:checked');
            selectedTags = Array.from(checkboxes).map(cb => cb.value);
            updateTagButtonText();
            renderBundles();
        }

        // Update the tag button text based on selection
        function updateTagButtonText() {
            const tagSelectorText = document.getElementById('tagSelectorText');
            if (selectedTags.length === 0) {
                tagSelectorText.textContent = 'All Tags';
            } else if (selectedTags.length === 1) {
                tagSelectorText.textContent = selectedTags[0];
            } else {
                tagSelectorText.textContent = \`\${selectedTags.length} tags\`;
            }
        }

        // Toggle tag dropdown
        document.getElementById('tagSelectorBtn').addEventListener('click', () => {
            const dropdown = document.getElementById('tagDropdown');
            dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
            
            if (dropdown.style.display === 'block') {
                document.getElementById('tagSearch').focus();
            }
        });

        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            const tagSelector = document.querySelector('.tag-selector');
            const dropdown = document.getElementById('tagDropdown');
            
            if (!tagSelector.contains(e.target) && dropdown.style.display === 'block') {
                dropdown.style.display = 'none';
            }
        });

        // Tag search functionality
        document.getElementById('tagSearch').addEventListener('input', (e) => {
            const searchTerm = e.target.value.toLowerCase();
            const tagItems = document.querySelectorAll('.tag-item');
            
            tagItems.forEach(item => {
                const tagName = item.dataset.tag.toLowerCase();
                if (tagName.includes(searchTerm)) {
                    item.classList.remove('hidden');
                } else {
                    item.classList.add('hidden');
                }
            });
        });

        // Search functionality
        document.getElementById('searchBox').addEventListener('input', (e) => {
            renderBundles();
        });

        // Source selector button click
        document.getElementById('sourceSelectorBtn').addEventListener('click', (e) => {
            e.stopPropagation();
            const dropdown = document.getElementById('sourceDropdown');
            dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
            
            if (dropdown.style.display === 'block') {
                document.getElementById('sourceSearch').focus();
            }
        });

        // Close source dropdown when clicking outside
        document.addEventListener('click', (e) => {
            const sourceSelector = document.querySelector('.source-selector');
            const dropdown = document.getElementById('sourceDropdown');
            
            if (sourceSelector && !sourceSelector.contains(e.target) && dropdown && dropdown.style.display === 'block') {
                dropdown.style.display = 'none';
            }
        });

        // Source search functionality
        document.getElementById('sourceSearch').addEventListener('input', (e) => {
            const searchTerm = e.target.value.toLowerCase();
            const sourceItems = document.querySelectorAll('.source-item');
            
            sourceItems.forEach(item => {
                const sourceName = item.dataset.source.toLowerCase();
                if (sourceName.includes(searchTerm)) {
                    item.classList.remove('hidden');
                } else {
                    item.classList.add('hidden');
                }
            });
        });

        // Source item selection
        document.querySelectorAll('.source-item').forEach(item => {
            item.addEventListener('click', () => {
                // Update selection
                document.querySelectorAll('.source-item').forEach(i => i.classList.remove('active'));
                item.classList.add('active');
                
                // Update selected source
                selectedSource = item.dataset.source;
                
                // Update button text
                const label = item.querySelector('label').textContent;
                document.getElementById('sourceSelectorText').textContent = label;
                
                // Check radio button
                item.querySelector('input[type="radio"]').checked = true;
                
                // Close dropdown
                document.getElementById('sourceDropdown').style.display = 'none';
                
                // Re-render bundles
                renderBundles();
            });
        });

        // Installed filter checkbox
        document.getElementById('installedCheckbox').addEventListener('change', (e) => {
            showInstalledOnly = e.target.checked;
            renderBundles();
        });

        // Make the filter div clickable to toggle checkbox
        document.getElementById('installedFilter').addEventListener('click', (e) => {
            if (e.target.id !== 'installedCheckbox') {
                const checkbox = document.getElementById('installedCheckbox');
                checkbox.checked = !checkbox.checked;
                showInstalledOnly = checkbox.checked;
                renderBundles();
            }
        });

        // Clear filters button
        document.getElementById('clearFiltersBtn').addEventListener('click', () => {
            document.getElementById('searchBox').value = '';
            document.getElementById('sourceSearch').value = '';
            document.getElementById('tagSearch').value = '';
            document.getElementById('installedCheckbox').checked = false;
            
            // Reset source selector
            selectedSource = 'all';
            document.getElementById('sourceSelectorText').textContent = 'All Sources';
            document.querySelectorAll('.source-item').forEach(item => {
                item.classList.remove('active');
                if (item.dataset.source === 'all') {
                    item.classList.add('active');
                    item.querySelector('input[type="radio"]').checked = true;
                }
            });
            
            // Uncheck all tag checkboxes
            const checkboxes = document.querySelectorAll('#tagList input[type="checkbox"]');
            checkboxes.forEach(cb => cb.checked = false);
            
            // Show all tags
            const tagItems = document.querySelectorAll('.tag-item');
            tagItems.forEach(item => item.classList.remove('hidden'));
            
            selectedSource = 'all';
            selectedTags = [];
            showInstalledOnly = false;
            updateTagButtonText();
            renderBundles();
        });

        // Refresh button
        document.getElementById('refreshBtn').addEventListener('click', () => {
            vscode.postMessage({ type: 'refresh' });
        });

        function renderBundles() {
            const marketplace = document.getElementById('marketplace');
            const searchTerm = document.getElementById('searchBox').value;
            
            let filteredBundles = allBundles;

            // Apply source filter
            if (selectedSource && selectedSource !== 'all') {
                filteredBundles = filteredBundles.filter(bundle => bundle.sourceId === selectedSource);
            }

            // Apply installed filter
            if (showInstalledOnly) {
                filteredBundles = filteredBundles.filter(bundle => bundle.installed === true);
            }

            // Apply tag filter (OR logic - bundle matches if it has ANY of the selected tags)
            if (selectedTags.length > 0) {
                filteredBundles = filteredBundles.filter(bundle => {
                    if (!bundle.tags || bundle.tags.length === 0) return false;
                    return bundle.tags.some(bundleTag => 
                        selectedTags.some(selectedTag => 
                            bundleTag.toLowerCase() === selectedTag.toLowerCase()
                        )
                    );
                });
            }

            // Apply search filter
            if (searchTerm && searchTerm.trim() !== '') {
                const term = searchTerm.toLowerCase();
                filteredBundles = filteredBundles.filter(bundle => 
                    bundle.name.toLowerCase().includes(term) ||
                    bundle.description.toLowerCase().includes(term) ||
                    (bundle.tags && bundle.tags.some(tag => tag.toLowerCase().includes(term))) ||
                    (bundle.author && bundle.author.toLowerCase().includes(term))
                );
            }

            if (filteredBundles.length === 0) {
                marketplace.innerHTML = \`
                    <div class="empty-state">
                        <div class="empty-state-icon">📦</div>
                        <div class="empty-state-title">No bundles found</div>
                        <p>Try adjusting your search or filters</p>
                    </div>
                \`;
                return;
            }

            marketplace.innerHTML = filteredBundles.map(bundle => \`
                <div class="bundle-card \${bundle.installed ? 'installed' : ''}" data-bundle-id="\${bundle.id}" onclick="openDetails('\${bundle.id}')">
                    \${bundle.installed ? '<div class="installed-badge">✓ Installed</div>' : ''}
                    
                    <div class="bundle-header">
                        <div class="bundle-title">\${bundle.name}</div>
                        <div class="bundle-author">by \${bundle.author || 'Unknown'} • v\${bundle.version}</div>
                    </div>

                    <div class="bundle-description">
                        \${bundle.description || 'No description available'}
                    </div>

                    <div class="content-breakdown">
                        \${renderContentItem('💬', 'Prompts', bundle.contentBreakdown?.prompts || 0)}
                        \${renderContentItem('📋', 'Instructions', bundle.contentBreakdown?.instructions || 0)}
                        \${renderContentItem('🎭', 'Chat Modes', bundle.contentBreakdown?.chatmodes || 0)}
                        \${renderContentItem('🤖', 'Agents', bundle.contentBreakdown?.agents || 0)}
                    </div>

                    <div class="bundle-tags">
                        \${(bundle.tags || []).slice(0, 4).map(tag => \`
                            <span class="tag">\${tag}</span>
                        \`).join('')}
                    </div>

                    <div class="bundle-actions" onclick="event.stopPropagation()">
                        \${bundle.installed 
                            ? \`<button class="btn btn-danger" onclick="uninstallBundle('\${bundle.id}')">Uninstall</button>\`
                            : \`<button class="btn btn-primary" onclick="installBundle('\${bundle.id}')">Install</button>\`
                        }
                        <button class="btn btn-secondary" onclick="openDetails('\${bundle.id}')">Details</button>
                    </div>
                </div>
            \`).join('');
        }

        function renderContentItem(icon, label, count) {
            if (count === 0) return '';
            return \`
                <div class="content-item">
                    <span class="content-icon">\${icon}</span>
                    <span class="content-count">\${count}</span>
                    <span>\${label}</span>
                </div>
            \`;
        }

        function installBundle(bundleId) {
            vscode.postMessage({ type: 'install', bundleId });
        }

        function uninstallBundle(bundleId) {
            vscode.postMessage({ type: 'uninstall', bundleId });
        }

        function openDetails(bundleId) {
            vscode.postMessage({ type: 'openDetails', bundleId });
        }
    </script>
</body>
</html>`;
    }
}

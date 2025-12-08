/**
 * Bundle Browsing Commands
 * Handles bundle discovery, browsing, and viewing operations
 */

import * as vscode from 'vscode';
import { RegistryManager } from '../services/RegistryManager';
import { Bundle } from '../types/registry';
import { ErrorHandler } from '../utils/errorHandler';
import { CONCURRENCY_CONSTANTS } from '../utils/constants';

/**
 * Bundle Browsing Commands Handler
 * Focused on discovery and browsing operations
 */
export class BundleBrowsingCommands {
    constructor(private registryManager: RegistryManager) {
        // Logger removed as it was unused - ErrorHandler provides logging
    }

    /**
     * View bundle details
     */
    async viewBundle(bundleId?: string): Promise<void> {
        try {
            // If no bundleId, let user search
            if (!bundleId) {
                const searchQuery = await vscode.window.showInputBox({
                    prompt: 'Search for bundles',
                    placeHolder: 'e.g., python developer',
                    ignoreFocusOut: true
                });

                if (!searchQuery) {
                    return;
                }

                const bundles = await this.registryManager.searchBundles({
                    text: searchQuery
                });

                if (bundles.length === 0) {
                    vscode.window.showInformationMessage(`No bundles found for "${searchQuery}"`);
                    return;
                }

                const selected = await vscode.window.showQuickPick(
                    bundles.map(b => ({
                        label: b.name,
                        description: `v${b.version}`,
                        bundle: b
                    })),
                    {
                        placeHolder: 'Select bundle to view',
                        title: 'Bundle Search',
                        ignoreFocusOut: true
                    }
                );

                if (!selected) {
                    return;
                }

                bundleId = selected.bundle.id;
            }

            // Get bundle details
            let bundle;
            try {
                bundle = await this.registryManager.getBundleDetails(bundleId);
            } catch (error) {
                // If bundle not found in registry, show error and return
                vscode.window.showErrorMessage(`Bundle '${bundleId}' not found. It may have been removed or is no longer available.`);
                return;
            }

            // Check if installed
            const installed = await this.registryManager.listInstalledBundles();
            const isInstalled = installed.some(ib => ib.bundleId === bundleId);

            // Show quick pick with bundle info and actions
            const action = await vscode.window.showQuickPick([
                {
                    label: '$(info) Bundle Information',
                    description: '',
                    detail: this.formatBundleInfo(bundle, isInstalled),
                    value: 'info',
                    kind: vscode.QuickPickItemKind.Separator
                },
                ...(isInstalled ? [] : [{
                    label: '$(cloud-download) Install',
                    description: 'Install this bundle',
                    value: 'install'
                }]),
                ...(isInstalled ? [{
                    label: '$(trash) Uninstall',
                    description: 'Remove this bundle',
                    value: 'uninstall'
                }] : []),
                ...(isInstalled ? [{
                    label: '$(sync) Check for Updates',
                    description: 'Check if newer version available',
                    value: 'update'
                }] : []),
                {
                    label: '$(link-external) View in Browser',
                    description: 'Open bundle repository',
                    value: 'browser'
                }
            ], {
                placeHolder: bundle.name,
                title: 'Bundle Details',
                ignoreFocusOut: true
            });

            if (action) {
                switch (action.value) {
                    case 'install':
                        await vscode.commands.executeCommand('promptRegistry.installBundle', bundleId);
                        break;
                    case 'uninstall':
                        await vscode.commands.executeCommand('promptRegistry.uninstallBundle', bundleId);
                        break;
                    case 'update':
                        await vscode.commands.executeCommand('promptRegistry.updateBundle', bundleId);
                        break;
                    case 'browser':
                        // TODO: Open in browser once we have repository URL in bundle metadata
                        vscode.window.showInformationMessage('Repository URL not available');
                        break;
                }
            }

        } catch (error) {
            await ErrorHandler.handle(error, {
                operation: 'view bundle',
                showUserMessage: true,
                userMessagePrefix: 'Failed to load bundle'
            });
        }
    }

    /**
     * Browse bundles by category
     */
    async browseByCategory(): Promise<void> {
        try {
            const category = await vscode.window.showQuickPick(
                [
                    { label: '💻 Development', value: 'development' },
                    { label: '🎨 Design', value: 'design' },
                    { label: '📝 Documentation', value: 'documentation' },
                    { label: '🧪 Testing', value: 'testing' },
                    { label: '🔧 DevOps', value: 'devops' },
                    { label: '📊 Data Science', value: 'data-science' },
                    { label: '🤖 AI/ML', value: 'ai-ml' },
                    { label: '🌐 Web Development', value: 'web-dev' },
                ],
                {
                    placeHolder: 'Select a category',
                    title: 'Browse Bundles by Category',
                    ignoreFocusOut: true
                }
            );

            if (!category) {
                return;
            }

            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: `Loading ${category.label} bundles...`,
                    cancellable: false
                },
                async () => {
                    const bundles = await this.registryManager.searchBundles({
                        tags: [category.value]
                    });

                    if (bundles.length === 0) {
                        vscode.window.showInformationMessage(
                            `No bundles found in ${category.label}`
                        );
                        return;
                    }

                    const selected = await vscode.window.showQuickPick(
                        bundles.map(b => ({
                            label: b.name,
                            description: `v${b.version} • ${b.author}`,
                            detail: b.description,
                            bundle: b
                        })),
                        {
                            placeHolder: `${bundles.length} bundle(s) in ${category.label}`,
                            title: 'Select Bundle',
                            ignoreFocusOut: true
                        }
                    );

                    if (selected) {
                        await this.viewBundle(selected.bundle.id);
                    }
                }
            );

        } catch (error) {
            await ErrorHandler.handle(error, {
                operation: 'browse bundles',
                showUserMessage: true,
                userMessagePrefix: 'Browse failed'
            });
        }
    }

    /**
     * Show popular bundles
     */
    async showPopular(): Promise<void> {
        try {
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: 'Loading popular bundles...',
                    cancellable: false
                },
                async () => {
                    const bundles = await this.registryManager.searchBundles({
                        sortBy: 'downloads'
                    });

                    if (bundles.length === 0) {
                        vscode.window.showInformationMessage('No bundles available');
                        return;
                    }

                    const selected = await vscode.window.showQuickPick(
                        bundles.slice(0, CONCURRENCY_CONSTANTS.POPULAR_BUNDLES_LIMIT).map(b => ({
                            label: b.name,
                            description: `v${b.version} • ${b.author}`,
                            detail: b.description,
                            bundle: b
                        })),
                        {
                            placeHolder: 'Popular bundles',
                            title: 'Most Downloaded Bundles',
                            ignoreFocusOut: true
                        }
                    );

                    if (selected) {
                        await this.viewBundle(selected.bundle.id);
                    }
                }
            );

        } catch (error) {
            await ErrorHandler.handle(error, {
                operation: 'show popular bundles',
                showUserMessage: true,
                userMessagePrefix: 'Failed to load bundles'
            });
        }
    }

    /**
     * List installed bundles
     */
    async listInstalled(): Promise<void> {
        try {
            const installed = await this.registryManager.listInstalledBundles();

            if (installed.length === 0) {
                vscode.window.showInformationMessage(
                    'No bundles installed yet.',
                    'Browse Bundles'
                ).then(action => {
                    if (action === 'Browse Bundles') {
                        vscode.commands.executeCommand('promptRegistry.searchAndInstall');
                    }
                });
                return;
            }

            const selected = await vscode.window.showQuickPick(
                await Promise.all(installed.map(async ib => {
                    try {
                        const bundle = await this.registryManager.getBundleDetails(ib.bundleId);
                        return {
                            label: bundle.name,
                            description: `v${ib.version} • ${ib.scope}`,
                            detail: `Installed: ${new Date(ib.installedAt).toLocaleDateString()}`,
                            installed: ib
                        };
                    } catch {
                        return {
                            label: ib.bundleId,
                            description: `v${ib.version} • ${ib.scope}`,
                            detail: `Installed: ${new Date(ib.installedAt).toLocaleDateString()}`,
                            installed: ib
                        };
                    }
                })),
                {
                    placeHolder: `${installed.length} bundle(s) installed`,
                    title: 'Installed Bundles',
                    ignoreFocusOut: true
                }
            );

            if (selected) {
                await this.viewBundle(selected.installed.bundleId);
            }

        } catch (error) {
            await ErrorHandler.handle(error, {
                operation: 'list installed bundles',
                showUserMessage: true,
                userMessagePrefix: 'Failed to load bundles'
            });
        }
    }

    // ===== Private Helper Methods =====

    /**
     * Format bundle info for display
     */
    private formatBundleInfo(bundle: Bundle, isInstalled: boolean): string {
        const parts: string[] = [];
        
        parts.push(`Name: ${bundle.name}`);
        parts.push(`Version: ${bundle.version}`);
        parts.push(`Author: ${bundle.author}`);
        parts.push(`Description: ${bundle.description}`);
        
        if (bundle.tags && bundle.tags.length > 0) {
            parts.push(`Tags: ${bundle.tags.join(', ')}`);
        }
        
        if (isInstalled) {
            parts.push(`Status: ✓ Installed`);
        } else {
            parts.push(`Status: Not installed`);
        }
        
        return parts.join('\n');
    }
}
/**
 * Marketplace View Provider
 * Displays a visual marketplace for browsing and installing prompt bundles
 * Similar to open-vsx.org marketplace experience
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import { Logger } from '../utils/logger';
import { RegistryManager } from '../services/RegistryManager';
import { Bundle, InstalledBundle, RegistrySource } from '../types/registry';
import { UI_CONSTANTS } from '../utils/constants';
import { extractAllTags, extractBundleSources } from '../utils/filterUtils';
import { VersionManager } from '../utils/versionManager';
import { BundleIdentityMatcher } from '../utils/bundleIdentityMatcher';
import { McpServerConfig, McpStdioServerConfig, McpRemoteServerConfig, isStdioServerConfig, isRemoteServerConfig } from '../types/mcp';
import { RatingCache } from '../services/engagement/RatingCache';
import { FeedbackCache } from '../services/engagement/FeedbackCache';

/**
 * Message types sent from webview to extension
 */
interface WebviewMessage {
    type: 'refresh' | 'install' | 'update' | 'uninstall' | 'openDetails' | 'openPromptFile' | 'installVersion' | 'getVersions' | 'toggleAutoUpdate' | 'openSourceRepository' | 'getFeedbacks';
    bundleId?: string;
    installPath?: string;
    filePath?: string;
    version?: string;
    enabled?: boolean;
    sourceId?: string;
}

/**
 * Content breakdown showing count of each resource type
 */
interface ContentBreakdown {
    prompts: number;
    instructions: number;
    chatmodes: number;
    agents: number;
    skills: number;
    mcpServers: number;
}

export class MarketplaceViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'promptregistry.marketplace';

    private _view?: vscode.WebviewView;
    private readonly logger: Logger;
    private sourceSyncDebounceTimer?: NodeJS.Timeout;
    private isLoadingBundles = false;
    private disposables: vscode.Disposable[] = [];

    /**
     * Escape HTML special characters to prevent XSS
     */
    private escapeHtml(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly registryManager: RegistryManager
    ) {
        this.logger = Logger.getInstance();

        // Listen to bundle and source events to refresh marketplace
        this.disposables.push(
            this.registryManager.onBundleInstalled((installation) => {
                this.handleBundleEvent('installed', installation.bundleId, () => this.loadBundles());
            }),
            this.registryManager.onBundleUninstalled((bundleId) => {
                this.handleBundleEvent('uninstalled', bundleId, () => this.loadBundles());
            }),
            this.registryManager.onBundleUpdated((installation) => {
                this.handleBundleEvent('updated', installation.bundleId, () => this.loadBundles());
            }),
            this.registryManager.onBundlesInstalled((installations) => {
                this.handleBundleEvent('installed', `${installations.length} bundles`, () => this.loadBundles());
            }),
            this.registryManager.onBundlesUninstalled((bundleIds) => {
                this.handleBundleEvent('uninstalled', `${bundleIds.length} bundles`, () => this.loadBundles());
            }),
            // Source sync events with debouncing
            this.registryManager.onSourceSynced((event) => this.handleSourceSynced(event)),
            // Auto-update preference changes
            this.registryManager.onAutoUpdatePreferenceChanged(() => this.loadBundles()),
            // Repository bundle changes (lockfile changes, workspace folder changes)
            this.registryManager.onRepositoryBundlesChanged(() => this.loadBundles())
        );
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

        // Load bundles with a small delay to ensure webview JavaScript is ready
        // The webview also sends a refresh request when ready as a backup
        setTimeout(() => {
            this.loadBundles();
        }, UI_CONSTANTS.WEBVIEW_READY_DELAY_MS);
    }

    /**
     * Handle bundle events with error handling and user notification
     */
    private handleBundleEvent(
        eventType: 'installed' | 'uninstalled' | 'updated',
        bundleId: string,
        action: () => void | Promise<void>
    ): void {
        try {
            this.logger.debug(`Bundle ${eventType} event received: ${bundleId}, refreshing marketplace`);
            action();
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            this.logger.error(`Error handling bundle ${eventType} event`, error as Error);
            
            // Show user-facing error notification
            vscode.window.showErrorMessage(
                `Failed to refresh marketplace after bundle ${eventType}: ${errorMsg}`
            );
        }
    }

    /**
     * Handle source synced event with leading-edge debouncing
     * Fires immediately on first event, then debounces subsequent events
     * This ensures progressive loading - UI updates as soon as first source syncs
     */
    private handleSourceSynced(event: { sourceId: string; bundleCount: number }): void {
        this.logger.debug(`Source synced: ${event.sourceId} (${event.bundleCount} bundles)`);

        const isFirstEvent = !this.sourceSyncDebounceTimer;

        // Clear existing timer if any
        if (this.sourceSyncDebounceTimer) {
            clearTimeout(this.sourceSyncDebounceTimer);
        }

        // Fire immediately on first event (leading edge)
        if (isFirstEvent) {
            this.loadBundles();
        }

        // Set trailing edge timer
        this.sourceSyncDebounceTimer = setTimeout(() => {
            this.sourceSyncDebounceTimer = undefined;
            this.loadBundles();
        }, UI_CONSTANTS.SOURCE_SYNC_DEBOUNCE_MS);
    }

    /**
     * Dispose of resources
     */
    dispose(): void {
        // Clear debounce timer
        if (this.sourceSyncDebounceTimer) {
            clearTimeout(this.sourceSyncDebounceTimer);
        }

        // Dispose all event listeners
        this.disposables.forEach(d => d.dispose());
        this.disposables = [];
    }

    /**
     * Find installed bundle by marketplace bundle ID using identity matching
     * 
     * @param bundleId - Marketplace bundle ID
     * @returns Bundle info including marketplace bundle, installed bundle, and source
     * @throws Error if marketplace bundle not found
     */
    private async findInstalledBundleByMarketplaceId(bundleId: string): Promise<{
        bundle: Bundle;
        installed: InstalledBundle | undefined;
        source: RegistrySource | undefined;
    }> {
        const [installedBundles, sources, bundles] = await Promise.all([
            this.registryManager.listInstalledBundles(),
            this.registryManager.listSources(),
            this.registryManager.searchBundles({ cacheOnly: true })
        ]);
        
        const bundle = bundles.find(b => b.id === bundleId);
        if (!bundle) {
            throw new Error('Bundle not found');
        }
        
        const source = sources.find(s => s.id === bundle.sourceId);
        const installed = installedBundles.find(ib => 
            this.matchesBundleIdentity(ib.bundleId, bundle.id, source?.type || 'local')
        );
        
        return { bundle, installed, source };
    }

    /**
     * Determine button state based on installation status and version comparison
     * 
     * @param bundle - The bundle to check
     * @param installed - The installed bundle info (if installed)
     * @returns Button state: 'install', 'update', or 'uninstall'
     */
    private determineButtonState(
        bundle: Bundle,
        installed: InstalledBundle | undefined
    ): 'install' | 'update' | 'uninstall' {
        if (!installed) {
            return 'install';
        }

        try {
            // Check if an update is available
            if (VersionManager.isUpdateAvailable(installed.version, bundle.version)) {
                return 'update';
            }
        } catch (error) {
            // If version comparison fails, fall back to string comparison
            this.logger.warn(`Version comparison failed for ${bundle.id}: ${(error as Error).message}`);
            if (installed.version !== bundle.version) {
                return 'update';
            }
        }

        return 'uninstall';
    }

    /**
     * Check if installed bundle matches the marketplace bundle identity
     * 
     * For GitHub bundles, compares without version suffix (owner-repo)
     * For other sources, requires exact match
     * 
     * @param installedId - Bundle ID from installed bundle
     * @param bundleId - Bundle ID from marketplace
     * @param sourceType - Source type of the bundle
     * @returns True if the bundles match
     */
    private matchesBundleIdentity(
        installedId: string,
        bundleId: string,
        sourceType: string
    ): boolean {
        return BundleIdentityMatcher.matches(installedId, bundleId, sourceType as any);
    }

    /**
     * Load bundles from registries and send to webview
     * Uses cacheOnly mode for fast initial load, then updates progressively via onSourceSynced events
     */
    private async loadBundles(): Promise<void> {
        // Prevent concurrent loads to avoid UI flicker
        if (this.isLoadingBundles) {
            this.logger.debug('Skipping loadBundles - already loading');
            return;
        }
        
        this.isLoadingBundles = true;
        try {
            // Search for all bundles using cache only (non-blocking)
            // This ensures fast initial load - network fetches happen via syncSource which fires onSourceSynced
            const bundles = await this.registryManager.searchBundles({ cacheOnly: true });
            const installedBundles = await this.registryManager.listInstalledBundles();
            const sources = await this.registryManager.listSources();
            const autoUpdateService = this.registryManager.autoUpdateService;

            // Preload auto-update preferences once per refresh
            const autoUpdatePreferences = autoUpdateService
                ? await autoUpdateService.getAllAutoUpdatePreferences()
                : {};

            const enhancedBundles = await Promise.all(bundles.map(async bundle => {
                // Find matching installed bundle using identity matching
                const source = sources.find(s => s.id === bundle.sourceId);
                const installed = installedBundles.find(ib => 
                    this.matchesBundleIdentity(ib.bundleId, bundle.id, source?.type || 'local')
                );
                
                // Use manifest from installed bundle if available
                const contentBreakdown = this.getContentBreakdown(bundle, installed?.manifest);

                // Check if bundle is from a curated hub
                const isCurated = source?.hubId !== undefined;
                const hubName = isCurated && source?.hubId ? source.metadata?.description || source.name : undefined;

                // Determine button state based on installation status and version
                const buttonState = this.determineButtonState(bundle, installed);

                // Get available versions if this is a consolidated bundle
                let availableVersions: Array<{version: string}> | undefined;
                if ((bundle as any).isConsolidated && (bundle as any).availableVersions) {
                    availableVersions = (bundle as any).availableVersions.map((v: any) => ({
                        version: v.version
                    }));
                }

                // Get auto-update status if bundle is installed (from preloaded preferences)
                const autoUpdateEnabled = installed
                    ? autoUpdatePreferences[installed.bundleId] ?? false
                    : false;

                // Get rating from cache if available
                const ratingCache = RatingCache.getInstance();
                const ratingDisplay = ratingCache.getRatingDisplay(bundle.sourceId, bundle.id);
                const cachedRating = ratingCache.getRating(bundle.sourceId, bundle.id);

                return {
                    ...bundle,
                    installed: !!installed,
                    installedVersion: installed?.version,
                    buttonState,
                    isCurated,
                    hubName,
                    contentBreakdown,
                    availableVersions,
                    autoUpdateEnabled,
                    rating: cachedRating ? {
                        starRating: cachedRating.starRating,
                        voteCount: cachedRating.voteCount,
                        confidence: cachedRating.confidence,
                        displayText: ratingDisplay?.text
                    } : undefined,
                };
            }));

            // Extract dynamic filter options
            const availableTags = extractAllTags(bundles);
            const availableSources = extractBundleSources(bundles, sources);

            // Send to webview (only if view is available)
            if (this._view) {
                this._view.webview.postMessage({
                    type: 'bundlesLoaded',
                    bundles: enhancedBundles,
                    filterOptions: {
                        tags: availableTags,
                        sources: availableSources
                    }
                });
            }

            this.logger.debug(`Loaded ${enhancedBundles.length} bundles for marketplace`);

        } catch (error) {
            this.logger.error('Failed to load marketplace bundles', error as Error);
        } finally {
            this.isLoadingBundles = false;
        }
    }

    /**
     * Count prompts by type from an array of prompt objects
     */
    private countPromptsByType(prompts: any[], mcpServersCount: number = 0): ContentBreakdown {
        const breakdown: ContentBreakdown = {
            prompts: 0,
            instructions: 0,
            chatmodes: 0,
            agents: 0,
            skills: 0,
            mcpServers: mcpServersCount
        };

        for (const prompt of prompts) {
            const type = prompt.type || 'prompt';
            switch (type) {
                case 'prompt':
                    breakdown.prompts++;
                    break;
                case 'instructions':
                    breakdown.instructions++;
                    break;
                case 'chatmode':
                    breakdown.chatmodes++;
                    break;
                case 'agent':
                    breakdown.agents++;
                    break;
                case 'skill':
                    breakdown.skills++;
                    break;
            }
        }

        return breakdown;
    }

    /**
     * Calculate content breakdown from bundle metadata
     */
    private getContentBreakdown(bundle: Bundle, manifest?: any): ContentBreakdown {
        const bundleData = bundle as any;
        const mcpCount = manifest?.mcpServers ? Object.keys(manifest.mcpServers).length : this.countMcpServers(bundleData);

        // First: Use manifest if provided (from installed bundle)
        if (manifest?.prompts && Array.isArray(manifest.prompts)) {
            return this.countPromptsByType(manifest.prompts, mcpCount);
        }

        // Second: Try to parse from bundle data (some sources embed this)
        if (bundleData.prompts && Array.isArray(bundleData.prompts)) {
            return this.countPromptsByType(bundleData.prompts, mcpCount);
        }

        // Third: Use pre-calculated breakdown from adapters (AwesomeCopilot, LocalAwesomeCopilot)
        if (bundleData.breakdown) {
            return {
                prompts: bundleData.breakdown.prompts || 0,
                instructions: bundleData.breakdown.instructions || 0,
                chatmodes: bundleData.breakdown.chatmodes || 0,
                agents: bundleData.breakdown.agents || 0,
                skills: bundleData.breakdown.skills || 0,
                mcpServers: bundleData.breakdown.mcpServers || this.countMcpServers(bundleData)
            };
        }

        // Fourth: For local OLAF bundles, show skills separately
        if (bundleData.skills && Array.isArray(bundleData.skills)) {
            return {
                prompts: 0,
                instructions: 0,
                chatmodes: 0,
                agents: 0,
                skills: bundleData.skills.length,
                mcpServers: this.countMcpServers(bundleData)
            };
        }

        // Fallback: Don't show estimates for uninstalled bundles
        // If we don't have manifest data, return zeros instead of misleading estimates
        // Users can install the bundle to see accurate counts
        return {
            prompts: 0,
            instructions: 0,
            chatmodes: 0,
            agents: 0,
            skills: 0,
            mcpServers: this.countMcpServers(bundleData)
        };
    }

    /**
     * Count MCP servers from bundle data
     */
    private countMcpServers(bundleData: any): number {
        // Check manifest.mcpServers
        if (bundleData.mcpServers && typeof bundleData.mcpServers === 'object') {
            return Object.keys(bundleData.mcpServers).length;
        }
        // Check mcp.items (collection format)
        if (bundleData.mcp?.items && typeof bundleData.mcp.items === 'object') {
            return Object.keys(bundleData.mcp.items).length;
        }
        return 0;
    }

    /**
     * Handle messages from webview
     */
    private async handleMessage(message: WebviewMessage): Promise<void> {
        switch (message.type) {
            case 'refresh':
                await this.loadBundles();
                break;
            case 'install':
                if (message.bundleId) {
                    await this.handleInstall(message.bundleId);
                }
                break;
            case 'update':
                if (message.bundleId) {
                    await this.handleUpdate(message.bundleId);
                }
                break;
            case 'uninstall':
                if (message.bundleId) {
                    await this.handleUninstall(message.bundleId);
                }
                break;
            case 'openDetails':
                if (message.bundleId) {
                    await this.openBundleDetails(message.bundleId);
                }
                break;
            case 'openPromptFile':
                if (message.installPath && message.filePath) {
                    await this.openPromptFileInEditor(message.installPath, message.filePath);
                }
                break;
            case 'installVersion':
                if (message.bundleId && message.version) {
                    await this.handleInstallVersion(message.bundleId, message.version);
                }
                break;
            case 'getVersions':
                if (message.bundleId) {
                    await this.handleGetVersions(message.bundleId);
                }
                break;
            case 'toggleAutoUpdate':
                if (message.bundleId !== undefined && message.enabled !== undefined) {
                    await this.handleToggleAutoUpdate(message.bundleId, message.enabled);
                }
                break;
            case 'openSourceRepository':
                if (message.bundleId) {
                    await this.handleOpenSourceRepository(message.bundleId);
                }
                break;
            case 'getFeedbacks':
                if (message.bundleId) {
                    await this.handleGetFeedbacks(message.bundleId);
                }
                break;
            default:
                this.logger.warn(`Unknown message type: ${message.type}`);
        }
    }

    /**
     * Open the source repository for a bundle
     */
    private async handleOpenSourceRepository(bundleId: string): Promise<void> {
        try {
            const { bundle, source } = await this.findInstalledBundleByMarketplaceId(bundleId);
            
            // Create a fake tree item to pass to the command
            const item = {
                type: 'bundle',
                data: {
                    ...bundle,
                    sourceId: bundle.sourceId
                }
            };
            
            await vscode.commands.executeCommand('promptregistry.openItemRepository', item);
        } catch (error) {
            this.logger.error('Failed to open source repository', error as Error);
            vscode.window.showErrorMessage(`Failed to open repository: ${(error as Error).message}`);
        }
    }

    /**
     * Get feedbacks for a bundle and send to webview
     */
    private async handleGetFeedbacks(bundleId: string): Promise<void> {
        try {
            const feedbackCache = FeedbackCache.getInstance();
            const ratingCache = RatingCache.getInstance();
            
            // Get feedbacks from cache
            const feedbacks = feedbackCache.getFeedbacks(bundleId) || [];
            
            // Get rating data for the bundle
            // Note: We need sourceId to look up ratings, but bundleId alone is insufficient
            // For now, we'll need to find the bundle to get its sourceId
            const bundles = await this.registryManager.searchBundles({ text: bundleId });
            const bundle = bundles.find(b => b.id === bundleId);
            const rating = bundle ? ratingCache.getRating(bundle.sourceId, bundleId) : undefined;
            
            // Send data to webview
            if (this._view) {
                this._view.webview.postMessage({
                    type: 'feedbacksLoaded',
                    bundleId: bundleId,
                    feedbacks: feedbacks,
                    rating: rating
                });
            }
        } catch (error) {
            this.logger.error('Failed to get feedbacks', error as Error);
            // Send empty feedbacks on error
            if (this._view) {
                this._view.webview.postMessage({
                    type: 'feedbacksLoaded',
                    bundleId: bundleId,
                    feedbacks: [],
                    rating: null
                });
            }
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
     * Show scope selection dialog and return result
     * @returns Scope selection result or undefined if cancelled
     */
    private async promptForScope(): Promise<import('../utils/scopeSelectionUI').ScopeSelectionResult | undefined> {
        const { showScopeSelectionDialog } = await import('../utils/scopeSelectionUI');
        return showScopeSelectionDialog();
    }

    /**
     * Install a bundle
     */
    private async handleInstall(bundleId: string): Promise<void> {
        try {
            this.logger.info(`Installing bundle from marketplace: ${bundleId}`);

            // Show scope selection dialog
            const scopeResult = await this.promptForScope();
            
            if (!scopeResult) {
                // User cancelled the dialog
                this.logger.debug('Installation cancelled by user');
                return;
            }

            // Use RegistryManager to install with selected scope
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `Installing bundle...`,
                cancellable: false
            }, async () => {
                await this.registryManager.installBundle(bundleId, {
                    scope: scopeResult.scope,
                    version: 'latest',
                    commitMode: scopeResult.commitMode
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

            // Find the actual installed bundle using identity matching
            const { installed } = await this.findInstalledBundleByMarketplaceId(bundleId);

            if (!installed) {
                throw new Error(`Bundle '${bundleId}' is not installed`);
            }

            // Use the stored bundle ID from the installation record
            await this.registryManager.uninstallBundle(installed.bundleId, installed.scope || 'user');

            vscode.window.showInformationMessage(`✅ Bundle uninstalled successfully!`);

            // Refresh marketplace
            await this.loadBundles();

        } catch (error) {
            this.logger.error('Failed to uninstall bundle from marketplace', error as Error);
            vscode.window.showErrorMessage(`Failed to uninstall bundle: ${(error as Error).message}`);
        }
    }

    /**
     * Update a bundle to the latest version
     * 
     * This method performs a two-step process:
     * 1. Uninstall the current version
     * 2. Install the latest version
     * 
     * If uninstall fails, the update is aborted.
     * If install fails after successful uninstall, the bundle will be left uninstalled.
     */
    private async handleUpdate(bundleId: string): Promise<void> {
        try {
            this.logger.info(`Updating bundle from marketplace: ${bundleId}`);

            // Get current installation info to preserve scope
            const { installed } = await this.findInstalledBundleByMarketplaceId(bundleId);

            if (!installed) {
                // Bundle not installed, just install it
                this.logger.warn(`Bundle ${bundleId} not installed, performing fresh install`);
                await this.handleInstall(bundleId);
                return;
            }

            // Use the unified update flow from RegistryManager
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `Updating bundle...`,
                cancellable: false
            }, async (progress) => {
                progress.report({ message: 'Updating bundle...' });
                await this.registryManager.updateBundle(installed.bundleId);
            });

            vscode.window.showInformationMessage(`✅ Bundle updated successfully!`);

            // Refresh marketplace to show updated state
            await this.loadBundles();

        } catch (error) {
            this.logger.error('Failed to update bundle from marketplace', error as Error);
            vscode.window.showErrorMessage(`Failed to update bundle: ${(error as Error).message}`);
        }
    }

    /**
     * Handle installation of a specific version
     * 
     * @param bundleId - The bundle to install
     * @param version - The specific version to install
     */
    private async handleInstallVersion(bundleId: string, version: string): Promise<void> {
        try {
            this.logger.info(`Installing specific version of bundle: ${bundleId} v${version}`);

            // Show scope selection dialog
            const scopeResult = await this.promptForScope();
            
            if (!scopeResult) {
                // User cancelled the dialog
                this.logger.debug('Installation cancelled by user');
                return;
            }

            // Use RegistryManager to install with specific version and selected scope
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `Installing bundle v${version}...`,
                cancellable: false
            }, async () => {
                await this.registryManager.installBundle(bundleId, {
                    scope: scopeResult.scope,
                    version: version,
                    commitMode: scopeResult.commitMode
                });
            });

            vscode.window.showInformationMessage(`✅ Bundle v${version} installed successfully!`);

            // Refresh marketplace
            await this.loadBundles();

        } catch (error) {
            this.logger.error('Failed to install specific version from marketplace', error as Error);
            vscode.window.showErrorMessage(`Failed to install bundle v${version}: ${(error as Error).message}`);
        }
    }

    /**
     * Handle request to get available versions for a bundle
     * 
     * @param bundleId - The bundle to get versions for
     */
    private async handleGetVersions(bundleId: string): Promise<void> {
        try {
            this.logger.debug(`Getting available versions for bundle: ${bundleId}`);

            // Get the bundle to determine its identity
            const { bundle } = await this.findInstalledBundleByMarketplaceId(bundleId);

            // Get available versions
            const versions = await this.getAvailableVersions(bundle);

            // Send versions back to webview
            this._view?.webview.postMessage({
                type: 'versionsLoaded',
                bundleId: bundleId,
                versions: versions
            });

            this.logger.debug(`Sent ${versions.length} versions for bundle ${bundleId}`);

        } catch (error) {
            this.logger.error('Failed to get available versions', error as Error);
        }
    }

    /**
     * Get all available versions for a bundle
     * 
     * @param bundle - The bundle to get versions for
     * @returns Array of version strings in descending order
     */
    private async getAvailableVersions(bundle: Bundle): Promise<string[]> {
        try {
            // Use public API from RegistryManager
            return await this.registryManager.getAvailableVersions(bundle.id);
        } catch (error) {
            this.logger.error('Failed to get available versions', error as Error);
            return [bundle.version];
        }
    }

    /**
     * Handle toggle auto-update request from webview
     *
     * @param bundleId - The bundle to toggle auto-update for
     * @param enabled - Whether auto-update should be enabled
     */
    private async handleToggleAutoUpdate(bundleId: string, enabled: boolean): Promise<void> {
        try {
            this.logger.info(`Toggling auto-update for bundle '${bundleId}' to ${enabled}`);

            // Use RegistryManager facade methods to ensure event is emitted
            if (enabled) {
                await this.registryManager.enableAutoUpdate(bundleId);
            } else {
                await this.registryManager.disableAutoUpdate(bundleId);
            }

            // Show confirmation
            const status = enabled ? 'enabled' : 'disabled';
            vscode.window.showInformationMessage(`Auto-update ${status} for ${bundleId}`);

            // Note: UI refresh is handled automatically by event listener registered in activateBundleListeners()

        } catch (error) {
            this.logger.error('Failed to toggle auto-update', error as Error);
            vscode.window.showErrorMessage(`Failed to toggle auto-update: ${(error as Error).message}`);
        }
    }

    /**
     * Open bundle details in a new webview panel
     */
    async openBundleDetails(bundleId: string): Promise<void> {
        try {
            this.logger.debug(`Opening details for bundle: ${bundleId}`);

            // Use getBundleDetails which handles identity matching for versioned IDs
            // (e.g., "bundle-name-1.0.17" gets matched to consolidated "bundle-name")
            let bundle: Bundle;
            try {
                bundle = await this.registryManager.getBundleDetails(bundleId);
            } catch (error) {
                this.logger.error(`Failed to get bundle details for ${bundleId}`, error as Error);
                vscode.window.showErrorMessage('Bundle not found');
                return;
            }

            // Check if installed to get manifest - use identity matching for GitHub bundles
            const installedBundles = await this.registryManager.listInstalledBundles();
            const sources = await this.registryManager.listSources();
            const source = sources.find(s => s.id === bundle.sourceId);
            const installed = installedBundles.find(ib => 
                this.matchesBundleIdentity(ib.bundleId, bundle.id, source?.type || 'local')
            );
            const breakdown = this.getContentBreakdown(bundle, installed?.manifest);

            // Get auto-update status if bundle is installed (using preloaded preferences API)
            let autoUpdateEnabled = false;
            if (installed) {
                const autoUpdateService = this.registryManager.autoUpdateService;
                if (autoUpdateService) {
                    const autoUpdatePreferences = await autoUpdateService.getAllAutoUpdatePreferences();
                    autoUpdateEnabled = autoUpdatePreferences[installed.bundleId] ?? false;
                }
            }

            // Get rating from cache
            const ratingCache = RatingCache.getInstance();
            const ratingDisplay = ratingCache.getRatingDisplay(bundle.sourceId, bundle.id);
            const cachedRating = ratingCache.getRating(bundle.sourceId, bundle.id);

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
            panel.webview.html = this.getBundleDetailsHtml(panel.webview, bundle, installed, breakdown, autoUpdateEnabled, cachedRating, ratingDisplay);

            // Handle messages from the details panel
            panel.webview.onDidReceiveMessage(
                async (message) => {
                    if (message.type === 'openPromptFile') {
                        await this.openPromptFileInEditor(message.installPath, message.filePath);
                    } else if (message.type === 'toggleAutoUpdate') {
                        await this.handleToggleAutoUpdate(message.bundleId, message.enabled);
                        // Update the panel with new status
                        if (installed) {
                            const newStatus = await this.registryManager.autoUpdateService?.isAutoUpdateEnabled(installed.bundleId) || false;
                            panel.webview.postMessage({ type: 'autoUpdateStatusChanged', enabled: newStatus });
                        }
                    } else if (message.type === 'feedback' || message.type === 'submitFeedback' || message.type === 'quickFeedback') {
                        // Execute the unified feedback command with bundle info
                        // Get source info for issue redirect and hub routing
                        const sources = await this.registryManager.listSources();
                        const source = sources.find(s => s.id === bundle.sourceId);
                        
                        await vscode.commands.executeCommand('promptRegistry.feedback', {
                            resourceId: message.bundleId,
                            resourceType: 'bundle',
                            name: bundle.name,
                            version: bundle.version,
                            sourceUrl: source?.url || '',
                            sourceType: source?.type || '',
                            hubId: source?.hubId || ''
                        });
                    }
                },
                undefined,
                this.context.subscriptions
            );

            // Listen to auto-update preference changes from other UI components (e.g., tree view context menu)
            this.disposables.push(
                this.registryManager.onAutoUpdatePreferenceChanged((event) => {
                    // Update the webview if this event is for the bundle being displayed
                    if (event.bundleId === bundleId || (installed && event.bundleId === installed.bundleId)) {
                        panel.webview.postMessage({ type: 'autoUpdateStatusChanged', enabled: event.enabled });
                    }
                })
            );

        } catch (error) {
            this.logger.error('Failed to open bundle details', error as Error);
            vscode.window.showErrorMessage('Failed to open bundle details');
        }
    }

    /**
     * Get HTML for bundle details panel
     */
    private getBundleDetailsHtml(
        webview: vscode.Webview,
        bundle: Bundle, 
        installed: InstalledBundle | undefined, 
        breakdown: ContentBreakdown, 
        autoUpdateEnabled: boolean = false,
        rating?: { starRating: number; voteCount: number; confidence: string } | null,
        ratingDisplay?: { text: string; tooltip: string } | null
    ): string {
        const isInstalled = !!installed;
        const installPath = installed?.installPath || 'Not installed';
        const escapedInstallPath = installPath.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        const nonce = this.getNonce();
        const bundleId = installed?.bundleId || bundle.id;

        // Get URIs for external resources
        const cssUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview', 'bundleDetails', 'bundleDetails.css')
        );
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview', 'bundleDetails', 'bundleDetails.js')
        );

        // Generate CSP
        const cspSource = `default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' 'unsafe-inline';`;

        // Load HTML template
        const htmlPath = vscode.Uri.joinPath(
            this.context.extensionUri,
            'dist',
            'webview',
            'bundleDetails',
            'bundleDetails.html'
        );
        let html = fs.readFileSync(htmlPath.fsPath, 'utf8');

        // Generate dynamic sections
        const installedBadge = isInstalled ? '<span class="badge">✓ Installed</span>' : '';
        
        const autoUpdateSection = isInstalled ? `
    <div class="auto-update-toggle">
        <div style="flex: 1;">
            <div class="auto-update-label">🔄 Auto-Update</div>
            <div class="auto-update-description">Automatically install updates when available</div>
        </div>
        <div class="toggle-switch ${autoUpdateEnabled ? 'enabled' : ''}" id="autoUpdateToggle" data-action="toggleAutoUpdate">
            <div class="toggle-slider"></div>
        </div>
    </div>` : '';

        const ratingDisplayHtml = rating ? `
            <span class="rating-stars">${'★'.repeat(Math.round(rating.starRating))}${'☆'.repeat(5 - Math.round(rating.starRating))}</span>
            <span class="rating-score">${rating.starRating.toFixed(1)}</span>
            <span class="rating-meta">${rating.voteCount} votes (${rating.confidence} confidence)</span>
        ` : `<span class="no-rating">No ratings yet</span>`;

        const breakdownContent = isInstalled ? `
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
                <div class="breakdown-icon">🤖</div>
                <div class="breakdown-count">${breakdown.agents}</div>
                <div class="breakdown-label">Agents</div>
            </div>
            <div class="breakdown-item">
                <div class="breakdown-icon">🛠️</div>
                <div class="breakdown-count">${breakdown.skills}</div>
                <div class="breakdown-label">Skills</div>
            </div>
            <div class="breakdown-item">
                <div class="breakdown-icon">🔌</div>
                <div class="breakdown-count">${breakdown.mcpServers}</div>
                <div class="breakdown-label">MCP Servers</div>
            </div>
        </div>` : `
        <div class="info-message">
            <p style="text-align: center; padding: 20px; color: var(--vscode-descriptionForeground);">
                📦 Install this bundle to see the detailed content breakdown.
            </p>
        </div>`;

        const installedInfoRows = isInstalled ? `
            <div class="info-row">
                <div class="info-label">Installed At:</div>
                <div class="info-value">${new Date(installed!.installedAt).toLocaleString()}</div>
            </div>
            <div class="info-row">
                <div class="info-label">Install Path:</div>
                <div class="info-value"><code>${installPath}</code></div>
            </div>` : '';

        const tagsSection = bundle.tags && bundle.tags.length > 0 ? `
    <div class="section">
        <h2>🏷️ Tags</h2>
        <div class="tags">
            ${bundle.tags.map(tag => `<span class="tag">${tag}</span>`).join('')}
        </div>
    </div>` : '';

        const mcpServersSection = this.generateMcpServersSection(installed);
        const promptsSection = this.generatePromptsSection(installed, escapedInstallPath);

        // Replace all placeholders
        html = html
            .replace('{{cspSource}}', cspSource)
            .replace('{{bundleName}}', this.escapeHtml(bundle.name))
            .replace('{{bundleName}}', this.escapeHtml(bundle.name))
            .replace('{{cssUri}}', cssUri.toString())
            .replace('{{installedBadge}}', installedBadge)
            .replace('{{author}}', this.escapeHtml(bundle.author || 'Unknown'))
            .replace('{{author}}', this.escapeHtml(bundle.author || 'Unknown'))
            .replace('{{version}}', bundle.version)
            .replace('{{autoUpdateSection}}', autoUpdateSection)
            .replace('{{ratingDisplay}}', ratingDisplayHtml)
            .replace('{{description}}', bundle.description || 'No description available')
            .replace('{{breakdownContent}}', breakdownContent)
            .replace('{{displayBundleId}}', isInstalled ? installed!.bundleId : bundle.id)
            .replace('{{displayVersion}}', isInstalled ? installed!.version : bundle.version)
            .replace('{{installedInfoRows}}', installedInfoRows)
            .replace('{{environments}}', (bundle.environments || ['any']).join(', '))
            .replace('{{tagsSection}}', tagsSection)
            .replace('{{mcpServersSection}}', mcpServersSection)
            .replace('{{promptsSection}}', promptsSection)
            .replace('{{autoUpdateEnabled}}', String(autoUpdateEnabled))
            .replace('{{bundleId}}', bundleId)
            .replace(/\{\{nonce\}\}/g, nonce)
            .replace('{{scriptUri}}', scriptUri.toString());

        return html;
    }

    /**
     * Generate MCP servers section HTML
     */
    private generateMcpServersSection(installed: InstalledBundle | undefined): string {
        if (!installed?.manifest?.mcpServers || Object.keys(installed.manifest.mcpServers).length === 0) {
            return '';
        }

        const serverCount = Object.keys(installed.manifest.mcpServers).length;
        const serversHtml = Object.entries(installed.manifest.mcpServers).map(([serverName, config]) => {
            const isRemote = isRemoteServerConfig(config);
            const isStdio = isStdioServerConfig(config);
            
            let serverContent = '';
            if (isStdio) {
                const stdioConfig = config as McpStdioServerConfig;
                serverContent = `
                    <div class="mcp-server-command">
                        <strong>Command:</strong> ${this.escapeHtml(stdioConfig.command)}
                        ${stdioConfig.args && stdioConfig.args.length > 0 ? ` ${stdioConfig.args.map(a => this.escapeHtml(a)).join(' ')}` : ''}
                    </div>
                    ${stdioConfig.env && Object.keys(stdioConfig.env).length > 0 ? `
                    <div class="mcp-env-vars">
                        <strong style="font-size: 12px;">Environment Variables:</strong>
                        ${Object.entries(stdioConfig.env).map(([key, value]) => `
                            <div class="mcp-env-var">• <code>${this.escapeHtml(key)}</code> = <code>${this.escapeHtml(String(value))}</code></div>
                        `).join('')}
                    </div>` : ''}`;
            } else if (isRemote) {
                const remoteConfig = config as McpRemoteServerConfig;
                serverContent = `
                    <div class="mcp-server-command">
                        <strong>Type:</strong> ${this.escapeHtml((remoteConfig.type || 'http').toUpperCase())}
                    </div>
                    <div class="mcp-server-command">
                        <strong>URL:</strong> <code>${this.escapeHtml(remoteConfig.url)}</code>
                    </div>
                    ${remoteConfig.headers && Object.keys(remoteConfig.headers).length > 0 ? `
                    <div class="mcp-env-vars">
                        <strong style="font-size: 12px;">Headers:</strong>
                        ${Object.entries(remoteConfig.headers).map(([key, value]) => `
                            <div class="mcp-env-var">• <code>${this.escapeHtml(key)}</code>: <code>${this.escapeHtml(String(value).substring(0, 20))}${String(value).length > 20 ? '...' : ''}</code></div>
                        `).join('')}
                    </div>` : ''}`;
            }

            return `
            <div class="mcp-server-card">
                <div class="mcp-server-header">
                    <span>${isRemote ? '🌐' : '⚡'} ${this.escapeHtml(serverName)}</span>
                    ${config.disabled ? '<span class="mcp-status-badge mcp-status-disabled">Disabled</span>' : '<span class="mcp-status-badge mcp-status-enabled">Enabled</span>'}
                </div>
                ${config.description ? `<div style="color: var(--vscode-descriptionForeground); font-size: 12px; margin-bottom: 8px;">${this.escapeHtml(config.description)}</div>` : ''}
                ${serverContent}
            </div>`;
        }).join('');

        return `
    <div class="section">
        <h2>🔌 MCP Servers</h2>
        <p style="color: var(--vscode-descriptionForeground); margin-bottom: 16px; font-size: 13px;">
            This bundle includes ${serverCount} Model Context Protocol server${serverCount > 1 ? 's' : ''} that will be automatically integrated with VS Code.
        </p>
        ${serversHtml}
    </div>`;
    }

    /**
     * Generate prompts section HTML
     */
    private generatePromptsSection(installed: InstalledBundle | undefined, escapedInstallPath: string): string {
        if (!installed?.manifest?.prompts) {
            return '';
        }

        const promptsHtml = installed.manifest.prompts.map(p => `
            <div class="info-row prompt-item" data-action="openPromptFile" data-install-path="${escapedInstallPath}" data-file-path="${p.file}" style="cursor: pointer;">
                <div class="info-label">${p.id}:</div>
                <div class="info-value">
                    ${p.name} 
                    <em style="color: var(--vscode-descriptionForeground);">(${p.type || 'prompt'})</em>
                    <span style="color: var(--vscode-textLink-foreground); margin-left: 8px;">📄 Open</span>
                </div>
            </div>
        `).join('');

        return `
    <div class="section">
        <h2>📝 Included Prompts</h2>
        <div class="info-grid">
            ${promptsHtml}
        </div>
    </div>`;
    }

    /**
     * Get HTML content for marketplace webview
     */
    private getHtmlContent(webview: vscode.Webview): string {
        // Get URIs for external resources
        const cssUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview', 'marketplace', 'marketplace.css')
        );
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview', 'marketplace', 'marketplace.js')
        );

        // Generate nonce for CSP
        const nonce = this.getNonce();

        // Generate CSP
        const cspSource = `default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';`;

        // Load HTML template from external file
        const htmlPath = vscode.Uri.joinPath(
            this.context.extensionUri,
            'dist',
            'webview',
            'marketplace',
            'marketplace.html'
        );
        let htmlTemplate = fs.readFileSync(htmlPath.fsPath, 'utf8');

        // Replace placeholders with actual values
        htmlTemplate = htmlTemplate
            .replace('{{cssUri}}', cssUri.toString())
            .replace('{{cspSource}}', cspSource)
            .replace('{{nonce}}', nonce)
            .replace('{{scriptUri}}', scriptUri.toString());

        return htmlTemplate;
    }

    /**
     * Generate a nonce for Content Security Policy
     */
    private getNonce(): string {
        let text = '';
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (let i = 0; i < 32; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }
}

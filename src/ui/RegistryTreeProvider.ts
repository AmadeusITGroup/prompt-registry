/**
 * Tree View Provider for Prompt Registry Explorer
 * Displays sources, profiles, bundles, and discovery options in sidebar
 */

import * as vscode from 'vscode';
import { RegistryManager } from '../services/RegistryManager';
import { HubManager } from '../services/HubManager';
import { RegistrySource, Profile, Bundle, InstalledBundle } from '../types/registry';
import { Logger } from '../utils/logger';

/**
 * Tree item types
 */
export enum TreeItemType {
    // Root sections
    PROFILES_ROOT = 'profiles_root',
    INSTALLED_ROOT = 'installed_root',
    DISCOVER_ROOT = 'discover_root',
    SOURCES_ROOT = 'sources_root',

    // Hub items
    HUBS_ROOT = 'hubs_root',
    HUB = 'hub',
    IMPORT_HUB = 'import_hub',

    // Profile items
    PROFILE = 'profile',
    PROFILE_BUNDLE = 'profile_bundle',
    CREATE_PROFILE = 'create_profile',

    // Installed items
    INSTALLED_BUNDLE = 'installed_bundle',

    // Discover items
    DISCOVER_CATEGORY = 'discover_category',
    DISCOVER_POPULAR = 'discover_popular',
    DISCOVER_RECENT = 'discover_recent',
    DISCOVER_TRENDING = 'discover_trending',

    // Source items
    SOURCE = 'source',
    ADD_SOURCE = 'add_source',

    // Bundle items
    BUNDLE = 'bundle',
}

/**
 * Registry tree item
 */
export class RegistryTreeItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly type: TreeItemType,
        public readonly data?: any,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.None
    ) {
        super(label, collapsibleState);
        
        this.contextValue = type;
        this.iconPath = this.getIcon();
        this.tooltip = this.getTooltip();
        this.description = this.getDescription();
        
        // Set command for clickable items
        if (this.isClickable()) {
            this.command = {
                command: this.getCommand(),
                title: `View ${label}`,
                arguments: [this],
            };
        }
    }

    /**
     * Get icon for tree item
     */
    private getIcon(): vscode.ThemeIcon | undefined {
        const iconMap: { [key in TreeItemType]?: string } = {
            [TreeItemType.PROFILES_ROOT]: 'home',
            [TreeItemType.PROFILE]: 'symbol-misc',
            [TreeItemType.CREATE_PROFILE]: 'add',
            
            [TreeItemType.INSTALLED_ROOT]: 'package',
            [TreeItemType.INSTALLED_BUNDLE]: 'check',
            
            [TreeItemType.DISCOVER_ROOT]: 'search',
            [TreeItemType.DISCOVER_CATEGORY]: 'tag',
            [TreeItemType.DISCOVER_POPULAR]: 'star',
            [TreeItemType.DISCOVER_RECENT]: 'clock',
            [TreeItemType.DISCOVER_TRENDING]: 'flame',
            
            [TreeItemType.SOURCES_ROOT]: 'radio-tower',
            [TreeItemType.SOURCE]: 'repo',
            [TreeItemType.ADD_SOURCE]: 'add',
            [TreeItemType.HUBS_ROOT]: 'server',
            [TreeItemType.HUB]: 'server-process',
            [TreeItemType.IMPORT_HUB]: 'cloud-download',
            
            [TreeItemType.BUNDLE]: 'file-zip',
        };

        const iconId = iconMap[this.type];
        return iconId ? new vscode.ThemeIcon(iconId) : undefined;
    }

    /**
     * Get tooltip text
     */
    private getTooltip(): string {
        switch (this.type) {
            case TreeItemType.PROFILE: {
                const profile = this.data as Profile;
                return `${profile.description}\n${profile.bundles.length} bundles`;
            }
            
            case TreeItemType.INSTALLED_BUNDLE: {
                const installed = this.data as InstalledBundle;
                return `Version ${installed.version}\nInstalled: ${new Date(installed.installedAt).toLocaleDateString()}`;
            }
            
            case TreeItemType.SOURCE: {
                const source = this.data as RegistrySource;
                return `${source.url}\n${source.enabled ? 'Enabled' : 'Disabled'}`;
            }
            
            case TreeItemType.BUNDLE: {
                const bundle = this.data as Bundle;
                return `${bundle.description}\nVersion: ${bundle.version}`;
            }
            
            default:
                return this.label;
        }
    }

    /**
     * Get description text (shown right-aligned)
     */
    private getDescription(): string | undefined {
        switch (this.type) {
            case TreeItemType.PROFILE: {
                const profile = this.data as Profile;
                return profile.active ? '[Active]' : '';
            }
            
            case TreeItemType.INSTALLED_BUNDLE: {
                const installed = this.data as InstalledBundle;
                return `v${installed.version}`;
            }
            
            case TreeItemType.SOURCE: {
                const source = this.data as RegistrySource;
                return `priority: ${source.priority}`;
            }
            
            case TreeItemType.BUNDLE: {
                const bundle = this.data as Bundle;
                return bundle.version;
            }
            
            default:
                return undefined;
        }
    }

    /**
     * Check if item is clickable
     */
    private isClickable(): boolean {
        return [
            TreeItemType.BUNDLE,
            TreeItemType.INSTALLED_BUNDLE,
            TreeItemType.PROFILE,
            TreeItemType.SOURCE,
            TreeItemType.HUB,
            TreeItemType.CREATE_PROFILE,
            TreeItemType.ADD_SOURCE,
            TreeItemType.IMPORT_HUB,
            TreeItemType.DISCOVER_CATEGORY,
            TreeItemType.DISCOVER_POPULAR,
            TreeItemType.DISCOVER_RECENT,
            TreeItemType.DISCOVER_TRENDING,
            TreeItemType.INSTALLED_ROOT,
        ].includes(this.type);
    }

    /**
     * Get command for item
     */
    private getCommand(): string {
        switch (this.type) {
            case TreeItemType.BUNDLE:
                return 'promptRegistry.viewBundle';
            case TreeItemType.INSTALLED_BUNDLE:
                return 'promptRegistry.viewBundle';
            case TreeItemType.PROFILE:
                return 'promptRegistry.listProfiles';
            case TreeItemType.SOURCE:
                return 'promptRegistry.listSources';
            case TreeItemType.CREATE_PROFILE:
                return 'promptRegistry.createProfile';
            case TreeItemType.ADD_SOURCE:
                return 'promptRegistry.addSource';
            case TreeItemType.IMPORT_HUB:
                return 'promptregistry.importHub';
            case TreeItemType.HUB:
                return 'promptregistry.listHubs';
            case TreeItemType.DISCOVER_CATEGORY:
                return 'promptRegistry.browseByCategory';
            case TreeItemType.DISCOVER_POPULAR:
                return 'promptRegistry.showPopular';
            case TreeItemType.DISCOVER_RECENT:
                return 'promptRegistry.searchBundles';
            case TreeItemType.DISCOVER_TRENDING:
                return 'promptRegistry.showPopular';
            case TreeItemType.INSTALLED_ROOT:
                return 'promptRegistry.listInstalled';
            default:
                return '';
        }
    }
}

/**
 * Registry Tree Data Provider
 */
export class RegistryTreeProvider implements vscode.TreeDataProvider<RegistryTreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<RegistryTreeItem | undefined | null>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private logger: Logger;

    constructor(
        private registryManager: RegistryManager,
        private hubManager: HubManager
    ) {
        this.logger = Logger.getInstance();
        
        // Listen to registry events and refresh tree
        registryManager.onBundleInstalled(() => this.refresh());
        registryManager.onBundleUninstalled(() => this.refresh());
        registryManager.onBundleUpdated(() => this.refresh());
        registryManager.onProfileActivated(() => this.refresh());
        registryManager.onProfileCreated(() => this.refresh());
        registryManager.onProfileUpdated(() => this.refresh());
        registryManager.onProfileDeleted(() => this.refresh());
        registryManager.onSourceAdded(() => this.refresh());
        
        // Listen to hub events
        hubManager.onHubImported(() => this.refresh());
        hubManager.onHubDeleted(() => this.refresh());
        hubManager.onHubSynced(() => this.refresh());
        registryManager.onSourceRemoved(() => this.refresh());
    }

    /**
     * Refresh tree view
     */
    refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }

    /**
     * Get tree item
     */
    getTreeItem(element: RegistryTreeItem): vscode.TreeItem {
        return element;
    }

    /**
     * Get children for tree item
     */
    async getChildren(element?: RegistryTreeItem): Promise<RegistryTreeItem[]> {
        if (!element) {
            // Root level items
            return this.getRootItems();
        }

        // Get children based on parent type
        switch (element.type) {
            case TreeItemType.HUBS_ROOT:
                return this.getHubItems();
 
            case TreeItemType.PROFILES_ROOT:
                return this.getProfileItems();
            
            case TreeItemType.PROFILE:
                return this.getProfileBundleItems(element.data as Profile);
            
            case TreeItemType.INSTALLED_ROOT:
                return this.getInstalledBundleItems();
            
            case TreeItemType.DISCOVER_ROOT:
                return this.getDiscoverItems();
            
            case TreeItemType.DISCOVER_CATEGORY:
                return this.getCategoryBundles(element.label);
            
            case TreeItemType.SOURCES_ROOT:
                return this.getSourceItems();
                       
            default:
                return [];
        }
    }

    /**
     * Get root level items
     */
    private getRootItems(): RegistryTreeItem[] {
        return [
            new RegistryTreeItem(
                '🏠 My Profiles',
                TreeItemType.PROFILES_ROOT,
                undefined,
                vscode.TreeItemCollapsibleState.Expanded
            ),
            new RegistryTreeItem(
                '📚 Installed Bundles',
                TreeItemType.INSTALLED_ROOT,
                undefined,
                vscode.TreeItemCollapsibleState.Expanded
            ),
            // new RegistryTreeItem(
            //     '🔍 Discover',
            //     TreeItemType.DISCOVER_ROOT,
            //     undefined,
            //     vscode.TreeItemCollapsibleState.Collapsed
            // ),
            new RegistryTreeItem(
                '📡 Sources',
                TreeItemType.SOURCES_ROOT,
                undefined,
                vscode.TreeItemCollapsibleState.Collapsed
            ),
            new RegistryTreeItem(
                '🌐 Hubs',
                TreeItemType.HUBS_ROOT,
                undefined,
                vscode.TreeItemCollapsibleState.Collapsed
            ),
        ];
    }

    /**
     * Get profile items
     */
    private async getProfileItems(): Promise<RegistryTreeItem[]> {
        try {
            const profiles = await this.registryManager.listProfiles();
            const items: RegistryTreeItem[] = [];

            for (const profile of profiles) {
                const icon = profile.icon || '📦';
                const treeItem = new RegistryTreeItem(
                    `${icon} ${profile.name}`,
                    TreeItemType.PROFILE,
                    profile,
                    vscode.TreeItemCollapsibleState.Collapsed
                );
                
                // Set contextValue based on active state
                if (profile.active) {
                    treeItem.contextValue = 'profile-active';
                }
                
                items.push(treeItem);
            }

            // Add "Create New Profile" item
            items.push(
                new RegistryTreeItem(
                    '➕ Create New Profile...',
                    TreeItemType.CREATE_PROFILE,
                    undefined,
                    vscode.TreeItemCollapsibleState.None
                )
            );

            return items;
        } catch (error) {
            this.logger.error('Failed to load profiles', error as Error);
            return [];
        }
    }

    /**
     * Get bundles for a profile
     */
    private async getProfileBundleItems(profile: Profile): Promise<RegistryTreeItem[]> {
        const items: RegistryTreeItem[] = [];

        for (const profileBundle of profile.bundles) {
            try {
                const bundle = await this.registryManager.getBundleDetails(profileBundle.id);
                const status = profileBundle.required ? '✓' : '○';
                
                items.push(
                    new RegistryTreeItem(
                        `${status} ${bundle.name}`,
                        TreeItemType.PROFILE_BUNDLE,
                        { profile, bundle, profileBundle },
                        vscode.TreeItemCollapsibleState.None
                    )
                );
            } catch (error) {
                // Bundle not found
                items.push(
                    new RegistryTreeItem(
                        `⚠️  ${profileBundle.id} (not found)`,
                        TreeItemType.PROFILE_BUNDLE,
                        profileBundle,
                        vscode.TreeItemCollapsibleState.None
                    )
                );
            }
        }

        return items;
    }

    /**
     * Get installed bundle items
     */
    private async getInstalledBundleItems(): Promise<RegistryTreeItem[]> {
        try {
            const installed = await this.registryManager.listInstalledBundles();
            const items: RegistryTreeItem[] = [];

            for (const bundle of installed) {
                try {
                    const details = await this.registryManager.getBundleDetails(bundle.bundleId);
                    
                    // Check if update available
                    const hasUpdate = details.version !== bundle.version;
                    const prefix = hasUpdate ? '⚠️ ' : '✓';
                    
                    items.push(
                        new RegistryTreeItem(
                            `${prefix} ${details.name}`,
                            TreeItemType.INSTALLED_BUNDLE,
                            bundle,
                            vscode.TreeItemCollapsibleState.None
                        )
                    );
                } catch (error) {
                    // Bundle details not available
                    items.push(
                        new RegistryTreeItem(
                            `✓ ${bundle.bundleId}`,
                            TreeItemType.INSTALLED_BUNDLE,
                            bundle,
                            vscode.TreeItemCollapsibleState.None
                        )
                    );
                }
            }

            // Show count in root item
            return items;
        } catch (error) {
            this.logger.error('Failed to load installed bundles', error as Error);
            return [];
        }
    }

    /**
     * Get discover section items
     */
    private getDiscoverItems(): RegistryTreeItem[] {
        return [
            new RegistryTreeItem(
                '🏷️  By Category',
                TreeItemType.DISCOVER_CATEGORY,
                undefined,
                vscode.TreeItemCollapsibleState.Collapsed
            ),
            new RegistryTreeItem(
                '⭐ Popular',
                TreeItemType.DISCOVER_POPULAR,
                undefined,
                vscode.TreeItemCollapsibleState.Collapsed
            ),
            new RegistryTreeItem(
                '🆕 Recently Added',
                TreeItemType.DISCOVER_RECENT,
                undefined,
                vscode.TreeItemCollapsibleState.Collapsed
            ),
            new RegistryTreeItem(
                '🔥 Trending',
                TreeItemType.DISCOVER_TRENDING,
                undefined,
                vscode.TreeItemCollapsibleState.Collapsed
            ),
        ];
    }

    /**
     * Get bundles by category
     */
    private async getCategoryBundles(category: string): Promise<RegistryTreeItem[]> {
        // TODO: Implement category filtering
        // For now, return empty
        return [];
    }

    /**
     * Get source items
     */
    private async getSourceItems(): Promise<RegistryTreeItem[]> {
        try {
            const sources = await this.registryManager.listSources();
            const items: RegistryTreeItem[] = [];

            for (const source of sources) {
                const status = source.enabled ? '✓' : '○';
                
                items.push(
                    new RegistryTreeItem(
                        `${status} ${source.name}`,
                        TreeItemType.SOURCE,
                        source,
                        vscode.TreeItemCollapsibleState.None
                    )
                );
            }

            // Add "Add Source" item
            items.push(
                new RegistryTreeItem(
                    '➕ Add Source...',
                    TreeItemType.ADD_SOURCE,
                    undefined,
                    vscode.TreeItemCollapsibleState.None
                )
            );

            return items;
        } catch (error) {
            this.logger.error('Failed to load sources', error as Error);
            return [];
        }
    }

    /**
     * Get hub items for tree view
     */
    private async getHubItems(): Promise<RegistryTreeItem[]> {
        try {
            const items: RegistryTreeItem[] = [];
            
            // Get all hubs
            const hubs = await this.hubManager.listHubs();
            
            for (const hub of hubs) {
                items.push(
                    new RegistryTreeItem(
                        hub.name,
                        TreeItemType.HUB,
                        hub,
                        vscode.TreeItemCollapsibleState.None
                    )
                );
            }
            
            // Add "Import Hub" item
            items.push(
                new RegistryTreeItem(
                    '➕ Import Hub...',
                    TreeItemType.IMPORT_HUB,
                    undefined,
                    vscode.TreeItemCollapsibleState.None
                )
            );
            
            return items;
        } catch (error) {
            this.logger.error('Failed to load hubs', error as Error);
            return [];
        }
    }

}

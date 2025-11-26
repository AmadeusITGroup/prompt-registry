/**
 * Main Registry Manager
 * Orchestrates all registry operations including sources, bundles, profiles, and installations
 */

import * as vscode from 'vscode';
import { RegistryStorage } from '../storage/RegistryStorage';
import { RepositoryAdapterFactory, IRepositoryAdapter } from '../adapters/RepositoryAdapter';
import { GitHubAdapter } from '../adapters/GitHubAdapter';
import { GitLabAdapter } from '../adapters/GitLabAdapter';
import { HttpAdapter } from '../adapters/HttpAdapter';
import { LocalAdapter } from '../adapters/LocalAdapter';
import { AwesomeCopilotAdapter } from '../adapters/AwesomeCopilotAdapter';
import { BundleInstaller } from './BundleInstaller';
import { LocalAwesomeCopilotAdapter } from '../adapters/LocalAwesomeCopilotAdapter';
import {
    RegistrySource,
    Bundle,
    Profile,
    InstalledBundle,
    SearchQuery,
    InstallOptions,
    ValidationResult,
    BundleUpdate,
    ProfileBundle,
} from '../types/registry';
import { ExportedSettings, ExportFormat, ImportStrategy } from '../types/settings';
import { Logger } from '../utils/logger';

/**
 * Registry Manager
 * Main entry point for all registry operations
 */
export class RegistryManager {
    private static instance: RegistryManager;
    private storage: RegistryStorage;
    private installer: BundleInstaller;
    private logger: Logger;
    private adapters = new Map<string, IRepositoryAdapter>();

    // Event emitters
    private _onBundleInstalled = new vscode.EventEmitter<InstalledBundle>();
    private _onBundleUninstalled = new vscode.EventEmitter<string>();
    private _onBundleUpdated = new vscode.EventEmitter<InstalledBundle>();
    private _onProfileActivated = new vscode.EventEmitter<Profile>();
    private _onProfileCreated = new vscode.EventEmitter<Profile>();
    private _onProfileUpdated = new vscode.EventEmitter<Profile>();
    private _onProfileDeleted = new vscode.EventEmitter<string>();
    private _onSourceAdded = new vscode.EventEmitter<RegistrySource>();
    private _onSourceRemoved = new vscode.EventEmitter<string>();
    private _onSourceUpdated = new vscode.EventEmitter<string>();


    // Public event accessors
    readonly onBundleInstalled = this._onBundleInstalled.event;
    readonly onBundleUninstalled = this._onBundleUninstalled.event;
    readonly onBundleUpdated = this._onBundleUpdated.event;
    readonly onProfileActivated = this._onProfileActivated.event;
    readonly onProfileCreated = this._onProfileCreated.event;
    readonly onProfileUpdated = this._onProfileUpdated.event;
    readonly onProfileDeleted = this._onProfileDeleted.event;
    readonly onSourceAdded = this._onSourceAdded.event;
    readonly onSourceRemoved = this._onSourceRemoved.event;
    readonly onSourceUpdated = this._onSourceUpdated.event;

    private constructor(private context: vscode.ExtensionContext) {
        this.storage = new RegistryStorage(context);
        this.installer = new BundleInstaller(context);
        this.logger = Logger.getInstance();
        
        // Register default adapters
        RepositoryAdapterFactory.register('github', GitHubAdapter);
        RepositoryAdapterFactory.register('gitlab', GitLabAdapter);
        RepositoryAdapterFactory.register('http', HttpAdapter);
        RepositoryAdapterFactory.register('local', LocalAdapter);
        RepositoryAdapterFactory.register('awesome-copilot', AwesomeCopilotAdapter);
        RepositoryAdapterFactory.register('local-awesome-copilot', LocalAwesomeCopilotAdapter);
    }

    /**
     * Get singleton instance
     */
    static getInstance(context?: vscode.ExtensionContext): RegistryManager {
        if (!RegistryManager.instance && context) {
            RegistryManager.instance = new RegistryManager(context);
        }
        if (!RegistryManager.instance) {
            throw new Error('RegistryManager not initialized. Provide context on first call.');
        }
        return RegistryManager.instance;
    }

    /**
     * Initialize the registry
     */
    async initialize(): Promise<void> {
        this.logger.info('Initializing Prompt Registry...');
        await this.storage.initialize();
        await this.loadAdapters();
        this.logger.info('Prompt Registry initialized successfully');
    }

    /**
     * Load adapters for all sources
     */
    private async loadAdapters(): Promise<void> {
        const sources = await this.storage.getSources();
        
        for (const source of sources) {
            if (source.enabled) {
                try {
                    const adapter = RepositoryAdapterFactory.create(source);
                    this.adapters.set(source.id, adapter);
                } catch (error) {
                    this.logger.error(`Failed to create adapter for source '${source.id}'`, error as Error);
                }
            }
        }
    }

    /**
     * Get or create adapter for a source
     */
    private getAdapter(source: RegistrySource): IRepositoryAdapter {
        let adapter = this.adapters.get(source.id);
        
        if (!adapter) {
            adapter = RepositoryAdapterFactory.create(source);
            this.adapters.set(source.id, adapter);
        }
        
        return adapter;
    }

    // ===== Source Management =====

    /**
     * Add a new registry source
     */
    async addSource(source: RegistrySource): Promise<void> {
        this.logger.info(`Adding source: ${source.name}`);
        
        // Validate source
        const adapter = RepositoryAdapterFactory.create(source);
        const validation = await adapter.validate();
        
        if (!validation.valid) {
            throw new Error(`Source validation failed: ${validation.errors.join(', ')}`);
        }

        await this.storage.addSource(source);
        this.adapters.set(source.id, adapter);
        
        this._onSourceAdded.fire(source);
        this.logger.info(`Source '${source.name}' added successfully`);
    }

    /**
     * Remove a source
     */
    async removeSource(sourceId: string): Promise<void> {
        this.logger.info(`Removing source: ${sourceId}`);
        
        await this.storage.removeSource(sourceId);
        this.adapters.delete(sourceId);
        
        this._onSourceRemoved.fire(sourceId);
        this.logger.info(`Source '${sourceId}' removed successfully`);
    }

    /**
     * Update a source
     */
    async updateSource(sourceId: string, updates: Partial<RegistrySource>): Promise<void> {
        this.logger.info(`Updating source: ${sourceId}`);
        
        await this.storage.updateSource(sourceId, updates);
        
        // Reload adapter if source was updated
        this.adapters.delete(sourceId);
        const sources = await this.storage.getSources();
        const updatedSource = sources.find(s => s.id === sourceId);
        
        if (updatedSource && updatedSource.enabled) {
            const adapter = RepositoryAdapterFactory.create(updatedSource);
            this.adapters.set(sourceId, adapter);
        }

        this._onSourceUpdated.fire(sourceId);
        this.logger.info(`Source '${sourceId}' updated successfully`);
    }

    /**
     * List all sources
     */
    async listSources(): Promise<RegistrySource[]> {
        return await this.storage.getSources();
    }

    /**
     * Sync a source (refresh bundle list)
     */
    async syncSource(sourceId: string): Promise<void> {
        this.logger.info(`Syncing source: ${sourceId}`);
        
        const sources = await this.storage.getSources();
        const source = sources.find(s => s.id === sourceId);
        
        if (!source) {
            throw new Error(`Source '${sourceId}' not found`);
        }

        const adapter = this.getAdapter(source);
        const bundles = await adapter.fetchBundles();
        
        // Cache bundles
        await this.storage.cacheSourceBundles(sourceId, bundles);
        
        this.logger.info(`Source '${sourceId}' synced. Found ${bundles.length} bundles.`);
    }

    /**
     * Validate a source
     */
    async validateSource(source: RegistrySource): Promise<ValidationResult> {
        const adapter = RepositoryAdapterFactory.create(source);
        return await adapter.validate();
    }

    // ===== Bundle Management =====

    /**
     * Search for bundles
     */
    async searchBundles(query: SearchQuery): Promise<Bundle[]> {
        this.logger.info('Searching bundles', query);
        
        const sources = await this.storage.getSources();
        const allBundles: Bundle[] = [];

        // Filter sources if specified
        const sourcesToSearch = query.sourceId
            ? sources.filter(s => s.id === query.sourceId)
            : sources.filter(s => s.enabled);
        
        this.logger.info(`Searching in ${sourcesToSearch.length} sources`);

        for (const source of sourcesToSearch) {
            try {
                // Try cache first
                let bundles = await this.storage.getCachedSourceBundles(source.id);
                
                // If cache empty, fetch from source
                if (bundles.length === 0) {
                    const adapter = this.getAdapter(source);
                    bundles = await adapter.fetchBundles();
                    await this.storage.cacheSourceBundles(source.id, bundles);
                }
                
                allBundles.push(...bundles);
            } catch (error) {
                this.logger.error(`Failed to fetch bundles from source '${source.id}'`, error as Error);
            }
        }

        // Apply filters
        let results = allBundles;

        if (query.text) {
            const searchText = query.text.toLowerCase();
            results = results.filter(b =>
                b.id === query.text ||
                b.name.toLowerCase().includes(searchText) ||
                b.description.toLowerCase().includes(searchText)
            );
        }

        if (query.tags && query.tags.length > 0) {
            results = results.filter(b =>
                query.tags!.some(tag => b.tags.includes(tag))
            );
        }

        if (query.author) {
            results = results.filter(b => b.author === query.author);
        }

        if (query.environment) {
            results = results.filter(b => b.environments.includes(query.environment!));
        }

        // Sort results
        if (query.sortBy) {
            results = this.sortBundles(results, query.sortBy);
        }

        // Apply pagination
        if (query.offset !== undefined || query.limit !== undefined) {
            const offset = query.offset || 0;
            const limit = query.limit || 50;
            results = results.slice(offset, offset + limit);
        }

        return results;
    }

    /**
     * Get bundle details
     */
    async getBundleDetails(bundleId: string): Promise<Bundle> {
        // Try cache first
        const cached = await this.storage.getCachedBundleMetadata(bundleId);
        
        if (cached) {
            return cached;
        }

        // Search all sources
        const bundles = await this.searchBundles({});
        const bundle = bundles.find(b => b.id === bundleId);
        
        if (!bundle) {
            throw new Error(`Bundle '${bundleId}' not found`);
        }

        return bundle;
    }

    /**
     * Install a bundle
     */
    async installBundle(bundleId: string, options: InstallOptions): Promise<void> {
        this.logger.info(`Installing bundle: ${bundleId}`, options);
        
        // Get bundle details
        const bundle = await this.getBundleDetails(bundleId);
        
        // Check if already installed
        const existing = await this.storage.getInstalledBundle(bundleId, options.scope);
        
        if (existing && !options.force) {
            throw new Error(`Bundle '${bundleId}' is already installed. Use force=true to reinstall.`);
        }

        // Get download URL from adapter
        const sources = await this.storage.getSources();
        const source = sources.find(s => s.id === bundle.sourceId);
        
        if (!source) {
            throw new Error(`Source '${bundle.sourceId}' not found`);
        }

        const adapter = this.getAdapter(source);
        
        // For awesome-copilot and local-awesome-copilot, download the bundle directly from the adapter
        // For other adapters, use the downloadUrl
        let installation: InstalledBundle;
        if (source.type === 'awesome-copilot' || source.type === 'local-awesome-copilot') {
            this.logger.debug('Downloading bundle from awesome-copilot adapter');
            const bundleBuffer = await adapter.downloadBundle(bundle);
            this.logger.debug(`Bundle downloaded: ${bundleBuffer.length} bytes`);
            
            // Install from buffer
            installation = await this.installer.installFromBuffer(bundle, bundleBuffer, options);
        } else {
            const downloadUrl = adapter.getDownloadUrl(bundle.id, bundle.version);
            // Install bundle using BundleInstaller
            installation = await this.installer.install(bundle, downloadUrl, options);
        }
        
        // Add profileId if provided
        if (options.profileId) {
            installation.profileId = options.profileId;
        }
        
        // Record installation
        await this.storage.recordInstallation(installation);
        
        this._onBundleInstalled.fire(installation);
        this.logger.info(`Bundle '${bundleId}' installed successfully`);
    }

    /**
     * Uninstall a bundle
     */
    async uninstallBundle(bundleId: string, scope: 'user' | 'workspace' = 'user'): Promise<void> {
        this.logger.info(`Uninstalling bundle: ${bundleId}`);
        
        // Get installation record
        const installed = await this.storage.getInstalledBundle(bundleId, scope);
        
        if (!installed) {
            throw new Error(`Bundle '${bundleId}' is not installed in ${scope} scope`);
        }
        
        // Uninstall using BundleInstaller
        await this.installer.uninstall(installed);
        
        // Remove installation record
        await this.storage.removeInstallation(bundleId, scope);
        
        this._onBundleUninstalled.fire(bundleId);
        this.logger.info(`Bundle '${bundleId}' uninstalled successfully`);
    }

    /**
     * Update a bundle
     */
    async updateBundle(bundleId: string, version?: string): Promise<void> {
        this.logger.info(`Updating bundle: ${bundleId} to version: ${version || 'latest'}`);
        
        // Get current installation
        const allInstalled = await this.storage.getInstalledBundles();
        const current = allInstalled.find(b => b.bundleId === bundleId);
        
        if (!current) {
            throw new Error(`Bundle '${bundleId}' is not installed`);
        }

        // Get new bundle details
        const bundle = await this.getBundleDetails(bundleId);
        
        // Check if update is needed
        if (current.version === bundle.version) {
            this.logger.info(`Bundle '${bundleId}' is already at version ${bundle.version}`);
            return;
        }

        // Get download URL
        const sources = await this.storage.getSources();
        const source = sources.find(s => s.id === bundle.sourceId);
        
        if (!source) {
            throw new Error(`Source '${bundle.sourceId}' not found`);
        }

        const adapter = this.getAdapter(source);
        const downloadUrl = adapter.getDownloadUrl(bundle.id, bundle.version);
        
        // Update using BundleInstaller
        const updated = await this.installer.update(current, bundle, downloadUrl);
        
        // Update installation record
        await this.storage.removeInstallation(bundleId, current.scope);
        await this.storage.recordInstallation(updated);
        
        this._onBundleUpdated.fire(updated);
        this.logger.info(`Bundle '${bundleId}' updated from v${current.version} to v${bundle.version}`);
    }

    /**
     * List installed bundles
     */
    async listInstalledBundles(scope?: 'user' | 'workspace'): Promise<InstalledBundle[]> {
        return await this.storage.getInstalledBundles(scope);
    }

    /**
     * Check for bundle updates
     */
    async checkUpdates(): Promise<BundleUpdate[]> {
        this.logger.info('Checking for bundle updates');
        
        const installed = await this.storage.getInstalledBundles();
        const updates: BundleUpdate[] = [];

        for (const bundle of installed) {
            try {
                const latest = await this.getBundleDetails(bundle.bundleId);
                
                if (latest.version !== bundle.version) {
                    updates.push({
                        bundleId: bundle.bundleId,
                        currentVersion: bundle.version,
                        latestVersion: latest.version,
                    });
                }
            } catch (error) {
                this.logger.error(`Failed to check update for '${bundle.bundleId}'`, error as Error);
            }
        }

        this.logger.info(`Found ${updates.length} bundle updates`);
        return updates;
    }

    // ===== Profile Management =====

    /**
     * Create a profile
     */
    async createProfile(profile: Omit<Profile, 'createdAt' | 'updatedAt'>): Promise<Profile> {
        this.logger.info(`Creating profile: ${profile.name}`);
        
        const fullProfile: Profile = {
            ...profile,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        
        await this.storage.addProfile(fullProfile);
        this._onProfileCreated.fire(fullProfile);
        this.logger.info(`Profile '${profile.name}' created successfully`);
        
        return fullProfile;
    }

    /**
     * Update a profile
     */
    async updateProfile(profileId: string, updates: Partial<Profile>): Promise<void> {
        this.logger.info(`Updating profile: ${profileId}`);
        
        await this.storage.updateProfile(profileId, {
            ...updates,
            updatedAt: new Date().toISOString(),
        });
        
        // Get the updated profile and fire event
        const profiles = await this.storage.getProfiles();
        const updatedProfile = profiles.find(p => p.id === profileId);
        if (updatedProfile) {
            this._onProfileUpdated.fire(updatedProfile);
        }
        
        this.logger.info(`Profile '${profileId}' updated successfully`);
    }

    /**
     * Delete a profile
     */
    async deleteProfile(profileId: string): Promise<void> {
        this.logger.info(`Deleting profile: ${profileId}`);
        
        await this.storage.removeProfile(profileId);
        this._onProfileDeleted.fire(profileId);
        
        this.logger.info(`Profile '${profileId}' deleted successfully`);
    }

    /**
     * List all profiles
     */
    async listProfiles(): Promise<Profile[]> {
        return await this.storage.getProfiles();
    }

    /**
     * Activate a profile
     */
    async activateProfile(profileId: string): Promise<void> {
        return await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Activating Profile",
            cancellable: false
        }, async (progress) => {
            progress.report({ message: "Preparing..." });

            // Handle case where profile object is passed instead of ID
            if (typeof profileId !== 'string') {
                const profileObj = profileId as any;
                if (profileObj && typeof profileObj === 'object' && profileObj.id) {
                    this.logger.warn('Profile object passed to activateProfile, extracting ID');
                    profileId = profileObj.id;
                } else {
                    throw new Error(`Invalid profile identifier: expected string, got ${typeof profileId}`);
                }
            }
        
            this.logger.info(`Activating profile: ${profileId}`);
        
            const profiles = await this.storage.getProfiles();
            progress.report({ message: "Checking for active profiles..." });
        
            // Deactivate all active profiles and uninstall their bundles
            for (const profile of profiles) {
                if (profile.active && profile.id !== profileId) {
                    this.logger.info(`Deactivating previous profile: ${profile.id}`);
                    try {
                        await this.deactivateProfile(profile.id);
                    } catch (error) {
                        this.logger.error(`Failed to deactivate profile ${profile.id}`, error as Error);
                    }
                }
            }
        
            // Get all sources to find adapters
            const allSources = await this.storage.getSources();
        
            const profile = profiles.find(p => p.id === profileId);
            if (profile) {
                this._onProfileActivated.fire(profile);
            
                // Install bundles associated with this profile
                if (profile.bundles && profile.bundles.length > 0) {
                progress.report({ message: `Installing ${profile.bundles.length} bundle(s)...` });
                    this.logger.info(`Installing ${profile.bundles.length} bundles for profile '${profileId}'`);
                
                    for (const bundleRef of profile.bundles) {
                    progress.report({ message: `Installing ${bundleRef.id}...` });
                        try {
                            // Check if bundle is already installed
                            const installedBundles = await this.storage.getInstalledBundles();
                            const alreadyInstalled = installedBundles.find(b => b.bundleId === bundleRef.id);
                        
                            if (alreadyInstalled) {
                                this.logger.info(`Bundle ${bundleRef.id} already installed, skipping`);
                                continue;
                            }
                        
                            // Search for the bundle in sources
                            this.logger.info(`Searching for bundle: ${bundleRef.id} v${bundleRef.version}`);
                            const queryBySourceAndBundleId = { text: bundleRef.id, tags: [], sourceId: bundleRef.sourceId };
                            const searchResults = await this.searchBundles(queryBySourceAndBundleId);
                            this.logger.info(`Found ${searchResults.length} matching bundles.`,searchResults);
                        
                            // If sourceId is specified, prefer bundles from that source
                            const matchingBundle = searchResults.find(b => {
                                const idMatch = b.id === bundleRef.id || b.name.toLowerCase().includes(bundleRef.id.toLowerCase());
                                if (bundleRef.sourceId) {
                                    return idMatch && b.sourceId === bundleRef.sourceId;
                                }
                                return idMatch;
                            });
                        
                            if (!matchingBundle) {
                                this.logger.warn(`Bundle not found: ${bundleRef.id}`);
                                continue;
                            }
                        
                            const source = allSources.find(s => s.id === matchingBundle.sourceId);
                            if (!source) {
                                this.logger.warn(`Source not found for bundle: ${matchingBundle.sourceId}`);
                                continue;
                            }

                            const adapter = this.getAdapter(source);
                        
                            const options: InstallOptions = {
                                scope: 'user',
                                force: false,
                                profileId: profileId,
                            };

                            this.logger.info(`Installing bundle: ${matchingBundle.id} from source ${matchingBundle.sourceId}`);
                        

                            // For awesome-copilot and local-awesome-copilot, download the bundle directly from the adapter
                            // For other adapters, use the downloadUrl
                            let installation: InstalledBundle;
                            if (source.type === 'awesome-copilot' || source.type === 'local-awesome-copilot') {
                                this.logger.debug('Downloading bundle from awesome-copilot adapter');
                                const bundleBuffer = await adapter.downloadBundle(matchingBundle);
                                this.logger.debug(`Bundle downloaded: ${bundleBuffer.length} bytes`);
                            
                                // Install from buffer
                                installation = await this.installer.installFromBuffer(matchingBundle, bundleBuffer, options);
                            } else {
                                const downloadUrl = adapter.getDownloadUrl(matchingBundle.id, matchingBundle.version);
                                // Install bundle using BundleInstaller
                                installation = await this.installer.install(matchingBundle, downloadUrl, options);
                            }

                            // Record installation in storage
                            await this.storage.recordInstallation(installation);

                            // Fire bundle installed event
                            this._onBundleInstalled.fire(installation);
                        
                            this.logger.info(`Successfully installed: ${matchingBundle.id}`);
                        } catch (error) {
                            this.logger.error(`Failed to install bundle ${bundleRef.id}`, error as Error);
                        }
                    }
                
                    this.logger.info(`Profile bundle installation complete`);
                }
            
            
            // Activate target profile
            await this.storage.updateProfile(profileId, { active: true });

            this.logger.info(`Profile '${profileId}' activated successfully`);
            progress.report({ message: "Profile activated successfully" });
            
            } else {
                throw new Error(`Profile not found: ${profileId}`);
            }


            
        });
    }

    /**
     * Deactivate a profile and uninstall its bundles
     */
    async deactivateProfile(profileId: string): Promise<void> {
        this.logger.info(`Deactivating profile: ${profileId}`);
        
        const profiles = await this.storage.getProfiles();
        const profile = profiles.find(p => p.id === profileId);
        
        if (!profile) {
            throw new Error(`Profile not found: ${profileId}`);
        }
        
        // if (!profile.active) {
        //     this.logger.warn(`Profile ${profileId} is not active`);
        //     return;
        // }
        
        // Uninstall bundles associated with this profile
        const installedBundles = await this.storage.getInstalledBundles();
        const profileBundles = installedBundles.filter(b => b.profileId === profileId);
        
        this.logger.info(`Uninstalling ${profileBundles.length} bundles from profile '${profileId}'`);
        
        for (const bundle of profileBundles) {
            try {
                this.logger.info(`Uninstalling bundle: ${bundle.bundleId}`);
                await this.uninstallBundle(bundle.bundleId);
            } catch (error) {
                this.logger.error(`Failed to uninstall bundle ${bundle.bundleId}`, error as Error);
            }
        }
        
        // Mark profile as inactive
        await this.storage.updateProfile(profileId, { active: false });
        
        this.logger.info(`Profile '${profileId}' deactivated successfully`);
    }

    /**
     * Export a profile
     */
    async exportProfile(profileId: string): Promise<string> {
        const profiles = await this.storage.getProfiles();
        const profile = profiles.find(p => p.id === profileId);
        
        if (!profile) {
            throw new Error(`Profile '${profileId}' not found`);
        }

        return JSON.stringify(profile, null, 2);
    }

    /**
     * Import a profile
     */
    async importProfile(profileData: string): Promise<Profile> {
        const profile = JSON.parse(profileData) as Profile;
        
        // Update timestamps
        profile.createdAt = new Date().toISOString();
        profile.updatedAt = new Date().toISOString();
        profile.active = false;
        
        await this.storage.addProfile(profile);
        
        return profile;
    }


    /**
     * Export complete registry settings (sources + profiles + configuration)
     */
    async exportSettings(format: ExportFormat = 'json'): Promise<string> {
        const sources = await this.listSources();
        const profiles = await this.storage.getProfiles();
        
        const config = vscode.workspace.getConfiguration('promptregistry');
        
        const settings: ExportedSettings = {
            version: '1.0.0',
            exportedAt: new Date().toISOString(),
            sources,
            profiles,
            configuration: {
                autoCheckUpdates: config.get('autoCheckUpdates'),
                installationScope: config.get('installationScope'),
                defaultVersion: config.get('defaultVersion'),
                enableLogging: config.get('enableLogging'),
            },
        };

        if (format === 'yaml') {
            const yaml = require('js-yaml');
            return yaml.dump(settings, {
                indent: 2,
                lineWidth: 120,
                noRefs: true,
            });
        }
        
        return JSON.stringify(settings, null, 2);
    }

    /**
     * Import registry settings (sources + profiles + configuration)
     */
    async importSettings(
        data: string, 
        format: ExportFormat = 'json',
        strategy: ImportStrategy = 'merge'
    ): Promise<void> {
        // Parse data
        let settings: ExportedSettings;
        try {
            if (format === 'yaml') {
                const yaml = require('js-yaml');
                settings = yaml.load(data) as ExportedSettings;
            } else {
                settings = JSON.parse(data);
            }
        } catch (error: any) {
            throw new Error(`Invalid ${format.toUpperCase()} format: ${error.message}`);
        }

        // Validate schema version
        if (!settings.version || settings.version !== '1.0.0') {
            throw new Error(`Incompatible settings version: ${settings.version || 'unknown'}. Expected 1.0.0`);
        }

        // Validate required fields
        if (!Array.isArray(settings.sources) || !Array.isArray(settings.profiles)) {
            throw new Error('Invalid settings format: sources and profiles must be arrays');
        }

        // Clear if replacing
        if (strategy === 'replace') {
            await this.storage.clearAll();
        }

        // Import sources
        for (const source of settings.sources) {
            try {
                const existingSources = await this.listSources();
                const existing = existingSources.find(s => s.id === source.id);
                
                if (!existing || strategy === 'replace') {
                    // addSource will validate the source
                    await this.addSource(source);
                }
            } catch (error: any) {
                Logger.getInstance().warn(`Failed to import source ${source.name}: ${error.message}`);
            }
        }

        // Import profiles
        for (const profile of settings.profiles) {
            try {
                const existingProfiles = await this.storage.getProfiles();
                const existing = existingProfiles.find(p => p.id === profile.id);
                
                if (!existing || strategy === 'replace') {
                    // Reset timestamps and active state
                    profile.createdAt = new Date().toISOString();
                    profile.updatedAt = new Date().toISOString();
                    profile.active = false;
                    
                    await this.storage.addProfile(profile);
                }
            } catch (error: any) {
                Logger.getInstance().warn(`Failed to import profile ${profile.name}: ${error.message}`);
            }
        }

        // Import configuration
        if (settings.configuration) {
            const config = vscode.workspace.getConfiguration('promptregistry');
            
            if (settings.configuration.autoCheckUpdates !== undefined) {
                await config.update('autoCheckUpdates', settings.configuration.autoCheckUpdates, true);
            }
            if (settings.configuration.installationScope !== undefined) {
                await config.update('installationScope', settings.configuration.installationScope, true);
            }
            if (settings.configuration.defaultVersion !== undefined) {
                await config.update('defaultVersion', settings.configuration.defaultVersion, true);
            }
            if (settings.configuration.enableLogging !== undefined) {
                await config.update('enableLogging', settings.configuration.enableLogging, true);
            }
        }

        // Settings imported - triggering UI refresh via source/profile events
    }
    // ===== Helper Methods =====

    /**
     * Sort bundles by criteria
     */
    private sortBundles(bundles: Bundle[], sortBy: string): Bundle[] {
        switch (sortBy) {
            case 'downloads':
                return bundles.sort((a, b) => (b.downloads || 0) - (a.downloads || 0));
            case 'rating':
                return bundles.sort((a, b) => (b.rating || 0) - (a.rating || 0));
            case 'recent':
                return bundles.sort((a, b) => 
                    new Date(b.lastUpdated).getTime() - new Date(a.lastUpdated).getTime()
                );
            case 'relevance':
            default:
                return bundles;
        }
    }

    /**
     * Dispose resources
     */
    dispose(): void {
        this._onBundleInstalled.dispose();
        this._onBundleUninstalled.dispose();
        this._onBundleUpdated.dispose();
        this._onProfileActivated.dispose();
        this._onProfileCreated.dispose();
        this._onProfileUpdated.dispose();
        this._onProfileDeleted.dispose();
        this._onSourceAdded.dispose();
        this._onSourceRemoved.dispose();
    }
}

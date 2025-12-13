/**
 * HubManager - Orchestrates hub operations
 * Handles hub importing, loading, validation, and synchronization
 */

import * as fs from 'fs';
import * as vscode from 'vscode';
import * as path from 'path';
import * as yaml from 'js-yaml';
import * as https from 'https';
import * as http from 'http';
import { exec } from 'child_process';
import { promisify } from 'util';
import { HubStorage, LoadHubResult } from '../storage/HubStorage';
import { Logger } from '../utils/logger';
import { SchemaValidator, ValidationResult } from './SchemaValidator';
import { HubConfig, HubProfile, HubReference, validateHubConfig, sanitizeHubId , HubSource, HubProfileBundle , ProfileActivationState, ProfileActivationOptions, ProfileActivationResult, ProfileDeactivationResult, ProfileChanges, ChangeQuickPickItem, DialogOption, ConflictResolutionDialog } from '../types/hub';

const execAsync = promisify(exec);

/**
 * Resolved bundle with its download URL
 */
export interface ResolvedBundle {
    bundle: HubProfileBundle;
    url: string;
}

/**
 * Hub profile with hub metadata
 */
export interface HubProfileWithMetadata extends HubProfile {
    hubId: string;
    hubName: string;
}


/**
 * Hub information including config, reference, and metadata
 */
export interface HubInfo {
    id: string;
    config: HubConfig;
    reference: HubReference;
    metadata: {
        name: string;
        description: string;
        lastModified: Date;
        size: number;
    };
}

/**
 * Hub list item with basic information
 */
export interface HubListItem {
    id: string;
    name: string;
    description: string;
    reference: HubReference;
}

/**
 * HubManager orchestrates all hub-related operations
 */
export class HubManager {
    private storage: HubStorage;
    private validator: SchemaValidator;
    private hubSchemaPath: string;
    private logger: Logger;
    private _onHubImported = new vscode.EventEmitter<string>();
    private _onHubDeleted = new vscode.EventEmitter<string>();
    private _onHubSynced = new vscode.EventEmitter<string>();

    private authToken: string | undefined;
    private authMethod: 'vscode' | 'gh-cli' | 'explicit' | 'none' = 'none';


    /**
     * Initialize HubManager
     * @param storage HubStorage instance for persistence
     * @param validator SchemaValidator instance for validation
     * @param extensionPath Path to the extension directory
     */
    readonly onHubImported = this._onHubImported.event;
    readonly onHubDeleted = this._onHubDeleted.event;
    readonly onHubSynced = this._onHubSynced.event;

    constructor(
        storage: HubStorage, 
        validator: SchemaValidator, 
        extensionPath: string,
        private bundleInstaller?: any,
        private registryManager?: any
    ) {
        if (!storage) {
            throw new Error('storage is required');
        }
        if (!validator) {
            throw new Error('validator is required');
        }
        if (!extensionPath) {
            throw new Error('extensionPath is required');
        }

        this.storage = storage;
        this.validator = validator;
        this.hubSchemaPath = path.join(extensionPath, 'schemas', 'hub-config.schema.json');
        this.logger = Logger.getInstance();
    }

    /**
     * Import hub from remote or local source
     * @param reference Hub reference (GitHub, URL, or local path)
     * @param hubId Optional hub identifier (auto-generated if not provided)
     * @returns Hub identifier
     */
    async importHub(reference: HubReference, hubId?: string): Promise<string> {
        // Validate reference
        const refValidation = await this.validateReference(reference);
        if (!refValidation.valid) {
            throw new Error(`Invalid reference: ${refValidation.errors.join(', ')}`);
        }

        // Fetch hub config from source
        const config = await this.fetchHubConfig(reference);

        // Validate hub config
        const validation = await this.validateHub(config);
        if (!validation.valid) {
            this.logger.error('Hub validation failed:', undefined, {
                errors: validation.errors,
                warnings: validation.warnings
            });
            throw new Error(`Hub validation failed: Validation error: ${validation.errors.join(', ')}`);
        }

        // Generate hub ID if not provided
        if (!hubId) {
            hubId = this.generateHubId(config);
        }

        // Validate hub ID
        try {
            sanitizeHubId(hubId);
        } catch (error) {
            throw new Error(`Invalid hub ID: ${error instanceof Error ? error.message : String(error)}`);
        }
        
        // Save to storage first
        await this.storage.saveHub(hubId, config, reference);
        
        // Load hub sources into RegistryManager
        if (this.registryManager) {
            await this.loadHubSources(hubId);
        }
        
        this._onHubImported.fire(hubId);

        return hubId;
    }

    /**
     * Load hub from storage
     * @param hubId Hub identifier
     * @returns Loaded hub configuration and reference
     */
    async loadHub(hubId: string): Promise<LoadHubResult> {
        const result = await this.storage.loadHub(hubId);

        // Validate loaded config
        const validation = await this.validateHub(result.config);
        if (!validation.valid) {
            this.logger.error('Hub validation failed on load:', undefined, {
                hubId,
                errors: validation.errors,
                warnings: validation.warnings
            });
            throw new Error(`Hub validation failed: ${validation.errors.join(', ')}`);
        }

        return result;
    }

    /**
     * Validate hub configuration
     * @param config Hub configuration to validate
     * @returns Validation result
     */
    async validateHub(config: HubConfig): Promise<ValidationResult> {
        // Schema validation
        const schemaResult = await this.validator.validate(config, this.hubSchemaPath);
        if (!schemaResult.valid) {
            return schemaResult;
        }

        // Runtime validation
        const runtimeResult = validateHubConfig(config);
        if (!runtimeResult.valid) {
            return {
                valid: false,
                errors: runtimeResult.errors,
                warnings: []
            };
        }

        return {
            valid: true,
            errors: [],
            warnings: []
        };
    }

    /**
     * List all imported hubs
     * @returns Array of hub list items
     */
    async listHubs(): Promise<HubListItem[]> {
        const hubIds = await this.storage.listHubs();
        const hubs: HubListItem[] = [];

        for (const id of hubIds) {
            try {
                const result = await this.storage.loadHub(id);
                hubs.push({
                    id,
                    name: result.config.metadata.name,
                    description: result.config.metadata.description,
                    reference: result.reference
                });
            } catch (error) {
                // Skip hubs that fail to load
                console.error(`Failed to load hub ${id}:`, error);
            }
        }

        return hubs;
    }

    /**
     * Delete hub from storage
     * @param hubId Hub identifier to delete
     */
    async deleteHub(hubId: string): Promise<void> {
        await this.storage.deleteHub(hubId);
        this._onHubDeleted.fire(hubId);
    }

    /**
     * Sync hub from remote source
     * @param hubId Hub identifier to sync
     */
    async syncHub(hubId: string): Promise<void> {
        // Load existing hub to get reference
        const existing = await this.storage.loadHub(hubId);

        // Fetch latest config from source
        const config = await this.fetchHubConfig(existing.reference);

        // Validate updated config
        const validation = await this.validateHub(config);
        if (!validation.valid) {
            throw new Error(`Hub validation failed after sync: ${validation.errors.join(', ')}`);
        }
    
        // Update storage
        await this.storage.saveHub(hubId, config, existing.reference);
        
        // Reload hub sources into RegistryManager
        if (this.registryManager) {
            await this.loadHubSources(hubId);
        }
        
        this._onHubSynced.fire(hubId);
    }

    /**
     * Get detailed hub information
     * @param hubId Hub identifier
     * @returns Hub information
     */
    async getHubInfo(hubId: string): Promise<HubInfo> {
        const result = await this.storage.loadHub(hubId);
        const metadata = await this.storage.getHubMetadata(hubId);

        return {
            id: hubId,
            config: result.config,
            reference: result.reference,
            metadata: {
                name: result.config.metadata.name,
                description: result.config.metadata.description,
                lastModified: metadata.lastModified,
                size: metadata.size
            }
        };
    }

    /**
     * Validate hub reference
     * @param reference Hub reference to validate
     * @returns Validation result
     */
    private async validateReference(reference: HubReference): Promise<ValidationResult> {
        const errors: string[] = [];

        if (!reference.type) {
            errors.push('Reference type is required');
        }

        if (!reference.location) {
            errors.push('Reference location is required');
        }

        // Type-specific validation
        switch (reference.type) {
            case 'github':
                if (!reference.location.includes('/')) {
                    errors.push('Invalid GitHub location format. Expected: owner/repo');
                }
                break;
            case 'url':
                try {
                    new URL(reference.location);
                } catch {
                    errors.push('Invalid URL format');
                }
                break;
            case 'local':
                // Local path validation is done during fetch
                break;
            default:
                errors.push(`Unsupported reference type: ${reference.type}`);
        }

        return {
            valid: errors.length === 0,
            errors,
            warnings: []
        };
    }

    /**
     * Fetch hub configuration from source
     * @param reference Hub reference
     * @returns Hub configuration
     */
    private async fetchHubConfig(reference: HubReference): Promise<HubConfig> {
        switch (reference.type) {
            case 'local':
                return this.fetchFromLocal(reference.location);
            case 'url':
                return this.fetchFromUrl(reference.location);
            case 'github':
                return this.fetchFromGitHub(reference.location, reference.ref);
            default:
                throw new Error(`Unsupported reference type: ${reference.type}`);
        }
    }

    /**
     * Verify if a hub is accessible without importing it
     * Used to validate default hubs before offering them in the first-run selector
     * @param reference Hub reference to verify
     * @returns true if hub is accessible, false otherwise
     */
    async verifyHubAvailability(reference: HubReference): Promise<boolean> {
        try {
            // Validate reference format
            const refValidation = await this.validateReference(reference);
            if (!refValidation.valid) {
                this.logger.debug(`Hub verification failed: invalid reference - ${refValidation.errors.join(', ')}`);
                return false;
            }

            // Try to fetch the hub config
            await this.fetchHubConfig(reference);
            
            this.logger.debug(`Hub verification successful: ${reference.type}:${reference.location}`);
            return true;
        } catch (error) {
            this.logger.debug(`Hub verification failed: ${error instanceof Error ? error.message : String(error)}`);
            return false;
        }
    }

    /**
     * Fetch hub config from local file
     * @param filePath Local file path
     * @returns Hub configuration
     */
    private async fetchFromLocal(filePath: string): Promise<HubConfig> {
        if (!fs.existsSync(filePath)) {
            throw new Error(`File not found: ${filePath}`);
        }

        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            return yaml.load(content) as HubConfig;
        } catch (error) {
            throw new Error(`Failed to load hub config from ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

        /**
         * Get authentication token using fallback chain:
         * 1. VSCode GitHub API (if user is logged in)
         * 2. gh CLI (if installed and authenticated)
         * 3. Explicit token from source configuration
         */
        private async getAuthenticationToken(): Promise<string | undefined> {
            // Return cached token if already resolved
            if (this.authToken !== undefined) {
                this.logger.debug(`[HubManager] Using cached token (method: ${this.authMethod})`);
                return this.authToken;
            }
    
            this.logger.info('[HubManager] Attempting authentication...');
    
            // Try VSCode GitHub authentication first
            try {
                this.logger.debug('[HubManager] Trying VSCode GitHub authentication...');
                const session = await vscode.authentication.getSession('github', ['repo'], { createIfNone: true });
                if (session) {
                    this.authToken = session.accessToken;
                    this.authMethod = 'vscode';
                    this.logger.info('[HubManager] ✓ Using VSCode GitHub authentication');
                    this.logger.debug(`[HubManager] Token preview: ${this.authToken.substring(0, 8)}...`);
                    return this.authToken;
                }
                this.logger.debug('[HubManager] VSCode auth session not found');
            } catch (error) {
                this.logger.warn(`[HubManager] VSCode auth failed: ${error}`);
            }
    
            // Try gh CLI authentication
            try {
                this.logger.debug('[HubManager] Trying gh CLI authentication...');
                const { stdout } = await execAsync('gh auth token');
                const token = stdout.trim();
                if (token && token.length > 0) {
                    this.authToken = token;
                    this.authMethod = 'gh-cli';
                    this.logger.info('[HubManager] ✓ Using gh CLI authentication');
                    this.logger.debug(`[HubManager] Token preview: ${this.authToken.substring(0, 8)}...`);
                    return this.authToken;
                }
                this.logger.debug('[HubManager] gh CLI returned empty token');
            } catch (error) {
                this.logger.warn(`[HubManager] gh CLI auth failed: ${error}`);
            }
    
    
            // No authentication available
            this.authMethod = 'none';
            this.logger.warn('[HubManager] ✗ No authentication available - API rate limits will apply and private repos will be inaccessible');
            return undefined;
        }

    /**
     * Fetch hub config from URL
     * @param url URL to fetch from
     * @returns Hub configuration
     */
    private async fetchFromUrl(url: string): Promise<HubConfig> {
        
        // Prepare headers with authentication for GitHub URLs
        const headers: { [key: string]: string } = {};

         // Get authentication token using fallback chain
        const token = await this.getAuthenticationToken();
        if (token) {
            // Use Bearer token format for OAuth tokens (recommended)
            headers['Authorization'] = `token ${token}`;
            this.logger.debug(`[HubManager] Request to ${url} with auth (method: ${this.authMethod})`);
        } else {
            this.logger.debug(`[HubManager] Request to ${url} WITHOUT auth`);
        }

        // Log headers (sanitized)
        const sanitizedHeaders = { ...headers };
        if (sanitizedHeaders['Authorization']) {
            sanitizedHeaders['Authorization'] = sanitizedHeaders['Authorization'].substring(0, 15) + '...';
        }
        this.logger.debug(`[HubManager] Request headers: ${JSON.stringify(sanitizedHeaders)}`);

        return new Promise( (resolve, reject) => {
            const protocol = url.startsWith('https') ? https : http;
            const options: any = { headers };
            protocol.get(url, options, (res) => {
                if (res.statusCode !== 200) {
                    this.logger.error(`[HubManager] Failed to fetch hub config: HTTP ${res.statusCode}`, undefined);
                    reject(new Error(`Failed to fetch hub config: HTTP ${res.statusCode}`));
                    return;
                }

                let data = '';
                res.on('data', (chunk) => data += chunk);
                res.on('end', () => {
                    try {
                        this.logger.debug(`[HubManager] Successfully fetched hub config, ${data.length} bytes`);
                        const config = yaml.load(data) as HubConfig;
                        resolve(config);
                    } catch (error) {
                        this.logger.error(`[HubManager] Failed to parse hub config`, error as Error);
                        reject(new Error(`Failed to parse hub config: ${error instanceof Error ? error.message : String(error)}`));
                    }
                });
            }).on('error', (error) => {
                this.logger.error(`[HubManager] Network error fetching hub config`, error);
                reject(new Error(`Failed to fetch hub config: ${error.message}`));
            });
        });
    }

    /**
     * Fetch hub config from GitHub
     * @param location GitHub repository (owner/repo)
     * @param ref Git reference (branch, tag, or commit)
     * @returns Hub configuration
     */
    private async fetchFromGitHub(location: string, ref?: string): Promise<HubConfig> {
        const branch = ref || 'main';
        const url = `https://raw.githubusercontent.com/${location}/${branch}/hub-config.yml`;

        return this.fetchFromUrl(url);
    }

    /**
     * Generate hub ID from config
     * @param config Hub configuration
     * @returns Generated hub ID
     */
    private generateHubId(config: HubConfig): string {
        // Use metadata name, sanitized
        let id = config.metadata.name
            .toLowerCase()
            .replace(/[^a-z0-9-]/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '');

        // Add timestamp to ensure uniqueness
        const timestamp = Date.now().toString().slice(-6);
        id = `${id}-${timestamp}`;

        return id;
    }

    /**
     * List all profiles from a specific hub
     * @param hubId Hub identifier
     * @returns Array of profiles from the hub
     */
    async listProfilesFromHub(hubId: string): Promise<HubProfile[]> {
        const hub = await this.storage.loadHub(hubId);
        if (!hub) {
            throw new Error(`Hub not found: ${hubId}`);
        }
        return hub.config.profiles || [];
    }

    /**
     * Get a specific profile from a hub
     * @param hubId Hub identifier
     * @param profileId Profile identifier
     * @returns The requested profile
     */
    async getHubProfile(hubId: string, profileId: string): Promise<HubProfile> {
        const profiles = await this.listProfilesFromHub(hubId);
        this.logger.info(`Found ${profiles.length} profiles in hub ${hubId}`);
        
        const profile = profiles.find(p => p.id === profileId);
        
        if (!profile) {
            this.logger.error(`Profile ${profileId} not found in hub ${hubId}. Available: ${profiles.map(p => p.id).join(', ')}`);
            throw new Error(`Profile not found: ${profileId} in hub ${hubId}`);
        }
        
        this.logger.info(`Found profile ${profileId}: ${profile.name}`);
        this.logger.info(`Profile bundles: ${JSON.stringify(profile.bundles?.map(b => ({ id: b.id, version: b.version })) || [])}`);
        
        return profile;
    }

    /**
     * List all profiles from all imported hubs
     * @returns Array of profiles with hub information
     */
    async listAllHubProfiles(): Promise<HubProfileWithMetadata[]> {
        const hubs = await this.listHubs();
        const allProfiles: HubProfileWithMetadata[] = [];

        for (const hubItem of hubs) {
            const profiles = await this.listProfilesFromHub(hubItem.id);
            for (const profile of profiles) {
                allProfiles.push({
                    ...profile,
                    hubId: hubItem.id,
                    hubName: hubItem.name
                });
            }
        }

        return allProfiles;
    }

    /**
     * Get the currently active hub
     * @returns Active hub ID, config and reference, or null if no hub is active
     */
    async getActiveHub(): Promise<LoadHubResult | null> {
        const activeHubId = await this.storage.getActiveHubId();
        
        if (!activeHubId) {
            return null;
        }

        try {
            return await this.storage.loadHub(activeHubId);
        } catch (error) {
            // If active hub was deleted, clear the activeHubId
            await this.storage.setActiveHubId(null);
            return null;
        }
    }

    /**
     * Set the currently active hub
     * @param hubId Hub identifier to set as active
     */
        async setActiveHub(hubId: string | null): Promise<void> {
        if (hubId !== null) {
            // Verify hub exists when setting (not clearing)
            const hub = await this.getHub(hubId);
            if (!hub) {
                throw new Error(`Hub not found: ${hubId}`);
            }
            
            // Load hub sources into RegistryManager when activating
            if (this.registryManager) {
                await this.loadHubSources(hubId);
            }
        }

        // Set or clear active hub
        await this.storage.setActiveHubId(hubId);
        this.logger.info(hubId ? `Set active hub: ${hubId}` : 'Cleared active hub');
    }

    /**
     * Check if a source is a duplicate based on URL and config
     * Compares URL, type, branch, and collectionsPath to determine if sources are identical
     * @param source Source to check
     * @param existingSources List of existing sources
     * @returns The existing duplicate source or undefined
     */
    private findDuplicateSource(
        source: HubSource,
        existingSources: import('../types/registry').RegistrySource[]
    ): import('../types/registry').RegistrySource | undefined {
        return existingSources.find((existing: import('../types/registry').RegistrySource) => {
            // Must have same type and URL
            if (existing.type !== source.type || existing.url !== source.url) {
                return false;
            }
            
            // For sources with config, compare relevant fields
            const existingConfig = existing.config || {};
            const sourceConfig = source.config || {};
            
            // Compare branch (for git-based sources)
            const existingBranch = existingConfig.branch || 'main';
            const sourceBranch = sourceConfig.branch || 'main';
            if (existingBranch !== sourceBranch) {
                return false;
            }
            
            // Compare collectionsPath (for awesome-copilot sources)
            const existingPath = existingConfig.collectionsPath || 'collections';
            const sourcePath = sourceConfig.collectionsPath || 'collections';
            if (existingPath !== sourcePath) {
                return false;
            }
            
            // If all criteria match, it's a duplicate
            return true;
        });
    }

    /**
     * Load hub sources into RegistryManager
     * Converts HubSource objects to RegistrySource and adds them to the registry
     * Skips sources that are duplicates (same URL, type, branch, and collectionsPath)
     * @param hubId Hub identifier
     */
    async loadHubSources(hubId: string): Promise<void> {
        if (!this.registryManager) {
            this.logger.warn('RegistryManager not available, skipping source loading');
            return;
        }

        this.logger.info(`Loading sources from hub: ${hubId}`);
        
        try {
            const hubData = await this.storage.loadHub(hubId);
            const hubSources = hubData.config.sources || [];
            
            this.logger.info(`Found ${hubSources.length} sources in hub ${hubId}`);
            
            // Get existing sources to avoid duplicates
            const existingSources = await this.registryManager.listSources();
            
            let addedCount = 0;
            let skippedCount = 0;
            let updatedCount = 0;
            
            for (const hubSource of hubSources) {
                // Skip disabled sources
                if (!hubSource.enabled) {
                    this.logger.debug(`Skipping disabled source: ${hubSource.id}`);
                    skippedCount++;
                    continue;
                }
                
                // Create unique source ID by prefixing with hub ID
                const sourceId = `hub-${hubId}-${hubSource.id}`;
                
                // Check if source with same ID already exists (from this hub)
                const existingSourceById = existingSources.find((s: import('../types/registry').RegistrySource) => s.id === sourceId);
                
                if (existingSourceById) {
                    // Update existing source from same hub
                    this.logger.info(`Updating existing hub source: ${sourceId}`);
                    await this.registryManager.updateSource(sourceId, {
                        name: hubSource.name,
                        type: hubSource.type,
                        url: hubSource.url,
                        enabled: hubSource.enabled,
                        priority: hubSource.priority,
                        private: hubSource.private,
                        token: hubSource.token,
                        metadata: hubSource.metadata,
                        config: hubSource.config,
                        hubId: hubId
                    });
                    updatedCount++;
                    continue;
                }
                
                // Check if duplicate source already exists (same URL + config)
                const duplicateSource = this.findDuplicateSource(hubSource, existingSources);
                
                if (duplicateSource) {
                    this.logger.info(
                        `Skipping duplicate source: ${hubSource.name} ` +
                        `(already exists as "${duplicateSource.name}" with ID: ${duplicateSource.id})`
                    );
                    this.logger.debug(
                        `Duplicate detected - URL: ${hubSource.url}, ` +
                        `Branch: ${hubSource.config?.branch || 'main'}, ` +
                        `CollectionsPath: ${hubSource.config?.collectionsPath || 'collections'}`
                    );
                    skippedCount++;
                    continue;
                }
                
                // Add new source
                this.logger.info(`Adding new hub source: ${sourceId} (${hubSource.name})`);
                
                // Convert HubSource to RegistrySource
                const registrySource: import('../types/registry').RegistrySource = {
                    id: sourceId,
                    name: hubSource.name,
                    type: hubSource.type,
                    url: hubSource.url,
                    enabled: hubSource.enabled,
                    priority: hubSource.priority,
                    private: hubSource.private,
                    token: hubSource.token,
                    metadata: hubSource.metadata,
                    config: hubSource.config,
                    hubId: hubId
                };
                
                await this.registryManager.addSource(registrySource);
                addedCount++;
            }
            
            this.logger.info(
                `Hub source loading complete for ${hubId}: ` +
                `${addedCount} added, ${updatedCount} updated, ${skippedCount} skipped`
            );
        } catch (error) {
            this.logger.error(`Failed to load sources from hub ${hubId}`, error as Error);
            throw error;
        }
    }

    /**
     * List profiles from the active hub only
     * @returns Profiles from active hub, or empty array if no hub is active
     */
    async listActiveHubProfiles(): Promise<HubProfileWithMetadata[]> {
        const activeHubId = await this.storage.getActiveHubId();
        
        if (!activeHubId) {
            return [];
        }

        const activeHub = await this.getActiveHub();
        if (!activeHub) {
            return [];
        }

        const profiles = activeHub.config.profiles || [];
        return profiles.map(profile => ({
            ...profile,
            hubId: activeHubId,
            hubName: activeHub.config.metadata.name
        }));
    }



    /**
     * Resolve a source by ID from a hub
     */
    async resolveSource(hubId: string, sourceId: string): Promise<HubSource> {
        const hubData = await this.storage.loadHub(hubId);
        const source = hubData.config.sources.find(s => s.id === sourceId);

        if (!source) {
            throw new Error(`Source not found: ${sourceId} in hub ${hubId}`);
        }

        return source;
    }

    /**
     * Resolve bundle URL from hub source
     */
    async resolveBundleUrl(hubId: string, bundle: HubProfileBundle): Promise<string> {
        const source = await this.resolveSource(hubId, bundle.source);
        const githubMatch = source.url.match(/github:(.+)/);

        // Build URL based on source type
        switch (source.type) {
            case 'github': 
                // GitHub source format: github:owner/repo
                // Bundle URL: https://github.com/owner/repo/releases/download/v{version}/{bundleId}.zip
                if (githubMatch) {
                    const repo = githubMatch[1];
                    const version = bundle.version === 'latest' ? 'latest' : `v${bundle.version}`;
                    return `https://github.com/${repo}/releases/download/${version}/${bundle.id}.zip`;
                }
                throw new Error(`Invalid GitHub source URL: ${source.url}`);

            case 'http':
                // Direct URL source: {base-url}/{bundleId}/{version}
                return `${source.url}/${bundle.id}/${bundle.version}`;

            case 'local':
                // Local source: file path
                return `file://${source.url}/${bundle.id}/${bundle.version}`;

            default:
                throw new Error(`Unsupported source type: ${source.type}`);
        }
    }

    /**
     * Resolve all bundles in a profile
     */
    async resolveProfileBundles(
        hubId: string,
        profileId: string
    ): Promise<ResolvedBundle[]> {
        const profile = await this.getHubProfile(hubId, profileId);
        const resolved: ResolvedBundle[] = [];

        this.logger.info(`Resolving bundles for profile ${profileId} in hub ${hubId}`);
        this.logger.info(`Profile has ${profile.bundles?.length || 0} bundles`);
        
        if (!profile.bundles || profile.bundles.length === 0) {
            this.logger.warn(`No bundles found in profile ${profileId}`);
            return resolved;
        }

        for (const bundle of profile.bundles) {
            this.logger.info(`Resolving bundle: ${bundle.id} v${bundle.version} from source: ${bundle.source}`);
            // Note: We don't resolve URLs anymore since registryManager.installBundle() 
            // searches sources by bundle ID and uses the appropriate adapter
            resolved.push({ bundle: bundle, url: '' }); // URL not needed
        }

        this.logger.info(`Resolved ${resolved.length} bundles total`);
        return resolved;
    }


    /**
     * Activate a hub profile
     */
    async activateProfile(
        hubId: string,
        profileId: string,
        options: ProfileActivationOptions
    ): Promise<ProfileActivationResult> {
        try {
            this.logger.info(`[HubManager] activateProfile called: hubId=${hubId}, profileId=${profileId}, installBundles=${options.installBundles}`);
            
            // Verify hub and profile exist
            const profile = await this.getHubProfile(hubId, profileId);

            // Deactivate ALL active hub profiles across ALL hubs (enforce single active profile globally)
            // This will uninstall bundles from previously active profiles
            const allHubIds = await this.storage.listHubs();
            for (const currentHubId of allHubIds) {
                // Load hub config to check for active profiles in YAML (not activation states)
                const hubData = await this.storage.loadHub(currentHubId);
                const activeProfile = hubData.config.profiles.find(p => p.active);
                
                if (activeProfile && activeProfile.id !== profileId) {
                    this.logger.info(`Deactivating hub profile from hub ${currentHubId}: ${activeProfile.id}`);
                    
                    // Use RegistryManager to properly deactivate profile and uninstall its bundles
                    if (this.registryManager) {
                        try {
                            await this.registryManager.deactivateProfile(activeProfile.id);
                        } catch (error) {
                            this.logger.error(`Failed to deactivate profile ${activeProfile.id}`, error as Error);
                        }
                    } else {
                        // Fallback: just update flags if RegistryManager not available
                        await this.storage.setProfileActiveFlag(currentHubId, activeProfile.id, false);
                        await this.storage.deleteProfileActivationState(currentHubId, activeProfile.id);
                    }
                }
            }

            // Resolve all bundles in the profile
            const resolvedBundles = await this.resolveProfileBundles(hubId, profileId);

            // Create activation state with bundle versions
            const syncedBundleVersions: Record<string, string> = {};
            resolvedBundles.forEach(rb => {
                syncedBundleVersions[rb.bundle.id] = rb.bundle.version;
            });

            const activationState: ProfileActivationState = {
                hubId,
                profileId,
                activatedAt: new Date().toISOString(),
                syncedBundles: resolvedBundles.map(rb => rb.bundle.id),
                syncedBundleVersions
            };

            // Save activation state
            await this.storage.saveProfileActivationState(hubId, profileId, activationState);

            // Mark profile as active in hub config
            await this.storage.setProfileActiveFlag(hubId, profileId, true);

            // Install bundles if requested and RegistryManager is available
            const installResults: Array<{ bundleId: string; success: boolean; error?: string }> = [];
            if (options.installBundles && this.registryManager) {
                this.logger.info(`Installing ${resolvedBundles.length} bundles for profile ${profileId}`);
                
                const bundlesToInstall = resolvedBundles.map(rb => ({
                    bundleId: rb.bundle.id,
                    options: {
                        scope: 'user' as const,
                        force: false,
                        profileId: profileId  // Tag bundle with profile ID for tracking
                    }
                }));

                try {
                    await this.registryManager.installBundles(bundlesToInstall);
                    
                    // Assuming success if no error thrown (installBundles handles errors internally but doesn't return individual results easily yet, but logs them)
                    this.logger.info(`Bundle installation complete`);
                } catch (error) {
                    this.logger.error('Batch bundle installation failed', error as Error);
                }
            } else if (options.installBundles && !this.registryManager) {
                this.logger.warn('Bundle installation requested but RegistryManager not available');
            }

            // Note: Hub profiles are managed separately and displayed in tree view via HubManager
            // No need to sync to local profile storage - that would create duplicates
            /* DISABLED - Hub profiles don't need local sync
            // Sync with local profile in RegistryManager
            if (this.registryManager) {
                try {
                    const localProfiles = await this.registryManager.listProfiles();
                    const localProfile = localProfiles.find((p: any) => p.id === profileId);

                    // Convert hub profile bundles to local profile format
                    const profileBundles = resolvedBundles.map(rb => ({
                        id: rb.bundle.id,
                        version: rb.bundle.version,
                        required: true
                    }));

                    if (localProfile) {
                        // Update existing profile
                        this.logger.info(`Updating local profile: ${profileId}`);
                        await this.registryManager.updateProfile(profileId, {
                            bundles: profileBundles,
                            active: true
                        });
                    } else {
                        // Create new profile
                        this.logger.info(`Creating local profile: ${profileId}`);
                        await this.registryManager.createProfile({
                            id: profileId,
                            name: profile.name,
                            description: profile.description || `Profile from hub ${hubId}`,
                            icon: profile.icon || '📦',
                            bundles: profileBundles,
                            active: true
                        });
                    }
                    this.logger.info(`Local profile ${profileId} synced successfully`);
                } catch (error) {
                    this.logger.error(`Failed to sync local profile: ${profileId}`, error as Error);
                }
            } else {
                this.logger.warn('RegistryManager not available, local profile not synced');
            }
            */

            return {
                success: true,
                hubId,
                profileId,
                resolvedBundles: resolvedBundles.map(rb => ({
                    bundle: rb.bundle,
                    url: rb.url
                }))
            };
        } catch (error) {
            return {
                success: false,
                hubId,
                profileId,
                resolvedBundles: [],
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }

    /**
     * Deactivate a profile
     */
    async deactivateProfile(hubId: string, profileId: string): Promise<ProfileDeactivationResult> {
        try {
            // Verify profile exists
            const profile = await this.getHubProfile(hubId, profileId);

            // Get current activation state to track removed bundles
            const currentState = await this.storage.getProfileActivationState(hubId, profileId);
            const removedBundles = currentState ? currentState.syncedBundles : [];

            // Remove activation state
            await this.storage.deleteProfileActivationState(hubId, profileId);

            // Mark profile as inactive
            await this.storage.setProfileActiveFlag(hubId, profileId, false);

            return {
                success: true,
                hubId: hubId,
                profileId: profileId,
                removedBundles: removedBundles
            };
        } catch (error) {
            return {
                success: false,
                hubId: hubId,
                profileId: profileId,
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }

    /**
     * Get the currently active profile for a hub
     */
    async getActiveProfile(hubId: string): Promise<ProfileActivationState | null> {
        return this.storage.getActiveProfileForHub(hubId);
    }

    /**
     * List all active profiles across all hubs
     */
    async listAllActiveProfiles(): Promise<ProfileActivationState[]> {
        return this.storage.listActiveProfiles();
    }

    /**
     * Get a single hub by ID
     */
    async getHub(hubId: string): Promise<{ id: string; config: HubConfig; reference: HubReference } | null> {
        try {
            const result = await this.storage.loadHub(hubId);
            return {
                id: hubId,
                config: result.config,
                reference: result.reference
            };
        } catch (error) {
            return null;
        }
    }
    /**
     * Check if an active profile has changes in the hub
     */
    async hasProfileChanges(hubId: string, profileId: string): Promise<boolean> {
        const changes = await this.getProfileChanges(hubId, profileId);
        if (!changes) {
            return false;
        }
        return (
            (changes.bundlesAdded !== undefined && changes.bundlesAdded.length > 0) ||
            (changes.bundlesRemoved !== undefined && changes.bundlesRemoved.length > 0) ||
            (changes.bundlesUpdated !== undefined && changes.bundlesUpdated.length > 0) ||
            (changes.metadataChanged !== undefined && Object.keys(changes.metadataChanged).length > 0)
        );
    }

    /**
     * Get detailed changes for an active profile
     */
    async getProfileChanges(hubId: string, profileId: string): Promise<ProfileChanges | null> {
        // Get activation state
        const state = await this.storage.getProfileActivationState(hubId, profileId);
        if (!state) {
            return null;
        }

        // Get current profile from hub
        const currentProfile = await this.getHubProfile(hubId, profileId);
        
        // Get synced bundles from activation state
        const syncedBundles = state.syncedBundles;

        // Compare bundles
        const currentBundleIds = currentProfile.bundles.map(b => b.id);
        const bundlesAdded = currentProfile.bundles.filter(b => !syncedBundles.includes(b.id));
        const bundlesRemoved = syncedBundles.filter(id => !currentBundleIds.includes(id));
        
        // Check for version changes using stored bundle versions
        const bundlesUpdated: Array<{ id: string; oldVersion: string; newVersion: string }> = [];
        const profileUpdated = new Date(currentProfile.updatedAt) > new Date(state.activatedAt);
        
        if (state.syncedBundleVersions) {
            // Compare each current bundle version with synced version
            for (const bundle of currentProfile.bundles) {
                const syncedVersion = state.syncedBundleVersions[bundle.id];
                if (syncedVersion && syncedVersion !== bundle.version) {
                    bundlesUpdated.push({
                        id: bundle.id,
                        oldVersion: syncedVersion,
                        newVersion: bundle.version
                    });
                }
            }
        }

        // Check metadata changes by comparing updated timestamp
        const metadataChanged: { name?: boolean; description?: boolean; icon?: boolean } = {};
        if (profileUpdated) {
            metadataChanged.name = true;
            metadataChanged.description = true;
        }

        const changes: import('../types/hub').ProfileChanges = {};
        if (bundlesAdded.length > 0) {
            changes.bundlesAdded = bundlesAdded;
        }
        if (bundlesRemoved.length > 0) {
            changes.bundlesRemoved = bundlesRemoved;
        }
        if (bundlesUpdated.length > 0) {
            changes.bundlesUpdated = bundlesUpdated;
        }
        if (Object.keys(metadataChanged).length > 0) {
            changes.metadataChanged = metadataChanged;
        }

        return changes;
    }

    /**
     * Sync a profile (update activation state)
     */
    async syncProfile(hubId: string, profileId: string): Promise<void> {
        // Re-activate to update the state
        await this.activateProfile(hubId, profileId, { installBundles: false });
    }

    /**
     * Get time since last sync in milliseconds
     */
    async getTimeSinceLastSync(hubId: string, profileId: string): Promise<number | null> {
        const state = await this.storage.getProfileActivationState(hubId, profileId);
        if (!state) {
            return null;
        }
        return Date.now() - new Date(state.activatedAt).getTime();
    }

    /**
     * Check if hub has updates (any profile has changes)
     */
    async hasHubUpdates(hubId: string): Promise<boolean> {
        const profilesWithUpdates = await this.getProfilesWithUpdates(hubId);
        return profilesWithUpdates.length > 0;
    }

    /**
     * Get list of profiles with pending updates
     */
    async getProfilesWithUpdates(hubId: string): Promise<import('../types/hub').ProfileWithUpdates[]> {
        const hub = await this.getHub(hubId);
        if (!hub) {
            return [];
        }

        const result: import('../types/hub').ProfileWithUpdates[] = [];
        
        for (const profile of hub.config.profiles) {
            const hasChanges = await this.hasProfileChanges(hubId, profile.id);
            if (hasChanges) {
                const changes = await this.getProfileChanges(hubId, profile.id);
                result.push({
                    profileId: profile.id,
                    hasChanges: true,
                    changes: changes || undefined
                });
            }
        }

        return result;
    }

    /**
     * Format change summary as human-readable string
     */
    formatChangeSummary(changes: ProfileChanges): string {
        const lines: string[] = [];
        
        if (changes.bundlesAdded && changes.bundlesAdded.length > 0) {
            lines.push('Added bundles:');
            for (const bundle of changes.bundlesAdded) {
                lines.push(`  + ${bundle.id} v${bundle.version}`);
            }
        }
        
        if (changes.bundlesRemoved && changes.bundlesRemoved.length > 0) {
            lines.push('Removed bundles:');
            for (const bundleId of changes.bundlesRemoved) {
                lines.push(`  - ${bundleId}`);
            }
        }
        
        if (changes.bundlesUpdated && changes.bundlesUpdated.length > 0) {
            lines.push('Updated bundles:');
            for (const update of changes.bundlesUpdated) {
                lines.push(`  ~ ${update.id}: ${update.oldVersion} → ${update.newVersion}`);
            }
        }
        
        if (changes.metadataChanged && Object.keys(changes.metadataChanged).length > 0) {
            lines.push('Metadata changes:');
            if (changes.metadataChanged.name) {
                lines.push('  ~ name changed');
            }
            if (changes.metadataChanged.description) {
                lines.push('  ~ description changed');
            }
            if (changes.metadataChanged.icon) {
                lines.push('  ~ icon changed');
            }
        }
        
        return lines.join('\n');
    }

    /**
     * Create QuickPick items for displaying changes
     */
    createChangeQuickPickItems(changes: ProfileChanges): ChangeQuickPickItem[] {
        const items: ChangeQuickPickItem[] = [];
        
        if (changes.bundlesAdded) {
            for (const bundle of changes.bundlesAdded) {
                items.push({
                    label: `${bundle.required ? '* ' : ''}${bundle.id}`,
                    description: `Added v${bundle.version}${bundle.required ? ' (required)' : ''}`,
                    detail: `Source: ${bundle.source}`
                });
            }
        }
        
        if (changes.bundlesRemoved) {
            for (const bundleId of changes.bundlesRemoved) {
                items.push({
                    label: bundleId,
                    description: 'Removed',
                    detail: 'This bundle will be uninstalled'
                });
            }
        }
        
        if (changes.bundlesUpdated) {
            for (const update of changes.bundlesUpdated) {
                items.push({
                    label: update.id,
                    description: `Updated ${update.oldVersion} → ${update.newVersion}`,
                    detail: 'Bundle version changed'
                });
            }
        }
        
        if (changes.metadataChanged && Object.keys(changes.metadataChanged).length > 0) {
            const changedFields: string[] = [];
            if (changes.metadataChanged.name) {changedFields.push('name');}
            if (changes.metadataChanged.description) {changedFields.push('description');}
            if (changes.metadataChanged.icon) {changedFields.push('icon');}
            
            items.push({
                label: 'Profile Metadata',
                description: 'Changed',
                detail: `Modified: ${changedFields.join(', ')}`
            });
        }
        
        return items;
    }

    /**
     * Create conflict resolution dialog
     */
    createConflictResolutionDialog(changes: ProfileChanges): ConflictResolutionDialog {
        const changeCount = 
            (changes.bundlesAdded?.length || 0) +
            (changes.bundlesRemoved?.length || 0) +
            (changes.bundlesUpdated?.length || 0) +
            (changes.metadataChanged ? 1 : 0);
        
        return {
            title: 'Profile Updates Available',
            message: `${changeCount} change${changeCount > 1 ? 's' : ''} detected in the profile`,
            options: [
                {
                    label: 'Sync Now',
                    description: 'Accept all changes and update profile',
                    action: 'sync'
                },
                {
                    label: 'Review Changes',
                    description: 'View detailed changes before syncing',
                    action: 'review'
                },
                {
                    label: 'Cancel',
                    description: 'Keep current profile version',
                    action: 'cancel'
                }
            ]
        };
    }

    /**
     * Format detailed bundle addition info
     */
    formatBundleAdditionDetail(bundle: HubProfileBundle): string {
        return `Bundle: ${bundle.id}\nVersion: ${bundle.version}\nSource: ${bundle.source}\n${bundle.required ? 'required' : 'optional'}`;
    }

    /**
     * Format detailed bundle removal info
     */
    formatBundleRemovalDetail(bundleId: string): string {
        return `Bundle: ${bundleId}\nStatus: Will be removed`;
    }

    /**
     * Format detailed bundle update info
     */
    formatBundleUpdateDetail(update: { id: string; oldVersion: string; newVersion: string }): string {
        return `Bundle: ${update.id}\nOld Version: ${update.oldVersion}\nNew Version: ${update.newVersion}`;
    }
}

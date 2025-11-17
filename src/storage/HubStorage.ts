/**
 * HubStorage - File-based storage for hub configurations
 * Handles persistence, caching, and file operations for hub configs
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { HubConfig, HubReference, sanitizeHubId , ProfileActivationState } from '../types/hub';

/**
 * Hub metadata stored alongside configuration
 */
export interface HubMetadata {
    reference: HubReference;
    lastModified: Date;
    size: number;
}

/**
 * Result of loading a hub from storage
 */
export interface LoadHubResult {
    config: HubConfig;
    reference: HubReference;
}

/**
 * HubStorage manages persistent storage of hub configurations
 */
export class HubStorage {
    private storagePath: string;
    private cache: Map<string, LoadHubResult>;

    /**
     * Initialize hub storage
     * @param storagePath Directory path for storing hub configurations
     */
    constructor(storagePath: string) {
        if (!storagePath || storagePath.trim() === '') {
            throw new Error('Invalid storage path');
        }

        this.storagePath = path.resolve(storagePath);
        this.cache = new Map();

        // Create storage directory if it doesn't exist
        if (!fs.existsSync(this.storagePath)) {
            fs.mkdirSync(this.storagePath, { recursive: true });
        }
    }

    /**
     * Validate hub ID for security
     * @param hubId Hub identifier to validate
     * @throws Error if hub ID is invalid
     */
    private validateHubId(hubId: string): void {
        try {
            sanitizeHubId(hubId);
        } catch (error) {
            throw new Error(`Invalid hub ID: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Get file paths for hub storage
     * @param hubId Hub identifier
     * @returns Paths for config and metadata files
     */
    private getHubPaths(hubId: string): { config: string; meta: string } {
        return {
            config: path.join(this.storagePath, `${hubId}.yml`),
            meta: path.join(this.storagePath, `${hubId}.meta.json`)
        };
    }

    /**
     * Save hub configuration to storage
     * @param hubId Unique identifier for the hub
     * @param config Hub configuration to save
     * @param reference Hub reference information
     */
    async saveHub(hubId: string, config: HubConfig, reference: HubReference): Promise<void> {
        this.validateHubId(hubId);

        const paths = this.getHubPaths(hubId);

        try {
            // Write config as YAML
            const yamlContent = yaml.dump(config, {
                indent: 2,
                lineWidth: 120,
                noRefs: true
            });
            fs.writeFileSync(paths.config, yamlContent, 'utf-8');

            // Write metadata as JSON
            const metadata: HubMetadata = {
                reference,
                lastModified: new Date(),
                size: Buffer.byteLength(yamlContent, 'utf-8')
            };
            fs.writeFileSync(paths.meta, JSON.stringify(metadata, null, 2), 'utf-8');

            // Update cache
            this.cache.set(hubId, { config, reference });
        } catch (error) {
            throw new Error(`Failed to save hub '${hubId}': ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Load hub configuration from storage
     * @param hubId Hub identifier to load
     * @param forceReload Bypass cache and reload from disk
     * @returns Loaded hub configuration and reference
     */
    async loadHub(hubId: string, forceReload: boolean = false): Promise<LoadHubResult> {
        this.validateHubId(hubId);

        // Check cache first
        if (!forceReload && this.cache.has(hubId)) {
            return this.cache.get(hubId)!;
        }

        const paths = this.getHubPaths(hubId);

        // Check if hub exists
        if (!fs.existsSync(paths.config)) {
            throw new Error(`Hub not found: ${hubId}`);
        }

        try {
            // Load config from YAML
            const configContent = fs.readFileSync(paths.config, 'utf-8');
            const config = yaml.load(configContent) as HubConfig;

            // Load metadata
            let reference: HubReference;
            if (fs.existsSync(paths.meta)) {
                const metaContent = fs.readFileSync(paths.meta, 'utf-8');
                const metadata = JSON.parse(metaContent) as HubMetadata;
                reference = metadata.reference;
            } else {
                // Fallback if metadata doesn't exist
                reference = {
                    type: 'local',
                    location: paths.config
                };
            }

            const result: LoadHubResult = { config, reference };

            // Update cache
            this.cache.set(hubId, result);

            return result;
        } catch (error) {
            throw new Error(`Failed to load hub '${hubId}': ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Check if a hub exists in storage
     * @param hubId Hub identifier to check
     * @returns True if hub exists, false otherwise
     */
    async hubExists(hubId: string): Promise<boolean> {
        this.validateHubId(hubId);

        const paths = this.getHubPaths(hubId);
        return fs.existsSync(paths.config);
    }

    /**
     * Delete hub from storage
     * @param hubId Hub identifier to delete
     */
    async deleteHub(hubId: string): Promise<void> {
        this.validateHubId(hubId);

        const paths = this.getHubPaths(hubId);

        if (!fs.existsSync(paths.config)) {
            throw new Error(`Hub not found: ${hubId}`);
        }

        try {
            // Delete config file
            if (fs.existsSync(paths.config)) {
                fs.unlinkSync(paths.config);
            }

            // Delete metadata file
            if (fs.existsSync(paths.meta)) {
                fs.unlinkSync(paths.meta);
            }

            // Remove from cache
            this.cache.delete(hubId);
        } catch (error) {
            throw new Error(`Failed to delete hub '${hubId}': ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * List all stored hubs
     * @returns Array of hub IDs
     */
    async listHubs(): Promise<string[]> {
        try {
            const files = fs.readdirSync(this.storagePath);
            const hubIds: string[] = [];

            for (const file of files) {
                if (file.endsWith('.yml')) {
                    const hubId = file.replace('.yml', '');
                    hubIds.push(hubId);
                }
            }

            return hubIds;
        } catch (error) {
            throw new Error(`Failed to list hubs: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Get hub metadata without loading full configuration
     * @param hubId Hub identifier
     * @returns Hub metadata
     */
    async getHubMetadata(hubId: string): Promise<HubMetadata> {
        this.validateHubId(hubId);

        const paths = this.getHubPaths(hubId);

        if (!fs.existsSync(paths.meta)) {
            throw new Error(`Hub not found: ${hubId}`);
        }

        try {
            const metaContent = fs.readFileSync(paths.meta, 'utf-8');
            return JSON.parse(metaContent) as HubMetadata;
        } catch (error) {
            throw new Error(`Failed to get metadata for hub '${hubId}': ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Clear cache for specific hub or all hubs
     * @param hubId Optional hub ID to clear, or undefined to clear all
     */
    clearCache(hubId?: string): void {
        if (hubId) {
            this.cache.delete(hubId);
        } else {
            this.cache.clear();
        }
    }

    /**
     * Get storage path
     * @returns Absolute path to storage directory
     */
    getStoragePath(): string {
        return this.storagePath;
    }

    /**
     * Save profile activation state
     */
    async saveProfileActivationState(
        hubId: string,
        profileId: string,
        state: ProfileActivationState
    ): Promise<void> {
        const stateDir = path.join(this.storagePath, 'profile-activations');
        await fs.promises.mkdir(stateDir, { recursive: true });

        const statePath = path.join(stateDir, `${hubId}_${profileId}.json`);
        await fs.promises.writeFile(statePath, JSON.stringify(state, null, 2));
    }

    /**
     * Get profile activation state
     */
    async getProfileActivationState(
        hubId: string,
        profileId: string
    ): Promise<ProfileActivationState | null> {
        const statePath = path.join(
            this.storagePath,
            'profile-activations',
            `${hubId}_${profileId}.json`
        );

        if (!fs.existsSync(statePath)) {
            return null;
        }

        const content = await fs.promises.readFile(statePath, 'utf-8');
        return JSON.parse(content);
    }

    /**
     * Delete profile activation state
     */
    async deleteProfileActivationState(
        hubId: string,
        profileId: string
    ): Promise<void> {
        const statePath = path.join(
            this.storagePath,
            'profile-activations',
            `${hubId}_${profileId}.json`
        );

        if (fs.existsSync(statePath)) {
            await fs.promises.unlink(statePath);
        }
    }

    /**
     * List all active profiles
     */
    async listActiveProfiles(): Promise<ProfileActivationState[]> {
        const stateDir = path.join(this.storagePath, 'profile-activations');

        if (!fs.existsSync(stateDir)) {
            return [];
        }

        const files = await fs.promises.readdir(stateDir);
        const states: ProfileActivationState[] = [];

        for (const file of files) {
            if (file.endsWith('.json')) {
                const content = await fs.promises.readFile(
                    path.join(stateDir, file),
                    'utf-8'
                );
                states.push(JSON.parse(content));
            }
        }

        return states;
    }

    /**
     * Get active profile for a specific hub
     */
    async getActiveProfileForHub(hubId: string): Promise<ProfileActivationState | null> {
        const allActive = await this.listActiveProfiles();
        return allActive.find(state => state.hubId === hubId) || null;
    }

    /**
     * Set profile active flag in hub config
     */
    async setProfileActiveFlag(
        hubId: string,
        profileId: string,
        active: boolean
    ): Promise<void> {
        const hubData = await this.loadHub(hubId);

        const profile = hubData.config.profiles.find(p => p.id === profileId);
        if (!profile) {
            throw new Error(`Profile not found: ${profileId} in hub ${hubId}`);
        }

        profile.active = active;

        await this.saveHub(hubId, hubData.config, hubData.reference);
    }
}

/**
 * Storage layer for registry configuration and data
 * Handles persistence of sources, profiles, bundles, and settings
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import {
    RegistryConfig,
    RegistrySource,
    Profile,
    InstalledBundle,
    Bundle,
    RegistrySettings,
} from '../types/registry';

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const mkdir = promisify(fs.mkdir);
const readdir = promisify(fs.readdir);
const unlink = promisify(fs.unlink);
const stat = promisify(fs.stat);

/**
 * Storage paths
 */
interface StoragePaths {
    root: string;
    config: string;
    cache: string;
    sourcesCache: string;
    bundlesCache: string;
    installed: string;
    userInstalled: string;
    profilesInstalled: string;
    profiles: string;
    logs: string;
}

/**
 * Default registry settings
 */
const DEFAULT_SETTINGS: RegistrySettings = {
    autoUpdate: true,
    updateCheckInterval: 24, // hours
    telemetry: false,
    installationScope: 'user',
    preferredEnvironment: 'vscode',
};

/**
 * Default registry configuration
 */
const DEFAULT_CONFIG: RegistryConfig = {
    version: '1.0.0',
    sources: [],
    profiles: [],
    settings: DEFAULT_SETTINGS,
};

/**
 * Registry storage manager
 * Handles all file-based persistence for the registry
 */
export class RegistryStorage {
    private paths: StoragePaths;
    private configCache?: RegistryConfig;

    constructor(private context: vscode.ExtensionContext) {
        const storagePath = context.globalStorageUri.fsPath;
        
        this.paths = {
            root: storagePath,
            config: path.join(storagePath, 'config.json'),
            cache: path.join(storagePath, 'cache'),
            sourcesCache: path.join(storagePath, 'cache', 'sources'),
            bundlesCache: path.join(storagePath, 'cache', 'bundles'),
            installed: path.join(storagePath, 'installed'),
            userInstalled: path.join(storagePath, 'installed', 'user'),
            profilesInstalled: path.join(storagePath, 'installed', 'profiles'),
            profiles: path.join(storagePath, 'profiles'),
            logs: path.join(storagePath, 'logs'),
        };
    }

    /**
     * Initialize storage directories
     */
    async initialize(): Promise<void> {
        await this.ensureDirectories();
        
        // Create default config if doesn't exist
        if (!fs.existsSync(this.paths.config)) {
            await this.saveConfig(DEFAULT_CONFIG);
        }
    }

    /**
     * Ensure all required directories exist
     */
    private async ensureDirectories(): Promise<void> {
        const dirs = [
            this.paths.root,
            this.paths.cache,
            this.paths.sourcesCache,
            this.paths.bundlesCache,
            this.paths.installed,
            this.paths.userInstalled,
            this.paths.profilesInstalled,
            this.paths.profiles,
            this.paths.logs,
        ];

        for (const dir of dirs) {
            if (!fs.existsSync(dir)) {
                await mkdir(dir, { recursive: true });
            }
        }
    }

    /**
     * Load registry configuration
     */
    async loadConfig(): Promise<RegistryConfig> {
        if (this.configCache) {
            return this.configCache;
        }

        try {
            const data = await readFile(this.paths.config, 'utf-8');
            const config = JSON.parse(data) as RegistryConfig;
            
            // Merge with defaults for any missing settings
            config.settings = { ...DEFAULT_SETTINGS, ...config.settings };
            
            this.configCache = config;
            return config;
        } catch (error) {
            // Return default config if file doesn't exist or is invalid
            return DEFAULT_CONFIG;
        }
    }

    /**
     * Save registry configuration
     */
    async saveConfig(config: RegistryConfig): Promise<void> {
        const data = JSON.stringify(config, null, 2);
        await writeFile(this.paths.config, data, 'utf-8');
        this.configCache = config;
    }

    /**
     * Get storage paths
     */
    getPaths(): StoragePaths {
        return { ...this.paths };
    }

    // ===== Source Management =====

    /**
     * Add a source to configuration
     */
    async addSource(source: RegistrySource): Promise<void> {
        const config = await this.loadConfig();
        
        // Check for duplicate IDs
        if (config.sources.some(s => s.id === source.id)) {
            throw new Error(`Source with ID '${source.id}' already exists`);
        }

        config.sources.push(source);
        await this.saveConfig(config);
    }

    /**
     * Update a source
     */
    async updateSource(sourceId: string, updates: Partial<RegistrySource>): Promise<void> {
        const config = await this.loadConfig();
        const index = config.sources.findIndex(s => s.id === sourceId);
        
        if (index === -1) {
            throw new Error(`Source '${sourceId}' not found`);
        }

        config.sources[index] = { ...config.sources[index], ...updates };
        await this.saveConfig(config);
    }

    /**
     * Remove a source
     */
    async removeSource(sourceId: string): Promise<void> {
        const config = await this.loadConfig();
        config.sources = config.sources.filter(s => s.id !== sourceId);
        await this.saveConfig(config);
        
        // Clean up source cache
        await this.clearSourceCache(sourceId);
    }

    /**
     * Get all sources
     */
    async getSources(): Promise<RegistrySource[]> {
        const config = await this.loadConfig();
        return config.sources;
    }

    // ===== Profile Management =====

    /**
     * Add a profile
     */
    async addProfile(profile: Profile): Promise<void> {
        const config = await this.loadConfig();
        
        if (config.profiles.some(p => p.id === profile.id)) {
            throw new Error(`Profile with ID '${profile.id}' already exists`);
        }

        config.profiles.push(profile);
        await this.saveConfig(config);
    }

    /**
     * Update a profile
     */
    async updateProfile(profileId: string, updates: Partial<Profile>): Promise<void> {
        const config = await this.loadConfig();
        const index = config.profiles.findIndex(p => p.id === profileId);
        
        if (index === -1) {
            throw new Error(`Profile '${profileId}' not found`);
        }

        config.profiles[index] = { ...config.profiles[index], ...updates };
        await this.saveConfig(config);
    }

    /**
     * Remove a profile
     */
    async removeProfile(profileId: string): Promise<void> {
        const config = await this.loadConfig();
        config.profiles = config.profiles.filter(p => p.id !== profileId);
        await this.saveConfig(config);
    }

    /**
     * Get all profiles
     */
    async getProfiles(): Promise<Profile[]> {
        const config = await this.loadConfig();
        return config.profiles;
    }

    /**
     * Get active profile
     */
    async getActiveProfile(): Promise<Profile | undefined> {
        const config = await this.loadConfig();
        return config.profiles.find(p => p.active);
    }

    // ===== Bundle Cache Management =====

    /**
     * Cache bundle metadata
     */
    async cacheBundleMetadata(bundle: Bundle): Promise<void> {
        const filepath = path.join(this.paths.bundlesCache, `${bundle.id}.json`);
        const data = JSON.stringify(bundle, null, 2);
        await writeFile(filepath, data, 'utf-8');
    }

    /**
     * Get cached bundle metadata
     */
    async getCachedBundleMetadata(bundleId: string): Promise<Bundle | undefined> {
        try {
            const filepath = path.join(this.paths.bundlesCache, `${bundleId}.json`);
            const data = await readFile(filepath, 'utf-8');
            return JSON.parse(data) as Bundle;
        } catch {
            return undefined;
        }
    }

    /**
     * Cache source bundles
     */
    async cacheSourceBundles(sourceId: string, bundles: Bundle[]): Promise<void> {
        const filepath = path.join(this.paths.sourcesCache, `${sourceId}.json`);
        const data = JSON.stringify(bundles, null, 2);
        await writeFile(filepath, data, 'utf-8');
    }

    /**
     * Get cached source bundles
     */
    async getCachedSourceBundles(sourceId: string): Promise<Bundle[]> {
        try {
            const filepath = path.join(this.paths.sourcesCache, `${sourceId}.json`);
            const data = await readFile(filepath, 'utf-8');
            return JSON.parse(data) as Bundle[];
        } catch {
            return [];
        }
    }

    /**
     * Clear source cache
     */
    async clearSourceCache(sourceId: string): Promise<void> {
        try {
            const filepath = path.join(this.paths.sourcesCache, `${sourceId}.json`);
            if (fs.existsSync(filepath)) {
                await unlink(filepath);
            }
        } catch (error) {
            // Ignore errors
        }
    }

    /**
     * Clear all caches
     */
    async clearAllCaches(): Promise<void> {
        try {
            const files = await readdir(this.paths.bundlesCache);
            for (const file of files) {
                await unlink(path.join(this.paths.bundlesCache, file));
            }
        } catch {
            // Ignore errors
        }

        try {
            const files = await readdir(this.paths.sourcesCache);
            for (const file of files) {
                await unlink(path.join(this.paths.sourcesCache, file));
            }
        } catch {
            // Ignore errors
        }
    }

    // ===== Installed Bundles Management =====

    /**
     * Record installed bundle
     */
    async recordInstallation(bundle: InstalledBundle): Promise<void> {
        const filepath = this.getInstalledBundlePath(bundle);
        const data = JSON.stringify(bundle, null, 2);
        await writeFile(filepath, data, 'utf-8');
    }

    /**
     * Remove installation record
     */
    async removeInstallation(bundleId: string, scope: 'user' | 'workspace'): Promise<void> {
        const scopePath = scope === 'user' ? this.paths.userInstalled : this.paths.installed;
        const filepath = path.join(scopePath, `${bundleId}.json`);
        
        if (fs.existsSync(filepath)) {
            await unlink(filepath);
        }
    }

    /**
     * Get all installed bundles
     */
    async getInstalledBundles(scope?: 'user' | 'workspace'): Promise<InstalledBundle[]> {
        const bundles: InstalledBundle[] = [];
        
        const scopes = scope ? [scope] : ['user', 'workspace'];
        
        for (const s of scopes) {
            const scopePath = s === 'user' ? this.paths.userInstalled : this.paths.installed;
            
            try {
                const files = await readdir(scopePath);
                
                for (const file of files) {
                    if (file.endsWith('.json')) {
                        try {
                            const data = await readFile(path.join(scopePath, file), 'utf-8');
                            const bundle = JSON.parse(data) as InstalledBundle;
                            bundles.push(bundle);
                        } catch {
                            // Skip invalid files
                        }
                    }
                }
            } catch {
                // Scope directory doesn't exist
            }
        }
        
        return bundles;
    }

    /**
     * Get installed bundle metadata
     */
    async getInstalledBundle(bundleId: string, scope: 'user' | 'workspace'): Promise<InstalledBundle | undefined> {
        try {
            const scopePath = scope === 'user' ? this.paths.userInstalled : this.paths.installed;
            const filepath = path.join(scopePath, `${bundleId}.json`);
            const data = await readFile(filepath, 'utf-8');
            return JSON.parse(data) as InstalledBundle;
        } catch {
            return undefined;
        }
    }

    /**
     * Get installation path for bundle
     */
    private getInstalledBundlePath(bundle: InstalledBundle): string {
        const scopePath = bundle.scope === 'user' ? this.paths.userInstalled : this.paths.installed;
        return path.join(scopePath, `${bundle.bundleId}.json`);
    }

    // ===== Settings Management =====

    /**
     * Update settings
     */
    async updateSettings(updates: Partial<RegistrySettings>): Promise<void> {
        const config = await this.loadConfig();
        config.settings = { ...config.settings, ...updates };
        await this.saveConfig(config);
    }

    /**
     * Get settings
     */
    async getSettings(): Promise<RegistrySettings> {
        const config = await this.loadConfig();
        return config.settings;
    }

    /**
     * Clear all data (sources, profiles, caches) - used for replace import strategy
     */
    async clearAll(): Promise<void> {
        // Reset config to defaults
        const config: RegistryConfig = {
            version: '1.0.0',
            sources: [],
            profiles: [],
            settings: DEFAULT_SETTINGS,
        };
        await this.saveConfig(config);
        
        // Clear all caches
        await this.clearAllCaches();
    }
}

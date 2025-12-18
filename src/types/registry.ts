/**
 * Core type definitions for the Prompt Registry system
 */
import { McpServersManifest } from './mcp';

/**
 * Registry source types
 */
export type SourceType = 'github' | 'gitlab' | 'http' | 'local' | 'awesome-copilot' | 'local-awesome-copilot' | 'apm' | 'local-apm' | 'olaf';

/**
 * Installation scope
 */
export type InstallationScope = 'user' | 'workspace';

/**
 * Compression formats for bundles
 */
export type CompressionFormat = 'zip' | 'tar.gz' | 'tar.bz2' | 'tar.xz' | 'none';

/**
 * Registry source configuration
 */
export interface RegistrySource {
    id: string;
    name: string;
    type: SourceType;
    url: string;
    enabled: boolean;
    priority: number;
    private?: boolean;
    token?: string;  // Environment variable or secure storage key
    hubId?: string;  // Hub identifier if this source is from a curated hub
    metadata?: {
        description?: string;
        homepage?: string;
        contact?: string;
    };
    config?: {
        branch?: string;          // Git branch (for git-based sources)
        collectionsPath?: string;  // Collections directory (for awesome-copilot)
        indexFile?: string;        // Index file name (for awesome-copilot)
        [key: string]: any;        // Allow additional source-specific config
    };
}

/**
 * Bundle metadata
 */
export interface Bundle {
    id: string;
    name: string;
    version: string;
    description: string;
    author: string;
    sourceId: string;
    environments: string[];
    tags: string[];
    downloads?: number;
    rating?: number;
    lastUpdated: string;
    size: string;
    dependencies: BundleDependency[];
    homepage?: string;
    repository?: string;
    license: string;
    manifestUrl: string;
    downloadUrl: string;
    isCurated?: boolean;  // True if bundle is from a curated hub
    hubName?: string;  // Name of the curated hub
    checksum?: {
        algorithm: string;
        hash: string;
    };
}

/**
 * Bundle dependency specification
 */
export interface BundleDependency {
    bundleId: string;
    versionRange: string;
    optional: boolean;
}

/**
 * Installed bundle information
 */
export interface InstalledBundle {
    bundleId: string;
    version: string;
    installedAt: string;
    scope: InstallationScope;
    profileId?: string;
    installPath: string;
    manifest: DeploymentManifest;
    sourceId?: string;  // Source ID for identity matching
    sourceType?: string;  // Source type for identity matching (github, local, etc.)
}

/**
 * Profile definition
 */
export interface Profile {
    id: string;
    name: string;
    description: string;
    icon: string;
    bundles: ProfileBundle[];
    environments?: {
        preferred: string;
        compatible: string[];
    };
    active: boolean;
    createdAt: string;
    updatedAt: string;
}

/**
 * Bundle reference in a profile
 */
export interface ProfileBundle {
    id: string;
    version: string;  // Semantic version or 'latest'
    sourceId?: string;  // Optional source identifier for disambiguation
    required: boolean;
}

/**
 * Registry settings
 */
export interface RegistrySettings {
    autoUpdate: boolean;
    updateCheckInterval: number;  // hours
    telemetry: boolean;
    installationScope: InstallationScope;
    preferredEnvironment: string;
    proxySettings?: {
        enabled: boolean;
        url: string;
    };
}

/**
 * Top-level registry configuration
 */
export interface RegistryConfig {
    version: string;
    sources: RegistrySource[];
    profiles: Profile[];
    settings: RegistrySettings;
}

/**
 * Search query parameters
 */
export interface SearchQuery {
    text?: string;
    tags?: string[];
    author?: string;
    environment?: string;
    sourceId?: string;
    sortBy?: 'relevance' | 'downloads' | 'rating' | 'recent';
    limit?: number;
    offset?: number;
}

/**
 * Installation options
 */
export interface InstallOptions {
    version?: string;
    scope: InstallationScope;
    profileId?: string;
    force?: boolean;  // Overwrite existing
}

/**
 * Validation result
 */
export interface ValidationResult {
    valid: boolean;
    errors: string[];
    warnings: string[];
    bundlesFound?: number;
}

/**
 * Bundle update information
 */
export interface BundleUpdate {
    bundleId: string;
    currentVersion: string;
    latestVersion: string;
    changelog?: string;
}

/**
 * Source metadata
 */
export interface SourceMetadata {
    name: string;
    description: string;
    bundleCount: number;
    lastUpdated: string;
    version: string;
}

/**
 * Source synced event data
 */
export interface SourceSyncedEvent {
    sourceId: string;
    bundleCount: number;
}

/**
 * Auto-update preference changed event data
 */
export interface AutoUpdatePreferenceChangedEvent {
    bundleId: string;
    enabled: boolean;
}

/**
 * Deployment manifest (from bundle spec)
 */
export interface DeploymentManifest {
    common: {
        directories: string[];
        files: string[];
        include_patterns: string[];
        exclude_patterns: string[];
    };
    environments?: {
        [key: string]: {
            name: string;
            description: string;
            directories: string[];
            files: string[];
            include_patterns: string[];
            exclude_patterns: string[];
            bundle_structure?: {
                preserve_paths: boolean;
                root_folder: string;
            };
            metadata?: Record<string, any>;
        };
    };
    bundle_settings: {
        include_common_in_environment_bundles: boolean;
        create_common_bundle: boolean;
        compression: CompressionFormat;
        naming: {
            common_bundle?: string;
            environment_bundle: string;
            full_bundle?: string;
        };
    isCurated?: boolean;  // True if bundle is from a curated hub
    hubName?: string;  // Name of the curated hub
        checksum?: {
            enabled: boolean;
            algorithms: string[];
        };
        output_directory?: string;
    };
    metadata: {
        manifest_version: string;
        prompt_library_version?: string;
        last_updated?: string;
        description: string;
        author?: string;
        homepage?: string;
        repository?: {
            type: string;
            url: string;
            directory?: string;
        };
        license?: string;
        keywords?: string[];
        compatibility?: {
            min_manifest_version?: string;
            platforms?: string[];
        };
    };
    hooks?: {
        pre_bundle?: string[];
        post_bundle?: string[];
        pre_install?: string[];
        post_install?: string[];
    };
    prompts?: Array<{
        id: string;
        name: string;
        description: string;
        file: string;
        tags?: string[];
        type?: 'prompt' | 'instructions' | 'chatmode' | 'agent'; // GitHub Copilot file type
    }>;
    mcpServers?: McpServersManifest;
}

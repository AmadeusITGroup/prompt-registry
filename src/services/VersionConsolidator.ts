import { Bundle, SourceType } from '../types/registry';
import { VersionManager } from '../utils/versionManager';
import { Logger } from '../utils/logger';

/**
 * Version metadata for a bundle
 */
export interface BundleVersion {
    version: string;
    publishedAt: string;
    downloadUrl: string;
    manifestUrl: string;
    releaseNotes?: string;
}

/**
 * Consolidated bundle with version information
 */
export interface ConsolidatedBundle extends Bundle {
    // All standard Bundle fields represent the latest version
    availableVersions: BundleVersion[];  // All versions available
    isConsolidated: boolean;  // True if multiple versions exist
}

/**
 * Service for consolidating multiple bundle versions into single entries
 * 
 * This service groups bundles by their identity (owner/repo for GitHub sources)
 * and selects the latest version based on semantic versioning. It maintains
 * a cache of all available versions for potential future access.
 */
export class VersionConsolidator {
    private static readonly MAX_CACHE_SIZE = 1000;
    
    private versionCache: Map<string, BundleVersion[]> = new Map();
    private logger = Logger.getInstance();
    private sourceTypeResolver?: (sourceId: string) => SourceType;
    
    /**
     * Set a custom source type resolver function
     * 
     * This allows the consolidator to accurately determine source types
     * instead of relying on heuristics.
     * 
     * @param resolver - Function that maps sourceId to SourceType
     */
    setSourceTypeResolver(resolver: (sourceId: string) => SourceType): void {
        this.sourceTypeResolver = resolver;
    }
    
    /**
     * Consolidate bundles by grouping versions of the same bundle
     * 
     * For GitHub sources, bundles with the same owner/repo are grouped together
     * and only the latest version is returned. For non-GitHub sources, bundles
     * are returned unchanged.
     * 
     * @param bundles - Array of bundles from various sources
     * @returns Consolidated bundles with latest version metadata
     */
    consolidateBundles(bundles: Bundle[]): ConsolidatedBundle[] {
        this.logger.debug(`Consolidating ${bundles.length} bundles`);
        
        // Pre-calculate identities to avoid redundant computation
        const bundlesWithIdentity = bundles.map(bundle => ({
            bundle,
            identity: this.getBundleIdentity(bundle)
        }));
        
        // Group bundles by identity (owner/repo for GitHub)
        const grouped = new Map<string, typeof bundlesWithIdentity>();
        
        for (const item of bundlesWithIdentity) {
            if (!grouped.has(item.identity)) {
                grouped.set(item.identity, []);
            }
            grouped.get(item.identity)!.push(item);
        }
        
        this.logger.debug(`Grouped into ${grouped.size} unique identities`);
        
        // For each group, select latest version
        const consolidated: ConsolidatedBundle[] = [];
        
        for (const [identity, items] of grouped.entries()) {
            const bundles = items.map(item => item.bundle);
            
            if (bundles.length === 1) {
                // Single version - no consolidation needed, but still cache for consistency
                const version = this.toBundleVersion(bundles[0]);
                this.addToCache(identity, [version]);
                
                consolidated.push({
                    ...bundles[0],
                    availableVersions: [version],
                    isConsolidated: false
                });
                continue;
            }
            
            // Multiple versions - find latest using version comparison
            const sortedVersions = this.sortBundlesByVersion(bundles);
            const latest = sortedVersions[0];
            const allVersions = sortedVersions.map(b => this.toBundleVersion(b));
            
            // Cache versions for this identity (with size management)
            this.addToCache(identity, allVersions);
            
            this.logger.debug(`Consolidated ${bundles.length} versions for "${identity}", latest: ${latest.version}`);
            
            consolidated.push({
                ...latest,
                availableVersions: allVersions,
                isConsolidated: true
            });
        }
        
        return consolidated;
    }
    
    /**
     * Get all available versions for a consolidated bundle
     * 
     * @param bundleIdentity - Unique identifier for the bundle
     * @returns Array of all versions sorted by recency (latest first)
     */
    getAvailableVersions(bundleIdentity: string): BundleVersion[] {
        return this.versionCache.get(bundleIdentity) || [];
    }
    
    /**
     * Get a specific version of a bundle
     * 
     * This is useful when a user wants to install a specific version
     * instead of the latest version.
     * 
     * @param bundleIdentity - Unique identifier for the bundle
     * @param version - Specific version to retrieve
     * @returns Bundle version metadata, or undefined if not found
     */
    getBundleVersion(bundleIdentity: string, version: string): BundleVersion | undefined {
        const versions = this.versionCache.get(bundleIdentity);
        return versions?.find(v => v.version === version);
    }
    
    /**
     * Clear version cache
     */
    clearCache(): void {
        this.versionCache.clear();
        this.logger.debug('Version cache cleared');
    }
    
    /**
     * Add entry to cache with size management
     * 
     * If cache exceeds MAX_CACHE_SIZE, removes the oldest entry (first in map).
     * This is a simple FIFO eviction strategy.
     */
    private addToCache(key: string, versions: BundleVersion[]): void {
        if (this.versionCache.size >= VersionConsolidator.MAX_CACHE_SIZE) {
            const firstKey = this.versionCache.keys().next().value;
            if (firstKey) {
                this.versionCache.delete(firstKey);
                this.logger.debug(`Cache size limit reached, evicted: ${firstKey}`);
            }
        }
        this.versionCache.set(key, versions);
    }
    
    /**
     * Get bundle identity based on source type
     * For GitHub: extract owner-repo from bundle ID
     * For others: use bundle ID as-is
     */
    private getBundleIdentity(bundle: Bundle): string {
        // Use custom resolver if provided, otherwise fall back to heuristic
        const sourceType = this.sourceTypeResolver 
            ? this.sourceTypeResolver(bundle.sourceId)
            : this.inferSourceType(bundle.sourceId);
        return VersionManager.extractBundleIdentity(bundle.id, sourceType);
    }
    
    /**
     * Infer source type from source ID using heuristics
     * 
     * This is a fallback approach when no resolver is provided.
     * Ideally, the actual source configuration should be used.
     * 
     * @param sourceId - Source identifier to analyze
     * @returns Inferred source type (defaults to 'local' for unknown types)
     */
    private inferSourceType(sourceId: string): SourceType {
        if (sourceId.includes('github')) {
            return 'github';
        } else if (sourceId.includes('gitlab')) {
            return 'gitlab';
        } else if (sourceId.includes('http')) {
            return 'http';
        } else if (sourceId.includes('awesome')) {
            return 'awesome-copilot';
        } else if (sourceId.includes('local')) {
            return 'local';
        }
        // Default to treating as non-consolidatable (safe default)
        this.logger.debug(`Could not infer source type from "${sourceId}", treating as non-consolidatable`);
        return 'local';
    }
    
    /**
     * Sort bundles by version in descending order (latest first)
     */
    private sortBundlesByVersion(bundles: Bundle[]): Bundle[] {
        return bundles.sort((a, b) => {
            try {
                return VersionManager.compareVersions(b.version, a.version);
            } catch (error) {
                // If version comparison fails, fall back to date comparison
                const errorMsg = error instanceof Error ? error.message : String(error);
                this.logger.warn(`Version comparison failed for ${a.id} and ${b.id}: ${errorMsg}. Using dates`);
                return new Date(b.lastUpdated).getTime() - new Date(a.lastUpdated).getTime();
            }
        });
    }
    
    /**
     * Convert Bundle to BundleVersion metadata
     */
    private toBundleVersion(bundle: Bundle): BundleVersion {
        return {
            version: bundle.version,
            publishedAt: bundle.lastUpdated,
            downloadUrl: bundle.downloadUrl,
            manifestUrl: bundle.manifestUrl,
            releaseNotes: undefined // Could be extracted from bundle metadata
        };
    }
}

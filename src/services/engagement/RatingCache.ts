/**
 * RatingCache - In-memory cache for bundle ratings
 * 
 * Provides synchronous access to ratings for UI components like TreeView
 * that cannot use async methods in their render path.
 * 
 * The cache is populated by:
 * 1. Background refresh on extension activation
 * 2. Manual refresh via commands
 * 3. Automatic refresh when RatingService fetches new data
 */

import * as vscode from 'vscode';
import { RatingService, BundleRating, RatingsData } from './RatingService';
import { Logger } from '../../utils/logger';

/**
 * Cached rating entry with metadata
 */
export interface CachedRating {
    /** Source ID */
    sourceId: string;
    /** Bundle ID */
    bundleId: string;
    /** Star rating (1-5) */
    starRating: number;
    /** Wilson score (0-1) */
    wilsonScore: number;
    /** Total vote count */
    voteCount: number;
    /** Confidence level */
    confidence: 'low' | 'medium' | 'high' | 'very_high';
    /** When this entry was cached */
    cachedAt: number;
}

/**
 * Rating display format for UI
 */
export interface RatingDisplay {
    /** Formatted string like "★ 4.2" */
    text: string;
    /** Tooltip with more details */
    tooltip: string;
}

/**
 * RatingCache provides synchronous access to pre-fetched ratings
 */
export class RatingCache {
    private static instance: RatingCache;
    private cache: Map<string, CachedRating> = new Map();
    private logger: Logger;
    private refreshPromise: Promise<void> | null = null;

    // Events
    private _onCacheUpdated = new vscode.EventEmitter<void>();
    readonly onCacheUpdated = this._onCacheUpdated.event;

    private constructor() {
        this.logger = Logger.getInstance();
    }

    /**
     * Get singleton instance
     */
    static getInstance(): RatingCache {
        if (!RatingCache.instance) {
            RatingCache.instance = new RatingCache();
        }
        return RatingCache.instance;
    }

    /**
     * Reset instance (for testing)
     */
    static resetInstance(): void {
        if (RatingCache.instance) {
            RatingCache.instance.dispose();
            RatingCache.instance = undefined as any;
        }
    }

    /**
     * Dispose resources
     */
    dispose(): void {
        this._onCacheUpdated.dispose();
        this.cache.clear();
    }

    /**
     * Get rating for a bundle (synchronous)
     * Returns undefined if not cached
     */
    getRating(sourceId: string, bundleId: string): CachedRating | undefined {
        const key = this.makeKey(sourceId, bundleId);
        return this.cache.get(key);
    }

    /**
     * Create composite key from sourceId and bundleId
     */
    private makeKey(sourceId: string, bundleId: string): string {
        return `${sourceId}:${bundleId}`;
    }

    /**
     * Get formatted rating display for UI
     * Returns undefined if not cached or no rating
     */
    getRatingDisplay(sourceId: string, bundleId: string): RatingDisplay | undefined {
        const rating = this.getRating(sourceId, bundleId);
        if (!rating || rating.voteCount === 0) {
            return undefined;
        }

        return {
            text: this.formatRating(rating.starRating, rating.voteCount),
            tooltip: this.formatTooltip(rating)
        };
    }

    /**
     * Format rating for display
     */
    private formatRating(starRating: number, voteCount: number): string {
        if (voteCount === 0) {
            return '';
        }
        // Show star with rating, e.g., "★ 4.2"
        return `★ ${starRating.toFixed(1)}`;
    }

    /**
     * Format tooltip with detailed info
     */
    private formatTooltip(rating: CachedRating): string {
        const lines = [
            `Rating: ${rating.starRating.toFixed(1)} / 5`,
            `Votes: ${rating.voteCount}`,
            `Confidence: ${rating.confidence}`
        ];
        return lines.join('\n');
    }

    /**
     * Check if a bundle has a cached rating
     */
    hasRating(sourceId: string, bundleId: string): boolean {
        const key = this.makeKey(sourceId, bundleId);
        return this.cache.has(key);
    }

    /**
     * Get all cached bundle IDs
     */
    getCachedBundleIds(): string[] {
        return Array.from(this.cache.keys());
    }

    /**
     * Get cache size
     */
    get size(): number {
        return this.cache.size;
    }

    /**
     * Refresh cache from RatingService for a specific hub
     * This is async but updates the cache for synchronous access
     * @param hubId Hub identifier
     * @param ratingsUrl URL to ratings.json
     * @param sourceIdMap Map from ratings.json source_id to actual extension source ID
     */
    async refreshFromHub(hubId: string, ratingsUrl: string, sourceIdMap?: Map<string, string>): Promise<void> {
        // Prevent concurrent refreshes
        if (this.refreshPromise) {
            return this.refreshPromise;
        }

        this.refreshPromise = this.doRefresh(hubId, ratingsUrl, sourceIdMap);
        try {
            await this.refreshPromise;
        } finally {
            this.refreshPromise = null;
        }
    }

    /**
     * Internal refresh implementation
     */
    private async doRefresh(hubId: string, ratingsUrl: string, sourceIdMap?: Map<string, string>): Promise<void> {
        try {
            const ratingService = RatingService.getInstance();
            const ratingsData = await ratingService.fetchRatings(ratingsUrl);

            if (!ratingsData || !ratingsData.bundles) {
                this.logger.debug(`No ratings data available from ${hubId}`);
                return;
            }

            // Update cache with new ratings
            const now = Date.now();
            const bundles = ratingsData.bundles;
            for (const [bundleId, rating] of Object.entries(bundles)) {
                // Map the sourceId from ratings.json to the actual extension source ID
                const actualSourceId = sourceIdMap?.get(rating.sourceId) || rating.sourceId;
                const key = this.makeKey(actualSourceId, bundleId);
                this.cache.set(key, {
                    sourceId: actualSourceId,
                    bundleId,
                    starRating: rating.starRating,
                    wilsonScore: rating.wilsonScore,
                    voteCount: rating.totalVotes,
                    confidence: this.getConfidenceLevel(rating.totalVotes),
                    cachedAt: now
                });
            }

            this.logger.debug(`RatingCache refreshed: ${Object.keys(bundles).length} ratings from ${hubId}`);
            this._onCacheUpdated.fire();
        } catch (error) {
            this.logger.warn(`Failed to refresh rating cache from ${hubId}: ${error}`);
            // Don't clear cache on error - keep stale data
        }
    }

    /**
     * Calculate confidence level based on vote count
     */
    private getConfidenceLevel(voteCount: number): CachedRating['confidence'] {
        if (voteCount < 5) {
            return 'low';
        } else if (voteCount < 20) {
            return 'medium';
        } else if (voteCount < 100) {
            return 'high';
        } else {
            return 'very_high';
        }
    }

    /**
     * Manually set a rating (for testing or local updates)
     */
    setRating(rating: CachedRating): void {
        const key = this.makeKey(rating.sourceId, rating.bundleId);
        this.cache.set(key, rating);
    }

    /**
     * Clear all cached ratings
     */
    clear(): void {
        this.cache.clear();
        this._onCacheUpdated.fire();
    }

    /**
     * Clear ratings for a specific hub (by prefix matching)
     */
    clearHub(hubIdPrefix: string): void {
        for (const bundleId of this.cache.keys()) {
            if (bundleId.startsWith(hubIdPrefix)) {
                this.cache.delete(bundleId);
            }
        }
        this._onCacheUpdated.fire();
    }
}

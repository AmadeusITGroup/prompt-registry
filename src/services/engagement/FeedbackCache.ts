/**
 * FeedbackCache - In-memory cache for bundle feedbacks
 * 
 * Provides synchronous access to feedbacks for UI components like TreeView
 * that cannot use async methods in their render path.
 * 
 * The cache is populated by:
 * 1. Background refresh on extension activation
 * 2. Manual refresh via commands
 * 3. Automatic refresh when FeedbackService fetches new data
 */

import * as vscode from 'vscode';
import { FeedbackService, FeedbacksData, BundleFeedback } from './FeedbackService';
import { Logger } from '../../utils/logger';

/**
 * Cached feedback entry with metadata
 */
export interface CachedFeedback {
    /** Feedback ID */
    id: string;
    /** Bundle ID */
    bundleId: string;
    /** Rating (1-5) if provided */
    rating?: number;
    /** Comment text */
    comment: string;
    /** ISO timestamp */
    timestamp: string;
    /** Bundle version at time of feedback */
    version?: string;
    /** When this entry was cached */
    cachedAt: number;
}

/**
 * FeedbackCache provides synchronous access to pre-fetched feedbacks
 */
export class FeedbackCache {
    private static instance: FeedbackCache;
    private cache: Map<string, CachedFeedback[]> = new Map();
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
    static getInstance(): FeedbackCache {
        if (!FeedbackCache.instance) {
            FeedbackCache.instance = new FeedbackCache();
        }
        return FeedbackCache.instance;
    }

    /**
     * Reset instance (for testing)
     */
    static resetInstance(): void {
        if (FeedbackCache.instance) {
            FeedbackCache.instance.dispose();
            FeedbackCache.instance = undefined as any;
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
     * Get feedbacks for a bundle (synchronous)
     * Returns undefined if not cached
     */
    getFeedbacks(bundleId: string): CachedFeedback[] | undefined {
        return this.cache.get(bundleId);
    }

    /**
     * Check if a bundle has cached feedbacks
     */
    hasFeedbacks(bundleId: string): boolean {
        return this.cache.has(bundleId);
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
     * Refresh cache from FeedbackService for a specific hub
     * This is async but updates the cache for synchronous access
     */
    async refreshFromHub(hubId: string, feedbacksUrl: string): Promise<void> {
        // Prevent concurrent refreshes
        if (this.refreshPromise) {
            return this.refreshPromise;
        }

        this.refreshPromise = this.doRefresh(hubId, feedbacksUrl);
        try {
            await this.refreshPromise;
        } finally {
            this.refreshPromise = null;
        }
    }

    /**
     * Internal refresh implementation
     */
    private async doRefresh(hubId: string, feedbacksUrl: string): Promise<void> {
        try {
            const feedbackService = FeedbackService.getInstance();
            const feedbacksData = await feedbackService.fetchFeedbacks(feedbacksUrl);

            if (!feedbacksData || !feedbacksData.bundles) {
                this.logger.debug(`No feedbacks data available from ${hubId}`);
                return;
            }

            // Update cache with new feedbacks
            const now = Date.now();
            const bundles = feedbacksData.bundles;
            
            for (const bundleCollection of bundles) {
                const cachedFeedbacks: CachedFeedback[] = bundleCollection.feedbacks.map(feedback => ({
                    id: feedback.id,
                    bundleId: bundleCollection.bundleId,
                    rating: feedback.rating,
                    comment: feedback.comment,
                    timestamp: feedback.timestamp,
                    version: feedback.version,
                    cachedAt: now
                }));

                this.cache.set(bundleCollection.bundleId, cachedFeedbacks);
            }

            this.logger.debug(`FeedbackCache refreshed: ${bundles.length} bundles from ${hubId}`);
            this._onCacheUpdated.fire();
        } catch (error) {
            this.logger.warn(`Failed to refresh feedback cache from ${hubId}: ${error}`);
            // Don't clear cache on error - keep stale data
        }
    }

    /**
     * Manually set feedbacks (for testing or local updates)
     */
    setFeedbacks(bundleId: string, feedbacks: CachedFeedback[]): void {
        this.cache.set(bundleId, feedbacks);
    }

    /**
     * Clear all cached feedbacks
     */
    clear(): void {
        this.cache.clear();
        this._onCacheUpdated.fire();
    }

    /**
     * Clear feedbacks for a specific hub (by prefix matching)
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

export { FeedbacksData };

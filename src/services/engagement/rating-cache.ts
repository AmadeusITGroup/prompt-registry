/* eslint-disable @typescript-eslint/member-ordering -- phase 2: reorganize members when feedback is re-integrated onto main */
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
import {
  RatingScore,
} from '../../types/engagement';
import {
  Logger,
} from '../../utils/logger';
import {
  RatingService,
} from './rating-service';

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
  private readonly cache: Map<string, CachedRating> = new Map();
  private readonly logger: Logger;
  private refreshPromise: Promise<void> | null = null;

  // Events
  private readonly _onCacheUpdated = new vscode.EventEmitter<void>();
  public readonly onCacheUpdated = this._onCacheUpdated.event;

  private constructor() {
    this.logger = Logger.getInstance();
  }

  /**
   * Get singleton instance
   */
  public static getInstance(): RatingCache {
    if (!RatingCache.instance) {
      RatingCache.instance = new RatingCache();
    }
    return RatingCache.instance;
  }

  /**
   * Reset instance (for testing)
   */
  public static resetInstance(): void {
    if (RatingCache.instance) {
      RatingCache.instance.dispose();
      RatingCache.instance = undefined as any;
    }
  }

  /**
   * Dispose resources
   */
  public dispose(): void {
    this._onCacheUpdated.dispose();
    this.cache.clear();
  }

  /**
   * Get rating for a bundle (synchronous)
   * Returns undefined if not cached
   * @param sourceId
   * @param bundleId
   */
  public getRating(sourceId: string, bundleId: string): CachedRating | undefined {
    const key = this.makeKey(sourceId, bundleId);
    return this.cache.get(key);
  }

  /**
   * Create composite key from sourceId and bundleId
   * @param sourceId
   * @param bundleId
   */
  private makeKey(sourceId: string, bundleId: string): string {
    return `${sourceId}:${bundleId}`;
  }

  /**
   * Get formatted rating display for UI
   * Returns undefined if not cached or no rating
   * @param sourceId
   * @param bundleId
   */
  public getRatingDisplay(sourceId: string, bundleId: string): RatingDisplay | undefined {
    const rating = this.getRating(sourceId, bundleId);
    if (!rating || rating.voteCount === 0 || rating.starRating === 0) {
      return undefined;
    }

    return {
      text: this.formatRating(rating.starRating, rating.voteCount),
      tooltip: this.formatTooltip(rating)
    };
  }

  /**
   * Format rating for display
   * @param starRating
   * @param voteCount
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
   * @param rating
   */
  private formatTooltip(rating: CachedRating): string {
    const lines = [
      `Rating: ${rating.starRating.toFixed(1)} / 5`,
      `Votes: ${rating.voteCount}`
    ];
    return lines.join('\n');
  }

  /**
   * Check if a bundle has a cached rating
   * @param sourceId
   * @param bundleId
   */
  public hasRating(sourceId: string, bundleId: string): boolean {
    const key = this.makeKey(sourceId, bundleId);
    return this.cache.has(key);
  }

  /**
   * Get all cached bundle IDs
   */
  public getCachedBundleIds(): string[] {
    return Array.from(this.cache.keys());
  }

  /**
   * Get cache size
   */
  public get size(): number {
    return this.cache.size;
  }

  /**
   * Refresh cache from RatingService for a specific hub
   * This is async but updates the cache for synchronous access
   * @param hubId Hub identifier
   * @param ratingsUrl URL to ratings.json
   * @param sourceIdMap Map from ratings.json source_id to actual extension source ID
   */
  public async refreshFromHub(hubId: string, ratingsUrl: string, sourceIdMap?: Map<string, string>): Promise<void> {
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
   * @param hubId
   * @param ratingsUrl
   * @param sourceIdMap
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
   * @param voteCount
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
   * @param rating
   */
  public setRating(rating: CachedRating): void {
    const key = this.makeKey(rating.sourceId, rating.bundleId);
    this.cache.set(key, rating);
  }

  /**
   * Apply an optimistic rating update after user submits feedback.
   * Recalculates the displayed rating client-side.
   * Will be silently overwritten on next ratings.json fetch.
   * @param sourceId
   * @param bundleId
   * @param userRating
   */
  public applyOptimisticRating(sourceId: string, bundleId: string, userRating: RatingScore): void {
    const key = this.makeKey(sourceId, bundleId);
    const existing = this.cache.get(key);

    if (existing) {
      const newVoteCount = existing.voteCount + 1;
      const newStarRating = (existing.starRating * existing.voteCount + userRating) / newVoteCount;

      this.cache.set(key, {
        ...existing,
        starRating: Math.round(newStarRating * 10) / 10,
        voteCount: newVoteCount,
        cachedAt: Date.now()
      });
    } else {
      this.cache.set(key, {
        sourceId,
        bundleId,
        starRating: userRating,
        wilsonScore: 0,
        voteCount: 1,
        confidence: 'low',
        cachedAt: Date.now()
      });
    }

    this._onCacheUpdated.fire();
  }

  /**
   * Clear all cached ratings
   */
  public clear(): void {
    this.cache.clear();
    this._onCacheUpdated.fire();
  }

  /**
   * Clear ratings for a specific hub (by prefix matching)
   * @param hubIdPrefix
   */
  public clearHub(hubIdPrefix: string): void {
    for (const bundleId of this.cache.keys()) {
      if (bundleId.startsWith(hubIdPrefix)) {
        this.cache.delete(bundleId);
      }
    }
    this._onCacheUpdated.fire();
  }
}

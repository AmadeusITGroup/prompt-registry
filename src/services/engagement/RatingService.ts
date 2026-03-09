/**
 * RatingService - Fetches and caches bundle ratings from hub sources
 * 
 * Ratings are served as static JSON files from hubs, computed by GitHub Actions.
 * This service fetches, caches, and provides ratings data to UI components.
 */

import axios from 'axios';
import { Logger } from '../../utils/logger';
import { RatingStats } from '../../types/engagement';

/**
 * Rating data for a single bundle
 */
export interface BundleRating {
    sourceId: string;
    bundleId: string;
    upvotes: number;
    downvotes: number;
    wilsonScore: number;
    starRating: number;
    totalVotes: number;
    lastUpdated: string;
    /** Discussion number for voting (if available) */
    discussionNumber?: number;
    /** Confidence level based on vote count */
    confidence?: string;
}

/**
 * Ratings file structure served by hubs (bundles format)
 */
export interface RatingsData {
    version: string;
    generatedAt: string;
    bundles: Record<string, BundleRating>;
}

/**
 * Collection rating from compute-ratings.ts output
 */
export interface CollectionRating {
    source_id?: string;
    discussion_number: number;
    up: number;
    down: number;
    wilson_score: number;
    bayesian_score: number;
    aggregated_score: number;
    star_rating: number;
    rating_count: number;
    confidence: string;
    resources: Record<string, {
        up: number;
        down: number;
        wilson_score: number;
        bayesian_score: number;
        star_rating: number;
        confidence: string;
    }>;
}

/**
 * Ratings file structure from compute-ratings.ts (collections format)
 */
export interface CollectionsRatingsData {
    generated_at: string;
    repository: string;
    collections: Record<string, CollectionRating>;
}

/**
 * Service for fetching and caching bundle ratings
 */
export class RatingService {
    private static instance: RatingService;
    private readonly logger = Logger.getInstance();
    private ratingsCache: Map<string, RatingsData> = new Map();
    private cacheExpiry: Map<string, number> = new Map();
    private readonly cacheDurationMs: number;

    private constructor(cacheDurationMinutes: number = 15) {
        this.cacheDurationMs = cacheDurationMinutes * 60 * 1000;
    }

    /**
     * Get singleton instance
     */
    static getInstance(): RatingService {
        if (!RatingService.instance) {
            RatingService.instance = new RatingService();
        }
        return RatingService.instance;
    }

    /**
     * Reset instance (for testing)
     */
    static resetInstance(): void {
        RatingService.instance = undefined as unknown as RatingService;
    }

    /**
     * Fetch ratings from a hub's ratings.json URL
     * @param ratingsUrl URL to the ratings.json file
     * @param forceRefresh Force refresh even if cached
     */
    async fetchRatings(ratingsUrl: string, forceRefresh: boolean = false): Promise<RatingsData | undefined> {
        // Check cache
        if (!forceRefresh && this.ratingsCache.has(ratingsUrl)) {
            const expiry = this.cacheExpiry.get(ratingsUrl) || 0;
            if (Date.now() < expiry) {
                return this.ratingsCache.get(ratingsUrl);
            }
        }

        try {
            // Add cache-busting query parameter (handle existing query params)
            const separator = ratingsUrl.includes('?') ? '&' : '?';
            const urlWithCacheBust = `${ratingsUrl}${separator}t=${Date.now()}`;
            const response = await axios.get(urlWithCacheBust, {
                timeout: 10000,
                headers: {
                    'Accept': 'application/json',
                },
            });

            const rawData = response.data;
            
            // Handle both formats: bundles (new) and collections (compute-ratings.ts output)
            let normalizedData: RatingsData;
            
            if (rawData.bundles && typeof rawData.bundles === 'object') {
                // Already in bundles format
                normalizedData = rawData as RatingsData;
            } else if (rawData.collections && typeof rawData.collections === 'object') {
                // Convert collections format to bundles format
                normalizedData = this.convertCollectionsToBundle(rawData as CollectionsRatingsData);
            } else {
                this.logger.warn(`Invalid ratings data from ${ratingsUrl}: missing bundles or collections`);
                return undefined;
            }

            // Cache the normalized result
            this.ratingsCache.set(ratingsUrl, normalizedData);
            this.cacheExpiry.set(ratingsUrl, Date.now() + this.cacheDurationMs);

            this.logger.debug(`Fetched ratings from ${ratingsUrl}: ${Object.keys(normalizedData.bundles).length} bundles`);
            return normalizedData;
        } catch (error) {
            const err = error instanceof Error ? error : undefined;
            this.logger.debug(`Failed to fetch ratings from ${ratingsUrl}`, err);
            return undefined;
        }
    }

    /**
     * Convert collections format (from compute-ratings.ts) to bundles format
     */
    private convertCollectionsToBundle(collectionsData: CollectionsRatingsData): RatingsData {
        const bundles: Record<string, BundleRating> = {};

        for (const [collectionId, collection] of Object.entries(collectionsData.collections)) {
            bundles[collectionId] = {
                sourceId: collection.source_id || 'unknown',
                bundleId: collectionId,
                upvotes: collection.up,
                downvotes: collection.down,
                wilsonScore: collection.wilson_score,
                starRating: collection.star_rating,
                totalVotes: collection.rating_count || 0,
                lastUpdated: collectionsData.generated_at,
                discussionNumber: collection.discussion_number,
                confidence: collection.confidence,
            };
        }

        return {
            version: '1.0.0',
            generatedAt: collectionsData.generated_at,
            bundles,
        };
    }

    /**
     * Get rating for a specific bundle
     * @param ratingsUrl URL to the ratings.json file
     * @param bundleId Bundle identifier
     */
    async getBundleRating(ratingsUrl: string, bundleId: string): Promise<BundleRating | undefined> {
        const ratings = await this.fetchRatings(ratingsUrl);
        return ratings?.bundles[bundleId];
    }

    /**
     * Get rating stats for a bundle (compatible with RatingStats type)
     * @param ratingsUrl URL to the ratings.json file
     * @param bundleId Bundle identifier
     */
    async getRatingStats(ratingsUrl: string, bundleId: string): Promise<RatingStats | undefined> {
        const rating = await this.getBundleRating(ratingsUrl, bundleId);
        if (!rating) {
            return undefined;
        }

        // Convert BundleRating to RatingStats
        // Map upvotes to 5-star, downvotes to 1-star for distribution
        return {
            resourceId: bundleId,
            averageRating: rating.starRating,
            ratingCount: rating.totalVotes,
            distribution: {
                1: rating.downvotes,
                2: 0,
                3: 0,
                4: 0,
                5: rating.upvotes,
            },
        };
    }

    /**
     * Format rating for display in tree view
     * @param rating Bundle rating data
     * @returns Formatted string like "★ 4.2" or "👍 42"
     */
    formatRatingForDisplay(rating: BundleRating): string {
        if (rating.totalVotes === 0) {
            return '';
        }

        // Use star rating if we have enough votes for confidence
        if (rating.totalVotes >= 5) {
            return `★ ${rating.starRating.toFixed(1)}`;
        }

        // For fewer votes, just show thumbs up count
        return `👍 ${rating.upvotes}`;
    }

    /**
     * Get formatted rating string for a bundle
     * @param ratingsUrl URL to the ratings.json file
     * @param bundleId Bundle identifier
     */
    async getFormattedRating(ratingsUrl: string, bundleId: string): Promise<string> {
        const rating = await this.getBundleRating(ratingsUrl, bundleId);
        if (!rating) {
            return '';
        }
        return this.formatRatingForDisplay(rating);
    }

    /**
     * Clear all cached ratings
     */
    clearCache(): void {
        this.ratingsCache.clear();
        this.cacheExpiry.clear();
    }

    /**
     * Clear cached ratings for a specific URL
     */
    clearCacheForUrl(ratingsUrl: string): void {
        this.ratingsCache.delete(ratingsUrl);
        this.cacheExpiry.delete(ratingsUrl);
    }

    /**
     * Check if ratings are cached for a URL
     */
    isCached(ratingsUrl: string): boolean {
        if (!this.ratingsCache.has(ratingsUrl)) {
            return false;
        }
        const expiry = this.cacheExpiry.get(ratingsUrl) || 0;
        return Date.now() < expiry;
    }
}

/**
 * FeedbackService - Fetches and caches bundle feedbacks from hub sources
 * 
 * Feedbacks are served as static JSON files from hubs, computed by GitHub Actions.
 * This service fetches, caches, and provides feedback data to UI components.
 */

import axios from 'axios';
import { Logger } from '../../utils/logger';

/**
 * Feedback data for a single user feedback entry
 */
export interface BundleFeedback {
    id: string;
    rating?: number;
    comment: string;
    timestamp: string;
    version?: string;
}

/**
 * Feedbacks for a single bundle
 */
export interface BundleFeedbackCollection {
    bundleId: string;
    feedbacks: BundleFeedback[];
}

/**
 * Feedbacks file structure served by hubs
 */
export interface FeedbacksData {
    version: string;
    generated: string;
    bundles: BundleFeedbackCollection[];
}

/**
 * Service for fetching and caching bundle feedbacks
 */
export class FeedbackService {
    private static instance: FeedbackService;
    private readonly logger = Logger.getInstance();
    private feedbacksCache: Map<string, FeedbacksData> = new Map();
    private cacheExpiry: Map<string, number> = new Map();
    private readonly cacheDurationMs: number;

    private constructor(cacheDurationMinutes: number = 15) {
        this.cacheDurationMs = cacheDurationMinutes * 60 * 1000;
    }

    /**
     * Get singleton instance
     */
    static getInstance(): FeedbackService {
        if (!FeedbackService.instance) {
            FeedbackService.instance = new FeedbackService();
        }
        return FeedbackService.instance;
    }

    /**
     * Reset instance (for testing)
     */
    static resetInstance(): void {
        FeedbackService.instance = undefined as unknown as FeedbackService;
    }

    /**
     * Fetch feedbacks from a URL with caching
     */
    async fetchFeedbacks(feedbacksUrl: string): Promise<FeedbacksData | null> {
        // Check cache first
        const cached = this.feedbacksCache.get(feedbacksUrl);
        const expiry = this.cacheExpiry.get(feedbacksUrl);

        if (cached && expiry && Date.now() < expiry) {
            this.logger.debug(`Using cached feedbacks from ${feedbacksUrl}`);
            return cached;
        }

        try {
            this.logger.debug(`Fetching feedbacks from ${feedbacksUrl}`);
            const response = await axios.get<FeedbacksData>(feedbacksUrl, {
                timeout: 10000,
                headers: {
                    'Accept': 'application/json'
                }
            });

            const data = response.data;

            // Validate structure
            if (!data || typeof data !== 'object') {
                this.logger.warn(`Invalid feedbacks data from ${feedbacksUrl}`);
                return null;
            }

            if (!data.version || !data.bundles || !Array.isArray(data.bundles)) {
                this.logger.warn(`Malformed feedbacks data from ${feedbacksUrl}`);
                return null;
            }

            // Cache the result
            this.feedbacksCache.set(feedbacksUrl, data);
            this.cacheExpiry.set(feedbacksUrl, Date.now() + this.cacheDurationMs);

            this.logger.debug(`Fetched ${data.bundles.length} bundle feedbacks from ${feedbacksUrl}`);
            return data;
        } catch (error) {
            if (axios.isAxiosError(error)) {
                if (error.response?.status === 404) {
                    this.logger.debug(`Feedbacks not found at ${feedbacksUrl}`);
                } else {
                    this.logger.warn(`Failed to fetch feedbacks from ${feedbacksUrl}: ${error.message}`);
                }
            } else {
                this.logger.warn(`Error fetching feedbacks: ${error}`);
            }
            return null;
        }
    }

    /**
     * Clear cache for a specific URL
     */
    clearCache(feedbacksUrl?: string): void {
        if (feedbacksUrl) {
            this.feedbacksCache.delete(feedbacksUrl);
            this.cacheExpiry.delete(feedbacksUrl);
        } else {
            this.feedbacksCache.clear();
            this.cacheExpiry.clear();
        }
    }

    /**
     * Get cache size
     */
    get cacheSize(): number {
        return this.feedbacksCache.size;
    }
}

/**
 * EngagementStorage - File-based persistence for engagement data
 *
 * Storage structure:
 * globalStorage/
 * └── engagement/
 *     ├── telemetry.json      # Telemetry events
 *     ├── ratings.json        # User ratings
 *     └── feedback.json       # User feedback
 */

import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import {
    TelemetryEvent,
    TelemetryFilter,
    Rating,
    Feedback,
    EngagementResourceType,
} from '../types/engagement';

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const mkdir = promisify(fs.mkdir);

/**
 * Storage paths for engagement data
 */
interface EngagementStoragePaths {
    root: string;
    telemetry: string;
    ratings: string;
    feedback: string;
}

/**
 * Internal storage format for telemetry
 */
interface TelemetryStore {
    version: string;
    events: TelemetryEvent[];
}

/**
 * Internal storage format for ratings
 */
interface RatingsStore {
    version: string;
    ratings: Rating[];
}

/**
 * Internal storage format for feedback
 */
interface FeedbackStore {
    version: string;
    feedback: Feedback[];
}

/**
 * EngagementStorage manages file-based persistence for engagement data
 */
export class EngagementStorage {
    private paths: EngagementStoragePaths;
    private telemetryCache?: TelemetryStore;
    private ratingsCache?: RatingsStore;
    private feedbackCache?: FeedbackStore;

    private static readonly STORAGE_VERSION = '1.0.0';
    private static readonly MAX_TELEMETRY_EVENTS = 10000;
    private static readonly MAX_FEEDBACK_ENTRIES = 1000;

    constructor(storagePath: string) {
        if (!storagePath || storagePath.trim() === '') {
            throw new Error('Storage path cannot be empty');
        }

        const engagementDir = path.join(storagePath, 'engagement');
        this.paths = {
            root: engagementDir,
            telemetry: path.join(engagementDir, 'telemetry.json'),
            ratings: path.join(engagementDir, 'ratings.json'),
            feedback: path.join(engagementDir, 'feedback.json'),
        };
    }

    /**
     * Initialize storage directories
     */
    async initialize(): Promise<void> {
        if (!fs.existsSync(this.paths.root)) {
            await mkdir(this.paths.root, { recursive: true });
        }
    }

    /**
     * Get storage paths
     */
    getPaths(): EngagementStoragePaths {
        return { ...this.paths };
    }

    // ========================================================================
    // Telemetry Operations
    // ========================================================================

    /**
     * Save a telemetry event
     */
    async saveTelemetryEvent(event: TelemetryEvent): Promise<void> {
        const store = await this.loadTelemetryStore();
        store.events.push(event);

        // Trim old events if exceeding max
        if (store.events.length > EngagementStorage.MAX_TELEMETRY_EVENTS) {
            store.events = store.events.slice(-EngagementStorage.MAX_TELEMETRY_EVENTS);
        }

        await this.saveTelemetryStore(store);
    }

    /**
     * Get telemetry events with optional filtering
     */
    async getTelemetryEvents(filter?: TelemetryFilter): Promise<TelemetryEvent[]> {
        const store = await this.loadTelemetryStore();
        let events = store.events;

        if (filter) {
            if (filter.eventTypes && filter.eventTypes.length > 0) {
                events = events.filter(e => filter.eventTypes!.includes(e.eventType));
            }
            if (filter.resourceTypes && filter.resourceTypes.length > 0) {
                events = events.filter(e => filter.resourceTypes!.includes(e.resourceType));
            }
            if (filter.resourceId) {
                events = events.filter(e => e.resourceId === filter.resourceId);
            }
            if (filter.startDate) {
                events = events.filter(e => e.timestamp >= filter.startDate!);
            }
            if (filter.endDate) {
                events = events.filter(e => e.timestamp <= filter.endDate!);
            }
            if (filter.limit && filter.limit > 0) {
                events = events.slice(-filter.limit);
            }
        }

        return events;
    }

    /**
     * Clear telemetry data
     */
    async clearTelemetry(filter?: TelemetryFilter): Promise<void> {
        if (!filter) {
            // Clear all
            const store: TelemetryStore = {
                version: EngagementStorage.STORAGE_VERSION,
                events: [],
            };
            await this.saveTelemetryStore(store);
            return;
        }

        // Selective clear - keep events that don't match filter
        const store = await this.loadTelemetryStore();
        store.events = store.events.filter(e => {
            if (filter.eventTypes && filter.eventTypes.includes(e.eventType)) {
                return false;
            }
            if (filter.resourceTypes && filter.resourceTypes.includes(e.resourceType)) {
                return false;
            }
            if (filter.resourceId && e.resourceId === filter.resourceId) {
                return false;
            }
            if (filter.startDate && filter.endDate) {
                if (e.timestamp >= filter.startDate && e.timestamp <= filter.endDate) {
                    return false;
                }
            }
            return true;
        });

        await this.saveTelemetryStore(store);
    }

    private async loadTelemetryStore(): Promise<TelemetryStore> {
        if (this.telemetryCache) {
            return this.telemetryCache;
        }

        try {
            const data = await readFile(this.paths.telemetry, 'utf-8');
            this.telemetryCache = JSON.parse(data) as TelemetryStore;
            return this.telemetryCache;
        } catch {
            return {
                version: EngagementStorage.STORAGE_VERSION,
                events: [],
            };
        }
    }

    private async saveTelemetryStore(store: TelemetryStore): Promise<void> {
        await this.initialize();
        await writeFile(this.paths.telemetry, JSON.stringify(store, null, 2), 'utf-8');
        this.telemetryCache = store;
    }

    // ========================================================================
    // Rating Operations
    // ========================================================================

    /**
     * Save or update a rating
     */
    async saveRating(rating: Rating): Promise<void> {
        const store = await this.loadRatingsStore();

        // Find existing rating for same resource
        const existingIndex = store.ratings.findIndex(
            r => r.resourceType === rating.resourceType && r.resourceId === rating.resourceId
        );

        if (existingIndex >= 0) {
            // Update existing
            store.ratings[existingIndex] = rating;
        } else {
            // Add new
            store.ratings.push(rating);
        }

        await this.saveRatingsStore(store);
    }

    /**
     * Get rating for a specific resource
     */
    async getRating(
        resourceType: EngagementResourceType,
        resourceId: string
    ): Promise<Rating | undefined> {
        const store = await this.loadRatingsStore();
        return store.ratings.find(
            r => r.resourceType === resourceType && r.resourceId === resourceId
        );
    }

    /**
     * Get all ratings
     */
    async getAllRatings(): Promise<Rating[]> {
        const store = await this.loadRatingsStore();
        return store.ratings;
    }

    /**
     * Delete rating for a resource
     */
    async deleteRating(
        resourceType: EngagementResourceType,
        resourceId: string
    ): Promise<void> {
        const store = await this.loadRatingsStore();
        store.ratings = store.ratings.filter(
            r => !(r.resourceType === resourceType && r.resourceId === resourceId)
        );
        await this.saveRatingsStore(store);
    }

    private async loadRatingsStore(): Promise<RatingsStore> {
        if (this.ratingsCache) {
            return this.ratingsCache;
        }

        try {
            const data = await readFile(this.paths.ratings, 'utf-8');
            this.ratingsCache = JSON.parse(data) as RatingsStore;
            return this.ratingsCache;
        } catch {
            return {
                version: EngagementStorage.STORAGE_VERSION,
                ratings: [],
            };
        }
    }

    private async saveRatingsStore(store: RatingsStore): Promise<void> {
        await this.initialize();
        await writeFile(this.paths.ratings, JSON.stringify(store, null, 2), 'utf-8');
        this.ratingsCache = store;
    }

    // ========================================================================
    // Feedback Operations
    // ========================================================================

    /**
     * Save feedback
     */
    async saveFeedback(feedback: Feedback): Promise<void> {
        const store = await this.loadFeedbackStore();
        store.feedback.push(feedback);

        // Trim old feedback if exceeding max
        if (store.feedback.length > EngagementStorage.MAX_FEEDBACK_ENTRIES) {
            store.feedback = store.feedback.slice(-EngagementStorage.MAX_FEEDBACK_ENTRIES);
        }

        await this.saveFeedbackStore(store);
    }

    /**
     * Get feedback for a specific resource
     */
    async getFeedback(
        resourceType: EngagementResourceType,
        resourceId: string,
        limit?: number
    ): Promise<Feedback[]> {
        const store = await this.loadFeedbackStore();
        let feedback = store.feedback.filter(
            f => f.resourceType === resourceType && f.resourceId === resourceId
        );

        // Sort by timestamp descending (most recent first)
        feedback.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

        if (limit && limit > 0) {
            feedback = feedback.slice(0, limit);
        }

        return feedback;
    }

    /**
     * Get all feedback
     */
    async getAllFeedback(): Promise<Feedback[]> {
        const store = await this.loadFeedbackStore();
        return store.feedback;
    }

    /**
     * Delete feedback by ID
     */
    async deleteFeedback(feedbackId: string): Promise<void> {
        const store = await this.loadFeedbackStore();
        store.feedback = store.feedback.filter(f => f.id !== feedbackId);
        await this.saveFeedbackStore(store);
    }

    private async loadFeedbackStore(): Promise<FeedbackStore> {
        if (this.feedbackCache) {
            return this.feedbackCache;
        }

        try {
            const data = await readFile(this.paths.feedback, 'utf-8');
            this.feedbackCache = JSON.parse(data) as FeedbackStore;
            return this.feedbackCache;
        } catch {
            return {
                version: EngagementStorage.STORAGE_VERSION,
                feedback: [],
            };
        }
    }

    private async saveFeedbackStore(store: FeedbackStore): Promise<void> {
        await this.initialize();
        await writeFile(this.paths.feedback, JSON.stringify(store, null, 2), 'utf-8');
        this.feedbackCache = store;
    }

    // ========================================================================
    // Cache Management
    // ========================================================================

    /**
     * Clear all caches
     */
    clearCache(): void {
        this.telemetryCache = undefined;
        this.ratingsCache = undefined;
        this.feedbackCache = undefined;
    }

    /**
     * Clear all engagement data
     */
    async clearAll(): Promise<void> {
        await this.clearTelemetry();

        const emptyRatings: RatingsStore = {
            version: EngagementStorage.STORAGE_VERSION,
            ratings: [],
        };
        await this.saveRatingsStore(emptyRatings);

        const emptyFeedback: FeedbackStore = {
            version: EngagementStorage.STORAGE_VERSION,
            feedback: [],
        };
        await this.saveFeedbackStore(emptyFeedback);
    }
}

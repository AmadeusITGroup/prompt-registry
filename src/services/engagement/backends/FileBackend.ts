/**
 * FileBackend - Local file-based storage for engagement data
 *
 * This is the default backend that stores all engagement data locally.
 * It provides privacy-friendly storage with no external dependencies.
 */

import * as crypto from 'crypto';
import { BaseEngagementBackend } from '../IEngagementBackend';
import { EngagementStorage } from '../../../storage/EngagementStorage';
import {
    TelemetryEvent,
    TelemetryFilter,
    Rating,
    RatingStats,
    Feedback,
    BackendConfig,
    FileBackendConfig,
    EngagementResourceType,
    RatingScore,
} from '../../../types/engagement';

/**
 * File-based engagement backend
 * Stores all data locally in the extension's global storage directory
 */
export class FileBackend extends BaseEngagementBackend {
    readonly type = 'file';
    private storage?: EngagementStorage;

    /**
     * Initialize the file backend
     * @param config File backend configuration
     */
    async initialize(config: BackendConfig): Promise<void> {
        if (config.type !== 'file') {
            throw new Error(`Invalid config type '${config.type}' for FileBackend`);
        }

        const fileConfig = config as FileBackendConfig;
        const storagePath = fileConfig.storagePath;

        if (!storagePath) {
            throw new Error('storagePath is required for FileBackend');
        }

        this.storage = new EngagementStorage(storagePath);
        await this.storage.initialize();
        this._initialized = true;
    }

    /**
     * Clean up resources
     */
    dispose(): void {
        if (this.storage) {
            this.storage.clearCache();
        }
        this._initialized = false;
    }

    // ========================================================================
    // Telemetry Operations
    // ========================================================================

    async recordTelemetry(event: TelemetryEvent): Promise<void> {
        this.ensureInitialized();
        await this.storage!.saveTelemetryEvent(event);
    }

    async getTelemetry(filter?: TelemetryFilter): Promise<TelemetryEvent[]> {
        this.ensureInitialized();
        return this.storage!.getTelemetryEvents(filter);
    }

    async clearTelemetry(filter?: TelemetryFilter): Promise<void> {
        this.ensureInitialized();
        await this.storage!.clearTelemetry(filter);
    }

    // ========================================================================
    // Rating Operations
    // ========================================================================

    async submitRating(rating: Rating): Promise<void> {
        this.ensureInitialized();
        await this.storage!.saveRating(rating);
    }

    async getRating(
        resourceType: EngagementResourceType,
        resourceId: string
    ): Promise<Rating | undefined> {
        this.ensureInitialized();
        return this.storage!.getRating(resourceType, resourceId);
    }

    async getAggregatedRatings(
        resourceType: EngagementResourceType,
        resourceId: string
    ): Promise<RatingStats | undefined> {
        this.ensureInitialized();

        // For file backend, we only have the user's own rating
        // In a real aggregation scenario, this would combine multiple users' ratings
        const rating = await this.storage!.getRating(resourceType, resourceId);

        if (!rating) {
            return undefined;
        }

        // Create stats from single rating
        const distribution: Record<RatingScore, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
        distribution[rating.score] = 1;

        return {
            resourceId,
            averageRating: rating.score,
            ratingCount: 1,
            distribution,
        };
    }

    async deleteRating(
        resourceType: EngagementResourceType,
        resourceId: string
    ): Promise<void> {
        this.ensureInitialized();
        await this.storage!.deleteRating(resourceType, resourceId);
    }

    // ========================================================================
    // Feedback Operations
    // ========================================================================

    async submitFeedback(feedback: Feedback): Promise<void> {
        this.ensureInitialized();
        await this.storage!.saveFeedback(feedback);
    }

    async getFeedback(
        resourceType: EngagementResourceType,
        resourceId: string,
        limit?: number
    ): Promise<Feedback[]> {
        this.ensureInitialized();
        return this.storage!.getFeedback(resourceType, resourceId, limit);
    }

    async deleteFeedback(feedbackId: string): Promise<void> {
        this.ensureInitialized();
        await this.storage!.deleteFeedback(feedbackId);
    }

    // ========================================================================
    // Utility Methods
    // ========================================================================

    /**
     * Create a telemetry event with auto-generated ID and timestamp
     */
    static createTelemetryEvent(
        eventType: TelemetryEvent['eventType'],
        resourceType: EngagementResourceType,
        resourceId: string,
        version?: string,
        metadata?: Record<string, unknown>
    ): TelemetryEvent {
        return {
            id: crypto.randomUUID(),
            timestamp: new Date().toISOString(),
            eventType,
            resourceType,
            resourceId,
            version,
            metadata,
        };
    }

    /**
     * Create a rating with auto-generated ID and timestamp
     */
    static createRating(
        resourceType: EngagementResourceType,
        resourceId: string,
        score: RatingScore,
        version?: string
    ): Rating {
        return {
            id: crypto.randomUUID(),
            timestamp: new Date().toISOString(),
            resourceType,
            resourceId,
            score,
            version,
        };
    }

    /**
     * Create feedback with auto-generated ID and timestamp
     */
    static createFeedback(
        resourceType: EngagementResourceType,
        resourceId: string,
        comment: string,
        version?: string,
        rating?: RatingScore
    ): Feedback {
        return {
            id: crypto.randomUUID(),
            timestamp: new Date().toISOString(),
            resourceType,
            resourceId,
            comment,
            version,
            rating,
        };
    }
}

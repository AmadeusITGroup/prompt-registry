/**
 * Interface for engagement data backends
 * Implementations handle storage/retrieval of telemetry, ratings, and feedback
 */

import {
    TelemetryEvent,
    TelemetryFilter,
    Rating,
    RatingStats,
    Feedback,
    BackendConfig,
    ResourceEngagement,
    EngagementResourceType,
} from '../../types/engagement';

/**
 * Backend interface for engagement data storage
 */
export interface IEngagementBackend {
    /** Backend type identifier */
    readonly type: string;

    /** Whether the backend is initialized */
    readonly initialized: boolean;

    // ========================================================================
    // Lifecycle
    // ========================================================================

    /**
     * Initialize the backend with configuration
     * @param config Backend-specific configuration
     */
    initialize(config: BackendConfig): Promise<void>;

    /**
     * Clean up resources
     */
    dispose(): void;

    // ========================================================================
    // Telemetry Operations
    // ========================================================================

    /**
     * Record a telemetry event
     * @param event Telemetry event to record
     */
    recordTelemetry(event: TelemetryEvent): Promise<void>;

    /**
     * Retrieve telemetry events
     * @param filter Optional filter criteria
     * @returns Array of telemetry events
     */
    getTelemetry(filter?: TelemetryFilter): Promise<TelemetryEvent[]>;

    /**
     * Clear telemetry data
     * @param filter Optional filter to clear specific data
     */
    clearTelemetry(filter?: TelemetryFilter): Promise<void>;

    // ========================================================================
    // Rating Operations
    // ========================================================================

    /**
     * Submit or update a rating
     * @param rating Rating to submit
     */
    submitRating(rating: Rating): Promise<void>;

    /**
     * Get user's rating for a resource
     * @param resourceType Type of resource
     * @param resourceId Resource identifier
     * @returns User's rating or undefined
     */
    getRating(
        resourceType: EngagementResourceType,
        resourceId: string
    ): Promise<Rating | undefined>;

    /**
     * Get aggregated rating statistics
     * @param resourceType Type of resource
     * @param resourceId Resource identifier
     * @returns Aggregated rating stats
     */
    getAggregatedRatings(
        resourceType: EngagementResourceType,
        resourceId: string
    ): Promise<RatingStats | undefined>;

    /**
     * Delete user's rating
     * @param resourceType Type of resource
     * @param resourceId Resource identifier
     */
    deleteRating(
        resourceType: EngagementResourceType,
        resourceId: string
    ): Promise<void>;

    // ========================================================================
    // Feedback Operations
    // ========================================================================

    /**
     * Submit feedback
     * @param feedback Feedback to submit
     */
    submitFeedback(feedback: Feedback): Promise<void>;

    /**
     * Get feedback for a resource
     * @param resourceType Type of resource
     * @param resourceId Resource identifier
     * @param limit Maximum number of entries
     * @returns Array of feedback entries
     */
    getFeedback(
        resourceType: EngagementResourceType,
        resourceId: string,
        limit?: number
    ): Promise<Feedback[]>;

    /**
     * Delete feedback
     * @param feedbackId Feedback ID to delete
     */
    deleteFeedback(feedbackId: string): Promise<void>;

    // ========================================================================
    // Aggregation
    // ========================================================================

    /**
     * Get combined engagement data for a resource
     * @param resourceType Type of resource
     * @param resourceId Resource identifier
     * @returns Combined engagement data
     */
    getResourceEngagement(
        resourceType: EngagementResourceType,
        resourceId: string
    ): Promise<ResourceEngagement>;
}

/**
 * Abstract base class for engagement backends
 * Provides common functionality and default implementations
 */
export abstract class BaseEngagementBackend implements IEngagementBackend {
    abstract readonly type: string;
    protected _initialized = false;

    get initialized(): boolean {
        return this._initialized;
    }

    abstract initialize(config: BackendConfig): Promise<void>;
    abstract dispose(): void;

    abstract recordTelemetry(event: TelemetryEvent): Promise<void>;
    abstract getTelemetry(filter?: TelemetryFilter): Promise<TelemetryEvent[]>;
    abstract clearTelemetry(filter?: TelemetryFilter): Promise<void>;

    abstract submitRating(rating: Rating): Promise<void>;
    abstract getRating(
        resourceType: EngagementResourceType,
        resourceId: string
    ): Promise<Rating | undefined>;
    abstract getAggregatedRatings(
        resourceType: EngagementResourceType,
        resourceId: string
    ): Promise<RatingStats | undefined>;
    abstract deleteRating(
        resourceType: EngagementResourceType,
        resourceId: string
    ): Promise<void>;

    abstract submitFeedback(feedback: Feedback): Promise<void>;
    abstract getFeedback(
        resourceType: EngagementResourceType,
        resourceId: string,
        limit?: number
    ): Promise<Feedback[]>;
    abstract deleteFeedback(feedbackId: string): Promise<void>;

    /**
     * Default implementation that aggregates data from individual methods
     */
    async getResourceEngagement(
        resourceType: EngagementResourceType,
        resourceId: string
    ): Promise<ResourceEngagement> {
        const [ratings, feedback, telemetry] = await Promise.all([
            this.getAggregatedRatings(resourceType, resourceId),
            this.getFeedback(resourceType, resourceId, 5),
            this.getTelemetry({
                resourceId,
                resourceTypes: [resourceType],
                eventTypes: ['bundle_install', 'bundle_view'],
            }),
        ]);

        // Calculate telemetry summary
        const installCount = telemetry.filter(e => e.eventType === 'bundle_install').length;
        const viewCount = telemetry.filter(e => e.eventType === 'bundle_view').length;
        const lastActivity = telemetry.length > 0
            ? telemetry.sort((a, b) => b.timestamp.localeCompare(a.timestamp))[0].timestamp
            : undefined;

        return {
            resourceId,
            resourceType,
            ratings: ratings || undefined,
            recentFeedback: feedback.length > 0 ? feedback : undefined,
            telemetry: {
                installCount,
                viewCount,
                lastActivity,
            },
        };
    }

    /**
     * Ensure backend is initialized before operations
     */
    protected ensureInitialized(): void {
        if (!this._initialized) {
            throw new Error(`Backend '${this.type}' is not initialized. Call initialize() first.`);
        }
    }
}

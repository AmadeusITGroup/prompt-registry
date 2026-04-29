/**
 * FileBackend - Local file-based storage for engagement data
 *
 * This is the default backend that stores all engagement data locally.
 * It provides privacy-friendly storage with no external dependencies.
 */

import * as crypto from 'node:crypto';
import {
  EngagementStorage,
} from '../../../storage/engagement-storage';
import {
  BackendConfig,
  EngagementResourceType,
  Feedback,
  Rating,
  RatingScore,
  RatingStats,
  TelemetryEvent,
  TelemetryFilter,
} from '../../../types/engagement';
import {
  BaseEngagementBackend,
} from '../engagement-backend';

/**
 * File-based engagement backend
 * Stores all data locally in the extension's global storage directory
 */
export class FileBackend extends BaseEngagementBackend {
  public readonly type = 'file';
  private storage?: EngagementStorage;

  /**
   * Initialize the file backend
   * @param config File backend configuration
   */
  public async initialize(config: BackendConfig): Promise<void> {
    if (config.type !== 'file') {
      throw new Error(`Invalid config type '${config.type}' for FileBackend`);
    }

    const fileConfig = config;
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
  public dispose(): void {
    if (this.storage) {
      this.storage.clearCache();
    }
    this._initialized = false;
  }

  // ========================================================================
  // Telemetry Operations
  // ========================================================================

  public async recordTelemetry(event: TelemetryEvent): Promise<void> {
    this.ensureInitialized();
    await this.storage!.saveTelemetryEvent(event);
  }

  public async getTelemetry(filter?: TelemetryFilter): Promise<TelemetryEvent[]> {
    this.ensureInitialized();
    return this.storage!.getTelemetryEvents(filter);
  }

  public async clearTelemetry(filter?: TelemetryFilter): Promise<void> {
    this.ensureInitialized();
    await this.storage!.clearTelemetry(filter);
  }

  // ========================================================================
  // Rating Operations
  // ========================================================================

  public async submitRating(rating: Rating): Promise<void> {
    this.ensureInitialized();
    await this.storage!.saveRating(rating);
  }

  public async getRating(
    resourceType: EngagementResourceType,
    resourceId: string
  ): Promise<Rating | undefined> {
    this.ensureInitialized();
    return this.storage!.getRating(resourceType, resourceId);
  }

  public async getAggregatedRatings(
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
    const distribution: Record<RatingScore, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, [rating.score]: 1 };

    return {
      resourceId,
      averageRating: rating.score,
      ratingCount: 1,
      distribution
    };
  }

  public async deleteRating(
    resourceType: EngagementResourceType,
    resourceId: string
  ): Promise<void> {
    this.ensureInitialized();
    await this.storage!.deleteRating(resourceType, resourceId);
  }

  // ========================================================================
  // Feedback Operations
  // ========================================================================

  public async submitFeedback(feedback: Feedback): Promise<void> {
    this.ensureInitialized();
    await this.storage!.saveFeedback(feedback);
  }

  public async getFeedback(
    resourceType: EngagementResourceType,
    resourceId: string,
    limit?: number
  ): Promise<Feedback[]> {
    this.ensureInitialized();
    return this.storage!.getFeedback(resourceType, resourceId, limit);
  }

  public async deleteFeedback(feedbackId: string): Promise<void> {
    this.ensureInitialized();
    await this.storage!.deleteFeedback(feedbackId);
  }

  // ========================================================================
  // Utility Methods
  // ========================================================================

  /**
   * Create a telemetry event with auto-generated ID and timestamp
   * @param eventType
   * @param resourceType
   * @param resourceId
   * @param version
   * @param metadata
   */
  public static createTelemetryEvent(
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
      metadata
    };
  }

  /**
   * Create a rating with auto-generated ID and timestamp
   * @param resourceType
   * @param resourceId
   * @param score
   * @param version
   */
  public static createRating(
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
      version
    };
  }

  /**
   * Create feedback with auto-generated ID and timestamp
   * @param resourceType
   * @param resourceId
   * @param comment
   * @param version
   * @param rating
   */
  public static createFeedback(
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
      rating
    };
  }
}

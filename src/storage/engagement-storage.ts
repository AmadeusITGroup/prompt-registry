/* eslint-disable @typescript-eslint/member-ordering -- phase 2: reorganize members when feedback is re-integrated onto main */
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

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  promisify,
} from 'node:util';
import {
  EngagementResourceType,
  Feedback,
  Rating,
  TelemetryEvent,
  TelemetryFilter,
} from '../types/engagement';
import {
  PendingFeedback,
} from '../types/pending-feedback';

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
  pendingFeedback: string;
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
 * Internal storage format for pending feedback
 */
interface PendingFeedbackStore {
  version: string;
  entries: PendingFeedback[];
}

/**
 * EngagementStorage manages file-based persistence for engagement data
 */
export class EngagementStorage {
  private readonly paths: EngagementStoragePaths;
  private telemetryCache?: TelemetryStore;
  private ratingsCache?: RatingsStore;
  private feedbackCache?: FeedbackStore;
  private pendingFeedbackCache?: PendingFeedbackStore;

  private static readonly STORAGE_VERSION = '1.0.0';
  private static readonly MAX_TELEMETRY_EVENTS = 10_000;
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
      pendingFeedback: path.join(engagementDir, 'pending-feedback.json')
    };
  }

  /**
   * Initialize storage directories
   */
  public async initialize(): Promise<void> {
    if (!fs.existsSync(this.paths.root)) {
      await mkdir(this.paths.root, { recursive: true });
    }
  }

  /**
   * Get storage paths
   */
  public getPaths(): EngagementStoragePaths {
    return { ...this.paths };
  }

  // ========================================================================
  // Telemetry Operations
  // ========================================================================

  /**
   * Save a telemetry event
   * @param event
   */
  public async saveTelemetryEvent(event: TelemetryEvent): Promise<void> {
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
   * @param filter
   */
  public async getTelemetryEvents(filter?: TelemetryFilter): Promise<TelemetryEvent[]> {
    const store = await this.loadTelemetryStore();
    let events = store.events;

    if (filter) {
      if (filter.eventTypes && filter.eventTypes.length > 0) {
        events = events.filter((e) => filter.eventTypes!.includes(e.eventType));
      }
      if (filter.resourceTypes && filter.resourceTypes.length > 0) {
        events = events.filter((e) => filter.resourceTypes!.includes(e.resourceType));
      }
      if (filter.resourceId) {
        events = events.filter((e) => e.resourceId === filter.resourceId);
      }
      if (filter.startDate) {
        events = events.filter((e) => e.timestamp >= filter.startDate!);
      }
      if (filter.endDate) {
        events = events.filter((e) => e.timestamp <= filter.endDate!);
      }
      if (filter.limit && filter.limit > 0) {
        events = events.slice(-filter.limit);
      }
    }

    return events;
  }

  /**
   * Clear telemetry data
   * @param filter
   */
  public async clearTelemetry(filter?: TelemetryFilter): Promise<void> {
    if (!filter) {
      // Clear all
      await this.saveTelemetryStore({
        version: EngagementStorage.STORAGE_VERSION,
        events: []
      });
      return;
    }

    // Selective clear - keep events that don't match filter
    const store = await this.loadTelemetryStore();
    store.events = store.events.filter((e) => {
      if (filter.eventTypes && filter.eventTypes.includes(e.eventType)) {
        return false;
      }
      if (filter.resourceTypes && filter.resourceTypes.includes(e.resourceType)) {
        return false;
      }
      if (filter.resourceId && e.resourceId === filter.resourceId) {
        return false;
      }
      if (filter.startDate && filter.endDate && e.timestamp >= filter.startDate && e.timestamp <= filter.endDate) {
        return false;
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
      const data = await readFile(this.paths.telemetry, 'utf8');
      this.telemetryCache = JSON.parse(data) as TelemetryStore;
      return this.telemetryCache;
    } catch {
      return {
        version: EngagementStorage.STORAGE_VERSION,
        events: []
      };
    }
  }

  private async saveTelemetryStore(store: TelemetryStore): Promise<void> {
    await this.initialize();
    await writeFile(this.paths.telemetry, JSON.stringify(store, null, 2), 'utf8');
    this.telemetryCache = store;
  }

  // ========================================================================
  // Rating Operations
  // ========================================================================

  /**
   * Save or update a rating
   * @param rating
   */
  public async saveRating(rating: Rating): Promise<void> {
    const store = await this.loadRatingsStore();

    // Find existing rating for same resource
    const existingIndex = store.ratings.findIndex(
      (r) => r.resourceType === rating.resourceType && r.resourceId === rating.resourceId
    );

    if (existingIndex === -1) {
      // Add new
      store.ratings.push(rating);
    } else {
      // Update existing
      store.ratings[existingIndex] = rating;
    }

    await this.saveRatingsStore(store);
  }

  /**
   * Get rating for a specific resource
   * @param resourceType
   * @param resourceId
   */
  public async getRating(
    resourceType: EngagementResourceType,
    resourceId: string
  ): Promise<Rating | undefined> {
    const store = await this.loadRatingsStore();
    return store.ratings.find(
      (r) => r.resourceType === resourceType && r.resourceId === resourceId
    );
  }

  /**
   * Get all ratings
   */
  public async getAllRatings(): Promise<Rating[]> {
    const store = await this.loadRatingsStore();
    return store.ratings;
  }

  /**
   * Delete rating for a resource
   * @param resourceType
   * @param resourceId
   */
  public async deleteRating(
    resourceType: EngagementResourceType,
    resourceId: string
  ): Promise<void> {
    const store = await this.loadRatingsStore();
    store.ratings = store.ratings.filter(
      (r) => !(r.resourceType === resourceType && r.resourceId === resourceId)
    );
    await this.saveRatingsStore(store);
  }

  private async loadRatingsStore(): Promise<RatingsStore> {
    if (this.ratingsCache) {
      return this.ratingsCache;
    }

    try {
      const data = await readFile(this.paths.ratings, 'utf8');
      this.ratingsCache = JSON.parse(data) as RatingsStore;
      return this.ratingsCache;
    } catch {
      return {
        version: EngagementStorage.STORAGE_VERSION,
        ratings: []
      };
    }
  }

  private async saveRatingsStore(store: RatingsStore): Promise<void> {
    await this.initialize();
    await writeFile(this.paths.ratings, JSON.stringify(store, null, 2), 'utf8');
    this.ratingsCache = store;
  }

  // ========================================================================
  // Feedback Operations
  // ========================================================================

  /**
   * Save feedback
   * @param feedback
   */
  public async saveFeedback(feedback: Feedback): Promise<void> {
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
   * @param resourceType
   * @param resourceId
   * @param limit
   */
  public async getFeedback(
    resourceType: EngagementResourceType,
    resourceId: string,
    limit?: number
  ): Promise<Feedback[]> {
    const store = await this.loadFeedbackStore();
    let feedback = store.feedback.filter(
      (f) => f.resourceType === resourceType && f.resourceId === resourceId
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
  public async getAllFeedback(): Promise<Feedback[]> {
    const store = await this.loadFeedbackStore();
    return store.feedback;
  }

  /**
   * Delete feedback by ID
   * @param feedbackId
   */
  public async deleteFeedback(feedbackId: string): Promise<void> {
    const store = await this.loadFeedbackStore();
    store.feedback = store.feedback.filter((f) => f.id !== feedbackId);
    await this.saveFeedbackStore(store);
  }

  private async loadFeedbackStore(): Promise<FeedbackStore> {
    if (this.feedbackCache) {
      return this.feedbackCache;
    }

    try {
      const data = await readFile(this.paths.feedback, 'utf8');
      this.feedbackCache = JSON.parse(data) as FeedbackStore;
      return this.feedbackCache;
    } catch {
      return {
        version: EngagementStorage.STORAGE_VERSION,
        feedback: []
      };
    }
  }

  private async saveFeedbackStore(store: FeedbackStore): Promise<void> {
    await this.initialize();
    await writeFile(this.paths.feedback, JSON.stringify(store, null, 2), 'utf8');
    this.feedbackCache = store;
  }

  // ========================================================================
  // Pending Feedback Operations
  // ========================================================================

  public async savePendingFeedback(entry: PendingFeedback): Promise<void> {
    const store = await this.loadPendingFeedbackStore();
    const existingIndex = store.entries.findIndex((e) => e.id === entry.id);
    if (existingIndex === -1) {
      store.entries.push(entry);
    } else {
      store.entries[existingIndex] = entry;
    }
    await this.savePendingFeedbackStore(store);
  }

  public async getPendingFeedback(): Promise<PendingFeedback[]> {
    const store = await this.loadPendingFeedbackStore();
    return store.entries;
  }

  public async getUnsyncedFeedback(): Promise<PendingFeedback[]> {
    const store = await this.loadPendingFeedbackStore();
    return store.entries.filter((e) => !e.synced);
  }

  public async markFeedbackSynced(id: string): Promise<void> {
    const store = await this.loadPendingFeedbackStore();
    const entry = store.entries.find((e) => e.id === id);
    if (entry) {
      entry.synced = true;
      await this.savePendingFeedbackStore(store);
    }
  }

  public async deletePendingFeedback(id: string): Promise<void> {
    const store = await this.loadPendingFeedbackStore();
    store.entries = store.entries.filter((e) => e.id !== id);
    await this.savePendingFeedbackStore(store);
  }

  private async loadPendingFeedbackStore(): Promise<PendingFeedbackStore> {
    if (this.pendingFeedbackCache) {
      return this.pendingFeedbackCache;
    }
    try {
      const data = await readFile(this.paths.pendingFeedback, 'utf8');
      this.pendingFeedbackCache = JSON.parse(data) as PendingFeedbackStore;
      return this.pendingFeedbackCache;
    } catch {
      return { version: EngagementStorage.STORAGE_VERSION, entries: [] };
    }
  }

  private async savePendingFeedbackStore(store: PendingFeedbackStore): Promise<void> {
    await this.initialize();
    await writeFile(this.paths.pendingFeedback, JSON.stringify(store, null, 2), 'utf8');
    this.pendingFeedbackCache = store;
  }

  // ========================================================================
  // Cache Management
  // ========================================================================

  /**
   * Clear all caches
   */
  public clearCache(): void {
    this.telemetryCache = undefined;
    this.ratingsCache = undefined;
    this.feedbackCache = undefined;
    this.pendingFeedbackCache = undefined;
  }

  /**
   * Clear all engagement data
   */
  public async clearAll(): Promise<void> {
    await this.clearTelemetry();

    const emptyRatings: RatingsStore = {
      version: EngagementStorage.STORAGE_VERSION,
      ratings: []
    };
    await this.saveRatingsStore(emptyRatings);

    const emptyFeedback: FeedbackStore = {
      version: EngagementStorage.STORAGE_VERSION,
      feedback: []
    };
    await this.saveFeedbackStore(emptyFeedback);

    const emptyPending: PendingFeedbackStore = {
      version: EngagementStorage.STORAGE_VERSION,
      entries: []
    };
    await this.savePendingFeedbackStore(emptyPending);
  }
}

/**
 * EngagementService - Unified facade for engagement features
 *
 * Responsibilities:
 * - Backend selection based on hub configuration
 * - Privacy settings enforcement
 * - Event coordination
 * - Singleton pattern for extension-wide access
 */

import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { IEngagementBackend } from './IEngagementBackend';
import { FileBackend } from './backends/FileBackend';
import { GitHubDiscussionsBackend } from './backends/GitHubDiscussionsBackend';
import {
    TelemetryEvent,
    TelemetryFilter,
    TelemetryEventType,
    Rating,
    RatingStats,
    Feedback,
    BackendConfig,
    FileBackendConfig,
    GitHubDiscussionsBackendConfig,
    ResourceEngagement,
    EngagementResourceType,
    EngagementPrivacySettings,
    DEFAULT_PRIVACY_SETTINGS,
    RatingScore,
    HubEngagementConfig,
} from '../../types/engagement';
import { Logger } from '../../utils/logger';

/**
 * EngagementService provides a unified interface for telemetry, ratings, and feedback
 */
export class EngagementService {
    private static instance: EngagementService;
    private defaultBackend?: IEngagementBackend;
    private hubBackends: Map<string, IEngagementBackend> = new Map();
    private privacySettings: EngagementPrivacySettings = DEFAULT_PRIVACY_SETTINGS;
    private logger: Logger;

    // Events
    private _onRatingSubmitted = new vscode.EventEmitter<Rating>();
    private _onFeedbackSubmitted = new vscode.EventEmitter<Feedback>();
    private _onTelemetryRecorded = new vscode.EventEmitter<TelemetryEvent>();

    readonly onRatingSubmitted = this._onRatingSubmitted.event;
    readonly onFeedbackSubmitted = this._onFeedbackSubmitted.event;
    readonly onTelemetryRecorded = this._onTelemetryRecorded.event;

    private constructor(private context: vscode.ExtensionContext) {
        this.logger = Logger.getInstance();
    }

    /**
     * Get singleton instance
     */
    static getInstance(context?: vscode.ExtensionContext): EngagementService {
        if (!EngagementService.instance) {
            if (!context) {
                throw new Error('ExtensionContext required on first call to EngagementService.getInstance()');
            }
            EngagementService.instance = new EngagementService(context);
        }
        return EngagementService.instance;
    }

    /**
     * Reset instance (for testing)
     */
    static resetInstance(): void {
        if (EngagementService.instance) {
            EngagementService.instance.dispose();
            EngagementService.instance = undefined as any;
        }
    }

    /**
     * Initialize the service with default file backend
     */
    async initialize(): Promise<void> {
        const storagePath = this.context.globalStorageUri.fsPath;
        const config: FileBackendConfig = {
            type: 'file',
            storagePath,
        };

        this.defaultBackend = new FileBackend();
        await this.defaultBackend.initialize(config);

        this.logger.info('EngagementService initialized with file backend');
    }

    /**
     * Dispose of all resources
     */
    dispose(): void {
        this._onRatingSubmitted.dispose();
        this._onFeedbackSubmitted.dispose();
        this._onTelemetryRecorded.dispose();

        if (this.defaultBackend) {
            this.defaultBackend.dispose();
        }

        for (const backend of this.hubBackends.values()) {
            backend.dispose();
        }
        this.hubBackends.clear();
    }

    /**
     * Check if service is initialized
     */
    get initialized(): boolean {
        return this.defaultBackend?.initialized ?? false;
    }

    // ========================================================================
    // Backend Management
    // ========================================================================

    /**
     * Register a backend for a specific hub
     */
    async registerHubBackend(hubId: string, config: HubEngagementConfig): Promise<void> {
        if (!config.enabled) {
            this.logger.debug(`Engagement disabled for hub ${hubId}`);
            return;
        }

        const storagePath = this.context.globalStorageUri.fsPath;
        let backend: IEngagementBackend;

        // Initialize backend based on type
        if (config.backend.type === 'github-discussions') {
            const ghConfig = config.backend as GitHubDiscussionsBackendConfig;
            backend = new GitHubDiscussionsBackend(storagePath);
            await backend.initialize(ghConfig);

            // Load collections mappings if collectionsUrl is provided
            // Use a timeout to prevent blocking if the URL is slow/unreachable
            if (ghConfig.collectionsUrl) {
                const collectionsUrl = ghConfig.collectionsUrl; // Capture for closure
                const loadMappings = async () => {
                    try {
                        await (backend as GitHubDiscussionsBackend).loadCollectionsMappings(collectionsUrl);
                        this.logger.info(`Loaded collections mappings for hub ${hubId} from ${collectionsUrl}`);
                    } catch (error: any) {
                        this.logger.error(`Failed to load collections mappings for hub ${hubId}: ${error.message}`);
                        // Continue without mappings - ratings will fall back to local storage
                    }
                };
                
                // Load in background with 5 second timeout
                const timeoutPromise = new Promise<void>((resolve) => {
                    setTimeout(() => {
                        this.logger.warn(`Collections mapping load timed out for hub ${hubId}, continuing without mappings`);
                        resolve();
                    }, 5000);
                });
                
                await Promise.race([loadMappings(), timeoutPromise]);
            }
        } else {
            // Default to file backend
            if (config.backend.type !== 'file') {
                this.logger.warn(`Backend type '${config.backend.type}' not yet supported, using file backend`);
            }
            const fileConfig: FileBackendConfig = {
                type: 'file',
                storagePath,
            };
            backend = new FileBackend();
            await backend.initialize(fileConfig);
        }

        this.hubBackends.set(hubId, backend);
        this.logger.info(`Registered engagement backend for hub: ${hubId} (type: ${config.backend.type})`);
    }

    /**
     * Unregister a hub's backend
     */
    unregisterHubBackend(hubId: string): void {
        const backend = this.hubBackends.get(hubId);
        if (backend) {
            backend.dispose();
            this.hubBackends.delete(hubId);
            this.logger.debug(`Unregistered engagement backend for hub: ${hubId}`);
        }
    }

    /**
     * Get backend for a hub (falls back to default)
     */
    private getBackend(hubId?: string): IEngagementBackend {
        this.logger.info(`[EngagementService] getBackend called with hubId: "${hubId || 'none'}"`);
        this.logger.info(`[EngagementService] Available hub backends: ${Array.from(this.hubBackends.keys()).join(', ') || 'none'}`);
        
        if (hubId) {
            const hubBackend = this.hubBackends.get(hubId);
            if (hubBackend) {
                this.logger.info(`[EngagementService] Using hub backend for: ${hubId}`);
                return hubBackend;
            }
            this.logger.warn(`[EngagementService] No hub backend found for: ${hubId}, falling back to default`);
        }

        if (!this.defaultBackend) {
            throw new Error('EngagementService not initialized');
        }

        this.logger.info(`[EngagementService] Using default backend (type: ${this.defaultBackend.type})`);
        return this.defaultBackend;
    }

    // ========================================================================
    // Privacy Settings
    // ========================================================================

    /**
     * Update privacy settings
     */
    setPrivacySettings(settings: Partial<EngagementPrivacySettings>): void {
        this.privacySettings = { ...this.privacySettings, ...settings };
        this.logger.debug('Privacy settings updated', this.privacySettings);
    }

    /**
     * Get current privacy settings
     */
    getPrivacySettings(): EngagementPrivacySettings {
        return { ...this.privacySettings };
    }

    // ========================================================================
    // Telemetry Operations
    // ========================================================================

    /**
     * Record a telemetry event
     */
    async recordTelemetry(
        eventType: TelemetryEventType,
        resourceType: EngagementResourceType,
        resourceId: string,
        options?: {
            version?: string;
            metadata?: Record<string, unknown>;
            hubId?: string;
        }
    ): Promise<void> {
        if (!this.privacySettings.telemetryEnabled) {
            this.logger.debug('Telemetry disabled, skipping event');
            return;
        }

        const event: TelemetryEvent = {
            id: crypto.randomUUID(),
            timestamp: new Date().toISOString(),
            eventType,
            resourceType,
            resourceId,
            version: options?.version,
            metadata: options?.metadata,
        };

        const backend = this.getBackend(options?.hubId);
        await backend.recordTelemetry(event);

        this._onTelemetryRecorded.fire(event);
        this.logger.debug(`Telemetry recorded: ${eventType} for ${resourceType}/${resourceId}`);
    }

    /**
     * Get telemetry events
     */
    async getTelemetry(filter?: TelemetryFilter, hubId?: string): Promise<TelemetryEvent[]> {
        const backend = this.getBackend(hubId);
        return backend.getTelemetry(filter);
    }

    /**
     * Clear telemetry data
     */
    async clearTelemetry(filter?: TelemetryFilter, hubId?: string): Promise<void> {
        const backend = this.getBackend(hubId);
        await backend.clearTelemetry(filter);
        this.logger.info('Telemetry data cleared');
    }

    // ========================================================================
    // Rating Operations
    // ========================================================================

    /**
     * Submit a rating
     */
    async submitRating(
        resourceType: EngagementResourceType,
        resourceId: string,
        score: RatingScore,
        options?: {
            version?: string;
            hubId?: string;
        }
    ): Promise<Rating> {
        const rating: Rating = {
            id: crypto.randomUUID(),
            timestamp: new Date().toISOString(),
            resourceType,
            resourceId,
            score,
            version: options?.version,
        };

        const backend = this.getBackend(options?.hubId);
        await backend.submitRating(rating);

        this._onRatingSubmitted.fire(rating);
        this.logger.info(`Rating submitted: ${score} stars for ${resourceType}/${resourceId}`);

        return rating;
    }

    /**
     * Get user's rating for a resource
     */
    async getRating(
        resourceType: EngagementResourceType,
        resourceId: string,
        hubId?: string
    ): Promise<Rating | undefined> {
        const backend = this.getBackend(hubId);
        return backend.getRating(resourceType, resourceId);
    }

    /**
     * Get aggregated rating statistics
     */
    async getAggregatedRatings(
        resourceType: EngagementResourceType,
        resourceId: string,
        hubId?: string
    ): Promise<RatingStats | undefined> {
        const backend = this.getBackend(hubId);
        return backend.getAggregatedRatings(resourceType, resourceId);
    }

    /**
     * Delete user's rating
     */
    async deleteRating(
        resourceType: EngagementResourceType,
        resourceId: string,
        hubId?: string
    ): Promise<void> {
        const backend = this.getBackend(hubId);
        await backend.deleteRating(resourceType, resourceId);
        this.logger.debug(`Rating deleted for ${resourceType}/${resourceId}`);
    }

    // ========================================================================
    // Feedback Operations
    // ========================================================================

    /**
     * Submit feedback
     */
    async submitFeedback(
        resourceType: EngagementResourceType,
        resourceId: string,
        comment: string,
        options?: {
            version?: string;
            rating?: RatingScore;
            hubId?: string;
        }
    ): Promise<Feedback> {
        const feedback: Feedback = {
            id: crypto.randomUUID(),
            timestamp: new Date().toISOString(),
            resourceType,
            resourceId,
            comment,
            version: options?.version,
            rating: options?.rating,
        };

        const backend = this.getBackend(options?.hubId);
        await backend.submitFeedback(feedback);

        this._onFeedbackSubmitted.fire(feedback);
        this.logger.info(`Feedback submitted for ${resourceType}/${resourceId}`);

        return feedback;
    }

    /**
     * Get feedback for a resource
     */
    async getFeedback(
        resourceType: EngagementResourceType,
        resourceId: string,
        limit?: number,
        hubId?: string
    ): Promise<Feedback[]> {
        const backend = this.getBackend(hubId);
        return backend.getFeedback(resourceType, resourceId, limit);
    }

    /**
     * Delete feedback
     */
    async deleteFeedback(feedbackId: string, hubId?: string): Promise<void> {
        const backend = this.getBackend(hubId);
        await backend.deleteFeedback(feedbackId);
        this.logger.debug(`Feedback deleted: ${feedbackId}`);
    }

    // ========================================================================
    // Aggregation
    // ========================================================================

    /**
     * Get combined engagement data for a resource
     */
    async getResourceEngagement(
        resourceType: EngagementResourceType,
        resourceId: string,
        hubId?: string
    ): Promise<ResourceEngagement> {
        const backend = this.getBackend(hubId);
        return backend.getResourceEngagement(resourceType, resourceId);
    }
}

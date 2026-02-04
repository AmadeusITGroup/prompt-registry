/**
 * Engagement system types for Prompt Registry
 * Handles telemetry, feedback, and rating functionality
 */

// ============================================================================
// Telemetry Types
// ============================================================================

/**
 * Types of telemetry events that can be recorded
 */
export type TelemetryEventType =
    | 'bundle_install'
    | 'bundle_uninstall'
    | 'bundle_update'
    | 'bundle_view'
    | 'profile_activate'
    | 'profile_deactivate'
    | 'hub_import'
    | 'hub_sync'
    | 'search'
    | 'error';

/**
 * Resource types that can have engagement data
 */
export type EngagementResourceType = 'bundle' | 'profile' | 'hub';

/**
 * A telemetry event record
 */
export interface TelemetryEvent {
    /** Unique event ID */
    id: string;
    /** ISO timestamp */
    timestamp: string;
    /** Type of event */
    eventType: TelemetryEventType;
    /** Type of resource involved */
    resourceType: EngagementResourceType;
    /** Resource identifier */
    resourceId: string;
    /** Resource version (if applicable) */
    version?: string;
    /** Additional event metadata */
    metadata?: Record<string, unknown>;
}

/**
 * Filter options for querying telemetry
 */
export interface TelemetryFilter {
    eventTypes?: TelemetryEventType[];
    resourceTypes?: EngagementResourceType[];
    resourceId?: string;
    startDate?: string;
    endDate?: string;
    limit?: number;
}

// ============================================================================
// Rating Types
// ============================================================================

/**
 * Valid rating scores (1-5 stars)
 */
export type RatingScore = 1 | 2 | 3 | 4 | 5;

/**
 * A user rating for a resource
 */
export interface Rating {
    /** Unique rating ID */
    id: string;
    /** Type of resource being rated */
    resourceType: EngagementResourceType;
    /** Resource identifier */
    resourceId: string;
    /** Rating score (1-5) */
    score: RatingScore;
    /** ISO timestamp */
    timestamp: string;
    /** Resource version at time of rating */
    version?: string;
}

/**
 * Aggregated rating statistics
 */
export interface RatingStats {
    /** Resource identifier */
    resourceId: string;
    /** Average rating (1.0-5.0) */
    averageRating: number;
    /** Total number of ratings */
    ratingCount: number;
    /** Distribution of ratings */
    distribution: {
        1: number;
        2: number;
        3: number;
        4: number;
        5: number;
    };
}

// ============================================================================
// Feedback Types
// ============================================================================

/**
 * User feedback for a resource
 */
export interface Feedback {
    /** Unique feedback ID */
    id: string;
    /** Type of resource */
    resourceType: EngagementResourceType;
    /** Resource identifier */
    resourceId: string;
    /** Feedback comment text */
    comment: string;
    /** ISO timestamp */
    timestamp: string;
    /** Resource version at time of feedback */
    version?: string;
    /** Optional rating included with feedback */
    rating?: RatingScore;
}

// ============================================================================
// Backend Configuration Types
// ============================================================================

/**
 * Supported backend types
 */
export type EngagementBackendType =
    | 'file'
    | 'github-issues'
    | 'github-discussions'
    | 'api';

/**
 * Base backend configuration
 */
export interface EngagementBackendConfigBase {
    type: EngagementBackendType;
}

/**
 * File backend configuration
 */
export interface FileBackendConfig extends EngagementBackendConfigBase {
    type: 'file';
    /** Custom storage path (optional, defaults to extension storage) */
    storagePath?: string;
}

/**
 * GitHub Issues backend configuration
 */
export interface GitHubIssuesBackendConfig extends EngagementBackendConfigBase {
    type: 'github-issues';
    /** Repository in owner/repo format */
    repository: string;
    /** Labels to apply to issues */
    labels?: string[];
    /** Whether to use GitHub authentication */
    requireAuth?: boolean;
}

/**
 * GitHub Discussions backend configuration
 */
export interface GitHubDiscussionsBackendConfig extends EngagementBackendConfigBase {
    type: 'github-discussions';
    /** Repository in owner/repo format */
    repository: string;
    /** Discussion category */
    category?: string;
    /** URL to collections.yaml mapping bundles to discussion numbers */
    collectionsUrl?: string;
    /** Minimum account age in days to count votes (anti-abuse) */
    minAccountAgeDays?: number;
    /** List of usernames to exclude from vote counting */
    blacklist?: string[];
    /** Cache duration in minutes for aggregated ratings */
    cacheDurationMinutes?: number;
}

/**
 * Custom API backend configuration
 */
export interface ApiBackendConfig extends EngagementBackendConfigBase {
    type: 'api';
    /** API base URL */
    baseUrl: string;
    /** Authentication header name */
    authHeader?: string;
    /** Authentication token (or env var reference) */
    authToken?: string;
}

/**
 * Union of all backend configs
 */
export type BackendConfig =
    | FileBackendConfig
    | GitHubIssuesBackendConfig
    | GitHubDiscussionsBackendConfig
    | ApiBackendConfig;

// ============================================================================
// Hub Engagement Configuration
// ============================================================================

/**
 * Telemetry configuration in hub
 */
export interface TelemetryConfig {
    /** Whether telemetry is enabled */
    enabled: boolean;
    /** Which events to track */
    events?: TelemetryEventType[];
}

/**
 * Rating configuration in hub
 */
export interface RatingConfig {
    /** Whether ratings are enabled */
    enabled: boolean;
    /** Whether anonymous ratings are allowed */
    allowAnonymous?: boolean;
    /** URL to static ratings.json file (pre-computed ratings) */
    ratingsUrl?: string;
}

/**
 * Feedback configuration in hub
 */
export interface FeedbackConfig {
    /** Whether feedback is enabled */
    enabled: boolean;
    /** Whether rating is required with feedback */
    requireRating?: boolean;
    /** Maximum comment length */
    maxLength?: number;
    /** URL to static feedbacks.json file (pre-computed feedbacks) */
    feedbackUrl?: string;
}

/**
 * Complete engagement configuration for a hub
 */
export interface HubEngagementConfig {
    /** Whether engagement features are enabled */
    enabled: boolean;
    /** Backend configuration */
    backend: BackendConfig;
    /** Telemetry settings */
    telemetry?: TelemetryConfig;
    /** Rating settings */
    ratings?: RatingConfig;
    /** Feedback settings */
    feedback?: FeedbackConfig;
}

// ============================================================================
// Aggregated Engagement Data
// ============================================================================

/**
 * Combined engagement data for a resource
 */
export interface ResourceEngagement {
    resourceId: string;
    resourceType: EngagementResourceType;
    /** Rating statistics */
    ratings?: RatingStats;
    /** Recent feedback entries */
    recentFeedback?: Feedback[];
    /** Telemetry summary */
    telemetry?: {
        installCount: number;
        viewCount: number;
        lastActivity?: string;
    };
}

// ============================================================================
// Privacy Types
// ============================================================================

/**
 * User privacy preferences for engagement
 */
export interface EngagementPrivacySettings {
    /** Whether telemetry collection is enabled */
    telemetryEnabled: boolean;
    /** Whether to share ratings publicly (for remote backends) */
    shareRatingsPublicly: boolean;
    /** Whether to share feedback publicly (for remote backends) */
    shareFeedbackPublicly: boolean;
}

/**
 * Default privacy settings (privacy-preserving)
 */
export const DEFAULT_PRIVACY_SETTINGS: EngagementPrivacySettings = {
    telemetryEnabled: false,
    shareRatingsPublicly: false,
    shareFeedbackPublicly: false,
};

// ============================================================================
// Validation Helpers
// ============================================================================

/**
 * Check if a value is a valid rating score
 */
export function isValidRatingScore(value: unknown): value is RatingScore {
    return typeof value === 'number' && [1, 2, 3, 4, 5].includes(value);
}

/**
 * Check if a value is a valid telemetry event type
 */
export function isValidTelemetryEventType(value: unknown): value is TelemetryEventType {
    const validTypes: TelemetryEventType[] = [
        'bundle_install',
        'bundle_uninstall',
        'bundle_update',
        'bundle_view',
        'profile_activate',
        'profile_deactivate',
        'hub_import',
        'hub_sync',
        'search',
        'error',
    ];
    return typeof value === 'string' && validTypes.includes(value as TelemetryEventType);
}

/**
 * Check if a value is a valid engagement resource type
 */
export function isValidEngagementResourceType(value: unknown): value is EngagementResourceType {
    return typeof value === 'string' && ['bundle', 'profile', 'hub'].includes(value);
}

/**
 * Check if a value is a valid backend type
 */
export function isValidBackendType(value: unknown): value is EngagementBackendType {
    const validTypes: EngagementBackendType[] = [
        'file',
        'github-issues',
        'github-discussions',
        'api',
    ];
    return typeof value === 'string' && validTypes.includes(value as EngagementBackendType);
}

/**
 * Validate a hub engagement configuration
 */
export function validateHubEngagementConfig(config: unknown): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!config || typeof config !== 'object') {
        return { valid: false, errors: ['Engagement config must be an object'] };
    }

    const cfg = config as Record<string, unknown>;

    if (typeof cfg.enabled !== 'boolean') {
        errors.push('engagement.enabled must be a boolean');
    }

    if (cfg.backend) {
        if (typeof cfg.backend !== 'object') {
            errors.push('engagement.backend must be an object');
        } else {
            const backend = cfg.backend as Record<string, unknown>;
            if (!isValidBackendType(backend.type)) {
                errors.push(`engagement.backend.type must be one of: file, github-issues, github-discussions, api`);
            }

            // Validate backend-specific fields
            if (backend.type === 'github-issues' || backend.type === 'github-discussions') {
                if (typeof backend.repository !== 'string' || !backend.repository) {
                    errors.push(`engagement.backend.repository is required for ${backend.type}`);
                }
            }

            if (backend.type === 'api') {
                if (typeof backend.baseUrl !== 'string' || !backend.baseUrl) {
                    errors.push('engagement.backend.baseUrl is required for api backend');
                }
            }
        }
    }

    // Validate telemetry config if present
    if (cfg.telemetry) {
        if (typeof cfg.telemetry !== 'object') {
            errors.push('engagement.telemetry must be an object');
        } else {
            const telemetry = cfg.telemetry as Record<string, unknown>;
            if (typeof telemetry.enabled !== 'boolean') {
                errors.push('engagement.telemetry.enabled must be a boolean');
            }
            if (telemetry.events && !Array.isArray(telemetry.events)) {
                errors.push('engagement.telemetry.events must be an array');
            }
        }
    }

    // Validate ratings config if present
    if (cfg.ratings) {
        if (typeof cfg.ratings !== 'object') {
            errors.push('engagement.ratings must be an object');
        } else {
            const ratings = cfg.ratings as Record<string, unknown>;
            if (typeof ratings.enabled !== 'boolean') {
                errors.push('engagement.ratings.enabled must be a boolean');
            }
            if (ratings.ratingsUrl !== undefined) {
                if (typeof ratings.ratingsUrl !== 'string') {
                    errors.push('engagement.ratings.ratingsUrl must be a string');
                } else {
                    try {
                        new URL(ratings.ratingsUrl);
                    } catch {
                        errors.push('engagement.ratings.ratingsUrl must be a valid URL');
                    }
                }
            }
        }
    }

    // Validate feedback config if present
    if (cfg.feedback) {
        if (typeof cfg.feedback !== 'object') {
            errors.push('engagement.feedback must be an object');
        } else {
            const feedback = cfg.feedback as Record<string, unknown>;
            if (typeof feedback.enabled !== 'boolean') {
                errors.push('engagement.feedback.enabled must be a boolean');
            }
            if (feedback.maxLength !== undefined && typeof feedback.maxLength !== 'number') {
                errors.push('engagement.feedback.maxLength must be a number');
            }
            if (feedback.feedbackUrl !== undefined) {
                if (typeof feedback.feedbackUrl !== 'string') {
                    errors.push('engagement.feedback.feedbackUrl must be a string');
                } else {
                    try {
                        new URL(feedback.feedbackUrl);
                    } catch {
                        errors.push('engagement.feedback.feedbackUrl must be a valid URL');
                    }
                }
            }
        }
    }

    return { valid: errors.length === 0, errors };
}

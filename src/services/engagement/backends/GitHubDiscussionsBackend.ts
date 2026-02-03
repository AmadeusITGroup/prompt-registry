/**
 * GitHubDiscussionsBackend - Engagement backend using GitHub Discussions
 * 
 * Uses GitHub Discussions as the voting surface:
 * - Each collection maps to a Discussion
 * - Reactions (👍/👎) are used for voting
 * - Comments can be used for resource-level voting
 * 
 * This backend is read-heavy and write-light:
 * - Ratings are fetched from pre-computed ratings.json (via RatingService)
 * - Votes are submitted via GitHub REST API
 * - Telemetry and feedback are stored locally (not in GitHub)
 */

import * as vscode from 'vscode';
import axios from 'axios';
import * as yaml from 'js-yaml';
import { BaseEngagementBackend } from '../IEngagementBackend';
import {
    TelemetryEvent,
    TelemetryFilter,
    Rating,
    RatingStats,
    Feedback,
    BackendConfig,
    GitHubDiscussionsBackendConfig,
    EngagementResourceType,
} from '../../../types/engagement';
import { Logger } from '../../../utils/logger';
import { FileBackend } from './FileBackend';

/**
 * Mapping of resource IDs to GitHub Discussion numbers
 */
interface DiscussionMapping {
    resourceId: string;
    discussionNumber: number;
    commentId?: number;
}

/**
 * GitHub Discussions Backend implementation
 */
export class GitHubDiscussionsBackend extends BaseEngagementBackend {
    readonly type = 'github-discussions';
    
    private logger: Logger;
    private config?: GitHubDiscussionsBackendConfig;
    private owner: string = '';
    private repo: string = '';
    private discussionMappings: Map<string, DiscussionMapping> = new Map();
    
    // Use FileBackend for local storage of telemetry and feedback
    private localBackend: FileBackend;
    
    // Cache for user's votes
    private userVotes: Map<string, 'up' | 'down'> = new Map();

    // Storage path for local backend (can be set before initialize)
    private storagePath: string = '';

    constructor(storagePath?: string) {
        super();
        this.logger = Logger.getInstance();
        this.localBackend = new FileBackend();
        if (storagePath) {
            this.storagePath = storagePath;
        }
    }

    /**
     * Set storage path for local backend (must be called before initialize)
     */
    setStoragePath(path: string): void {
        this.storagePath = path;
    }

    /**
     * Initialize the backend
     */
    async initialize(config: BackendConfig): Promise<void> {
        if (config.type !== 'github-discussions') {
            throw new Error(`Invalid config type: ${config.type}. Expected 'github-discussions'.`);
        }

        this.config = config as GitHubDiscussionsBackendConfig;
        
        // Parse repository
        const [owner, repo] = this.config.repository.split('/');
        if (!owner || !repo) {
            throw new Error(`Invalid repository format: ${this.config.repository}. Expected 'owner/repo'.`);
        }
        this.owner = owner;
        this.repo = repo;

        // Initialize local backend for telemetry/feedback storage
        if (!this.storagePath) {
            throw new Error('Storage path is required. Call setStoragePath() before initialize().');
        }
        await this.localBackend.initialize({
            type: 'file',
            storagePath: this.storagePath,
        });

        this._initialized = true;
        this.logger.info(`GitHubDiscussionsBackend initialized for ${this.config.repository}`);
    }

    /**
     * Dispose resources
     */
    dispose(): void {
        this.localBackend.dispose();
        this.discussionMappings.clear();
        this.userVotes.clear();
        this._initialized = false;
    }

    /**
     * Set discussion mapping for a resource
     */
    setDiscussionMapping(resourceId: string, discussionNumber: number, commentId?: number): void {
        this.discussionMappings.set(resourceId, {
            resourceId,
            discussionNumber,
            commentId
        });
    }

    /**
     * Get discussion mapping for a resource
     * @param resourceId - Resource ID in format "sourceId:bundleId"
     * @returns Discussion mapping or undefined if not found
     */
    getDiscussionMapping(resourceId: string): DiscussionMapping | undefined {
        return this.discussionMappings.get(resourceId);
    }

    /**
     * Get repository owner and name
     */
    getRepository(): { owner: string; repo: string } {
        this.ensureInitialized();
        return { owner: this.owner, repo: this.repo };
    }

    /**
     * Load collection mappings from collections.yaml URL
     * Maps bundles (sourceId:bundleId) to GitHub Discussion numbers
     */
    async loadCollectionsMappings(collectionsUrl: string): Promise<void> {
        this.ensureInitialized();

        try {
            this.logger.info(`Loading collections mappings from ${collectionsUrl}`);
            
            const response = await axios.get(collectionsUrl);
            const collections = yaml.load(response.data) as {
                repository: string;
                collections: Array<{
                    id: string;
                    source_id: string;
                    discussion_number: number;
                    comment_id?: number;
                }>;
            };

            if (!collections || !collections.collections) {
                throw new Error('Invalid collections.yaml format: missing collections array');
            }

            let mappedCount = 0;
            for (const collection of collections.collections) {
                const resourceId = `${collection.source_id}:${collection.id}`;
                this.setDiscussionMapping(
                    resourceId,
                    collection.discussion_number,
                    collection.comment_id
                );
                mappedCount++;
            }

            this.logger.info(`Loaded ${mappedCount} collection mappings`);
        } catch (error: any) {
            if (error.response) {
                throw new Error(`Failed to load collections mappings: HTTP ${error.response.status}`);
            } else if (error.name === 'YAMLException') {
                throw new Error(`Failed to parse collections mappings: ${error.message}`);
            } else {
                throw new Error(`Failed to load collections mappings: ${error.message}`);
            }
        }
    }

    /**
     * Get GitHub access token via VS Code authentication
     */
    private async getAccessToken(): Promise<string> {
        const session = await vscode.authentication.getSession('github', ['repo'], {
            createIfNone: true
        });
        return session.accessToken;
    }

    // ========================================================================
    // Telemetry Operations (delegated to local backend)
    // ========================================================================

    async recordTelemetry(event: TelemetryEvent): Promise<void> {
        this.ensureInitialized();
        await this.localBackend.recordTelemetry(event);
    }

    async getTelemetry(filter?: TelemetryFilter): Promise<TelemetryEvent[]> {
        this.ensureInitialized();
        return this.localBackend.getTelemetry(filter);
    }

    async clearTelemetry(filter?: TelemetryFilter): Promise<void> {
        this.ensureInitialized();
        await this.localBackend.clearTelemetry(filter);
    }

    // ========================================================================
    // Rating Operations
    // ========================================================================

    /**
     * Submit a rating (vote) via GitHub Discussions reaction
     */
    async submitRating(rating: Rating): Promise<void> {
        this.ensureInitialized();

        // Try exact match first
        let mapping = this.discussionMappings.get(rating.resourceId);
        
        // If no exact match, try to find a mapping that ends with the resourceId
        if (!mapping) {
            for (const [key, value] of this.discussionMappings.entries()) {
                if (key.endsWith(`:${rating.resourceId}`)) {
                    this.logger.debug(`[GitHubDiscussionsBackend] Found rating mapping via suffix match: ${key}`);
                    mapping = value;
                    break;
                }
            }
        }
        
        if (!mapping) {
            this.logger.warn(`No discussion mapping for resource: ${rating.resourceId}`);
            // Fall back to local storage
            await this.localBackend.submitRating(rating);
            return;
        }

        try {
            const token = await this.getAccessToken();
            const reaction = rating.score >= 3 ? '+1' : '-1';

            // Remove existing reaction first (if any)
            await this.removeExistingReaction(mapping, token);

            // Add new reaction
            const url = mapping.commentId
                ? `https://api.github.com/repos/${this.owner}/${this.repo}/discussions/comments/${mapping.commentId}/reactions`
                : `https://api.github.com/repos/${this.owner}/${this.repo}/discussions/${mapping.discussionNumber}/reactions`;

            await axios.post(url, { content: reaction }, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Accept': 'application/vnd.github+json',
                    'X-GitHub-Api-Version': '2022-11-28'
                }
            });

            // Cache the vote
            this.userVotes.set(rating.resourceId, rating.score >= 3 ? 'up' : 'down');

            this.logger.info(`Submitted ${reaction} reaction for ${rating.resourceId}`);
        } catch (error: any) {
            this.logger.error(`Failed to submit rating to GitHub: ${error.message}`, error);
            // Fall back to local storage
            await this.localBackend.submitRating(rating);
        }
    }

    /**
     * Remove existing reaction before adding new one
     */
    private async removeExistingReaction(mapping: DiscussionMapping, token: string): Promise<void> {
        try {
            const url = mapping.commentId
                ? `https://api.github.com/repos/${this.owner}/${this.repo}/discussions/comments/${mapping.commentId}/reactions`
                : `https://api.github.com/repos/${this.owner}/${this.repo}/discussions/${mapping.discussionNumber}/reactions`;

            const response = await axios.get<Array<{ id: number; user: { login: string }; content: string }>>(url, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Accept': 'application/vnd.github+json',
                    'X-GitHub-Api-Version': '2022-11-28'
                }
            });

            // Find user's existing reactions
            const userInfo = await this.getCurrentUser(token);
            const userReactions = response.data.filter(r => 
                r.user.login === userInfo.login && (r.content === '+1' || r.content === '-1')
            );

            // Delete existing reactions
            for (const reaction of userReactions) {
                await axios.delete(
                    `https://api.github.com/repos/${this.owner}/${this.repo}/reactions/${reaction.id}`,
                    {
                        headers: {
                            'Authorization': `Bearer ${token}`,
                            'Accept': 'application/vnd.github+json',
                            'X-GitHub-Api-Version': '2022-11-28'
                        }
                    }
                );
            }
        } catch (error) {
            // Ignore errors - reaction may not exist
            this.logger.debug('No existing reaction to remove');
        }
    }

    /**
     * Get current GitHub user info
     */
    private async getCurrentUser(token: string): Promise<{ login: string }> {
        const response = await axios.get<{ login: string }>('https://api.github.com/user', {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/vnd.github+json'
            }
        });
        return response.data;
    }

    /**
     * Get user's rating for a resource
     */
    async getRating(
        resourceType: EngagementResourceType,
        resourceId: string
    ): Promise<Rating | undefined> {
        this.ensureInitialized();

        // Check cache first
        const cachedVote = this.userVotes.get(resourceId);
        if (cachedVote) {
            return {
                id: `${resourceId}-vote`,
                resourceType,
                resourceId,
                score: cachedVote === 'up' ? 5 : 1,
                timestamp: new Date().toISOString()
            };
        }

        // Fall back to local backend
        return this.localBackend.getRating(resourceType, resourceId);
    }

    /**
     * Get aggregated rating statistics
     * Note: This returns cached/computed stats, not live data
     */
    async getAggregatedRatings(
        resourceType: EngagementResourceType,
        resourceId: string
    ): Promise<RatingStats | undefined> {
        this.ensureInitialized();
        // Aggregated ratings should come from RatingService/RatingCache
        // which fetches from the pre-computed ratings.json
        return this.localBackend.getAggregatedRatings(resourceType, resourceId);
    }

    /**
     * Delete user's rating (remove reaction)
     */
    async deleteRating(
        resourceType: EngagementResourceType,
        resourceId: string
    ): Promise<void> {
        this.ensureInitialized();

        // Try exact match first
        let mapping = this.discussionMappings.get(resourceId);
        
        // If no exact match, try to find a mapping that ends with the resourceId
        if (!mapping) {
            for (const [key, value] of this.discussionMappings.entries()) {
                if (key.endsWith(`:${resourceId}`)) {
                    mapping = value;
                    break;
                }
            }
        }
        
        if (!mapping) {
            await this.localBackend.deleteRating(resourceType, resourceId);
            return;
        }

        try {
            const token = await this.getAccessToken();
            await this.removeExistingReaction(mapping, token);
            this.userVotes.delete(resourceId);
            this.logger.info(`Removed rating for ${resourceId}`);
        } catch (error: any) {
            this.logger.error(`Failed to delete rating from GitHub: ${error.message}`, error);
            await this.localBackend.deleteRating(resourceType, resourceId);
        }
    }

    // ========================================================================
    // Feedback Operations (delegated to local backend)
    // ========================================================================

    async submitFeedback(feedback: Feedback): Promise<void> {
        this.ensureInitialized();
        
        this.logger.info(`[GitHubDiscussionsBackend] Feedback received for ${feedback.resourceType}/${feedback.resourceId}`);
        this.logger.info(`[GitHubDiscussionsBackend] Comment: "${feedback.comment}", Rating: ${feedback.rating}`);
        this.logger.debug(`[GitHubDiscussionsBackend] Available mappings: ${Array.from(this.discussionMappings.keys()).join(', ')}`);
        
        // Try exact match first
        let mapping = this.discussionMappings.get(feedback.resourceId);
        
        // If no exact match, try to find a mapping that ends with the resourceId
        // This handles the case where resourceId is just the bundle ID without source prefix
        if (!mapping) {
            for (const [key, value] of this.discussionMappings.entries()) {
                if (key.endsWith(`:${feedback.resourceId}`)) {
                    this.logger.debug(`[GitHubDiscussionsBackend] Found mapping via suffix match: ${key}`);
                    mapping = value;
                    break;
                }
            }
        }
        
        if (mapping) {
            // Try to post to GitHub Discussions
            try {
                await this.postFeedbackToDiscussion(feedback, mapping);
                this.logger.info(`[GitHubDiscussionsBackend] Feedback posted to GitHub Discussion #${mapping.discussionNumber}`);
            } catch (error: any) {
                this.logger.warn(`[GitHubDiscussionsBackend] Failed to post to GitHub, storing locally: ${error.message}`);
            }
        } else {
            this.logger.debug('[GitHubDiscussionsBackend] No discussion mapping found, storing locally only');
        }
        
        // Always store locally as backup
        await this.localBackend.submitFeedback(feedback);
        this.logger.info('[GitHubDiscussionsBackend] Feedback saved to local file backend');
    }

    /**
     * Post feedback as a comment to a GitHub Discussion using GraphQL API
     */
    private async postFeedbackToDiscussion(feedback: Feedback, mapping: DiscussionMapping): Promise<void> {
        const token = await this.getAccessToken();
        
        // Step 1: Get the Discussion node ID using GraphQL
        const discussionId = await this.getDiscussionNodeId(mapping.discussionNumber, token);
        
        // Step 2: Format the comment body
        const commentBody = this.formatFeedbackComment(feedback);
        
        // Step 3: Add comment to discussion using GraphQL mutation
        await this.addDiscussionComment(discussionId, commentBody, token);
    }

    /**
     * Get the GitHub Discussion node ID (required for GraphQL mutations)
     */
    private async getDiscussionNodeId(discussionNumber: number, token: string): Promise<string> {
        const query = `
            query GetDiscussionId($owner: String!, $repo: String!, $number: Int!) {
                repository(owner: $owner, name: $repo) {
                    discussion(number: $number) {
                        id
                    }
                }
            }
        `;

        const response = await axios.post<{
            data: {
                repository: {
                    discussion: {
                        id: string;
                    };
                };
            };
        }>(
            'https://api.github.com/graphql',
            {
                query,
                variables: {
                    owner: this.owner,
                    repo: this.repo,
                    number: discussionNumber
                }
            },
            {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        const discussionId = response.data?.data?.repository?.discussion?.id;
        if (!discussionId) {
            throw new Error(`Discussion #${discussionNumber} not found`);
        }

        return discussionId;
    }

    /**
     * Add a comment to a GitHub Discussion using GraphQL mutation
     */
    private async addDiscussionComment(discussionId: string, body: string, token: string): Promise<void> {
        const mutation = `
            mutation AddDiscussionComment($discussionId: ID!, $body: String!) {
                addDiscussionComment(input: { discussionId: $discussionId, body: $body }) {
                    comment {
                        id
                        body
                    }
                }
            }
        `;

        this.logger.debug(`[GitHubDiscussionsBackend] Adding comment to discussion ${discussionId}`);
        this.logger.debug(`[GitHubDiscussionsBackend] Comment body: ${body.substring(0, 100)}...`);

        const response = await axios.post<{
            data?: {
                addDiscussionComment?: {
                    comment?: {
                        id: string;
                        body: string;
                    };
                };
            };
            errors?: Array<{ message: string; type?: string }>;
        }>(
            'https://api.github.com/graphql',
            {
                query: mutation,
                variables: {
                    discussionId,
                    body
                }
            },
            {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        // Check for GraphQL errors
        if (response.data.errors && response.data.errors.length > 0) {
            const errorMessages = response.data.errors.map(e => e.message).join(', ');
            this.logger.error(`[GitHubDiscussionsBackend] GraphQL errors: ${errorMessages}`);
            throw new Error(`GraphQL error: ${errorMessages}`);
        }

        // Verify comment was created
        const commentId = response.data.data?.addDiscussionComment?.comment?.id;
        if (!commentId) {
            this.logger.error(`[GitHubDiscussionsBackend] No comment ID returned. Response: ${JSON.stringify(response.data)}`);
            throw new Error('Comment was not created - no comment ID returned');
        }

        this.logger.info(`[GitHubDiscussionsBackend] Comment created with ID: ${commentId}`);
    }

    /**
     * Format feedback into a readable GitHub comment
     * New format:
     * Rating: ⭐⭐⭐⭐⭐
     * Feedback: Works great!
     * ---
     * Version: 1.0.0
     */
    private formatFeedbackComment(feedback: Feedback): string {
        const parts: string[] = [];
        
        // Rating line with stars if present
        if (feedback.rating !== undefined) {
            const stars = '⭐'.repeat(feedback.rating);
            parts.push(`Rating: ${stars}`);
        }
        
        // Feedback line (only if comment is not empty)
        if (feedback.comment && feedback.comment.trim()) {
            parts.push(`Feedback: ${feedback.comment}`);
        }
        
        // Add metadata footer with separator
        if (feedback.version) {
            parts.push('---');
            parts.push(`Version: ${feedback.version}`);
        }
        
        return parts.join('\n');
    }

    async getFeedback(
        resourceType: EngagementResourceType,
        resourceId: string,
        limit?: number
    ): Promise<Feedback[]> {
        this.ensureInitialized();
        return this.localBackend.getFeedback(resourceType, resourceId, limit);
    }

    async deleteFeedback(feedbackId: string): Promise<void> {
        this.ensureInitialized();
        await this.localBackend.deleteFeedback(feedbackId);
    }
}

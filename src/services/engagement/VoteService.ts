import * as vscode from 'vscode';
import axios, { AxiosError } from 'axios';
import { Logger } from '../../utils/logger';

/**
 * Reaction types supported by GitHub
 */
export type GitHubReaction = '+1' | '-1' | 'laugh' | 'confused' | 'heart' | 'hooray' | 'rocket' | 'eyes';

/**
 * Vote reaction types (subset of GitHub reactions)
 */
export type VoteReaction = '+1' | '-1';

/**
 * Result of a vote operation
 */
export interface VoteResult {
    success: boolean;
    reactionId?: number;
    error?: string;
}

/**
 * Configuration for a votable resource
 */
export interface VotableResource {
    /** GitHub repository owner */
    owner: string;
    /** GitHub repository name */
    repo: string;
    /** Discussion number for collection-level voting */
    discussionNumber: number;
    /** Comment ID for resource-level voting (optional) */
    commentId?: number;
}

/**
 * Service for voting on collections and resources via GitHub Discussions
 * 
 * Uses GitHub REST API to create reactions on discussions and comments.
 * Requires GitHub authentication via VS Code's built-in GitHub auth provider.
 */
export class VoteService {
    private readonly logger = Logger.getInstance();
    private readonly defaultOwner: string;
    private readonly defaultRepo: string;

    constructor(owner: string = 'AmadeusITGroup', repo: string = 'prompt-registry') {
        this.defaultOwner = owner;
        this.defaultRepo = repo;
    }

    /**
     * Get GitHub session with required scopes
     * @throws Error if authentication fails
     */
    async getGitHubSession(): Promise<vscode.AuthenticationSession> {
        try {
            const session = await vscode.authentication.getSession('github', ['repo'], {
                createIfNone: true,
            });
            return session;
        } catch (error) {
            const err = error instanceof Error ? error : undefined;
            this.logger.error('Failed to get GitHub session', err);
            throw new Error('GitHub authentication required for voting');
        }
    }

    /**
     * Get axios headers for GitHub API
     */
    private getHeaders(accessToken: string): Record<string, string> {
        return {
            'Authorization': `Bearer ${accessToken}`,
            'Accept': 'application/vnd.github+json',
            'Content-Type': 'application/json',
            'X-GitHub-Api-Version': '2022-11-28'
        };
    }

    /**
     * Extract error message from axios error
     */
    private getErrorMessage(error: unknown): string {
        if (error instanceof AxiosError) {
            return error.response?.data?.message || error.message;
        }
        return error instanceof Error ? error.message : String(error);
    }

    /**
     * Vote on a collection (discussion-level)
     * 
     * @param discussionNumber - GitHub Discussion number
     * @param reaction - Vote reaction (+1 or -1)
     * @param owner - Repository owner (optional, uses default)
     * @param repo - Repository name (optional, uses default)
     * @returns Vote result
     */
    async voteOnCollection(
        discussionNumber: number,
        reaction: VoteReaction,
        owner?: string,
        repo?: string
    ): Promise<VoteResult> {
        const repoOwner = owner || this.defaultOwner;
        const repoName = repo || this.defaultRepo;

        try {
            const session = await this.getGitHubSession();
            
            const response = await axios.post(
                `https://api.github.com/repos/${repoOwner}/${repoName}/discussions/${discussionNumber}/reactions`,
                { content: reaction },
                { headers: this.getHeaders(session.accessToken) }
            );

            this.logger.info(`Vote recorded on discussion ${discussionNumber}: ${reaction}`);
            
            return {
                success: true,
                reactionId: response.data.id
            };
        } catch (error) {
            const errorMessage = this.getErrorMessage(error);
            const err = error instanceof Error ? error : undefined;
            this.logger.error('Vote on collection failed', err);
            return {
                success: false,
                error: errorMessage
            };
        }
    }

    /**
     * Vote on a resource (comment-level)
     * 
     * @param discussionNumber - GitHub Discussion number
     * @param commentId - Comment ID within the discussion
     * @param reaction - Vote reaction (+1 or -1)
     * @param owner - Repository owner (optional, uses default)
     * @param repo - Repository name (optional, uses default)
     * @returns Vote result
     */
    async voteOnResource(
        discussionNumber: number,
        commentId: number,
        reaction: VoteReaction,
        owner?: string,
        repo?: string
    ): Promise<VoteResult> {
        const repoOwner = owner || this.defaultOwner;
        const repoName = repo || this.defaultRepo;

        try {
            const session = await this.getGitHubSession();
            
            const response = await axios.post(
                `https://api.github.com/repos/${repoOwner}/${repoName}/discussions/${discussionNumber}/comments/${commentId}/reactions`,
                { content: reaction },
                { headers: this.getHeaders(session.accessToken) }
            );

            this.logger.info(`Vote recorded on comment ${commentId}: ${reaction}`);
            
            return {
                success: true,
                reactionId: response.data.id
            };
        } catch (error) {
            const errorMessage = this.getErrorMessage(error);
            const err = error instanceof Error ? error : undefined;
            this.logger.error('Vote on resource failed', err);
            return {
                success: false,
                error: errorMessage
            };
        }
    }

    /**
     * Remove a vote (delete reaction)
     * 
     * @param reactionId - Reaction ID to delete
     * @param owner - Repository owner (optional, uses default)
     * @param repo - Repository name (optional, uses default)
     * @returns Success status
     */
    async removeVote(
        reactionId: number,
        owner?: string,
        repo?: string
    ): Promise<VoteResult> {
        const repoOwner = owner || this.defaultOwner;
        const repoName = repo || this.defaultRepo;

        try {
            const session = await this.getGitHubSession();
            
            await axios.delete(
                `https://api.github.com/repos/${repoOwner}/${repoName}/reactions/${reactionId}`,
                { headers: this.getHeaders(session.accessToken) }
            );

            this.logger.info(`Vote removed: reaction ${reactionId}`);
            return { success: true };
        } catch (error) {
            const errorMessage = this.getErrorMessage(error);
            const err = error instanceof Error ? error : undefined;
            this.logger.error('Remove vote failed', err);
            return {
                success: false,
                error: errorMessage
            };
        }
    }

    /**
     * Fetch all reactions with pagination support
     * GitHub API returns max 100 items per page
     */
    private async fetchAllReactions(
        url: string,
        headers: Record<string, string>
    ): Promise<Array<{ id: number; content: string; user: { login: string } }>> {
        const allReactions: Array<{ id: number; content: string; user: { login: string } }> = [];
        let page = 1;
        const perPage = 100;
        
        let hasMore = true;
        while (hasMore) {
            const response = await axios.get(
                `${url}?per_page=${perPage}&page=${page}`,
                { headers }
            );
            
            const reactions = response.data as Array<{ id: number; content: string; user: { login: string } }>;
            allReactions.push(...reactions);
            
            // If we got fewer than perPage results, we've reached the end
            if (reactions.length < perPage) {
                hasMore = false;
            }
            
            page++;
            
            // Safety limit to prevent infinite loops
            if (page > 100) {
                this.logger.warn(`Pagination limit reached for ${url}`);
                hasMore = false;
            }
        }
        
        return allReactions;
    }

    /**
     * Get current user's vote on a discussion
     * 
     * @param discussionNumber - GitHub Discussion number
     * @param owner - Repository owner (optional, uses default)
     * @param repo - Repository name (optional, uses default)
     * @returns Current vote reaction or null if not voted
     */
    async getCurrentVote(
        discussionNumber: number,
        owner?: string,
        repo?: string
    ): Promise<{ reaction: VoteReaction; reactionId: number } | null> {
        const repoOwner = owner || this.defaultOwner;
        const repoName = repo || this.defaultRepo;

        try {
            const session = await this.getGitHubSession();
            const headers = this.getHeaders(session.accessToken);
            
            // Get current user
            const userResponse = await axios.get('https://api.github.com/user', { headers });
            const user = userResponse.data as { login: string };
            
            // Get all reactions on the discussion (with pagination)
            const reactions = await this.fetchAllReactions(
                `https://api.github.com/repos/${repoOwner}/${repoName}/discussions/${discussionNumber}/reactions`,
                headers
            );
            
            // Find user's vote reaction
            const userReaction = reactions.find(
                r => r.user.login === user.login && (r.content === '+1' || r.content === '-1')
            );
            
            if (userReaction) {
                return {
                    reaction: userReaction.content as VoteReaction,
                    reactionId: userReaction.id
                };
            }
            
            return null;
        } catch (error) {
            const err = error instanceof Error ? error : undefined;
            this.logger.error('Get current vote failed', err);
            return null;
        }
    }

    /**
     * Toggle vote on a collection
     * If user has already voted with the same reaction, remove it.
     * If user has voted with different reaction, change it.
     * If user hasn't voted, add the vote.
     * 
     * @param discussionNumber - GitHub Discussion number
     * @param reaction - Vote reaction (+1 or -1)
     * @param owner - Repository owner (optional, uses default)
     * @param repo - Repository name (optional, uses default)
     * @returns Vote result with action taken
     */
    async toggleVote(
        discussionNumber: number,
        reaction: VoteReaction,
        owner?: string,
        repo?: string
    ): Promise<VoteResult & { action: 'added' | 'removed' | 'changed' }> {
        const currentVote = await this.getCurrentVote(discussionNumber, owner, repo);
        
        if (currentVote) {
            if (currentVote.reaction === reaction) {
                // Same reaction - remove it
                const result = await this.removeVote(currentVote.reactionId, owner, repo);
                return { ...result, action: 'removed' };
            } else {
                // Different reaction - remove old, add new
                await this.removeVote(currentVote.reactionId, owner, repo);
                const result = await this.voteOnCollection(discussionNumber, reaction, owner, repo);
                return { ...result, action: 'changed' };
            }
        } else {
            // No current vote - add new
            const result = await this.voteOnCollection(discussionNumber, reaction, owner, repo);
            return { ...result, action: 'added' };
        }
    }
}

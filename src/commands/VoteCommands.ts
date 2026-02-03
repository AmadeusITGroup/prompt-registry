import * as vscode from 'vscode';
import { VoteService, VoteReaction, VoteResult } from '../services/engagement/VoteService';
import { Logger } from '../utils/logger';

/**
 * Item that can be voted on
 */
export interface VotableItem {
    /** GitHub Discussion number */
    discussionNumber: number;
    /** Comment ID for resource-level voting (optional) */
    commentId?: number;
    /** Repository owner (optional, uses default) */
    owner?: string;
    /** Repository name (optional, uses default) */
    repo?: string;
    /** Display name for user feedback */
    displayName?: string;
}

/**
 * Commands for voting on collections and resources
 */
export class VoteCommands {
    private readonly logger = Logger.getInstance();
    private readonly voteService: VoteService;

    constructor(voteService?: VoteService) {
        this.voteService = voteService || new VoteService();
    }

    /**
     * Register all vote commands
     */
    registerCommands(context: vscode.ExtensionContext): void {
        context.subscriptions.push(
            vscode.commands.registerCommand(
                'promptRegistry.voteUpCollection',
                (item: VotableItem) => this.voteUpCollection(item)
            ),
            vscode.commands.registerCommand(
                'promptRegistry.voteDownCollection',
                (item: VotableItem) => this.voteDownCollection(item)
            ),
            vscode.commands.registerCommand(
                'promptRegistry.voteUpResource',
                (item: VotableItem) => this.voteUpResource(item)
            ),
            vscode.commands.registerCommand(
                'promptRegistry.voteDownResource',
                (item: VotableItem) => this.voteDownResource(item)
            ),
            vscode.commands.registerCommand(
                'promptRegistry.toggleVote',
                (item: VotableItem, reaction: VoteReaction) => this.toggleVote(item, reaction)
            ),
            vscode.commands.registerCommand(
                'promptRegistry.removeVote',
                (item: VotableItem & { reactionId: number }) => this.removeVote(item)
            )
        );
    }

    /**
     * Vote up on a collection
     */
    async voteUpCollection(item: VotableItem): Promise<VoteResult> {
        return this.vote(item, '+1', 'collection');
    }

    /**
     * Vote down on a collection
     */
    async voteDownCollection(item: VotableItem): Promise<VoteResult> {
        return this.vote(item, '-1', 'collection');
    }

    /**
     * Vote up on a resource
     */
    async voteUpResource(item: VotableItem): Promise<VoteResult> {
        if (!item.commentId) {
            vscode.window.showErrorMessage('Resource voting requires a comment ID');
            return { success: false, error: 'Missing comment ID' };
        }
        return this.vote(item, '+1', 'resource');
    }

    /**
     * Vote down on a resource
     */
    async voteDownResource(item: VotableItem): Promise<VoteResult> {
        if (!item.commentId) {
            vscode.window.showErrorMessage('Resource voting requires a comment ID');
            return { success: false, error: 'Missing comment ID' };
        }
        return this.vote(item, '-1', 'resource');
    }

    /**
     * Toggle vote on a collection
     */
    async toggleVote(item: VotableItem, reaction: VoteReaction): Promise<VoteResult & { action: 'added' | 'removed' | 'changed' }> {
        try {
            const result = await this.voteService.toggleVote(
                item.discussionNumber,
                reaction,
                item.owner,
                item.repo
            );

            if (result.success) {
                const actionMessages = {
                    added: 'Vote recorded',
                    removed: 'Vote removed',
                    changed: 'Vote changed'
                };
                const displayName = item.displayName || `discussion #${item.discussionNumber}`;
                vscode.window.showInformationMessage(`${actionMessages[result.action]}: ${displayName}`);
            } else {
                vscode.window.showErrorMessage(`Vote failed: ${result.error}`);
            }

            return result;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger.error('Toggle vote failed', error instanceof Error ? error : undefined);
            vscode.window.showErrorMessage(`Vote failed: ${errorMessage}`);
            return { success: false, error: errorMessage, action: 'added' };
        }
    }

    /**
     * Remove a vote
     */
    async removeVote(item: VotableItem & { reactionId: number }): Promise<VoteResult> {
        try {
            const result = await this.voteService.removeVote(
                item.reactionId,
                item.owner,
                item.repo
            );

            if (result.success) {
                const displayName = item.displayName || `discussion #${item.discussionNumber}`;
                vscode.window.showInformationMessage(`Vote removed: ${displayName}`);
            } else {
                vscode.window.showErrorMessage(`Failed to remove vote: ${result.error}`);
            }

            return result;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger.error('Remove vote failed', error instanceof Error ? error : undefined);
            vscode.window.showErrorMessage(`Failed to remove vote: ${errorMessage}`);
            return { success: false, error: errorMessage };
        }
    }

    /**
     * Internal vote method
     */
    private async vote(
        item: VotableItem,
        reaction: VoteReaction,
        type: 'collection' | 'resource'
    ): Promise<VoteResult> {
        try {
            let result: VoteResult;

            if (type === 'resource' && item.commentId) {
                result = await this.voteService.voteOnResource(
                    item.discussionNumber,
                    item.commentId,
                    reaction,
                    item.owner,
                    item.repo
                );
            } else {
                result = await this.voteService.voteOnCollection(
                    item.discussionNumber,
                    reaction,
                    item.owner,
                    item.repo
                );
            }

            if (result.success) {
                const voteType = reaction === '+1' ? '👍' : '👎';
                const displayName = item.displayName || `${type} #${item.discussionNumber}`;
                vscode.window.showInformationMessage(`${voteType} Vote recorded: ${displayName}`);
            } else {
                vscode.window.showErrorMessage(`Vote failed: ${result.error}`);
            }

            return result;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger.error(`Vote on ${type} failed`, error instanceof Error ? error : undefined);
            vscode.window.showErrorMessage(`Vote failed: ${errorMessage}`);
            return { success: false, error: errorMessage };
        }
    }
}

/**
 * FeedbackCommands - VS Code commands for collecting user feedback
 * 
 * Provides a unified dialog for users to submit feedback on bundles and profiles.
 * The dialog includes:
 * - Star rating (1-5)
 * - Binary feedback (+1 Works great / -1 Couldn't make it work)
 * - Optional redirect to GitHub issues for bug reports/suggestions
 */

import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { Logger } from '../utils/logger';
import { EngagementService } from '../services/engagement/EngagementService';
import { RatingScore, Feedback, EngagementResourceType } from '../types/engagement';

/**
 * Item that can receive feedback
 */
export interface FeedbackableItem {
    /** Resource ID (bundle ID, profile ID, etc.) */
    resourceId: string;
    /** Resource type */
    resourceType: EngagementResourceType;
    /** Display name for the resource */
    name?: string;
    /** Version of the resource */
    version?: string;
    /** Source repository URL for issue redirect */
    sourceUrl?: string;
    /** Source type (github, awesome-copilot, etc.) for terminology */
    sourceType?: string;
    /** Hub ID for routing feedback to correct backend */
    hubId?: string;
}

/**
 * Feedback submission result
 */
export interface FeedbackResult {
    success: boolean;
    feedback?: Feedback;
    error?: string;
}

/**
 * Commands for feedback collection
 */
export class FeedbackCommands {
    private readonly logger = Logger.getInstance();
    private engagementService?: EngagementService;
    private readonly maxCommentLength: number;

    constructor(engagementService?: EngagementService, maxCommentLength: number = 1000) {
        this.engagementService = engagementService;
        this.maxCommentLength = maxCommentLength;
    }

    /**
     * Set the engagement service (for lazy initialization)
     */
    setEngagementService(service: EngagementService): void {
        this.engagementService = service;
    }

    /**
     * Register feedback commands with VS Code
     */
    registerCommands(context: vscode.ExtensionContext): void {
        context.subscriptions.push(
            // Main feedback command
            vscode.commands.registerCommand(
                'promptRegistry.feedback',
                (item: FeedbackableItem | any) => this.submitFeedback(this.normalizeFeedbackItem(item))
            ),
            // Alias for backward compatibility
            vscode.commands.registerCommand(
                'promptRegistry.submitFeedback',
                (item: FeedbackableItem | any) => this.submitFeedback(this.normalizeFeedbackItem(item))
            )
        );

        this.logger.debug('FeedbackCommands registered');
    }

    /**
     * Normalize various input types to FeedbackableItem
     * Handles TreeView items, direct FeedbackableItem, or bundleId strings
     */
    private normalizeFeedbackItem(item: any): FeedbackableItem {
        // If it's already a FeedbackableItem
        if (item?.resourceId && item?.resourceType) {
            return item as FeedbackableItem;
        }

        // If it's a TreeView item with data (InstalledBundle)
        if (item?.data?.bundleId) {
            return {
                resourceId: item.data.bundleId,
                resourceType: 'bundle',
                name: item.label || item.data.bundleId,
                version: item.data.version,
            };
        }

        // If it's a direct InstalledBundle or Bundle object
        if (item?.bundleId) {
            return {
                resourceId: item.bundleId,
                resourceType: 'bundle',
                name: item.name || item.bundleId,
                version: item.version,
            };
        }

        // If it's just a string (bundleId)
        if (typeof item === 'string') {
            return {
                resourceId: item,
                resourceType: 'bundle',
                name: item,
            };
        }

        // Default fallback - prompt user to select
        return {
            resourceId: 'unknown',
            resourceType: 'bundle',
            name: 'Unknown Resource',
        };
    }

    /**
     * Submit feedback for a resource
     * 
     * Flow:
     * 1. Star rating (1-5)
     * 2. Optional quick comment
     * 3. Action: Report Issue or Skip (just submit rating)
     */
    async submitFeedback(item: FeedbackableItem): Promise<FeedbackResult> {
        const resourceName = item.name || item.resourceId;

        // Step 1: Star Rating (1-5)
        const ratingOptions: vscode.QuickPickItem[] = [
            { label: '⭐⭐⭐⭐⭐', description: '5 stars - Excellent!' },
            { label: '⭐⭐⭐⭐☆', description: '4 stars - Very good' },
            { label: '⭐⭐⭐☆☆', description: '3 stars - Good' },
            { label: '⭐⭐☆☆☆', description: '2 stars - Fair' },
            { label: '⭐☆☆☆☆', description: '1 star - Poor' },
        ];

        const selectedRating = await vscode.window.showQuickPick(ratingOptions, {
            title: `Rate "${resourceName}"`,
            placeHolder: 'Select your rating (1-5 stars)',
        });

        if (!selectedRating) {
            return { success: false, error: 'Cancelled' };
        }

        const rating = this.parseRating(selectedRating.description || '');

        // Step 2: Optional quick comment
        const quickComment = await vscode.window.showInputBox({
            title: `Feedback for "${resourceName}"`,
            prompt: 'Optional short message',
            placeHolder: 'e.g., Works great! or Needs better documentation',
            validateInput: (value) => {
                if (value.length > this.maxCommentLength) {
                    return `Comment must be ${this.maxCommentLength} characters or less`;
                }
                return null;
            },
        });

        if (quickComment === undefined) {
            // User cancelled - still save the rating
            return this.saveFeedback(item, `Rated ${rating} stars`, rating);
        }

        // Step 3: Action options
        const actionOptions: vscode.QuickPickItem[] = [
            { label: '📝 Report issue / suggestion', description: 'Provide detailed feedback by opening an issue in the repository' },
            { label: '⏭️ Skip', description: 'Just submit the star rating' },
        ];

        const selectedAction = await vscode.window.showQuickPick(actionOptions, {
            title: `Feedback for "${resourceName}"`,
            placeHolder: 'Optional: Report an issue or skip',
        });

        // Prepare comment
        const comment = quickComment.trim() || `Rated ${rating} stars`;
        
        // Save the feedback first
        const result = await this.saveFeedback(item, comment, rating);

        // If user wants to report an issue, open the repository issues page
        if (selectedAction?.label.includes('Report issue') && result.success) {
            this.logger.info(`Opening issue tracker for ${item.resourceId}`);
            await this.openIssueTracker(item);
        } else if (selectedAction?.label.includes('Report issue')) {
            this.logger.warn(`Issue tracker not opened - feedback save failed for ${item.resourceId}`);
        }

        return result;
    }

    /**
     * Open the issue tracker for the bundle's source repository
     */
    private async openIssueTracker(item: FeedbackableItem): Promise<void> {
        try {
            this.logger.info(`[openIssueTracker] Starting for ${item.resourceId}`);
            this.logger.info(`[openIssueTracker] sourceUrl: ${item.sourceUrl}`);
            
            if (item.sourceUrl) {
                // Construct issues URL from source URL
                let issueUrl = item.sourceUrl;
                if (issueUrl.endsWith('.git')) {
                    issueUrl = issueUrl.slice(0, -4);
                }
                
                // Extract skill path if present (for skills: github.com/org/repo/skills/skill-name)
                // GitHub issues are always at: https://github.com/<org>/<repo>/issues/new
                // We need to extract just the org/repo part and add skill path to issue body
                let skillPath: string | undefined;
                
                // Match pattern: https://github.com/org/repo/skills/skill-name
                // or: https://github.com/org/repo/tree/branch/skills/skill-name
                const githubMatch = issueUrl.match(/^(https?:\/\/github\.com\/[^\/]+\/[^\/]+)/);
                if (githubMatch) {
                    const baseRepoUrl = githubMatch[1];
                    
                    // Check if there's a skills path after the base repo URL
                    const skillsMatch = issueUrl.match(/\/skills\/([^\/]+)/);
                    if (skillsMatch) {
                        skillPath = `skills/${skillsMatch[1]}`;
                        this.logger.info(`[openIssueTracker] Extracted skill path: ${skillPath}`);
                    }
                    
                    // Always use base repo URL for issues
                    issueUrl = `${baseRepoUrl}/issues/new`;
                } else if (!issueUrl.includes('/issues')) {
                    // Fallback for non-GitHub URLs
                    issueUrl = `${issueUrl}/issues/new`;
                }
                
                this.logger.info(`[openIssueTracker] Final issue URL: ${issueUrl}`);
                
                // Use correct terminology based on source type
                // awesome-copilot sources ARE collections, others are bundles
                const isAwesomeCopilot = item.sourceType === 'awesome-copilot';
                const itemType = isAwesomeCopilot ? 'Collection' : 'Bundle';
                
                // Build issue body
                const title = `[Feedback] ${item.name || item.resourceId}`;
                
                // Build body parts
                const bodyParts: string[] = [
                    '<!-- This is an example issue template. Feel free to modify the content to fit your needs -->',
                    `${itemType} Information`,
                    `- **${itemType} ID:** ${item.resourceId}`,
                ];
                
                // Add skill path if present
                if (skillPath) {
                    bodyParts.push(`- **Skill Path:** ${skillPath}`);
                }

                if (!isAwesomeCopilot && item.version) {
                    bodyParts.push(`- **Version:** ${item.version}`);
                }
                
                bodyParts.push(
                    '',
                    'Issue Type:',
                    '_Select one: Bug Report / Feature Request / Question / Other_',
                    '',
                    '- [ ] Bug Report',
                    '- [ ] Feature Request',
                    '- [ ] Question',
                    '- [ ] Other',
                    '',
                    'Description:',
                    '_Please describe your issue, suggestion, or question in detail_',
                    '',
                    '',
                    'Steps to Reproduce (for bugs):',
                    '_If reporting a bug, please list the steps to reproduce it_',
                    '',
                    '1. ',
                    '2. ',
                    '3. ',
                    '',
                    'Expected Behavior:',
                    '_What did you expect to happen?_',
                    '',
                    '',
                    'Additional Context:',
                    '_Any other information that might be helpful_',
                    ''
                );
                
                const body = bodyParts.join('\n');
                
                this.logger.info(`[openIssueTracker] Raw body (first 200 chars): ${body.substring(0, 200)}`);

                const base = vscode.Uri.parse(issueUrl, true);

                const params = new URLSearchParams({
                    title,
                    body
                });

                const uri = vscode.Uri.parse(
                    `${issueUrl}?${params.toString()}`, true
                );

                const fullUrl = `${issueUrl}?${params.toString()}`;
                this.logger.debug(`[openIssueTracker] Full URL (first 200 chars): ${fullUrl.substring(0, 200)}`);

                this.logger.debug(`[openIssueTracker] Parsed URI (first 200 chars): ${uri.toString().substring(0, 200)}`);
                
                const opened = await vscode.env.openExternal(uri);
                this.logger.debug(`[openIssueTracker] Browser opened: ${opened}`);
            } else {
                // Fallback: try to open via the existing command
                await vscode.commands.executeCommand('promptregistry.openItemRepository', {
                    type: 'bundle',
                    data: { bundleId: item.resourceId, sourceId: item.resourceId }
                });
                vscode.window.showInformationMessage('Please navigate to the Issues tab to report your feedback.');
            }
        } catch (error) {
            this.logger.warn('Could not open issue tracker', error as Error);
            vscode.window.showWarningMessage('Could not open issue tracker. Please visit the repository manually.');
        }
    }


    /**
     * Save feedback to the engagement service
     */
    private async saveFeedback(
        item: FeedbackableItem,
        comment: string,
        rating?: RatingScore
    ): Promise<FeedbackResult> {
        try {
            if (!this.engagementService) {
                // Store locally without engagement service
                this.logger.info(`Feedback for ${item.resourceId}: ${comment}`);
                vscode.window.showInformationMessage('Thank you for your feedback!');
                return {
                    success: true,
                    feedback: {
                        id: crypto.randomUUID(),
                        resourceType: item.resourceType,
                        resourceId: item.resourceId,
                        comment,
                        rating,
                        version: item.version,
                        timestamp: new Date().toISOString(),
                    },
                };
            }

            this.logger.info(`[FeedbackCommands] Submitting feedback for ${item.resourceId}, hubId: "${item.hubId || 'none'}"`);
            
            const feedback = await this.engagementService.submitFeedback(
                item.resourceType,
                item.resourceId,
                comment,
                { version: item.version, rating, hubId: item.hubId || undefined }
            );

            vscode.window.showInformationMessage('Thank you for your feedback!');
            this.logger.info(`Feedback submitted for ${item.resourceId}`);

            return { success: true, feedback };
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            this.logger.error(`Failed to submit feedback: ${message}`, error as Error);
            vscode.window.showErrorMessage(`Failed to submit feedback: ${message}`);
            return { success: false, error: message };
        }
    }

    /**
     * Parse rating from description string
     */
    private parseRating(description: string): RatingScore {
        const match = description.match(/^(\d)/);
        if (match) {
            const num = parseInt(match[1], 10);
            if (num >= 1 && num <= 5) {
                return num as RatingScore;
            }
        }
        return 3; // Default to average
    }
}

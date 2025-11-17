/**
 * HubSyncCommands - Commands for manual profile synchronization
 * Provides VS Code commands for checking updates and syncing profiles
 */

import { HubManager } from '../services/HubManager';
import { ProfileChanges, ConflictResolutionDialog } from '../types/hub';
import { HubSyncHistory } from './HubSyncHistory';

/**
 * Result of checking for updates
 */
export interface UpdateCheckResult {
    hasUpdates: boolean;
    changes?: ProfileChanges;
    message?: string;
}

/**
 * Result of viewing changes
 */
export interface ViewChangesResult {
    summary: string;
    changes: ProfileChanges;
}

/**
 * Result of review and sync
 */
export interface ReviewSyncResult {
    dialog: ConflictResolutionDialog;
    changes: ProfileChanges;
}

/**
 * Hub update summary
 */
export interface HubUpdateSummary {
    hubId: string;
    profileId: string;
    hasUpdates: boolean;
    changeCount?: number;
}

/**
 * Commands for manual profile synchronization
 */
export class HubSyncCommands {
    private registeredCommands: string[] = [];

    constructor(
        private hubManager: HubManager,
        private syncHistory?: HubSyncHistory
    ) {
        this.registeredCommands = [
            'promptRegistry.hub.checkForUpdates',
            'promptRegistry.hub.viewChanges',
            'promptRegistry.hub.syncProfile',
            'promptRegistry.hub.reviewAndSync',
            'promptRegistry.hub.checkAllForUpdates'
        ];
    }

    /**
     * Check if a profile has updates available
     */
    async checkForUpdates(hubId: string, profileId: string): Promise<UpdateCheckResult> {
        const state = await this.hubManager.getActiveProfile(hubId);
        
        if (!state || state.profileId !== profileId) {
            return {
                hasUpdates: false,
                message: 'Profile is not active'
            };
        }

        const hasChanges = await this.hubManager.hasProfileChanges(hubId, profileId);
        
        if (!hasChanges) {
            return { hasUpdates: false };
        }

        const changes = await this.hubManager.getProfileChanges(hubId, profileId);
        
        return {
            hasUpdates: true,
            changes: changes || undefined
        };
    }

    /**
     * View detailed changes for a profile
     */
    async viewChanges(hubId: string, profileId: string): Promise<ViewChangesResult | null> {
        const changes = await this.hubManager.getProfileChanges(hubId, profileId);
        
        if (!changes) {
            return null;
        }

        const hasAnyChanges = 
            (changes.bundlesAdded !== undefined && changes.bundlesAdded.length > 0) ||
            (changes.bundlesRemoved !== undefined && changes.bundlesRemoved.length > 0) ||
            (changes.bundlesUpdated !== undefined && changes.bundlesUpdated.length > 0) ||
            (changes.metadataChanged !== undefined && Object.keys(changes.metadataChanged).length > 0);

        if (!hasAnyChanges) {
            return null;
        }

        const summary = this.hubManager.formatChangeSummary(changes);
        
        return {
            summary,
            changes
        };
    }

    /**
     * Sync a profile to accept all changes
     */
    async syncProfile(hubId: string, profileId: string): Promise<void> {
        const state = await this.hubManager.getActiveProfile(hubId);
        
        if (!state || state.profileId !== profileId) {
            throw new Error(`Profile ${profileId} in hub ${hubId} is not active`);
        }

        // Get changes and previous state for history
        const changes = await this.hubManager.getProfileChanges(hubId, profileId);
        const previousState = {
            bundles: [], // Simplified - actual bundles tracked in state
            activatedAt: state.activatedAt
        };

        try {
            await this.hubManager.syncProfile(hubId, profileId);
            
            // Record successful sync to history
            if (this.syncHistory && changes) {
                const syncChanges = {
                    added: changes.bundlesAdded || [],
                    updated: (changes.bundlesUpdated || []).map(u => ({
                        id: u.id,
                        oldVersion: u.oldVersion,
                        newVersion: u.newVersion
                    })),
                    removed: changes.bundlesRemoved || [],
                    metadataChanged: !!(changes.metadataChanged)
                };
                
                await this.syncHistory.recordSync(
                    hubId,
                    profileId,
                    syncChanges,
                    previousState,
                    'success'
                );
            }
        } catch (error) {
            // Record failed sync to history
            if (this.syncHistory) {
                await this.syncHistory.recordSync(
                    hubId,
                    profileId,
                    { added: [], updated: [], removed: [], metadataChanged: false },
                    previousState,
                    'failure',
                    error instanceof Error ? error.message : String(error)
                );
            }
            throw error;
        }
    }

    /**
     * Review changes and provide sync dialog
     */
    async reviewAndSync(hubId: string, profileId: string): Promise<ReviewSyncResult | null> {
        const changes = await this.hubManager.getProfileChanges(hubId, profileId);
        
        if (!changes) {
            return null;
        }

        const hasAnyChanges = 
            (changes.bundlesAdded !== undefined && changes.bundlesAdded.length > 0) ||
            (changes.bundlesRemoved !== undefined && changes.bundlesRemoved.length > 0) ||
            (changes.bundlesUpdated !== undefined && changes.bundlesUpdated.length > 0) ||
            (changes.metadataChanged !== undefined && Object.keys(changes.metadataChanged).length > 0);

        if (!hasAnyChanges) {
            return null;
        }

        const dialog = this.hubManager.createConflictResolutionDialog(changes);
        
        return {
            dialog,
            changes
        };
    }

    /**
     * Check all hubs for updates
     */
    async checkAllHubsForUpdates(): Promise<HubUpdateSummary[]> {
        const activeProfiles = await this.hubManager.listAllActiveProfiles();
        const results: HubUpdateSummary[] = [];

        for (const profile of activeProfiles) {
            const hasUpdates = await this.hubManager.hasProfileChanges(profile.hubId, profile.profileId);
            
            let changeCount: number | undefined;
            if (hasUpdates) {
                const changes = await this.hubManager.getProfileChanges(profile.hubId, profile.profileId);
                if (changes) {
                    changeCount = 
                        (changes.bundlesAdded?.length || 0) +
                        (changes.bundlesRemoved?.length || 0) +
                        (changes.bundlesUpdated?.length || 0) +
                        (changes.metadataChanged ? 1 : 0);
                }
            }

            results.push({
                hubId: profile.hubId,
                profileId: profile.profileId,
                hasUpdates,
                changeCount
            });
        }

        return results;
    }

    /**
     * Get list of registered command IDs
     */
    getRegisteredCommands(): string[] {
        return [...this.registeredCommands];
    }
}

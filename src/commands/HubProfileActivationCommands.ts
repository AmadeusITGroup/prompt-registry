/**
 * Commands for activating and deactivating hub profiles
 */

import * as vscode from 'vscode';
import { HubManager } from '../services/HubManager';

/**
 * Command to activate a hub profile
 */
export async function activateHubProfile(hubManager: HubManager, item?: any): Promise<void> {
    try {
        // Extract hub/profile from tree item if provided
        let preSelectedHubId: string | undefined;
        let preSelectedProfileId: string | undefined;
        
        if (item && typeof item === 'object' && item.data) {
            // Tree item passed - could be hub or profile
            if (item.data.id && item.data.profiles) {
                // Hub item
                preSelectedHubId = item.data.id;
            } else if (item.data.profileId && item.data.hubId) {
                // Profile item
                preSelectedHubId = item.data.hubId;
                preSelectedProfileId = item.data.profileId;
            }
        }
        
        // Get all hubs
        const hubs = await hubManager.listHubs();
        
        if (hubs.length === 0) {
            vscode.window.showWarningMessage('No hubs available. Please add a hub first.');
            return;
        }

        // Show hub picker (skip if hub pre-selected from tree)
        let selectedHub: { label: string; hubId: string } | undefined;
        
        if (preSelectedHubId) {
            const hub = hubs.find(h => h.id === preSelectedHubId);
            if (hub) {
                selectedHub = { label: hub.name, hubId: hub.id };
            }
        }
        
        if (!selectedHub) {
            const hubItems = hubs.map(hub => ({
                label: hub.name,
                description: hub.description,
                hubId: hub.id
            }));

            selectedHub = await vscode.window.showQuickPick(hubItems, {
                placeHolder: 'Select a hub',
                title: 'Activate Hub Profile'
            });

            if (!selectedHub) {
                return; // User cancelled
            }
        }
        
        // Ensure we have a selected hub at this point
        if (!selectedHub) {
            return;
        }

        // Get profiles for selected hub
        const profiles = await hubManager.listProfilesFromHub(selectedHub.hubId);
        const activeProfile = await hubManager.getActiveProfile(selectedHub.hubId);

        if (profiles.length === 0) {
            vscode.window.showWarningMessage(`No profiles found in ${selectedHub.label}`);
            return;
        }

        // Show profile picker (skip if profile pre-selected from tree)
        let selectedProfile: { profileId: string; hubId: string } | undefined;
        
        if (preSelectedProfileId) {
            const profile = profiles.find(p => p.id === preSelectedProfileId);
            if (profile) {
                selectedProfile = { profileId: profile.id, hubId: selectedHub.hubId };
            }
        }
        
        if (!selectedProfile) {
            // Capture hubId for closure
            const hubId = selectedHub.hubId;
            const hubLabel = selectedHub.label;
            
            const profileItems = profiles.map(profile => {
                const isActive = activeProfile?.profileId === profile.id;
                const bundleCount = profile.bundles.length;
                const requiredCount = profile.bundles.filter(b => b.required).length;
                
                return {
                    label: `${profile.icon || '📦'} ${profile.name}${isActive ? ' ✓' : ''}`,
                    description: isActive ? 'Active' : undefined,
                    detail: `${profile.description} • ${bundleCount} bundle${bundleCount !== 1 ? 's' : ''} (${requiredCount} required)`,
                    profileId: profile.id,
                    hubId: hubId
                };
            });

            selectedProfile = await vscode.window.showQuickPick(profileItems, {
                placeHolder: 'Select a profile to activate',
                title: `Activate Profile from ${hubLabel}`
            });

            if (!selectedProfile) {
                return; // User cancelled
            }
        }
        
        // Ensure we have a selected profile at this point
        if (!selectedProfile) {
            return;
        }

        // Activate the profile
        const result = await hubManager.activateProfile(
            selectedProfile.hubId,
            selectedProfile.profileId,
            { installBundles: true }
        );

        if (result.success) {
            const profile = profiles.find(p => p.id === selectedProfile!.profileId);
            vscode.window.showInformationMessage(
                `Activated profile "${profile?.name}" from ${selectedHub!.label}`
            );
        } else {
            vscode.window.showErrorMessage(
                `Failed to activate profile: ${result.error}`
            );
        }
    } catch (error) {
        vscode.window.showErrorMessage(
            `Error activating profile: ${error instanceof Error ? error.message : String(error)}`
        );
    }
}

/**
 * Command to deactivate a hub profile
 */
export async function deactivateHubProfile(hubManager: HubManager, item?: any): Promise<void> {
    try {
        // Extract hub/profile from tree item if provided
        let preSelectedHubId: string | undefined;
        let preSelectedProfileId: string | undefined;
        
        if (item && typeof item === 'object' && item.data) {
            if (item.data.profileId && item.data.hubId) {
                // Profile item
                preSelectedHubId = item.data.hubId;
                preSelectedProfileId = item.data.profileId;
            }
        }
        
        // Get all active profiles
        const activeProfiles = await hubManager.listAllActiveProfiles();

        if (activeProfiles.length === 0) {
            vscode.window.showWarningMessage('No active profiles to deactivate.');
            return;
        }

        // Build profile items with hub names
        const profileItems = await Promise.all(
            activeProfiles.map(async (state) => {
                const hub = await hubManager.getHub(state.hubId);
                const profile = await hubManager.getHubProfile(state.hubId, state.profileId);

                return {
                    label: `${profile.icon || '📦'} ${profile.name}`,
                    description: hub?.config.metadata.name || state.hubId,
                    detail: `Activated ${new Date(state.activatedAt).toLocaleString()} • ${state.syncedBundles.length} bundle${state.syncedBundles.length !== 1 ? 's' : ''}`,
                    hubId: state.hubId,
                    profileId: state.profileId
                };
            })
        );

        const selectedProfile = await vscode.window.showQuickPick(profileItems, {
            placeHolder: 'Select a profile to deactivate',
            title: 'Deactivate Hub Profile'
        });

        if (!selectedProfile) {
            return; // User cancelled
        }

        // Deactivate the profile
        const result = await hubManager.deactivateProfile(
            selectedProfile.hubId,
            selectedProfile.profileId
        );

        if (result.success) {
            vscode.window.showInformationMessage(
                `Deactivated profile "${selectedProfile.label.replace(/^[^\s]+\s/, '')}" from ${selectedProfile.description}`
            );
        } else {
            vscode.window.showErrorMessage(
                `Failed to deactivate profile: ${result.error}`
            );
        }
    } catch (error) {
        vscode.window.showErrorMessage(
            `Error deactivating profile: ${error instanceof Error ? error.message : String(error)}`
        );
    }
}

/**
 * Command to show all active profiles
 */
export async function showActiveProfiles(hubManager: HubManager): Promise<void> {
    try {
        // Get all active profiles
        const activeProfiles = await hubManager.listAllActiveProfiles();

        if (activeProfiles.length === 0) {
            vscode.window.showInformationMessage('No active profiles.');
            return;
        }

        // Build profile items
        const profileItems = await Promise.all(
            activeProfiles.map(async (state) => {
                const hub = await hubManager.getHub(state.hubId);
                const profile = await hubManager.getHubProfile(state.hubId, state.profileId);

                return {
                    label: `${profile.icon || '📦'} ${profile.name}`,
                    description: hub?.config.metadata.name || state.hubId,
                    detail: `Activated ${new Date(state.activatedAt).toLocaleString()} • ${state.syncedBundles.length} bundle${state.syncedBundles.length !== 1 ? 's' : ''}`,
                    action: 'deactivate' as const,
                    hubId: state.hubId,
                    profileId: state.profileId
                };
            })
        );

        const selected = await vscode.window.showQuickPick(profileItems, {
            placeHolder: 'Active profiles (select to deactivate)',
            title: 'Active Hub Profiles'
        });

        if (!selected) {
            return; // User cancelled
        }

        // If user selected a profile, deactivate it
        if (selected.action === 'deactivate') {
            const result = await hubManager.deactivateProfile(
                selected.hubId,
                selected.profileId
            );

            if (result.success) {
                vscode.window.showInformationMessage(
                    `Deactivated profile "${selected.label.replace(/^[^\s]+\s/, '')}" from ${selected.description}`
                );
            } else {
                vscode.window.showErrorMessage(
                    `Failed to deactivate profile: ${result.error}`
                );
            }
        }
    } catch (error) {
        vscode.window.showErrorMessage(
            `Error showing active profiles: ${error instanceof Error ? error.message : String(error)}`
        );
    }
}

import { HubManager } from '../services/HubManager';
import { HubProfileBundle } from '../types/hub';

/**
 * Comparison data structure for profile differences
 */
export interface ProfileComparisonData {
    hubId: string;
    profileId: string;
    currentBundles: HubProfileBundle[];
    availableBundles: HubProfileBundle[];
    addedBundles: HubProfileBundle[];
    updatedBundles: BundleUpdate[];
    removedBundles: string[];
    metadataChanged: boolean;
    currentMetadata?: ProfileMetadata;
    availableMetadata?: ProfileMetadata;
}

/**
 * Bundle update information
 */
export interface BundleUpdate {
    id: string;
    oldVersion: string;
    newVersion: string;
}

/**
 * Profile metadata for comparison
 */
export interface ProfileMetadata {
    name: string;
    description?: string;
}

/**
 * QuickPick item for bundle comparison
 */
export interface ComparisonQuickPickItem {
    label: string;
    description?: string;
    detail?: string;
    bundleId: string;
    status: 'added' | 'updated' | 'removed' | 'unchanged';
}

/**
 * Provides UI components for comparing profile versions
 */
export class HubProfileComparisonView {
    constructor(private hubManager: HubManager) {}

    /**
     * Get comparison data for a profile
     */
    async getProfileComparisonData(
        hubId: string,
        profileId: string
    ): Promise<ProfileComparisonData | null> {
        // Check if profile is active
        const activeState = await this.hubManager.getActiveProfile(hubId);
        if (!activeState || activeState.profileId !== profileId) {
            return null;
        }

        // Check if there are any changes
        const hasChanges = await this.hubManager.hasProfileChanges(hubId, profileId);
        if (!hasChanges) {
            return null;
        }

        // Get detailed changes
        const changes = await this.hubManager.getProfileChanges(hubId, profileId);
        if (!changes) {
            return null;
        }

        // Get hub and profile data
        const hub = await this.hubManager['storage'].loadHub(hubId);
        const availableProfile = hub.config.profiles.find(p => p.id === profileId);
        if (!availableProfile) {
            return null;
        }

        // Parse changes
        const addedBundles = changes.bundlesAdded || [];
        const removedBundleIds = changes.bundlesRemoved || [];
        const updatedBundles: BundleUpdate[] = (changes.bundlesUpdated || []).map(update => ({
            id: update.id,
            oldVersion: update.oldVersion,
            newVersion: update.newVersion
        }));

        const availableBundles = availableProfile.bundles || [];
        
        // Calculate current bundles by removing additions and using old versions for updates
        const currentBundles: HubProfileBundle[] = [];
        availableBundles.forEach(bundle => {
            const isAdded = addedBundles.some(b => b.id === bundle.id);
            if (!isAdded) {
                const update = updatedBundles.find(u => u.id === bundle.id);
                if (update) {
                    // Use old version
                    currentBundles.push({
                        ...bundle,
                        version: update.oldVersion
                    });
                } else {
                    currentBundles.push(bundle);
                }
            }
        });
        
        // Add removed bundles to current
        removedBundleIds.forEach(bundleId => {
            if (!currentBundles.some(b => b.id === bundleId)) {
                // We don't have full info, but we know it was removed
                currentBundles.push({
                    id: bundleId,
                    version: 'unknown',
                    source: 'unknown',
                    required: false
                });
            }
        });

        // Get metadata
        const currentMetadata: ProfileMetadata = {
            name: availableProfile.name,
            description: availableProfile.description
        };

        const availableMetadata: ProfileMetadata = {
            name: availableProfile.name,
            description: availableProfile.description
        };

        // Check if metadata changed
        const metadataChanged = !!(changes.metadataChanged && (
            changes.metadataChanged.name ||
            changes.metadataChanged.description ||
            changes.metadataChanged.icon
        ));

        return {
            hubId,
            profileId,
            currentBundles,
            availableBundles,
            addedBundles,
            updatedBundles,
            removedBundles: removedBundleIds,
            metadataChanged,
            currentMetadata,
            availableMetadata
        };
    }

    /**
     * Format a bundle for comparison display
     */
    formatBundleComparison(
        bundle: HubProfileBundle | string,
        status: 'added' | 'updated' | 'removed' | 'unchanged',
        oldVersion?: string
    ): string {
        const bundleId = typeof bundle === 'string' ? bundle : bundle.id;
        const bundleVersion = typeof bundle === 'string' ? 'unknown' : bundle.version;
        const base = `${bundleId} (${bundleVersion})`;

        switch (status) {
            case 'added':
                return `${base} — Added [NEW]`;
            case 'updated':
                if (oldVersion) {
                    return `${bundleId} — Updated (${oldVersion} → ${bundleVersion})`;
                }
                return `${base} — Updated`;
            case 'removed':
                return `${base} — Removed [DELETED]`;
            case 'unchanged':
                return base;
            default:
                return base;
        }
    }

    /**
     * Generate a text summary of the comparison
     */
    generateComparisonSummary(comparison: ProfileComparisonData): string {
        const lines: string[] = [];

        lines.push(`Profile Comparison: ${comparison.profileId}`);
        lines.push('');

        // Metadata changes
        if (comparison.metadataChanged && comparison.availableMetadata) {
            lines.push('Metadata Changes:');
            lines.push(`  Name: ${comparison.availableMetadata.name}`);
            if (comparison.availableMetadata.description) {
                lines.push(`  Description: ${comparison.availableMetadata.description}`);
            }
            lines.push('');
        }

        // Bundle changes
        if (comparison.addedBundles.length > 0) {
            lines.push('Added Bundles:');
            comparison.addedBundles.forEach(bundle => {
                lines.push(`  + ${this.formatBundleComparison(bundle, 'added')}`);
            });
            lines.push('');
        }

        if (comparison.updatedBundles.length > 0) {
            lines.push('Updated Bundles:');
            comparison.updatedBundles.forEach(update => {
                const bundle: HubProfileBundle = {
                    id: update.id,
                    version: update.newVersion,
                    source: 'registry',
                    required: false
                };
                lines.push(`  ~ ${this.formatBundleComparison(bundle, 'updated', update.oldVersion)}`);
            });
            lines.push('');
        }

        if (comparison.removedBundles.length > 0) {
            lines.push('Removed Bundles:');
            comparison.removedBundles.forEach(bundleId => {
                lines.push(`  - ${this.formatBundleComparison(bundleId, 'removed')}`);
            });
            lines.push('');
        }

        return lines.join('\n');
    }

    /**
     * Create QuickPick items for bundle comparison
     */
    createComparisonQuickPickItems(
        comparison: ProfileComparisonData
    ): ComparisonQuickPickItem[] {
        const items: ComparisonQuickPickItem[] = [];

        // Added bundles
        comparison.addedBundles.forEach(bundle => {
            items.push({
                label: `+ ${bundle.id}`,
                description: `Added — ${bundle.version}`,
                detail: bundle.source ? `Source: ${bundle.source}` : undefined,
                bundleId: bundle.id,
                status: 'added'
            });
        });

        // Updated bundles
        comparison.updatedBundles.forEach(update => {
            items.push({
                label: `~ ${update.id}`,
                description: `${update.oldVersion} → ${update.newVersion}`,
                detail: undefined,
                bundleId: update.id,
                status: 'updated'
            });
        });

        // Removed bundles
        comparison.removedBundles.forEach(bundleId => {
            items.push({
                label: `- ${bundleId}`,
                description: `Removed`,
                detail: undefined,
                bundleId: bundleId,
                status: 'removed'
            });
        });

        // Unchanged bundles (in both lists with same version)
        const unchangedBundles = comparison.currentBundles.filter(current => {
            const inAvailable = comparison.availableBundles.find(
                a => a.id === current.id && a.version === current.version
            );
            const isUpdated = comparison.updatedBundles.some(u => u.id === current.id);
            const isRemoved = comparison.removedBundles.some(r => r === current.id);
            return inAvailable && !isUpdated && !isRemoved;
        });

        unchangedBundles.forEach(bundle => {
            items.push({
                label: `  ${bundle.id}`,
                description: bundle.version,
                detail: bundle.source ? `Source: ${bundle.source}` : undefined,
                bundleId: bundle.id,
                status: 'unchanged'
            });
        });

        return items;
    }

    /**
     * Generate side-by-side comparison text
     */
    getSideBySideComparison(comparison: ProfileComparisonData): string {
        const lines: string[] = [];
        const width = 40;

        // Header
        lines.push('═'.repeat(width * 2 + 5));
        lines.push(
            this.padRight('Current (Activated)', width) +
            ' │ ' +
            this.padRight('Available (Hub)', width)
        );
        lines.push('═'.repeat(width * 2 + 5));

        // Collect all bundle IDs
        const allBundleIds = new Set<string>();
        comparison.currentBundles.forEach(b => allBundleIds.add(b.id));
        comparison.availableBundles.forEach(b => allBundleIds.add(b.id));

        // Display each bundle
        Array.from(allBundleIds).sort().forEach(bundleId => {
            const current = comparison.currentBundles.find(b => b.id === bundleId);
            const available = comparison.availableBundles.find(b => b.id === bundleId);

            const currentText = current 
                ? `${current.id} (${current.version})`
                : '—';
            
            const availableText = available
                ? `${available.id} (${available.version})`
                : '—';

            let statusMarker = ' ';
            if (!current && available) {
                statusMarker = '+'; // Added
            } else if (current && !available) {
                statusMarker = '-'; // Removed
            } else if (current && available && current.version !== available.version) {
                statusMarker = '~'; // Updated
            }

            lines.push(
                this.padRight(currentText, width) +
                ' │ ' +
                this.padRight(availableText, width) +
                ` ${statusMarker}`
            );
        });

        lines.push('─'.repeat(width * 2 + 5));

        // Summary
        const changeCount = 
            comparison.addedBundles.length +
            comparison.updatedBundles.length +
            comparison.removedBundles.length;

        lines.push(`Total changes: ${changeCount}`);
        if (comparison.metadataChanged) {
            lines.push('Metadata: Changed');
        }

        return lines.join('\n');
    }

    /**
     * Pad string to the right
     */
    private padRight(str: string, length: number): string {
        if (str.length >= length) {
            return str.substring(0, length - 3) + '...';
        }
        return str + ' '.repeat(length - str.length);
    }
}

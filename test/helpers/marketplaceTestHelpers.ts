/**
 * Shared test helpers for MarketplaceViewProvider tests
 */

import { VersionManager } from '../../src/utils/versionManager';

/**
 * Determine button state based on version comparison
 * This mirrors the logic in MarketplaceViewProvider
 * 
 * @param installedVersion - Currently installed version (undefined if not installed)
 * @param latestVersion - Latest available version
 * @returns Button state: 'install', 'update', or 'uninstall'
 */
export function determineButtonState(
    installedVersion: string | undefined,
    latestVersion: string
): 'install' | 'update' | 'uninstall' {
    if (!installedVersion) {
        return 'install';
    }
    
    try {
        if (VersionManager.isUpdateAvailable(installedVersion, latestVersion)) {
            return 'update';
        }
    } catch (error) {
        // If version comparison fails, fall back to string comparison
        if (installedVersion !== latestVersion) {
            return 'update';
        }
    }
    
    return 'uninstall';
}

/**
 * Check if bundle identities match
 * For GitHub bundles, compares without version suffix
 * For others, exact match
 * 
 * @param installedId - Bundle ID from installed bundle
 * @param bundleId - Bundle ID from marketplace
 * @param sourceType - Source type of the bundle
 * @returns True if the bundles match
 */
export function matchesBundleIdentity(
    installedId: string,
    bundleId: string,
    sourceType: string
): boolean {
    if (sourceType === 'github') {
        const installedIdentity = VersionManager.extractBundleIdentity(installedId, 'github');
        const bundleIdentity = VersionManager.extractBundleIdentity(bundleId, 'github');
        return installedIdentity === bundleIdentity;
    }
    
    // For non-GitHub sources, exact match
    return installedId === bundleId;
}

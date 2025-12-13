/**
 * Bundle Name Utilities
 * Shared utilities for resolving bundle display names
 */

import { Logger } from './logger';

/**
 * Interface for bundle details resolution
 */
export interface BundleDetailsResolver {
    getBundleDetails(bundleId: string): Promise<{ name: string }>;
}

/**
 * Get a bundle's display name, falling back to bundleId if details are unavailable.
 * 
 * This is a shared utility to avoid duplicate implementations across:
 * - BundleUpdateCommands
 * - BaseNotificationService
 * - Other notification handlers
 * 
 * @param bundleId - The bundle identifier
 * @param resolver - Optional resolver function or object with getBundleDetails method
 * @returns The bundle's display name or the bundleId as fallback
 */
export async function getBundleDisplayName(
    bundleId: string,
    resolver?: ((bundleId: string) => Promise<string>) | BundleDetailsResolver
): Promise<string> {
    if (!resolver) {
        return bundleId;
    }

    try {
        if (typeof resolver === 'function') {
            return await resolver(bundleId);
        } else {
            const details = await resolver.getBundleDetails(bundleId);
            return details.name;
        }
    } catch {
        // Silently fall back to bundleId - this is expected when bundle details aren't available
        Logger.getInstance().debug(`Could not resolve bundle name for '${bundleId}', using ID`);
        return bundleId;
    }
}

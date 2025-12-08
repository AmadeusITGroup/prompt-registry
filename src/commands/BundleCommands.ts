/**
 * Bundle Management Commands
 * Orchestrates bundle operations through specialized command handlers
 */

import { RegistryManager } from '../services/RegistryManager';
import { BundleInstallationCommands } from './BundleInstallationCommands';
import { BundleUpdateCommands } from './BundleUpdateCommands';
import { BundleBrowsingCommands } from './BundleBrowsingCommands';
import { BundleUpdateNotifications } from '../notifications/BundleUpdateNotifications';

/**
 * Bundle Commands Handler
 * Uses composition to delegate to specialized command handlers
 */
export class BundleCommands {
    private installationCommands: BundleInstallationCommands;
    private updateCommands: BundleUpdateCommands;
    private browsingCommands: BundleBrowsingCommands;

    constructor(registryManager: RegistryManager) {
        this.installationCommands = new BundleInstallationCommands(registryManager);
        
        const bundleNameResolver = async (bundleId: string) => await registryManager.getBundleName(bundleId);
        const bundleNotifications = new BundleUpdateNotifications(bundleNameResolver);
        this.updateCommands = new BundleUpdateCommands(registryManager, bundleNotifications);
        
        this.browsingCommands = new BundleBrowsingCommands(registryManager);
    }

    // ===== Installation Commands =====

    /**
     * Search and install a bundle
     */
    async searchAndInstall(): Promise<void> {
        return await this.installationCommands.searchAndInstall();
    }

    /**
     * Install a specific bundle
     */
    async installBundle(bundleId?: string): Promise<void> {
        return await this.installationCommands.installBundle(bundleId);
    }

    /**
     * Uninstall a bundle
     */
    async uninstallBundle(bundleId?: string): Promise<void> {
        return await this.installationCommands.uninstallBundle(bundleId);
    }

    // ===== Update Commands =====

    /**
     * Update a bundle
     */
    async updateBundle(bundleId?: string): Promise<void> {
        if (!bundleId) {
            return await this.updateCommands.checkAllUpdates();
        }
        return await this.updateCommands.updateBundle(bundleId);
    }

    /**
     * Check for updates on a single bundle and show update dialog
     */
    async checkSingleBundleUpdate(bundleId: string): Promise<void> {
        return await this.updateCommands.checkSingleBundleUpdate(bundleId);
    }

    /**
     * Check for updates on all installed bundles
     */
    async checkAllUpdates(): Promise<void> {
        return await this.updateCommands.checkAllUpdates();
    }

    /**
     * Update all bundles with available updates
     */
    async updateAllBundles(): Promise<void> {
        return await this.updateCommands.updateAllBundles();
    }

    /**
     * Enable auto-update for a bundle
     */
    async enableAutoUpdate(bundleId?: string): Promise<void> {
        return await this.updateCommands.enableAutoUpdate(bundleId);
    }

    /**
     * Disable auto-update for a bundle
     */
    async disableAutoUpdate(bundleId?: string): Promise<void> {
        return await this.updateCommands.disableAutoUpdate(bundleId);
    }

    // ===== Browsing Commands =====

    /**
     * View bundle details
     */
    async viewBundle(bundleId?: string): Promise<void> {
        return await this.browsingCommands.viewBundle(bundleId);
    }

    /**
     * Browse bundles by category
     */
    async browseByCategory(): Promise<void> {
        return await this.browsingCommands.browseByCategory();
    }

    /**
     * Show popular bundles
     */
    async showPopular(): Promise<void> {
        return await this.browsingCommands.showPopular();
    }

    /**
     * List installed bundles
     */
    async listInstalled(): Promise<void> {
        return await this.browsingCommands.listInstalled();
    }
}
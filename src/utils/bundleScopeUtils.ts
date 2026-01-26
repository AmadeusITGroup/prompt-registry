/**
 * Bundle Scope Utilities
 * 
 * Shared utilities for working with bundle scopes across different services.
 * Handles the complexity of repository scope bundles being tracked via LockfileManager
 * while user/workspace scopes use RegistryStorage.
 */

import * as path from 'path';
import { RegistryStorage } from '../storage/RegistryStorage';
import { LockfileManager } from '../services/LockfileManager';
import { InstallationScope, InstalledBundle, RepositoryCommitMode, DeploymentManifest } from '../types/registry';
import { LockfileBundleEntry } from '../types/lockfile';
import { Logger } from './logger';
import { getWorkspaceRoot } from './scopeSelectionUI';

/**
 * Get installed bundle from the appropriate source based on scope.
 * 
 * Repository scope bundles are tracked via LockfileManager, not RegistryStorage.
 * Falls back to RegistryStorage if no workspace is available or lockfile doesn't have the bundle.
 * 
 * @param storage - The RegistryStorage instance
 * @param bundleId - The bundle ID to look up
 * @param scope - The scope to check
 * @returns InstalledBundle if found, undefined otherwise
 */
export async function getInstalledBundleForScope(
    storage: RegistryStorage,
    bundleId: string,
    scope: InstallationScope
): Promise<InstalledBundle | undefined> {
    const logger = Logger.getInstance();
    
    if (scope === 'repository') {
        const workspaceRoot = getWorkspaceRoot();
        if (!workspaceRoot) {
            // Fall back to storage if no workspace is available (for testing)
            return storage.getInstalledBundle(bundleId, scope);
        }
        
        try {
            const lockfileManager = LockfileManager.getInstance(workspaceRoot);
            // Use getInstalledBundles() to search both main and local lockfiles
            const installedBundles = await lockfileManager.getInstalledBundles();
            const bundle = installedBundles.find(b => b.bundleId === bundleId);
            
            if (bundle) {
                return bundle;
            }
            
            // Fall back to storage if lockfile doesn't have the bundle (for testing/backward compatibility)
            return storage.getInstalledBundle(bundleId, scope);
        } catch (error) {
            logger.warn(`[bundleScopeUtils] Failed to read lockfile for bundle ${bundleId}:`, error instanceof Error ? error : undefined);
            // Fall back to storage on error
            return storage.getInstalledBundle(bundleId, scope);
        }
    }
    
    // User and workspace scopes use RegistryStorage
    return storage.getInstalledBundle(bundleId, scope);
}

/**
 * Options for creating an InstalledBundle from a lockfile entry
 */
export interface CreateInstalledBundleOptions {
    /** Install path (defaults to empty string if not provided) */
    installPath?: string;
    /** Deployment manifest (defaults to minimal manifest if not provided) */
    manifest?: DeploymentManifest;
    /** Whether files are missing from the filesystem */
    filesMissing?: boolean;
    /** Override the commit mode from the lockfile entry (used when commit mode is implicit based on file location) */
    commitModeOverride?: RepositoryCommitMode;
}

/**
 * Create an InstalledBundle object from a lockfile bundle entry.
 * 
 * This is the single source of truth for converting lockfile entries to InstalledBundle format.
 * Used by both LockfileManager and bundleScopeUtils for consistent conversion.
 * 
 * @param bundleId - The bundle ID
 * @param bundleEntry - The lockfile bundle entry
 * @param options - Optional configuration for the conversion
 * @returns InstalledBundle object
 */
export function createInstalledBundleFromLockfile(
    bundleId: string,
    bundleEntry: LockfileBundleEntry,
    options?: CreateInstalledBundleOptions
): InstalledBundle {
    const manifest = options?.manifest ?? createMinimalManifest(bundleId, bundleEntry.files);
    
    // Use commitModeOverride if provided, otherwise fall back to entry's commitMode
    // This supports the dual-lockfile pattern where commit mode is implicit based on file location
    const commitMode = options?.commitModeOverride ?? bundleEntry.commitMode as RepositoryCommitMode;
    
    return {
        bundleId,
        version: bundleEntry.version,
        installedAt: bundleEntry.installedAt,
        scope: 'repository',
        installPath: options?.installPath ?? '',
        manifest,
        sourceId: bundleEntry.sourceId,
        sourceType: bundleEntry.sourceType,
        commitMode,
        filesMissing: options?.filesMissing
    };
}

/**
 * Create a minimal deployment manifest for repository-scoped bundles.
 * 
 * The actual manifest content is not stored in the lockfile, so we create
 * a minimal manifest with the file paths from the lockfile entry.
 * 
 * @param bundleId - The bundle ID
 * @param files - Array of file entries from the lockfile
 * @returns Minimal DeploymentManifest object
 */
function createMinimalManifest(
    bundleId: string,
    files: Array<{ path: string; checksum: string }> = []
): DeploymentManifest {
    return {
        common: {
            directories: [],
            files: files.map(f => f.path),
            include_patterns: [],
            exclude_patterns: []
        },
        bundle_settings: {
            include_common_in_environment_bundles: false,
            create_common_bundle: false,
            compression: 'none',
            naming: {
                environment_bundle: bundleId
            }
        },
        metadata: {
            manifest_version: '1.0.0',
            description: `Repository bundle: ${bundleId}`
        }
    };
}

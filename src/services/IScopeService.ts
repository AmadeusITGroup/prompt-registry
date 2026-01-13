/**
 * IScopeService Interface
 * 
 * Defines the contract for scope-specific bundle installation services.
 * Both UserScopeService and RepositoryScopeService implement this interface
 * to provide consistent bundle syncing behavior across different installation scopes.
 * 
 * Requirements: 1.2, 9.1-9.5
 */

import { CopilotFileType } from '../utils/copilotFileTypeUtils';

/**
 * Status information for a scope service.
 * 
 * Provides diagnostic information about the current state of a scope service,
 * including the target directory and synced files.
 */
export interface ScopeStatus {
    /** 
     * Base directory where files are synced.
     * For UserScopeService: the Copilot prompts directory (e.g., ~/.vscode/User/prompts)
     * For RepositoryScopeService: the repository .github directory
     */
    baseDirectory: string;
    
    /** Whether the base directory exists on the filesystem */
    dirExists: boolean;
    
    /** Count of files currently synced by this service */
    syncedFiles: number;
    
    /** List of synced file names (relative to baseDirectory) */
    files: string[];
}

/**
 * Options for syncing a bundle to a scope.
 */
export interface SyncBundleOptions {
    /**
     * Commit mode for repository scope installations.
     * - 'commit': Files are tracked by Git (default)
     * - 'local-only': Files are excluded via .git/info/exclude
     * 
     * Only applicable for RepositoryScopeService.
     */
    commitMode?: 'commit' | 'local-only';
}

/**
 * Interface for scope-specific bundle installation services.
 * 
 * Implementations handle the details of where and how bundle files
 * are placed based on the installation scope (user vs repository).
 */
export interface IScopeService {
    /**
     * Sync a bundle's files to the appropriate Copilot directories.
     * 
     * @param bundleId - The unique identifier of the bundle
     * @param bundlePath - The path to the installed bundle directory
     * @param options - Optional sync options (e.g., commitMode for repository scope)
     * @returns Promise that resolves when sync is complete
     */
    syncBundle(bundleId: string, bundlePath: string, options?: SyncBundleOptions): Promise<void>;

    /**
     * Remove synced files for a bundle.
     * 
     * @param bundleId - The unique identifier of the bundle to unsync
     * @returns Promise that resolves when unsync is complete
     */
    unsyncBundle(bundleId: string): Promise<void>;

    /**
     * Get the target path for a file of a given type.
     * 
     * @param fileType - The Copilot file type
     * @param fileName - The name of the file
     * @returns The full target path where the file should be placed
     */
    getTargetPath(fileType: CopilotFileType, fileName: string): string;

    /**
     * Get the current status of the scope service.
     * 
     * @returns Promise resolving to the scope status information
     */
    getStatus(): Promise<ScopeStatus>;
}

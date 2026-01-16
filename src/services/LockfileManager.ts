/**
 * LockfileManager Service
 * 
 * Manages the prompt-registry.lock.json file for repository-level bundle installations.
 * Provides atomic write operations, schema validation, and modification detection.
 * 
 * Requirements covered:
 * - 4.1-4.10: Lockfile creation and management
 * - 5.1-5.7: Lockfile detection and auto-sync
 * - 12.1-12.6: Source and hub tracking
 * - 14.1-14.3: Checksum modification detection
 * - 15.1-15.6: Enhanced lockfile structure and atomic writes
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import {
    Lockfile,
    LockfileBundleEntry,
    LockfileFileEntry,
    LockfileSourceEntry,
    LockfileHubEntry,
    LockfileProfileEntry,
    LockfileValidationResult,
    ModifiedFileInfo
} from '../types/lockfile';
import { RepositoryCommitMode, InstalledBundle } from '../types/registry';
import { SchemaValidator } from './SchemaValidator';
import { Logger } from '../utils/logger';
import { calculateFileChecksum } from '../utils/fileIntegrityService';
import { createInstalledBundleFromLockfile } from '../utils/bundleScopeUtils';

const LOCKFILE_NAME = 'prompt-registry.lock.json';
const LOCKFILE_SCHEMA_VERSION = '1.0.0';
const LOCKFILE_SCHEMA_URL = 'https://github.com/AmadeusITGroup/prompt-registry/schemas/lockfile.schema.json';
const EXTENSION_ID = 'AmadeusITGroup.prompt-registry';

/**
 * Options for creating or updating a bundle in the lockfile
 */
export interface CreateOrUpdateOptions {
    bundleId: string;
    version: string;
    sourceId: string;
    sourceType: string;
    commitMode: RepositoryCommitMode;
    files: LockfileFileEntry[];
    source: LockfileSourceEntry;
    hub?: { id: string; entry: LockfileHubEntry };
    profile?: { id: string; entry: LockfileProfileEntry };
    checksum?: string;
}

/**
 * LockfileManager service
 * 
 * Manages the prompt-registry.lock.json file at the repository root.
 * Uses a workspace-aware instance pattern to support multi-root workspaces.
 * 
 * Note: This class uses a per-workspace instance pattern instead of a global singleton
 * to properly handle workspace switches and multi-root workspaces.
 */
export class LockfileManager {
    private static instances: Map<string, LockfileManager> = new Map();
    private repositoryPath: string;
    private lockfilePath: string;
    private logger: Logger;
    private schemaValidator: SchemaValidator;
    private fileWatcher: vscode.FileSystemWatcher | null = null;
    private writeLock: Promise<void> = Promise.resolve();

    // Event emitter for lockfile updates
    private _onLockfileUpdated = new vscode.EventEmitter<Lockfile | null>();
    readonly onLockfileUpdated = this._onLockfileUpdated.event;

    /**
     * Create a new LockfileManager for a specific repository
     * Use getInstance() to get or create instances.
     */
    constructor(repositoryPath: string) {
        this.repositoryPath = repositoryPath;
        this.lockfilePath = path.join(repositoryPath, LOCKFILE_NAME);
        this.logger = Logger.getInstance();
        this.schemaValidator = new SchemaValidator();
        this.setupFileWatcher();
    }

    /**
     * Get or create a LockfileManager instance for a repository path.
     * Supports multi-root workspaces by maintaining separate instances per repository.
     * 
     * @param repositoryPath - Path to the repository root (required)
     * @returns LockfileManager instance for the repository
     * @throws Error if repositoryPath is not provided
     */
    static getInstance(repositoryPath?: string): LockfileManager {
        if (!repositoryPath) {
            throw new Error('Repository path required for LockfileManager.getInstance()');
        }
        
        // Normalize path for consistent key lookup
        const normalizedPath = path.normalize(repositoryPath);
        
        if (!LockfileManager.instances.has(normalizedPath)) {
            LockfileManager.instances.set(normalizedPath, new LockfileManager(normalizedPath));
        }
        return LockfileManager.instances.get(normalizedPath)!;
    }

    /**
     * Reset a specific instance (for testing purposes)
     * @param repositoryPath - Path to the repository to reset
     */
    static resetInstance(repositoryPath?: string): void {
        if (repositoryPath) {
            const normalizedPath = path.normalize(repositoryPath);
            const instance = LockfileManager.instances.get(normalizedPath);
            if (instance) {
                instance.dispose();
                LockfileManager.instances.delete(normalizedPath);
            }
        } else {
            // Reset all instances
            for (const instance of LockfileManager.instances.values()) {
                instance.dispose();
            }
            LockfileManager.instances.clear();
        }
    }

    /**
     * Set up file watcher for external lockfile changes
     */
    private setupFileWatcher(): void {
        try {
            const pattern = new vscode.RelativePattern(this.repositoryPath, LOCKFILE_NAME);
            this.fileWatcher = vscode.workspace.createFileSystemWatcher(pattern);
            
            this.fileWatcher.onDidChange(() => {
                this.logger.debug('Lockfile changed externally');
                this.emitLockfileUpdated();
            });
            
            this.fileWatcher.onDidCreate(() => {
                this.logger.debug('Lockfile created externally');
                this.emitLockfileUpdated();
            });
            
            this.fileWatcher.onDidDelete(() => {
                this.logger.debug('Lockfile deleted externally');
                this._onLockfileUpdated.fire(null);
            });
        } catch (error) {
            this.logger.warn('Failed to set up lockfile watcher:', error instanceof Error ? error : undefined);
        }
    }

    private async emitLockfileUpdated(): Promise<void> {
        const lockfile = await this.read();
        this._onLockfileUpdated.fire(lockfile);
    }

    /**
     * Get the path to the lockfile
     */
    getLockfilePath(): string {
        return this.lockfilePath;
    }

    /**
     * Read the lockfile from disk
     * @returns The lockfile object or null if it doesn't exist
     */
    async read(): Promise<Lockfile | null> {
        try {
            if (!fs.existsSync(this.lockfilePath)) {
                return null;
            }
            const content = await fs.promises.readFile(this.lockfilePath, 'utf8');
            return JSON.parse(content) as Lockfile;
        } catch (error) {
            this.logger.error('Failed to read lockfile:', error instanceof Error ? error : undefined);
            return null;
        }
    }

    /**
     * Validate the lockfile against the JSON schema
     * @returns Validation result with errors and warnings
     */
    async validate(): Promise<LockfileValidationResult> {
        const lockfile = await this.read();
        
        if (!lockfile) {
            return {
                valid: false,
                errors: ['Lockfile does not exist'],
                warnings: [],
                schemaVersion: undefined
            };
        }

        try {
            // Get schema path from extension installation directory
            // Falls back to process.cwd() for development mode
            const schemaPath = this.getSchemaPath('lockfile.schema.json');
            const result = await this.schemaValidator.validate(lockfile, schemaPath);
            
            return {
                valid: result.valid,
                errors: result.errors,
                warnings: result.warnings,
                schemaVersion: lockfile.version
            };
        } catch (error) {
            return {
                valid: false,
                errors: [`Validation error: ${error instanceof Error ? error.message : String(error)}`],
                warnings: [],
                schemaVersion: lockfile.version
            };
        }
    }

    /**
     * Get the path to a schema file.
     * Resolves from extension installation directory, with fallback to process.cwd() for development.
     * 
     * @param schemaFileName - Name of the schema file (e.g., 'lockfile.schema.json')
     * @returns Full path to the schema file
     */
    private getSchemaPath(schemaFileName: string): string {
        // Try to get extension path first (works when extension is installed)
        try {
            const extension = vscode.extensions.getExtension(EXTENSION_ID);
            if (extension) {
                const extensionPath = extension.extensionPath;
                const schemaPath = path.join(extensionPath, 'schemas', schemaFileName);
                if (fs.existsSync(schemaPath)) {
                    this.logger.debug(`Using schema from extension path: ${schemaPath}`);
                    return schemaPath;
                }
            }
        } catch (error) {
            this.logger.debug('Could not get extension path, falling back to cwd');
        }

        // Fallback to process.cwd() for development mode
        const fallbackPath = path.join(process.cwd(), 'schemas', schemaFileName);
        this.logger.debug(`Using schema from fallback path: ${fallbackPath}`);
        return fallbackPath;
    }

    /**
     * Create or update a bundle entry in the lockfile
     * Uses atomic write (temp file + rename) to prevent corruption
     * 
     * @param options - Bundle creation/update options
     * @throws Error if required fields are missing or invalid
     */
    async createOrUpdate(options: CreateOrUpdateOptions): Promise<void> {
        // Validate required fields
        if (!options.bundleId || typeof options.bundleId !== 'string' || options.bundleId.trim() === '') {
            throw new Error('bundleId is required and must be a non-empty string');
        }
        if (!options.version || typeof options.version !== 'string' || options.version.trim() === '') {
            throw new Error('version is required and must be a non-empty string');
        }
        if (!options.sourceId || typeof options.sourceId !== 'string' || options.sourceId.trim() === '') {
            throw new Error('sourceId is required and must be a non-empty string');
        }
        if (!options.sourceType || typeof options.sourceType !== 'string') {
            throw new Error('sourceType is required and must be a string');
        }
        if (!Array.isArray(options.files)) {
            throw new Error('files must be an array');
        }
        if (!options.source || typeof options.source !== 'object') {
            throw new Error('source is required and must be an object');
        }
        if (!options.source.type || !options.source.url) {
            throw new Error('source must have type and url properties');
        }
        if (!options.commitMode || !['commit', 'local-only'].includes(options.commitMode)) {
            throw new Error('commitMode must be either "commit" or "local-only"');
        }

        const {
            bundleId,
            version,
            sourceId,
            sourceType,
            commitMode,
            files,
            source,
            hub,
            profile,
            checksum
        } = options;

        // Read existing lockfile or create new one
        let lockfile = await this.read();
        
        if (!lockfile) {
            lockfile = this.createEmptyLockfile();
        }

        // Update bundle entry
        const bundleEntry: LockfileBundleEntry = {
            version,
            sourceId,
            sourceType,
            installedAt: new Date().toISOString(),
            commitMode,
            files,
            ...(checksum && { checksum })
        };
        lockfile.bundles[bundleId] = bundleEntry;

        // Update source entry
        lockfile.sources[sourceId] = source;

        // Update hub entry if provided
        if (hub) {
            if (!lockfile.hubs) {
                lockfile.hubs = {};
            }
            lockfile.hubs[hub.id] = hub.entry;
        }

        // Update profile entry if provided
        if (profile) {
            if (!lockfile.profiles) {
                lockfile.profiles = {};
            }
            lockfile.profiles[profile.id] = profile.entry;
        }

        // Update timestamp
        lockfile.generatedAt = new Date().toISOString();

        // Write atomically
        await this.writeAtomic(lockfile);
        this._onLockfileUpdated.fire(lockfile);
    }

    /**
     * Remove a bundle from the lockfile
     * Deletes the lockfile if it becomes empty
     * 
     * @param bundleId - ID of the bundle to remove
     */
    async remove(bundleId: string): Promise<void> {
        const lockfile = await this.read();
        
        if (!lockfile) {
            this.logger.debug(`Lockfile does not exist, nothing to remove for bundle ${bundleId}`);
            return;
        }

        if (!lockfile.bundles[bundleId]) {
            this.logger.debug(`Bundle ${bundleId} not found in lockfile`);
            return;
        }

        // Get the source ID before removing the bundle
        const sourceId = lockfile.bundles[bundleId].sourceId;

        // Remove the bundle
        delete lockfile.bundles[bundleId];

        // Clean up orphaned sources (sources not referenced by any bundle)
        this.cleanupOrphanedSources(lockfile, sourceId);

        // If no bundles left, delete the lockfile
        if (Object.keys(lockfile.bundles).length === 0) {
            await this.deleteLockfile();
            this._onLockfileUpdated.fire(null);
            return;
        }

        // Update timestamp and write
        lockfile.generatedAt = new Date().toISOString();
        await this.writeAtomic(lockfile);
        this._onLockfileUpdated.fire(lockfile);
    }

    /**
     * Clean up sources that are no longer referenced by any bundle
     */
    private cleanupOrphanedSources(lockfile: Lockfile, removedSourceId: string): void {
        // Check if any other bundle references this source
        const isSourceReferenced = Object.values(lockfile.bundles)
            .some(bundle => bundle.sourceId === removedSourceId);
        
        if (!isSourceReferenced) {
            delete lockfile.sources[removedSourceId];
        }
    }

    /**
     * Detect files that have been modified since installation
     * Compares current file checksums against stored checksums
     * 
     * @param bundleId - ID of the bundle to check
     * @returns Array of modified file information
     */
    async detectModifiedFiles(bundleId: string): Promise<ModifiedFileInfo[]> {
        const lockfile = await this.read();
        
        if (!lockfile || !lockfile.bundles[bundleId]) {
            return [];
        }

        const bundleEntry = lockfile.bundles[bundleId];
        const modifiedFiles: ModifiedFileInfo[] = [];

        for (const fileEntry of bundleEntry.files) {
            const filePath = path.join(this.repositoryPath, fileEntry.path);
            
            try {
                if (!fs.existsSync(filePath)) {
                    // File is missing
                    modifiedFiles.push({
                        path: fileEntry.path,
                        originalChecksum: fileEntry.checksum,
                        currentChecksum: '',
                        modificationType: 'missing'
                    });
                    continue;
                }

                // Calculate current checksum using the utility directly
                const currentChecksum = await calculateFileChecksum(filePath);
                
                if (currentChecksum !== fileEntry.checksum) {
                    modifiedFiles.push({
                        path: fileEntry.path,
                        originalChecksum: fileEntry.checksum,
                        currentChecksum,
                        modificationType: 'modified'
                    });
                }
            } catch (error) {
                this.logger.warn(`Failed to check file ${fileEntry.path}:`, error instanceof Error ? error : undefined);
                modifiedFiles.push({
                    path: fileEntry.path,
                    originalChecksum: fileEntry.checksum,
                    currentChecksum: '',
                    modificationType: 'missing'
                });
            }
        }

        return modifiedFiles;
    }

    /**
     * Create an empty lockfile structure with required fields
     */
    private createEmptyLockfile(): Lockfile {
        // Get extension version from package.json
        let extensionVersion = '0.0.0';
        try {
            const extension = vscode.extensions.getExtension('prompt-registry');
            if (extension) {
                extensionVersion = extension.packageJSON.version || '0.0.0';
            }
        } catch {
            // Use default version if extension info not available
        }

        return {
            $schema: LOCKFILE_SCHEMA_URL,
            version: LOCKFILE_SCHEMA_VERSION,
            generatedAt: new Date().toISOString(),
            generatedBy: `prompt-registry@${extensionVersion}`,
            bundles: {},
            sources: {}
        };
    }

    /**
     * Write lockfile atomically using temp file + rename pattern
     * This prevents corruption during concurrent operations or crashes
     * Uses a mutex to serialize concurrent writes
     * 
     * @param lockfile - Lockfile to write
     */
    private async writeAtomic(lockfile: Lockfile): Promise<void> {
        // Serialize writes using a mutex pattern
        const previousLock = this.writeLock;
        let releaseLock: () => void;
        this.writeLock = new Promise<void>(resolve => {
            releaseLock = resolve;
        });

        try {
            // Wait for any previous write to complete
            await previousLock;
            
            const tempPath = this.lockfilePath + '.tmp';
            
            try {
                // Write to temp file with 2-space indentation
                const content = JSON.stringify(lockfile, null, 2);
                await fs.promises.writeFile(tempPath, content, 'utf8');
                
                // Atomic rename
                await fs.promises.rename(tempPath, this.lockfilePath);
                
                this.logger.debug('Lockfile written successfully');
            } catch (error) {
                // Clean up temp file if it exists
                try {
                    if (fs.existsSync(tempPath)) {
                        await fs.promises.unlink(tempPath);
                    }
                } catch {
                    // Ignore cleanup errors
                }
                throw error;
            }
        } finally {
            releaseLock!();
        }
    }

    /**
     * Delete the lockfile
     * 
     * Requirements covered:
     * - 3.5: If deletion fails, log an error and continue without throwing
     */
    private async deleteLockfile(): Promise<void> {
        try {
            if (fs.existsSync(this.lockfilePath)) {
                await fs.promises.unlink(this.lockfilePath);
                this.logger.debug('Lockfile deleted');
            }
        } catch (error) {
            // Requirements 3.5: Log error but don't throw - continue operation
            this.logger.error('Failed to delete lockfile:', error instanceof Error ? error : undefined);
        }
    }

    /**
     * Update the commit mode for a bundle in the lockfile.
     * Uses atomic write to prevent corruption.
     * 
     * @param bundleId - ID of the bundle to update
     * @param newMode - The new commit mode ('commit' or 'local-only')
     * @throws Error if bundle is not found in lockfile
     */
    async updateCommitMode(bundleId: string, newMode: RepositoryCommitMode): Promise<void> {
        const lockfile = await this.read();
        
        if (!lockfile) {
            throw new Error(`Lockfile does not exist`);
        }
        
        if (!lockfile.bundles[bundleId]) {
            throw new Error(`Bundle ${bundleId} not found in lockfile`);
        }

        lockfile.bundles[bundleId].commitMode = newMode;
        lockfile.generatedAt = new Date().toISOString();
        
        await this.writeAtomic(lockfile);
        this._onLockfileUpdated.fire(lockfile);
    }

    /**
     * Get all installed bundles from the lockfile as InstalledBundle objects.
     * This is the primary method for querying repository-scoped bundles.
     * 
     * @returns Array of InstalledBundle objects, empty array if lockfile doesn't exist
     * 
     * Requirements covered:
     * - 1.3: Convert LockfileBundleEntry to InstalledBundle format
     * - 1.4: Return empty array if lockfile doesn't exist
     * - 3.1, 3.2: Set filesMissing flag based on file existence check
     */
    async getInstalledBundles(): Promise<InstalledBundle[]> {
        const lockfile = await this.read();
        
        if (!lockfile) {
            return [];
        }

        const bundles: InstalledBundle[] = [];
        
        for (const [bundleId, entry] of Object.entries(lockfile.bundles)) {
            const filesMissing = await this.checkFilesMissing(entry);
            const installedBundle = createInstalledBundleFromLockfile(bundleId, entry, {
                installPath: path.join(this.repositoryPath, '.github'),
                filesMissing
            });
            bundles.push(installedBundle);
        }

        return bundles;
    }

    /**
     * Check if any files in a bundle entry are missing from the filesystem.
     * Uses async file access for consistency with async patterns.
     * Handles I/O errors gracefully by logging a warning and assuming files exist.
     * 
     * @param entry - The lockfile bundle entry to check
     * @returns true if any file is missing, false otherwise
     * 
     * Requirements covered:
     * - 3.1: Verify that bundle files exist in .github/ directories
     * - 3.2: Mark bundle with filesMissing flag if files are missing
     */
    private async checkFilesMissing(entry: LockfileBundleEntry): Promise<boolean> {
        if (!entry.files || entry.files.length === 0) {
            return false;
        }

        for (const file of entry.files) {
            const filePath = path.join(this.repositoryPath, file.path);
            
            try {
                await fs.promises.access(filePath, fs.constants.F_OK);
            } catch (error) {
                // Check if it's a "file not found" error vs other I/O errors
                if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                    return true;
                }
                // Handle other I/O errors gracefully - log warning and assume files exist
                this.logger.warn(
                    `Failed to check file existence for ${file.path}:`,
                    error instanceof Error ? error : undefined
                );
                // Per requirements: assume files exist on I/O error
            }
        }

        return false;
    }

    /**
     * Dispose of resources
     */
    dispose(): void {
        if (this.fileWatcher) {
            this.fileWatcher.dispose();
            this.fileWatcher = null;
        }
        this._onLockfileUpdated.dispose();
    }
}

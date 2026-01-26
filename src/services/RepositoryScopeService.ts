/**
 * Repository Scope Service
 * 
 * Handles repository-level bundle installation by placing files in .github/ directories.
 * Supports both commit mode (tracked by Git) and local-only mode (excluded via .git/info/exclude).
 * 
 * Requirements: 1.2-1.7, 3.1-3.7, 7.8-7.10, 10.1-10.6
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { promisify } from 'util';
import { Logger } from '../utils/logger';
import { IScopeService, ScopeStatus, SyncBundleOptions } from './IScopeService';
import { RegistryStorage } from '../storage/RegistryStorage';
import { LockfileManager } from './LockfileManager';
import { RepositoryCommitMode, DeploymentManifest } from '../types/registry';
import {
    CopilotFileType,
    determineFileType,
    getTargetFileName,
    getRepositoryTargetDirectory,
    normalizePromptId
} from '../utils/copilotFileTypeUtils';
import { ensureDirectory } from '../utils/fileIntegrityService';

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const readdir = promisify(fs.readdir);
const unlink = promisify(fs.unlink);
const copyFile = promisify(fs.copyFile);
const stat = promisify(fs.stat);
const rm = promisify(fs.rm);

/**
 * Section header for Prompt Registry entries in .git/info/exclude
 */
const GIT_EXCLUDE_SECTION_HEADER = '# Prompt Registry (local)';

/**
 * Name of the local lockfile that tracks local-only bundles
 */
const LOCAL_LOCKFILE_NAME = 'prompt-registry.local.lock.json';

/**
 * Tracks installed files during bundle installation for rollback support
 */
interface InstallationTracker {
    relativePaths: string[];
    absolutePaths: string[];
    skillDirs: string[];
}

/**
 * Service to sync bundle files to repository .github/ directories.
 * Implements IScopeService for consistent scope handling.
 */
export class RepositoryScopeService implements IScopeService {
    private logger: Logger;
    private workspaceRoot: string;
    private storage: RegistryStorage;

    /**
     * Create a new RepositoryScopeService
     * 
     * @param workspaceRoot - The root directory of the workspace/repository
     * @param storage - RegistryStorage instance for looking up bundle metadata
     */
    constructor(workspaceRoot: string, storage: RegistryStorage) {
        this.workspaceRoot = workspaceRoot;
        this.storage = storage;
        this.logger = Logger.getInstance();
    }

    /**
     * Get the .github base directory path
     */
    private getGitHubDirectory(): string {
        return path.join(this.workspaceRoot, '.github');
    }

    /**
     * Get the .git/info/exclude file path
     */
    private getGitExcludePath(): string {
        return path.join(this.workspaceRoot, '.git', 'info', 'exclude');
    }

    /**
     * Check if .git directory exists
     */
    private hasGitDirectory(): boolean {
        return fs.existsSync(path.join(this.workspaceRoot, '.git'));
    }

    /**
     * Ensure a directory exists, creating it if necessary.
     * Delegates to shared fileIntegrityService utility.
     */
    private async ensureDir(dir: string): Promise<void> {
        await ensureDirectory(dir);
        this.logger.debug(`[RepositoryScopeService] Ensured directory exists: ${dir}`);
    }

    /**
     * Get the target path for a file of a given type.
     * Implements IScopeService.getTargetPath
     * 
     * @param fileType - The Copilot file type
     * @param fileName - The name of the file (without extension)
     * @returns The full target path where the file should be placed
     */
    getTargetPath(fileType: CopilotFileType, fileName: string): string {
        const relativeDir = getRepositoryTargetDirectory(fileType);
        const targetFileName = getTargetFileName(fileName, fileType);
        return path.join(this.workspaceRoot, relativeDir, targetFileName);
    }

    /**
     * Get the relative path from workspace root for git exclude
     */
    private getRelativePath(absolutePath: string): string {
        return path.relative(this.workspaceRoot, absolutePath);
    }

    /**
     * Sync a bundle's files to the appropriate .github/ directories.
     * Implements IScopeService.syncBundle
     * 
     * @param bundleId - The unique identifier of the bundle
     * @param bundlePath - The path to the installed bundle directory
     * @param options - Optional sync options including commitMode
     */
    async syncBundle(bundleId: string, bundlePath: string, options?: SyncBundleOptions): Promise<void> {
        try {
            this.logger.debug(`[RepositoryScopeService] Syncing bundle: ${bundleId}`);

            // Get commit mode from options first, then fall back to storage lookup
            let commitMode: RepositoryCommitMode;
            if (options?.commitMode) {
                commitMode = options.commitMode;
                this.logger.debug(`[RepositoryScopeService] Using commitMode from options: ${commitMode}`);
            } else {
                const installedBundle = await this.storage.getInstalledBundle(bundleId, 'repository');
                commitMode = installedBundle?.commitMode ?? 'commit';
                this.logger.debug(`[RepositoryScopeService] Using commitMode from storage: ${commitMode}`);
            }

            // Read deployment manifest
            const manifestPath = path.join(bundlePath, 'deployment-manifest.yml');
            if (!fs.existsSync(manifestPath)) {
                this.logger.warn(`[RepositoryScopeService] No manifest found for bundle: ${bundleId}`);
                return;
            }

            const manifestContent = await readFile(manifestPath, 'utf-8');
            const manifest = yaml.load(manifestContent) as DeploymentManifest;

            if (!manifest.prompts || manifest.prompts.length === 0) {
                this.logger.debug(`[RepositoryScopeService] Bundle ${bundleId} has no prompts to sync`);
                return;
            }

            // Install files
            const installedPaths = await this.installFiles(bundlePath, manifest, commitMode);

            this.logger.info(`[RepositoryScopeService] ✅ Synced ${installedPaths.length} files for bundle: ${bundleId}`);

        } catch (error) {
            this.logger.error(`[RepositoryScopeService] Failed to sync bundle ${bundleId}`, error as Error);
            throw error;
        }
    }

    /**
     * Install files from a bundle to .github/ directories
     * 
     * @param bundlePath - Path to bundle directory
     * @param manifest - Deployment manifest
     * @param commitMode - Whether to track in git or exclude
     * @returns Array of installed file paths (relative to workspace)
     */
    private async installFiles(
        bundlePath: string,
        manifest: DeploymentManifest,
        commitMode: RepositoryCommitMode
    ): Promise<string[]> {
        const tracker: InstallationTracker = {
            relativePaths: [],
            absolutePaths: [],
            skillDirs: []
        };

        try {
            // Copy all bundle files to target directories
            await this.copyBundleFiles(bundlePath, manifest, tracker);

            // Handle git exclude for local-only mode
            if (commitMode === 'local-only' && tracker.relativePaths.length > 0) {
                await this.updateGitExcludeForLocalOnly(tracker.relativePaths);
            }

            return tracker.relativePaths;

        } catch (error) {
            await this.rollbackInstallation(tracker);
            throw error;
        }
    }

    /**
     * Copy all files from a bundle to their target .github/ directories
     */
    private async copyBundleFiles(
        bundlePath: string,
        manifest: DeploymentManifest,
        tracker: InstallationTracker
    ): Promise<void> {
        for (const promptDef of manifest.prompts || []) {
            const promptId = normalizePromptId(promptDef.id);
            
            if (promptDef.type === 'skill') {
                await this.installSkillAndTrack(bundlePath, promptDef.file, promptId, tracker);
            } else {
                await this.installFileAndTrack(bundlePath, promptDef, promptId, tracker);
            }
        }
    }

    /**
     * Install a skill directory and track for potential rollback
     */
    private async installSkillAndTrack(
        bundlePath: string,
        skillFile: string,
        skillId: string,
        tracker: InstallationTracker
    ): Promise<void> {
        const skillPaths = await this.installSkillDirectory(bundlePath, skillFile, skillId);
        
        if (skillPaths.length > 0) {
            const skillDir = path.join(
                this.workspaceRoot,
                getRepositoryTargetDirectory('skill'),
                skillId
            );
            tracker.skillDirs.push(skillDir);
            tracker.relativePaths.push(...skillPaths.map(p => this.getRelativePath(p)));
            tracker.absolutePaths.push(...skillPaths);
        }
    }

    /**
     * Install a single file and track for potential rollback
     */
    private async installFileAndTrack(
        bundlePath: string,
        promptDef: { file: string; type?: string; tags?: string[] },
        promptId: string,
        tracker: InstallationTracker
    ): Promise<void> {
        const sourcePath = path.join(bundlePath, promptDef.file);
        if (!fs.existsSync(sourcePath)) {
            this.logger.warn(`[RepositoryScopeService] Source file not found: ${sourcePath}`);
            return;
        }

        const fileType = promptDef.type as CopilotFileType || determineFileType(promptDef.file, promptDef.tags);
        const targetPath = this.getTargetPath(fileType, promptId);

        await this.ensureDir(path.dirname(targetPath));
        await copyFile(sourcePath, targetPath);
        this.logger.debug(`[RepositoryScopeService] Copied: ${path.basename(sourcePath)} → ${this.getRelativePath(targetPath)}`);

        tracker.absolutePaths.push(targetPath);
        tracker.relativePaths.push(this.getRelativePath(targetPath));
    }

    /**
     * Update git exclude for local-only mode, consolidating skill directories
     */
    private async updateGitExcludeForLocalOnly(relativePaths: string[]): Promise<void> {
        const pathsForExclude: string[] = [];
        
        for (const p of relativePaths) {
            if (p.includes('.github/skills/')) {
                // Extract skill directory path instead of individual files
                const match = p.match(/^(\.github\/skills\/[^/]+)/);
                if (match && !pathsForExclude.includes(match[1])) {
                    pathsForExclude.push(match[1]);
                }
            } else {
                pathsForExclude.push(p);
            }
        }
        
        await this.addToGitExclude(pathsForExclude);
    }

    /**
     * Rollback installation by removing all tracked files and directories
     */
    private async rollbackInstallation(tracker: InstallationTracker): Promise<void> {
        this.logger.error(`[RepositoryScopeService] Installation failed, rolling back...`);
        
        // Rollback skill directories first
        for (const skillDir of tracker.skillDirs) {
            try {
                if (fs.existsSync(skillDir)) {
                    await rm(skillDir, { recursive: true, force: true });
                    this.logger.debug(`[RepositoryScopeService] Rolled back skill directory: ${skillDir}`);
                }
            } catch (rollbackError) {
                this.logger.warn(`[RepositoryScopeService] Failed to rollback skill directory: ${skillDir}`);
            }
        }
        
        // Rollback individual files (skip those in skill directories)
        for (const absolutePath of tracker.absolutePaths) {
            const isInSkillDir = tracker.skillDirs.some(dir => absolutePath.startsWith(dir));
            if (isInSkillDir) {
                continue;
            }
            
            try {
                if (fs.existsSync(absolutePath)) {
                    await unlink(absolutePath);
                    this.logger.debug(`[RepositoryScopeService] Rolled back: ${absolutePath}`);
                }
            } catch (rollbackError) {
                this.logger.warn(`[RepositoryScopeService] Failed to rollback file: ${absolutePath}`);
            }
        }
    }

    /**
     * Install a skill directory by copying all files recursively
     * 
     * @param bundlePath - Path to the bundle directory
     * @param skillFile - Relative path to the skill directory in the bundle
     * @param skillId - The skill identifier
     * @returns Array of absolute paths to installed files
     */
    private async installSkillDirectory(
        bundlePath: string,
        skillFile: string,
        skillId: string
    ): Promise<string[]> {
        const sourcePath = path.join(bundlePath, skillFile);
        
        if (!fs.existsSync(sourcePath)) {
            this.logger.warn(`[RepositoryScopeService] Skill directory not found: ${sourcePath}`);
            return [];
        }

        const sourceStats = await stat(sourcePath);
        if (!sourceStats.isDirectory()) {
            this.logger.warn(`[RepositoryScopeService] Skill path is not a directory: ${sourcePath}`);
            return [];
        }

        // Target directory: .github/skills/<skill-id>/
        const targetDir = path.join(
            this.workspaceRoot,
            getRepositoryTargetDirectory('skill'),
            skillId
        );

        // Ensure target directory exists
        await this.ensureDir(targetDir);

        // Copy all files recursively
        const installedFiles = await this.copyDirectoryRecursive(sourcePath, targetDir);
        
        this.logger.debug(`[RepositoryScopeService] Installed skill ${skillId}: ${installedFiles.length} files`);
        
        return installedFiles;
    }

    /**
     * Recursively copy a directory and all its contents
     * 
     * @param sourceDir - Source directory path
     * @param targetDir - Target directory path
     * @returns Array of absolute paths to copied files
     */
    private async copyDirectoryRecursive(sourceDir: string, targetDir: string): Promise<string[]> {
        const copiedFiles: string[] = [];
        
        const entries = await readdir(sourceDir, { withFileTypes: true });
        
        for (const entry of entries) {
            const sourcePath = path.join(sourceDir, entry.name);
            const targetPath = path.join(targetDir, entry.name);
            
            if (entry.isDirectory()) {
                // Create subdirectory and recurse
                await this.ensureDir(targetPath);
                const subFiles = await this.copyDirectoryRecursive(sourcePath, targetPath);
                copiedFiles.push(...subFiles);
            } else if (entry.isFile()) {
                // Copy file
                await copyFile(sourcePath, targetPath);
                copiedFiles.push(targetPath);
                this.logger.debug(`[RepositoryScopeService] Copied skill file: ${entry.name}`);
            }
        }
        
        return copiedFiles;
    }

    /**
     * Remove synced files for a bundle.
     * Implements IScopeService.unsyncBundle
     * 
     * @param bundleId - The unique identifier of the bundle to unsync
     */
    async unsyncBundle(bundleId: string): Promise<void> {
        try {
            this.logger.debug(`[RepositoryScopeService] Removing files for bundle: ${bundleId}`);

            // Repository scope bundles are tracked via LockfileManager, not RegistryStorage
            // Use getInstalledBundles() to search both main and local lockfiles
            const lockfileManager = LockfileManager.getInstance(this.workspaceRoot);
            const installedBundles = await lockfileManager.getInstalledBundles();
            const bundle = installedBundles.find(b => b.bundleId === bundleId);
            
            if (!bundle) {
                this.logger.debug(`[RepositoryScopeService] Bundle ${bundleId} not found in any lockfile`);
                return;
            }
            
            // Get install path from global storage (same as BundleInstaller.getInstallDirectory for repository scope)
            // Repository scope bundles are stored in extension global storage under bundles/{bundleId}
            const storagePaths = this.storage.getPaths();
            const installPath = path.join(storagePaths.root, 'bundles', bundleId);

            // Read manifest to find files
            const manifestPath = path.join(installPath, 'deployment-manifest.yml');
            if (!fs.existsSync(manifestPath)) {
                this.logger.warn(`[RepositoryScopeService] No manifest found for bundle: ${bundleId}`);
                // Still try to remove files based on lockfile entries
                // We need to read the lockfile directly to get the files array
                const mainLockfile = await lockfileManager.read();
                const localLockfilePath = lockfileManager.getLocalLockfilePath();
                let localLockfile = null;
                if (fs.existsSync(localLockfilePath)) {
                    try {
                        const content = await readFile(localLockfilePath, 'utf-8');
                        localLockfile = JSON.parse(content);
                    } catch {
                        // Ignore parse errors
                    }
                }
                
                const bundleEntry = mainLockfile?.bundles[bundleId] || localLockfile?.bundles[bundleId];
                if (bundleEntry?.files && bundleEntry.files.length > 0) {
                    await this.removeFilesFromLockfileEntries(bundleEntry.files);
                }
                return;
            }

            const manifestContent = await readFile(manifestPath, 'utf-8');
            const manifest = yaml.load(manifestContent) as DeploymentManifest;

            if (!manifest.prompts || manifest.prompts.length === 0) {
                return;
            }

            const removedPaths: string[] = [];

            // Remove each file or skill directory
            for (const promptDef of manifest.prompts) {
                const promptId = normalizePromptId(promptDef.id);
                
                if (promptDef.type === 'skill') {
                    // Remove entire skill directory
                    const skillDir = path.join(
                        this.workspaceRoot,
                        getRepositoryTargetDirectory('skill'),
                        promptId
                    );
                    
                    if (fs.existsSync(skillDir)) {
                        try {
                            await rm(skillDir, { recursive: true, force: true });
                            removedPaths.push(this.getRelativePath(skillDir));
                            this.logger.debug(`[RepositoryScopeService] Removed skill directory: ${this.getRelativePath(skillDir)}`);
                        } catch (error) {
                            this.logger.warn(`[RepositoryScopeService] Failed to remove skill directory: ${skillDir}`);
                        }
                    }
                    continue;
                }

                const fileType = promptDef.type as CopilotFileType || determineFileType(promptDef.file, promptDef.tags);
                const targetPath = this.getTargetPath(fileType, promptId);

                if (fs.existsSync(targetPath)) {
                    await unlink(targetPath);
                    removedPaths.push(this.getRelativePath(targetPath));
                    this.logger.debug(`[RepositoryScopeService] Removed: ${this.getRelativePath(targetPath)}`);
                }
            }

            // Remove from git exclude if needed
            if (removedPaths.length > 0) {
                await this.removeFromGitExclude(removedPaths);
            }

            this.logger.info(`[RepositoryScopeService] ✅ Removed ${removedPaths.length} files/directories for bundle: ${bundleId}`);

        } catch (error) {
            this.logger.error(`[RepositoryScopeService] Failed to unsync bundle ${bundleId}`, error as Error);
        }
    }

    /**
     * Remove files based on lockfile file entries (fallback when manifest is not available)
     */
    private async removeFilesFromLockfileEntries(files: Array<{ path: string; checksum: string }>): Promise<void> {
        const removedPaths: string[] = [];
        
        for (const fileEntry of files) {
            const targetPath = path.join(this.workspaceRoot, fileEntry.path);
            if (fs.existsSync(targetPath)) {
                try {
                    await unlink(targetPath);
                    removedPaths.push(fileEntry.path);
                    this.logger.debug(`[RepositoryScopeService] Removed from lockfile entry: ${fileEntry.path}`);
                } catch (error) {
                    this.logger.warn(`[RepositoryScopeService] Failed to remove file: ${fileEntry.path}`);
                }
            }
        }
        
        if (removedPaths.length > 0) {
            await this.removeFromGitExclude(removedPaths);
        }
    }

    /**
     * Get the current status of the scope service.
     * Implements IScopeService.getStatus
     */
    async getStatus(): Promise<ScopeStatus> {
        const githubDir = this.getGitHubDirectory();
        const status: ScopeStatus = {
            baseDirectory: githubDir,
            dirExists: fs.existsSync(githubDir),
            syncedFiles: 0,
            files: []
        };

        if (!status.dirExists) {
            return status;
        }

        // Scan all .github subdirectories for files
        const subdirs = ['prompts', 'agents', 'instructions', 'skills'];
        for (const subdir of subdirs) {
            const subdirPath = path.join(githubDir, subdir);
            if (fs.existsSync(subdirPath)) {
                try {
                    const files = await readdir(subdirPath);
                    for (const file of files) {
                        const filePath = path.join(subdirPath, file);
                        const fileStat = await stat(filePath);
                        if (fileStat.isFile()) {
                            status.syncedFiles++;
                            status.files.push(file);
                        }
                    }
                } catch (error) {
                    this.logger.debug(`[RepositoryScopeService] Could not read directory: ${subdirPath}`);
                }
            }
        }

        return status;
    }

    /**
     * Switch the commit mode for a bundle
     * 
     * @param bundleId - Bundle identifier
     * @param newMode - New commit mode
     */
    async switchCommitMode(bundleId: string, newMode: RepositoryCommitMode): Promise<void> {
        try {
            this.logger.debug(`[RepositoryScopeService] Switching commit mode for ${bundleId} to ${newMode}`);

            // Get installed bundle info from lockfile (repository scope bundles are tracked via lockfile)
            // Use getInstalledBundles() to search both main and local lockfiles
            const lockfileManager = LockfileManager.getInstance(this.workspaceRoot);
            const installedBundles = await lockfileManager.getInstalledBundles();
            const bundle = installedBundles.find(b => b.bundleId === bundleId);
            
            if (!bundle) {
                this.logger.warn(`[RepositoryScopeService] Bundle ${bundleId} not found in any lockfile`);
                return;
            }

            const currentMode = bundle.commitMode ?? 'commit';
            if (currentMode === newMode) {
                this.logger.debug(`[RepositoryScopeService] Bundle ${bundleId} already in ${newMode} mode`);
                return;
            }

            // Find installed files in .github/ directories
            // The lockfile files point to the bundle cache, not the installed location
            // We need to scan the .github/ directories for files that belong to this bundle
            const filePaths: string[] = [];
            
            // Check .github/prompts directory
            const githubPromptsDir = path.join(this.workspaceRoot, '.github', 'prompts');
            if (fs.existsSync(githubPromptsDir)) {
                const files = await readdir(githubPromptsDir);
                for (const file of files) {
                    const relativePath = path.join('.github', 'prompts', file);
                    filePaths.push(relativePath);
                }
            }
            
            // Check .github/agents directory
            const githubAgentsDir = path.join(this.workspaceRoot, '.github', 'agents');
            if (fs.existsSync(githubAgentsDir)) {
                const files = await readdir(githubAgentsDir);
                for (const file of files) {
                    const relativePath = path.join('.github', 'agents', file);
                    filePaths.push(relativePath);
                }
            }
            
            // Check .github/copilot-instructions.md
            const copilotInstructionsPath = path.join(this.workspaceRoot, '.github', 'copilot-instructions.md');
            if (fs.existsSync(copilotInstructionsPath)) {
                filePaths.push('.github/copilot-instructions.md');
            }

            this.logger.debug(`[RepositoryScopeService] Found ${filePaths.length} files to update git exclude for`);

            // Update git exclude based on new mode
            if (newMode === 'local-only') {
                await this.addToGitExclude(filePaths);
            } else {
                await this.removeFromGitExclude(filePaths);
            }

            this.logger.info(`[RepositoryScopeService] ✅ Switched ${bundleId} to ${newMode} mode`);

        } catch (error) {
            this.logger.error(`[RepositoryScopeService] Failed to switch commit mode for ${bundleId}`, error as Error);
        }
    }

    /**
     * Add the local lockfile to .git/info/exclude.
     * This ensures the local lockfile is not tracked by Git.
     * 
     * Handles edge cases:
     * - Missing .git directory: skips without error
     * - Missing .git/info/exclude file: creates it
     * - Duplicate entries: prevents adding if already present
     * 
     * @see Requirements 2.1, 2.3, 2.4, 2.5
     */
    async addLocalLockfileToGitExclude(): Promise<void> {
        if (!this.hasGitDirectory()) {
            this.logger.debug('[RepositoryScopeService] No .git directory, skipping git exclude');
            return;
        }
        await this.addToGitExclude([LOCAL_LOCKFILE_NAME]);
    }

    /**
     * Remove the local lockfile from .git/info/exclude.
     * Called when the local lockfile is deleted (last local-only bundle removed).
     * 
     * Handles edge cases:
     * - Missing .git directory: skips without error
     * 
     * @see Requirements 2.2, 2.3
     */
    async removeLocalLockfileFromGitExclude(): Promise<void> {
        if (!this.hasGitDirectory()) {
            return;
        }
        await this.removeFromGitExclude([LOCAL_LOCKFILE_NAME]);
    }

    /**
     * Add paths to .git/info/exclude under the Prompt Registry section
     * 
     * @param paths - Relative paths to add
     */
    private async addToGitExclude(paths: string[]): Promise<void> {
        if (!this.hasGitDirectory()) {
            this.logger.warn('[RepositoryScopeService] No .git directory found, skipping git exclude');
            return;
        }

        try {
            const excludePath = this.getGitExcludePath();
            
            // Ensure .git/info directory exists
            await this.ensureDir(path.dirname(excludePath));

            // Read existing content
            let content = '';
            if (fs.existsSync(excludePath)) {
                content = await readFile(excludePath, 'utf-8');
            }

            // Find or create our section
            const sectionIndex = content.indexOf(GIT_EXCLUDE_SECTION_HEADER);
            let beforeSection = content;
            let sectionContent = '';
            let afterSection = '';

            if (sectionIndex !== -1) {
                beforeSection = content.substring(0, sectionIndex);
                const afterHeaderIndex = sectionIndex + GIT_EXCLUDE_SECTION_HEADER.length;
                const remainingContent = content.substring(afterHeaderIndex);
                
                // Find the end of our section (next section header or end of file)
                const nextSectionMatch = remainingContent.match(/\n#[^\n]+/);
                if (nextSectionMatch && nextSectionMatch.index !== undefined) {
                    sectionContent = remainingContent.substring(0, nextSectionMatch.index);
                    afterSection = remainingContent.substring(nextSectionMatch.index);
                } else {
                    sectionContent = remainingContent;
                }
            }

            // Parse existing entries in our section
            const existingEntries = new Set(
                sectionContent.split('\n').map(line => line.trim()).filter(line => line.length > 0)
            );

            // Add new paths
            for (const p of paths) {
                existingEntries.add(p);
            }

            // Rebuild content
            const newSectionContent = Array.from(existingEntries).join('\n');
            const newContent = beforeSection.trimEnd() + 
                (beforeSection.length > 0 ? '\n\n' : '') +
                GIT_EXCLUDE_SECTION_HEADER + '\n' +
                newSectionContent + '\n' +
                afterSection;

            await writeFile(excludePath, newContent.trim() + '\n', 'utf-8');
            this.logger.debug(`[RepositoryScopeService] Added ${paths.length} paths to git exclude`);

        } catch (error) {
            this.logger.warn(`[RepositoryScopeService] Failed to update git exclude: ${error}`);
            // Don't throw - git exclude is optional
        }
    }

    /**
     * Remove paths from .git/info/exclude
     * 
     * @param paths - Relative paths to remove
     */
    private async removeFromGitExclude(paths: string[]): Promise<void> {
        if (!this.hasGitDirectory()) {
            return;
        }

        try {
            const excludePath = this.getGitExcludePath();
            if (!fs.existsSync(excludePath)) {
                return;
            }

            let content = await readFile(excludePath, 'utf-8');

            // Find our section
            const sectionIndex = content.indexOf(GIT_EXCLUDE_SECTION_HEADER);
            if (sectionIndex === -1) {
                return;
            }

            const beforeSection = content.substring(0, sectionIndex);
            const afterHeaderIndex = sectionIndex + GIT_EXCLUDE_SECTION_HEADER.length;
            const remainingContent = content.substring(afterHeaderIndex);

            // Find the end of our section
            const nextSectionMatch = remainingContent.match(/\n#[^\n]+/);
            let sectionContent: string;
            let afterSection = '';

            if (nextSectionMatch && nextSectionMatch.index !== undefined) {
                sectionContent = remainingContent.substring(0, nextSectionMatch.index);
                afterSection = remainingContent.substring(nextSectionMatch.index);
            } else {
                sectionContent = remainingContent;
            }

            // Parse and filter entries
            const pathsToRemove = new Set(paths);
            const remainingEntries = sectionContent
                .split('\n')
                .map(line => line.trim())
                .filter(line => line.length > 0 && !pathsToRemove.has(line));

            // Rebuild content
            let newContent: string;
            if (remainingEntries.length === 0) {
                // Remove entire section if empty
                newContent = beforeSection.trimEnd() + afterSection;
            } else {
                newContent = beforeSection.trimEnd() +
                    (beforeSection.length > 0 ? '\n\n' : '') +
                    GIT_EXCLUDE_SECTION_HEADER + '\n' +
                    remainingEntries.join('\n') + '\n' +
                    afterSection;
            }

            await writeFile(excludePath, newContent.trim() + '\n', 'utf-8');
            this.logger.debug(`[RepositoryScopeService] Removed ${paths.length} paths from git exclude`);

        } catch (error) {
            this.logger.warn(`[RepositoryScopeService] Failed to update git exclude: ${error}`);
        }
    }
}

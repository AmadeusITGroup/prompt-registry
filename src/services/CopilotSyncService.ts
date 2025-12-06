/**
 * Copilot Sync Service
 * Syncs installed prompts to GitHub Copilot's native locations
 * 
 * Instead of using a custom chat participant, we create symlinks/copies
 * of prompt files to locations where GitHub Copilot naturally discovers them.
 * 
 * This works in:
 * - VSCode stable (no proposed APIs needed!)
 * - VSCode Insiders
 * - Windsurf and other forks
 * 
 * Based on: https://github.com/github/awesome-copilot
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { promisify } from 'util';
import { execSync } from 'child_process';
import * as yaml from 'js-yaml';
import { Logger } from '../utils/logger';
import { escapeRegex } from '../utils/regexUtils';
import { DeploymentManifest } from '../types/registry';

const readFile = promisify(fs.readFile);
const readdir = promisify(fs.readdir);
const writeFile = promisify(fs.writeFile);
const unlink = promisify(fs.unlink);
const symlink = promisify(fs.symlink);
const lstat = promisify(fs.lstat);

/**
 * Supported Copilot file types
 */
export type CopilotFileType = 'prompt' | 'instructions' | 'chatmode' | 'agent';

export interface CopilotFile {
    bundleId: string;
    type: CopilotFileType;
    name: string;
    sourcePath: string;
    targetPath: string;
}

/**
 * Service to sync bundle prompts to GitHub Copilot's native directories
 */
export class CopilotSyncService {
    private logger: Logger;

    constructor(private context: vscode.ExtensionContext) {
        this.logger = Logger.getInstance();
    }

    /**
     * Get the Copilot prompts directory for current VSCode flavor
     * Uses the extension's globalStorageUri to dynamically determine the IDE's data directory
     * 
     * Supports both standard and profile-based paths:
     * - Standard: ~/Library/Application Support/<IDE>/User/globalStorage/<publisher>.<extension>
     * - Profile:  ~/Library/Application Support/<IDE>/User/profiles/<profile-id>/globalStorage/<publisher>.<extension>
     * 
     * WORKAROUND: If extension is installed globally but user is in a profile,
     * we detect the active profile using combined detection methods
     * 
     * WSL Support: When running in WSL remote context, GitHub Copilot runs in the Windows UI,
     * so we need to sync prompts to the Windows filesystem, not the WSL filesystem.
     */
    private getCopilotPromptsDirectory(): string {
        // WSL Support: Check if we're running in WSL remote context
        // In WSL, the extension runs in the remote (Linux) context, but Copilot runs in UI (Windows) context
        // We need to write prompts to the Windows filesystem where Copilot can find them
        if (vscode.env.remoteName === 'wsl') {
            return this.getWindowsPromptDirectoryFromWSL();
        }

        const globalStoragePath = this.context.globalStorageUri.fsPath;
        
        // Find the User directory by looking for '/User/' or '\User\' in the path
        const userIndex = globalStoragePath.lastIndexOf(path.sep + 'User' + path.sep);
        
        if (userIndex === -1) {
            // Fallback: Custom user-data-dir without 'User' directory
            // Navigate up from globalStorage/publisher.extension
            const baseDir = path.dirname(path.dirname(globalStoragePath));
            
            // Check if we're in a profiles structure
            const escapedSep = escapeRegex(path.sep);
            const profilesMatch = baseDir.match(new RegExp(`profiles${escapedSep}([^${escapedSep}]+)`));
            if (profilesMatch) {
                const profileId = profilesMatch[1];
                const profileName = this.getActiveProfileName(baseDir) || profileId;
                this.logger.info(`[CopilotSync] Using profile: ${profileName}`);
                return path.join(baseDir, 'prompts');
            }
            
            return path.join(baseDir, 'prompts');
        }
        
        // Extract path up to and including 'User'
        const userDir = globalStoragePath.substring(0, userIndex + path.sep.length + 'User'.length);
        
        // Check if this is a profile-based path by looking for '/profiles/' after User
        // Path structure: .../User/profiles/<profile-id>/globalStorage/...
        const remainingPath = globalStoragePath.substring(userDir.length);
        const escapedSep = escapeRegex(path.sep);
        const profilesMatch = remainingPath.match(new RegExp(`^${escapedSep}profiles${escapedSep}([^${escapedSep}]+)`));
        
        if (profilesMatch) {
            // Profile-based path: include the profile directory
            const profileId = profilesMatch[1];
            const profileName = this.getActiveProfileName(userDir) || profileId;
            this.logger.info(`[CopilotSync] Using profile: ${profileName}`);
            return path.join(userDir, 'profiles', profileId, 'prompts');
        }
        
        // Extension installed globally but user might be in a profile
        // Use combined detection method (storage.json + filesystem heuristic)
        const detectedProfile = this.detectActiveProfile(userDir);
        if (detectedProfile) {
            this.logger.info(`[CopilotSync] Using profile: ${detectedProfile.name}`);
            return path.join(userDir, 'profiles', detectedProfile.id, 'prompts');
        }
        
        // Standard path: User/prompts
        this.logger.info(`[CopilotSync] Using default profile`);
        return path.join(userDir, 'prompts');
    }


    /**
     * Get Windows Copilot prompts directory when running in WSL
     * 
     * In WSL, the extension runs in the remote (Linux) context,
     * but Copilot runs in the UI (Windows) context.
     * We need to sync prompts to the Windows filesystem.
     * 
     * Strategy:
     * 1. Detect if globalStorageUri already points to Windows mount (/mnt/c/)
     * 2. If not, get Windows username and construct Windows path
     * 3. Handle multiple drive letters (C:, D:, etc.)
     * 4. Detect VS Code flavor (Code, Insiders, Windsurf)
     * 5. Support profile detection
     * 
     * Edge cases handled:
     * - Different WSL and Windows usernames (exec Windows USERNAME command)
     * - Multiple drive letters (/mnt/c, /mnt/d, etc.)
     * - VS Code profiles
     * - Different VS Code flavors
     */
    private getWindowsPromptDirectoryFromWSL(): string {
        const globalStoragePath = this.context.globalStorageUri.fsPath;
        this.logger.info(`[CopilotSync] WSL detected, globalStoragePath: ${globalStoragePath}`);

        let windowsUsername: string;
        let appDataPath: string;
        let vscodeFlavorDir: string;
        let driveLetter = 'c'; // Default to C:

        // Check if globalStoragePath already points to Windows mount (/mnt/X/)
        const mountMatch = globalStoragePath.match(/^\/mnt\/([a-z])\/Users\/([^/]+)\/AppData\/Roaming\/([^/]+)/);
        
        if (mountMatch) {
            // Scenario A: Already pointing to Windows filesystem via WSL mount
            // Path like: /mnt/c/Users/username/AppData/Roaming/Code/User/globalStorage/...
            driveLetter = mountMatch[1];
            windowsUsername = mountMatch[2];
            vscodeFlavorDir = mountMatch[3]; // "Code", "Code - Insiders", "Windsurf", etc.
            appDataPath = `/mnt/${driveLetter}/Users/${windowsUsername}/AppData/Roaming`;
            
            this.logger.info(`[CopilotSync] WSL: Detected Windows mount - User: ${windowsUsername}, Flavor: ${vscodeFlavorDir}, Drive: ${driveLetter.toUpperCase()}:`);
        } else {
            // Scenario B: globalStoragePath points to WSL filesystem (e.g., /home/username/.vscode-server)
            // Need to map to Windows equivalent
            
            this.logger.info(`[CopilotSync] WSL: Remote storage detected, mapping to Windows filesystem`);
            
            // Get Windows username - try multiple methods for robustness
            try {
                // Method 1: Execute Windows command to get actual Windows username
                // This handles cases where WSL username differs from Windows username
                const result = execSync('cmd.exe /c echo %USERNAME%', { 
                    encoding: 'utf-8',
                    timeout: 5000,
                    stdio: ['pipe', 'pipe', 'ignore'] // Suppress stderr
                }).trim();
                
                if (result && result !== '%USERNAME%') {
                    windowsUsername = result;
                    this.logger.info(`[CopilotSync] WSL: Windows username from cmd.exe: ${windowsUsername}`);
                } else {
                    throw new Error('cmd.exe returned empty or unexpanded variable');
                }
            } catch (error) {
                // Method 2: Fallback to WSL username (assumes same as Windows username)
                windowsUsername = process.env.LOGNAME || process.env.USER || os.userInfo().username || 'default';
                this.logger.warn(`[CopilotSync] WSL: Could not get Windows username via cmd.exe, using WSL username: ${windowsUsername}`);
                this.logger.debug(`[CopilotSync] WSL: cmd.exe error: ${error}`);
            }
            
            // Detect VS Code flavor from appName
            const appName = vscode.env.appName;
            if (appName.includes('Insiders')) {
                vscodeFlavorDir = 'Code - Insiders';
            } else if (appName.includes('Windsurf')) {
                vscodeFlavorDir = 'Windsurf';
            } else if (appName.includes('Cursor')) {
                vscodeFlavorDir = 'Cursor';
            } else {
                vscodeFlavorDir = 'Code';
            }
            
            this.logger.info(`[CopilotSync] WSL: Detected VS Code flavor: ${vscodeFlavorDir}`);
            
            // Try to find the correct Windows drive by checking common mount points
            // Priority: C: > D: > E: > F:
            const driveLetters = ['c', 'd', 'e', 'f'];
            let foundDrive = false;
            
            for (const letter of driveLetters) {
                const testPath = `/mnt/${letter}/Users/${windowsUsername}/AppData/Roaming`;
                try {
                    if (fs.existsSync(testPath)) {
                        driveLetter = letter;
                        foundDrive = true;
                        this.logger.info(`[CopilotSync] WSL: Found Windows drive: ${letter.toUpperCase()}:`);
                        break;
                    }
                } catch (error) {
                    // Drive not accessible, continue to next
                    continue;
                }
            }
            
            if (!foundDrive) {
                this.logger.warn(`[CopilotSync] WSL: Could not find Windows AppData, defaulting to C: drive`);
                driveLetter = 'c';
            }
            
            appDataPath = `/mnt/${driveLetter}/Users/${windowsUsername}/AppData/Roaming`;
        }

        // Check for profile in globalStoragePath
        // Profiles can appear in both Windows mount paths and WSL remote paths
        const escapedSep = escapeRegex(path.sep);
        const profilesMatch = globalStoragePath.match(new RegExp(`profiles${escapedSep}([^${escapedSep}]+)`));
        
        if (profilesMatch) {
            const profileId = profilesMatch[1];
            const promptsDir = path.join(appDataPath, vscodeFlavorDir, 'User', 'profiles', profileId, 'prompts');
            this.logger.info(`[CopilotSync] WSL: Using profile prompts directory: ${promptsDir}`);
            
            // Ensure directory exists
            try {
                if (!fs.existsSync(promptsDir)) {
                    fs.mkdirSync(promptsDir, { recursive: true });
                    this.logger.info(`[CopilotSync] WSL: Created profile prompts directory`);
                }
            } catch (error) {
                this.logger.error(`[CopilotSync] WSL: Failed to create profile prompts directory: ${error}`);
            }
            
            return promptsDir;
        }

        // Standard path: User/prompts
        const promptsDir = path.join(appDataPath, vscodeFlavorDir, 'User', 'prompts');
        this.logger.info(`[CopilotSync] WSL: Using default prompts directory: ${promptsDir}`);
        
        // Ensure directory exists
        try {
            if (!fs.existsSync(promptsDir)) {
                fs.mkdirSync(promptsDir, { recursive: true });
                this.logger.info(`[CopilotSync] WSL: Created prompts directory`);
            }
        } catch (error) {
            this.logger.error(`[CopilotSync] WSL: Failed to create prompts directory: ${error}`);
        }
        
        return promptsDir;
    }
    /**
     * Detect active profile using combined workarounds
     * 
     * Uses two complementary methods:
     * 1. storage.json parsing (most reliable when available)
     * 2. Filesystem heuristic (fallback based on recent activity)
     * 
     * Returns profile ID and human-readable name, or null if no profile detected
     */
    private detectActiveProfile(userDir: string): { id: string; name: string } | null {
        try {
            const storageJsonPath = path.join(userDir, 'globalStorage', 'storage.json');
            const profilesDir = path.join(userDir, 'profiles');
            
            // Check if profiles directory exists
            if (!fs.existsSync(profilesDir)) {
                return null;
            }
            
            let profileId: string | null = null;
            let profileName: string | null = null;
            
            // WORKAROUND #1: Try storage.json first (most reliable)
            if (fs.existsSync(storageJsonPath)) {
                const storageData = JSON.parse(fs.readFileSync(storageJsonPath, 'utf-8'));
                const items = storageData?.lastKnownMenubarData?.menus?.Preferences?.items;
                
                if (Array.isArray(items)) {
                    const profilesMenu = items.find((i: any) => i?.id === 'submenuitem.Profiles');
                    
                    if (profilesMenu) {
                        // Extract human-readable name from parent label
                        // Format: "Profile (MyProfile)" or just "Profile"
                        const parentLabel: string | undefined = profilesMenu.label;
                        if (parentLabel) {
                            const match = parentLabel.match(/\((.+)\)$/);
                            if (match && match[1] && match[1] !== 'Default') {
                                profileName = match[1];
                            }
                        }
                        
                        // Find corresponding profile ID from submenu items
                        const submenuItems = profilesMenu.submenu?.items;
                        if (Array.isArray(submenuItems)) {
                            for (const item of submenuItems) {
                                if (item?.command?.startsWith('workbench.profiles.actions.profileEntry.')) {
                                    const candidateId = item.command.replace('workbench.profiles.actions.profileEntry.', '');
                                    const profileDir = path.join(profilesDir, candidateId);
                                    if (fs.existsSync(profileDir)) {
                                        profileId = candidateId;
                                        break;
                                    }
                                }
                            }
                        }
                    }
                }
                
                if (profileId) {
                    this.logger.debug(`[CopilotSync] Profile detected from storage.json: ${profileId}`);
                    return { id: profileId, name: profileName || profileId };
                }
            }
            
            // WORKAROUND #2: Fallback to filesystem heuristic
            // Check profiles directory for recent activity
            const profiles = fs.readdirSync(profilesDir);
            
            for (const candidateId of profiles) {
                const profileGlobalStorage = path.join(profilesDir, candidateId, 'globalStorage');
                
                if (fs.existsSync(profileGlobalStorage)) {
                    const stats = fs.statSync(profileGlobalStorage);
                    const ageMinutes = (Date.now() - stats.mtimeMs) / 1000 / 60;
                    
                    // If modified in last 5 minutes, likely the active profile
                    if (ageMinutes < 5) {
                        this.logger.debug(`[CopilotSync] Profile detected from filesystem heuristic: ${candidateId}`);
                        return { id: candidateId, name: candidateId };
                    }
                }
            }
            
            return null;
        } catch (error) {
            // Silent failure - this is a best-effort workaround
            return null;
        }
    }

    /**
     * Get the active profile display name from storage.json
     * Returns the human-readable profile name (e.g., "Work", "Personal")
     * Used for paths that already have a profile ID embedded
     */
    private getActiveProfileName(userDir: string): string | null {
        try {
            const storageJsonPath = path.join(userDir, 'globalStorage', 'storage.json');
            
            if (!fs.existsSync(storageJsonPath)) {
                return null;
            }
            
            const storageData = JSON.parse(fs.readFileSync(storageJsonPath, 'utf-8'));
            const items = storageData?.lastKnownMenubarData?.menus?.Preferences?.items;
            
            if (!Array.isArray(items)) {
                return null;
            }
            
            const profilesMenu = items.find((i: any) => i?.id === 'submenuitem.Profiles');
            
            // Extract profile name from parent label
            // Format: "Profile (MyProfile)" or just "Profile"
            const parentLabel: string | undefined = profilesMenu?.label;
            if (parentLabel) {
                const match = parentLabel.match(/\((.+)\)$/);
                if (match && match[1] && match[1] !== 'Default') {
                    return match[1];
                }
            }
            
            return null;
        } catch (error) {
            return null;
        }
    }

    /**
     * Sync all prompts from installed bundles to Copilot directory
     */
    async syncAllBundles(): Promise<void> {
        try {
            this.logger.info('Syncing bundles to GitHub Copilot...');
            
            // Ensure Copilot prompts directory exists
            const promptsDir = this.getCopilotPromptsDirectory();
            await this.ensureDirectory(promptsDir);
            
            // Get all installed bundles
            const bundlesDir = path.join(this.context.globalStorageUri.fsPath, 'bundles');
            
            if (!fs.existsSync(bundlesDir)) {
                this.logger.debug('No bundles directory found');
                return;
            }
            
            const bundleDirs = await readdir(bundlesDir);
            
            for (const bundleId of bundleDirs) {
                const bundlePath = path.join(bundlesDir, bundleId);
                const stat = fs.statSync(bundlePath);
                
                if (stat.isDirectory()) {
                    await this.syncBundle(bundleId, bundlePath);
                }
            }
            
            this.logger.info(`Synced ${bundleDirs.length} bundles to Copilot`);
            
        } catch (error) {
            this.logger.error('Failed to sync bundles to Copilot', error as Error);
        }
    }

    /**
     * Sync a single bundle to Copilot directory
     */
    async syncBundle(bundleId: string, bundlePath: string): Promise<void> {
        try {
            this.logger.debug(`Syncing bundle: ${bundleId}`);
            
            // Get prompts directory
            const promptsDir = this.getCopilotPromptsDirectory();
            
            // Ensure base Copilot prompts directory exists
            await this.ensureDirectory(promptsDir);
            
            // Read deployment manifest
            const manifestPath = path.join(bundlePath, 'deployment-manifest.yml');
            
            if (!fs.existsSync(manifestPath)) {
                this.logger.warn(`No manifest found for bundle: ${bundleId}`);
                return;
            }
            
            const manifestContent = await readFile(manifestPath, 'utf-8');
            const manifest = yaml.load(manifestContent) as DeploymentManifest;
            
            if (!manifest.prompts || manifest.prompts.length === 0) {
                this.logger.debug(`Bundle ${bundleId} has no prompts to sync`);
                return;
            }
            
            // Sync each prompt
            for (const promptDef of manifest.prompts) {
                const sourcePath = path.join(bundlePath, promptDef.file);
                
                if (!fs.existsSync(sourcePath)) {
                    this.logger.warn(`Prompt file not found: ${sourcePath}`);
                    continue;
                }
                
                // Detect file type and create appropriate filename
                const copilotFile = this.determineCopilotFileType(promptDef, sourcePath, bundleId);
                
                // Create symlink or copy
                await this.createCopilotFile(copilotFile);
            }
            
        } catch (error) {
            this.logger.error(`Failed to sync bundle ${bundleId}`, error as Error);
        }
    }

    /**
     * Determine Copilot file type and target path
     */
    private determineCopilotFileType(
        promptDef: any,
        sourcePath: string,
        bundleId: string
    ): CopilotFile {
        // Check if tags or filename indicate type
        const tags = promptDef.tags || [];
        const fileName = path.basename(sourcePath, path.extname(sourcePath));
        
        let type: CopilotFileType = 'prompt'; // default
        
        // Detect type from tags
        if (tags.includes('instructions') || fileName.includes('instructions')) {
            type = 'instructions';
        } else if (tags.includes('chatmode') || tags.includes('mode')) {
            type = 'chatmode';
        } else if (tags.includes('agent')) {
            type = 'agent';
        }
        
        // Or from manifest type field if exists
        if (promptDef.type) {
            type = promptDef.type as CopilotFileType;
        }
        
        // Create target path: promptId.type.md directly in prompts directory
        const targetFileName = `${promptDef.id}.${type}.md`;
        const promptsDir = this.getCopilotPromptsDirectory();
        const targetPath = path.join(promptsDir, targetFileName);
        
        return {
            bundleId,
            type,
            name: promptDef.name,
            sourcePath,
            targetPath
        };
    }

    /**
     * Create symlink (or copy if symlink fails) to Copilot directory
     */
    private async createCopilotFile(file: CopilotFile): Promise<void> {
        try {
            // Check if target already exists
            if (fs.existsSync(file.targetPath)) {
                // Check if it's our symlink/file
                const stats = await lstat(file.targetPath);
                
                if (stats.isSymbolicLink()) {
                    // Remove old symlink
                    await unlink(file.targetPath);
                    this.logger.debug(`Removed old symlink: ${file.targetPath}`);
                } else {
                    // It's a regular file - might be user's custom file, skip
                    this.logger.warn(`File already exists (not managed): ${file.targetPath}`);
                    return;
                }
            }
            
            // Ensure parent directory exists before creating symlink/file
            const targetDir = path.dirname(file.targetPath);
            await this.ensureDirectory(targetDir);
            
            // Try to create symlink first (preferred)
            try {
                await symlink(file.sourcePath, file.targetPath, 'file');
                this.logger.debug(`Created symlink: ${path.basename(file.targetPath)}`);
            } catch (symlinkError) {
                // Symlink failed (maybe Windows or permissions), fall back to copy
                this.logger.debug('Symlink failed, copying file instead');
                const content = await readFile(file.sourcePath, 'utf-8');
                await writeFile(file.targetPath, content, 'utf-8');
                this.logger.debug(`Copied file: ${path.basename(file.targetPath)}`);
            }
            
            this.logger.info(`✅ Synced ${file.type}: ${file.name} → ${path.basename(file.targetPath)}`);
            
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            const errorStack = error instanceof Error ? error.stack : undefined;
            this.logger.error(`Failed to create Copilot file: ${file.targetPath}`, {
                message: errorMessage,
                stack: errorStack,
                bundleId: file.bundleId,
                fileType: file.type
            } as any);
        }
    }

    /**
     * Remove synced files for a bundle
     * Since we use a flat structure, we need to read the bundle's manifest to know which files to remove
     */
    async unsyncBundle(bundleId: string): Promise<void> {
        try {
            this.logger.debug(`Removing Copilot files for bundle: ${bundleId}`);
            
            const promptsDir = this.getCopilotPromptsDirectory();
            if (!fs.existsSync(promptsDir)) {
                return;
            }
            
            // Read the bundle's manifest to find which files were synced
            const bundlePath = path.join(this.context.globalStorageUri.fsPath, 'bundles', bundleId);
            const manifestPath = path.join(bundlePath, 'deployment-manifest.yml');
            
            if (!fs.existsSync(manifestPath)) {
                this.logger.warn(`No manifest found for bundle: ${bundleId}, cannot determine files to remove`);
                return;
            }
            
            const manifestContent = await readFile(manifestPath, 'utf-8');
            const manifest = yaml.load(manifestContent) as any;
            
            if (!manifest.prompts || manifest.prompts.length === 0) {
                this.logger.debug(`Bundle ${bundleId} has no prompts to unsync`);
                return;
            }
            
            // Remove each synced file
            let removedCount = 0;
            for (const promptDef of manifest.prompts) {
                const copilotFile = this.determineCopilotFileType(promptDef, '', bundleId);
                
                if (fs.existsSync(copilotFile.targetPath)) {
                    const stats = await lstat(copilotFile.targetPath);
                    
                    // Only remove if it's a symlink (to avoid deleting user's custom files)
                    if (stats.isSymbolicLink()) {
                        await unlink(copilotFile.targetPath);
                        this.logger.debug(`Removed: ${path.basename(copilotFile.targetPath)}`);
                        removedCount++;
                    } else {
                        this.logger.warn(`Skipping non-symlink file: ${path.basename(copilotFile.targetPath)}`);
                    }
                }
            }
            
            this.logger.info(`✅ Removed ${removedCount} Copilot file(s) for bundle: ${bundleId}`);
            
        } catch (error) {
            this.logger.error(`Failed to unsync bundle ${bundleId}`, error as Error);
        }
    }

    /**
     * Clean all synced files (for extension uninstall)
     */
    async cleanAll(): Promise<void> {
        try {
            this.logger.info('Cleaning all Copilot synced files...');
            
            const promptsDir = this.getCopilotPromptsDirectory();
            if (!fs.existsSync(promptsDir)) {
                return;
            }
            
            // Get list of all bundle IDs from our storage
            const bundlesDir = path.join(this.context.globalStorageUri.fsPath, 'bundles');
            
            if (!fs.existsSync(bundlesDir)) {
                return;
            }
            
            const bundleIds = await readdir(bundlesDir);
            
            // Remove all files for our bundles
            for (const bundleId of bundleIds) {
                await this.unsyncBundle(bundleId);
            }
            
            this.logger.info('✅ Cleaned all Copilot synced files');
            
        } catch (error) {
            this.logger.error('Failed to clean Copilot files', error as Error);
        }
    }

    /**
     * Get status of Copilot integration
     */
    async getStatus(): Promise<{
        copilotDir: string;
        dirExists: boolean;
        syncedFiles: number;
        files: string[];
    }> {
        const promptsDir = this.getCopilotPromptsDirectory();
        const status = {
            copilotDir: promptsDir,
            dirExists: fs.existsSync(promptsDir),
            syncedFiles: 0,
            files: [] as string[]
        };
        
        if (status.dirExists) {
            const entries = await readdir(promptsDir);
            
            // Count symlinks (our synced files) in the prompts directory
            for (const entry of entries) {
                const entryPath = path.join(promptsDir, entry);
                
                try {
                    const entryStat = await lstat(entryPath);
                    
                    // Only count symlinks (files we created)
                    if (entryStat.isSymbolicLink()) {
                        status.syncedFiles++;
                        status.files.push(entry);
                    }
                } catch (error) {
                    // Skip files we can't stat
                    this.logger.debug(`Could not stat file: ${entry}`);
                }
            }
        }
        
        return status;
    }

    /**
     * Ensure directory exists
     */
    private async ensureDirectory(dir: string): Promise<void> {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
            this.logger.debug(`Created directory: ${dir}`);
        }
    }
}

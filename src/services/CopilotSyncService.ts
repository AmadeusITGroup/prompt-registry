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
export type CopilotFileType = 'prompt' | 'instructions' | 'chatmode' | 'agent' | 'skill';

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
            
            // Sync each prompt/skill
            for (const promptDef of manifest.prompts) {
                // Handle skills differently - they are directories
                if (promptDef.type === 'skill') {
                    await this.syncSkillFromBundle(bundleId, bundlePath, promptDef);
                    continue;
                }
                
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
     * Sync a skill from a bundle
     * Skills are directories containing SKILL.md and optional subdirectories
     */
    private async syncSkillFromBundle(bundleId: string, bundlePath: string, promptDef: any): Promise<void> {
        try {
            // Extract skill name from the path (e.g., skills/my-skill/SKILL.md -> my-skill)
            const skillPath = promptDef.file;
            const skillMatch = skillPath.match(/skills\/([^/]+)\/SKILL\.md/);
            
            if (!skillMatch) {
                this.logger.warn(`Invalid skill path: ${skillPath}`);
                return;
            }
            
            const skillName = skillMatch[1];
            const skillSourceDir = path.join(bundlePath, 'skills', skillName);
            
            if (!fs.existsSync(skillSourceDir)) {
                this.logger.warn(`Skill directory not found: ${skillSourceDir}`);
                return;
            }
            
            // Sync skill to ~/.copilot/skills
            await this.syncSkill(skillName, skillSourceDir, 'user');
            
            this.logger.info(`✅ Synced skill: ${skillName}`);
        } catch (error) {
            this.logger.error(`Failed to sync skill from bundle ${bundleId}`, error as Error);
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
            
            // Remove each synced file/skill
            let removedCount = 0;
            for (const promptDef of manifest.prompts) {
                // Handle skills differently - they are directories
                if (promptDef.type === 'skill') {
                    const skillMatch = promptDef.file.match(/skills\/([^/]+)\/SKILL\.md/);
                    if (skillMatch) {
                        const skillName = skillMatch[1];
                        await this.unsyncSkill(skillName, 'user');
                        removedCount++;
                    }
                    continue;
                }
                
                const sourcePath = path.join(bundlePath, promptDef.file);
                const copilotFile = this.determineCopilotFileType(promptDef, sourcePath, bundleId);
                
                if (fs.existsSync(copilotFile.targetPath)) {
                    const stats = await lstat(copilotFile.targetPath);
                    
                    // Only remove if it's a symlink (to avoid deleting user's custom files)
                    if (stats.isSymbolicLink()) {
                        await unlink(copilotFile.targetPath);
                        this.logger.debug(`Removed: ${path.basename(copilotFile.targetPath)}`);
                        removedCount++;
                    } else {
                        // In some environments (like WSL -> Windows), symlinks might fail and fall back to copy
                        // Check if file content matches source before deleting
                        try {
                            if (fs.existsSync(copilotFile.sourcePath)) {
                                const targetContent = await readFile(copilotFile.targetPath, 'utf-8');
                                const sourceContent = await readFile(copilotFile.sourcePath, 'utf-8');
                                
                                // Normalize line endings (CRLF -> LF) for comparison
                                const normalizedTarget = targetContent.replace(/\r\n/g, '\n');
                                const normalizedSource = sourceContent.replace(/\r\n/g, '\n');
                                
                                if (normalizedTarget === normalizedSource) {
                                    await unlink(copilotFile.targetPath);
                                    this.logger.debug(`Removed copied file: ${path.basename(copilotFile.targetPath)}`);
                                    removedCount++;
                                } else {
                                    this.logger.warn(`Skipping modified file: ${path.basename(copilotFile.targetPath)}`);
                                }
                            } else {
                                this.logger.warn(`Skipping non-symlink file (source not found): ${path.basename(copilotFile.targetPath)}`);
                            }
                        } catch (err) {
                            this.logger.warn(`Failed to compare/remove file ${path.basename(copilotFile.targetPath)}: ${err}`);
                        }
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

    /**
     * Get the Copilot skills directory
     * Skills are stored in ~/.copilot/skills (user-level) following the Agent Skills specification
     * https://code.visualstudio.com/docs/copilot/customization/agent-skills
     * 
     * @param scope - Installation scope ('user' or 'workspace')
     * @returns Path to the skills directory
     */
    getCopilotSkillsDirectory(scope: 'user' | 'workspace' = 'user'): string {
        if (scope === 'workspace') {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                throw new Error('No workspace folder open. Skills require an open workspace for workspace scope.');
            }
            return path.join(workspaceFolders[0].uri.fsPath, '.copilot', 'skills');
        }
        
        // User-level skills go to ~/.copilot/skills
        return path.join(os.homedir(), '.copilot', 'skills');
    }

    /**
     * Get the Claude skills directory (alternative location)
     * Some users may prefer ~/.claude/skills
     * 
     * @param scope - Installation scope ('user' or 'workspace')
     * @returns Path to the Claude skills directory
     */
    getClaudeSkillsDirectory(scope: 'user' | 'workspace' = 'user'): string {
        if (scope === 'workspace') {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                throw new Error('No workspace folder open. Skills require an open workspace for workspace scope.');
            }
            return path.join(workspaceFolders[0].uri.fsPath, '.claude', 'skills');
        }
        
        // User-level skills go to ~/.claude/skills
        return path.join(os.homedir(), '.claude', 'skills');
    }

    /**
     * Sync a skill directory to the Copilot skills location
     * Skills are directories containing SKILL.md and optional scripts/, references/, assets/ subdirectories
     * 
     * @param skillName - Name of the skill (directory name)
     * @param sourceDir - Source directory containing the skill files
     * @param scope - Installation scope ('user' or 'workspace')
     * @param syncToClaude - Also sync to ~/.claude/skills
     */
    async syncSkill(skillName: string, sourceDir: string, scope: 'user' | 'workspace' = 'user', syncToClaude: boolean = false): Promise<void> {
        try {
            this.logger.info(`Syncing skill: ${skillName} (scope: ${scope})`);
            
            // Get target skills directory
            const skillsDir = this.getCopilotSkillsDirectory(scope);
            await this.ensureDirectory(skillsDir);
            
            const targetDir = path.join(skillsDir, skillName);
            
            // Remove existing skill if present
            if (fs.existsSync(targetDir)) {
                await this.removeSkillDirectory(targetDir);
            }
            
            // Copy skill directory recursively
            await this.copySkillDirectory(sourceDir, targetDir);
            
            this.logger.info(`✅ Synced skill to: ${targetDir}`);
            
            // Optionally sync to Claude location too
            if (syncToClaude) {
                const claudeSkillsDir = this.getClaudeSkillsDirectory(scope);
                await this.ensureDirectory(claudeSkillsDir);
                const claudeTargetDir = path.join(claudeSkillsDir, skillName);
                
                if (fs.existsSync(claudeTargetDir)) {
                    await this.removeSkillDirectory(claudeTargetDir);
                }
                
                await this.copySkillDirectory(sourceDir, claudeTargetDir);
                this.logger.info(`✅ Also synced skill to Claude: ${claudeTargetDir}`);
            }
            
        } catch (error) {
            this.logger.error(`Failed to sync skill ${skillName}`, error as Error);
            throw error;
        }
    }

    /**
     * Remove a synced skill
     * 
     * @param skillName - Name of the skill to remove
     * @param scope - Installation scope
     * @param removeFromClaude - Also remove from ~/.claude/skills
     */
    async unsyncSkill(skillName: string, scope: 'user' | 'workspace' = 'user', removeFromClaude: boolean = false): Promise<void> {
        try {
            this.logger.info(`Removing skill: ${skillName}`);
            
            const skillsDir = this.getCopilotSkillsDirectory(scope);
            const targetDir = path.join(skillsDir, skillName);
            
            if (fs.existsSync(targetDir)) {
                await this.removeSkillDirectory(targetDir);
                this.logger.info(`✅ Removed skill from: ${targetDir}`);
            }
            
            if (removeFromClaude) {
                const claudeSkillsDir = this.getClaudeSkillsDirectory(scope);
                const claudeTargetDir = path.join(claudeSkillsDir, skillName);
                
                if (fs.existsSync(claudeTargetDir)) {
                    await this.removeSkillDirectory(claudeTargetDir);
                    this.logger.info(`✅ Also removed skill from Claude: ${claudeTargetDir}`);
                }
            }
            
        } catch (error) {
            this.logger.error(`Failed to remove skill ${skillName}`, error as Error);
        }
    }

    /**
     * Copy skill directory recursively
     */
    private async copySkillDirectory(sourceDir: string, targetDir: string): Promise<void> {
        await this.ensureDirectory(targetDir);
        
        const entries = await readdir(sourceDir);
        
        for (const entry of entries) {
            const sourcePath = path.join(sourceDir, entry);
            const targetPath = path.join(targetDir, entry);
            
            const stats = fs.statSync(sourcePath);
            
            if (stats.isDirectory()) {
                await this.copySkillDirectory(sourcePath, targetPath);
            } else {
                const fileContent = await readFile(sourcePath);
                await writeFile(targetPath, fileContent);
            }
        }
    }

    /**
     * Remove skill directory recursively
     */
    private async removeSkillDirectory(dir: string): Promise<void> {
        if (!fs.existsSync(dir)) {
            return;
        }
        
        const entries = await readdir(dir);
        
        for (const entry of entries) {
            const entryPath = path.join(dir, entry);
            const stats = await lstat(entryPath);
            
            if (stats.isSymbolicLink()) {
                await unlink(entryPath);
            } else if (stats.isDirectory()) {
                await this.removeSkillDirectory(entryPath);
            } else {
                await unlink(entryPath);
            }
        }
        
        fs.rmdirSync(dir);
    }

    /**
     * Get skills status
     */
    async getSkillsStatus(scope: 'user' | 'workspace' = 'user'): Promise<{
        skillsDir: string;
        dirExists: boolean;
        skills: string[];
    }> {
        const skillsDir = this.getCopilotSkillsDirectory(scope);
        const status = {
            skillsDir,
            dirExists: fs.existsSync(skillsDir),
            skills: [] as string[]
        };
        
        if (status.dirExists) {
            const entries = await readdir(skillsDir);
            
            for (const entry of entries) {
                const entryPath = path.join(skillsDir, entry);
                const entryStats = fs.statSync(entryPath);
                
                // Skills are directories containing SKILL.md
                if (entryStats.isDirectory()) {
                    const skillMdPath = path.join(entryPath, 'SKILL.md');
                    if (fs.existsSync(skillMdPath)) {
                        status.skills.push(entry);
                    }
                }
            }
        }
        
        return status;
    }
}
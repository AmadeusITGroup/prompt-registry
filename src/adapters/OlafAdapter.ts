/**
 * OLAF repository adapter
 * Handles GitHub repositories containing AI skills in .olaf/core/skills structure
 */

import { RepositoryAdapter } from './RepositoryAdapter';
import { GitHubAdapter } from './GitHubAdapter';
import { Bundle, ValidationResult, RegistrySource, SourceMetadata, BundleDependency } from '../types/registry';
import { SkillManifest, SkillInfo, OlafRepositoryInfo } from '../types/olaf';
import { Logger } from '../utils/logger';
import { OlafRuntimeManager } from '../services/OlafRuntimeManager';
import * as vscode from 'vscode';

/**
 * GitHub API response types for OLAF-specific operations
 */
interface GitHubDirectoryContent {
    name: string;
    path: string;
    type: 'file' | 'dir';
    download_url: string | null;
    url: string;
}

/**
 * OLAF adapter implementation using GitHub functionality via composition
 * Discovers and packages AI skills from .olaf/core/skills directory structure
 */
export class OlafAdapter extends RepositoryAdapter {
    readonly type = 'olaf';
    private logger: Logger;
    private githubAdapter: GitHubAdapter;
    private runtimeManager: OlafRuntimeManager;

    constructor(source: RegistrySource) {
        super(source);
        this.logger = Logger.getInstance();
        this.runtimeManager = OlafRuntimeManager.getInstance();
        
        if (!this.isValidGitHubUrl(source.url)) {
            throw new Error(`Invalid GitHub URL for OLAF source: ${source.url}`);
        }
        
        // Create GitHub adapter for reusing GitHub functionality
        this.githubAdapter = new GitHubAdapter(source);
    }

    /**
     * Validate GitHub URL (reuse parent implementation)
     */
    private isValidGitHubUrl(url: string): boolean {
        // HTTPS format: https://github.com/owner/repo
        if (url.startsWith('https://')) {
            return url.includes('github.com');
        }
        // SSH format: git@github.com:owner/repo.git
        if (url.startsWith('git@')) {
            return url.includes('github.com:');
        }
        return false;
    }

    /**
     * Parse GitHub URL to extract owner and repo (reuse parent logic)
     */
    private parseGitHubUrl(): { owner: string; repo: string } {
        const url = this.source.url.replace(/\.git$/, '');
        const match = url.match(/github\.com[/:]([^/]+)\/([^/]+)/);
        
        if (!match) {
            throw new Error(`Invalid GitHub URL format: ${this.source.url}`);
        }

        return {
            owner: match[1],
            repo: match[2],
        };
    }

    /**
     * Override fetchBundles to implement OLAF-specific skill discovery
     * Scans .olaf/core/skills directory and converts skills to bundles
     */
    async fetchBundles(): Promise<Bundle[]> {
        this.logger.info(`[OlafAdapter] Fetching skills from OLAF repository: ${this.source.url}`);
        
        try {
            // Discover skills in the repository
            const skills = await this.scanSkillsDirectory();
            this.logger.info(`[OlafAdapter] Found ${skills.length} skills in repository`);
            
            // Convert skills to bundles
            const bundles: Bundle[] = [];
            for (const skill of skills) {
                try {
                    const bundle = this.createBundleFromSkill(skill);
                    bundles.push(bundle);
                    this.logger.debug(`[OlafAdapter] Created bundle for skill: ${skill.id}`);
                } catch (error) {
                    this.logger.warn(`[OlafAdapter] Failed to create bundle for skill ${skill.id}: ${error}`);
                    // Continue processing other skills
                }
            }
            
            this.logger.info(`[OlafAdapter] Successfully created ${bundles.length} bundles from skills`);
            return bundles;
            
        } catch (error) {
            this.logger.error(`[OlafAdapter] Failed to fetch bundles: ${error}`);
            throw new Error(`Failed to fetch OLAF skills: ${error}`);
        }
    }

    /**
     * Validate OLAF repository structure
     * Checks for .olaf/core/skills directory and validates accessibility
     */
    async validate(): Promise<ValidationResult> {
        this.logger.info(`[OlafAdapter] Validating OLAF repository: ${this.source.url}`);
        
        try {
            const { owner, repo } = this.parseGitHubUrl();
            
            // First validate basic GitHub repository access
            const baseValidation = await this.githubAdapter.validate();
            if (!baseValidation.valid) {
                return baseValidation;
            }
            
            // Check for OLAF-specific structure
            const apiBase = 'https://api.github.com';
            const skillsPath = '.olaf/core/skills';
            const url = `${apiBase}/repos/${owner}/${repo}/contents/${skillsPath}`;
            
            try {
                await this.makeGitHubRequest(url);
                
                // Try to discover skills
                const skills = await this.scanSkillsDirectory();
                
                return {
                    valid: true,
                    errors: [],
                    warnings: skills.length === 0 ? ['No valid skills found in .olaf/core/skills directory'] : [],
                    bundlesFound: skills.length,
                };
                
            } catch (error) {
                // Check if it's a 404 (missing directory) vs other errors
                if (error instanceof Error && error.message.includes('404')) {
                    return {
                        valid: false,
                        errors: [`Repository does not contain required .olaf/core/skills directory structure`],
                        warnings: [],
                        bundlesFound: 0,
                    };
                }
                
                // Other errors (auth, network, etc.)
                return {
                    valid: false,
                    errors: [`Failed to validate OLAF repository structure: ${error}`],
                    warnings: [],
                    bundlesFound: 0,
                };
            }
            
        } catch (error) {
            return {
                valid: false,
                errors: [`OLAF repository validation failed: ${error}`],
                warnings: [],
                bundlesFound: 0,
            };
        }
    }

    /**
     * Fetch a single skill by name (optimized for downloadBundle)
     * Only fetches and parses the specific skill needed
     */
    private async fetchSingleSkill(skillName: string, skillPath: string, owner: string, repo: string): Promise<SkillInfo | null> {
        this.logger.debug(`[OlafAdapter] Fetching single skill: ${skillName}`);
        
        try {
            const skillDir: GitHubDirectoryContent = {
                name: skillName,
                path: skillPath,
                type: 'dir',
                download_url: null,
                url: `https://api.github.com/repos/${owner}/${repo}/contents/${skillPath}`
            };
            
            const skill = await this.processSkillDirectory(skillDir, owner, repo);
            return skill;
        } catch (error) {
            this.logger.error(`[OlafAdapter] Failed to fetch skill ${skillName}: ${error}`);
            return null;
        }
    }

    /**
     * Scan .olaf/core/skills directory for skills
     * Discovers skill folders and parses their manifests
     */
    private async scanSkillsDirectory(): Promise<SkillInfo[]> {
        const { owner, repo } = this.parseGitHubUrl();
        const apiBase = 'https://api.github.com';
        const skillsPath = '.olaf/core/skills';
        const url = `${apiBase}/repos/${owner}/${repo}/contents/${skillsPath}`;
        
        this.logger.debug(`[OlafAdapter] Scanning skills directory: ${url}`);
        
        try {
            const contents: GitHubDirectoryContent[] = await this.makeGitHubRequest(url);
            const skills: SkillInfo[] = [];
            
            // Filter for directories only
            const skillDirectories = contents.filter(item => item.type === 'dir');
            this.logger.debug(`[OlafAdapter] Found ${skillDirectories.length} potential skill directories`);
            
            // Process each skill directory
            for (const skillDir of skillDirectories) {
                try {
                    const skillInfo = await this.processSkillDirectory(skillDir, owner, repo);
                    if (skillInfo) {
                        skills.push(skillInfo);
                        this.logger.debug(`[OlafAdapter] Successfully processed skill: ${skillInfo.id}`);
                    }
                } catch (error) {
                    this.logger.warn(`[OlafAdapter] Failed to process skill directory ${skillDir.name}: ${error}`);
                    // Continue processing other skills
                }
            }
            
            this.logger.info(`[OlafAdapter] Successfully discovered ${skills.length} valid skills`);
            return skills;
            
        } catch (error) {
            this.logger.error(`[OlafAdapter] Failed to scan skills directory: ${error}`);
            throw new Error(`Failed to scan .olaf/core/skills directory: ${error}`);
        }
    }

    /**
     * Process a single skill directory
     * Validates structure and parses manifest
     */
    private async processSkillDirectory(skillDir: GitHubDirectoryContent, owner: string, repo: string): Promise<SkillInfo | null> {
        const skillPath = skillDir.path;
        const skillName = skillDir.name;
        
        this.logger.debug(`[OlafAdapter] Processing skill directory: ${skillName}`);
        
        try {
            // Get contents of the skill directory
            const apiBase = 'https://api.github.com';
            const skillContentsUrl = `${apiBase}/repos/${owner}/${repo}/contents/${skillPath}`;
            const skillContents: GitHubDirectoryContent[] = await this.makeGitHubRequest(skillContentsUrl);
            
            // Look for skill-manifest.json
            const manifestFile = skillContents.find(file => 
                file.name === 'skill-manifest.json' && file.type === 'file'
            );
            
            if (!manifestFile) {
                this.logger.warn(`[OlafAdapter] Skill ${skillName} missing skill-manifest.json, skipping`);
                return null;
            }
            
            // Parse the manifest (pass skill name as fallback)
            const manifest = await this.parseSkillManifest(manifestFile.download_url!, skillName);
            
            // Get list of all files in the skill directory
            const files = skillContents
                .filter(item => item.type === 'file')
                .map(item => item.name);
            
            // Create SkillInfo object
            const skillInfo: SkillInfo = {
                id: `olaf-${owner}-${repo}-${skillName}`,
                folderName: skillName,
                path: skillPath,
                manifest,
                files,
            };
            
            return skillInfo;
            
        } catch (error) {
            this.logger.error(`[OlafAdapter] Error processing skill ${skillName}: ${error}`);
            throw error;
        }
    }

    /**
     * Parse skill manifest from skill folder
     * Handles missing or invalid manifests gracefully
     */
    private async parseSkillManifest(manifestUrl: string, skillFolderName?: string): Promise<SkillManifest> {
        this.logger.debug(`[OlafAdapter] Parsing skill manifest from: ${manifestUrl}`);
        
        try {
            // Download manifest content
            const manifestContent = await this.downloadManifestContent(manifestUrl);
            const manifestText = manifestContent.toString('utf-8');
            
            this.logger.debug(`[OlafAdapter] Downloaded manifest content (${manifestContent.length} bytes): ${manifestText.substring(0, 200)}...`);
            
            // Parse JSON
            const rawManifest = JSON.parse(manifestText);
            
            this.logger.debug(`[OlafAdapter] Parsed raw manifest:`, rawManifest);
            
            // Validate and normalize manifest
            // Use skill folder name as fallback if manifest name is missing
            const manifest: SkillManifest = {
                name: rawManifest.name || skillFolderName || 'Unnamed Skill',
                version: rawManifest.version || '1.0.0',
                description: rawManifest.description || 'OLAF Skill',
                author: rawManifest.author,
                tags: Array.isArray(rawManifest.tags) ? rawManifest.tags : ['olaf', 'skill'],
                dependencies: Array.isArray(rawManifest.dependencies) ? rawManifest.dependencies : [],
                license: rawManifest.license || 'Unknown',
                // Include any additional properties
                ...rawManifest,
            };
            
            this.logger.debug(`[OlafAdapter] Successfully parsed manifest for skill: ${manifest.name}`);
            return manifest;
            
        } catch (error) {
            this.logger.error(`[OlafAdapter] Failed to parse skill manifest from ${manifestUrl}: ${error}`);
            
            // Return default manifest on parse failure - use folder name as fallback
            const defaultManifest: SkillManifest = {
                name: skillFolderName || 'Unnamed Skill',
                version: '1.0.0',
                description: 'OLAF Skill (manifest parse failed)',
                tags: ['olaf', 'skill'],
                dependencies: [],
                license: 'Unknown',
            };
            
            this.logger.warn(`[OlafAdapter] Using default manifest with name '${defaultManifest.name}' due to parse failure`);
            return defaultManifest;
        }
    }

    /**
     * Download manifest content from GitHub
     * Handles authentication and error cases
     */
    private async downloadManifestContent(url: string): Promise<Buffer> {
        const https = require('https');
        
        return new Promise((resolve, reject) => {
            const headers: Record<string, string> = {
                'User-Agent': 'Prompt-Registry-VSCode-Extension',
                'Accept': 'application/json',
            };
            
            // Add authentication if available
            const token = this.getAuthToken();
            if (token) {
                headers.Authorization = `token ${token}`;
            }
            
            https.get(url, { headers }, (res: any) => {
                const chunks: Buffer[] = [];
                
                res.on('data', (chunk: Buffer) => {
                    chunks.push(chunk);
                });
                
                res.on('end', () => {
                    if (res.statusCode >= 400) {
                        reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
                        return;
                    }
                    resolve(Buffer.concat(chunks));
                });
            }).on('error', (error: any) => {
                reject(new Error(`Download failed: ${error.message}`));
            });
        });
    }

    /**
     * Create Bundle object from SkillInfo
     * Maps skill manifest properties to bundle properties with defaults
     */
    private createBundleFromSkill(skill: SkillInfo): Bundle {
        const { owner, repo } = this.parseGitHubUrl();
        const manifest = skill.manifest;
        
        // Generate unique bundle ID using format: olaf-{owner}-{repo}-{skillName}
        const bundleId = skill.id; // Already in correct format from SkillInfo
        
        // Map skill manifest properties to bundle properties with defaults
        // Use folder name if manifest name is missing, empty, or is a default fallback
        const skillName = (manifest.name && 
                          manifest.name.trim() !== '' && 
                          manifest.name !== 'Unknown Skill' && 
                          manifest.name !== 'Unnamed Skill') 
            ? manifest.name 
            : skill.folderName;
            
        const bundle: Bundle = {
            id: bundleId,
            name: skillName,
            version: manifest.version || '1.0.0',
            description: manifest.description || 'OLAF Skill',
            author: manifest.author || owner,
            sourceId: this.source.id,
            environments: ['vscode', 'kiro', 'windsurf'], // OLAF skills work across IDEs
            tags: this.normalizeTags(manifest.tags),
            lastUpdated: new Date().toISOString(), // We don't have git commit info, use current time
            size: this.estimateSkillSize(skill.files),
            dependencies: this.normalizeDependencies(manifest.dependencies),
            license: manifest.license || 'Unknown',
            repository: this.source.url,
            homepage: `https://github.com/${owner}/${repo}/tree/main/.olaf/core/skills/${skill.folderName}`,
            
            // OLAF-specific URLs
            manifestUrl: this.getManifestUrl(bundleId),
            downloadUrl: this.getDownloadUrl(bundleId),
        };
        
        this.logger.debug(`[OlafAdapter] Created bundle: ${bundle.id} (${bundle.name} v${bundle.version})`);
        return bundle;
    }

    /**
     * Normalize tags from skill manifest
     * Ensures 'olaf' and 'skill' tags are always present
     */
    private normalizeTags(manifestTags?: string[]): string[] {
        const baseTags = ['olaf', 'skill'];
        
        if (!manifestTags || !Array.isArray(manifestTags)) {
            return baseTags;
        }
        
        // Combine manifest tags with base tags, removing duplicates
        const allTags = [...baseTags, ...manifestTags];
        return Array.from(new Set(allTags.map(tag => tag.toLowerCase())));
    }

    /**
     * Normalize dependencies from skill manifest
     * Converts string array to BundleDependency array
     */
    private normalizeDependencies(manifestDependencies?: string[]): BundleDependency[] {
        if (!manifestDependencies || !Array.isArray(manifestDependencies)) {
            return [];
        }
        
        // For now, return as simple dependency objects
        // In the future, this could be enhanced to parse version ranges
        return manifestDependencies.map(dep => ({
            bundleId: dep,
            versionRange: '*',
            optional: false,
        }));
    }

    /**
     * Estimate skill size based on file count
     * Provides a rough size estimate since we don't have actual file sizes
     */
    private estimateSkillSize(files: string[]): string {
        // Rough estimation: assume average file size and add manifest overhead
        const estimatedBytes = files.length * 2048; // 2KB average per file
        
        if (estimatedBytes < 1024) {
            return `${estimatedBytes} B`;
        }
        if (estimatedBytes < 1024 * 1024) {
            return `${(estimatedBytes / 1024).toFixed(1)} KB`;
        }
        return `${(estimatedBytes / (1024 * 1024)).toFixed(1)} MB`;
    }

    /**
     * Generate deployment manifest for a skill
     * Maps skill files to bundle structure with proper paths
     */
    private generateDeploymentManifest(skill: SkillInfo): any {
        const { owner, repo } = this.parseGitHubUrl();
        const manifest = skill.manifest;
        
        // Create deployment manifest structure with required root-level fields
        const deploymentManifest = {
            // Required root-level fields for BundleInstaller validation
            id: skill.id,
            version: manifest.version || '1.0.0',
            name: manifest.name || skill.folderName,
            
            metadata: {
                manifest_version: "1.0",
                description: `OLAF Skill: ${manifest.name || skill.folderName}`,
                author: manifest.author || owner,
                last_updated: new Date().toISOString(),
                repository: {
                    type: "git",
                    url: this.source.url,
                    directory: skill.path
                },
                license: manifest.license || 'Unknown',
                keywords: this.normalizeTags(manifest.tags)
            },
            
            common: {
                directories: [skill.folderName],
                files: [],
                include_patterns: ["**/*"],
                exclude_patterns: []
            },
            
            bundle_settings: {
                include_common_in_environment_bundles: true,
                create_common_bundle: true,
                compression: "zip" as any,
                naming: {
                    common_bundle: skill.folderName
                }
            },
            
            prompts: [
                {
                    id: skill.id,
                    name: manifest.name || skill.folderName,
                    description: manifest.description || 'OLAF Skill',
                    file: `${skill.folderName}/skill-manifest.json`,
                    type: "agent",
                    tags: this.normalizeTags(manifest.tags)
                }
            ]
        };
        
        this.logger.debug(`[OlafAdapter] Generated deployment manifest for skill: ${skill.id}`);
        return deploymentManifest;
    }

    /**
     * Download a bundle (skill) from the OLAF repository
     * Creates ZIP from individual skill folder using GitHub API
     * Ensures OLAF runtime is installed before skill installation
     */
    async downloadBundle(bundle: Bundle): Promise<Buffer> {
        const { owner, repo } = this.parseGitHubUrl();
        
        // Extract skill name from bundle ID (format: olaf-{owner}-{repo}-{skillName})
        const skillName = bundle.id.replace(`olaf-${owner}-${repo}-`, '');
        
        this.logger.info(`[OlafAdapter] Downloading skill bundle: ${skillName}`);
        
        try {
            // Ensure OLAF runtime is installed before skill installation
            await this.ensureRuntimeInstalled();
            
            // Directly fetch the specific skill instead of scanning all skills
            const skillPath = `.olaf/core/skills/${skillName}`;
            const skill = await this.fetchSingleSkill(skillName, skillPath, owner, repo);
            
            if (!skill) {
                throw new Error(`Skill not found: ${skillName}`);
            }
            
            // Package skill as ZIP bundle
            const zipBuffer = await this.packageSkillAsBundle(skill);
            
            this.logger.info(`[OlafAdapter] Successfully packaged skill ${skillName} (${zipBuffer.length} bytes)`);
            return zipBuffer;
            
        } catch (error) {
            this.logger.error(`[OlafAdapter] Failed to download skill bundle ${skillName}: ${error}`);
            throw new Error(`Failed to download OLAF skill ${skillName}: ${error}`);
        }
    }

    /**
     * Ensure OLAF runtime is installed and create workspace links
     * Runtime installation is REQUIRED for OLAF skills to function
     */
    private async ensureRuntimeInstalled(): Promise<void> {
        try {
            this.logger.info('[OlafAdapter] Ensuring OLAF runtime is installed (required for OLAF skills)');
            
            // Get current workspace path
            const workspacePath = this.getCurrentWorkspacePath();
            
            // Ensure runtime is installed - this is REQUIRED
            const runtimeInstalled = await this.runtimeManager.ensureRuntimeInstalled(workspacePath);
            
            if (!runtimeInstalled) {
                throw new Error('Failed to install OLAF runtime - OLAF skills cannot function without the runtime');
            }
            
            // Create workspace symbolic links if we have a workspace
            if (workspacePath) {
                const hasLinks = await this.runtimeManager.hasWorkspaceLinks(workspacePath);
                
                if (!hasLinks) {
                    this.logger.info('[OlafAdapter] Creating workspace symbolic links');
                    await this.runtimeManager.createWorkspaceLinks(workspacePath);
                } else {
                    this.logger.debug('[OlafAdapter] Workspace links already exist');
                }
            } else {
                this.logger.warn('[OlafAdapter] No workspace detected, skipping symbolic link creation');
            }
            
            this.logger.info('[OlafAdapter] OLAF runtime setup completed successfully');
            
        } catch (error) {
            this.logger.error(`[OlafAdapter] Runtime installation failed: ${error}`);
            
            // Provide user-friendly error message and fail the installation
            if (error instanceof Error) {
                if (error.message.includes('network') || error.message.includes('download')) {
                    throw new Error('Failed to download OLAF runtime. Please check your internet connection and try again.');
                } else if (error.message.includes('permission') || error.message.includes('EPERM')) {
                    throw new Error('Permission denied while installing OLAF runtime. Please check file permissions.');
                } else if (error.message.includes('space') || error.message.includes('ENOSPC')) {
                    throw new Error('Insufficient disk space to install OLAF runtime.');
                } else if (error.message.includes('GitHub API request failed')) {
                    throw new Error('Failed to access OLAF runtime repository. The repository may not exist or may be private.');
                } else {
                    throw new Error(`OLAF runtime installation failed: ${error.message}`);
                }
            } else {
                throw new Error('OLAF runtime installation failed with unknown error');
            }
        }
    }

    /**
     * Get current workspace path from VSCode API
     */
    private getCurrentWorkspacePath(): string | undefined {
        try {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (workspaceFolders && workspaceFolders.length > 0) {
                return workspaceFolders[0].uri.fsPath;
            }
            return undefined;
        } catch (error) {
            this.logger.warn(`[OlafAdapter] Failed to get workspace path: ${error}`);
            return undefined;
        }
    }

    /**
     * Package a skill as a ZIP bundle
     * Downloads all files within the skill folder and creates in-memory ZIP
     */
    private async packageSkillAsBundle(skill: SkillInfo): Promise<Buffer> {
        const { owner, repo } = this.parseGitHubUrl();
        const AdmZip = require('adm-zip');
        
        this.logger.debug(`[OlafAdapter] Packaging skill as bundle: ${skill.folderName}`);
        
        try {
            // Create new ZIP archive
            const zip = new AdmZip();
            
            // Generate and add deployment manifest
            const deploymentManifest = this.generateDeploymentManifest(skill);
            const manifestYaml = require('js-yaml').dump(deploymentManifest);
            zip.addFile('deployment-manifest.yml', Buffer.from(manifestYaml, 'utf8'));
            
            // Get all files in the skill directory
            const apiBase = 'https://api.github.com';
            const skillContentsUrl = `${apiBase}/repos/${owner}/${repo}/contents/${skill.path}`;
            const skillContents: GitHubDirectoryContent[] = await this.makeGitHubRequest(skillContentsUrl);
            
            // Download and add each file to the ZIP
            for (const item of skillContents) {
                if (item.type === 'file' && item.download_url) {
                    try {
                        const fileContent = await this.downloadFileContent(item.download_url);
                        const filePath = `${skill.folderName}/${item.name}`;
                        zip.addFile(filePath, fileContent);
                        
                        this.logger.debug(`[OlafAdapter] Added file to ZIP: ${filePath} (${fileContent.length} bytes)`);
                    } catch (error) {
                        this.logger.warn(`[OlafAdapter] Failed to download file ${item.name}: ${error}`);
                        // Continue with other files
                    }
                } else if (item.type === 'dir') {
                    // Recursively handle subdirectories
                    await this.addDirectoryToZip(zip, owner, repo, item.path, `${skill.folderName}/${item.name}`);
                }
            }
            
            // Generate ZIP buffer
            const zipBuffer = zip.toBuffer();
            
            this.logger.debug(`[OlafAdapter] Created ZIP bundle for ${skill.folderName}: ${zipBuffer.length} bytes`);
            return zipBuffer;
            
        } catch (error) {
            this.logger.error(`[OlafAdapter] Failed to package skill ${skill.folderName}: ${error}`);
            throw new Error(`Failed to package skill as ZIP: ${error}`);
        }
    }

    /**
     * Recursively add directory contents to ZIP archive
     */
    private async addDirectoryToZip(zip: any, owner: string, repo: string, dirPath: string, zipPath: string): Promise<void> {
        try {
            const apiBase = 'https://api.github.com';
            const dirContentsUrl = `${apiBase}/repos/${owner}/${repo}/contents/${dirPath}`;
            const dirContents: GitHubDirectoryContent[] = await this.makeGitHubRequest(dirContentsUrl);
            
            for (const item of dirContents) {
                if (item.type === 'file' && item.download_url) {
                    try {
                        const fileContent = await this.downloadFileContent(item.download_url);
                        const filePath = `${zipPath}/${item.name}`;
                        zip.addFile(filePath, fileContent);
                        
                        this.logger.debug(`[OlafAdapter] Added nested file to ZIP: ${filePath}`);
                    } catch (error) {
                        this.logger.warn(`[OlafAdapter] Failed to download nested file ${item.name}: ${error}`);
                    }
                } else if (item.type === 'dir') {
                    // Recursively handle nested directories
                    await this.addDirectoryToZip(zip, owner, repo, item.path, `${zipPath}/${item.name}`);
                }
            }
        } catch (error) {
            this.logger.warn(`[OlafAdapter] Failed to process directory ${dirPath}: ${error}`);
        }
    }

    /**
     * Download file content from GitHub
     */
    private async downloadFileContent(url: string): Promise<Buffer> {
        const https = require('https');
        
        return new Promise((resolve, reject) => {
            const headers: Record<string, string> = {
                'User-Agent': 'Prompt-Registry-VSCode-Extension',
            };
            
            // Add authentication if available
            const token = this.getAuthToken();
            if (token) {
                headers.Authorization = `token ${token}`;
            }
            
            https.get(url, { headers }, (res: any) => {
                const chunks: Buffer[] = [];
                
                res.on('data', (chunk: Buffer) => {
                    chunks.push(chunk);
                });
                
                res.on('end', () => {
                    if (res.statusCode >= 400) {
                        reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
                        return;
                    }
                    resolve(Buffer.concat(chunks));
                });
            }).on('error', (error: any) => {
                reject(new Error(`Download failed: ${error.message}`));
            });
        });
    }

    /**
     * Fetch metadata about the OLAF repository
     * Delegates to GitHub adapter and adds OLAF-specific information
     */
    async fetchMetadata(): Promise<SourceMetadata> {
        try {
            const githubMetadata = await this.githubAdapter.fetchMetadata();
            const skills = await this.scanSkillsDirectory();
            
            return {
                ...githubMetadata,
                name: `${githubMetadata.name} (OLAF Skills)`,
                description: `OLAF repository with ${skills.length} AI skills`,
                bundleCount: skills.length,
            };
        } catch (error) {
            throw new Error(`Failed to fetch OLAF metadata: ${error}`);
        }
    }

    /**
     * Get manifest URL for a skill bundle
     * OLAF skills don't have separate manifest URLs - they're embedded in the skill
     */
    getManifestUrl(bundleId: string, version?: string): string {
        const { owner, repo } = this.parseGitHubUrl();
        // Extract skill name from bundle ID (format: olaf-{owner}-{repo}-{skillName})
        const skillName = bundleId.replace(`olaf-${owner}-${repo}-`, '');
        return `https://api.github.com/repos/${owner}/${repo}/contents/.olaf/core/skills/${skillName}/skill-manifest.json`;
    }

    /**
     * Get download URL for a skill bundle
     * OLAF skills are packaged dynamically from the skill folder
     */
    getDownloadUrl(bundleId: string, version?: string): string {
        const { owner, repo } = this.parseGitHubUrl();
        // Extract skill name from bundle ID (format: olaf-{owner}-{repo}-{skillName})
        const skillName = bundleId.replace(`olaf-${owner}-${repo}-`, '');
        return `https://api.github.com/repos/${owner}/${repo}/contents/.olaf/core/skills/${skillName}`;
    }

    /**
     * Post-installation hook for OLAF skills
     * Registers the skill in the competency index after successful installation
     */
    async postInstall(bundleId: string, installPath: string): Promise<void> {
        this.logger.info(`[OlafAdapter] Running post-installation for skill: ${bundleId}`);
        
        try {
            await this.registerSkillInCompetencyIndex(bundleId, installPath);
            this.logger.info(`[OlafAdapter] Post-installation completed successfully`);
        } catch (error) {
            this.logger.error(`[OlafAdapter] Post-installation failed: ${error}`);
            // Don't throw - post-installation failures shouldn't break the installation
        }
    }

    /**
     * Post-uninstallation hook for OLAF skills
     * Removes the skill from the competency index after successful uninstallation
     */
    async postUninstall(bundleId: string, installPath: string): Promise<void> {
        this.logger.info(`[OlafAdapter] Running post-uninstallation for skill: ${bundleId}`);
        
        try {
            await this.unregisterSkillFromCompetencyIndex(bundleId, installPath);
            this.logger.info(`[OlafAdapter] Post-uninstallation completed successfully`);
        } catch (error) {
            this.logger.error(`[OlafAdapter] Post-uninstallation failed: ${error}`);
            // Don't throw - post-uninstallation failures shouldn't break the uninstallation
        }
    }

    /**
     * Register OLAF skill in competency index
     * Updates .olaf/olaf-core/reference/competency-index.json with skill information
     */
    private async registerSkillInCompetencyIndex(bundleId: string, installPath: string): Promise<void> {
        this.logger.info(`[OlafAdapter] Registering skill in competency index: ${bundleId}`);
        this.logger.info(`[OlafAdapter] Install path: ${installPath}`);
        
        try {
            const fs = require('fs');
            const path = require('path');
            
            // Get workspace path
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                this.logger.warn('[OlafAdapter] No workspace found, skipping competency index registration');
                return;
            }
            
            const workspacePath = workspaceFolders[0].uri.fsPath;
            this.logger.info(`[OlafAdapter] Workspace path: ${workspacePath}`);
            
            const competencyIndexPath = path.join(workspacePath, '.olaf', 'olaf-core', 'reference', 'competency-index.json');
            this.logger.info(`[OlafAdapter] Competency index path: ${competencyIndexPath}`);
            
            // Ensure the directory exists
            const competencyIndexDir = path.dirname(competencyIndexPath);
            this.logger.info(`[OlafAdapter] Creating directory if needed: ${competencyIndexDir}`);
            
            if (!fs.existsSync(competencyIndexDir)) {
                this.logger.info(`[OlafAdapter] Directory does not exist, creating: ${competencyIndexDir}`);
                fs.mkdirSync(competencyIndexDir, { recursive: true });
                this.logger.info(`[OlafAdapter] Directory created successfully`);
            } else {
                this.logger.info(`[OlafAdapter] Directory already exists`);
            }
            
            // Read existing competency index or create new one
            let competencyIndex: any[] = [];
            if (fs.existsSync(competencyIndexPath)) {
                this.logger.info(`[OlafAdapter] Reading existing competency index`);
                const content = fs.readFileSync(competencyIndexPath, 'utf-8');
                const parsed = JSON.parse(content);
                
                // Handle both array format and legacy object format
                if (Array.isArray(parsed)) {
                    competencyIndex = parsed;
                    this.logger.info(`[OlafAdapter] Found ${competencyIndex.length} existing skills`);
                } else if (parsed.skills && Array.isArray(parsed.skills)) {
                    // Legacy format with skills property - migrate to flat array
                    competencyIndex = parsed.skills;
                    this.logger.info(`[OlafAdapter] Found legacy format, migrating ${competencyIndex.length} existing skills`);
                } else {
                    this.logger.warn(`[OlafAdapter] Invalid competency index format, creating new array`);
                    competencyIndex = [];
                }
            } else {
                this.logger.info(`[OlafAdapter] Competency index does not exist, will create new one`);
            }
            
            // Read skill manifest from installation path
            const skillManifestPath = path.join(installPath, 'skill-manifest.json');
            this.logger.info(`[OlafAdapter] Looking for skill manifest at: ${skillManifestPath}`);
            
            if (!fs.existsSync(skillManifestPath)) {
                this.logger.error(`[OlafAdapter] Skill manifest not found at ${skillManifestPath}`);
                
                // List files in install path for debugging
                try {
                    const files = fs.readdirSync(installPath);
                    this.logger.info(`[OlafAdapter] Files in install path: ${files.join(', ')}`);
                } catch (listError) {
                    this.logger.error(`[OlafAdapter] Could not list files in install path: ${listError}`);
                }
                
                this.logger.warn(`[OlafAdapter] Skipping competency index registration due to missing manifest`);
                return;
            }
            
            this.logger.info(`[OlafAdapter] Reading skill manifest`);
            const skillManifestContent = fs.readFileSync(skillManifestPath, 'utf-8');
            const skillManifest = JSON.parse(skillManifestContent);
            this.logger.info(`[OlafAdapter] Skill manifest: ${JSON.stringify(skillManifest, null, 2)}`);
            
            // Extract skill name from install path (last directory component)
            const skillName = path.basename(installPath);
            
            // Extract source name from install path (parent directory of skill)
            const sourceName = path.basename(path.dirname(installPath));
            
            this.logger.info(`[OlafAdapter] Skill name: ${skillName}, Source name: ${sourceName}`);
            
            // Extract metadata from skill manifest
            const metadata = skillManifest.metadata || {};
            const patterns = metadata.aliases || [];
            const protocol = metadata.protocol || 'Act';
            
            // Construct the file path for the main prompt
            // Format: external-skills/{source}/{skill}/prompts/{skill}.md
            const promptFilePath = `external-skills/${sourceName}/${skillName}/prompts/${skillName}.md`;
            
            this.logger.info(`[OlafAdapter] Extracted metadata - patterns: ${JSON.stringify(patterns)}, protocol: ${protocol}`);
            this.logger.info(`[OlafAdapter] Prompt file path: ${promptFilePath}`);
            
            // Create skill entry for competency index in the correct format
            const skillEntry = {
                patterns: patterns,
                file: promptFilePath,
                protocol: protocol
            };
            
            this.logger.info(`[OlafAdapter] Skill entry: ${JSON.stringify(skillEntry, null, 2)}`);
            
            // Check if skill already exists in index (match by file path)
            const existingIndex = competencyIndex.findIndex((s: any) => s.file === skillEntry.file);
            
            if (existingIndex >= 0) {
                // Update existing entry
                this.logger.info(`[OlafAdapter] Updating existing skill entry in competency index: ${skillEntry.file}`);
                competencyIndex[existingIndex] = skillEntry;
            } else {
                // Add new entry
                this.logger.info(`[OlafAdapter] Adding new skill entry to competency index: ${skillEntry.file}`);
                competencyIndex.push(skillEntry);
            }
            
            // Write updated competency index
            this.logger.info(`[OlafAdapter] Writing updated competency index with ${competencyIndex.length} skills`);
            const competencyIndexContent = JSON.stringify(competencyIndex, null, 2);
            this.logger.info(`[OlafAdapter] Competency index content to write: ${competencyIndexContent}`);
            
            fs.writeFileSync(competencyIndexPath, competencyIndexContent, 'utf-8');
            this.logger.info(`[OlafAdapter] File write completed`);
            
            // Verify the file was written correctly
            if (fs.existsSync(competencyIndexPath)) {
                const verifyContent = fs.readFileSync(competencyIndexPath, 'utf-8');
                const verifyIndex = JSON.parse(verifyContent);
                
                // Handle both array format and legacy object format for verification
                let verifyArray: any[] = [];
                if (Array.isArray(verifyIndex)) {
                    verifyArray = verifyIndex;
                } else if (verifyIndex.skills && Array.isArray(verifyIndex.skills)) {
                    verifyArray = verifyIndex.skills;
                }
                
                this.logger.info(`[OlafAdapter] Verification: File exists and contains ${verifyArray.length} skills`);
                
                // Check if our skill is in the verified content
                const ourSkill = verifyArray.find((s: any) => s.file === skillEntry.file);
                if (ourSkill) {
                    this.logger.info(`[OlafAdapter] Verification: Our skill '${skillEntry.file}' is present in the file`);
                } else {
                    this.logger.error(`[OlafAdapter] Verification: Our skill '${skillEntry.file}' is NOT found in the file!`);
                    this.logger.error(`[OlafAdapter] Verification: Skills in file: ${verifyArray.map((s: any) => s.file).join(', ')}`);
                }
            } else {
                this.logger.error(`[OlafAdapter] Verification: File does not exist after write!`);
            }
            
            this.logger.info(`[OlafAdapter] Successfully registered skill in competency index: ${skillEntry.file}`);
            
        } catch (error) {
            this.logger.error(`[OlafAdapter] Failed to register skill in competency index: ${error}`);
            if (error instanceof Error) {
                this.logger.error(`[OlafAdapter] Error stack: ${error.stack}`);
            }
            throw error;
        }
    }

    /**
     * Unregister OLAF skill from competency index
     * Removes skill entry from .olaf/olaf-core/reference/competency-index.json
     */
    private async unregisterSkillFromCompetencyIndex(bundleId: string, installPath: string): Promise<void> {
        this.logger.info(`[OlafAdapter] Unregistering skill from competency index: ${bundleId}`);
        this.logger.info(`[OlafAdapter] Install path: ${installPath}`);
        
        try {
            const fs = require('fs');
            const path = require('path');
            
            // Get workspace path
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                this.logger.warn('[OlafAdapter] No workspace found, skipping competency index unregistration');
                return;
            }
            
            const workspacePath = workspaceFolders[0].uri.fsPath;
            this.logger.info(`[OlafAdapter] Workspace path: ${workspacePath}`);
            
            const competencyIndexPath = path.join(workspacePath, '.olaf', 'olaf-core', 'reference', 'competency-index.json');
            this.logger.info(`[OlafAdapter] Competency index path: ${competencyIndexPath}`);
            
            // Check if competency index exists
            if (!fs.existsSync(competencyIndexPath)) {
                this.logger.info(`[OlafAdapter] Competency index does not exist, nothing to unregister`);
                return;
            }
            
            // Read existing competency index
            this.logger.info(`[OlafAdapter] Reading existing competency index`);
            const content = fs.readFileSync(competencyIndexPath, 'utf-8');
            const parsed = JSON.parse(content);
            
            // Handle both array format and legacy object format
            let competencyIndex: any[] = [];
            if (Array.isArray(parsed)) {
                competencyIndex = parsed;
                this.logger.info(`[OlafAdapter] Found ${competencyIndex.length} existing skills`);
            } else if (parsed.skills && Array.isArray(parsed.skills)) {
                // Legacy format with skills property
                competencyIndex = parsed.skills;
                this.logger.info(`[OlafAdapter] Found legacy format with ${competencyIndex.length} existing skills`);
            } else {
                this.logger.warn(`[OlafAdapter] Invalid competency index format, nothing to unregister`);
                return;
            }
            
            // Extract skill name from install path (last directory component)
            const skillName = path.basename(installPath);
            
            // Extract source name from install path (parent directory of skill)
            const sourceName = path.basename(path.dirname(installPath));
            
            // Construct the file path that should be removed
            const promptFilePath = `external-skills/${sourceName}/${skillName}/prompts/${skillName}.md`;
            
            this.logger.info(`[OlafAdapter] Looking for skill to remove: ${promptFilePath}`);
            
            // Find and remove the skill entry
            const initialLength = competencyIndex.length;
            competencyIndex = competencyIndex.filter((s: any) => s.file !== promptFilePath);
            const finalLength = competencyIndex.length;
            
            if (initialLength > finalLength) {
                this.logger.info(`[OlafAdapter] Removed skill from competency index: ${promptFilePath}`);
                this.logger.info(`[OlafAdapter] Competency index now has ${finalLength} skills (was ${initialLength})`);
                
                // Write updated competency index
                const competencyIndexContent = JSON.stringify(competencyIndex, null, 2);
                this.logger.info(`[OlafAdapter] Writing updated competency index`);
                
                fs.writeFileSync(competencyIndexPath, competencyIndexContent, 'utf-8');
                this.logger.info(`[OlafAdapter] File write completed`);
                
                // Verify the file was written correctly
                if (fs.existsSync(competencyIndexPath)) {
                    const verifyContent = fs.readFileSync(competencyIndexPath, 'utf-8');
                    const verifyIndex = JSON.parse(verifyContent);
                    
                    // Handle both array format and legacy object format for verification
                    let verifyArray: any[] = [];
                    if (Array.isArray(verifyIndex)) {
                        verifyArray = verifyIndex;
                    } else if (verifyIndex.skills && Array.isArray(verifyIndex.skills)) {
                        verifyArray = verifyIndex.skills;
                    }
                    
                    this.logger.info(`[OlafAdapter] Verification: File exists and contains ${verifyArray.length} skills`);
                    
                    // Check if our skill was actually removed
                    const stillExists = verifyArray.find((s: any) => s.file === promptFilePath);
                    if (!stillExists) {
                        this.logger.info(`[OlafAdapter] Verification: Skill '${promptFilePath}' was successfully removed`);
                    } else {
                        this.logger.error(`[OlafAdapter] Verification: Skill '${promptFilePath}' is still present in the file!`);
                    }
                } else {
                    this.logger.error(`[OlafAdapter] Verification: File does not exist after write!`);
                }
                
            } else {
                this.logger.info(`[OlafAdapter] Skill not found in competency index: ${promptFilePath}`);
                this.logger.info(`[OlafAdapter] Available skills: ${competencyIndex.map((s: any) => s.file).join(', ')}`);
            }
            
            this.logger.info(`[OlafAdapter] Successfully processed skill unregistration: ${promptFilePath}`);
            
        } catch (error) {
            this.logger.error(`[OlafAdapter] Failed to unregister skill from competency index: ${error}`);
            if (error instanceof Error) {
                this.logger.error(`[OlafAdapter] Error stack: ${error.stack}`);
            }
            throw error;
        }
    }

    /**
     * Make GitHub API request with authentication
     * Uses the same authentication logic as GitHubAdapter
     */
    private async makeGitHubRequest(url: string): Promise<any> {
        const https = require('https');
        const vscode = require('vscode');
        const { exec } = require('child_process');
        const { promisify } = require('util');
        const execAsync = promisify(exec);
        
        // Get authentication token using the same fallback chain as GitHubAdapter
        let authToken: string | undefined;
        
        // Try explicit token first
        const explicitToken = this.getAuthToken();
        if (explicitToken && explicitToken.trim().length > 0) {
            authToken = explicitToken.trim();
            this.logger.debug('[OlafAdapter] Using explicit token from configuration');
        } else {
            // Try VSCode GitHub authentication
            try {
                const session = await vscode.authentication.getSession('github', ['repo'], { createIfNone: false });
                if (session) {
                    authToken = session.accessToken;
                    this.logger.debug('[OlafAdapter] Using VSCode GitHub authentication');
                }
            } catch (error) {
                this.logger.debug(`[OlafAdapter] VSCode auth failed: ${error}`);
            }
            
            // Try gh CLI if VSCode auth failed
            if (!authToken) {
                try {
                    const { stdout } = await execAsync('gh auth token');
                    const token = stdout.trim();
                    if (token && token.length > 0) {
                        authToken = token;
                        this.logger.debug('[OlafAdapter] Using gh CLI authentication');
                    }
                } catch (error) {
                    this.logger.debug(`[OlafAdapter] gh CLI auth failed: ${error}`);
                }
            }
        }
        
        return new Promise((resolve, reject) => {
            let headers: Record<string, string> = {
                'User-Agent': 'Prompt-Registry-VSCode-Extension',
                'Accept': 'application/json',
            };
            
            if (authToken) {
                headers = {
                    ...headers,
                    'Authorization': `token ${authToken}`,
                };
                this.logger.debug(`[OlafAdapter] Request to ${url} with authentication`);
            } else {
                this.logger.debug(`[OlafAdapter] Request to ${url} without authentication`);
            }
            
            https.get(url, { headers }, (res: any) => {
                let data = '';
                res.on('data', (chunk: any) => data += chunk);
                res.on('end', () => {
                    if (res.statusCode >= 400) {
                        this.logger.error(`[OlafAdapter] HTTP ${res.statusCode}: ${res.statusMessage}`);
                        this.logger.error(`[OlafAdapter] URL: ${url}`);
                        this.logger.error(`[OlafAdapter] Response: ${data.substring(0, 500)}`);
                        reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
                        return;
                    }
                    try {
                        resolve(JSON.parse(data));
                    } catch (error) {
                        this.logger.error(`[OlafAdapter] Failed to parse JSON response: ${error}`);
                        this.logger.error(`[OlafAdapter] Response preview: ${data.substring(0, 200)}`);
                        reject(new Error(`Failed to parse JSON response: ${error}`));
                    }
                });
            }).on('error', (error: any) => {
                this.logger.error(`[OlafAdapter] Network error: ${error.message}`);
                reject(new Error(`Request failed: ${error.message}`));
            });
        });
    }
}
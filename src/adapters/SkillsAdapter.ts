/**
 * Skills repository adapter
 * Handles GitHub repositories containing Anthropic-style skills with SKILL.md files
 * 
 * Repository structure:
 * - skills/ folder at root
 * - Each subfolder is a skill (folder name = skill ID)
 * - Each skill has a SKILL.md file with YAML frontmatter (name, description) and markdown instructions
 */

import { RepositoryAdapter } from './RepositoryAdapter';
import { GitHubAdapter } from './GitHubAdapter';
import { Bundle, ValidationResult, RegistrySource, SourceMetadata } from '../types/registry';
import { SkillItem, SkillFrontmatter, ParsedSkillFile, GitHubContentItem } from '../types/skills';
import { Logger } from '../utils/logger';
import * as yaml from 'js-yaml';

/**
 * Skills adapter implementation for GitHub repositories
 * Discovers skills from skills/ directory with SKILL.md files
 */
export class SkillsAdapter extends RepositoryAdapter {
    readonly type = 'skills';
    private logger: Logger;
    private githubAdapter: GitHubAdapter;

    constructor(source: RegistrySource) {
        super(source);
        this.logger = Logger.getInstance();
        
        if (!this.isValidGitHubUrl(source.url)) {
            throw new Error(`Invalid GitHub URL for skills source: ${source.url}`);
        }
        
        this.githubAdapter = new GitHubAdapter(source);
    }

    /**
     * Validate GitHub URL format
     */
    private isValidGitHubUrl(url: string): boolean {
        if (url.startsWith('https://')) {
            return url.includes('github.com');
        }
        if (url.startsWith('git@')) {
            return url.includes('github.com:');
        }
        return false;
    }

    /**
     * Parse GitHub URL to extract owner and repo
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
     * Fetch all skills from the repository as bundles
     * Each skill becomes a separate bundle
     */
    async fetchBundles(): Promise<Bundle[]> {
        this.logger.info(`[SkillsAdapter] Fetching skills from repository: ${this.source.url}`);
        
        try {
            const skills = await this.scanSkillsDirectory();
            this.logger.info(`[SkillsAdapter] Found ${skills.length} skills in repository`);
            
            const bundles: Bundle[] = [];
            for (const skill of skills) {
                try {
                    const bundle = this.createBundleFromSkill(skill);
                    bundles.push(bundle);
                    this.logger.debug(`[SkillsAdapter] Created bundle: ${bundle.id}`);
                } catch (error) {
                    this.logger.warn(`[SkillsAdapter] Failed to create bundle from skill ${skill.id}: ${error}`);
                }
            }
            
            this.logger.info(`[SkillsAdapter] Successfully created ${bundles.length} bundles`);
            return bundles;
            
        } catch (error) {
            this.logger.error(`[SkillsAdapter] Failed to fetch skills: ${error}`);
            throw new Error(`Failed to fetch skills: ${error}`);
        }
    }

    /**
     * Scan skills/ directory for skill folders with SKILL.md files
     */
    private async scanSkillsDirectory(): Promise<SkillItem[]> {
        const { owner, repo } = this.parseGitHubUrl();
        const apiBase = 'https://api.github.com';
        const skillsUrl = `${apiBase}/repos/${owner}/${repo}/contents/skills`;
        
        this.logger.debug(`[SkillsAdapter] Scanning skills directory: ${skillsUrl}`);
        
        try {
            const contents: GitHubContentItem[] = await this.makeGitHubRequest(skillsUrl);
            const skills: SkillItem[] = [];
            
            const directories = contents.filter(item => item.type === 'dir');
            this.logger.debug(`[SkillsAdapter] Found ${directories.length} directories in skills/`);
            
            for (const dir of directories) {
                try {
                    const skill = await this.processSkillDirectory(dir, owner, repo);
                    if (skill) {
                        skills.push(skill);
                    }
                } catch (error) {
                    this.logger.warn(`[SkillsAdapter] Failed to process skill directory ${dir.name}: ${error}`);
                }
            }
            
            return skills;
            
        } catch (error) {
            this.logger.error(`[SkillsAdapter] Failed to scan skills directory: ${error}`);
            throw new Error(`Failed to scan skills directory: ${error}`);
        }
    }

    /**
     * Process a skill directory and extract skill information
     */
    private async processSkillDirectory(dir: GitHubContentItem, owner: string, repo: string): Promise<SkillItem | null> {
        const skillPath = dir.path;
        const skillId = dir.name;
        
        this.logger.debug(`[SkillsAdapter] Processing skill directory: ${skillId}`);
        
        try {
            const apiBase = 'https://api.github.com';
            const skillContentsUrl = `${apiBase}/repos/${owner}/${repo}/contents/${skillPath}`;
            const skillContents: GitHubContentItem[] = await this.makeGitHubRequest(skillContentsUrl);
            
            const skillMdFile = skillContents.find(file => 
                file.name === 'SKILL.md' && file.type === 'file'
            );
            
            if (!skillMdFile) {
                this.logger.debug(`[SkillsAdapter] Skill ${skillId} missing SKILL.md, skipping`);
                return null;
            }
            
            const parsedSkillMd = await this.parseSkillMd(skillMdFile.download_url!);
            
            const files = skillContents
                .filter(item => item.type === 'file')
                .map(item => item.name);
            
            const skillItem: SkillItem = {
                id: skillId,
                name: parsedSkillMd.frontmatter.name || skillId,
                description: parsedSkillMd.frontmatter.description || 'No description',
                license: parsedSkillMd.frontmatter.license,
                path: skillPath,
                skillMdPath: `${skillPath}/SKILL.md`,
                files,
                parsedSkillMd,
            };
            
            this.logger.debug(`[SkillsAdapter] Successfully processed skill: ${skillItem.name}`);
            return skillItem;
            
        } catch (error) {
            this.logger.error(`[SkillsAdapter] Error processing skill ${skillId}: ${error}`);
            return null;
        }
    }

    /**
     * Parse SKILL.md file content (YAML frontmatter + markdown)
     */
    private async parseSkillMd(downloadUrl: string): Promise<ParsedSkillFile> {
        this.logger.debug(`[SkillsAdapter] Parsing SKILL.md from: ${downloadUrl}`);
        
        try {
            const content = await this.downloadFileContent(downloadUrl);
            const raw = content.toString('utf-8');
            
            const frontmatterMatch = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
            
            if (!frontmatterMatch) {
                this.logger.warn(`[SkillsAdapter] SKILL.md missing valid frontmatter`);
                return {
                    frontmatter: { name: '', description: '' },
                    content: raw,
                    raw,
                };
            }
            
            const frontmatterYaml = frontmatterMatch[1];
            const markdownContent = frontmatterMatch[2];
            
            let frontmatter: SkillFrontmatter;
            try {
                frontmatter = yaml.load(frontmatterYaml) as SkillFrontmatter;
            } catch (yamlError) {
                this.logger.warn(`[SkillsAdapter] Failed to parse YAML frontmatter: ${yamlError}`);
                frontmatter = { name: '', description: '' };
            }
            
            return {
                frontmatter,
                content: markdownContent,
                raw,
            };
            
        } catch (error) {
            this.logger.error(`[SkillsAdapter] Failed to parse SKILL.md: ${error}`);
            throw error;
        }
    }

    /**
     * Create Bundle object from SkillItem
     */
    private createBundleFromSkill(skill: SkillItem): Bundle {
        const { owner, repo } = this.parseGitHubUrl();
        
        const bundleId = `skills-${owner}-${repo}-${skill.id}`;
        
        const bundle: Bundle = {
            id: bundleId,
            name: skill.name,
            version: '1.0.0',
            description: skill.description,
            author: owner,
            sourceId: this.source.id,
            environments: ['claude', 'vscode', 'claude-code'],
            tags: ['skill', 'anthropic'],
            lastUpdated: new Date().toISOString(),
            size: this.estimateSkillSize(skill.files),
            dependencies: [],
            license: skill.license || 'Unknown',
            repository: this.source.url,
            homepage: `https://github.com/${owner}/${repo}/tree/main/${skill.path}`,
            manifestUrl: this.getManifestUrl(bundleId),
            downloadUrl: this.getDownloadUrl(bundleId),
        };
        
        return bundle;
    }

    /**
     * Estimate skill size based on file count
     */
    private estimateSkillSize(files: string[]): string {
        const estimatedBytes = files.length * 4096;
        
        if (estimatedBytes < 1024) {
            return `${estimatedBytes} B`;
        }
        if (estimatedBytes < 1024 * 1024) {
            return `${(estimatedBytes / 1024).toFixed(1)} KB`;
        }
        return `${(estimatedBytes / (1024 * 1024)).toFixed(1)} MB`;
    }

    /**
     * Validate skills repository structure
     */
    async validate(): Promise<ValidationResult> {
        this.logger.info(`[SkillsAdapter] Validating skills repository: ${this.source.url}`);
        
        const errors: string[] = [];
        const warnings: string[] = [];
        
        try {
            const { owner, repo } = this.parseGitHubUrl();
            
            const baseValidation = await this.githubAdapter.validate();
            if (!baseValidation.valid) {
                return baseValidation;
            }
            
            const apiBase = 'https://api.github.com';
            
            let hasSkillsDir = false;
            try {
                const skillsUrl = `${apiBase}/repos/${owner}/${repo}/contents/skills`;
                await this.makeGitHubRequest(skillsUrl);
                hasSkillsDir = true;
                this.logger.debug(`[SkillsAdapter] Found skills/ directory`);
            } catch (error) {
                if (error instanceof Error && error.message.includes('404')) {
                    errors.push(`Missing required 'skills' directory at repository root`);
                } else {
                    errors.push(`Failed to access skills directory: ${error}`);
                }
            }
            
            if (!hasSkillsDir) {
                return {
                    valid: false,
                    errors,
                    warnings,
                    bundlesFound: 0,
                };
            }
            
            let skillCount = 0;
            try {
                const skills = await this.scanSkillsDirectory();
                skillCount = skills.length;
                
                if (skillCount === 0) {
                    warnings.push('No valid skills found in skills/ directory (skills must have SKILL.md file)');
                } else {
                    this.logger.info(`[SkillsAdapter] Found ${skillCount} valid skill(s)`);
                }
            } catch (scanError) {
                warnings.push(`Failed to scan skills: ${scanError}`);
            }
            
            return {
                valid: true,
                errors: [],
                warnings,
                bundlesFound: skillCount,
            };
            
        } catch (error) {
            return {
                valid: false,
                errors: [`Skills repository validation failed: ${error}`],
                warnings: [],
                bundlesFound: 0,
            };
        }
    }

    /**
     * Fetch repository metadata
     */
    async fetchMetadata(): Promise<SourceMetadata> {
        try {
            const skills = await this.scanSkillsDirectory();
            const { owner, repo } = this.parseGitHubUrl();
            
            return {
                name: `${owner}/${repo}`,
                description: 'Skills Repository',
                bundleCount: skills.length,
                lastUpdated: new Date().toISOString(),
                version: '1.0.0',
            };
        } catch (error) {
            throw new Error(`Failed to fetch skills repository metadata: ${error}`);
        }
    }

    /**
     * Get manifest URL for a skill
     */
    getManifestUrl(bundleId: string, version?: string): string {
        const { owner, repo } = this.parseGitHubUrl();
        const skillId = bundleId.replace(`skills-${owner}-${repo}-`, '');
        return `https://raw.githubusercontent.com/${owner}/${repo}/main/skills/${skillId}/SKILL.md`;
    }

    /**
     * Get download URL for a skill
     */
    getDownloadUrl(bundleId: string, version?: string): string {
        const { owner, repo } = this.parseGitHubUrl();
        return `https://github.com/${owner}/${repo}/archive/refs/heads/main.zip`;
    }

    /**
     * Download a skill bundle
     * Creates a ZIP with the skill folder and deployment manifest
     */
    async downloadBundle(bundle: Bundle): Promise<Buffer> {
        const { owner, repo } = this.parseGitHubUrl();
        const skillId = bundle.id.replace(`skills-${owner}-${repo}-`, '');
        
        this.logger.info(`[SkillsAdapter] Downloading skill: ${skillId}`);
        
        try {
            // Fetch only the specific skill instead of scanning all skills
            const skill = await this.fetchSingleSkill(skillId);
            
            if (!skill) {
                throw new Error(`Skill not found: ${skillId}`);
            }
            
            const zipBuffer = await this.packageSkillAsZip(skill);
            
            this.logger.info(`[SkillsAdapter] Successfully packaged skill ${skillId} (${zipBuffer.length} bytes)`);
            return zipBuffer;
            
        } catch (error) {
            this.logger.error(`[SkillsAdapter] Failed to download skill ${skillId}: ${error}`);
            throw new Error(`Failed to download skill ${skillId}: ${error}`);
        }
    }

    /**
     * Fetch a single skill by ID (optimized - doesn't scan all skills)
     */
    private async fetchSingleSkill(skillId: string): Promise<SkillItem | null> {
        const { owner, repo } = this.parseGitHubUrl();
        const apiBase = 'https://api.github.com';
        const skillPath = `skills/${skillId}`;
        
        this.logger.debug(`[SkillsAdapter] Fetching single skill: ${skillId}`);
        
        try {
            // Get skill directory contents
            const skillContentsUrl = `${apiBase}/repos/${owner}/${repo}/contents/${skillPath}`;
            const skillContents: GitHubContentItem[] = await this.makeGitHubRequest(skillContentsUrl);
            
            // Find SKILL.md
            const skillMdFile = skillContents.find(item => 
                item.type === 'file' && item.name === 'SKILL.md'
            );
            
            if (!skillMdFile || !skillMdFile.download_url) {
                this.logger.warn(`[SkillsAdapter] No SKILL.md found for skill: ${skillId}`);
                return null;
            }
            
            // Parse SKILL.md
            const parsedSkill = await this.parseSkillMd(skillMdFile.download_url);
            if (!parsedSkill) {
                return null;
            }
            
            // Get file list
            const files = skillContents
                .filter(item => item.type === 'file')
                .map(item => item.name);
            
            return {
                id: skillId,
                name: parsedSkill.frontmatter.name || skillId,
                description: parsedSkill.frontmatter.description || '',
                path: skillPath,
                skillMdPath: `${skillPath}/SKILL.md`,
                files,
                license: parsedSkill.frontmatter.license
            };
            
        } catch (error) {
            this.logger.error(`[SkillsAdapter] Failed to fetch skill ${skillId}: ${error}`);
            return null;
        }
    }

    /**
     * Package a skill as a ZIP bundle
     */
    private async packageSkillAsZip(skill: SkillItem): Promise<Buffer> {
        const { owner, repo } = this.parseGitHubUrl();
        const AdmZip = require('adm-zip');
        const yamlLib = require('js-yaml');
        
        this.logger.debug(`[SkillsAdapter] Packaging skill as ZIP: ${skill.id}`);
        
        try {
            const zip = new AdmZip();
            
            const deploymentManifest = this.generateDeploymentManifest(skill, owner, repo);
            const manifestYaml = yamlLib.dump(deploymentManifest);
            zip.addFile('deployment-manifest.yml', Buffer.from(manifestYaml, 'utf8'));
            
            const apiBase = 'https://api.github.com';
            const skillContentsUrl = `${apiBase}/repos/${owner}/${repo}/contents/${skill.path}`;
            const skillContents: GitHubContentItem[] = await this.makeGitHubRequest(skillContentsUrl);
            
            // Use skills/{skill-id}/ structure to match CopilotSyncService expectations
            for (const item of skillContents) {
                if (item.type === 'file' && item.download_url) {
                    try {
                        const fileContent = await this.downloadFileContent(item.download_url);
                        const filePath = `skills/${skill.id}/${item.name}`;
                        zip.addFile(filePath, fileContent);
                        
                        this.logger.debug(`[SkillsAdapter] Added file to ZIP: ${filePath}`);
                    } catch (error) {
                        this.logger.warn(`[SkillsAdapter] Failed to download file ${item.name}: ${error}`);
                    }
                } else if (item.type === 'dir') {
                    await this.addDirectoryToZip(zip, owner, repo, item.path, `skills/${skill.id}/${item.name}`);
                }
            }
            
            const zipBuffer = zip.toBuffer();
            this.logger.debug(`[SkillsAdapter] Created ZIP bundle: ${zipBuffer.length} bytes`);
            return zipBuffer;
            
        } catch (error) {
            this.logger.error(`[SkillsAdapter] Failed to package skill ${skill.id}: ${error}`);
            throw new Error(`Failed to package skill as ZIP: ${error}`);
        }
    }

    /**
     * Recursively add directory contents to ZIP
     */
    private async addDirectoryToZip(zip: any, owner: string, repo: string, dirPath: string, zipPath: string): Promise<void> {
        try {
            const apiBase = 'https://api.github.com';
            const dirContentsUrl = `${apiBase}/repos/${owner}/${repo}/contents/${dirPath}`;
            const dirContents: GitHubContentItem[] = await this.makeGitHubRequest(dirContentsUrl);
            
            for (const item of dirContents) {
                if (item.type === 'file' && item.download_url) {
                    try {
                        const fileContent = await this.downloadFileContent(item.download_url);
                        const filePath = `${zipPath}/${item.name}`;
                        zip.addFile(filePath, fileContent);
                    } catch (error) {
                        this.logger.warn(`[SkillsAdapter] Failed to download nested file ${item.name}: ${error}`);
                    }
                } else if (item.type === 'dir') {
                    await this.addDirectoryToZip(zip, owner, repo, item.path, `${zipPath}/${item.name}`);
                }
            }
        } catch (error) {
            this.logger.warn(`[SkillsAdapter] Failed to add directory ${dirPath} to ZIP: ${error}`);
        }
    }

    /**
     * Generate deployment manifest for a skill
     */
    private generateDeploymentManifest(skill: SkillItem, owner: string, repo: string): any {
        return {
            id: `skills-${owner}-${repo}-${skill.id}`,
            version: '1.0.0',
            name: skill.name,
            
            metadata: {
                manifest_version: '1.0',
                description: skill.description,
                author: owner,
                last_updated: new Date().toISOString(),
                repository: {
                    type: 'git',
                    url: this.source.url,
                    directory: skill.path
                },
                license: skill.license || 'Unknown',
                keywords: ['skill', 'anthropic']
            },
            
            common: {
                directories: [`skills/${skill.id}`],
                files: [],
                include_patterns: ['**/*'],
                exclude_patterns: []
            },
            
            bundle_settings: {
                include_common_in_environment_bundles: true,
                create_common_bundle: true,
                compression: 'zip',
                naming: {
                    common_bundle: skill.id
                }
            },
            
            prompts: [
                {
                    id: skill.id,
                    name: skill.name,
                    description: skill.description,
                    file: `SKILL.md`,
                    type: 'skill',
                    tags: ['skill', 'anthropic']
                }
            ]
        };
    }

    /**
     * Download file content from URL
     */
    private async downloadFileContent(url: string): Promise<Buffer> {
        const https = require('https');
        
        return new Promise((resolve, reject) => {
            const headers: Record<string, string> = {
                'User-Agent': 'Prompt-Registry-VSCode-Extension',
            };
            
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
     * Make GitHub API request with authentication
     */
    private async makeGitHubRequest(url: string): Promise<any> {
        const https = require('https');
        const vscode = require('vscode');
        const { exec } = require('child_process');
        const { promisify } = require('util');
        const execAsync = promisify(exec);
        
        let authToken: string | undefined;
        
        const explicitToken = this.getAuthToken();
        if (explicitToken && explicitToken.trim().length > 0) {
            authToken = explicitToken.trim();
            this.logger.debug('[SkillsAdapter] Using explicit token from configuration');
        } else {
            try {
                const session = await vscode.authentication.getSession('github', ['repo'], { createIfNone: false });
                if (session) {
                    authToken = session.accessToken;
                    this.logger.debug('[SkillsAdapter] Using VSCode GitHub authentication');
                }
            } catch (error) {
                this.logger.debug(`[SkillsAdapter] VSCode auth failed: ${error}`);
            }
            
            if (!authToken) {
                try {
                    const { stdout } = await execAsync('gh auth token');
                    const token = stdout.trim();
                    if (token && token.length > 0) {
                        authToken = token;
                        this.logger.debug('[SkillsAdapter] Using gh CLI authentication');
                    }
                } catch (error) {
                    this.logger.debug(`[SkillsAdapter] gh CLI auth failed: ${error}`);
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
                this.logger.debug(`[SkillsAdapter] Request to ${url} with authentication`);
            } else {
                this.logger.debug(`[SkillsAdapter] Request to ${url} without authentication`);
            }
            
            https.get(url, { headers }, (res: any) => {
                let data = '';
                res.on('data', (chunk: any) => data += chunk);
                res.on('end', () => {
                    if (res.statusCode >= 400) {
                        this.logger.error(`[SkillsAdapter] HTTP ${res.statusCode}: ${res.statusMessage}`);
                        reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
                        return;
                    }
                    try {
                        resolve(JSON.parse(data));
                    } catch (error) {
                        this.logger.error(`[SkillsAdapter] Failed to parse JSON response: ${error}`);
                        reject(new Error(`Failed to parse JSON response: ${error}`));
                    }
                });
            }).on('error', (error: any) => {
                this.logger.error(`[SkillsAdapter] Network error: ${error.message}`);
                reject(new Error(`Request failed: ${error.message}`));
            });
        });
    }
}

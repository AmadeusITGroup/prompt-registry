/**
 * OLAF repository adapter
 * Handles GitHub repositories containing AI skills in bundles/ and skills/ structure
 */

import * as vscode from 'vscode';
import {
  OlafRuntimeManager,
} from '../services/olaf-runtime-manager';
import {
  BundleDefinition,
  BundleDefinitionInfo,
  LocalOlafSkillManifest,
  SkillInfo,
  SkillManifest,
} from '../types/olaf';
import {
  Bundle,
  BundleDependency,
  RegistrySource,
  SourceMetadata,
  ValidationResult,
} from '../types/registry';
import {
  generateSanitizedId,
} from '../utils/bundle-name-utils';
import {
  Logger,
} from '../utils/logger';
import {
  GitHubAdapter,
} from './github-adapter';
import {
  RepositoryAdapter,
} from './repository-adapter';

/**
 * GitHub API response types for OLAF-specific operations
 */
interface GitHubDirectoryContent {
  name: string;
  path: string;
  type: 'file' | 'dir';
  // eslint-disable-next-line @typescript-eslint/naming-convention -- matches external API response shape
  download_url: string | null;
  url: string;
}

/**
 * OLAF adapter implementation using GitHub functionality via composition
 * Discovers and packages AI skills from bundles/ and skills/ directory structure
 */
export class OlafAdapter extends RepositoryAdapter {
  public readonly type = 'olaf';
  private readonly logger: Logger;
  private readonly githubAdapter: GitHubAdapter;
  private readonly runtimeManager: OlafRuntimeManager;

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
   * @param url
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
      repo: match[2]
    };
  }

  /**
   * Override fetchBundles to implement OLAF-specific bundle discovery
   * Scans bundles/ directory for bundle definitions and converts them to Bundle objects
   */
  public async fetchBundles(): Promise<Bundle[]> {
    this.logger.info(`[OlafAdapter] Fetching bundles from OLAF repository: ${this.source.url}`);

    try {
      // Discover bundle definitions in the repository
      const bundleDefinitions = await this.scanBundleDefinitions();
      this.logger.info(`[OlafAdapter] Found ${bundleDefinitions.length} bundle definitions in repository`);

      // Convert bundle definitions to Bundle objects
      const bundles: Bundle[] = [];
      for (const bundleInfo of bundleDefinitions) {
        try {
          const bundle = this.createBundleFromDefinition(bundleInfo);
          bundles.push(bundle);
          this.logger.debug(`[OlafAdapter] Created bundle: ${bundle.id} (${bundleInfo.validatedSkills.length} skills)`);
        } catch (error) {
          this.logger.warn(`[OlafAdapter] Failed to create bundle from definition ${bundleInfo.fileName}: ${error}`);
          // Continue processing other bundles
        }
      }

      this.logger.info(`[OlafAdapter] Successfully created ${bundles.length} bundles from definitions`);
      return bundles;
    } catch (error) {
      this.logger.error(`[OlafAdapter] Failed to fetch bundles: ${error}`);
      throw new Error(`Failed to fetch OLAF bundles: ${error}`);
    }
  }

  /**
   * Create Bundle object from BundleDefinitionInfo
   * Maps bundle definition metadata to Bundle properties
   * @param bundleInfo
   */
  // eslint-disable-next-line @typescript-eslint/member-ordering -- existing code structure
  private createBundleFromDefinition(bundleInfo: BundleDefinitionInfo): Bundle {
    const { owner, repo } = this.parseGitHubUrl();
    const metadata = bundleInfo.definition.metadata;

    // Bundle ID is already generated in scanBundleDefinitions: olaf-{owner}-{repo}-{bundleFileName}
    const bundleId = bundleInfo.id;

    // Include skill count in description for UI display
    const skillCount = bundleInfo.validatedSkills.length;
    const skillNames = bundleInfo.validatedSkills.map((s) => s.manifest.name || s.folderName).join(', ');
    const enhancedDescription = `${metadata.description} (${skillCount} skill${skillCount === 1 ? '' : 's'}: ${skillNames})`;

    // Map bundle definition metadata to Bundle properties
    const bundle: Bundle = {
      id: bundleId,
      name: metadata.name,
      version: metadata.version || '1.0.0',
      description: enhancedDescription,
      author: metadata.author || owner,
      sourceId: this.source.id,
      environments: ['vscode', 'kiro', 'windsurf'], // OLAF bundles work across IDEs
      tags: this.normalizeTags(metadata.tags),
      lastUpdated: new Date().toISOString(),
      size: this.estimateBundleSize(bundleInfo.validatedSkills),
      dependencies: [],
      license: 'Unknown',
      repository: this.source.url,
      homepage: `https://github.com/${owner}/${repo}/tree/main/bundles/${bundleInfo.fileName}.json`,

      // OLAF-specific URLs
      manifestUrl: this.getManifestUrl(bundleId),
      downloadUrl: this.getDownloadUrl(bundleId)
    };

    this.logger.debug(`[OlafAdapter] Created bundle: ${bundle.id} (${bundle.name} v${bundle.version}, ${skillCount} skills)`);
    return bundle;
  }

  /**
   * Estimate bundle size based on total skill files
   * @param skills
   */
  // eslint-disable-next-line @typescript-eslint/member-ordering -- existing code structure
  private estimateBundleSize(skills: SkillInfo[]): string {
    // Sum up estimated sizes for all skills
    let totalFiles = 0;
    for (const skill of skills) {
      totalFiles += skill.files.length;
    }

    // Rough estimation: assume average file size and add manifest overhead
    const estimatedBytes = totalFiles * 2048; // 2KB average per file

    if (estimatedBytes < 1024) {
      return `${estimatedBytes} B`;
    }
    if (estimatedBytes < 1024 * 1024) {
      return `${(estimatedBytes / 1024).toFixed(1)} KB`;
    }
    return `${(estimatedBytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  /**
   * Validate OLAF repository structure
   * Checks for bundles/ and skills/ directories at root level and validates accessibility
   */
  public async validate(): Promise<ValidationResult> {
    this.logger.info(`[OlafAdapter] Validating OLAF repository: ${this.source.url}`);

    const errors: string[] = [];
    const warnings: string[] = [];

    try {
      const { owner, repo } = this.parseGitHubUrl();

      // First validate basic GitHub repository access
      const baseValidation = await this.githubAdapter.validate();
      if (!baseValidation.valid) {
        return baseValidation;
      }

      const apiBase = 'https://api.github.com';

      // Check for bundles/ directory at root level
      let hasBundlesDir = false;
      try {
        const bundlesUrl = `${apiBase}/repos/${owner}/${repo}/contents/bundles`;
        await this.makeGitHubRequest(bundlesUrl);
        hasBundlesDir = true;
        this.logger.debug(`[OlafAdapter] Found bundles/ directory`);
      } catch (error) {
        if (error instanceof Error && error.message.includes('404')) {
          errors.push(`Missing required 'bundles' directory at repository root`);
        } else {
          errors.push(`Failed to access bundles directory: ${error}`);
        }
      }

      // Check for skills/ directory at root level
      let hasSkillsDir = false;
      try {
        const skillsUrl = `${apiBase}/repos/${owner}/${repo}/contents/skills`;
        await this.makeGitHubRequest(skillsUrl);
        hasSkillsDir = true;
        this.logger.debug(`[OlafAdapter] Found skills/ directory`);
      } catch (error) {
        if (error instanceof Error && error.message.includes('404')) {
          errors.push(`Missing required 'skills' directory at repository root`);
        } else {
          errors.push(`Failed to access skills directory: ${error}`);
        }
      }

      // If either directory is missing, return validation failure
      if (!hasBundlesDir || !hasSkillsDir) {
        return {
          valid: false,
          errors,
          warnings,
          bundlesFound: 0
        };
      }

      // Scan bundle definitions and report bundle count
      let bundleCount = 0;
      try {
        const bundleDefinitions = await this.scanBundleDefinitions();
        bundleCount = bundleDefinitions.length;

        if (bundleCount === 0) {
          warnings.push('No valid bundle definitions found in bundles/ directory');
        } else {
          this.logger.info(`[OlafAdapter] Found ${bundleCount} valid bundle definition(s)`);
        }
      } catch (scanError) {
        warnings.push(`Failed to scan bundle definitions: ${scanError}`);
      }

      return {
        valid: true,
        errors: [],
        warnings,
        bundlesFound: bundleCount
      };
    } catch (error) {
      return {
        valid: false,
        errors: [`OLAF repository validation failed: ${error}`],
        warnings: [],
        bundlesFound: 0
      };
    }
  }

  /**
   * Scan bundles/ directory for JSON bundle definition files
   * Returns list of bundle definition file paths for further processing
   */
  // eslint-disable-next-line @typescript-eslint/member-ordering -- existing code structure
  private async scanBundleDefinitions(): Promise<BundleDefinitionInfo[]> {
    const { owner, repo } = this.parseGitHubUrl();
    const apiBase = 'https://api.github.com';
    const bundlesUrl = `${apiBase}/repos/${owner}/${repo}/contents/bundles`;

    this.logger.debug(`[OlafAdapter] Scanning bundle definitions: ${bundlesUrl}`);

    try {
      const contents: GitHubDirectoryContent[] = await this.makeGitHubRequest(bundlesUrl);
      const bundleDefinitions: BundleDefinitionInfo[] = [];
      const errors: string[] = [];

      // Filter for JSON files only, ignoring subdirectories and other file types
      const jsonFiles = contents.filter((item) =>
        item.type === 'file' && item.name.endsWith('.json')
      );

      this.logger.debug(`[OlafAdapter] Found ${jsonFiles.length} JSON files in bundles/ directory`);

      for (const jsonFile of jsonFiles) {
        try {
          const definition = await this.parseBundleDefinition(jsonFile);
          const fileName = jsonFile.name.replace('.json', '');
          const bundleId = `olaf-${owner}-${repo}-${fileName}`;

          // Validate skill references
          try {
            const validatedSkills = await this.validateSkillReferences(definition);

            bundleDefinitions.push({
              id: bundleId,
              fileName,
              filePath: jsonFile.path,
              definition,
              validatedSkills
            });

            this.logger.info(`[OlafAdapter] Successfully processed bundle: ${fileName} (${validatedSkills.length} skills)`);
          } catch (skillError) {
            const errorMsg = `Bundle ${fileName}: ${skillError}`;
            errors.push(errorMsg);
            this.logger.warn(`[OlafAdapter] ${errorMsg}`);
            // Continue processing other bundles
          }
        } catch (parseError) {
          const errorMsg = `Failed to parse bundle definition ${jsonFile.name}: ${parseError}`;
          errors.push(errorMsg);
          this.logger.warn(`[OlafAdapter] ${errorMsg}`);
          // Continue processing other bundles
        }
      }

      // Log summary of processing results
      if (bundleDefinitions.length > 0) {
        this.logger.info(`[OlafAdapter] Successfully processed ${bundleDefinitions.length} bundle(s)`);
      }

      if (errors.length > 0) {
        this.logger.warn(`[OlafAdapter] Encountered ${errors.length} error(s) while processing bundles`);
      }

      return bundleDefinitions;
    } catch (error) {
      this.logger.error(`[OlafAdapter] Failed to scan bundle definitions: ${error}`);
      throw new Error(`Failed to scan bundles directory: ${error}`);
    }
  }

  /**
   * Parse and validate bundle definition JSON file
   * Extracts metadata fields and skill references
   * @param jsonFile
   */
  // eslint-disable-next-line @typescript-eslint/member-ordering -- existing code structure
  private async parseBundleDefinition(jsonFile: GitHubDirectoryContent): Promise<BundleDefinition> {
    this.logger.debug(`[OlafAdapter] Parsing bundle definition: ${jsonFile.name}`);

    if (!jsonFile.download_url) {
      throw new Error(`No download URL for bundle definition: ${jsonFile.name}`);
    }

    try {
      const content = await this.downloadFileContent(jsonFile.download_url);
      const data = JSON.parse(content.toString('utf8'));

      // Validate required structure with specific error messages
      if (!data.metadata || typeof data.metadata !== 'object') {
        throw new Error(`Missing or invalid metadata section in ${jsonFile.name}`);
      }

      if (!data.metadata.name || typeof data.metadata.name !== 'string') {
        throw new Error(`Missing or invalid metadata.name in ${jsonFile.name}`);
      }

      if (!data.metadata.description || typeof data.metadata.description !== 'string') {
        throw new Error(`Missing or invalid metadata.description in ${jsonFile.name}`);
      }

      if (!data.skills || !Array.isArray(data.skills)) {
        throw new Error(`Missing or invalid skills array in ${jsonFile.name}`);
      }

      if (data.skills.length === 0) {
        throw new Error(`Bundle ${jsonFile.name} contains no skills`);
      }

      // Validate each skill reference
      for (let i = 0; i < data.skills.length; i++) {
        const skill = data.skills[i];
        const skillContext = `skill ${i + 1} in ${jsonFile.name}`;

        if (!skill.name || typeof skill.name !== 'string') {
          throw new Error(`Missing or invalid name field for ${skillContext}`);
        }
        if (!skill.description || typeof skill.description !== 'string') {
          throw new Error(`Missing or invalid description field for ${skillContext}`);
        }
        if (!skill.path || typeof skill.path !== 'string') {
          throw new Error(`Missing or invalid path field for ${skillContext}`);
        }
        if (!skill.manifest || typeof skill.manifest !== 'string') {
          throw new Error(`Missing or invalid manifest field for ${skillContext}`);
        }
      }

      return data as BundleDefinition;
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error(`Invalid JSON syntax in ${jsonFile.name}: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Validate that all skills referenced in bundle definition exist in skills/ directory
   * Returns validated SkillInfo[] for valid skills, logs warnings for invalid ones
   * @param bundleDefinition
   */
  // eslint-disable-next-line @typescript-eslint/member-ordering -- existing code structure
  private async validateSkillReferences(bundleDefinition: BundleDefinition): Promise<SkillInfo[]> {
    const { owner, repo } = this.parseGitHubUrl();
    const apiBase = 'https://api.github.com';
    const validatedSkills: SkillInfo[] = [];
    const errors: string[] = [];

    for (let i = 0; i < bundleDefinition.skills.length; i++) {
      const skillRef = bundleDefinition.skills[i];
      const skillContext = `skill "${skillRef.name}" (${i + 1}/${bundleDefinition.skills.length})`;

      try {
        // Check if skill directory exists in skills/ directory
        const skillDirUrl = `${apiBase}/repos/${owner}/${repo}/contents/${skillRef.path}`;
        let skillContents: GitHubDirectoryContent[];

        try {
          skillContents = await this.makeGitHubRequest(skillDirUrl);
        } catch (error) {
          if (error instanceof Error && error.message.includes('404')) {
            errors.push(`${skillContext}: Directory does not exist at path "${skillRef.path}"`);
          } else {
            errors.push(`${skillContext}: Failed to access directory - ${error}`);
          }
          continue;
        }

        // Check if manifest file exists
        const manifestUrl = `${apiBase}/repos/${owner}/${repo}/contents/${skillRef.manifest}`;
        let manifestFile: GitHubDirectoryContent;

        try {
          manifestFile = await this.makeGitHubRequest(manifestUrl);
        } catch (error) {
          if (error instanceof Error && error.message.includes('404')) {
            errors.push(`${skillContext}: Manifest file does not exist at path "${skillRef.manifest}"`);
          } else {
            errors.push(`${skillContext}: Failed to access manifest - ${error}`);
          }
          continue;
        }

        // Parse and validate manifest
        let manifest: LocalOlafSkillManifest;
        try {
          manifest = await this.parseLocalSkillManifest(manifestFile);
        } catch (manifestError) {
          errors.push(`${skillContext}: Invalid manifest file - ${manifestError}`);
          continue;
        }

        // Get list of files in skill directory
        const files = skillContents
          .filter((item) => item.type === 'file')
          .map((item) => item.name);

        // Create SkillInfo object
        const skillInfo: SkillInfo = {
          id: generateSanitizedId(skillRef.name),
          folderName: skillRef.path.split('/').pop() || skillRef.name,
          path: skillRef.path,
          manifest: manifest as SkillManifest,
          files
        };

        validatedSkills.push(skillInfo);
        this.logger.debug(`[OlafAdapter] Validated ${skillContext}: ${files.length} files, ${manifest.entry_points?.length || 0} entry points`);
      } catch (error) {
        const errorMsg = `${skillContext}: Unexpected validation error - ${error}`;
        errors.push(errorMsg);
        this.logger.error(`[OlafAdapter] ${errorMsg}`);
      }
    }

    if (errors.length > 0) {
      const errorSummary = `Skill validation failed for bundle "${bundleDefinition.metadata.name}": ${errors.length} error(s):\n${errors.map((e) => `  - ${e}`).join('\n')}`;
      throw new Error(errorSummary);
    }

    if (validatedSkills.length === 0) {
      throw new Error(`No valid skills found in bundle "${bundleDefinition.metadata.name}"`);
    }

    return validatedSkills;
  }

  /**
   * Parse skill manifest from GitHub and validate entry_points field
   * @param manifestFile
   */
  // eslint-disable-next-line @typescript-eslint/member-ordering -- existing code structure
  private async parseLocalSkillManifest(manifestFile: GitHubDirectoryContent): Promise<LocalOlafSkillManifest> {
    if (!manifestFile.download_url) {
      throw new Error('No download URL for manifest file');
    }

    const content = await this.downloadFileContent(manifestFile.download_url);
    const data = JSON.parse(content.toString('utf8'));

    // Handle different manifest structures
    let name: string;
    let entryPoints: any[];
    let description: string | undefined;
    let version: string | undefined;
    let author: string | undefined;

    // Check if this is the new structure with metadata and bom
    if (data.metadata && data.bom) {
      if (!data.metadata.name || typeof data.metadata.name !== 'string') {
        throw new Error('Missing or invalid metadata.name field');
      }

      if (!data.bom.entry_points || !Array.isArray(data.bom.entry_points)) {
        throw new Error('Missing or invalid bom.entry_points array');
      }

      name = data.metadata.name;
      entryPoints = data.bom.entry_points;
      description = data.metadata.description || data.metadata.shortDescription;
      version = data.metadata.version;
      author = data.metadata.author;
    } else {
      // Legacy structure: direct name and entry_points
      if (!data.name || typeof data.name !== 'string') {
        throw new Error('Missing or invalid name field');
      }

      if (!data.entry_points || !Array.isArray(data.entry_points)) {
        throw new Error('Missing or invalid entry_points array');
      }

      name = data.name;
      entryPoints = data.entry_points;
      description = data.description;
      version = data.version;
      author = data.author;
    }

    if (entryPoints.length === 0) {
      throw new Error('No entry points defined in manifest');
    }

    // Validate each entry point
    for (const [i, entryPoint] of entryPoints.entries()) {
      const entryContext = `entry point ${i + 1}`;

      if (!entryPoint.protocol || typeof entryPoint.protocol !== 'string') {
        throw new Error(`Missing or invalid protocol field for ${entryContext}`);
      }
      if (!entryPoint.path || typeof entryPoint.path !== 'string') {
        throw new Error(`Missing or invalid path field for ${entryContext}`);
      }
      if (!entryPoint.patterns || !Array.isArray(entryPoint.patterns)) {
        throw new Error(`Missing or invalid patterns array for ${entryContext}`);
      }
      if (entryPoint.patterns.length === 0) {
        throw new Error(`Empty patterns array for ${entryContext}`);
      }
    }

    return {
      name,
      description,
      version,
      author,
      entry_points: entryPoints
    };
  }

  /**
   * Fetch a single skill by name (optimized for downloadBundle)
   * Only fetches and parses the specific skill needed
   * @param skillName
   * @param skillPath
   * @param owner
   * @param repo
   */
  // eslint-disable-next-line @typescript-eslint/member-ordering -- existing code structure
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
  // eslint-disable-next-line @typescript-eslint/member-ordering -- existing code structure
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
      const skillDirectories = contents.filter((item) => item.type === 'dir');
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
   * @param skillDir
   * @param owner
   * @param repo
   */
  // eslint-disable-next-line @typescript-eslint/member-ordering -- existing code structure
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
      const manifestFile = skillContents.find((file) =>
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
        .filter((item) => item.type === 'file')
        .map((item) => item.name);

      // Create SkillInfo object
      const skillInfo: SkillInfo = {
        id: `olaf-${owner}-${repo}-${skillName}`,
        folderName: skillName,
        path: skillPath,
        manifest,
        files
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
   * @param manifestUrl
   * @param skillFolderName
   */
  // eslint-disable-next-line @typescript-eslint/member-ordering -- existing code structure
  private async parseSkillManifest(manifestUrl: string, skillFolderName?: string): Promise<SkillManifest> {
    this.logger.debug(`[OlafAdapter] Parsing skill manifest from: ${manifestUrl}`);

    try {
      // Download manifest content
      const manifestContent = await this.downloadManifestContent(manifestUrl);
      const manifestText = manifestContent.toString('utf8');

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
        ...rawManifest
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
        license: 'Unknown'
      };

      this.logger.warn(`[OlafAdapter] Using default manifest with name '${defaultManifest.name}' due to parse failure`);
      return defaultManifest;
    }
  }

  /**
   * Download manifest content from GitHub
   * Handles authentication and error cases
   * @param url
   */
  // eslint-disable-next-line @typescript-eslint/member-ordering -- existing code structure
  private async downloadManifestContent(url: string): Promise<Buffer> {
    const https = await import('node:https');

    return new Promise((resolve, reject) => {
      const headers: Record<string, string> = {
        'User-Agent': 'Prompt-Registry-VSCode-Extension',
        Accept: 'application/json'
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
   * @param skill
   */
  // eslint-disable-next-line @typescript-eslint/member-ordering -- existing code structure
  private createBundleFromSkill(skill: SkillInfo): Bundle {
    const { owner, repo } = this.parseGitHubUrl();
    const manifest = skill.manifest;

    // Generate unique bundle ID using format: olaf-{owner}-{repo}-{skillName}
    const bundleId = skill.id; // Already in correct format from SkillInfo

    // Map skill manifest properties to bundle properties with defaults
    // Use folder name if manifest name is missing, empty, or is a default fallback
    const skillName = (manifest.name
      && manifest.name.trim() !== ''
      && manifest.name !== 'Unknown Skill'
      && manifest.name !== 'Unnamed Skill')
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
      downloadUrl: this.getDownloadUrl(bundleId)
    };

    this.logger.debug(`[OlafAdapter] Created bundle: ${bundle.id} (${bundle.name} v${bundle.version})`);
    return bundle;
  }

  /**
   * Normalize tags from skill manifest
   * Ensures 'olaf' and 'skill' tags are always present
   * @param manifestTags
   */
  // eslint-disable-next-line @typescript-eslint/member-ordering -- existing code structure
  private normalizeTags(manifestTags?: string[]): string[] {
    const baseTags = ['olaf', 'skill'];

    if (!manifestTags || !Array.isArray(manifestTags)) {
      return baseTags;
    }

    // Combine manifest tags with base tags, removing duplicates
    const allTags = [...baseTags, ...manifestTags];
    return Array.from(new Set(allTags.map((tag) => tag.toLowerCase())));
  }

  /**
   * Normalize dependencies from skill manifest
   * Converts string array to BundleDependency array
   * @param manifestDependencies
   */
  // eslint-disable-next-line @typescript-eslint/member-ordering -- existing code structure
  private normalizeDependencies(manifestDependencies?: string[]): BundleDependency[] {
    if (!manifestDependencies || !Array.isArray(manifestDependencies)) {
      return [];
    }

    // For now, return as simple dependency objects
    // In the future, this could be enhanced to parse version ranges
    return manifestDependencies.map((dep) => ({
      bundleId: dep,
      versionRange: '*',
      optional: false
    }));
  }

  /**
   * Estimate skill size based on file count
   * Provides a rough size estimate since we don't have actual file sizes
   * @param files
   */
  // eslint-disable-next-line @typescript-eslint/member-ordering -- existing code structure
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
   * @param skill
   */
  // eslint-disable-next-line @typescript-eslint/member-ordering -- existing code structure
  private generateDeploymentManifest(skill: SkillInfo): any {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- destructuring with unused bindings
    const { owner, repo } = this.parseGitHubUrl();
    const manifest = skill.manifest;

    // Create deployment manifest structure with required root-level fields
    const deploymentManifest = {
      // Required root-level fields for BundleInstaller validation
      id: skill.id,
      version: manifest.version || '1.0.0',
      name: manifest.name || skill.folderName,

      metadata: {
        manifest_version: '1.0',
        description: `OLAF Skill: ${manifest.name || skill.folderName}`,
        author: manifest.author || owner,
        last_updated: new Date().toISOString(),
        repository: {
          type: 'git',
          url: this.source.url,
          directory: skill.path
        },
        license: manifest.license || 'Unknown',
        keywords: this.normalizeTags(manifest.tags)
      },

      common: {
        directories: [skill.folderName],
        files: [],
        include_patterns: ['**/*'],
        exclude_patterns: []
      },

      bundle_settings: {
        include_common_in_environment_bundles: true,
        create_common_bundle: true,
        compression: 'zip' as any,
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
          type: 'agent',
          tags: this.normalizeTags(manifest.tags)
        }
      ]
    };

    this.logger.debug(`[OlafAdapter] Generated deployment manifest for skill: ${skill.id}`);
    return deploymentManifest;
  }

  /**
   * Download a bundle from the OLAF repository
   * Downloads all skills defined in the bundle from bundles/ and skills/ directories
   * Creates ZIP from bundle definition using GitHub API
   * Ensures OLAF runtime is installed before bundle installation
   * @param bundle
   */
  public async downloadBundle(bundle: Bundle): Promise<Buffer> {
    const { owner, repo } = this.parseGitHubUrl();

    // Extract bundle file name from bundle ID (format: olaf-{owner}-{repo}-{bundleFileName})
    const bundleFileName = bundle.id.replace(`olaf-${owner}-${repo}-`, '');

    this.logger.info(`[OlafAdapter] Downloading bundle: ${bundleFileName}`);

    try {
      // Ensure OLAF runtime is installed before bundle installation
      await this.ensureRuntimeInstalled();

      // Find the bundle definition info for this bundle
      const bundleDefinitions = await this.scanBundleDefinitions();
      const bundleInfo = bundleDefinitions.find((info) => info.id === bundle.id);

      if (!bundleInfo) {
        throw new Error(`Bundle definition not found: ${bundle.id}`);
      }

      this.logger.info(`[OlafAdapter] Found bundle definition: ${bundleInfo.fileName} with ${bundleInfo.validatedSkills.length} skill(s)`);

      // Package bundle as ZIP with all skills
      const zipBuffer = await this.packageBundleAsZip(bundleInfo);

      this.logger.info(`[OlafAdapter] Successfully packaged bundle ${bundleFileName} (${zipBuffer.length} bytes)`);
      return zipBuffer;
    } catch (error) {
      this.logger.error(`[OlafAdapter] Failed to download bundle ${bundleFileName}: ${error}`);
      throw new Error(`Failed to download OLAF bundle ${bundleFileName}: ${error}`);
    }
  }

  /**
   * Package bundle as ZIP archive from bundle definition
   * Downloads all skill files while preserving folder structure
   * Generates deployment manifest with all skills included
   * Returns Buffer compatible with BundleInstaller.installFromBuffer()
   * @param bundleInfo
   */
  // eslint-disable-next-line @typescript-eslint/member-ordering -- existing code structure
  private async packageBundleAsZip(bundleInfo: BundleDefinitionInfo): Promise<Buffer> {
    const { owner, repo } = this.parseGitHubUrl();
    // eslint-disable-next-line @typescript-eslint/naming-convention -- matches library export name
    const { default: AdmZip } = await import('adm-zip');

    this.logger.debug(`[OlafAdapter] Packaging bundle as ZIP: ${bundleInfo.fileName}`);

    try {
      // Create new ZIP archive
      const zip = new AdmZip();

      // Generate and add deployment manifest with all skills
      const deploymentManifest = this.generateBundleDeploymentManifest(bundleInfo);
      const jsYaml = await import('js-yaml');
      const manifestYaml = jsYaml.default.dump(deploymentManifest);
      zip.addFile('deployment-manifest.yml', Buffer.from(manifestYaml, 'utf8'));

      // Download and add each skill to the ZIP
      for (const skill of bundleInfo.validatedSkills) {
        this.logger.debug(`[OlafAdapter] Adding skill to bundle: ${skill.folderName}`);

        // Get all files in the skill directory from GitHub
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
      }

      // Generate ZIP buffer
      const zipBuffer = zip.toBuffer();

      this.logger.debug(`[OlafAdapter] Created ZIP bundle for ${bundleInfo.fileName}: ${zipBuffer.length} bytes, ${bundleInfo.validatedSkills.length} skill(s)`);
      return zipBuffer;
    } catch (error) {
      this.logger.error(`[OlafAdapter] Failed to package bundle ${bundleInfo.fileName}: ${error}`);
      throw new Error(`Failed to package bundle as ZIP: ${error}`);
    }
  }

  /**
   * Generate deployment manifest for a bundle with multiple skills
   * Includes all skills from bundle definition with entry points for competency index integration
   * Adds required root-level fields (id, version, name) for BundleInstaller validation
   * @param bundleInfo
   */
  // eslint-disable-next-line @typescript-eslint/member-ordering -- existing code structure
  private generateBundleDeploymentManifest(bundleInfo: BundleDefinitionInfo): any {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- destructuring with unused bindings
    const { owner, repo } = this.parseGitHubUrl();
    const { definition, validatedSkills } = bundleInfo;

    // Create deployment manifest structure with required root-level fields
    const deploymentManifest = {
      // Required root-level fields for BundleInstaller validation
      id: bundleInfo.id,
      version: definition.metadata.version || '1.0.0',
      name: definition.metadata.name,

      metadata: {
        manifest_version: '1.0',
        description: `OLAF Bundle: ${definition.metadata.name}`,
        author: definition.metadata.author || owner,
        last_updated: new Date().toISOString(),
        repository: {
          type: 'git',
          url: this.source.url,
          directory: 'bundles'
        },
        license: 'Unknown',
        keywords: [
          ...(definition.metadata.tags || []),
          'olaf',
          'bundle',
          'skills'
        ]
      },

      common: {
        directories: validatedSkills.map((skill) => skill.folderName),
        files: [],
        include_patterns: ['**/*'],
        exclude_patterns: []
      },

      bundle_settings: {
        include_common_in_environment_bundles: true,
        create_common_bundle: true,
        compression: 'zip' as any,
        naming: {
          common_bundle: bundleInfo.fileName
        }
      },

      // Include all skills with their entry points for competency index integration
      prompts: validatedSkills.map((skill) => ({
        id: skill.id,
        name: skill.manifest.name,
        description: skill.manifest.description || 'OLAF Skill',
        file: `${skill.folderName}/manifest.json`,
        type: 'agent' as any,
        tags: skill.manifest.tags || ['olaf', 'skill'],
        entry_points: (skill.manifest as LocalOlafSkillManifest).entry_points || []
      }))
    };

    this.logger.debug(`[OlafAdapter] Generated deployment manifest for bundle: ${bundleInfo.id} with ${validatedSkills.length} skill(s)`);
    return deploymentManifest;
  }

  /**
   * Ensure OLAF runtime is installed and create workspace links
   * Runtime installation is REQUIRED for OLAF skills to function
   */
  // eslint-disable-next-line @typescript-eslint/member-ordering -- existing code structure
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

        if (hasLinks) {
          this.logger.debug('[OlafAdapter] Workspace links already exist');
        } else {
          this.logger.info('[OlafAdapter] Creating workspace symbolic links');
          await this.runtimeManager.createWorkspaceLinks(workspacePath);
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
  // eslint-disable-next-line @typescript-eslint/member-ordering -- existing code structure
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
   * @param skill
   */
  // eslint-disable-next-line @typescript-eslint/member-ordering -- existing code structure
  private async packageSkillAsBundle(skill: SkillInfo): Promise<Buffer> {
    const { owner, repo } = this.parseGitHubUrl();
    // eslint-disable-next-line @typescript-eslint/naming-convention -- matches library export name
    const { default: AdmZip } = await import('adm-zip');

    this.logger.debug(`[OlafAdapter] Packaging skill as bundle: ${skill.folderName}`);

    try {
      // Create new ZIP archive
      const zip = new AdmZip();

      // Generate and add deployment manifest
      const deploymentManifest = this.generateDeploymentManifest(skill);
      const jsYaml = await import('js-yaml');
      const manifestYaml = jsYaml.default.dump(deploymentManifest);
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
   * @param zip
   * @param owner
   * @param repo
   * @param dirPath
   * @param zipPath
   */
  // eslint-disable-next-line @typescript-eslint/member-ordering -- existing code structure
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
   * @param url
   */
  // eslint-disable-next-line @typescript-eslint/member-ordering -- existing code structure
  private async downloadFileContent(url: string): Promise<Buffer> {
    const https = await import('node:https');

    return new Promise((resolve, reject) => {
      const headers: Record<string, string> = {
        'User-Agent': 'Prompt-Registry-VSCode-Extension'
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
  public async fetchMetadata(): Promise<SourceMetadata> {
    try {
      const githubMetadata = await this.githubAdapter.fetchMetadata();
      const bundleDefinitions = await this.scanBundleDefinitions();

      // Count total skills across all bundles
      let totalSkills = 0;
      for (const bundleInfo of bundleDefinitions) {
        totalSkills += bundleInfo.validatedSkills.length;
      }

      return {
        ...githubMetadata,
        name: `${githubMetadata.name} (OLAF Bundles)`,
        description: `OLAF repository with ${bundleDefinitions.length} bundle(s) containing ${totalSkills} skill(s)`,
        bundleCount: bundleDefinitions.length
      };
    } catch (error) {
      throw new Error(`Failed to fetch OLAF metadata: ${error}`);
    }
  }

  /**
   * Get manifest URL for a bundle
   * Points to the bundle definition JSON file in bundles/ directory
   * @param bundleId
   * @param _version
   */
  public getManifestUrl(bundleId: string, _version?: string): string {
    const { owner, repo } = this.parseGitHubUrl();
    // Extract bundle file name from bundle ID (format: olaf-{owner}-{repo}-{bundleFileName})
    const bundleFileName = bundleId.replace(`olaf-${owner}-${repo}-`, '');
    return `https://api.github.com/repos/${owner}/${repo}/contents/bundles/${bundleFileName}.json`;
  }

  /**
   * Get download URL for a bundle
   * Points to the bundle definition file which contains skill references
   * @param bundleId
   * @param _version
   */
  public getDownloadUrl(bundleId: string, _version?: string): string {
    const { owner, repo } = this.parseGitHubUrl();
    // Extract bundle file name from bundle ID (format: olaf-{owner}-{repo}-{bundleFileName})
    const bundleFileName = bundleId.replace(`olaf-${owner}-${repo}-`, '');
    return `https://api.github.com/repos/${owner}/${repo}/contents/bundles/${bundleFileName}.json`;
  }

  /**
   * Post-installation hook for OLAF bundles
   * Registers all skills in the bundle in the competency index after successful installation
   * @param bundleId
   * @param installPath
   */
  public async postInstall(bundleId: string, installPath: string): Promise<void> {
    this.logger.info(`[OlafAdapter] Running post-installation for bundle: ${bundleId}`);

    try {
      await this.registerBundleInCompetencyIndex(bundleId, installPath);
      this.logger.info(`[OlafAdapter] Post-installation completed successfully`);
    } catch (error) {
      this.logger.error(`[OlafAdapter] Post-installation failed: ${error}`);
      // Don't throw - post-installation failures shouldn't break the installation
    }
  }

  /**
   * Post-uninstallation hook for OLAF bundles
   * Removes all skills in the bundle from the competency index after successful uninstallation
   * @param bundleId
   * @param installPath
   */
  public async postUninstall(bundleId: string, installPath: string): Promise<void> {
    this.logger.info(`[OlafAdapter] Running post-uninstallation for bundle: ${bundleId}`);

    try {
      await this.unregisterBundleFromCompetencyIndex(bundleId, installPath);
      this.logger.info(`[OlafAdapter] Post-uninstallation completed successfully`);
    } catch (error) {
      this.logger.error(`[OlafAdapter] Post-uninstallation failed: ${error}`);
      // Don't throw - post-uninstallation failures shouldn't break the uninstallation
    }
  }

  /**
   * Register OLAF bundle skills in competency index
   * Updates .olaf/olaf-core/reference/competency-index.json with all skill information
   * @param bundleId
   * @param installPath
   */
  // eslint-disable-next-line @typescript-eslint/member-ordering -- existing code structure
  private async registerBundleInCompetencyIndex(bundleId: string, installPath: string): Promise<void> {
    this.logger.info(`[OlafAdapter] Registering bundle skills in competency index: ${bundleId}`);
    this.logger.info(`[OlafAdapter] Install path: ${installPath}`);

    try {
      const fs = await import('node:fs');
      const path = await import('node:path');

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

      if (fs.existsSync(competencyIndexDir)) {
        this.logger.info(`[OlafAdapter] Directory already exists`);
      } else {
        this.logger.info(`[OlafAdapter] Directory does not exist, creating: ${competencyIndexDir}`);
        fs.mkdirSync(competencyIndexDir, { recursive: true });
        this.logger.info(`[OlafAdapter] Directory created successfully`);
      }

      // Read existing competency index or create new one
      let competencyIndex: any[] = [];
      if (fs.existsSync(competencyIndexPath)) {
        this.logger.info(`[OlafAdapter] Reading existing competency index`);
        const content = fs.readFileSync(competencyIndexPath, 'utf8');
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

      // Find the bundle definition to get skill information
      const bundleDefinitions = await this.scanBundleDefinitions();
      const bundleInfo = bundleDefinitions.find((info) => info.id === bundleId);

      if (!bundleInfo) {
        this.logger.warn(`[OlafAdapter] Bundle definition not found for ${bundleId}, skipping competency index registration`);
        return;
      }

      // Get the actual source name instead of extracting from install path
      const sourceName = this.getSourceName();
      this.logger.info(`[OlafAdapter] Using source name: ${sourceName}`);

      // Process each skill in the bundle
      for (const skill of bundleInfo.validatedSkills) {
        await this.registerSkillEntryPoints(skill, sourceName, competencyIndex);
      }

      // Write updated competency index
      this.logger.info(`[OlafAdapter] Writing updated competency index with ${competencyIndex.length} skills`);
      const competencyIndexContent = JSON.stringify(competencyIndex, null, 2);

      fs.writeFileSync(competencyIndexPath, competencyIndexContent, 'utf8');
      this.logger.info(`[OlafAdapter] File write completed`);

      // Verify the file was written correctly
      if (fs.existsSync(competencyIndexPath)) {
        const verifyContent = fs.readFileSync(competencyIndexPath, 'utf8');
        const verifyIndex = JSON.parse(verifyContent);

        if (Array.isArray(verifyIndex)) {
          this.logger.info(`[OlafAdapter] Competency index verification successful: ${verifyIndex.length} total skills`);
        } else {
          this.logger.error(`[OlafAdapter] Competency index verification failed: invalid format`);
        }
      } else {
        this.logger.error(`[OlafAdapter] Competency index file does not exist after write`);
      }

      this.logger.info(`[OlafAdapter] Successfully registered ${bundleInfo.validatedSkills.length} skills in competency index`);
    } catch (error) {
      this.logger.error(`[OlafAdapter] Failed to register bundle in competency index: ${error}`);
      if (error instanceof Error) {
        this.logger.error(`[OlafAdapter] Error stack: ${error.stack}`);
      }
      throw error;
    }
  }

  /**
   * Get source name for competency index paths
   * Uses source.name with fallback to source.id
   */
  // eslint-disable-next-line @typescript-eslint/member-ordering -- existing code structure
  private getSourceName(): string {
    return this.source.name || this.source.id;
  }

  /**
   * Register a single skill's entry points in the competency index
   * @param skill
   * @param sourceName
   * @param competencyIndex
   */
  // eslint-disable-next-line @typescript-eslint/member-ordering, @typescript-eslint/require-await -- existing code structure; method signature requires Promise return type
  private async registerSkillEntryPoints(skill: SkillInfo, sourceName: string, competencyIndex: any[]): Promise<void> {
    try {
      // Extract entry points from skill manifest
      const manifest = skill.manifest as LocalOlafSkillManifest;
      const entryPoints = manifest.entry_points || [];

      if (entryPoints.length === 0) {
        this.logger.warn(`[OlafAdapter] Skill ${skill.id} has no entry points, skipping competency index registration`);
        return;
      }

      // Process each entry point
      for (const entryPoint of entryPoints) {
        // Construct the file path for the competency index
        // Format: external-skills/{sourceName}/{skillName}{entryPoint.path}
        const promptFilePath = `external-skills/${sourceName}/${skill.folderName}${entryPoint.path}`;

        this.logger.info(`[OlafAdapter] Processing entry point for skill ${skill.id}: ${promptFilePath}`);

        // Create skill entry for competency index in the correct format
        const skillEntry = {
          patterns: entryPoint.patterns || [],
          file: promptFilePath,
          protocol: entryPoint.protocol || 'Propose-Act'
        };

        // Check if skill already exists in index (match by file path)
        const existingIndex = competencyIndex.findIndex((s: any) => s.file === skillEntry.file);

        if (existingIndex === -1) {
          // Add new entry
          this.logger.info(`[OlafAdapter] Adding new skill entry to competency index: ${skillEntry.file}`);
          competencyIndex.push(skillEntry);
        } else {
          // Update existing entry
          this.logger.info(`[OlafAdapter] Updating existing skill entry in competency index: ${skillEntry.file}`);
          competencyIndex[existingIndex] = skillEntry;
        }
      }
    } catch (error) {
      this.logger.error(`[OlafAdapter] Failed to register skill ${skill.id} entry points: ${error}`);
      throw error;
    }
  }

  /**
   * Unregister OLAF bundle from competency index
   * Removes all skill entries from .olaf/olaf-core/reference/competency-index.json
   * @param bundleId
   * @param installPath
   */
  // eslint-disable-next-line @typescript-eslint/member-ordering -- existing code structure
  private async unregisterBundleFromCompetencyIndex(bundleId: string, installPath: string): Promise<void> {
    this.logger.info(`[OlafAdapter] Unregistering bundle from competency index: ${bundleId}`);
    this.logger.info(`[OlafAdapter] Install path: ${installPath}`);

    try {
      const fs = await import('node:fs');
      const path = await import('node:path');

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
      const content = fs.readFileSync(competencyIndexPath, 'utf8');
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

      // Get the actual source name instead of extracting from install path
      const sourceName = this.getSourceName();
      this.logger.info(`[OlafAdapter] Using source name: ${sourceName}`);

      // Find the bundle definition to get skill information
      // Note: We need to try to get the bundle info, but it may not be available during uninstall
      let bundleInfo: BundleDefinitionInfo | undefined;
      try {
        const bundleDefinitions = await this.scanBundleDefinitions();
        bundleInfo = bundleDefinitions.find((info) => info.id === bundleId);
      } catch (error) {
        this.logger.warn(`[OlafAdapter] Could not scan bundle definitions during uninstall: ${error}`);
      }

      const initialLength = competencyIndex.length;

      if (bundleInfo) {
        // Remove entries for each skill in the bundle
        for (const skill of bundleInfo.validatedSkills) {
          const manifest = skill.manifest as LocalOlafSkillManifest;
          const entryPoints = manifest.entry_points || [];

          for (const entryPoint of entryPoints) {
            const promptFilePath = `external-skills/${sourceName}/${skill.folderName}${entryPoint.path}`;
            competencyIndex = competencyIndex.filter((s: any) => s.file !== promptFilePath);
            this.logger.info(`[OlafAdapter] Removed entry: ${promptFilePath}`);
          }
        }
      } else {
        // Fallback: Remove all entries that match the source name pattern
        const pattern = `external-skills/${sourceName}/`;
        competencyIndex = competencyIndex.filter((s: any) => !s.file.startsWith(pattern));
        this.logger.info(`[OlafAdapter] Removed all entries matching pattern: ${pattern}`);
      }

      const finalLength = competencyIndex.length;

      if (initialLength > finalLength) {
        this.logger.info(`[OlafAdapter] Removed ${initialLength - finalLength} skill(s) from competency index`);

        // Write updated competency index
        const competencyIndexContent = JSON.stringify(competencyIndex, null, 2);
        this.logger.info(`[OlafAdapter] Writing updated competency index`);

        fs.writeFileSync(competencyIndexPath, competencyIndexContent, 'utf8');
        this.logger.info(`[OlafAdapter] File write completed`);

        // Verify the file was written correctly
        if (fs.existsSync(competencyIndexPath)) {
          const verifyContent = fs.readFileSync(competencyIndexPath, 'utf8');
          const verifyIndex = JSON.parse(verifyContent);

          if (Array.isArray(verifyIndex)) {
            this.logger.info(`[OlafAdapter] Verification: File exists and contains ${verifyIndex.length} skills`);
          }
        } else {
          this.logger.error(`[OlafAdapter] Verification: File does not exist after write!`);
        }
      } else {
        this.logger.info(`[OlafAdapter] No skills found to remove from competency index`);
      }

      this.logger.info(`[OlafAdapter] Successfully processed bundle unregistration`);
    } catch (error) {
      this.logger.error(`[OlafAdapter] Failed to unregister bundle from competency index: ${error}`);
      if (error instanceof Error) {
        this.logger.error(`[OlafAdapter] Error stack: ${error.stack}`);
      }
      throw error;
    }
  }

  /**
   * Make GitHub API request with authentication
   * Uses the same authentication logic as GitHubAdapter
   * @param url
   */
  // eslint-disable-next-line @typescript-eslint/member-ordering -- existing code structure
  private async makeGitHubRequest(url: string): Promise<any> {
    const https = await import('node:https');
    // eslint-disable-next-line @typescript-eslint/no-shadow -- intentional shadowing in nested scope
    const vscode = await import('vscode');
    const { exec } = await import('node:child_process');
    const { promisify } = await import('node:util');
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
        Accept: 'application/json'
      };

      if (authToken) {
        headers = {
          ...headers,
          Authorization: `token ${authToken}`
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

/**
 * Local OLAF filesystem adapter
 * Handles local filesystem directories containing OLAF skills organized in bundle-based structure
 */

import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import AdmZip = require('adm-zip');
import * as yaml from 'js-yaml';
import * as vscode from 'vscode';
import { RepositoryAdapter } from './RepositoryAdapter';
import { Bundle, SourceMetadata, ValidationResult, RegistrySource } from '../types/registry';
import { BundleDefinition, BundleDefinitionInfo, LocalOlafSkillManifest, SkillInfo, SkillReference } from '../types/olaf';
import { Logger } from '../utils/logger';
import { OlafRuntimeManager } from '../services/OlafRuntimeManager';

// Promisified fs functions
const readdir = promisify(fs.readdir);
const readFile = promisify(fs.readFile);
const stat = promisify(fs.stat);
const access = promisify(fs.access);

/**
 * Local OLAF filesystem adapter implementation
 * Expects a directory structure with bundles/ and skills/ subdirectories
 */
export class LocalOlafAdapter extends RepositoryAdapter {
    readonly type = 'local-olaf';
    private logger: Logger;
    private runtimeManager: OlafRuntimeManager;

    constructor(source: RegistrySource) {
        super(source);
        this.logger = Logger.getInstance();
        this.runtimeManager = OlafRuntimeManager.getInstance();
        
        if (!this.isValidLocalPath(source.url)) {
            throw new Error(`Invalid local OLAF path: ${source.url}`);
        }
    }

    /**
     * Get local directory path from file:// URL or direct path
     */
    private getLocalPath(): string {
        let localPath = this.source.url;
        
        // Handle file:// URL
        if (localPath.startsWith('file://')) {
            localPath = localPath.substring(7);
        }
        
        // Expand home directory
        if (localPath.startsWith('~/')) {
            const os = require('os');
            localPath = path.join(os.homedir(), localPath.slice(2));
        }
        
        // Normalize path
        return path.normalize(localPath);
    }

    /**
     * Check if path is valid local filesystem path
     */
    private isValidLocalPath(url: string): boolean {
        // Accept file:// URLs or absolute paths
        return url.startsWith('file://') || 
               path.isAbsolute(url) ||
               url.startsWith('~/') ||
               url.startsWith('./');
    }

    /**
     * Check if directory exists and is accessible
     */
    private async directoryExists(dirPath: string): Promise<boolean> {
        try {
            await access(dirPath, fs.constants.R_OK);
            const stats = await stat(dirPath);
            return stats.isDirectory();
        } catch {
            return false;
        }
    }

    /**
     * Validate directory structure for local OLAF source with detailed error reporting
     * Must contain both bundles/ and skills/ subdirectories
     * Supports multiple local OLAF sources with independent operation
     */
    private async validateDirectoryStructure(): Promise<ValidationResult> {
        const localPath = this.getLocalPath();
        const errors: string[] = [];
        const warnings: string[] = [];

        this.logger.debug(`[LocalOlafAdapter] Validating directory structure: ${localPath}`);

        // Check if main directory exists and is accessible
        try {
            await access(localPath, fs.constants.R_OK);
            const stats = await stat(localPath);
            if (!stats.isDirectory()) {
                return {
                    valid: false,
                    errors: [`Path is not a directory: ${localPath}`],
                    warnings: [],
                };
            }
        } catch (error) {
            const errorCode = (error as NodeJS.ErrnoException).code;
            let errorMessage = `Directory not accessible: ${localPath}`;
            
            if (errorCode === 'ENOENT') {
                errorMessage = `Directory does not exist: ${localPath}`;
            } else if (errorCode === 'EACCES') {
                errorMessage = `Permission denied accessing directory: ${localPath}`;
            } else if (errorCode === 'ENOTDIR') {
                errorMessage = `Path is not a directory: ${localPath}`;
            }
            
            return {
                valid: false,
                errors: [errorMessage],
                warnings: [],
            };
        }

        // Check for bundles/ directory
        const bundlesPath = path.join(localPath, 'bundles');
        if (!(await this.directoryExists(bundlesPath))) {
            errors.push(`Missing required 'bundles' directory: ${bundlesPath}`);
        } else {
            // Check if bundles directory is readable
            try {
                await access(bundlesPath, fs.constants.R_OK);
            } catch (error) {
                errors.push(`Cannot read bundles directory: ${bundlesPath}`);
            }
        }

        // Check for skills/ directory
        const skillsPath = path.join(localPath, 'skills');
        if (!(await this.directoryExists(skillsPath))) {
            errors.push(`Missing required 'skills' directory: ${skillsPath}`);
        } else {
            // Check if skills directory is readable
            try {
                await access(skillsPath, fs.constants.R_OK);
            } catch (error) {
                errors.push(`Cannot read skills directory: ${skillsPath}`);
            }
        }

        // Check for common issues that might indicate wrong directory
        if (errors.length === 0) {
            try {
                const entries = await readdir(localPath);
                const hasGitDir = entries.includes('.git');
                const hasPackageJson = entries.includes('package.json');
                const hasReadme = entries.some(entry => entry.toLowerCase().startsWith('readme'));
                
                if (hasGitDir && !hasReadme) {
                    warnings.push('Directory appears to be a Git repository but lacks documentation. Verify this is the correct OLAF source directory.');
                }
                
                if (hasPackageJson) {
                    warnings.push('Directory contains package.json. Verify this is an OLAF source directory and not a Node.js project.');
                }
            } catch (error) {
                // Ignore errors in additional checks
            }
        }

        const isValid = errors.length === 0;
        
        if (isValid) {
            this.logger.debug(`[LocalOlafAdapter] Directory structure validation passed: ${localPath}`);
        } else {
            this.logger.warn(`[LocalOlafAdapter] Directory structure validation failed: ${errors.join(', ')}`);
        }

        return {
            valid: isValid,
            errors,
            warnings,
        };
    }

    /**
     * Validate local OLAF source accessibility and structure with comprehensive reporting
     * Checks if the directory exists and contains required bundles/ and skills/ directories
     * Provides detailed validation reporting for source configuration
     * 
     * @returns Promise resolving to ValidationResult with detailed status and any warnings
     */
    async validate(): Promise<ValidationResult> {
        const errors: string[] = [];
        const warnings: string[] = [];
        
        try {
            this.logger.info(`[LocalOlafAdapter] Validating local OLAF source: ${this.source.url}`);
            
            // Validate directory structure
            const structureValidation = await this.validateDirectoryStructure();
            if (!structureValidation.valid) {
                errors.push(...structureValidation.errors);
                warnings.push(...structureValidation.warnings);
                
                return {
                    valid: false,
                    errors,
                    warnings,
                };
            }
            
            // Validate bundle definitions and skills
            let bundleCount = 0;
            let skillCount = 0;
            let bundleErrors = 0;
            let skillErrors = 0;
            
            try {
                const bundleDefinitions = await this.scanBundleDefinitions();
                bundleCount = bundleDefinitions.length;
                
                // Count total skills and track errors
                for (const bundleInfo of bundleDefinitions) {
                    skillCount += bundleInfo.validatedSkills.length;
                }
                
                if (bundleCount === 0) {
                    warnings.push('No valid bundle definitions found in bundles/ directory');
                } else {
                    this.logger.info(`[LocalOlafAdapter] Found ${bundleCount} valid bundle(s) with ${skillCount} total skill(s)`);
                }
                
            } catch (scanError) {
                // scanBundleDefinitions already handles individual bundle errors gracefully
                // If it throws, it means the bundles directory is completely inaccessible
                errors.push(`Failed to scan bundle definitions: ${scanError}`);
            }
            
            // Additional validation checks
            await this.performAdditionalValidation(warnings);
            
            // Determine overall validation result
            const isValid = errors.length === 0;
            
            if (isValid) {
                this.logger.info(`[LocalOlafAdapter] Validation successful: ${bundleCount} bundle(s), ${skillCount} skill(s)`);
            } else {
                this.logger.warn(`[LocalOlafAdapter] Validation failed with ${errors.length} error(s) and ${warnings.length} warning(s)`);
            }
            
            return {
                valid: isValid,
                errors,
                warnings,
            };
            
        } catch (error) {
            const errorMsg = `Local OLAF source validation failed: ${error}`;
            this.logger.error(`[LocalOlafAdapter] ${errorMsg}`);
            
            return {
                valid: false,
                errors: [errorMsg],
                warnings,
            };
        }
    }

    /**
     * Perform additional validation checks for source configuration
     */
    private async performAdditionalValidation(warnings: string[]): Promise<void> {
        const localPath = this.getLocalPath();
        
        try {
            // Check if path is too long (Windows limitation)
            if (localPath.length > 260) {
                warnings.push('Path length exceeds Windows maximum (260 characters). This may cause issues on Windows systems.');
            }
            
            // Check for common directory structure issues
            const bundlesPath = path.join(localPath, 'bundles');
            const skillsPath = path.join(localPath, 'skills');
            
            // Check if directories are empty
            try {
                const bundleFiles = await readdir(bundlesPath);
                const jsonFiles = bundleFiles.filter(file => file.endsWith('.json'));
                if (jsonFiles.length === 0) {
                    warnings.push('bundles/ directory contains no JSON files');
                }
            } catch (error) {
                // Already handled in directory structure validation
            }
            
            try {
                const skillDirs = await readdir(skillsPath, { withFileTypes: true });
                const directories = skillDirs.filter(entry => entry.isDirectory());
                if (directories.length === 0) {
                    warnings.push('skills/ directory contains no subdirectories');
                }
            } catch (error) {
                // Already handled in directory structure validation
            }
            
            // Check for write permissions (needed for competency index updates)
            try {
                await access(localPath, fs.constants.W_OK);
            } catch (error) {
                warnings.push('Source directory is not writable. This may prevent competency index updates.');
            }
            
        } catch (error) {
            this.logger.debug(`[LocalOlafAdapter] Additional validation checks failed: ${error}`);
            // Don't add to warnings as these are optional checks
        }
    }

    /**
     * Fetch repository metadata from local OLAF filesystem
     * 
     * @returns Promise resolving to SourceMetadata with directory info
     * @throws Error if directory doesn't exist or is not accessible
     */
    async fetchMetadata(): Promise<SourceMetadata> {
        try {
            const localPath = this.getLocalPath();
            const validation = await this.validateDirectoryStructure();

            if (!validation.valid) {
                throw new Error(`Invalid directory structure: ${validation.errors.join(', ')}`);
            }

            // Count bundles by scanning bundles directory
            const bundlesPath = path.join(localPath, 'bundles');
            const bundleFiles = await readdir(bundlesPath);
            const jsonFiles = bundleFiles.filter(file => file.endsWith('.json'));

            // Get directory modification time
            const stats = await stat(localPath);

            return {
                name: path.basename(localPath),
                description: 'Local OLAF Skills Registry',
                bundleCount: jsonFiles.length,
                lastUpdated: stats.mtime.toISOString(),
                version: '1.0.0',
            };
        } catch (error) {
            throw new Error(`Failed to fetch local OLAF registry metadata: ${error}`);
        }
    }

    /**
     * Read and parse JSON file with detailed error reporting
     */
    private async readJsonFile(filePath: string): Promise<any> {
        try {
            const content = await readFile(filePath, 'utf-8');
            return JSON.parse(content);
        } catch (error) {
            if (error instanceof SyntaxError) {
                throw new Error(`Invalid JSON syntax in ${path.basename(filePath)}: ${error.message}`);
            } else if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                throw new Error(`File not found: ${path.basename(filePath)}`);
            } else if ((error as NodeJS.ErrnoException).code === 'EACCES') {
                throw new Error(`Permission denied reading file: ${path.basename(filePath)}`);
            } else {
                throw new Error(`Failed to read file ${path.basename(filePath)}: ${error}`);
            }
        }
    }

    /**
     * Parse skill manifest and extract entry points with detailed error reporting
     */
    private async parseSkillManifest(skillPath: string): Promise<LocalOlafSkillManifest> {
        try {
            const data = await this.readJsonFile(skillPath);
            const fileName = path.basename(skillPath);
            
            // Handle different manifest structures
            let name: string;
            let entryPoints: any[];
            let description: string | undefined;
            let version: string | undefined;
            let author: string | undefined;
            
            // Check if this is the new structure with metadata and bom
            if (data.metadata && data.bom) {
                // New structure: metadata.name and bom.entry_points
                if (!data.metadata.name || typeof data.metadata.name !== 'string') {
                    throw new Error(`Missing or invalid metadata.name field in ${fileName}`);
                }
                
                if (!data.bom.entry_points || !Array.isArray(data.bom.entry_points)) {
                    throw new Error(`Missing or invalid bom.entry_points array in ${fileName}`);
                }
                
                name = data.metadata.name;
                entryPoints = data.bom.entry_points;
                description = data.metadata.description || data.metadata.shortDescription;
                version = data.metadata.version;
                author = data.metadata.author;
            } else {
                // Legacy structure: direct name and entry_points
                if (!data.name || typeof data.name !== 'string') {
                    throw new Error(`Missing or invalid name field in ${fileName}`);
                }
                
                if (!data.entry_points || !Array.isArray(data.entry_points)) {
                    throw new Error(`Missing or invalid entry_points array in ${fileName}`);
                }
                
                name = data.name;
                entryPoints = data.entry_points;
                description = data.description;
                version = data.version;
                author = data.author;
            }
            
            if (entryPoints.length === 0) {
                throw new Error(`No entry points defined in ${fileName}`);
            }
            
            // Validate each entry point with detailed error messages
            for (let i = 0; i < entryPoints.length; i++) {
                const entryPoint = entryPoints[i];
                const entryContext = `entry point ${i + 1} in ${fileName}`;
                
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
            
            // Return normalized manifest structure
            const normalizedManifest: LocalOlafSkillManifest = {
                name,
                description,
                version,
                author,
                entry_points: entryPoints
            };
            
            return normalizedManifest;
        } catch (error) {
            if (error instanceof SyntaxError) {
                throw new Error(`Invalid JSON syntax in ${path.basename(skillPath)}: ${error.message}`);
            }
            throw error;
        }
    }

    /**
     * Validate that all skills referenced in bundle definition exist and are valid
     * Provides detailed error messages for validation failures
     */
    private async validateSkillReferences(bundleDefinition: BundleDefinition): Promise<SkillInfo[]> {
        const localPath = this.getLocalPath();
        const validatedSkills: SkillInfo[] = [];
        const errors: string[] = [];

        for (let i = 0; i < bundleDefinition.skills.length; i++) {
            const skillRef = bundleDefinition.skills[i];
            const skillContext = `skill "${skillRef.name}" (${i + 1}/${bundleDefinition.skills.length})`;
            
            try {
                // Check if skill directory exists
                const skillPath = path.join(localPath, skillRef.path);
                if (!(await this.directoryExists(skillPath))) {
                    errors.push(`${skillContext}: Directory does not exist at path "${skillRef.path}"`);
                    continue;
                }

                // Check if manifest file exists
                const manifestPath = path.join(localPath, skillRef.manifest);
                try {
                    await access(manifestPath, fs.constants.R_OK);
                } catch {
                    errors.push(`${skillContext}: Manifest file does not exist at path "${skillRef.manifest}"`);
                    continue;
                }

                // Parse and validate manifest with detailed error context
                let manifest: LocalOlafSkillManifest;
                try {
                    manifest = await this.parseSkillManifest(manifestPath);
                } catch (manifestError) {
                    errors.push(`${skillContext}: Invalid manifest file - ${manifestError}`);
                    continue;
                }
                
                // Get list of files in skill directory
                let files: string[];
                try {
                    files = await this.getSkillFiles(skillPath);
                } catch (filesError) {
                    errors.push(`${skillContext}: Failed to read skill files - ${filesError}`);
                    continue;
                }
                
                // Create SkillInfo object
                const skillInfo: SkillInfo = {
                    id: `${skillRef.name.toLowerCase().replace(/\s+/g, '-')}`,
                    folderName: path.basename(skillPath),
                    path: skillRef.path,
                    manifest,
                    files,
                };
                
                validatedSkills.push(skillInfo);
                this.logger.debug(`[LocalOlafAdapter] Validated ${skillContext}: ${files.length} files, ${manifest.entry_points?.length || 0} entry points`);
                
            } catch (error) {
                const errorMsg = `${skillContext}: Unexpected validation error - ${error}`;
                errors.push(errorMsg);
                this.logger.error(`[LocalOlafAdapter] ${errorMsg}`);
            }
        }

        if (errors.length > 0) {
            const errorSummary = `Skill validation failed for bundle "${bundleDefinition.metadata.name}": ${errors.length} error(s):\n${errors.map(e => `  - ${e}`).join('\n')}`;
            throw new Error(errorSummary);
        }

        if (validatedSkills.length === 0) {
            throw new Error(`No valid skills found in bundle "${bundleDefinition.metadata.name}"`);
        }

        return validatedSkills;
    }

    /**
     * Get list of files in skill directory recursively
     */
    private async getSkillFiles(skillPath: string): Promise<string[]> {
        const files: string[] = [];
        
        const scanDirectory = async (dirPath: string, relativePath: string = ''): Promise<void> => {
            try {
                const entries = await readdir(dirPath, { withFileTypes: true });
                
                for (const entry of entries) {
                    const fullPath = path.join(dirPath, entry.name);
                    const relativeFilePath = path.join(relativePath, entry.name);
                    
                    if (entry.isFile()) {
                        files.push(relativeFilePath);
                    } else if (entry.isDirectory()) {
                        await scanDirectory(fullPath, relativeFilePath);
                    }
                }
            } catch (error) {
                // Ignore errors for inaccessible directories
            }
        };
        
        await scanDirectory(skillPath);
        return files;
    }

    /**
     * Updated scanBundleDefinitions to include skill validation with comprehensive error handling
     * Continues processing valid bundles when some are invalid
     */
    private async scanBundleDefinitions(): Promise<BundleDefinitionInfo[]> {
        const localPath = this.getLocalPath();
        const bundlesPath = path.join(localPath, 'bundles');
        const bundleDefinitions: BundleDefinitionInfo[] = [];
        const errors: string[] = [];
        const warnings: string[] = [];

        try {
            const entries = await readdir(bundlesPath, { withFileTypes: true });
            
            for (const entry of entries) {
                if (entry.isFile() && entry.name.endsWith('.json')) {
                    const filePath = path.join(bundlesPath, entry.name);
                    
                    try {
                        const definition = await this.parseBundleDefinition(filePath);
                        const fileName = path.basename(entry.name, '.json');
                        const bundleId = `local-olaf-${fileName}`;
                        
                        // Validate skill references with detailed error handling
                        try {
                            const validatedSkills = await this.validateSkillReferences(definition);
                            
                            bundleDefinitions.push({
                                id: bundleId,
                                fileName,
                                filePath,
                                definition,
                                validatedSkills,
                            });
                            
                            this.logger.info(`[LocalOlafAdapter] Successfully processed bundle: ${fileName} (${validatedSkills.length} skills)`);
                        } catch (skillError) {
                            const errorMsg = `Bundle ${fileName}: ${skillError}`;
                            errors.push(errorMsg);
                            this.logger.warn(`[LocalOlafAdapter] ${errorMsg}`);
                            // Continue processing other bundles
                        }
                    } catch (parseError) {
                        const errorMsg = `Failed to parse bundle definition ${entry.name}: ${parseError}`;
                        errors.push(errorMsg);
                        this.logger.warn(`[LocalOlafAdapter] ${errorMsg}`);
                        // Continue processing other bundles
                    }
                }
            }
            
            // Log summary of processing results
            if (bundleDefinitions.length > 0) {
                this.logger.info(`[LocalOlafAdapter] Successfully processed ${bundleDefinitions.length} bundle(s)`);
            }
            
            if (errors.length > 0) {
                this.logger.warn(`[LocalOlafAdapter] Encountered ${errors.length} error(s) while processing bundles:`);
                errors.forEach(error => this.logger.warn(`[LocalOlafAdapter] - ${error}`));
                
                // Show user-friendly notification for bundle processing errors
                vscode.window.showWarningMessage(
                    `Some bundle definitions could not be processed (${errors.length} errors). Check the output for details.`,
                    'Show Details'
                ).then(selection => {
                    if (selection === 'Show Details') {
                        const errorDetails = errors.join('\n\n');
                        vscode.window.showInformationMessage(
                            `Bundle Processing Errors:\n\n${errorDetails}`,
                            { modal: true }
                        );
                    }
                });
            }
            
        } catch (error) {
            const errorMsg = `Failed to scan bundle definitions directory: ${error}`;
            this.logger.error(`[LocalOlafAdapter] ${errorMsg}`);
            throw new Error(errorMsg);
        }

        return bundleDefinitions;
    }

    /**
     * Parse and validate bundle definition JSON file with detailed error reporting
     */
    private async parseBundleDefinition(bundlePath: string): Promise<BundleDefinition> {
        try {
            const data = await this.readJsonFile(bundlePath);
            
            // Validate required structure with specific error messages
            if (!data.metadata || typeof data.metadata !== 'object') {
                throw new Error(`Missing or invalid metadata section in ${path.basename(bundlePath)}`);
            }
            
            if (!data.metadata.name || typeof data.metadata.name !== 'string') {
                throw new Error(`Missing or invalid metadata.name in ${path.basename(bundlePath)}`);
            }
            
            if (!data.metadata.description || typeof data.metadata.description !== 'string') {
                throw new Error(`Missing or invalid metadata.description in ${path.basename(bundlePath)}`);
            }
            
            if (!data.skills || !Array.isArray(data.skills)) {
                throw new Error(`Missing or invalid skills array in ${path.basename(bundlePath)}`);
            }
            
            if (data.skills.length === 0) {
                throw new Error(`Bundle ${path.basename(bundlePath)} contains no skills`);
            }
            
            // Validate each skill reference with detailed error messages
            for (let i = 0; i < data.skills.length; i++) {
                const skill = data.skills[i];
                const skillContext = `skill ${i + 1} in ${path.basename(bundlePath)}`;
                
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
                throw new Error(`Invalid JSON syntax in ${path.basename(bundlePath)}: ${error.message}`);
            }
            throw error;
        }
    }

    /**
     * Create Bundle object from BundleDefinitionInfo with proper metadata mapping
     */
    private createBundleFromDefinition(bundleInfo: BundleDefinitionInfo): Bundle {
        const { definition, validatedSkills } = bundleInfo;
        const localPath = this.getLocalPath();
        
        // Generate unique bundle ID
        const bundleId = bundleInfo.id;
        
        // Map bundle definition properties to Bundle properties with defaults
        const bundle: Bundle = {
            id: bundleId,
            name: definition.metadata.name,
            version: definition.metadata.version || '1.0.0',
            description: definition.metadata.description,
            author: definition.metadata.author || 'Unknown',
            sourceId: this.source.id,
            environments: ['copilot'], // Local OLAF bundles are for Copilot environment
            tags: [
                ...(definition.metadata.tags || []),
                'local-olaf',
                'bundle',
                'skills'
            ],
            downloads: 0, // Not applicable for local sources
            rating: 0, // Not applicable for local sources
            lastUpdated: new Date().toISOString(), // Use current time for local bundles
            size: `${validatedSkills.length} skill${validatedSkills.length !== 1 ? 's' : ''}`,
            dependencies: [], // Local OLAF bundles don't have dependencies in this version
            homepage: undefined,
            repository: undefined,
            license: 'Unknown',
            manifestUrl: `file://${bundleInfo.filePath}`,
            downloadUrl: `file://${localPath}`,
            isCurated: false,
            hubName: undefined,
            checksum: undefined,
        };
        
        // Add skill information for marketplace display
        // This allows the marketplace to show skill count in the content breakdown
        (bundle as any).skills = validatedSkills.map(skill => ({
            name: skill.manifest.name || skill.folderName,
            description: skill.manifest.description || 'No description available',
            path: skill.path
        }));
        
        return bundle;
    }

    /**
     * Check if this source is enabled
     * Supports source enable/disable functionality
     */
    isEnabled(): boolean {
        // Check if source has been explicitly disabled
        return this.source.enabled !== false;
    }

    /**
     * Enable this source
     * Allows independent operation of multiple local OLAF sources
     */
    enable(): void {
        this.source.enabled = true;
        this.logger.info(`[LocalOlafAdapter] Source enabled: ${this.source.url}`);
    }

    /**
     * Disable this source
     * Allows independent operation of multiple local OLAF sources
     */
    disable(): void {
        this.source.enabled = false;
        this.logger.info(`[LocalOlafAdapter] Source disabled: ${this.source.url}`);
    }

    /**
     * Get source status information for management UI
     */
    getSourceStatus(): {
        id: string;
        url: string;
        enabled: boolean;
        type: string;
        lastValidated?: string;
        bundleCount?: number;
        errorCount?: number;
    } {
        return {
            id: this.source.id,
            url: this.source.url,
            enabled: this.isEnabled(),
            type: this.type,
            // Additional status information can be added here
        };
    }

    /**
     * Fetch bundles from local OLAF filesystem with comprehensive error handling
     * Scans bundle definitions, validates skills, and creates Bundle objects
     * Continues processing valid bundles when some are invalid
     * Respects source enable/disable state
     * 
     * @returns Promise resolving to array of Bundle objects found in local directory
     * @throws Error only if directory is not accessible or no valid bundles found
     */
    async fetchBundles(): Promise<Bundle[]> {
        // Check if source is enabled
        if (!this.isEnabled()) {
            this.logger.info(`[LocalOlafAdapter] Source is disabled, returning empty bundle list: ${this.source.url}`);
            return [];
        }
        
        try {
            const bundleDefinitions = await this.scanBundleDefinitions();
            const bundles: Bundle[] = [];
            const errors: string[] = [];
            
            for (const bundleInfo of bundleDefinitions) {
                try {
                    const bundle = this.createBundleFromDefinition(bundleInfo);
                    bundles.push(bundle);
                    this.logger.debug(`[LocalOlafAdapter] Created bundle: ${bundle.name} (${bundle.size})`);
                } catch (error) {
                    const errorMsg = `Failed to create bundle from ${bundleInfo.fileName}: ${error}`;
                    errors.push(errorMsg);
                    this.logger.warn(`[LocalOlafAdapter] ${errorMsg}`);
                    // Continue processing other bundles
                }
            }
            
            // Log summary
            if (bundles.length > 0) {
                this.logger.info(`[LocalOlafAdapter] Successfully created ${bundles.length} bundle(s) from local OLAF registry`);
            }
            
            if (errors.length > 0) {
                this.logger.warn(`[LocalOlafAdapter] Encountered ${errors.length} error(s) while creating bundles`);
                // Don't show user notification here as it was already shown in scanBundleDefinitions
            }
            
            // Only throw error if no bundles were successfully processed
            if (bundles.length === 0 && bundleDefinitions.length > 0) {
                throw new Error(`No valid bundles could be created from ${bundleDefinitions.length} bundle definition(s)`);
            }
            
            return bundles;
        } catch (error) {
            const errorMsg = `Failed to fetch bundles from local OLAF registry: ${error}`;
            this.logger.error(`[LocalOlafAdapter] ${errorMsg}`);
            throw new Error(errorMsg);
        }
    }

    /**
     * Generate deployment manifest for a local OLAF bundle
     * Creates manifest from bundle definition information with all skills
     */
    private generateDeploymentManifest(bundleInfo: BundleDefinitionInfo): any {
        const { definition, validatedSkills } = bundleInfo;
        const localPath = this.getLocalPath();
        
        // Create deployment manifest structure with required root-level fields
        const deploymentManifest = {
            // Required root-level fields for BundleInstaller validation
            id: bundleInfo.id,
            version: definition.metadata.version || '1.0.0',
            name: definition.metadata.name,
            
            metadata: {
                manifest_version: "1.0",
                description: `Local OLAF Bundle: ${definition.metadata.name}`,
                author: definition.metadata.author || 'Unknown',
                last_updated: new Date().toISOString(),
                repository: {
                    type: "local",
                    url: `file://${localPath}`,
                    directory: "bundles"
                },
                license: 'Unknown',
                keywords: [
                    ...(definition.metadata.tags || []),
                    'local-olaf',
                    'bundle',
                    'skills'
                ]
            },
            
            common: {
                directories: validatedSkills.map(skill => skill.folderName),
                files: [],
                include_patterns: ["**/*"],
                exclude_patterns: []
            },
            
            bundle_settings: {
                include_common_in_environment_bundles: true,
                create_common_bundle: true,
                compression: "zip" as any,
                naming: {
                    common_bundle: bundleInfo.fileName
                }
            },
            
            prompts: validatedSkills.map(skill => ({
                id: skill.id,
                name: skill.manifest.name,
                description: skill.manifest.description || 'Local OLAF Skill',
                file: `${skill.folderName}/manifest.json`,
                type: "agent" as any,
                tags: skill.manifest.tags || ['local-olaf', 'skill'],
                entry_points: skill.manifest.entry_points || []
            }))
        };
        
        this.logger.debug(`[LocalOlafAdapter] Generated deployment manifest for bundle: ${bundleInfo.id}`);
        return deploymentManifest;
    }

    /**
     * Package bundle as ZIP archive from bundle definition
     * Copies all skill files while preserving folder structure
     */
    private async packageBundleAsZip(bundleInfo: BundleDefinitionInfo): Promise<Buffer> {
        const localPath = this.getLocalPath();
        
        this.logger.debug(`[LocalOlafAdapter] Packaging bundle as ZIP: ${bundleInfo.fileName}`);
        
        try {
            // Create new ZIP archive
            const zip = new AdmZip();
            
            // Generate and add deployment manifest
            const deploymentManifest = this.generateDeploymentManifest(bundleInfo);
            const manifestYaml = yaml.dump(deploymentManifest);
            zip.addFile('deployment-manifest.yml', Buffer.from(manifestYaml, 'utf8'));
            
            // Add each skill to the ZIP
            for (const skill of bundleInfo.validatedSkills) {
                const skillPath = path.join(localPath, skill.path);
                
                // Add all files in the skill directory recursively
                await this.addDirectoryToZip(zip, skillPath, skill.folderName);
            }
            
            // Generate ZIP buffer
            const zipBuffer = zip.toBuffer();
            
            this.logger.debug(`[LocalOlafAdapter] Created ZIP bundle for ${bundleInfo.fileName}: ${zipBuffer.length} bytes`);
            return zipBuffer;
            
        } catch (error) {
            this.logger.error(`[LocalOlafAdapter] Failed to package bundle ${bundleInfo.fileName}: ${error}`);
            throw new Error(`Failed to package bundle as ZIP: ${error}`);
        }
    }

    /**
     * Recursively add directory contents to ZIP archive
     * Preserves folder structure and copies all files
     */
    private async addDirectoryToZip(zip: AdmZip, sourcePath: string, zipPath: string): Promise<void> {
        try {
            const entries = await readdir(sourcePath, { withFileTypes: true });
            
            for (const entry of entries) {
                const fullPath = path.join(sourcePath, entry.name);
                const entryZipPath = path.join(zipPath, entry.name).replace(/\\/g, '/'); // Normalize path separators
                
                if (entry.isFile()) {
                    try {
                        const fileContent = await readFile(fullPath);
                        zip.addFile(entryZipPath, fileContent);
                        
                        this.logger.debug(`[LocalOlafAdapter] Added file to ZIP: ${entryZipPath} (${fileContent.length} bytes)`);
                    } catch (error) {
                        this.logger.warn(`[LocalOlafAdapter] Failed to add file ${fullPath}: ${error}`);
                        // Continue with other files
                    }
                } else if (entry.isDirectory()) {
                    // Recursively handle subdirectories
                    await this.addDirectoryToZip(zip, fullPath, entryZipPath);
                }
            }
        } catch (error) {
            this.logger.warn(`[LocalOlafAdapter] Failed to process directory ${sourcePath}: ${error}`);
        }
    }

    async downloadBundle(bundle: Bundle): Promise<Buffer> {
        this.logger.info(`[LocalOlafAdapter] Preparing bundle for installation: ${bundle.name}`);
        
        try {
            // Find the bundle definition info for this bundle
            const bundleDefinitions = await this.scanBundleDefinitions();
            const bundleInfo = bundleDefinitions.find(info => info.id === bundle.id);
            
            if (!bundleInfo) {
                throw new Error(`Bundle definition not found: ${bundle.id}`);
            }
            
            // For local OLAF bundles, we only need to create a minimal ZIP with deployment manifest
            // The actual skills will be linked symbolically in postInstall
            const zipBuffer = await this.createMinimalBundle(bundleInfo);
            
            this.logger.info(`[LocalOlafAdapter] Successfully prepared bundle ${bundle.name} (${zipBuffer.length} bytes)`);
            return zipBuffer;
            
        } catch (error) {
            this.logger.error(`[LocalOlafAdapter] Failed to prepare bundle ${bundle.name}: ${error}`);
            throw new Error(`Failed to prepare local OLAF bundle ${bundle.name}: ${error}`);
        }
    }

    /**
     * Ensure OLAF runtime is installed using existing OlafRuntimeManager
     * Handles runtime installation errors gracefully with user feedback
     */
    private async ensureRuntimeInstalled(): Promise<void> {
        this.logger.info(`[LocalOlafAdapter] Ensuring OLAF runtime is installed`);
        
        try {
            // Get current workspace path
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                throw new Error('No workspace found. OLAF runtime requires an active workspace.');
            }
            
            const workspacePath = workspaceFolders[0].uri.fsPath;
            
            // Check if runtime is already installed
            const runtimeInfo = await this.runtimeManager.getRuntimeInfo();
            if (runtimeInfo.isInstalled) {
                this.logger.info(`[LocalOlafAdapter] OLAF runtime v${runtimeInfo.version} already installed`);
                return;
            }
            
            // Install runtime
            this.logger.info(`[LocalOlafAdapter] Installing OLAF runtime...`);
            const success = await this.runtimeManager.ensureRuntimeInstalled(workspacePath);
            
            if (!success) {
                throw new Error('OLAF runtime installation failed. Please check your network connection and try again.');
            }
            
            // Verify installation was successful
            const updatedInfo = await this.runtimeManager.getRuntimeInfo('latest', true);
            if (!updatedInfo.isInstalled) {
                throw new Error('OLAF runtime installation verification failed');
            }
            
            this.logger.info(`[LocalOlafAdapter] OLAF runtime installed successfully`);
            
        } catch (error) {
            this.logger.error(`[LocalOlafAdapter] Runtime installation failed: ${error}`);
            
            // Provide user-friendly error message
            const errorMessage = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(
                `Failed to install OLAF runtime: ${errorMessage}. Local OLAF bundles require the runtime to function properly.`,
                'Retry',
                'Cancel'
            ).then(selection => {
                if (selection === 'Retry') {
                    // User can retry the bundle installation which will trigger runtime installation again
                    vscode.window.showInformationMessage('Please try installing the bundle again.');
                }
            });
            
            throw new Error(`OLAF runtime installation failed: ${errorMessage}`);
        }
    }

    /**
     * Create workspace symbolic links for runtime access during bundle installation
     * Handles link creation errors gracefully
     */
    private async createWorkspaceLinks(): Promise<void> {
        this.logger.info(`[LocalOlafAdapter] Creating workspace symbolic links`);
        
        try {
            // Get current workspace path
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                throw new Error('No workspace found for creating symbolic links');
            }
            
            const workspacePath = workspaceFolders[0].uri.fsPath;
            
            // Check if links already exist
            const hasLinks = await this.runtimeManager.hasWorkspaceLinks(workspacePath);
            if (hasLinks) {
                this.logger.info(`[LocalOlafAdapter] Workspace links already exist`);
                return;
            }
            
            // Create symbolic links
            await this.runtimeManager.createWorkspaceLinks(workspacePath);
            
            // Verify links were created
            const linksCreated = await this.runtimeManager.hasWorkspaceLinks(workspacePath);
            if (!linksCreated) {
                throw new Error('Workspace link creation verification failed');
            }
            
            this.logger.info(`[LocalOlafAdapter] Workspace symbolic links created successfully`);
            
        } catch (error) {
            this.logger.error(`[LocalOlafAdapter] Failed to create workspace links: ${error}`);
            
            // Provide user-friendly error message but don't fail the installation
            const errorMessage = error instanceof Error ? error.message : String(error);
            vscode.window.showWarningMessage(
                `Warning: Failed to create workspace symbolic links: ${errorMessage}. The bundle was installed but may not function properly.`
            );
            
            // Don't throw error here - symbolic link creation is not critical for basic functionality
            this.logger.warn(`[LocalOlafAdapter] Continuing without workspace links due to error: ${errorMessage}`);
        }
    }

    /**
     * Post-installation hook for local OLAF bundles
     * Ensures OLAF runtime is installed and creates workspace symbolic links
     * Registers all skills in the bundle in the competency index after successful installation
     */
    async postInstall(bundleId: string, installPath: string): Promise<void> {
        this.logger.info(`[LocalOlafAdapter] Post-installation hook for bundle: ${bundleId}`);
        
        try {
            // Ensure OLAF runtime is installed before first local OLAF bundle installation
            await this.ensureRuntimeInstalled();
            
            // Create workspace symbolic links during bundle installation
            await this.createWorkspaceLinks();
            
            // Create symbolic links for each skill in the bundle
            await this.createSkillSymbolicLinks(bundleId);
            
            // Register bundle skills in competency index
            await this.registerBundleInCompetencyIndex(bundleId, installPath);
            
            this.logger.info(`[LocalOlafAdapter] Post-installation completed successfully`);
        } catch (error) {
            this.logger.error(`[LocalOlafAdapter] Post-installation failed: ${error}`);
            throw error;
        }
    }

    /**
     * Post-uninstallation hook for local OLAF bundles
     * Removes all skills in the bundle from the competency index after successful uninstallation
     */
    async postUninstall(bundleId: string, installPath: string): Promise<void> {
        this.logger.info(`[LocalOlafAdapter] Post-uninstallation hook for bundle: ${bundleId}`);
        
        try {
            // Remove symbolic links for each skill in the bundle
            await this.removeSkillSymbolicLinks(bundleId);
            
            // Remove bundle skills from competency index
            await this.unregisterBundleFromCompetencyIndex(bundleId, installPath);
            
            this.logger.info(`[LocalOlafAdapter] Post-uninstallation completed successfully`);
        } catch (error) {
            this.logger.error(`[LocalOlafAdapter] Post-uninstallation failed: ${error}`);
            throw error;
        }
    }

    /**
     * Register local OLAF bundle skills in competency index
     * Updates .olaf/olaf-core/reference/competency-index.json with all skill information
     */
    private async registerBundleInCompetencyIndex(bundleId: string, installPath: string): Promise<void> {
        this.logger.info(`[LocalOlafAdapter] Registering bundle skills in competency index: ${bundleId}`);
        this.logger.info(`[LocalOlafAdapter] Install path: ${installPath}`);
        
        try {
            // Get workspace path
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                this.logger.warn('[LocalOlafAdapter] No workspace found, skipping competency index registration');
                return;
            }
            
            const workspacePath = workspaceFolders[0].uri.fsPath;
            this.logger.info(`[LocalOlafAdapter] Workspace path: ${workspacePath}`);
            
            const competencyIndexPath = path.join(workspacePath, '.olaf', 'olaf-core', 'reference', 'competency-index.json');
            this.logger.info(`[LocalOlafAdapter] Competency index path: ${competencyIndexPath}`);
            
            // Ensure the directory exists
            const competencyIndexDir = path.dirname(competencyIndexPath);
            this.logger.info(`[LocalOlafAdapter] Creating directory if needed: ${competencyIndexDir}`);
            
            if (!fs.existsSync(competencyIndexDir)) {
                this.logger.info(`[LocalOlafAdapter] Directory does not exist, creating: ${competencyIndexDir}`);
                fs.mkdirSync(competencyIndexDir, { recursive: true });
                this.logger.info(`[LocalOlafAdapter] Directory created successfully`);
            } else {
                this.logger.info(`[LocalOlafAdapter] Directory already exists`);
            }
            
            // Read existing competency index or create new one
            let competencyIndex: any[] = [];
            if (fs.existsSync(competencyIndexPath)) {
                this.logger.info(`[LocalOlafAdapter] Reading existing competency index`);
                const content = fs.readFileSync(competencyIndexPath, 'utf-8');
                const parsed = JSON.parse(content);
                
                // Handle both array format and legacy object format
                if (Array.isArray(parsed)) {
                    competencyIndex = parsed;
                    this.logger.info(`[LocalOlafAdapter] Found ${competencyIndex.length} existing skills`);
                } else if (parsed.skills && Array.isArray(parsed.skills)) {
                    // Legacy format with skills property - migrate to flat array
                    competencyIndex = parsed.skills;
                    this.logger.info(`[LocalOlafAdapter] Found legacy format, migrating ${competencyIndex.length} existing skills`);
                } else {
                    this.logger.warn(`[LocalOlafAdapter] Invalid competency index format, creating new array`);
                    competencyIndex = [];
                }
            } else {
                this.logger.info(`[LocalOlafAdapter] Competency index does not exist, will create new one`);
            }
            
            // Find the bundle definition to get skill information
            const bundleDefinitions = await this.scanBundleDefinitions();
            const bundleInfo = bundleDefinitions.find(info => info.id === bundleId);
            
            if (!bundleInfo) {
                this.logger.warn(`[LocalOlafAdapter] Bundle definition not found for ${bundleId}, skipping competency index registration`);
                return;
            }
            
            // Process each skill in the bundle
            for (const skill of bundleInfo.validatedSkills) {
                await this.registerSkillInCompetencyIndex(skill, installPath, competencyIndex);
            }
            
            // Write updated competency index
            this.logger.info(`[LocalOlafAdapter] Writing updated competency index with ${competencyIndex.length} skills`);
            const competencyIndexContent = JSON.stringify(competencyIndex, null, 2);
            
            fs.writeFileSync(competencyIndexPath, competencyIndexContent, 'utf-8');
            this.logger.info(`[LocalOlafAdapter] File write completed`);
            
            // Verify the file was written correctly
            if (fs.existsSync(competencyIndexPath)) {
                const verifyContent = fs.readFileSync(competencyIndexPath, 'utf-8');
                const verifyIndex = JSON.parse(verifyContent);
                
                if (Array.isArray(verifyIndex) && verifyIndex.length >= bundleInfo.validatedSkills.length) {
                    this.logger.info(`[LocalOlafAdapter] Competency index verification successful: ${verifyIndex.length} total skills`);
                } else {
                    this.logger.error(`[LocalOlafAdapter] Competency index verification failed: expected at least ${bundleInfo.validatedSkills.length} skills, found ${Array.isArray(verifyIndex) ? verifyIndex.length : 'invalid format'}`);
                }
            } else {
                this.logger.error(`[LocalOlafAdapter] Competency index file does not exist after write`);
            }
            
            this.logger.info(`[LocalOlafAdapter] Successfully registered ${bundleInfo.validatedSkills.length} skills in competency index`);
            
        } catch (error) {
            this.logger.error(`[LocalOlafAdapter] Failed to register bundle in competency index: ${error}`);
            if (error instanceof Error) {
                this.logger.error(`[LocalOlafAdapter] Error stack: ${error.stack}`);
            }
            throw error;
        }
    }

    /**
     * Register a single skill in the competency index
     */
    private async registerSkillInCompetencyIndex(skill: SkillInfo, installPath: string, competencyIndex: any[]): Promise<void> {
        try {
            // Extract entry points from skill manifest
            const entryPoints = skill.manifest.entry_points || [];
            
            if (entryPoints.length === 0) {
                this.logger.warn(`[LocalOlafAdapter] Skill ${skill.id} has no entry points, skipping competency index registration`);
                return;
            }
            
            // Process each entry point
            for (const entryPoint of entryPoints) {
                // Construct the file path for the competency index
                // Format: external-skills/olaf-local/{skillName}/prompts/{fileName}
                const promptFilePath = `external-skills/olaf-local/${skill.folderName}${entryPoint.path}`;
                
                this.logger.info(`[LocalOlafAdapter] Processing entry point for skill ${skill.id}: ${promptFilePath}`);
                
                // Create skill entry for competency index in the correct format
                const skillEntry = {
                    patterns: entryPoint.patterns || [],
                    file: promptFilePath,
                    protocol: entryPoint.protocol || 'Propose-Act'
                };
                
                // Check if skill already exists in index (match by file path)
                const existingIndex = competencyIndex.findIndex((s: any) => s.file === skillEntry.file);
                
                if (existingIndex >= 0) {
                    // Update existing entry
                    this.logger.info(`[LocalOlafAdapter] Updating existing skill entry in competency index: ${skillEntry.file}`);
                    competencyIndex[existingIndex] = skillEntry;
                } else {
                    // Add new entry
                    this.logger.info(`[LocalOlafAdapter] Adding new skill entry to competency index: ${skillEntry.file}`);
                    competencyIndex.push(skillEntry);
                }
            }
            
        } catch (error) {
            this.logger.error(`[LocalOlafAdapter] Failed to register skill ${skill.id} in competency index: ${error}`);
            throw error;
        }
    }

    /**
     * Unregister local OLAF bundle from competency index
     * Removes all skill entries from .olaf/olaf-core/reference/competency-index.json
     */
    private async unregisterBundleFromCompetencyIndex(bundleId: string, installPath: string): Promise<void> {
        this.logger.info(`[LocalOlafAdapter] Unregistering bundle from competency index: ${bundleId}`);
        this.logger.info(`[LocalOlafAdapter] Install path: ${installPath}`);
        
        try {
            // Get workspace path
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                this.logger.warn('[LocalOlafAdapter] No workspace found, skipping competency index unregistration');
                return;
            }
            
            const workspacePath = workspaceFolders[0].uri.fsPath;
            this.logger.info(`[LocalOlafAdapter] Workspace path: ${workspacePath}`);
            
            const competencyIndexPath = path.join(workspacePath, '.olaf', 'olaf-core', 'reference', 'competency-index.json');
            this.logger.info(`[LocalOlafAdapter] Competency index path: ${competencyIndexPath}`);
            
            // Check if competency index exists
            if (!fs.existsSync(competencyIndexPath)) {
                this.logger.warn(`[LocalOlafAdapter] Competency index does not exist, nothing to unregister`);
                return;
            }
            
            // Read existing competency index
            this.logger.info(`[LocalOlafAdapter] Reading existing competency index`);
            const content = fs.readFileSync(competencyIndexPath, 'utf-8');
            let competencyIndex = JSON.parse(content);
            
            // Handle both array format and legacy object format
            if (!Array.isArray(competencyIndex)) {
                if (competencyIndex.skills && Array.isArray(competencyIndex.skills)) {
                    competencyIndex = competencyIndex.skills;
                } else {
                    this.logger.warn(`[LocalOlafAdapter] Invalid competency index format, cannot unregister`);
                    return;
                }
            }
            
            this.logger.info(`[LocalOlafAdapter] Found ${competencyIndex.length} existing skills`);
            
            // Find the bundle definition to get skill information
            const bundleDefinitions = await this.scanBundleDefinitions();
            const bundleInfo = bundleDefinitions.find(info => info.id === bundleId);
            
            if (!bundleInfo) {
                this.logger.warn(`[LocalOlafAdapter] Bundle definition not found for ${bundleId}, cannot determine skills to unregister`);
                return;
            }
            
            // Remove entries for all skills in the bundle
            // Use the same hardcoded path as during installation to ensure consistency
            let removedCount = 0;
            
            for (const skill of bundleInfo.validatedSkills) {
                const entryPoints = skill.manifest.entry_points || [];
                
                for (const entryPoint of entryPoints) {
                    const promptFilePath = `external-skills/olaf-local/${skill.folderName}${entryPoint.path}`;
                    
                    // Find and remove entries matching this skill's file path
                    const initialLength = competencyIndex.length;
                    competencyIndex = competencyIndex.filter((entry: any) => entry.file !== promptFilePath);
                    const removed = initialLength - competencyIndex.length;
                    
                    if (removed > 0) {
                        this.logger.info(`[LocalOlafAdapter] Removed ${removed} entries for skill: ${promptFilePath}`);
                        removedCount += removed;
                    }
                }
            }
            
            if (removedCount > 0) {
                // Write updated competency index
                this.logger.info(`[LocalOlafAdapter] Writing updated competency index after removing ${removedCount} entries`);
                const competencyIndexContent = JSON.stringify(competencyIndex, null, 2);
                fs.writeFileSync(competencyIndexPath, competencyIndexContent, 'utf-8');
                
                this.logger.info(`[LocalOlafAdapter] Successfully removed ${removedCount} skill entries from competency index`);
            } else {
                this.logger.info(`[LocalOlafAdapter] No entries found to remove for bundle: ${bundleId}`);
            }
            
        } catch (error) {
            this.logger.error(`[LocalOlafAdapter] Failed to unregister bundle from competency index: ${error}`);
            if (error instanceof Error) {
                this.logger.error(`[LocalOlafAdapter] Error stack: ${error.stack}`);
            }
            throw error;
        }
    }

    getManifestUrl(bundleId: string, version?: string): string {
        // Will be implemented in task 3
        throw new Error('getManifestUrl not yet implemented');
    }

    getDownloadUrl(bundleId: string, version?: string): string {
        // Will be implemented in task 3
        throw new Error('getDownloadUrl not yet implemented');
    }

    /**
     * Create minimal bundle with just deployment manifest
     * For local OLAF bundles, skills are linked symbolically rather than copied
     */
    private async createMinimalBundle(bundleInfo: BundleDefinitionInfo): Promise<Buffer> {
        try {
            const zip = new AdmZip();
            
            // Generate and add deployment manifest only
            const deploymentManifest = this.generateDeploymentManifest(bundleInfo);
            const manifestYaml = yaml.dump(deploymentManifest);
            zip.addFile('deployment-manifest.yml', Buffer.from(manifestYaml, 'utf8'));
            
            // Generate ZIP buffer
            const zipBuffer = zip.toBuffer();
            
            this.logger.debug(`[LocalOlafAdapter] Created minimal bundle for ${bundleInfo.fileName}: ${zipBuffer.length} bytes`);
            return zipBuffer;
            
        } catch (error) {
            this.logger.error(`[LocalOlafAdapter] Failed to create minimal bundle ${bundleInfo.fileName}: ${error}`);
            throw new Error(`Failed to create minimal bundle: ${error}`);
        }
    }

    /**
     * Create symbolic links for all skills in a bundle
     * Links are created in .olaf/external-skills/<source-name>/<skill-name>
     */
    private async createSkillSymbolicLinks(bundleId: string): Promise<void> {
        this.logger.info(`[LocalOlafAdapter] Creating symbolic links for bundle: ${bundleId}`);
        
        try {
            // Get workspace path
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                this.logger.warn('[LocalOlafAdapter] No workspace found, skipping symbolic link creation');
                return;
            }
            
            const workspacePath = workspaceFolders[0].uri.fsPath;
            const localPath = this.getLocalPath();
            
            // Create external-skills directory structure
            const externalSkillsPath = path.join(workspacePath, '.olaf', 'external-skills');
            const sourceSkillsPath = path.join(externalSkillsPath, 'olaf-local');
            
            // Ensure directories exist
            if (!fs.existsSync(externalSkillsPath)) {
                fs.mkdirSync(externalSkillsPath, { recursive: true });
                this.logger.info(`[LocalOlafAdapter] Created external-skills directory: ${externalSkillsPath}`);
            }
            
            if (!fs.existsSync(sourceSkillsPath)) {
                fs.mkdirSync(sourceSkillsPath, { recursive: true });
                this.logger.info(`[LocalOlafAdapter] Created source skills directory: ${sourceSkillsPath}`);
            }
            
            // Find the bundle definition to get skill information
            const bundleDefinitions = await this.scanBundleDefinitions();
            const bundleInfo = bundleDefinitions.find(info => info.id === bundleId);
            
            if (!bundleInfo) {
                this.logger.warn(`[LocalOlafAdapter] Bundle definition not found for ${bundleId}, skipping symbolic link creation`);
                return;
            }
            
            // Create symbolic links for each skill
            for (const skill of bundleInfo.validatedSkills) {
                const skillSourcePath = path.join(localPath, skill.path);
                const skillLinkPath = path.join(sourceSkillsPath, skill.folderName);
                
                try {
                    // Remove existing link if it exists
                    if (fs.existsSync(skillLinkPath)) {
                        const stats = fs.lstatSync(skillLinkPath);
                        if (stats.isSymbolicLink()) {
                            fs.unlinkSync(skillLinkPath);
                            this.logger.info(`[LocalOlafAdapter] Removed existing symbolic link: ${skillLinkPath}`);
                        } else {
                            this.logger.warn(`[LocalOlafAdapter] Path exists but is not a symbolic link: ${skillLinkPath}`);
                            continue;
                        }
                    }
                    
                    // Create symbolic link
                    fs.symlinkSync(skillSourcePath, skillLinkPath, 'dir');
                    this.logger.info(`[LocalOlafAdapter] Created symbolic link: ${skillLinkPath} -> ${skillSourcePath}`);
                    
                } catch (error) {
                    this.logger.error(`[LocalOlafAdapter] Failed to create symbolic link for skill ${skill.folderName}: ${error}`);
                    // Continue with other skills
                }
            }
            
            this.logger.info(`[LocalOlafAdapter] Successfully created symbolic links for ${bundleInfo.validatedSkills.length} skills`);
            
        } catch (error) {
            this.logger.error(`[LocalOlafAdapter] Failed to create symbolic links: ${error}`);
            throw error;
        }
    }

    /**
     * Remove symbolic links for all skills in a bundle
     */
    private async removeSkillSymbolicLinks(bundleId: string): Promise<void> {
        this.logger.info(`[LocalOlafAdapter] Removing symbolic links for bundle: ${bundleId}`);
        
        try {
            // Get workspace path
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                this.logger.warn('[LocalOlafAdapter] No workspace found, skipping symbolic link removal');
                return;
            }
            
            const workspacePath = workspaceFolders[0].uri.fsPath;
            const sourceSkillsPath = path.join(workspacePath, '.olaf', 'external-skills', 'olaf-local');
            
            // Find the bundle definition to get skill information
            const bundleDefinitions = await this.scanBundleDefinitions();
            const bundleInfo = bundleDefinitions.find(info => info.id === bundleId);
            
            if (!bundleInfo) {
                this.logger.warn(`[LocalOlafAdapter] Bundle definition not found for ${bundleId}, skipping symbolic link removal`);
                return;
            }
            
            // Remove symbolic links for each skill
            let removedCount = 0;
            for (const skill of bundleInfo.validatedSkills) {
                const skillLinkPath = path.join(sourceSkillsPath, skill.folderName);
                
                try {
                    if (fs.existsSync(skillLinkPath)) {
                        const stats = fs.lstatSync(skillLinkPath);
                        if (stats.isSymbolicLink()) {
                            fs.unlinkSync(skillLinkPath);
                            removedCount++;
                            this.logger.info(`[LocalOlafAdapter] Removed symbolic link: ${skillLinkPath}`);
                        } else {
                            this.logger.warn(`[LocalOlafAdapter] Path exists but is not a symbolic link: ${skillLinkPath}`);
                        }
                    } else {
                        this.logger.debug(`[LocalOlafAdapter] Symbolic link does not exist: ${skillLinkPath}`);
                    }
                } catch (error) {
                    this.logger.error(`[LocalOlafAdapter] Failed to remove symbolic link for skill ${skill.folderName}: ${error}`);
                    // Continue with other skills
                }
            }
            
            this.logger.info(`[LocalOlafAdapter] Successfully removed ${removedCount} symbolic links`);
            
        } catch (error) {
            this.logger.error(`[LocalOlafAdapter] Failed to remove symbolic links: ${error}`);
            throw error;
        }
    }
}
/**
 * Type definitions for OLAF (GitHub repositories containing AI skills) integration
 */

/**
 * OLAF skill manifest structure
 * Represents the content of skill-manifest.json files in OLAF repositories
 */
export interface SkillManifest {
    /** Skill name */
    name: string;
    
    /** Skill version (optional, defaults to "1.0.0") */
    version?: string;
    
    /** Skill description (optional, defaults to "OLAF Skill") */
    description?: string;
    
    /** Skill author (optional, defaults to repository owner) */
    author?: string;
    
    /** Skill tags (optional, defaults to ["olaf", "skill"]) */
    tags?: string[];
    
    /** Skill dependencies (optional) */
    dependencies?: string[];
    
    /** Skill license (optional, defaults to "Unknown") */
    license?: string;
    
    /** Additional OLAF-specific properties */
    [key: string]: any;
}

/**
 * Information about a discovered OLAF skill
 * Used internally by the OlafAdapter to track skill metadata and files
 */
export interface SkillInfo {
    /** Unique skill identifier (generated from folder name) */
    id: string;
    
    /** Skill folder name within .olaf/core/skills */
    folderName: string;
    
    /** Full path to skill folder in repository */
    path: string;
    
    /** Parsed skill manifest */
    manifest: SkillManifest;
    
    /** List of files within the skill folder */
    files: string[];
}

/**
 * OLAF repository structure information
 * Used for validation and metadata extraction
 */
export interface OlafRepositoryInfo {
    /** Repository owner */
    owner: string;
    
    /** Repository name */
    repo: string;
    
    /** Repository branch (defaults to main/master) */
    branch?: string;
    
    /** Whether the repository has the required .olaf/core/skills structure */
    hasSkillsDirectory: boolean;
    
    /** Number of valid skills found */
    skillCount: number;
    
    /** List of discovered skills */
    skills: SkillInfo[];
}

/**
 * OLAF runtime installation information
 * Used by OlafRuntimeManager to track runtime state
 */
export interface OlafRuntimeInfo {
    /** Runtime version */
    version: string;
    
    /** Installation path in user space */
    installPath: string;
    
    /** Whether runtime is installed */
    isInstalled: boolean;
    
    /** Installation timestamp */
    installedAt?: string;
    
    /** IDE type for this runtime installation */
    ideType: 'vscode' | 'kiro' | 'windsurf';
}

/**
 * OLAF workspace configuration
 * Tracks symbolic links and runtime setup for a workspace
 */
export interface OlafWorkspaceConfig {
    /** Workspace path */
    workspacePath: string;
    
    /** Runtime version linked to this workspace */
    runtimeVersion: string;
    
    /** Whether symbolic links are created */
    hasSymbolicLinks: boolean;
    
    /** Paths to created symbolic links */
    symbolicLinks: {
        olafPath?: string;
        idePath?: string;
    };
    
    /** Configuration timestamp */
    configuredAt: string;
}

/**
 * Entry point definition for local OLAF skills
 * Defines how a skill integrates with the competency index
 */
export interface EntryPoint {
    /** Protocol type for skill execution */
    protocol: string;
    
    /** Path to the skill's main file relative to skill folder */
    path: string;
    
    /** Trigger patterns that activate this skill */
    patterns: string[];
}

/**
 * Extended skill manifest for local OLAF sources
 * Includes entry points for competency index integration
 */
export interface LocalOlafSkillManifest extends SkillManifest {
    /** Entry points for competency index integration */
    entry_points: EntryPoint[];
}

/**
 * Skill reference within a bundle definition
 * References a skill by path and manifest location
 */
export interface SkillReference {
    /** Skill name */
    name: string;
    
    /** Skill description */
    description: string;
    
    /** Path to skill folder relative to source root */
    path: string;
    
    /** Path to skill manifest file relative to source root */
    manifest: string;
}

/**
 * Bundle definition structure for local OLAF sources
 * Defines a bundle of related skills with metadata
 */
export interface BundleDefinition {
    /** Bundle metadata */
    metadata: {
        /** Bundle name */
        name: string;
        
        /** Bundle description */
        description: string;
        
        /** Bundle version (optional) */
        version?: string;
        
        /** Bundle author (optional) */
        author?: string;
        
        /** Bundle tags (optional) */
        tags?: string[];
    };
    
    /** List of skills included in this bundle */
    skills: SkillReference[];
}

/**
 * Bundle definition information with validation results
 * Contains parsed bundle definition and validated skill information
 */
export interface BundleDefinitionInfo {
    /** Unique bundle identifier */
    id: string;
    
    /** Bundle definition file name */
    fileName: string;
    
    /** Full path to bundle definition file */
    filePath: string;
    
    /** Parsed bundle definition */
    definition: BundleDefinition;
    
    /** List of validated skills with their information */
    validatedSkills: SkillInfo[];
}
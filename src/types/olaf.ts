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
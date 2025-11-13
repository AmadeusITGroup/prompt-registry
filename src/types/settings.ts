/**
 * Registry Settings Export/Import Types
 * 
 * These types define the schema for exporting and importing complete registry settings,
 * including sources, profiles, and configuration.
 */

import { Profile } from './registry';
import { RegistrySource } from './registry';

/**
 * Complete registry settings for export/import
 */
export interface ExportedSettings {
/** Schema version for migration compatibility */
version: string;

/** ISO timestamp when settings were exported */
exportedAt: string;

/** All registry sources */
sources: RegistrySource[];

/** All user profiles */
profiles: Profile[];

/** Extension configuration settings */
configuration?: RegistryConfiguration;
}

/**
 * Extension configuration settings
 */
export interface RegistryConfiguration {
/** Automatically check for bundle updates */
autoCheckUpdates?: boolean;

/** Default installation scope (user or workspace) */
installationScope?: string;

/** Default version to install (latest or specific) */
defaultVersion?: string;

/** Enable logging for debugging */
enableLogging?: boolean;
}

/**
 * Supported export/import formats
 */
export type ExportFormat = 'json' | 'yaml';

/**
 * Import strategy for handling existing data
 */
export type ImportStrategy = 'merge' | 'replace';

/**
 * Export options
 */
export interface ExportOptions {
/** Export format */
format: ExportFormat;

/** Include configuration settings */
includeConfiguration?: boolean;
}

/**
 * Import options
 */
export interface ImportOptions {
/** Import format (auto-detected if not specified) */
format?: ExportFormat;

/** Import strategy */
strategy: ImportStrategy;

/** Validate schema before importing */
validate?: boolean;
}

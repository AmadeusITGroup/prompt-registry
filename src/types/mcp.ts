/**
 * MCP (Model Context Protocol) Configuration Types
 */

export interface McpServerConfig {
    type?: string;  // e.g., "stdio" - optional, defaults to stdio
    command: string;
    args?: string[];
    env?: Record<string, string>;
    disabled?: boolean;
    description?: string;
}

export interface McpTaskDefinition {
    input?: string;
    output?: string;
    command: string;
    args?: string[];
    env?: Record<string, string>;
    description?: string;
}

export interface McpConfiguration {
    servers: Record<string, McpServerConfig>;
    tasks?: Record<string, McpTaskDefinition>;
    inputs?: any[];  // Legacy field, preserved for compatibility
}

export interface McpServerDefinition {
    command: string;
    args?: string[];
    env?: Record<string, string>;
    disabled?: boolean;
    description?: string;
}

export type McpServersManifest = Record<string, McpServerDefinition>;

export interface McpTrackingMetadata {
    managedServers: Record<string, {
        bundleId: string;
        bundleVersion: string;
        originalName: string;
        originalConfig: McpServerDefinition;
        installedAt: string;
        scope: 'user' | 'workspace';
    }>;
    lastUpdated: string;
    version: string;
}

export interface McpVariableContext {
    bundlePath: string;
    bundleId: string;
    bundleVersion: string;
    env: Record<string, string>;
}

export interface McpInstallResult {
    success: boolean;
    serversInstalled: number;
    installedServers: string[];
    errors?: string[];
    warnings?: string[];
}

export interface McpUninstallResult {
    success: boolean;
    serversRemoved: number;
    removedServers: string[];
    errors?: string[];
}

export interface McpInstallOptions {
    scope: 'user' | 'workspace';
    overwrite?: boolean;
    skipOnConflict?: boolean;
    createBackup?: boolean;
}

export interface McpConfigLocation {
    configPath: string;
    trackingPath: string;
    exists: boolean;
    scope: 'user' | 'workspace';
}

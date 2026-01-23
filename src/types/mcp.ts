/**
 * MCP (Model Context Protocol) Configuration Types
 */

/**
 * Base MCP server configuration
 */
export interface McpServerConfigBase {
    disabled?: boolean;
    description?: string;
}

/**
 * Stdio MCP server configuration (local process)
 */
export interface McpStdioServerConfig extends McpServerConfigBase {
    type?: 'stdio';  // Optional, defaults to stdio for backward compatibility
    command: string;
    args?: string[];
    env?: Record<string, string>;
    envFile?: string;  // Path to environment file
}

/**
 * Remote MCP server configuration (HTTP/SSE)
 */
export interface McpRemoteServerConfig extends McpServerConfigBase {
    type: 'http' | 'sse';
    url: string;  // Supports http://, https://, unix://, pipe://
    headers?: Record<string, string>;  // For authentication
}

/**
 * Union type for all MCP server configurations
 */
export type McpServerConfig = McpStdioServerConfig | McpRemoteServerConfig;

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

/**
 * Legacy type alias for backward compatibility
 */
export type McpServerDefinition = McpStdioServerConfig;

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

/**
 * Options for installing MCP servers to a workspace (repository scope)
 */
export interface McpWorkspaceInstallOptions {
    commitMode: 'commit' | 'local-only';
    overwrite?: boolean;
    skipOnConflict?: boolean;
    createBackup?: boolean;
}

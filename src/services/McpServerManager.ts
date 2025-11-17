import { Logger } from '../utils/logger';
import { McpConfigService } from './McpConfigService';
import {
    McpServersManifest,
    McpServerDefinition,
    McpInstallResult,
    McpUninstallResult,
    McpInstallOptions
} from '../types/mcp';

export class McpServerManager {
    private readonly logger: Logger;
    private readonly configService: McpConfigService;

    constructor() {
        this.logger = Logger.getInstance();
        this.configService = new McpConfigService();
    }

    async installServers(
        bundleId: string,
        bundleVersion: string,
        bundlePath: string,
        serversManifest: McpServersManifest,
        options: McpInstallOptions
    ): Promise<McpInstallResult> {
        const result: McpInstallResult = {
            success: false,
            serversInstalled: 0,
            installedServers: [],
            errors: [],
            warnings: []
        };

        try {
            if (Object.keys(serversManifest).length === 0) {
                this.logger.debug(`No MCP servers to install for bundle ${bundleId}`);
                result.success = true;
                return result;
            }

            this.logger.info(`Installing ${Object.keys(serversManifest).length} MCP servers for bundle ${bundleId}`);

            const existingConfig = await this.configService.readMcpConfig(options.scope);
            const tracking = await this.configService.readTrackingMetadata(options.scope);

            const serversToInstall: Record<string, any> = {};

            for (const [serverName, definition] of Object.entries(serversManifest)) {
                const prefixedName = this.configService.generatePrefixedServerName(bundleId, serverName);
                
                const serverConfig = this.configService.processServerDefinition(
                    serverName,
                    definition,
                    bundleId,
                    bundleVersion,
                    bundlePath
                );

                serversToInstall[prefixedName] = serverConfig;

                tracking.managedServers[prefixedName] = {
                    bundleId,
                    bundleVersion,
                    originalName: serverName,
                    originalConfig: definition,
                    installedAt: new Date().toISOString(),
                    scope: options.scope
                };
            }

            const mergeResult = await this.configService.mergeServers(
                existingConfig,
                serversToInstall,
                options
            );

            result.warnings?.push(...mergeResult.warnings);

            if (mergeResult.conflicts.length > 0 && !options.skipOnConflict && !options.overwrite) {
                result.errors?.push(`Conflicts detected: ${mergeResult.conflicts.join(', ')}`);
                result.success = false;
                return result;
            }

            await this.configService.writeMcpConfig(mergeResult.config, options.scope, options.createBackup !== false);
            await this.configService.writeTrackingMetadata(tracking, options.scope);

            result.serversInstalled = Object.keys(serversToInstall).length - mergeResult.conflicts.length;
            result.installedServers = Object.keys(serversToInstall).filter(
                name => !mergeResult.conflicts.includes(name)
            );
            result.success = true;

            this.logger.info(`Successfully installed ${result.serversInstalled} MCP servers for bundle ${bundleId}`);

        } catch (error) {
            this.logger.error(`Failed to install MCP servers for bundle ${bundleId}`, error as Error);
            result.errors?.push((error as Error).message);
            result.success = false;
        }

        return result;
    }

    async uninstallServers(
        bundleId: string,
        scope: 'user' | 'workspace'
    ): Promise<McpUninstallResult> {
        const result: McpUninstallResult = {
            success: false,
            serversRemoved: 0,
            removedServers: [],
            errors: []
        };

        try {
            this.logger.info(`Uninstalling MCP servers for bundle ${bundleId}`);

            const removedServers = await this.configService.removeServersForBundle(bundleId, scope);

            result.serversRemoved = removedServers.length;
            result.removedServers = removedServers;
            result.success = true;

            if (removedServers.length === 0) {
                this.logger.debug(`No MCP servers found for bundle ${bundleId}`);
            } else {
                this.logger.info(`Successfully uninstalled ${removedServers.length} MCP servers for bundle ${bundleId}`);
            }

        } catch (error) {
            this.logger.error(`Failed to uninstall MCP servers for bundle ${bundleId}`, error as Error);
            result.errors?.push((error as Error).message);
            result.success = false;
        }

        return result;
    }

    async listInstalledServers(scope: 'user' | 'workspace'): Promise<Array<{
        serverName: string;
        bundleId: string;
        bundleVersion: string;
        originalName: string;
        installedAt: string;
    }>> {
        try {
            const tracking = await this.configService.readTrackingMetadata(scope);
            
            return Object.entries(tracking.managedServers).map(([serverName, metadata]) => ({
                serverName,
                bundleId: metadata.bundleId,
                bundleVersion: metadata.bundleVersion,
                originalName: metadata.originalName,
                installedAt: metadata.installedAt
            }));
        } catch (error) {
            this.logger.error(`Failed to list installed MCP servers`, error as Error);
            return [];
        }
    }

    async getServersForBundle(bundleId: string, scope: 'user' | 'workspace'): Promise<string[]> {
        try {
            const tracking = await this.configService.readTrackingMetadata(scope);
            
            return Object.entries(tracking.managedServers)
                .filter(([_, metadata]) => metadata.bundleId === bundleId)
                .map(([serverName, _]) => serverName);
        } catch (error) {
            this.logger.error(`Failed to get servers for bundle ${bundleId}`, error as Error);
            return [];
        }
    }
}

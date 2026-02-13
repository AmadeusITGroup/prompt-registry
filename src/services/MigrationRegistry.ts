/**
 * MigrationRegistry - Tracks data migrations via context.globalState
 *
 * Follows the SetupStateManager singleton pattern. Each migration is a named
 * entry with pending/completed/skipped status. The registry ensures migrations
 * run at most once (idempotent).
 */

import * as vscode from 'vscode';
import { Logger } from '../utils/logger';

/**
 * Record for a single migration
 */
export interface MigrationRecord {
    status: 'pending' | 'completed' | 'skipped';
    completedAt?: string;
    details?: string;
}

/**
 * MigrationRegistry singleton service
 */
export class MigrationRegistry {
    private static instance: MigrationRegistry | undefined;
    private readonly logger: Logger;
    private readonly STATE_KEY = 'promptregistry.migrations';

    private constructor(private readonly context: vscode.ExtensionContext) {
        this.logger = Logger.getInstance();
    }

    /**
     * Get singleton instance.
     * @param context - VS Code extension context (required on first call)
     */
    static getInstance(context?: vscode.ExtensionContext): MigrationRegistry {
        if (!MigrationRegistry.instance) {
            if (!context) {
                throw new Error('MigrationRegistry requires context on first call');
            }
            MigrationRegistry.instance = new MigrationRegistry(context);
        }
        return MigrationRegistry.instance;
    }

    /**
     * Reset singleton instance (for testing)
     */
    static resetInstance(): void {
        MigrationRegistry.instance = undefined;
    }

    /**
     * Check if a migration has completed
     */
    async isMigrationComplete(name: string): Promise<boolean> {
        const state = await this.getMigrationState();
        return state[name]?.status === 'completed';
    }

    /**
     * Mark a migration as completed
     */
    async markMigrationComplete(name: string, details?: string): Promise<void> {
        const state = await this.getMigrationState();
        state[name] = {
            status: 'completed',
            completedAt: new Date().toISOString(),
            details
        };
        await this.context.globalState.update(this.STATE_KEY, state);
        this.logger.info(`Migration '${name}' marked as completed`);
    }

    /**
     * Mark a migration as skipped
     */
    async markMigrationSkipped(name: string, reason?: string): Promise<void> {
        const state = await this.getMigrationState();
        state[name] = {
            status: 'skipped',
            completedAt: new Date().toISOString(),
            details: reason
        };
        await this.context.globalState.update(this.STATE_KEY, state);
        this.logger.info(`Migration '${name}' skipped: ${reason || 'no reason'}`);
    }

    /**
     * Get the full migration state
     */
    async getMigrationState(): Promise<Record<string, MigrationRecord>> {
        return this.context.globalState.get<Record<string, MigrationRecord>>(this.STATE_KEY, {});
    }

    /**
     * Run a migration idempotently. If already completed or skipped, the function is not called.
     */
    async runMigration(name: string, fn: () => Promise<void>): Promise<void> {
        const state = await this.getMigrationState();
        const record = state[name];

        if (record?.status === 'completed' || record?.status === 'skipped') {
            this.logger.debug(`Migration '${name}' already ${record.status}, skipping`);
            return;
        }

        this.logger.info(`Running migration '${name}'...`);
        try {
            await fn();
            await this.markMigrationComplete(name);
        } catch (error) {
            this.logger.error(`Migration '${name}' failed`, error as Error);
            throw error;
        }
    }
}

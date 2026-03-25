/**
 * Hub Sync Scheduler Service
 * Periodically syncs the active hub configuration to keep sources up-to-date
 */

import * as vscode from 'vscode';
import {
  HUB_SYNC_CONSTANTS,
} from '../utils/constants';
import {
  isTestEnvironment,
} from '../utils/environment';
import {
  Logger,
} from '../utils/logger';
import {
  HubManager,
} from './hub-manager';

/**
 * Periodically syncs the active hub so that new sources/profiles
 * published to the hub appear without a VS Code restart.
 */
export class HubSyncScheduler {
  private readonly logger: Logger;
  private readonly isTestEnvironment: boolean;
  private syncTimer?: NodeJS.Timeout;
  private isInitialized = false;
  private isCheckInProgress = false;

  constructor(
    context: vscode.ExtensionContext,
    private readonly hubManager: HubManager
  ) {
    this.logger = Logger.getInstance();
    this.isTestEnvironment = isTestEnvironment('HUB_SYNC_SCHEDULER_ALLOW_TIMERS_IN_TESTS');

    if (context?.subscriptions) {
      context.subscriptions.push({
        dispose: () => this.dispose()
      });
    }
  }

  /**
   * Schedule the next periodic sync after SYNC_INTERVAL_MS.
   */
  private scheduleNextSync(): void {
    if (this.syncTimer) {
      clearTimeout(this.syncTimer);
      this.syncTimer = undefined;
    }

    this.syncTimer = setTimeout(async () => {
      await this.performSync();
      // Reschedule after completion
      if (this.isInitialized) {
        this.scheduleNextSync();
      }
    }, HUB_SYNC_CONSTANTS.SYNC_INTERVAL_MS);
  }

  /**
   * Initialize the scheduler.
   * Starts the first periodic timer (no startup delay — activation already syncs).
   */
  public initialize(): void {
    if (this.isInitialized) {
      this.logger.debug('HubSyncScheduler already initialized');
      return;
    }

    this.logger.info('Initializing HubSyncScheduler');

    if (this.isTestEnvironment) {
      this.logger.debug('Test environment detected, skipping hub sync timers');
    } else {
      this.scheduleNextSync();
    }

    this.isInitialized = true;
    this.logger.info('HubSyncScheduler initialized successfully');
  }

  /**
   * Perform a hub sync.
   * Guards against overlapping syncs and handles errors gracefully.
   */
  public async performSync(): Promise<void> {
    if (this.isCheckInProgress) {
      this.logger.debug('Hub sync already in progress, skipping');
      return;
    }

    this.isCheckInProgress = true;
    try {
      const activeHubId = await this.hubManager.getActiveHubId();
      if (!activeHubId) {
        this.logger.debug('No active hub configured, skipping periodic sync');
        return;
      }

      this.logger.info(`Performing periodic hub sync: ${activeHubId}`);
      await this.hubManager.syncHub(activeHubId);
      this.logger.info('Periodic hub sync completed successfully');
    } catch (error) {
      this.logger.warn('Periodic hub sync failed', error as Error);
    } finally {
      this.isCheckInProgress = false;
    }
  }

  /**
   * Cleanup timers and reset state.
   */
  public dispose(): void {
    this.logger.debug('Disposing HubSyncScheduler');

    if (this.syncTimer) {
      clearTimeout(this.syncTimer);
      this.syncTimer = undefined;
    }

    this.isInitialized = false;
  }
}

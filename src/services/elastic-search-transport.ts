import {
  Client,
  ClientOptions,
} from '@elastic/elasticsearch';
import * as vscode from 'vscode';
import {
  ElasticSearchConfig,
} from '../types/hub';
import {
  TelemetryDocument,
  TelemetryTransport,
} from '../types/telemetry';
import {
  Logger,
} from '../utils/logger';
import {
  HubManager,
} from './hub-manager';

interface ActiveClient {
  client: Client;
  indexPrefix: string;
  hubId: string;
}

/** Maximum queued documents before oldest entries are dropped. */
const MAX_QUEUE_SIZE = 500;

/** Interval in milliseconds between batched flushes. */
const FLUSH_INTERVAL_MS = 10_000;

/**
 * Manages the Elastic Search transport layer for telemetry.
 *
 * Handles ES client lifecycle (connect/disconnect per hub), event queuing
 * during startup, batched bulk indexing every 10s, and monthly index rotation.
 *
 * Authentication is handled by the es-telemetry-proxy — this client sends
 * unauthenticated requests to the proxy URL.
 */
export class ElasticSearchTransport implements TelemetryTransport {
  private activeClient: ActiveClient | undefined;
  private readonly pendingDocuments: TelemetryDocument[] = [];
  private readonly logger = Logger.getInstance();
  private debugChannel: vscode.OutputChannel | undefined;
  private disposables: vscode.Disposable[] = [];
  private flushTimer: ReturnType<typeof setInterval> | undefined;

  private log(level: 'debug' | 'info' | 'warn' | 'error', message: string): void {
    if (level === 'warn' || level === 'error') {
      this.logger[level](`[ES Transport] ${message}`);
    }
    if (this.debugChannel) {
      const timestamp = new Date().toISOString();
      this.debugChannel.appendLine(`[${timestamp}] ${level.toUpperCase()}: ${message}`);
    }
  }

  private closeActiveClient(): void {
    if (this.activeClient) {
      void this.activeClient.client.close().catch(() => { /* best-effort */ });
      this.activeClient = undefined;
    }
  }

  private stopFlushTimer(): void {
    if (this.flushTimer !== undefined) {
      clearInterval(this.flushTimer);
      this.flushTimer = undefined;
    }
  }

  private startFlushTimer(): void {
    this.stopFlushTimer();
    this.flushTimer = setInterval(() => {
      this.flushPending();
    }, FLUSH_INTERVAL_MS);
  }

  private flushPending(): void {
    if (!this.activeClient || this.pendingDocuments.length === 0) {
      return;
    }
    const docs = this.pendingDocuments.splice(0);
    this.log('info', `Flushing ${docs.length} event(s) to hub "${this.activeClient.hubId}"`);
    this.indexDocuments(this.activeClient, docs);
  }

  /**
   * Compute the current monthly index name from the stored prefix.
   * @param prefix - the index name prefix
   */
  private static currentIndexName(prefix: string): string {
    const monthSuffix = new Date().toISOString().slice(0, 7);
    return `${prefix}-${monthSuffix}`;
  }

  private indexDocuments(target: ActiveClient, docs: TelemetryDocument[]): void {
    const { client, indexPrefix, hubId } = target;
    const indexName = ElasticSearchTransport.currentIndexName(indexPrefix);
    client.helpers.bulk({
      index: indexName,
      datasource: docs,
      onDocument: () => ({ index: {} })
    }).catch((err: unknown) => {
      this.log('error', `Failed to index ${docs.length} event(s) to hub "${hubId}": ${err}`);
    });
  }

  /**
   * Buffer a document for the next batched flush (every 10s).
   * If no client is active, documents are queued until one registers.
   * @param doc - the telemetry document to send
   */
  public send(doc: TelemetryDocument): void {
    this.log('info', `Buffering event: ${doc.eventName ?? 'error'}`);
    if (this.pendingDocuments.length >= MAX_QUEUE_SIZE) {
      this.pendingDocuments.shift();
    }
    this.pendingDocuments.push(doc);
  }

  /**
   * Connect to a hub's Elastic Search proxy.
   * Closes any previously active client, flushes queued events, and starts
   * the periodic flush timer.
   * @param hubId - the hub identifier
   * @param config - Elastic Search connection configuration (proxy URL)
   */
  public async registerHub(hubId: string, config: ElasticSearchConfig): Promise<void> {
    try {
      this.closeActiveClient();
      this.stopFlushTimer();

      const clientOptions: ClientOptions = { node: config.node };
      const client = new Client(clientOptions);

      const indexPrefix = config.indexPrefix ?? 'prompt-registry-telemetry';
      const indexName = ElasticSearchTransport.currentIndexName(indexPrefix);

      try {
        await client.indices.create({ index: indexName });
      } catch (err: unknown) {
        if (!isIndexAlreadyExistsError(err)) {
          throw err;
        }
      }

      this.activeClient = { client, indexPrefix, hubId };
      this.log('info', `Registered ES client for hub "${hubId}" at ${config.node}`);

      this.flushPending();
      this.startFlushTimer();
    } catch (error) {
      this.log('error', `Failed to register ES client for hub "${hubId}": ${error}`);
    }
  }

  /**
   * Disconnect the Elastic Search client if it belongs to the given hub.
   * @param hubId - the hub identifier to unregister
   */
  public unregisterHub(hubId: string): void {
    if (this.activeClient?.hubId === hubId) {
      this.closeActiveClient();
      this.stopFlushTimer();
      this.pendingDocuments.length = 0;
      this.log('info', `Unregistered ES client for hub "${hubId}"`);
    }
  }

  /**
   * Subscribe to hub lifecycle events so the ES client is automatically
   * registered/unregistered as the active hub changes.
   * @param hubManager - the hub manager to subscribe to
   */
  public subscribeToHubEvents(hubManager: HubManager): void {
    const esLocalUrl = process.env.ES_LOCAL_URL;
    if (esLocalUrl) {
      this.debugChannel = vscode.window.createOutputChannel('Prompt Registry - Elastic Search');
      this.log('info', `Dev override: using ES_LOCAL_URL=${esLocalUrl}`);
      void this.registerHub('dev-local', { node: esLocalUrl });
      return;
    }

    const registerHubEs = async (hubId: string): Promise<void> => {
      try {
        const hubData = await hubManager.loadHub(hubId);
        const esConfig = hubData.config.telemetry?.elasticSearch;
        if (esConfig) {
          await this.registerHub(hubId, esConfig);
        }
      } catch (error) {
        this.log('warn', `Failed to register telemetry for hub "${hubId}" (non-fatal): ${error}`);
      }
    };

    const registerIfActive = async (hubId: string): Promise<void> => {
      const activeId = await hubManager.getActiveHubId();
      if (hubId === activeId) {
        void registerHubEs(hubId);
      }
    };

    this.disposables.push(
      hubManager.onHubImported((hubId) => {
        void registerIfActive(hubId);
      }),
      hubManager.onHubSynced((hubId) => {
        void registerIfActive(hubId);
      }),
      hubManager.onHubDeleted((hubId) => {
        this.unregisterHub(hubId);
      }),
      hubManager.onActiveHubChanged(({ oldHubId, newHubId }) => {
        if (oldHubId) {
          this.unregisterHub(oldHubId);
        }
        if (newHubId) {
          void registerHubEs(newHubId);
        }
      })
    );

    // Register the current active hub at startup
    void hubManager.getActiveHubId().then((activeHubId) => {
      if (activeHubId) {
        void registerHubEs(activeHubId);
      }
    });
  }

  public dispose(): void {
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
    this.stopFlushTimer();
    this.pendingDocuments.length = 0;
    this.closeActiveClient();
    this.debugChannel?.dispose();
  }
}

function isIndexAlreadyExistsError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) {
    return false;
  }
  const e = err as { meta?: { body?: { error?: { type?: string } } } };
  return e.meta?.body?.error?.type === 'resource_already_exists_exception';
}

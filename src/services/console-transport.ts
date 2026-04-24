import {
  TelemetryDocument,
  TelemetryTransport,
} from '../types/telemetry';
import {
  Logger,
} from '../utils/logger';

/**
 * Telemetry transport that writes events to the VS Code Output Channel
 * via the extension's Logger.
 */
export class ConsoleTransport implements TelemetryTransport {
  private readonly logger = Logger.getInstance();

  public send(doc: TelemetryDocument): void {
    if (doc.error) {
      this.logger.error(`[Telemetry] ${doc.error.message} ${doc.data ? JSON.stringify(doc.data) : ''}`);
    } else {
      this.logger.info(`[Telemetry] ${doc.eventName ?? 'unknown'} ${doc.data ? JSON.stringify(doc.data) : ''}`);
    }
  }

  public dispose(): void {
    // Nothing to clean up
  }
}

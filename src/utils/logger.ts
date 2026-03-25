import * as vscode from 'vscode';
import {
  isTestEnvironment,
} from './environment';

/**
 * Log levels for filtering
 */
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  NONE = 4
}

/**
 * Logger utility for Prompt Registry extension
 */
export class Logger {
  private static instance: Logger;
  private readonly outputChannel: any;
  private readonly isTestEnvironment: boolean;
  private logLevel: LogLevel;

  private constructor() {
    // Detect test environment
    this.isTestEnvironment = isTestEnvironment();

    // Check for LOG_LEVEL environment variable
    const envLogLevel = process.env.LOG_LEVEL?.toUpperCase();
    if (envLogLevel && envLogLevel in LogLevel) {
      this.logLevel = LogLevel[envLogLevel as keyof typeof LogLevel] as LogLevel;
    } else {
      // Default to DEBUG for normal operation, ERROR for tests if LOG_LEVEL not set
      this.logLevel = this.isTestEnvironment ? LogLevel.ERROR : LogLevel.DEBUG;
    }

    this.outputChannel = this.isTestEnvironment
      ? {
        appendLine: (message: string) => console.log(`[Prompt Registry] ${message}`),
        show: () => {},
        hide: () => {},
        dispose: () => {}
      }
      : vscode.window.createOutputChannel('Prompt Registry');
  }

  public static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  public static resetInstance(): void {
    Logger.instance = undefined as any;
  }

  /**
   * Set the minimum log level
   * @param level
   */
  public setLogLevel(level: LogLevel): void {
    this.logLevel = level;
  }

  /**
   * Get the current log level
   */
  public getLogLevel(): LogLevel {
    return this.logLevel;
  }

  public info(message: string, ...args: any[]): void {
    if (this.logLevel > LogLevel.INFO) {
      return;
    }

    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] INFO: ${message}`;
    this.outputChannel.appendLine(logMessage);

    if (args.length > 0) {
      this.outputChannel.appendLine(`  Details: ${JSON.stringify(args, null, 2)}`);
    }
  }

  public warn(message: string, ...args: any[]): void {
    if (this.logLevel > LogLevel.WARN) {
      return;
    }

    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] WARN: ${message}`;
    this.outputChannel.appendLine(logMessage);

    if (args.length > 0) {
      this.outputChannel.appendLine(`  Details: ${JSON.stringify(args, null, 2)}`);
    }
  }

  public error(message: string, error?: Error, ...args: any[]): void {
    if (this.logLevel > LogLevel.ERROR) {
      return;
    }

    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ERROR: ${message}`;
    this.outputChannel.appendLine(logMessage);

    if (error) {
      this.outputChannel.appendLine(`  Error: ${error.message}`);
      this.outputChannel.appendLine(`  Stack: ${error.stack}`);
    }

    if (args.length > 0) {
      this.outputChannel.appendLine(`  Details: ${JSON.stringify(args, null, 2)}`);
    }
  }

  public debug(message: string, ...args: any[]): void {
    if (this.logLevel > LogLevel.DEBUG) {
      return;
    }

    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] DEBUG: ${message}`;
    this.outputChannel.appendLine(logMessage);

    if (args.length > 0) {
      this.outputChannel.appendLine(`  Details: ${JSON.stringify(args, null, 2)}`);
    }
  }

  public clear(): void {
    // In test environment, this is a no-op since we use console
    // In VS Code environment, we can't clear the output channel, but we can note it
    if (!this.isTestEnvironment) {
      this.outputChannel.appendLine('--- Log cleared ---');
    }
  }

  public show(): void {
    if (!this.isTestEnvironment) {
      this.outputChannel.show();
    }
  }

  public hide(): void {
    if (!this.isTestEnvironment) {
      this.outputChannel.hide();
    }
  }

  public dispose(): void {
    if (!this.isTestEnvironment) {
      this.outputChannel.dispose();
    }
  }
}

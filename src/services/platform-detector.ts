import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import {
  InstallationScope,
  Platform,
  PlatformConfig,
  PlatformDetectionResult,
} from '../types/platform';
import {
  Logger,
} from '../utils/logger';

/**
 * Service for detecting the current VSCode platform (VSCode, Windsurf, Kiro, Cursor)
 */
export class PlatformDetector {
  private static instance: PlatformDetector;

  public static getInstance(): PlatformDetector {
    if (!PlatformDetector.instance) {
      PlatformDetector.instance = new PlatformDetector();
    }
    return PlatformDetector.instance;
  }

  private readonly logger: Logger;
  private detectionResult: PlatformDetectionResult | null = null;

  private constructor() {
    this.logger = Logger.getInstance();
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- method signature requires Promise return type
  private async detectByExecutablePath(): Promise<PlatformDetectionResult> {
    const executablePath = process.execPath;

    if (executablePath.toLowerCase().includes('windsurf')) {
      return {
        platform: Platform.WINDSURF,
        confidence: 0.9,
        executablePath
      };
    }

    if (executablePath.toLowerCase().includes('cursor')) {
      return {
        platform: Platform.CURSOR,
        confidence: 0.9,
        executablePath
      };
    }

    if (executablePath.toLowerCase().includes('kiro')) {
      return {
        platform: Platform.KIRO,
        confidence: 0.9,
        executablePath
      };
    }

    if (executablePath.toLowerCase().includes('code')) {
      return {
        platform: Platform.VSCODE,
        confidence: 0.8,
        executablePath
      };
    }

    return { platform: Platform.UNKNOWN, confidence: 0 };
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- method signature requires Promise return type
  private async detectByEnvironmentVariables(): Promise<PlatformDetectionResult> {
    const env = process.env;

    if (env.WINDSURF_PID || env.WINDSURF_IPC_HOOK) {
      return {
        platform: Platform.WINDSURF,
        confidence: 0.8,
        environment: {
          WINDSURF_PID: env.WINDSURF_PID || '',
          WINDSURF_IPC_HOOK: env.WINDSURF_IPC_HOOK || ''
        }
      };
    }

    if (env.CURSOR_PID || env.CURSOR_IPC_HOOK) {
      return {
        platform: Platform.CURSOR,
        confidence: 0.8,
        environment: {
          CURSOR_PID: env.CURSOR_PID || '',
          CURSOR_IPC_HOOK: env.CURSOR_IPC_HOOK || ''
        }
      };
    }

    if (env.KIRO_PID || env.KIRO_IPC_HOOK) {
      return {
        platform: Platform.KIRO,
        confidence: 0.8,
        environment: {
          KIRO_PID: env.KIRO_PID || '',
          KIRO_IPC_HOOK: env.KIRO_IPC_HOOK || ''
        }
      };
    }

    if (env.VSCODE_PID || env.VSCODE_IPC_HOOK) {
      return {
        platform: Platform.VSCODE,
        confidence: 0.7,
        environment: {
          VSCODE_PID: env.VSCODE_PID || '',
          VSCODE_IPC_HOOK: env.VSCODE_IPC_HOOK || ''
        }
      };
    }

    return { platform: Platform.UNKNOWN, confidence: 0 };
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- method signature requires Promise return type
  private async detectByProcessInfo(): Promise<PlatformDetectionResult> {
    try {
      const processTitle = process.title?.toLowerCase() || '';
      const argv0 = process.argv0?.toLowerCase() || '';

      if (processTitle.includes('windsurf') || argv0.includes('windsurf')) {
        return { platform: Platform.WINDSURF, confidence: 0.7 };
      }

      if (processTitle.includes('cursor') || argv0.includes('cursor')) {
        return { platform: Platform.CURSOR, confidence: 0.7 };
      }

      if (processTitle.includes('kiro') || argv0.includes('kiro')) {
        return { platform: Platform.KIRO, confidence: 0.7 };
      }

      if (processTitle.includes('code') || argv0.includes('code')) {
        return { platform: Platform.VSCODE, confidence: 0.6 };
      }
    } catch (error) {
      this.logger.warn(`Process info detection failed: ${error}`);
    }

    return { platform: Platform.UNKNOWN, confidence: 0 };
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- method signature requires Promise return type
  private async detectByConfigFiles(): Promise<PlatformDetectionResult> {
    try {
      const userDataPaths = [
        this.getUserDataPath('Windsurf'),
        this.getUserDataPath('Cursor'),
        this.getUserDataPath('Kiro'),
        this.getUserDataPath('Code')
      ];

      for (const [index, userDataPath] of userDataPaths.entries()) {
        if (fs.existsSync(userDataPath)) {
          const platforms = [Platform.WINDSURF, Platform.CURSOR, Platform.KIRO, Platform.VSCODE];
          return {
            platform: platforms[index],
            confidence: 0.5
          };
        }
      }
    } catch (error) {
      this.logger.warn(`Config file detection failed: ${error}`);
    }

    return { platform: Platform.UNKNOWN, confidence: 0 };
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- method signature requires Promise return type
  private async detectByVSCodeAPI(): Promise<PlatformDetectionResult> {
    try {
      // Try to detect using VSCode API information
      const version = vscode.version;
      const appName = vscode.env.appName?.toLowerCase();

      if (appName?.includes('windsurf')) {
        return { platform: Platform.WINDSURF, confidence: 0.9, version };
      }

      if (appName?.includes('cursor')) {
        return { platform: Platform.CURSOR, confidence: 0.9, version };
      }

      if (appName?.includes('kiro')) {
        return { platform: Platform.KIRO, confidence: 0.9, version };
      }

      // Default to VSCode if no specific detection
      return { platform: Platform.VSCODE, confidence: 0.6, version };
    } catch (error) {
      this.logger.warn(`VSCode API detection failed: ${error}`);
    }

    return { platform: Platform.UNKNOWN, confidence: 0 };
  }

  private aggregateResults(results: PlatformDetectionResult[]): PlatformDetectionResult {
    if (results.length === 0) {
      return { platform: Platform.UNKNOWN, confidence: 0 };
    }

    // Group by platform and calculate weighted confidence
    const platformScores = new Map<Platform, number>();
    const platformData = new Map<Platform, PlatformDetectionResult>();

    for (const result of results) {
      const currentScore = platformScores.get(result.platform) || 0;
      platformScores.set(result.platform, currentScore + result.confidence);

      if (!platformData.has(result.platform) || result.confidence > (platformData.get(result.platform)?.confidence || 0)) {
        platformData.set(result.platform, result);
      }
    }

    // Find platform with highest score
    let bestPlatform = Platform.UNKNOWN;
    let bestScore = 0;

    for (const [platform, score] of platformScores.entries()) {
      if (score > bestScore) {
        bestScore = score;
        bestPlatform = platform;
      }
    }

    const bestResult = platformData.get(bestPlatform);
    return {
      platform: bestPlatform,
      confidence: Math.min(bestScore / results.length, 1), // normalize confidence
      ...bestResult
    };
  }

  private getUserDataPath(appName: string): string {
    const homeDir = os.homedir();
    const platform = os.platform();

    switch (platform) {
      case 'win32': {
        return path.join(homeDir, 'AppData', 'Roaming', appName);
      }
      case 'darwin': {
        return path.join(homeDir, 'Library', 'Application Support', appName);
      }
      default: { // linux and others
        return path.join(homeDir, '.config', appName);
      }
    }
  }

  /**
   * Detect the current platform with multiple detection methods
   */
  public async detectPlatform(): Promise<PlatformDetectionResult> {
    if (this.detectionResult) {
      return this.detectionResult;
    }

    this.logger.info('Starting platform detection...');

    const detectionMethods = [
      this.detectByExecutablePath.bind(this),
      this.detectByEnvironmentVariables.bind(this),
      this.detectByProcessInfo.bind(this),
      this.detectByConfigFiles.bind(this),
      this.detectByVSCodeAPI.bind(this)
    ];

    const results: PlatformDetectionResult[] = [];

    for (const method of detectionMethods) {
      try {
        const result = await method();
        if (result.platform !== Platform.UNKNOWN) {
          results.push(result);
          this.logger.debug(`Detection method found: ${result.platform} (confidence: ${result.confidence})`);
        }
      } catch (error) {
        this.logger.warn(`Platform detection method failed: ${error}`);
      }
    }

    // Aggregate results and pick the most confident one
    this.detectionResult = this.aggregateResults(results);

    this.logger.info(`Platform detected: ${this.detectionResult.platform} (confidence: ${this.detectionResult.confidence})`);
    return this.detectionResult;
  }

  /**
   * Get platform-specific configuration
   * @param platform
   */
  public getPlatformConfig(platform: Platform): PlatformConfig {
    const configs: Record<Platform, PlatformConfig> = {
      [Platform.VSCODE]: {
        platform: Platform.VSCODE,
        bundlePrefix: 'vscode',
        installationPaths: {
          user: this.getUserDataPath('Code'),
          workspace: path.join(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '', '.vscode'),
          project: path.join(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '', '.olaf')
        },
        configFiles: ['settings.json', 'keybindings.json'],
        environmentVariables: ['VSCODE_PID', 'VSCODE_IPC_HOOK']
      },
      [Platform.WINDSURF]: {
        platform: Platform.WINDSURF,
        bundlePrefix: 'windsurf',
        installationPaths: {
          user: this.getUserDataPath('Windsurf'),
          workspace: path.join(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '', '.windsurf'),
          project: path.join(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '', '.olaf')
        },
        configFiles: ['settings.json', 'keybindings.json'],
        environmentVariables: ['WINDSURF_PID', 'WINDSURF_IPC_HOOK']
      },
      [Platform.KIRO]: {
        platform: Platform.KIRO,
        bundlePrefix: 'kiro',
        installationPaths: {
          user: this.getUserDataPath('Kiro'),
          workspace: path.join(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '', '.kiro'),
          project: path.join(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '', '.olaf')
        },
        configFiles: ['settings.json', 'keybindings.json'],
        environmentVariables: ['KIRO_PID', 'KIRO_IPC_HOOK']
      },
      [Platform.CURSOR]: {
        platform: Platform.CURSOR,
        bundlePrefix: 'cursor',
        installationPaths: {
          user: this.getUserDataPath('Cursor'),
          workspace: path.join(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '', '.cursor'),
          project: path.join(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '', '.olaf')
        },
        configFiles: ['settings.json', 'keybindings.json'],
        environmentVariables: ['CURSOR_PID', 'CURSOR_IPC_HOOK']
      },
      [Platform.UNKNOWN]: {
        platform: Platform.UNKNOWN,
        bundlePrefix: 'vscode', // fallback to vscode
        installationPaths: {
          user: this.getUserDataPath('Code'),
          workspace: path.join(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '', '.vscode'),
          project: path.join(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '', '.olaf')
        },
        configFiles: ['settings.json'],
        environmentVariables: []
      }
    };

    return configs[platform];
  }

  /**
   * Get installation path for specific scope
   * @param platform
   * @param scope
   */
  public getInstallationPath(platform: Platform, scope: InstallationScope): string {
    const config = this.getPlatformConfig(platform);
    const basePath = config.installationPaths[scope];
    return path.join(basePath, 'olaf');
  }
}

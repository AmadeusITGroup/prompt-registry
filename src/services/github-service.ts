import {
  exec,
} from 'node:child_process';
import {
  promisify,
} from 'node:util';
import axios, {
  AxiosResponse,
} from 'axios';
import * as semver from 'semver';
import * as vscode from 'vscode';
import {
  BundleInfo,
  GitHubRelease,
  VersionInfo,
} from '../types/github';
import {
  Platform,
} from '../types/platform';
import {
  Logger,
} from '../utils/logger';
import {
  escapeRegex,
} from '../utils/regex-utils';

const execAsync = promisify(exec);

/**
 * Service for interacting with GitHub API to fetch Prompt Registry releases and bundles
 */
export class GitHubService {
  private static instance: GitHubService;

  public static getInstance(): GitHubService {
    if (!GitHubService.instance) {
      GitHubService.instance = new GitHubService();
    }
    return GitHubService.instance;
  }

  /**
   * Reset the singleton instance (for testing or config reload)
   */
  public static resetInstance(): void {
    GitHubService.instance = undefined as any;
  }

  private readonly logger: Logger;
  private readonly baseUrl: string;
  private readonly owner: string;
  private readonly repo: string;
  private readonly token?: string;
  private readonly usePrivateRepo: boolean;
  private readonly useGitHubCli: boolean;
  private readonly defaultVersion: string;

  private constructor() {
    this.logger = Logger.getInstance();

    // Read configuration from VSCode settings
    const config = vscode.workspace.getConfiguration('olaf');
    this.baseUrl = config.get<string>('githubApiUrl') || 'https://api.github.com';
    this.owner = config.get<string>('repositoryOwner') || 'AmadeusITGroup';
    this.repo = config.get<string>('repositoryName') || 'olaf';
    this.token = config.get<string>('githubToken') || undefined;
    this.usePrivateRepo = config.get<boolean>('usePrivateRepository') || false;
    this.useGitHubCli = config.get<boolean>('useGitHubCli') || false;
    this.defaultVersion = config.get<string>('defaultVersion') || 'latest';

    if (this.usePrivateRepo && !this.token && !this.useGitHubCli) {
      this.logger.warn(
        'Private repository access enabled but no GitHub token provided and GitHub CLI is disabled. Please set promptregistry.githubToken in settings or enable promptregistry.useGitHubCli.'
      );
    }

    this.logger.debug(`GitHubService initialized for ${this.owner}/${this.repo} (private: ${this.usePrivateRepo}, gh-cli: ${this.useGitHubCli}, default-version: ${this.defaultVersion})`);
  }

  /**
   * Get authentication headers for GitHub API requests
   */
  private async getAuthHeaders(): Promise<Record<string, string>> {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'Prompt Registry-VSCode-Extension/1.0.0'
    };

    // Always try to use authentication if we have GitHub CLI enabled or a token configured
    // This handles cases where repositories might be private even if not explicitly configured
    const shouldUseAuth = this.usePrivateRepo || this.useGitHubCli;

    if (shouldUseAuth) {
      let token = this.token;

      if (this.useGitHubCli && !token) {
        try {
          token = await this.getGitHubCliToken();
        } catch (error) {
          this.logger.error('Failed to get token from GitHub CLI', error as Error);
          // Only throw if private repo is explicitly enabled, otherwise continue without auth
          if (this.usePrivateRepo) {
            throw new Error('GitHub CLI authentication failed. Please run "gh auth login" or provide a manual token.');
          } else {
            this.logger.warn('GitHub CLI authentication failed, continuing without authentication');
          }
        }
      }

      if (token) {
        headers.Authorization = `token ${token}`;
        this.logger.debug('Using authenticated GitHub API requests');
      } else if (this.usePrivateRepo) {
        throw new Error('No GitHub token available for private repository access');
      }
    }

    return headers;
  }

  /**
   * Check if GitHub CLI is installed and provide installation guidance
   */
  private async isGitHubCliInstalled(): Promise<boolean> {
    try {
      await execAsync('gh --version');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Provide GitHub CLI installation guidance based on platform
   */
  private getGitHubCliInstallationInstructions(): string {
    const platform = process.platform;

    switch (platform) {
      case 'win32': {
        return 'Install GitHub CLI on Windows:\n'
          + '1. Using winget: winget install --id GitHub.cli\n'
          + '2. Using Chocolatey: choco install gh\n'
          + '3. Using Scoop: scoop install gh\n'
          + '4. Download from: https://cli.github.com/';
      }
      case 'darwin': {
        return 'Install GitHub CLI on macOS:\n'
          + '1. Using Homebrew: brew install gh\n'
          + '2. Using MacPorts: sudo port install gh\n'
          + '3. Download from: https://cli.github.com/';
      }
      case 'linux': {
        return 'Install GitHub CLI on Linux:\n'
          + '1. Using apt (Ubuntu/Debian): sudo apt install gh\n'
          + '2. Using yum (CentOS/RHEL): sudo yum install gh\n'
          + '3. Using snap: sudo snap install gh\n'
          + '4. Download from: https://cli.github.com/';
      }
      default: {
        return 'Install GitHub CLI from: https://cli.github.com/';
      }
    }
  }

  /**
   * Get GitHub token from GitHub CLI with enhanced error handling
   */
  private async getGitHubCliToken(): Promise<string> {
    try {
      // First check if gh CLI is installed
      if (!(await this.isGitHubCliInstalled())) {
        const installInstructions = this.getGitHubCliInstallationInstructions();
        throw new Error(`GitHub CLI (gh) is not installed.\n\n${installInstructions}`);
      }

      // Get the token using gh auth token
      const { stdout } = await execAsync('gh auth token');
      const token = stdout.trim();

      if (!token) {
        throw new Error('No GitHub token found. Please run "gh auth login" to authenticate with your GitHub account.');
      }

      this.logger.debug('Successfully obtained token from GitHub CLI');
      return token;
    } catch (error: any) {
      this.logger.error('Failed to get GitHub CLI token', error);

      // Provide specific guidance based on the error
      if (error.message.includes('not logged into any GitHub hosts')) {
        throw new Error('Not authenticated with GitHub CLI.\n\nPlease run:\n  gh auth login\n\nto authenticate with your GitHub account.');
      }

      if (error.message.includes('could not prompt')) {
        throw new Error('GitHub CLI authentication requires interactive prompt.\n\nPlease run:\n  gh auth login\n\nin a terminal to complete authentication.');
      }

      throw error;
    }
  }

  /**
   * Get direct download URL for a GitHub release asset (for private repos)
   * @param assetId
   */
  // eslint-disable-next-line @typescript-eslint/require-await -- method signature requires Promise return type
  private async getAssetDirectDownloadUrl(assetId: number): Promise<string> {
    return `${this.baseUrl}/repos/${this.owner}/${this.repo}/releases/assets/${assetId}`;
  }

  /**
   * Get release by tag with automatic fallback between v-prefixed and non-prefixed versions
   * @param version
   */
  private async getReleaseByTagWithFallback(version: string): Promise<GitHubRelease> {
    // First, try the exact version as provided
    try {
      return await this.getReleaseByTag(version);
    } catch {
      this.logger.debug(`Failed to find release with tag "${version}", trying alternative format...`);
    }

    // If that fails, try the alternative format (add/remove "v" prefix)
    const alternativeVersion = version.startsWith('v')
      ? version.slice(1) // Remove "v" prefix
      : `v${version}`; // Add "v" prefix

    try {
      this.logger.debug(`Attempting to find release with alternative tag: ${alternativeVersion}`);
      return await this.getReleaseByTag(alternativeVersion);
    } catch (error) {
      // If both attempts fail, throw an error with helpful information
      this.logger.error(`Failed to find release with both "${version}" and "${alternativeVersion}"`, error as Error);
      throw new Error(`Release not found for version "${version}". Please check that this version exists in the repository.`);
    }
  }

  private getPlatformPrefix(platform: Platform): string {
    const prefixMap: Record<Platform, string> = {
      [Platform.VSCODE]: 'vscode',
      [Platform.WINDSURF]: 'windsurf',
      [Platform.KIRO]: 'kiro',
      [Platform.CURSOR]: 'cursor',
      [Platform.UNKNOWN]: 'vscode' // fallback
    };

    return prefixMap[platform];
  }

  /**
   * Validate GitHub token and repository access with enhanced error messaging
   */
  public async validateAccess(): Promise<{ valid: boolean; message: string }> {
    try {
      const url = `${this.baseUrl}/repos/${this.owner}/${this.repo}`;
      const headers = await this.getAuthHeaders();

      await axios.get(url, {
        headers,
        timeout: 10_000
      });

      return {
        valid: true,
        message: `Successfully validated access to ${this.owner}/${this.repo}`
      };
    } catch (error: any) {
      const status = error.response?.status;
      let message = `Failed to access repository ${this.owner}/${this.repo}`;

      switch (status) {
        case 401: {
          message += ': Invalid or missing authentication token';
          if (this.useGitHubCli) {
            message += '.\n\nTroubleshooting steps:\n';
            message += '1. Run "gh auth login" to authenticate with GitHub CLI\n';
            message += '2. Ensure you have access to the repository\n';
            message += '3. Check if your token has the required permissions';
          } else {
            message += '.\n\nTroubleshooting steps:\n';
            message += '1. Verify your GitHub token is correct\n';
            message += '2. Ensure the token has repository access permissions\n';
            message += '3. Consider enabling GitHub CLI authentication';
          }

          break;
        }
        case 403: {
          message += ': Access forbidden - check token permissions';
          message += '\n\nThe token may not have sufficient permissions to access this repository.';

          break;
        }
        case 404: {
          message += ': Repository not found or access denied';
          message += '\n\nPlease verify:\n';
          message += '1. Repository name is correct\n';
          message += '2. You have access to the repository\n';
          message += '3. Repository is not private (or you have appropriate permissions)';

          break;
        }
        default: {
          message += `: ${error.message}`;
        }
      }

      this.logger.warn(message);
      return { valid: false, message };
    }
  }

  /**
   * Get the latest release from GitHub
   */
  public async getLatestRelease(): Promise<GitHubRelease> {
    try {
      this.logger.debug('Fetching latest release from GitHub...');
      const url = `${this.baseUrl}/repos/${this.owner}/${this.repo}/releases/latest`;
      const headers = await this.getAuthHeaders();

      const response: AxiosResponse<GitHubRelease> = await axios.get(url, {
        headers,
        timeout: 10_000
      });

      this.logger.info(`Latest release found: ${response.data.tag_name}`);
      return response.data;
    } catch (error) {
      this.logger.error('Failed to fetch latest release', error as Error);
      throw new Error(`Failed to fetch latest release: ${error}`);
    }
  }

  /**
   * Get all releases from GitHub
   * @param limit
   */
  public async getAllReleases(limit = 10): Promise<GitHubRelease[]> {
    try {
      this.logger.debug(`Fetching ${limit} releases from GitHub...`);
      const url = `${this.baseUrl}/repos/${this.owner}/${this.repo}/releases`;
      const headers = await this.getAuthHeaders();

      const response: AxiosResponse<GitHubRelease[]> = await axios.get(url, {
        headers,
        params: {
          per_page: limit
        },
        timeout: 10_000
      });

      this.logger.info(`Found ${response.data.length} releases`);
      return response.data;
    } catch (error) {
      this.logger.error('Failed to fetch releases', error as Error);
      throw new Error(`Failed to fetch releases: ${error}`);
    }
  }

  /**
   * Get a specific release by tag
   * @param tag
   */
  public async getReleaseByTag(tag: string): Promise<GitHubRelease> {
    try {
      this.logger.debug(`Fetching release by tag: ${tag}`);
      const url = `${this.baseUrl}/repos/${this.owner}/${this.repo}/releases/tags/${tag}`;
      const headers = await this.getAuthHeaders();

      const response: AxiosResponse<GitHubRelease> = await axios.get(url, {
        headers,
        timeout: 10_000
      });

      this.logger.info(`Release found for tag ${tag}`);
      return response.data;
    } catch (error) {
      this.logger.error(`Failed to fetch release for tag ${tag}`, error as Error);
      throw new Error(`Failed to fetch release for tag ${tag}: ${error}`);
    }
  }

  /**
   * Find platform-specific bundle in a release
   * @param release
   * @param platform
   */
  public findPlatformBundle(release: GitHubRelease, platform: Platform): BundleInfo | null {
    const platformPrefix = this.getPlatformPrefix(platform);
    // Note: Current platform prefixes ('vscode', 'windsurf', etc.) don't contain special chars,
    // but escaping is kept for future-proofing in case platform names change
    const escapedPrefix = escapeRegex(platformPrefix);
    const bundlePattern = new RegExp(`^${escapedPrefix}-installation-bundle-(.*)\\.zip$`, 'i');

    for (const asset of release.assets) {
      const match = asset.name.match(bundlePattern);
      this.logger.debug(`Checking asset: ${asset.name}`);
      if (match) {
        const version = match[1];

        this.logger.debug(`Found bundle for ${platform}: ${asset.name}`);

        return {
          platform: platformPrefix,
          version,
          asset,
          downloadUrl: asset.browser_download_url,
          filename: asset.name,
          size: asset.size
        };
      }
    }

    this.logger.warn(`No bundle found for platform ${platform} in release ${release.tag_name}`);
    return null;
  }

  /**
   * Get all available bundles for a release
   * @param release
   */
  public getAllBundles(release: GitHubRelease): BundleInfo[] {
    const bundles: BundleInfo[] = [];
    const bundlePattern = /^(\w+)-installation-bundle-(.*?)\.zip$/i;

    for (const asset of release.assets) {
      const match = asset.name.match(bundlePattern);
      if (match) {
        const platform = match[1];
        const version = match[2];

        bundles.push({
          platform,
          version,
          asset,
          downloadUrl: asset.browser_download_url,
          filename: asset.name,
          size: asset.size
        });
      }
    }

    this.logger.debug(`Found ${bundles.length} bundles in release ${release.tag_name}`);
    return bundles;
  }

  /**
   * Parse version information from release tag
   * @param tag
   */
  public parseVersion(tag: string): VersionInfo | null {
    try {
      // Remove 'v' prefix if present
      const cleanTag = tag.startsWith('v') ? tag.substring(1) : tag;

      const version = semver.parse(cleanTag);
      if (!version) {
        this.logger.warn(`Failed to parse version: ${tag}`);
        return null;
      }

      return {
        version: version.version,
        major: version.major,
        minor: version.minor,
        patch: version.patch,
        prerelease: version.prerelease.length > 0 ? version.prerelease.join('.') : undefined,
        isPrerelease: version.prerelease.length > 0
      };
    } catch (error) {
      this.logger.error(`Error parsing version ${tag}`, error as Error);
      return null;
    }
  }

  /**
   * Compare two versions
   * @param version1
   * @param version2
   */
  public compareVersions(version1: string, version2: string): number {
    try {
      return semver.compare(version1, version2);
    } catch (error) {
      this.logger.error('Error comparing versions', error as Error);
      return 0;
    }
  }

  /**
   * Check if a version is newer than another
   * @param newVersion
   * @param currentVersion
   */
  public isNewerVersion(newVersion: string, currentVersion: string): boolean {
    return this.compareVersions(newVersion, currentVersion) > 0;
  }

  /**
   * Download a bundle from GitHub using the universal strategy that works for both public and private repos
   * @param bundleInfo
   * @param onProgress
   */
  public async downloadBundle(bundleInfo: BundleInfo, onProgress?: (progress: number) => void): Promise<Buffer> {
    try {
      this.logger.info(`Downloading bundle: ${bundleInfo.filename}`);

      // Always use the API asset download URL as it works for both public and private repos
      const downloadUrl = await this.getAssetDirectDownloadUrl(bundleInfo.asset.id);

      this.logger.debug(`Download URL: ${downloadUrl}`);
      const headers = await this.getAuthHeaders();

      // Always set proper Accept header for binary asset downloads when using API
      headers.Accept = 'application/octet-stream';

      const response = await axios.get(downloadUrl, {
        responseType: 'arraybuffer',
        headers,
        timeout: 300_000, // 5 minutes timeout for large files
        onDownloadProgress: (progressEvent) => {
          if (onProgress && progressEvent.total) {
            const progress = (progressEvent.loaded / progressEvent.total) * 100;
            onProgress(progress);
          }
        }
      });

      this.logger.info(`Bundle downloaded successfully: ${bundleInfo.filename} (${bundleInfo.size} bytes)`);
      return Buffer.from(response.data);
    } catch (error) {
      this.logger.error(`Failed to download bundle ${bundleInfo.filename}`, error as Error);

      // Enhanced error messages based on common failure scenarios
      if (error instanceof Error) {
        if (error.message.includes('401')) {
          throw new Error(`Authentication failed. ${this.useGitHubCli ? 'Please run "gh auth login" to authenticate with GitHub CLI.' : 'Please check your GitHub token.'}`);
        } else if (error.message.includes('403')) {
          throw new Error(`Access forbidden. Please verify that your token has the required permissions to access this repository.`);
        } else if (error.message.includes('404')) {
          throw new Error(`Bundle not found. Please verify that the release and asset exist in the repository.`);
        }
      }

      throw new Error(`Failed to download bundle: ${error}`);
    }
  }

  /**
   * Check if GitHub API is accessible
   */
  public async checkConnectivity(): Promise<boolean> {
    try {
      this.logger.debug('Checking GitHub API connectivity...');
      const url = `${this.baseUrl}/repos/${this.owner}/${this.repo}`;
      const headers = await this.getAuthHeaders();

      await axios.get(url, {
        headers,
        timeout: 5000
      });

      this.logger.debug('GitHub API connectivity check successful');
      return true;
    } catch (error) {
      this.logger.warn('GitHub API connectivity check failed', error as Error);
      return false;
    }
  }

  /**
   * Get release by version preference (latest or specific tag)
   * @param version
   */
  public async getReleaseByVersionPreference(version?: string): Promise<GitHubRelease> {
    const targetVersion = version || this.defaultVersion;

    return targetVersion === 'latest' ? this.getLatestRelease() : this.getReleaseByTagWithFallback(targetVersion);
  }

  /**
   * List available versions for selection
   * @param limit
   */
  public async getAvailableVersions(limit = 20): Promise<VersionInfo[]> {
    try {
      const releases = await this.getAllReleases(limit);
      const versions: VersionInfo[] = [];

      for (const release of releases) {
        const versionInfo = this.parseVersion(release.tag_name);
        if (versionInfo) {
          // Add the original tag name to the version info
          versionInfo.tagName = release.tag_name;
          versions.push(versionInfo);
        }
      }

      return versions;
    } catch (error) {
      this.logger.error('Failed to fetch available versions', error as Error);
      throw new Error(`Failed to fetch available versions: ${error}`);
    }
  }
}

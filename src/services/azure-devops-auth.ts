/**
 * Azure DevOps Authentication Service
 *
 * Resolves authentication tokens for Azure DevOps REST API access.
 * Supports two authentication methods in priority order:
 *
 * 1. Personal Access Token (PAT) from source configuration
 *    - Configure via `promptregistry.sources[].token` setting
 *    - Simplest method for most users
 *
 * 2. Azure CLI token retrieval via `az account get-access-token`
 *    - Requires Azure CLI to be installed and authenticated
 *    - Useful in CI/CD environments or when SSO is preferred
 *
 * Authentication Setup:
 * - PAT: Generate a PAT in Azure DevOps at
 *   https://dev.azure.com/{org}/_usersettings/tokens with "Code (read)" scope
 * - Azure CLI: Run `az login` before using the extension
 */

import {
  execFile,
} from 'node:child_process';
import {
  promisify,
} from 'node:util';
import {
  Logger,
} from '../utils/logger';

const execFileAsync = promisify(execFile);

/**
 * Azure DevOps resource ID used for token scope when calling Azure CLI.
 * This is the well-known resource ID for Azure DevOps Services.
 */
const ADO_RESOURCE_ID = '499b84ac-1321-427f-aa17-267ca6975798';

/**
 * Authentication method identifiers
 */
export type AzureDevOpsAuthMethod = 'pat' | 'az-cli' | 'none';

/**
 * Resolved authentication result
 */
export interface AzureDevOpsAuthResult {
  /** The resolved access token */
  token: string;
  /** How the token was obtained */
  method: AzureDevOpsAuthMethod;
}

/**
 * Azure DevOps authentication service.
 *
 * Implements a two-step fallback chain for resolving authentication tokens:
 * 1. Explicit PAT configured on the source
 * 2. Azure CLI access token
 *
 * Usage:
 * ```typescript
 * const auth = new AzureDevOpsAuthService();
 * const result = await auth.getToken(source.token);
 * if (result) {
 *   headers['Authorization'] = auth.buildAuthHeader(result.token, result.method);
 * }
 * ```
 */
export class AzureDevOpsAuthService {
  private readonly logger: Logger;

  constructor() {
    this.logger = Logger.getInstance();
  }

  /**
   * Resolve an access token for Azure DevOps API requests.
   *
   * Authentication fallback chain:
   * 1. Use `explicitToken` if provided and non-empty (PAT from source config)
   * 2. Attempt `az account get-access-token` if Azure CLI is available
   * @param explicitToken - Optional Personal Access Token from source configuration
   * @returns Resolved token and method, or undefined if no auth is available
   */
  public async getToken(explicitToken?: string): Promise<AzureDevOpsAuthResult | undefined> {
    // 1. Use explicit PAT from source configuration
    if (explicitToken && explicitToken.trim().length > 0) {
      this.logger.info('[AzureDevOpsAuth] ✓ Using explicit PAT from configuration');
      return { token: explicitToken.trim(), method: 'pat' };
    }

    // 2. Attempt Azure CLI token
    try {
      this.logger.debug('[AzureDevOpsAuth] Trying Azure CLI token...');
      const { stdout } = await execFileAsync('az', [
        'account', 'get-access-token',
        '--resource', ADO_RESOURCE_ID,
        '--query', 'accessToken',
        '--output', 'tsv'
      ]);
      const token = stdout.trim();
      if (token && token.length > 0) {
        this.logger.info('[AzureDevOpsAuth] ✓ Using Azure CLI access token');
        return { token, method: 'az-cli' };
      }
      this.logger.debug('[AzureDevOpsAuth] Azure CLI returned empty token');
    } catch (error) {
      this.logger.debug(`[AzureDevOpsAuth] Azure CLI auth failed: ${error}`);
    }

    // No authentication available
    this.logger.warn(
      '[AzureDevOpsAuth] ✗ No authentication available — private repos will be inaccessible. '
      + 'Configure a PAT via source.token or run `az login` to authenticate with Azure CLI.'
    );
    return undefined;
  }

  /**
   * Build the Authorization header value for the given token and method.
   *
   * - PAT authentication: Azure DevOps expects HTTP Basic auth with the PAT as
   *   the password and an empty username, base64-encoded as `:${pat}`.
   * - Azure CLI tokens: Standard Bearer token format.
   * @param token - Access token string
   * @param method - How the token was obtained
   * @returns Authorization header value (e.g. `Basic ...` or `Bearer ...`)
   */
  public buildAuthHeader(token: string, method: AzureDevOpsAuthMethod): string {
    if (method === 'pat') {
      // Azure DevOps PAT uses Basic auth: base64(":" + token)
      const credentials = Buffer.from(`:${token}`).toString('base64');
      return `Basic ${credentials}`;
    }
    // Azure CLI tokens are OAuth Bearer tokens
    return `Bearer ${token}`;
  }
}

/**
 * Azure DevOps Authentication Service
 *
 * Resolves authentication tokens for Azure DevOps REST API access.
 * Supports three authentication methods tried in priority order:
 *
 * 1. **Personal Access Token (PAT)** from source configuration
 *    - Configure via `promptregistry.sources[].token` setting
 *    - Simplest and most explicit method; works in all environments
 *    - Generates a Basic `Authorization: Basic base64(":"+PAT)` header
 *    - Create a PAT at https://dev.azure.com/{org}/_usersettings/tokens
 *      with at minimum "Code (read)" scope
 *
 * 2. **VS Code Microsoft authentication** (built-in, no CLI required)
 *    - Uses the VS Code built-in `microsoft` authentication provider
 *    - Prompts the user silently if they are already signed in to VS Code
 *      with a Microsoft/Entra account that has access to the ADO org
 *    - Token is scoped to the Azure DevOps resource via `.default` scope
 *    - Generates a Bearer `Authorization: Bearer <token>` header
 *    - No extra software needed — works out of the box in VS Code
 *
 * 3. **Azure CLI token** (`az account get-access-token`)
 *    - Falls back to the Azure CLI if VS Code auth is not available
 *    - Requires Azure CLI to be installed and `az login` to have been run
 *    - Useful in headless / CI/CD environments where VS Code auth is absent
 *    - Generates a Bearer `Authorization: Bearer <token>` header
 *
 * Authentication Setup Guides:
 * - PAT:           https://dev.azure.com/{org}/_usersettings/tokens
 * - VS Code auth:  Sign in to VS Code with your Microsoft/Entra account
 * - Azure CLI:     Run `az login` then `az account set --subscription <id>`
 */

import {
  execFile,
} from 'node:child_process';
import {
  promisify,
} from 'node:util';
import * as vscode from 'vscode';
import {
  Logger,
} from '../utils/logger';

const execFileAsync = promisify(execFile);

/**
 * Well-known Azure DevOps resource (client application) ID.
 * Used when requesting tokens scoped to Azure DevOps Services.
 *
 * - Azure CLI: passed as `--resource` to `az account get-access-token`
 * - VS Code: used as the scope prefix in the `.default` scope pattern
 */
const ADO_RESOURCE_ID = '499b84ac-1321-427f-aa17-267ca6975798';

/**
 * OAuth 2.0 `.default` scope for Azure DevOps Services.
 *
 * Using `.default` tells the identity platform to issue a token with all
 * the permissions that have been granted to the caller for the ADO resource.
 * This is the correct scope format for the VS Code `microsoft` auth provider.
 */
const ADO_VSCODE_SCOPES = [`${ADO_RESOURCE_ID}/.default`];

/**
 * Authentication method identifiers — reflects how the token was obtained.
 *
 * | Value              | Header format                              |
 * |--------------------|---------------------------------------------|
 * | `'pat'`            | `Authorization: Basic base64(":"+PAT)`      |
 * | `'vscode-microsoft'` | `Authorization: Bearer <access_token>`    |
 * | `'az-cli'`         | `Authorization: Bearer <access_token>`      |
 * | `'none'`           | No Authorization header                     |
 */
export type AzureDevOpsAuthMethod = 'pat' | 'vscode-microsoft' | 'az-cli' | 'none';

/**
 * Resolved authentication result returned by {@link AzureDevOpsAuthService.getToken}.
 */
export interface AzureDevOpsAuthResult {
  /** The resolved access token string */
  token: string;
  /** How the token was obtained */
  method: AzureDevOpsAuthMethod;
}

/**
 * Azure DevOps authentication service.
 *
 * Implements a three-step fallback chain for resolving authentication tokens:
 * 1. Explicit PAT configured on the source  → `Authorization: Basic …`
 * 2. VS Code Microsoft auth session         → `Authorization: Bearer …`
 * 3. Azure CLI `az account get-access-token`→ `Authorization: Bearer …`
 * @example
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
   * Tries each authentication method in order and returns as soon as one
   * succeeds. Returns `undefined` when no method is available (public repos
   * may still work without authentication).
   *
   * **Fallback chain**
   * 1. PAT — `explicitToken` parameter (from `source.token` in config)
   * 2. VS Code Microsoft auth — silent session via `vscode.authentication`
   * 3. Azure CLI — `az account get-access-token --resource <ADO_RESOURCE_ID>`
   * @param explicitToken - Optional Personal Access Token from source configuration
   * @returns Resolved token + method pair, or `undefined` if no auth is available
   */
  public async getToken(explicitToken?: string): Promise<AzureDevOpsAuthResult | undefined> {
    // ── Step 1: PAT from source configuration ───────────────────────────────────
    // This is the simplest and most explicit option. If the user has set
    // `source.token` to a valid PAT, we use it immediately without any
    // external calls.
    if (explicitToken && explicitToken.trim().length > 0) {
      this.logger.info('[AzureDevOpsAuth] ✓ Using explicit PAT from configuration');
      return { token: explicitToken.trim(), method: 'pat' };
    }

    // ── Step 2: VS Code Microsoft authentication ─────────────────────────────────
    // The VS Code `microsoft` provider can issue tokens for Azure DevOps
    // Services without any CLI tooling. We use `{ silent: true }` so we
    // only pick up an *existing* session and never show an interactive
    // login dialog during background bundle discovery.
    //
    // If the user is signed in to VS Code with an Entra/AAD account that
    // has access to the target ADO organisation, this will succeed silently.
    try {
      this.logger.debug('[AzureDevOpsAuth] Trying VS Code Microsoft authentication...');
      const session = await vscode.authentication.getSession(
        'microsoft', // VS Code built-in Microsoft/Entra ID provider
        ADO_VSCODE_SCOPES, // scoped to Azure DevOps Services resource
        { silent: true } // never prompt interactively during auto-discovery
      );
      if (session) {
        this.logger.info('[AzureDevOpsAuth] ✓ Using VS Code Microsoft authentication');
        return { token: session.accessToken, method: 'vscode-microsoft' };
      }
      this.logger.debug('[AzureDevOpsAuth] VS Code Microsoft auth: no active session found');
    } catch (error) {
      // Swallow — VS Code auth not available (headless env, test runner, etc.)
      this.logger.debug(`[AzureDevOpsAuth] VS Code Microsoft auth failed: ${error}`);
    }

    // ── Step 3: Azure CLI token ──────────────────────────────────────────────────
    // Last resort for environments where the Azure CLI is installed and
    // `az login` has been run (e.g. developer machines, CI pipelines with
    // an Azure service principal).
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
      + 'Options: (1) set source.token to a PAT with "Code (read)" scope, '
      + '(2) sign in to VS Code with your Microsoft account, or '
      + '(3) run `az login` to authenticate with Azure CLI.'
    );
    return undefined;
  }

  /**
   * Build the `Authorization` HTTP header value for a resolved token.
   *
   * **PAT tokens** use HTTP Basic auth with an **empty username** and the PAT
   * as the password.  Azure DevOps ignores the username field entirely — only
   * the password (PAT) matters.  The header looks like:
   * ```
   * Authorization: Basic base64(":myPersonalAccessToken")
   * ```
   * Note the leading colon — that encodes the empty username.
   *
   * **Bearer tokens** (VS Code Microsoft auth, Azure CLI) use the standard
   * OAuth 2.0 bearer scheme:
   * ```
   * Authorization: Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiIsIng1dCI...
   * ```
   * @param token  - The resolved access token string (must be non-empty after trimming)
   * @param method - How the token was obtained (determines the header scheme)
   * @returns Full `Authorization` header value, ready to set on an HTTP request
   * @throws {Error} If `token` is empty after trimming
   */
  public buildAuthHeader(token: string, method: AzureDevOpsAuthMethod): string {
    const trimmed = token.trim();
    if (trimmed.length === 0) {
      throw new Error('[AzureDevOpsAuth] Cannot build Authorization header: token is empty');
    }
    if (method === 'pat') {
      // Azure DevOps PAT: Basic auth with empty username, PAT as password.
      // The format is base64(":" + token) — the leading colon encodes the
      // empty username slot.
      const credentials = Buffer.from(`:${trimmed}`).toString('base64');
      return `Basic ${credentials}`;
    }
    // VS Code Microsoft tokens and Azure CLI tokens are OAuth Bearer tokens.
    // Both 'vscode-microsoft' and 'az-cli' use the same Bearer scheme.
    return `Bearer ${trimmed}`;
  }
}

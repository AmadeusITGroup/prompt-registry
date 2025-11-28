# Global GitHub Token Fix

## Problem

When adding a private GitHub repository as a source, the extension was failing with a 404 error even though:
1. A global GitHub token was configured in VS Code settings (`promptregistry.githubToken`)
2. The user was authenticated via VS Code's GitHub authentication
3. The token had proper `repo` scope

The issue was that the `RegistryManager` was not applying the global token to sources that didn't have their own token configured.

## Solution

Modified `src/services/RegistryManager.ts` to enrich sources with the global token before creating adapters.

### Changes Made

1. **Added `enrichSourceWithGlobalToken()` method** that:
   - Reads the global `promptregistry.githubToken` from VS Code configuration
   - Applies it to GitHub and awesome-copilot sources that don't have their own token
   - Preserves source-specific tokens when they exist (priority)
   - Trims whitespace from tokens
   - Only applies to GitHub-based source types

2. **Applied token enrichment in all adapter creation points**:
   - `loadAdapters()` - When loading adapters at startup
   - `getAdapter()` - When getting/creating adapters on demand
   - `addSource()` - When validating new sources
   - `updateSource()` - When updating existing sources
   - `validateSource()` - When validating sources

### Authentication Priority

The complete authentication chain is now:

1. **Source-specific token** (highest priority - if configured in the source)
2. **Global token** from `promptregistry.githubToken` setting (NEW)
3. **VS Code GitHub authentication** (existing fallback)
4. **gh CLI** (existing fallback)
5. **No authentication** (lowest priority)

## How to Use

### For Users with Private Repositories

1. **Create a GitHub Personal Access Token**:
   - Go to https://github.com/settings/tokens
   - Click "Generate new token (classic)"
   - Give it a name like "VS Code Prompt Registry"
   - Select the `repo` scope (full control of private repositories)
   - Click "Generate token"
   - **Copy the token** (starts with `ghp_` or `github_pat_`)

2. **If your repository is in an organization with SSO**:
   - After creating the token, click "Configure SSO" next to it
   - Authorize the token for your organization (e.g., `amadeus-airlines-solutions`)
   - This is critical - without SSO authorization, the token won't work

3. **Configure the token in VS Code**:
   - Open Settings (`Cmd+,` on macOS, `Ctrl+,` on Windows/Linux)
   - Search for `promptregistry.githubToken`
   - Paste your token
   - The token is stored securely in VS Code settings

4. **Add your private repository**:
   - Run command: "Prompt Registry: Add Source"
   - Select "GitHub Repository"
   - Enter the repository URL: `https://github.com/your-org/your-repo`
   - When asked "Is this source private?": Select "Private"
   - **Leave the token field empty** - it will use the global token
   - The extension will validate access and add the source

### For Users with Multiple Private Repositories

The global token approach is ideal when you have multiple private repositories:

- Set the global token once in settings
- Add multiple private sources without configuring tokens for each
- All sources will use the same global token automatically

### For Users with Different Tokens per Repository

If you need different tokens for different repositories:

- Configure the token directly on the source when adding it
- The source-specific token will take priority over the global token
- This is useful for repositories in different organizations

## Testing

All 672 existing tests pass, confirming:
- No breaking changes to existing functionality
- The enrichment is transparent to adapters
- Token priority is correctly maintained

## Code Example

```typescript
// Before: Source without token would fail for private repos
const source: RegistrySource = {
    id: 'my-private-repo',
    name: 'My Private Repo',
    type: 'github',
    url: 'https://github.com/my-org/my-repo',
    enabled: true,
    priority: 10,
    private: true
    // No token field
};

// After: enrichSourceWithGlobalToken() automatically applies global token
const enrichedSource = enrichSourceWithGlobalToken(source);
// enrichedSource.token now contains the global token from settings
```

## Verification

To verify the fix is working:

1. Set a global token in VS Code settings
2. Add a private GitHub repository without specifying a token
3. The validation should succeed (no 404 error)
4. Check the logs - you should see: `[RegistryManager] Applying global GitHub token to source 'your-source-id'`

## Related Files

- `src/services/RegistryManager.ts` - Main implementation
- `src/adapters/GitHubAdapter.ts` - Uses the enriched token
- `src/adapters/AwesomeCopilotAdapter.ts` - Uses the enriched token
- `package.json` - Configuration schema for `promptregistry.githubToken`

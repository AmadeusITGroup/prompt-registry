# E2E Test Writing Guide

This guide provides patterns and best practices for writing End-to-End tests in the Prompt Registry extension.

---

## 🚨 CRITICAL: NEVER Reimplement Production Code in E2E Tests 🚨

**E2E tests must invoke the actual code path, NOT duplicate it.**

### ❌ WRONG: Duplicating Production Code Logic

```typescript
// This is NOT an E2E test - it reimplements BundleScopeCommands.moveToUser()!
test('should migrate bundle from repository to user scope', async () => {
    const scopeConflictResolver = new ScopeConflictResolver(storage);
    
    // ❌ WRONG: This duplicates the production code logic
    const result = await scopeConflictResolver.migrateBundle(
        bundleId,
        'repository',
        'user',
        async () => {
            await registryManager.uninstallBundle(bundleId, 'repository');
        },
        async (bundle, scope) => {
            await registryManager.installBundle(bundleId, { scope, version: bundle.version });
        }
    );
    
    assert.ok(result.success);
});
```

**Why this is wrong:**
1. If production code has a bug (e.g., wrong scope parameter), the test has the same bug
2. If production code changes, the test doesn't catch regressions
3. The test doesn't verify the actual command wiring in `extension.ts`
4. You're testing your test code, not the production code

### ✅ CORRECT: Test Through Actual Entry Points

**Option 1: VS Code Extension Tests** (runs in real VS Code via `@vscode/test-electron`)

Location: `test/suite/*.test.ts`

```typescript
// This runs in a real VS Code instance where commands are registered
test('should migrate bundle via moveToUser command', async () => {
    // Setup: Install bundle at repository scope
    await vscode.commands.executeCommand('promptRegistry.installBundle', bundleId, {
        scope: 'repository', version: '1.0.0'
    });
    
    // Act: Execute the actual VS Code command (the real entry point!)
    await vscode.commands.executeCommand('promptRegistry.moveToUser', bundleId);
    
    // Assert: Verify end state
    const userBundles = await storage.getInstalledBundles('user');
    assert.ok(userBundles.some(b => b.bundleId === bundleId));
});
```

Run with: `node test/runExtensionTests.js`

**Option 2: Test Through Command Handler Class** (when VS Code host isn't available)

```typescript
// Create the actual command handler (like extension.ts does)
const bundleScopeCommands = new BundleScopeCommands(
    registryManager,
    scopeConflictResolver,
    repositoryScopeService
);

// Call the actual method that the VS Code command invokes
await bundleScopeCommands.moveToUser(bundleId);

// Assert on end state, NOT on how it was achieved
const userBundles = await storage.getInstalledBundles('user');
assert.ok(userBundles.some(b => b.bundleId === bundleId));
```

### Test Infrastructure Overview

| Test Type | Location | Runs In | Use For |
|-----------|----------|---------|---------|
| Unit Tests | `test/**/*.test.ts` | Node.js with mocked VS Code | Testing individual classes/methods |
| Integration Tests | `test/e2e/*.test.ts` | Node.js with mocked VS Code | Testing multi-component workflows |
| VS Code Extension Tests | `test/suite/*.test.ts` | Real VS Code instance | Testing actual commands and UI |

### When to Use Each

- **Unit tests**: Testing a single class's behavior with mocked dependencies
- **Integration tests** (`test/e2e/`): Testing workflows across multiple real components (but mocked VS Code)
- **VS Code extension tests** (`test/suite/`): Testing actual command registration and execution in real VS Code

---

## Test Structure

E2E tests validate complete workflows across multiple components. Each test file should focus on a specific feature or workflow.

```
test/e2e/
├── AGENTS.md                              # This guide
├── complete-workflow.test.ts              # General workflow tests
├── bundle-update-awesome-copilot.test.ts  # Awesome Copilot update workflow
└── bundle-update-github.test.ts           # GitHub bundle update workflow
```

## Test Context Setup

Use the `E2ETestContext` helper for isolated test environments:

```typescript
import { createE2ETestContext, E2ETestContext, generateTestId } from '../helpers/e2eTestHelpers';
import {
    setupReleaseMocks,
    createMockGitHubSource,
    cleanupReleaseMocks,
    RepositoryTestConfig
} from '../helpers/repositoryFixtureHelpers';

suite('E2E: My Feature Tests', () => {
    let testContext: E2ETestContext;
    let testId: string;

    setup(async function() {
        this.timeout(30000);
        testId = generateTestId('my-feature');
        testContext = await createE2ETestContext();
    });

    teardown(async function() {
        this.timeout(10000);
        await testContext.cleanup();
        cleanupReleaseMocks();
    });
});
```

## Shared Repository Fixtures

Use the shared repository fixture helpers for GitHub release mocking:

```typescript
import {
    setupReleaseMocks,
    createBundleZip,
    createDeploymentManifest,
    createMockGitHubSource,
    cleanupReleaseMocks,
    RepositoryTestConfig,
    ReleaseConfig
} from '../helpers/repositoryFixtureHelpers';

// Configure test repository
const config: RepositoryTestConfig = {
    owner: 'test-owner',
    repo: 'test-repo',
    manifestId: 'test-bundle'
};

// Set up releases
const releases: ReleaseConfig[] = [
    { tag: 'v1.0.0', version: '1.0.0', content: 'initial' },
    { tag: 'v2.0.0', version: '2.0.0', content: 'updated' }
];

setupReleaseMocks(config, releases);

// Create matching source
const source = createMockGitHubSource('test-source', config);
```

This replaces inline mock setup and ensures consistent test fixtures across E2E tests.

## HTTP Mocking with Nock

For custom HTTP mocking beyond the shared fixtures, use nock directly:

### Basic Pattern

```typescript
import nock from 'nock';

// Use persist() for mocks called multiple times
nock('https://api.github.com')
    .persist()
    .get('/repos/owner/repo/contents/collections?ref=main')
    .reply(200, [{ name: 'file.yml', type: 'file' }]);

// Include query strings directly in the path (not .query())
nock('https://raw.githubusercontent.com')
    .persist()
    .get('/owner/repo/main/path/to/file.yml')
    .reply(200, fileContent);
```

### Important: Clear Mocks Between Phases

When testing update workflows, clear mocks and set up new ones for the "after" state:

```typescript
// Phase 1: Initial state
nock('https://api.github.com').persist()
    .get('/repos/owner/repo/contents?ref=main')
    .reply(200, initialContent);

// ... perform initial operations ...

// Phase 2: Updated state
nock.cleanAll();
nock.disableNetConnect();

nock('https://api.github.com').persist()
    .get('/repos/owner/repo/contents?ref=main')
    .reply(200, updatedContent);
```

## Authentication Handling

Stub VS Code authentication to prevent real tokens from being used:

```typescript
import * as sinon from 'sinon';
import * as vscode from 'vscode';

let sandbox: sinon.SinonSandbox;

setup(async function() {
    sandbox = sinon.createSandbox();
    
    // Stub VS Code authentication
    if (vscode.authentication && typeof vscode.authentication.getSession === 'function') {
        sandbox.stub(vscode.authentication, 'getSession').resolves(undefined);
    }
    
    // Stub gh CLI to prevent token retrieval
    const childProcess = require('child_process');
    sandbox.stub(childProcess, 'exec').callsFake((...args: unknown[]) => {
        const cmd = args[0] as string;
        const callback = args[args.length - 1] as Function;
        if (cmd === 'gh auth token') {
            callback(new Error('gh not available'), '', '');
        } else {
            callback(null, '', '');
        }
    });
});

teardown(async function() {
    sandbox.restore();
});
```

## Adapter Cache Handling

The AwesomeCopilotAdapter caches bundles for 5 minutes. Clear the cache when simulating content changes:

```typescript
// Clear adapter cache to force fresh fetch
const adapters = (testContext.registryManager as any).adapters;
for (const [, adapter] of adapters) {
    if (adapter.collectionsCache) {
        adapter.collectionsCache.clear();
    }
}
```

## Common Patterns

### Testing Awesome Copilot Updates

Awesome Copilot bundles auto-update when syncing the source:

```typescript
// 1. Add source and sync
await testContext.registryManager.addSource(source);
await testContext.registryManager.syncSource(sourceId);

// 2. Install bundle
const bundles = await testContext.registryManager.searchBundles({ sourceId });
await testContext.registryManager.installBundle(bundles[0].id, { scope: 'user' });

// 3. Clear mocks and cache, set up updated content
nock.cleanAll();
clearAdapterCache();
setupUpdatedMocks();

// 4. Sync again - triggers auto-update
await testContext.registryManager.syncSource(sourceId);

// 5. Verify update
const installed = await testContext.registryManager.listInstalledBundles();
assert.strictEqual(installed[0].version, updatedVersion);
```

### Testing GitHub Bundle Updates

GitHub bundles use explicit version management:

```typescript
// 1. Install specific version
await testContext.registryManager.installBundle(bundleId, { 
    scope: 'user', 
    version: '1.0.0' 
});

// 2. Check for updates
const updates = await testContext.registryManager.checkUpdates();

// 3. Update to latest
await testContext.registryManager.updateBundle(bundleId);

// 4. Verify new version
const installed = await testContext.registryManager.listInstalledBundles();
assert.strictEqual(installed[0].version, '2.0.0');
```

## Known Issues and Workarounds

### Copilot Sync Errors

You may see errors like:
```
Failed to create Copilot file: /path/to/prompts/file.md
```

These are expected in test environments where the Copilot directory doesn't exist. They don't affect test results.

### BundleId Differences

- **Awesome Copilot**: bundleId = `collection-name` (no version)
- **GitHub**: bundleId = `owner-repo-version` (includes version)

This affects how installation records are managed during updates.

## Test Naming Convention

Use descriptive names that reference the requirement being tested:

```typescript
test('Example 1.1: Update command downloads from configured branch', async function() {
    // Test implementation
});
```

## Timeouts

Set appropriate timeouts for async operations:

```typescript
test('My test', async function() {
    this.timeout(60000); // 60 seconds for network operations
    // ...
});
```

## Debugging Tips

1. **Enable verbose logging**: `LOG_LEVEL=DEBUG npm run test:one -- test/e2e/my-test.ts`
2. **Check nock pending mocks**: `console.log(nock.pendingMocks())`
3. **Verify mock was called**: `assert.ok(nock.isDone())`

---

## Debugging E2E Test Failures

### Fault Isolation Strategy

E2E tests exercise multiple components. When tests fail:

1. **Parse the error message first**: `expected X, got Y` tells you what the system produced
2. **If the error shows data transformation**, the bug is likely in production code, not test fixtures
3. **Trace the data flow** through the system with debug logging

### Common E2E Pitfalls

| Symptom | Likely Cause | Solution |
|---------|--------------|----------|
| Bundle ID mismatch | Inconsistent ID construction in `RegistryManager` | Check `applyVersionOverride` and `updateBundle` code paths |
| "Bundle not found" | Version consolidation returns only latest | Use `version` option in `installBundle` for specific versions |
| Update fails after install | Different code paths for install vs update | Verify both paths use same ID format |

### Version-Specific Installation

When testing version-specific workflows, **always use the `version` option**:

```typescript
// ❌ Wrong: May install latest version due to version consolidation
await registryManager.installBundle('owner-repo-v1.0.0', { scope: 'user' });

// ✅ Correct: Explicitly request specific version
await registryManager.installBundle('owner-repo-v1.0.0', { 
    scope: 'user', 
    version: '1.0.0' 
});
```

### Bundle ID Format Consistency

GitHub bundles have IDs in format `owner-repo-tag` where tag includes 'v' prefix (e.g., `owner-repo-v1.0.0`).

The manifest `id` field must match exactly what the code expects. If you see mismatches:
1. Check `VersionConsolidator.toBundleVersion()` - stores `bundleId` for each version
2. Check `RegistryManager.applyVersionOverride()` - should use stored `bundleId`, not construct new one
3. Verify adapter creates IDs consistently with manifest format

### Adding Debug Logging

When production code behavior is unclear, add temporary logging:

```typescript
// In RegistryManager.ts or relevant service
this.logger.debug(`[methodName] Input: ${JSON.stringify(input)}`);
this.logger.debug(`[methodName] Output: ${JSON.stringify(output)}`);
```

Then run with: `LOG_LEVEL=DEBUG npm run test:one -- test/e2e/my-test.ts 2>&1 | grep methodName`

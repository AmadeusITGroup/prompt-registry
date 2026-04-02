# Test Writing Guide for AI Agents

Efficient test writing patterns for this repository.

---

## 🚨 MANDATORY: Test Behavior, Not Implementation 🚨

**Tests MUST verify expected behavior through public entry points, NEVER implementation details.**

### The Rule

| ✅ DO | ❌ DON'T |
|-------|----------|
| Test public methods and their observable outcomes | Test private methods or internal state |
| Assert on return values, side effects, and thrown errors | Assert on how internal code paths execute |
| Mock external boundaries (HTTP, file system, VS Code API) | Mock internal collaborators within the same module |
| Write tests that survive refactoring | Write tests that break when internals change |

### What This Means in Practice

**Unit Tests**: Test the public API of a class/module
```typescript
// ✅ CORRECT: Testing public behavior
test('should return installed bundles sorted by name', async () => {
    const result = await registryManager.getInstalledBundles();
    assert.strictEqual(result[0].name, 'alpha-bundle');
});

// ❌ WRONG: Testing implementation details
test('should call _sortBundles internally', async () => {
    const spy = sandbox.spy(registryManager, '_sortBundles');
    await registryManager.getInstalledBundles();
    assert.ok(spy.called); // This tests HOW, not WHAT
});
```

**Integration Tests**: Test real scenarios end-to-end
```typescript
// ✅ CORRECT: Testing a real user scenario
test('should install bundle from GitHub and make it available', async () => {
    await registryManager.installBundle('owner/repo');
    const installed = await registryManager.getInstalledBundles();
    assert.ok(installed.some(b => b.id === 'owner/repo'));
});

// ❌ WRONG: Testing internal coordination
test('should call adapter then installer then storage', async () => {
    const adapterSpy = sandbox.spy(adapter, 'fetchBundle');
    const installerSpy = sandbox.spy(installer, 'install');
    const storageSpy = sandbox.spy(storage, 'save');
    await registryManager.installBundle('owner/repo');
    assert.ok(adapterSpy.calledBefore(installerSpy)); // Fragile!
    assert.ok(installerSpy.calledBefore(storageSpy)); // Fragile!
});
```

### Why This Matters

1. **Refactoring freedom**: Tests that focus on behavior allow you to change implementation without breaking tests
2. **Meaningful failures**: When a behavior test fails, it means actual functionality is broken
3. **Documentation value**: Behavior tests document what the code does, not how it does it
4. **Reduced maintenance**: Implementation-focused tests require constant updates as code evolves

### Red Flags Your Test Is Testing Implementation

- Spying on private methods (`_methodName`)
- Asserting on call counts of internal methods
- Testing the order of internal operations
- Mocking classes that are internal to the module under test
- Test breaks when you refactor without changing behavior

---

## Commands

```bash
# Run specific test (no LOG_LEVEL needed for debugging)
npm run test:one -- test/services/MyService.test.ts

# Run unit/all tests (use LOG_LEVEL to reduce noise)
LOG_LEVEL=ERROR npm run test:unit
LOG_LEVEL=ERROR npm test

# Capture output once, analyze multiple times
LOG_LEVEL=ERROR npm run test:unit 2>&1 | tee test-output.log
grep "passing\|failing" test-output.log
```

---

## Discovery First (CRITICAL)

**Check existing patterns BEFORE writing tests.**

```bash
# Find similar tests
ls test/services/   # or adapters/, commands/, ui/

# Check helpers
cat test/helpers/bundle-test-helpers.ts
cat test/helpers/property-test-helpers.ts
```

If utilities exist, **USE THEM**. Don't recreate.

---

## Test Types

| Type | Suffix | Purpose |
|------|--------|---------|
| Unit | `.test.ts` | Single component |
| Property | `.property.test.ts` | Invariant testing |
| Integration | `.integration.test.ts` | Multi-component |
| E2E | `test/e2e/` | Full workflows |

---

## 🚨 CRITICAL: Test Deduplication Rules 🚨

### One Class = Maximum Two Test Files

For any class `MyService`:
- `MyService.test.ts` - Unit tests (specific examples, edge cases)
- `MyService.property.test.ts` - Property tests (invariants across inputs)

**That's it. No more files.**

❌ **NEVER create:**
- `MyServiceBehaviorA.test.ts`
- `MyServiceBehaviorB.test.ts`  
- `MyServiceIntegration.test.ts`
- `ExtensionMyServiceUsage.test.ts`

### Unit vs Property: No Overlap

| Unit Tests Cover | Property Tests Cover |
|------------------|---------------------|
| Specific input → specific output | Invariant holds for ALL inputs |
| Edge cases (null, empty, boundary) | Format/structure guarantees |
| Error messages and exceptions | Idempotence, commutativity |
| One example of each behavior | Statistical confidence across inputs |

**If you wrote a unit test for it, DON'T write a property test for the same thing.**

```typescript
// ✅ Unit test: specific example
test('should return expected state after operation', async () => {
    await service.doOperation();
    assert.strictEqual(await service.getState(), ExpectedState.DONE);
});

// ✅ Property test: invariant across ALL inputs (different concern)
test('state is always valid after any operation sequence', async () => {
    await fc.assert(fc.asyncProperty(
        fc.array(fc.constantFrom('op1', 'op2', 'op3')),
        async (ops) => {
            // ... apply ops
            return isValidState(await service.getState());
        }
    ));
});

// ❌ WRONG: Property test that duplicates unit test
test('doOperation sets state to DONE', async () => {
    await fc.assert(fc.asyncProperty(
        fc.integer({ min: 1, max: 10 }), // Pointless variation
        async (count) => {
            await service.doOperation();
            return await service.getState() === ExpectedState.DONE; // Same as unit test!
        }
    ));
});
```

### E2E Tests: Commands Only, Not Methods

E2E tests verify **user-facing commands**, not internal methods.

```typescript
// ✅ CORRECT E2E: Tests actual VS Code command
test('command resets application state', async () => {
    await vscode.commands.executeCommand('myExtension.resetState');
    // Assert on observable outcome
});

// ❌ WRONG E2E: Just calls the same method as unit tests
test('should reset state', async () => {
    await stateManager.reset(); // This is a UNIT test, not E2E!
    assert.strictEqual(await stateManager.getState(), State.INITIAL);
});
```

### Before Writing Tests: Search First

```bash
# Check if behavior is already tested
grep -r "the behavior you want to test" test/ --include="*.test.ts" | head -10

# If you find existing tests, ADD to that file, don't create new file
```

### Consolidation Checklist

Before creating a new test file, verify:
- [ ] No existing test file for this class
- [ ] Behavior isn't already covered in property tests
- [ ] E2E test actually uses VS Code commands, not direct method calls
- [ ] Test file count for this feature ≤ 3

---

## Template

```typescript
import * as assert from 'assert';
import * as sinon from 'sinon';
import { BundleBuilder, createMockInstalledBundle } from '../helpers/bundle-test-helpers';

suite('ComponentName', () => {
    let sandbox: sinon.SinonSandbox;

    // ===== Utilities FIRST =====
    const resetAllMocks = (): void => { /* reset stubs */ };

    setup(() => { sandbox = sinon.createSandbox(); });
    teardown(() => { sandbox.restore(); });

    suite('methodName()', () => {
        test('should handle success case', async () => {
            // Arrange → Act → Assert
        });
    });
});
```

---

## Key Helpers

### bundleTestHelpers.ts
```typescript
import {
    BundleBuilder,                // Fluent builder for Bundle
    createMockInstalledBundle,    // Factory for InstalledBundle
    createMockUpdateCheckResult,  // Factory for UpdateCheckResult
    setupUpdateAvailable,         // Mock setup for updates
    resetBundleCommandsMocks      // Reset all mocks
} from '../helpers/bundle-test-helpers';

const bundle = BundleBuilder.github('owner', 'repo').withVersion('1.0.0').build();
const installed = createMockInstalledBundle('bundle-id', '1.0.0');
```

### lockfileTestHelpers.ts
```typescript
import {
    LockfileBuilder,              // Fluent builder for Lockfile
    createMockLockfile,           // Factory for quick mock generation
    LockfileGenerators            // fast-check generators for property tests
} from '../helpers/lockfile-test-helpers';

const lockfile = new LockfileBuilder()
    .withBundle('bundle-id', { version: '1.0.0', sourceId: 'source-1' })
    .withSource('source-1', { type: 'github', url: 'https://github.com/org/repo' })
    .build();
```

### repositoryFixtureHelpers.ts
```typescript
import {
    setupReleaseMocks,            // Configure nock for GitHub releases
    createBundleZip,              // Generate valid bundle ZIP
    createDeploymentManifest,     // Generate deployment manifest
    createMockGitHubSource,       // Create mock GitHub source
    cleanupReleaseMocks           // Clear nock mocks
} from '../helpers/repository-fixture-helpers';

// Set up GitHub release mocks for E2E tests
setupReleaseMocks(
    { owner: 'test-owner', repo: 'test-repo', manifestId: 'test-bundle' },
    [{ tag: 'v1.0.0', version: '1.0.0', content: 'initial' }]
);
```

### propertyTestHelpers.ts
```typescript
import {
    BundleGenerators,     // version(), bundleId()
    PropertyTestConfig,   // RUNS.QUICK, FAST_CHECK_OPTIONS
    ErrorCheckers         // indicatesAuthIssue(), indicatesNetworkIssue()
} from '../helpers/property-test-helpers';

await fc.assert(
    fc.asyncProperty(BundleGenerators.bundleId(), async (id) => { return true; }),
    { ...PropertyTestConfig.FAST_CHECK_OPTIONS, numRuns: PropertyTestConfig.RUNS.QUICK }
);
```

---

## VS Code Mocking

Project uses `test/mocha.setup.js` for VS Code API mocks. If you get "Cannot read properties of undefined":
1. Check if API is in `test/mocha.setup.js`
2. Add missing APIs there first

```typescript
const mockContext: vscode.ExtensionContext = {
    globalState: {
        get: (key, def) => globalStateData.get(key) ?? def,
        update: async (key, val) => { globalStateData.set(key, val); },
        keys: () => Array.from(globalStateData.keys()),
        setKeysForSync: sandbox.stub()
    } as any,
    globalStorageUri: vscode.Uri.file('/mock/storage'),
    // ... see existing tests for full pattern
} as vscode.ExtensionContext;
```

---

## HTTP Mocking

```typescript
import nock from 'nock';

nock('https://api.github.com')
    .get('/repos/owner/repo/releases')
    .reply(200, mockData);

teardown(() => { nock.cleanAll(); });
```

---

## Anti-Patterns

### 🚨 Implementation Testing (FORBIDDEN)

❌ **NEVER** spy on private methods: `sandbox.spy(service, '_internalMethod')`
❌ **NEVER** assert on internal call counts: `assert.ok(internalSpy.calledOnce)`
❌ **NEVER** test internal state: `assert.strictEqual(service._cache.size, 3)`
❌ **NEVER** mock internal collaborators: `sandbox.stub(service, '_helper')`

✅ **ALWAYS** test through public entry points
✅ **ALWAYS** assert on observable outcomes (return values, side effects, errors)
✅ **ALWAYS** mock only external boundaries (HTTP, file system, VS Code API)

### 🚨 E2E Tests: NEVER Reimplement Production Code (CRITICAL)

**E2E tests must invoke the actual code path, NOT duplicate it.**

❌ **WRONG**: Manually calling internal methods with the same logic as production code:
```typescript
// This is NOT an E2E test - it's reimplementing production code!
test('should migrate bundle from repository to user scope', async () => {
    const scopeConflictResolver = new ScopeConflictResolver(storage);
    
    // ❌ WRONG: This duplicates BundleScopeCommands.moveToUser() logic
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

✅ **CORRECT**: Test through the actual entry point:

**Option 1: VS Code Extension Tests** (runs in real VS Code via `@vscode/test-electron`)
```typescript
// In test/suite/integration-scenarios.test.ts
test('should migrate bundle via moveToUser command', async () => {
    // Setup: Install bundle at repository scope
    await vscode.commands.executeCommand('promptRegistry.installBundle', bundleId, {
        scope: 'repository', version: '1.0.0'
    });
    
    // Act: Execute the actual VS Code command
    await vscode.commands.executeCommand('promptRegistry.moveToUser', bundleId);
    
    // Assert: Verify end state (files moved, lockfile updated)
    const userBundles = await storage.getInstalledBundles('user');
    assert.ok(userBundles.some(b => b.bundleId === bundleId));
});
```

**Option 2: Test through the Command Handler Class**
```typescript
// If you can't run in VS Code, at least test through the actual class
test('should migrate bundle via BundleScopeCommands.moveToUser', async () => {
    // Create the actual command handler (like extension.ts does)
    const bundleScopeCommands = new BundleScopeCommands(
        registryManager,
        scopeConflictResolver,
        repositoryScopeService
    );
    
    // Call the actual method that the VS Code command invokes
    await bundleScopeCommands.moveToUser(bundleId);
    
    // Assert on end state
    const userBundles = await storage.getInstalledBundles('user');
    assert.ok(userBundles.some(b => b.bundleId === bundleId));
});
```

### Test Infrastructure Overview

| Test Type | Location | Runs In | Use For |
|-----------|----------|---------|---------|
| Unit Tests | `test/**/*.test.ts` | Node.js with mocked VS Code | Testing individual classes/methods |
| Integration Tests | `test/e2e/*.test.ts` | Node.js with mocked VS Code | Testing multi-component workflows |
| VS Code Extension Tests | `test/suite/*.test.ts` | Real VS Code instance | Testing actual commands and UI |

**To run VS Code extension tests:**
```bash
node test/runExtensionTests.js
```

### 🚨 DECISION: When to Use Real VS Code Instance Tests 🚨

**Before writing complex mock setups, ask: Would this test be simpler and more reliable in a real VS Code instance?**

| Scenario | Recommendation |
|----------|----------------|
| Testing VS Code commands (`vscode.commands.executeCommand`) | ✅ Real VS Code (`test/suite/`) |
| Testing UI interactions (TreeView, WebView, QuickPick) | ✅ Real VS Code (`test/suite/`) |
| Testing file system operations with workspace folders | ✅ Real VS Code (`test/suite/`) |
| Testing extension activation and lifecycle | ✅ Real VS Code (`test/suite/`) |
| Testing pure business logic with no VS Code dependencies | ✅ Unit tests with mocks |
| Testing HTTP/network interactions | ✅ Unit tests with nock |
| Testing data transformations and utilities | ✅ Unit tests with mocks |

**Red flags that your test needs real VS Code:**
- Mock setup exceeds 50 lines
- You're mocking 5+ VS Code APIs in one test
- Test logic duplicates production code to "simulate" VS Code behavior
- Tests are brittle and break when VS Code API changes
- You're fighting TypeScript to make mocks type-compatible

**Benefits of real VS Code tests:**
- No mock maintenance burden
- Tests actual integration with VS Code APIs
- Catches real-world issues mocks would miss
- Simpler test code, easier to understand

**Trade-offs:**
- Slower execution (launches VS Code instance)
- Requires display or xvfb for CI
- Harder to isolate specific behaviors

**When in doubt**: If your mock setup is becoming complex and error-prone, move the test to `test/suite/` and run it in a real VS Code instance. A working test in real VS Code is better than a broken test with elaborate mocks.

### 🚨 Test Duplication (FORBIDDEN)

❌ **NEVER** create multiple test files for the same class
❌ **NEVER** write property tests that just repeat unit test assertions with random inputs
❌ **NEVER** write E2E tests that call internal methods instead of commands
❌ **NEVER** copy production code into test helper classes
❌ **NEVER** test the same behavior in multiple files

✅ **ALWAYS** search for existing tests before writing new ones
✅ **ALWAYS** add tests to existing files rather than creating new files
✅ **ALWAYS** ensure unit/property/E2E tests cover DIFFERENT concerns
✅ **ALWAYS** test through actual VS Code commands in E2E tests

### Other Anti-Patterns

❌ Over-mocking: `sandbox.createStubInstance(MyService)`
✅ Real instances: `new MyService(mockContext)` + stub externals only

❌ Duplicate utilities when helpers exist
✅ Import from `test/helpers/`

❌ Repeatedly modifying test fixtures when tests fail
✅ First verify if the bug is in production code by reading error messages carefully

---

## Debugging Test Failures

### Determine Fault Location First

Before iterating on fixes, determine if the bug is in **test code** or **production code**:

1. **Parse the error message**: `expected X, got Y` - where does `Y` come from?
2. **If `Y` is a transformation of your input** (e.g., `v1.0.0` → `1.0.0`), the bug is likely in production code
3. **Add debug logging to production code**: Use `LOG_LEVEL=DEBUG` and add temporary logging to trace data flow
4. **Check multiple code paths**: Different methods may handle the same data differently

### Debug Logging Strategy

```bash
# Run with debug logging
LOG_LEVEL=DEBUG npm run test:one -- test/path/to/test.ts 2>&1 | grep -E "(keyword1|keyword2)" | head -30

# Capture full output for analysis
LOG_LEVEL=DEBUG npm run test:one -- test/path/to/test.ts 2>&1 | tee debug.log | tail -50
```

### Common Root Causes

| Symptom | Likely Cause |
|---------|--------------|
| ID mismatch errors | Inconsistent ID construction across code paths |
| "Not found" after successful creation | Version consolidation hiding older versions |
| Different behavior in similar operations | Multiple code paths with different logic |

---

## Naming

**Files**: `Component.test.ts`, `Component.behavior.test.ts`
**Never**: `.fix.test.ts`, `.bugfix.test.ts`

**Descriptions**: `'should find bundle via identity matching'`
**Never**: `'should fix the bug'`

---

## Fixtures

```
test/fixtures/
├── local-library/      # Local bundles
├── github/             # GitHub API mocks
└── apm/                # APM registry mocks
```

```typescript
const response = require('../fixtures/github/releases-response.json');
```

---

## Checklist

- [ ] **Tests verify behavior through public entry points, NOT implementation details**
- [ ] Checked `test/helpers/` for existing utilities
- [ ] Found similar tests in same category
- [ ] **Searched for existing tests covering this behavior** (`grep -r "behavior" test/`)
- [ ] **Test file count for this class ≤ 2** (unit + property only)
- [ ] **Unit and property tests cover DIFFERENT concerns** (no overlap)
- [ ] **E2E tests use VS Code commands, not direct method calls**
- [ ] Using Mocha TDD style (`suite`, `test`)
- [ ] Behavior-focused names
- [ ] Mocking only external boundaries (HTTP, file system, VS Code API)
- [ ] **Considered if test would be simpler in real VS Code instance** (if mock setup is complex)

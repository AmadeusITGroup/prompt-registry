# Test Writing Guide for AI Agents

Efficient test writing patterns for this repository.

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
cat test/helpers/bundleTestHelpers.ts
cat test/helpers/propertyTestHelpers.ts
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

## Template

```typescript
import * as assert from 'assert';
import * as sinon from 'sinon';
import { BundleBuilder, createMockInstalledBundle } from '../helpers/bundleTestHelpers';

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
} from '../helpers/bundleTestHelpers';

const bundle = BundleBuilder.github('owner', 'repo').withVersion('1.0.0').build();
const installed = createMockInstalledBundle('bundle-id', '1.0.0');
```

### propertyTestHelpers.ts
```typescript
import {
    BundleGenerators,     // version(), bundleId()
    PropertyTestConfig,   // RUNS.QUICK, FAST_CHECK_OPTIONS
    ErrorCheckers         // indicatesAuthIssue(), indicatesNetworkIssue()
} from '../helpers/propertyTestHelpers';

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

❌ Over-mocking: `sandbox.createStubInstance(MyService)`
✅ Real instances: `new MyService(mockContext)` + stub externals only

❌ Duplicate utilities when helpers exist
✅ Import from `test/helpers/`

❌ Testing implementation: `assert.ok(service._private.called)`
✅ Testing behavior: `assert.strictEqual(result.status, 'success')`

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
├── gitlab/             # GitLab API mocks
└── platform-bundles/   # Platform-specific
```

```typescript
const response = require('../fixtures/github/releases-response.json');
```

---

## Checklist

- [ ] Checked `test/helpers/` for existing utilities
- [ ] Found similar tests in same category
- [ ] Using Mocha TDD style (`suite`, `test`)
- [ ] Behavior-focused names
- [ ] Mocking only external boundaries

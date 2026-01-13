# Testing Guide

This guide covers testing practices for the Prompt Registry extension.

## Quick Start

```bash
# Run all tests
LOG_LEVEL=ERROR npm test

# Run specific test file
npm run test:one -- test/services/MyService.test.ts

# Run unit tests only
LOG_LEVEL=ERROR npm run test:unit

# Run with coverage
LOG_LEVEL=ERROR npm run test:coverage
```

Use `LOG_LEVEL=ERROR` to suppress debug output and keep test results readable.

## Test Structure

```
test/
├── adapters/           # Adapter unit tests
├── commands/           # Command handler tests
├── services/           # Service layer tests
├── storage/            # Storage tests
├── ui/                 # UI component tests
├── utils/              # Utility tests
├── e2e/                # End-to-end workflow tests
├── fixtures/           # Test data and mock responses
├── helpers/            # Shared test utilities
└── mocks/              # Mock implementations
```

## Test Types

| Type | Suffix | Purpose |
|------|--------|---------|
| Unit | `.test.ts` | Single component isolation |
| Property | `.property.test.ts` | Invariant testing with fast-check |
| Integration | `.integration.test.ts` | Multi-component interaction |
| E2E | `test/e2e/*.test.ts` | Full workflow validation |

## Writing Tests

### Basic Pattern

```typescript
import * as assert from 'assert';
import * as sinon from 'sinon';

suite('ComponentName', () => {
    let sandbox: sinon.SinonSandbox;

    setup(() => { sandbox = sinon.createSandbox(); });
    teardown(() => { sandbox.restore(); });

    suite('methodName()', () => {
        test('should handle expected case', async () => {
            // Arrange
            const input = createTestInput();
            
            // Act
            const result = await component.method(input);
            
            // Assert
            assert.strictEqual(result.status, 'success');
        });
    });
});
```

### Using Test Helpers

The project provides shared utilities in `test/helpers/`:

```typescript
import {
    BundleBuilder,
    createMockInstalledBundle,
    createMockUpdateCheckResult
} from '../helpers/bundleTestHelpers';

import {
    BundleGenerators,
    PropertyTestConfig,
    ErrorCheckers
} from '../helpers/propertyTestHelpers';

import {
    LockfileBuilder,
    createMockLockfile,
    LockfileGenerators
} from '../helpers/lockfileTestHelpers';

import {
    setupReleaseMocks,
    createBundleZip,
    createMockGitHubSource
} from '../helpers/repositoryFixtureHelpers';

// Create test bundles
const bundle = BundleBuilder.github('owner', 'repo').withVersion('1.0.0').build();
const installed = createMockInstalledBundle('bundle-id', '1.0.0');

// Create test lockfiles
const lockfile = new LockfileBuilder()
    .withBundle('bundle-id', { version: '1.0.0', sourceId: 'source-1' })
    .build();
```

### Property-Based Tests

Use fast-check for property-based testing:

```typescript
import * as fc from 'fast-check';
import { PropertyTestConfig, BundleGenerators } from '../helpers/propertyTestHelpers';

test('property: version parsing is consistent', async function() {
    this.timeout(PropertyTestConfig.TIMEOUT);
    
    await fc.assert(
        fc.asyncProperty(BundleGenerators.version(), async (version) => {
            const parsed = parseVersion(version);
            return parsed !== null;
        }),
        { numRuns: PropertyTestConfig.RUNS.STANDARD, ...PropertyTestConfig.FAST_CHECK_OPTIONS }
    );
});
```

### HTTP Mocking

Use nock for HTTP request mocking:

```typescript
import nock from 'nock';

setup(() => {
    nock('https://api.github.com')
        .get('/repos/owner/repo/releases')
        .reply(200, mockReleases);
});

teardown(() => {
    nock.cleanAll();
});
```

## Test Fixtures

Test fixtures are in `test/fixtures/`:

| Directory | Contents |
|-----------|----------|
| `github/` | GitHub API mock responses |
| `gitlab/` | GitLab API mock responses |
| `http/` | HTTP registry mock data |
| `hubs/` | Hub configuration files |
| `local-library/` | Local bundle fixtures |
| `collections-validator/` | Collection validation test cases |
| `apm/` | APM package fixtures |

## Running Tests

### Available Scripts

```bash
npm test                    # Run all tests
npm run test:unit           # Unit tests only
npm run test:integration    # Integration tests (requires VS Code)
npm run test:coverage       # Generate coverage report
npm run test:one -- <path>  # Run single test file
```

### Debugging Tests

```bash
# Run with debug output
LOG_LEVEL=DEBUG npm run test:one -- test/path/to/test.ts

# Capture output for analysis
LOG_LEVEL=ERROR npm test 2>&1 | tee test.log | tail -20
```

## Best Practices

1. **Check helpers first** — Use existing utilities from `test/helpers/` before creating new ones
2. **Mock external boundaries** — Mock HTTP, file system, and VS Code APIs, not internal services
3. **Test behavior, not implementation** — Assert on outcomes, not internal state
4. **Use descriptive names** — Test names should explain what behavior is being verified
5. **Clean up resources** — Always restore stubs and clean mocks in teardown

## Coverage

Run coverage reports:

```bash
npm run test:coverage           # Full coverage
npm run test:coverage:unit      # Unit test coverage only
```

Coverage reports are generated in the `coverage/` directory.

## See Also

- [test/AGENTS.md](../../test/AGENTS.md) — Detailed test writing patterns
- [test/fixtures/README.md](../../test/fixtures/README.md) — Fixture documentation
- [Development Setup](./development-setup.md) — Environment setup

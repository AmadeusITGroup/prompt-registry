# Test Helpers

This directory contains shared test utilities used across the test suite.

## Files

### `propertyTestHelpers.ts`
Shared utilities for property-based tests across adapter test files.

**Exports**:
- `ErrorCheckers` - Error message validation patterns
- `LoggerHelpers` - Logger stub interaction utilities
- `PropertyTestConfig` - Centralized test configuration
- `createMockHttpResponse` - HTTP response mocking
- `stubHttpsWithResponse` - HTTPS module stubbing
- `TestGenerators` - Fast-check data generators
- `HTTP_STATUS_MESSAGES` - Status code to message mapping

**Usage**:
```typescript
import { 
    ErrorCheckers, 
    LoggerHelpers, 
    PropertyTestConfig 
} from '../helpers/propertyTestHelpers';
```

See `PROPERTY_TEST_GUIDE.md` for detailed usage examples.

### `mockData.ts`
Reusable mock data generators for unit tests.

**Exports**:
- Mock RegistrySource
- Mock Bundle
- Mock InstallOptions
- Mock VSCode context
- Mock GitHub API responses

### `bundleTestHelpers.ts`
Shared utilities for creating test bundles with consistent structure.

**Exports**:
- `BundleBuilder` - Fluent API for building test bundles
- `TEST_SOURCE_IDS` - Constants for source identifiers
- `TEST_DEFAULTS` - Default values for bundle properties
- `createGitHubBundle()` - Legacy helper (deprecated)
- `createNonGitHubBundle()` - Legacy helper (deprecated)

**Usage**:
```typescript
import { BundleBuilder, TEST_SOURCE_IDS } from '../helpers/bundleTestHelpers';

// Create a GitHub bundle
const bundle = BundleBuilder.github('owner', 'repo')
    .withVersion('1.0.0')
    .withDescription('Custom description')
    .build();

// Create a non-GitHub bundle
const bundle = BundleBuilder.fromSource('my-bundle', 'GITLAB')
    .withVersion('2.0.0')
    .build();
```

### `PROPERTY_TEST_GUIDE.md`
Comprehensive guide for writing property-based tests using the shared helpers.

**Contents**:
- Quick start guide
- Available utilities reference
- Best practices
- Complete examples
- Extension guide

## Quick Reference

### Error Checking
```typescript
ErrorCheckers.indicatesHtmlDetection(error)
ErrorCheckers.indicatesAuthIssue(error)
ErrorCheckers.isJsonParseError(error)
ErrorCheckers.mentionsParsingIssue(error)
ErrorCheckers.indicatesNetworkIssue(error)
ErrorCheckers.indicatesRateLimit(error)
```

### Logger Management
```typescript
const loggerHelpers = new LoggerHelpers(loggerStub);
loggerHelpers.resetHistory()
loggerHelpers.collectAllCalls()
loggerHelpers.hasLogContaining('text')
loggerHelpers.getErrorMessages()
loggerHelpers.getDebugMessages()
loggerHelpers.hasLogAtLevel('error', 'text')
```

### Test Configuration
```typescript
PropertyTestConfig.TIMEOUT              // 30000ms
PropertyTestConfig.RUNS.QUICK           // 10
PropertyTestConfig.RUNS.STANDARD        // 20
PropertyTestConfig.RUNS.EXTENDED        // 30
PropertyTestConfig.RUNS.COMPREHENSIVE   // 50
PropertyTestConfig.RUNS.THOROUGH        // 100
PropertyTestConfig.FAST_CHECK_OPTIONS   // { verbose: false, endOnFailure: true }
```

### HTTP Mocking
```typescript
createMockHttpResponse(statusCode, body, contentType)
stubHttpsWithResponse(sandbox, statusCode, body, contentType)
```

### Test Generators
```typescript
TestGenerators.githubToken()
TestGenerators.httpUrl()
TestGenerators.githubRepoUrl()
TestGenerators.httpStatusCode('success' | 'client-error' | 'server-error')
TestGenerators.contentType()
```

### Bundle Builder
```typescript
// GitHub bundle with fluent API
BundleBuilder.github('owner', 'repo')
    .withVersion('1.0.0')
    .withDescription('Custom description')
    .withAuthor('author')
    .withTags(['tag1', 'tag2'])
    .build()

// Non-GitHub bundle
BundleBuilder.fromSource('bundle-id', 'GITLAB')
    .withVersion('2.0.0')
    .build()

// Constants
TEST_SOURCE_IDS.GITHUB           // 'github-source'
TEST_SOURCE_IDS.GITLAB           // 'gitlab-source'
TEST_SOURCE_IDS.HTTP             // 'http-source'
TEST_SOURCE_IDS.LOCAL            // 'local-source'
TEST_SOURCE_IDS.AWESOME_COPILOT  // 'awesome-copilot-source'
```

## Adding New Helpers

1. Add to `propertyTestHelpers.ts`
2. Export from the module
3. Document in `PROPERTY_TEST_GUIDE.md`
4. Update this README

## Testing the Helpers

The helpers themselves are tested through their usage in property-based tests. If you modify a helper:

1. Run the test suite: `LOG_LEVEL=ERROR npm run test:unit`
2. Verify all property tests pass
3. Check that error messages are still meaningful

## Related Documentation

- `docs/TESTING_STRATEGY.md` - Overall testing strategy
- `test/adapters/PROPERTY_TEST_IMPROVEMENTS.md` - Improvement history
- `test/adapters/GitHubAdapter.property.test.ts` - Example usage

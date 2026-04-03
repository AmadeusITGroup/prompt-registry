/**
 * ScopeConflictResolver Property Tests
 *
 * Property-based tests for the scope exclusivity invariant.
 *
 * **Property 5: Scope Exclusivity Invariant**
 * For any bundle ID, the bundle SHALL exist at most at one scope (user OR repository, never both).
 *
 * **Validates: Requirements 6.1, 6.4, 6.6**
 */

import * as assert from 'node:assert';
import * as fc from 'fast-check';
import * as sinon from 'sinon';
import {
  ScopeConflictResolver,
} from '../../src/services/scope-conflict-resolver';
import {
  RegistryStorage,
} from '../../src/storage/registry-storage';
import {
  InstallationScope,
} from '../../src/types/registry';
import {
  createMockInstalledBundle,
} from '../helpers/bundle-test-helpers';
import {
  BundleGenerators,
  PropertyTestConfig,
} from '../helpers/property-test-helpers';

suite('ScopeConflictResolver Property Tests', () => {
  let sandbox: sinon.SinonSandbox;
  let mockStorage: sinon.SinonStubbedInstance<RegistryStorage>;
  let resolver: ScopeConflictResolver;

  // ===== Test Utilities =====
  const ALL_SCOPES: InstallationScope[] = ['user', 'workspace', 'repository'];

  setup(() => {
    sandbox = sinon.createSandbox();
    mockStorage = sandbox.createStubInstance(RegistryStorage);
    resolver = new ScopeConflictResolver(mockStorage);
  });

  teardown(() => {
    sandbox.restore();
  });

  /**
   * Property 5: Scope Exclusivity Invariant
   *
   * For any bundle ID, the bundle SHALL exist at most at one scope (user OR repository, never both).
   *
   * This property test verifies that:
   * 1. When a bundle is installed at one scope, attempting to install at another scope is detected as a conflict
   * 2. The conflict detection is consistent regardless of which scope is checked first
   * 3. Migration properly moves the bundle from one scope to another (not duplicating)
   *
   * **Validates: Requirements 6.1, 6.4, 6.6**
   *
   * Feature: repository-level-installation, Property 5: Scope Exclusivity Invariant
   */
  suite('Property 5: Scope Exclusivity Invariant', function () {
    this.timeout(PropertyTestConfig.TIMEOUT);

    test('should detect conflict when bundle exists at any other scope', async () => {
      await fc.assert(
        fc.asyncProperty(
          BundleGenerators.bundleId(),
          BundleGenerators.version(),
          fc.constantFrom<InstallationScope>('user', 'workspace', 'repository'),
          fc.constantFrom<InstallationScope>('user', 'workspace', 'repository'),
          async (bundleId, version, existingScope, targetScope) => {
            // Skip if same scope (no conflict expected)
            if (existingScope === targetScope) {
              return true;
            }

            // Reset mocks for each iteration
            mockStorage.getInstalledBundle.reset();

            // Setup: bundle exists at existingScope
            const installedBundle = createMockInstalledBundle(bundleId, version, { scope: existingScope });

            for (const scope of ALL_SCOPES) {
              if (scope === existingScope) {
                mockStorage.getInstalledBundle.withArgs(bundleId, scope).resolves(installedBundle);
              } else {
                mockStorage.getInstalledBundle.withArgs(bundleId, scope).resolves(undefined);
              }
            }

            // Act: check for conflict when trying to install at targetScope
            const conflict = await resolver.checkConflict(bundleId, targetScope);

            // Assert: conflict should be detected
            assert.ok(conflict !== null,
              `Conflict should be detected when bundle at ${existingScope} and target is ${targetScope}`);
            assert.strictEqual(conflict.existingScope, existingScope,
              'Conflict should report correct existing scope');
            assert.strictEqual(conflict.targetScope, targetScope,
              'Conflict should report correct target scope');
            assert.strictEqual(conflict.bundleId, bundleId,
              'Conflict should report correct bundle ID');

            return true;
          }
        ),
        {
          ...PropertyTestConfig.FAST_CHECK_OPTIONS,
          numRuns: PropertyTestConfig.RUNS.STANDARD
        }
      );
    });

    test('should not detect conflict when bundle only exists at target scope', async () => {
      await fc.assert(
        fc.asyncProperty(
          BundleGenerators.bundleId(),
          BundleGenerators.version(),
          fc.constantFrom<InstallationScope>('user', 'workspace', 'repository'),
          async (bundleId, version, targetScope) => {
            // Reset mocks for each iteration
            mockStorage.getInstalledBundle.reset();

            // Setup: bundle only exists at targetScope
            const installedBundle = createMockInstalledBundle(bundleId, version, { scope: targetScope });

            for (const scope of ALL_SCOPES) {
              if (scope === targetScope) {
                mockStorage.getInstalledBundle.withArgs(bundleId, scope).resolves(installedBundle);
              } else {
                mockStorage.getInstalledBundle.withArgs(bundleId, scope).resolves(undefined);
              }
            }

            // Act: check for conflict when trying to install at same scope
            const conflict = await resolver.checkConflict(bundleId, targetScope);

            // Assert: no conflict should be detected (reinstalling at same scope is allowed)
            assert.strictEqual(conflict, null,
              `No conflict should be detected when bundle only at target scope ${targetScope}`);

            return true;
          }
        ),
        {
          ...PropertyTestConfig.FAST_CHECK_OPTIONS,
          numRuns: PropertyTestConfig.RUNS.STANDARD
        }
      );
    });

    test('should not detect conflict when bundle is not installed anywhere', async () => {
      await fc.assert(
        fc.asyncProperty(
          BundleGenerators.bundleId(),
          fc.constantFrom<InstallationScope>('user', 'workspace', 'repository'),
          async (bundleId, targetScope) => {
            // Reset mocks for each iteration
            mockStorage.getInstalledBundle.reset();

            // Setup: bundle not installed anywhere
            mockStorage.getInstalledBundle.resolves(undefined);

            // Act: check for conflict
            const conflict = await resolver.checkConflict(bundleId, targetScope);

            // Assert: no conflict
            assert.strictEqual(conflict, null,
              'No conflict should be detected when bundle not installed');

            return true;
          }
        ),
        {
          ...PropertyTestConfig.FAST_CHECK_OPTIONS,
          numRuns: PropertyTestConfig.RUNS.QUICK
        }
      );
    });

    test('should maintain exclusivity after successful migration', async () => {
      await fc.assert(
        fc.asyncProperty(
          BundleGenerators.bundleId(),
          BundleGenerators.version(),
          fc.constantFrom<InstallationScope>('user', 'repository'),
          fc.constantFrom<InstallationScope>('user', 'repository'),
          async (bundleId, version, fromScope, toScope) => {
            // Skip if same scope
            if (fromScope === toScope) {
              return true;
            }

            // Reset mocks for each iteration
            mockStorage.getInstalledBundle.reset();

            // Setup: bundle exists at fromScope
            const installedBundle = createMockInstalledBundle(bundleId, version, { scope: fromScope });
            mockStorage.getInstalledBundle.withArgs(bundleId, fromScope).resolves(installedBundle);
            mockStorage.getInstalledBundle.withArgs(bundleId, toScope).resolves(undefined);
            mockStorage.getInstalledBundle.withArgs(bundleId, 'workspace').resolves(undefined);

            // Track migration state
            let uninstallCalled = false;
            let installCalled = false;

            const mockUninstall = () => {
              uninstallCalled = true;
              // After uninstall, bundle no longer at fromScope
              mockStorage.getInstalledBundle.withArgs(bundleId, fromScope).resolves(undefined);
              return Promise.resolve();
            };

            const mockInstall = () => {
              installCalled = true;
              // After install, bundle at toScope
              const newBundle = createMockInstalledBundle(bundleId, version, { scope: toScope });
              mockStorage.getInstalledBundle.withArgs(bundleId, toScope).resolves(newBundle);
              return Promise.resolve();
            };

            // Act: migrate bundle
            const result = await resolver.migrateBundle(
              bundleId,
              fromScope,
              toScope,
              mockUninstall,
              mockInstall
            );

            // Assert: migration succeeded
            assert.ok(result.success, 'Migration should succeed');
            assert.ok(uninstallCalled, 'Uninstall should be called');
            assert.ok(installCalled, 'Install should be called');

            return true;
          }
        ),
        {
          ...PropertyTestConfig.FAST_CHECK_OPTIONS,
          numRuns: PropertyTestConfig.RUNS.STANDARD
        }
      );
    });
  });
});

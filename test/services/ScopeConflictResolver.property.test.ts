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

import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import * as fc from 'fast-check';
import { ScopeConflictResolver } from '../../src/services/ScopeConflictResolver';
import { RegistryStorage } from '../../src/storage/RegistryStorage';
import { InstallationScope, InstalledBundle } from '../../src/types/registry';
import { createMockInstalledBundle } from '../helpers/bundleTestHelpers';
import { PropertyTestConfig, BundleGenerators } from '../helpers/propertyTestHelpers';

suite('ScopeConflictResolver Property Tests', () => {
    let sandbox: sinon.SinonSandbox;
    let mockStorage: sinon.SinonStubbedInstance<RegistryStorage>;
    let resolver: ScopeConflictResolver;

    // ===== Test Utilities =====
    const ALL_SCOPES: InstallationScope[] = ['user', 'workspace', 'repository'];

    const createMockContext = (): vscode.ExtensionContext => {
        const globalStateData = new Map<string, any>();
        return {
            globalState: {
                get: (key: string, defaultValue?: any) => globalStateData.get(key) ?? defaultValue,
                update: async (key: string, value: any) => { globalStateData.set(key, value); },
                keys: () => Array.from(globalStateData.keys()),
                setKeysForSync: sandbox.stub()
            } as any,
            globalStorageUri: vscode.Uri.file(path.join(os.tmpdir(), 'test-storage')),
            subscriptions: [],
            extensionUri: vscode.Uri.file('/mock/extension'),
            extensionPath: '/mock/extension',
            storagePath: '/mock/storage',
            globalStoragePath: path.join(os.tmpdir(), 'test-storage'),
            logPath: '/mock/log',
            extensionMode: 3 as any,
            workspaceState: {
                get: sandbox.stub(),
                update: sandbox.stub(),
                keys: sandbox.stub().returns([])
            } as any,
            secrets: {
                get: sandbox.stub(),
                store: sandbox.stub(),
                delete: sandbox.stub(),
                onDidChange: sandbox.stub()
            } as any,
            environmentVariableCollection: {} as any,
            extension: {} as any,
            asAbsolutePath: (relativePath: string) => path.join('/mock/extension', relativePath),
            storageUri: vscode.Uri.file('/mock/storage'),
            logUri: vscode.Uri.file('/mock/log'),
            languageModelAccessInformation: {} as any
        } as vscode.ExtensionContext;
    };

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
    suite('Property 5: Scope Exclusivity Invariant', function() {
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
                        assert.strictEqual(conflict!.existingScope, existingScope,
                            'Conflict should report correct existing scope');
                        assert.strictEqual(conflict!.targetScope, targetScope,
                            'Conflict should report correct target scope');
                        assert.strictEqual(conflict!.bundleId, bundleId,
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

                        const mockUninstall = async () => {
                            uninstallCalled = true;
                            // After uninstall, bundle no longer at fromScope
                            mockStorage.getInstalledBundle.withArgs(bundleId, fromScope).resolves(undefined);
                        };

                        const mockInstall = async () => {
                            installCalled = true;
                            // After install, bundle at toScope
                            const newBundle = createMockInstalledBundle(bundleId, version, { scope: toScope });
                            mockStorage.getInstalledBundle.withArgs(bundleId, toScope).resolves(newBundle);
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

                        // Verify exclusivity: bundle should only be at toScope now
                        const conflictingScopes = await resolver.getConflictingScopes(bundleId);
                        assert.strictEqual(conflictingScopes.length, 1, 
                            'Bundle should exist at exactly one scope after migration');
                        assert.strictEqual(conflictingScopes[0], toScope,
                            'Bundle should be at target scope after migration');

                        return true;
                    }
                ),
                { 
                    ...PropertyTestConfig.FAST_CHECK_OPTIONS, 
                    numRuns: PropertyTestConfig.RUNS.STANDARD 
                }
            );
        });

        test('should report all conflicting scopes correctly', async () => {
            await fc.assert(
                fc.asyncProperty(
                    BundleGenerators.bundleId(),
                    BundleGenerators.version(),
                    fc.subarray(ALL_SCOPES, { minLength: 0, maxLength: 3 }),
                    async (bundleId, version, installedScopes) => {
                        // Reset mocks for each iteration
                        mockStorage.getInstalledBundle.reset();

                        // Setup: bundle installed at specified scopes
                        for (const scope of ALL_SCOPES) {
                            if (installedScopes.includes(scope)) {
                                const bundle = createMockInstalledBundle(bundleId, version, { scope });
                                mockStorage.getInstalledBundle.withArgs(bundleId, scope).resolves(bundle);
                            } else {
                                mockStorage.getInstalledBundle.withArgs(bundleId, scope).resolves(undefined);
                            }
                        }

                        // Act: get all conflicting scopes
                        const conflictingScopes = await resolver.getConflictingScopes(bundleId);

                        // Assert: should match installed scopes
                        assert.deepStrictEqual(
                            conflictingScopes.sort(),
                            installedScopes.sort(),
                            'Should report all scopes where bundle is installed'
                        );

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

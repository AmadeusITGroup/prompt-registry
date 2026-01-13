/**
 * ScopeConflictResolver Unit Tests
 * 
 * Tests for the service that prevents the same bundle from being installed
 * at both user and repository scopes simultaneously.
 * 
 * Requirements: 6.1-6.6
 */

import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import { ScopeConflictResolver, ScopeConflict, MigrationResult } from '../../src/services/ScopeConflictResolver';
import { RegistryStorage } from '../../src/storage/RegistryStorage';
import { InstallationScope, InstalledBundle } from '../../src/types/registry';
import { createMockInstalledBundle } from '../helpers/bundleTestHelpers';

suite('ScopeConflictResolver', () => {
    let sandbox: sinon.SinonSandbox;
    let mockStorage: sinon.SinonStubbedInstance<RegistryStorage>;
    let mockContext: vscode.ExtensionContext;
    let resolver: ScopeConflictResolver;

    // ===== Test Utilities =====
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
        mockContext = createMockContext();
        mockStorage = sandbox.createStubInstance(RegistryStorage);
        resolver = new ScopeConflictResolver(mockStorage);
    });

    teardown(() => {
        sandbox.restore();
    });

    suite('checkConflict()', () => {
        test('should return null when bundle is not installed anywhere', async () => {
            // Arrange
            const bundleId = 'test-bundle';
            mockStorage.getInstalledBundle.resolves(undefined);

            // Act
            const result = await resolver.checkConflict(bundleId, 'repository');

            // Assert
            assert.strictEqual(result, null, 'Should return null when no conflict exists');
        });

        test('should return null when bundle is only installed at target scope', async () => {
            // Arrange
            const bundleId = 'test-bundle';
            const installedBundle = createMockInstalledBundle(bundleId, '1.0.0', { scope: 'repository' });
            
            mockStorage.getInstalledBundle.withArgs(bundleId, 'user').resolves(undefined);
            mockStorage.getInstalledBundle.withArgs(bundleId, 'workspace').resolves(undefined);
            mockStorage.getInstalledBundle.withArgs(bundleId, 'repository').resolves(installedBundle);

            // Act
            const result = await resolver.checkConflict(bundleId, 'repository');

            // Assert
            assert.strictEqual(result, null, 'Should return null when bundle is only at target scope');
        });

        test('should detect conflict when bundle is at user scope and target is repository', async () => {
            // Arrange
            const bundleId = 'test-bundle';
            const installedBundle = createMockInstalledBundle(bundleId, '1.0.0', { scope: 'user' });
            
            mockStorage.getInstalledBundle.withArgs(bundleId, 'user').resolves(installedBundle);
            mockStorage.getInstalledBundle.withArgs(bundleId, 'workspace').resolves(undefined);
            mockStorage.getInstalledBundle.withArgs(bundleId, 'repository').resolves(undefined);

            // Act
            const result = await resolver.checkConflict(bundleId, 'repository');

            // Assert
            assert.ok(result, 'Should detect conflict');
            assert.strictEqual(result!.bundleId, bundleId);
            assert.strictEqual(result!.existingScope, 'user');
            assert.strictEqual(result!.targetScope, 'repository');
            assert.strictEqual(result!.existingVersion, '1.0.0');
        });

        test('should detect conflict when bundle is at repository scope and target is user', async () => {
            // Arrange
            const bundleId = 'test-bundle';
            const installedBundle = createMockInstalledBundle(bundleId, '2.0.0', { scope: 'repository' });
            
            mockStorage.getInstalledBundle.withArgs(bundleId, 'user').resolves(undefined);
            mockStorage.getInstalledBundle.withArgs(bundleId, 'workspace').resolves(undefined);
            mockStorage.getInstalledBundle.withArgs(bundleId, 'repository').resolves(installedBundle);

            // Act
            const result = await resolver.checkConflict(bundleId, 'user');

            // Assert
            assert.ok(result, 'Should detect conflict');
            assert.strictEqual(result!.bundleId, bundleId);
            assert.strictEqual(result!.existingScope, 'repository');
            assert.strictEqual(result!.targetScope, 'user');
            assert.strictEqual(result!.existingVersion, '2.0.0');
        });

        test('should detect conflict when bundle is at workspace scope and target is repository', async () => {
            // Arrange
            const bundleId = 'test-bundle';
            const installedBundle = createMockInstalledBundle(bundleId, '1.5.0', { scope: 'workspace' });
            
            mockStorage.getInstalledBundle.withArgs(bundleId, 'user').resolves(undefined);
            mockStorage.getInstalledBundle.withArgs(bundleId, 'workspace').resolves(installedBundle);
            mockStorage.getInstalledBundle.withArgs(bundleId, 'repository').resolves(undefined);

            // Act
            const result = await resolver.checkConflict(bundleId, 'repository');

            // Assert
            assert.ok(result, 'Should detect conflict');
            assert.strictEqual(result!.existingScope, 'workspace');
            assert.strictEqual(result!.targetScope, 'repository');
        });

        test('should check all scopes except target scope', async () => {
            // Arrange
            const bundleId = 'test-bundle';
            mockStorage.getInstalledBundle.resolves(undefined);

            // Act
            await resolver.checkConflict(bundleId, 'repository');

            // Assert - should check user and workspace, but not repository
            assert.ok(mockStorage.getInstalledBundle.calledWith(bundleId, 'user'), 'Should check user scope');
            assert.ok(mockStorage.getInstalledBundle.calledWith(bundleId, 'workspace'), 'Should check workspace scope');
        });
    });

    suite('migrateBundle()', () => {
        let mockUninstallCallback: sinon.SinonStub;
        let mockInstallCallback: sinon.SinonStub;

        setup(() => {
            mockUninstallCallback = sandbox.stub();
            mockInstallCallback = sandbox.stub();
        });

        test('should successfully migrate bundle from user to repository scope', async () => {
            // Arrange
            const bundleId = 'test-bundle';
            const fromScope: InstallationScope = 'user';
            const toScope: InstallationScope = 'repository';
            const installedBundle = createMockInstalledBundle(bundleId, '1.0.0', { scope: fromScope });
            
            mockStorage.getInstalledBundle.withArgs(bundleId, fromScope).resolves(installedBundle);
            mockUninstallCallback.resolves();
            mockInstallCallback.resolves();

            // Act
            const result = await resolver.migrateBundle(
                bundleId,
                fromScope,
                toScope,
                mockUninstallCallback,
                mockInstallCallback
            );

            // Assert
            assert.ok(result.success, 'Migration should succeed');
            assert.strictEqual(result.bundleId, bundleId);
            assert.strictEqual(result.fromScope, fromScope);
            assert.strictEqual(result.toScope, toScope);
            assert.ok(mockUninstallCallback.calledOnce, 'Uninstall should be called once');
            assert.ok(mockInstallCallback.calledOnce, 'Install should be called once');
            assert.ok(mockUninstallCallback.calledBefore(mockInstallCallback), 'Uninstall should be called before install');
        });

        test('should successfully migrate bundle from repository to user scope', async () => {
            // Arrange
            const bundleId = 'test-bundle';
            const fromScope: InstallationScope = 'repository';
            const toScope: InstallationScope = 'user';
            const installedBundle = createMockInstalledBundle(bundleId, '2.0.0', { scope: fromScope });
            
            mockStorage.getInstalledBundle.withArgs(bundleId, fromScope).resolves(installedBundle);
            mockUninstallCallback.resolves();
            mockInstallCallback.resolves();

            // Act
            const result = await resolver.migrateBundle(
                bundleId,
                fromScope,
                toScope,
                mockUninstallCallback,
                mockInstallCallback
            );

            // Assert
            assert.ok(result.success, 'Migration should succeed');
            assert.strictEqual(result.fromScope, fromScope);
            assert.strictEqual(result.toScope, toScope);
        });

        test('should fail migration when bundle is not installed at source scope', async () => {
            // Arrange
            const bundleId = 'test-bundle';
            mockStorage.getInstalledBundle.resolves(undefined);

            // Act
            const result = await resolver.migrateBundle(
                bundleId,
                'user',
                'repository',
                mockUninstallCallback,
                mockInstallCallback
            );

            // Assert
            assert.strictEqual(result.success, false, 'Migration should fail');
            assert.ok(result.error, 'Should have error message');
            assert.ok(result.error!.includes('not installed'), 'Error should mention bundle not installed');
            assert.ok(!mockUninstallCallback.called, 'Uninstall should not be called');
            assert.ok(!mockInstallCallback.called, 'Install should not be called');
        });

        test('should fail migration when uninstall fails', async () => {
            // Arrange
            const bundleId = 'test-bundle';
            const installedBundle = createMockInstalledBundle(bundleId, '1.0.0', { scope: 'user' });
            
            mockStorage.getInstalledBundle.withArgs(bundleId, 'user').resolves(installedBundle);
            mockUninstallCallback.rejects(new Error('Uninstall failed'));

            // Act
            const result = await resolver.migrateBundle(
                bundleId,
                'user',
                'repository',
                mockUninstallCallback,
                mockInstallCallback
            );

            // Assert
            assert.strictEqual(result.success, false, 'Migration should fail');
            assert.ok(result.error, 'Should have error message');
            assert.ok(result.error!.includes('Uninstall failed'), 'Error should contain original error');
            assert.ok(!mockInstallCallback.called, 'Install should not be called after uninstall failure');
        });

        test('should fail migration when install fails', async () => {
            // Arrange
            const bundleId = 'test-bundle';
            const installedBundle = createMockInstalledBundle(bundleId, '1.0.0', { scope: 'user' });
            
            mockStorage.getInstalledBundle.withArgs(bundleId, 'user').resolves(installedBundle);
            mockUninstallCallback.resolves();
            mockInstallCallback.rejects(new Error('Install failed'));

            // Act
            const result = await resolver.migrateBundle(
                bundleId,
                'user',
                'repository',
                mockUninstallCallback,
                mockInstallCallback
            );

            // Assert
            assert.strictEqual(result.success, false, 'Migration should fail');
            assert.ok(result.error, 'Should have error message');
            assert.ok(result.error!.includes('Install failed'), 'Error should contain original error');
        });

        test('should pass installed bundle info to callbacks', async () => {
            // Arrange
            const bundleId = 'test-bundle';
            const installedBundle = createMockInstalledBundle(bundleId, '1.0.0', { 
                scope: 'user',
                sourceId: 'github-source'
            });
            
            mockStorage.getInstalledBundle.withArgs(bundleId, 'user').resolves(installedBundle);
            mockUninstallCallback.resolves();
            mockInstallCallback.resolves();

            // Act
            await resolver.migrateBundle(
                bundleId,
                'user',
                'repository',
                mockUninstallCallback,
                mockInstallCallback
            );

            // Assert
            assert.ok(mockUninstallCallback.calledWith(installedBundle), 'Uninstall should receive installed bundle');
            assert.ok(mockInstallCallback.calledWith(installedBundle, 'repository'), 'Install should receive bundle and target scope');
        });

        suite('rollback behavior', () => {
            test('should attempt rollback when install fails after successful uninstall', async () => {
                // Arrange
                const bundleId = 'test-bundle';
                const fromScope: InstallationScope = 'user';
                const toScope: InstallationScope = 'repository';
                const installedBundle = createMockInstalledBundle(bundleId, '1.0.0', { scope: fromScope });
                
                mockStorage.getInstalledBundle.withArgs(bundleId, fromScope).resolves(installedBundle);
                mockUninstallCallback.resolves();
                // First call (install at target) fails, second call (rollback) succeeds
                mockInstallCallback.onFirstCall().rejects(new Error('Install failed'));
                mockInstallCallback.onSecondCall().resolves();

                // Act
                const result = await resolver.migrateBundle(
                    bundleId,
                    fromScope,
                    toScope,
                    mockUninstallCallback,
                    mockInstallCallback
                );

                // Assert
                assert.strictEqual(result.success, false, 'Migration should fail');
                assert.strictEqual(result.rollbackAttempted, true, 'Rollback should be attempted');
                assert.strictEqual(result.rollbackSucceeded, true, 'Rollback should succeed');
                assert.ok(result.error!.includes('Rollback successful'), 'Error should indicate rollback success');
                assert.ok(result.error!.includes('restored at user'), 'Error should mention original scope');
                assert.strictEqual(mockInstallCallback.callCount, 2, 'Install should be called twice (target + rollback)');
            });

            test('should report rollback failure when both install and rollback fail', async () => {
                // Arrange
                const bundleId = 'test-bundle';
                const fromScope: InstallationScope = 'user';
                const toScope: InstallationScope = 'repository';
                const installedBundle = createMockInstalledBundle(bundleId, '1.0.0', { scope: fromScope });
                
                mockStorage.getInstalledBundle.withArgs(bundleId, fromScope).resolves(installedBundle);
                mockUninstallCallback.resolves();
                // Both install attempts fail
                mockInstallCallback.onFirstCall().rejects(new Error('Install failed'));
                mockInstallCallback.onSecondCall().rejects(new Error('Rollback install failed'));

                // Act
                const result = await resolver.migrateBundle(
                    bundleId,
                    fromScope,
                    toScope,
                    mockUninstallCallback,
                    mockInstallCallback
                );

                // Assert
                assert.strictEqual(result.success, false, 'Migration should fail');
                assert.strictEqual(result.rollbackAttempted, true, 'Rollback should be attempted');
                assert.strictEqual(result.rollbackSucceeded, false, 'Rollback should fail');
                assert.ok(result.error!.includes('Rollback also failed'), 'Error should indicate rollback failure');
                assert.ok(result.error!.includes('inconsistent state'), 'Error should warn about inconsistent state');
                assert.strictEqual(mockInstallCallback.callCount, 2, 'Install should be called twice');
            });

            test('should call rollback with original scope', async () => {
                // Arrange
                const bundleId = 'test-bundle';
                const fromScope: InstallationScope = 'repository';
                const toScope: InstallationScope = 'user';
                const installedBundle = createMockInstalledBundle(bundleId, '1.0.0', { scope: fromScope });
                
                mockStorage.getInstalledBundle.withArgs(bundleId, fromScope).resolves(installedBundle);
                mockUninstallCallback.resolves();
                mockInstallCallback.onFirstCall().rejects(new Error('Install failed'));
                mockInstallCallback.onSecondCall().resolves();

                // Act
                await resolver.migrateBundle(
                    bundleId,
                    fromScope,
                    toScope,
                    mockUninstallCallback,
                    mockInstallCallback
                );

                // Assert - verify rollback was called with original scope
                const secondCall = mockInstallCallback.getCall(1);
                assert.ok(secondCall, 'Second install call should exist');
                assert.strictEqual(secondCall.args[1], fromScope, 'Rollback should use original scope');
            });

            test('should preserve original bundle state on successful rollback', async () => {
                // Arrange
                const bundleId = 'test-bundle';
                const fromScope: InstallationScope = 'user';
                const toScope: InstallationScope = 'repository';
                const installedBundle = createMockInstalledBundle(bundleId, '1.0.0', { 
                    scope: fromScope,
                    sourceId: 'github-source'
                });
                
                mockStorage.getInstalledBundle.withArgs(bundleId, fromScope).resolves(installedBundle);
                mockUninstallCallback.resolves();
                mockInstallCallback.onFirstCall().rejects(new Error('Install failed'));
                mockInstallCallback.onSecondCall().resolves();

                // Act
                await resolver.migrateBundle(
                    bundleId,
                    fromScope,
                    toScope,
                    mockUninstallCallback,
                    mockInstallCallback
                );

                // Assert - verify rollback was called with the same bundle info
                const rollbackCall = mockInstallCallback.getCall(1);
                assert.deepStrictEqual(rollbackCall.args[0], installedBundle, 'Rollback should use original bundle info');
            });

            test('should not attempt rollback when uninstall fails', async () => {
                // Arrange
                const bundleId = 'test-bundle';
                const installedBundle = createMockInstalledBundle(bundleId, '1.0.0', { scope: 'user' });
                
                mockStorage.getInstalledBundle.withArgs(bundleId, 'user').resolves(installedBundle);
                mockUninstallCallback.rejects(new Error('Uninstall failed'));

                // Act
                const result = await resolver.migrateBundle(
                    bundleId,
                    'user',
                    'repository',
                    mockUninstallCallback,
                    mockInstallCallback
                );

                // Assert
                assert.strictEqual(result.success, false, 'Migration should fail');
                assert.strictEqual(result.rollbackAttempted, undefined, 'Rollback should not be attempted');
                assert.strictEqual(result.rollbackSucceeded, undefined, 'Rollback succeeded should not be set');
                assert.ok(!mockInstallCallback.called, 'Install should not be called');
            });

            test('should not set rollback fields on successful migration', async () => {
                // Arrange
                const bundleId = 'test-bundle';
                const installedBundle = createMockInstalledBundle(bundleId, '1.0.0', { scope: 'user' });
                
                mockStorage.getInstalledBundle.withArgs(bundleId, 'user').resolves(installedBundle);
                mockUninstallCallback.resolves();
                mockInstallCallback.resolves();

                // Act
                const result = await resolver.migrateBundle(
                    bundleId,
                    'user',
                    'repository',
                    mockUninstallCallback,
                    mockInstallCallback
                );

                // Assert
                assert.strictEqual(result.success, true, 'Migration should succeed');
                assert.strictEqual(result.rollbackAttempted, undefined, 'Rollback attempted should not be set');
                assert.strictEqual(result.rollbackSucceeded, undefined, 'Rollback succeeded should not be set');
            });
        });
    });

    suite('hasConflict()', () => {
        test('should return true when conflict exists', async () => {
            // Arrange
            const bundleId = 'test-bundle';
            const installedBundle = createMockInstalledBundle(bundleId, '1.0.0', { scope: 'user' });
            mockStorage.getInstalledBundle.withArgs(bundleId, 'user').resolves(installedBundle);
            mockStorage.getInstalledBundle.withArgs(bundleId, 'workspace').resolves(undefined);
            mockStorage.getInstalledBundle.withArgs(bundleId, 'repository').resolves(undefined);

            // Act
            const result = await resolver.hasConflict(bundleId, 'repository');

            // Assert
            assert.strictEqual(result, true, 'Should return true when conflict exists');
        });

        test('should return false when no conflict exists', async () => {
            // Arrange
            const bundleId = 'test-bundle';
            mockStorage.getInstalledBundle.resolves(undefined);

            // Act
            const result = await resolver.hasConflict(bundleId, 'repository');

            // Assert
            assert.strictEqual(result, false, 'Should return false when no conflict');
        });
    });

    suite('getConflictingScopes()', () => {
        test('should return all scopes where bundle is installed', async () => {
            // Arrange
            const bundleId = 'test-bundle';
            const userBundle = createMockInstalledBundle(bundleId, '1.0.0', { scope: 'user' });
            const workspaceBundle = createMockInstalledBundle(bundleId, '1.0.0', { scope: 'workspace' });
            
            mockStorage.getInstalledBundle.withArgs(bundleId, 'user').resolves(userBundle);
            mockStorage.getInstalledBundle.withArgs(bundleId, 'workspace').resolves(workspaceBundle);
            mockStorage.getInstalledBundle.withArgs(bundleId, 'repository').resolves(undefined);

            // Act
            const result = await resolver.getConflictingScopes(bundleId);

            // Assert
            assert.deepStrictEqual(result.sort(), ['user', 'workspace'].sort(), 'Should return all installed scopes');
        });

        test('should return empty array when bundle is not installed anywhere', async () => {
            // Arrange
            const bundleId = 'test-bundle';
            mockStorage.getInstalledBundle.resolves(undefined);

            // Act
            const result = await resolver.getConflictingScopes(bundleId);

            // Assert
            assert.deepStrictEqual(result, [], 'Should return empty array');
        });

        test('should return single scope when bundle is installed at one scope', async () => {
            // Arrange
            const bundleId = 'test-bundle';
            const repoBundle = createMockInstalledBundle(bundleId, '1.0.0', { scope: 'repository' });
            
            mockStorage.getInstalledBundle.withArgs(bundleId, 'user').resolves(undefined);
            mockStorage.getInstalledBundle.withArgs(bundleId, 'workspace').resolves(undefined);
            mockStorage.getInstalledBundle.withArgs(bundleId, 'repository').resolves(repoBundle);

            // Act
            const result = await resolver.getConflictingScopes(bundleId);

            // Assert
            assert.deepStrictEqual(result, ['repository'], 'Should return single scope');
        });
    });

    suite('Edge cases', () => {
        test('should handle empty bundle ID gracefully', async () => {
            // Arrange
            mockStorage.getInstalledBundle.resolves(undefined);

            // Act
            const result = await resolver.checkConflict('', 'repository');

            // Assert
            assert.strictEqual(result, null, 'Should return null for empty bundle ID');
        });

        test('should handle storage errors gracefully in checkConflict', async () => {
            // Arrange
            mockStorage.getInstalledBundle.rejects(new Error('Storage error'));

            // Act & Assert
            await assert.rejects(
                () => resolver.checkConflict('test-bundle', 'repository'),
                /Storage error/,
                'Should propagate storage errors'
            );
        });
    });
});

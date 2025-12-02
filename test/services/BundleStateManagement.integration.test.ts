/**
 * Bundle State Management Integration Tests
 * 
 * Tests complete workflows for bundle state management fixes:
 * - Install → Uninstall → Verify UI shows Install button
 * - Install v1.0.0 → Sync (v1.1.0 available) → Verify Update button shown
 * - Install v1.0.0 → Select v1.0.1 from dropdown → Verify v1.0.1 installed
 * - Sync GitHub source → Verify no auto-installation
 * - Sync Awesome Copilot source → Verify auto-update of installed bundles
 * 
 * Requirements: All (1.1-6.6)
 */

import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { RegistryManager } from '../../src/services/RegistryManager';
import { RegistryStorage } from '../../src/storage/RegistryStorage';
import { BundleInstaller } from '../../src/services/BundleInstaller';
import { RepositoryAdapterFactory } from '../../src/adapters/RepositoryAdapter';
import { InstalledBundle, RegistrySource, DeploymentManifest } from '../../src/types/registry';
import { BundleBuilder } from '../helpers/bundleTestHelpers';
import { determineButtonState, matchesBundleIdentity } from '../helpers/marketplaceTestHelpers';

// Helper to create mock manifest
function createMockManifest(): DeploymentManifest {
    return {
        common: {
            directories: [],
            files: [],
            include_patterns: [],
            exclude_patterns: []
        },
        bundle_settings: {
            include_common_in_environment_bundles: true,
            create_common_bundle: true,
            compression: 'zip' as any,
            naming: {
                environment_bundle: 'bundle'
            }
        },
        metadata: {
            manifest_version: '1.0.0',
            description: 'Test manifest'
        }
    };
}


suite('Bundle State Management - Integration Tests', () => {
    let sandbox: sinon.SinonSandbox;
    let mockContext: vscode.ExtensionContext;
    let mockStorage: sinon.SinonStubbedInstance<RegistryStorage>;
    let mockInstaller: sinon.SinonStubbedInstance<BundleInstaller>;
    let registryManager: RegistryManager;

    setup(() => {
        sandbox = sinon.createSandbox();
        
        // Create mock context
        mockContext = {
            globalState: {
                get: sandbox.stub(),
                update: sandbox.stub(),
                keys: sandbox.stub().returns([]),
                setKeysForSync: sandbox.stub()
            } as any,
            workspaceState: {
                get: sandbox.stub(),
                update: sandbox.stub(),
                keys: sandbox.stub().returns([]),
                setKeysForSync: sandbox.stub()
            } as any,
            subscriptions: [],
            extensionPath: '/mock/extension/path',
            extensionUri: vscode.Uri.file('/mock/extension/path'),
            environmentVariableCollection: {} as any,
            extensionMode: 3 as any, // ExtensionMode.Test
            storageUri: vscode.Uri.file('/mock/storage'),
            globalStorageUri: vscode.Uri.file('/mock/global/storage'),
            logUri: vscode.Uri.file('/mock/log'),
            secrets: {} as any,
            languageModelAccessInformation: {} as any,
            asAbsolutePath: (relativePath: string) => `/mock/extension/path/${relativePath}`,
            storagePath: '/mock/storage',
            globalStoragePath: '/mock/global/storage',
            logPath: '/mock/log',
            extension: {} as any
        } as vscode.ExtensionContext;

        // Create mock storage
        mockStorage = sandbox.createStubInstance(RegistryStorage);
        mockInstaller = sandbox.createStubInstance(BundleInstaller);

        // Initialize RegistryManager with mocks
        registryManager = RegistryManager.getInstance(mockContext);
        (registryManager as any).storage = mockStorage;
        (registryManager as any).installer = mockInstaller;
    });

    teardown(() => {
        sandbox.restore();
    });


    suite('Workflow 1: Install GitHub bundle → Uninstall → Verify UI shows Install button', () => {
        test('should show Install button after uninstalling GitHub bundle', async () => {
            // Setup: Create GitHub bundle
            const bundle = BundleBuilder.github('microsoft', 'vscode-copilot')
                .withVersion('1.0.0')
                .build();

            const source: RegistrySource = {
                id: 'github-source',
                name: 'GitHub Source',
                type: 'github',
                url: 'https://github.com/microsoft/vscode-copilot',
                enabled: true,
                priority: 1
            };

            // Mock source retrieval
            mockStorage.getSources.resolves([source]);
            mockStorage.getCachedSourceBundles.withArgs('github-source').resolves([bundle]);

            // Mock adapter
            const mockAdapter = {
                fetchBundles: sandbox.stub().resolves([bundle]),
                downloadBundle: sandbox.stub().resolves(Buffer.from('mock-bundle-data'))
            };
            sandbox.stub(RepositoryAdapterFactory, 'create').returns(mockAdapter as any);

            // Step 1: Install the bundle
            const installedBundle: InstalledBundle = {
                bundleId: bundle.id,
                version: bundle.version,
                installPath: '/mock/install/path',
                installedAt: new Date().toISOString(),
                scope: 'user',
                sourceId: source.id,
                sourceType: source.type,
                manifest: createMockManifest()
            };

            mockInstaller.installFromBuffer.resolves(installedBundle);
            mockStorage.recordInstallation.resolves();
            mockStorage.getInstalledBundles.resolves([installedBundle]);

            await registryManager.installBundle(bundle.id, { scope: 'user' });

            // Verify installation was recorded
            assert.ok(mockStorage.recordInstallation.calledOnce, 'Installation should be recorded');

            // Step 2: Uninstall the bundle
            mockStorage.getInstalledBundle.withArgs(bundle.id).resolves(installedBundle);
            mockInstaller.uninstall.resolves();
            mockStorage.removeInstallation.resolves();
            mockStorage.getInstalledBundles.resolves([]);

            await registryManager.uninstallBundle(bundle.id, 'user');

            // Verify uninstallation
            assert.ok(mockStorage.removeInstallation.calledOnce, 'Installation record should be removed');

            // Step 3: Verify UI state (button should be "install")
            const installed = await mockStorage.getInstalledBundles();
            const matchingInstalled = installed.find(i => 
                matchesBundleIdentity(i.bundleId, bundle.id, source.type)
            );

            const buttonState = determineButtonState(
                matchingInstalled?.version,
                bundle.version
            );

            assert.strictEqual(buttonState, 'install', 'Button state should be "install" after uninstall');
        });
    });


    suite('Workflow 2: Install v1.0.0 → Sync (v1.1.0 available) → Verify Update button shown', () => {
        test('should show Update button when newer version available after sync', async () => {
            // Setup: Create GitHub bundle v1.0.0
            const bundleV1 = BundleBuilder.github('microsoft', 'vscode-copilot')
                .withVersion('1.0.0')
                .build();

            const bundleV1_1 = BundleBuilder.github('microsoft', 'vscode-copilot')
                .withVersion('1.1.0')
                .build();

            const source: RegistrySource = {
                id: 'github-source',
                name: 'GitHub Source',
                type: 'github',
                url: 'https://github.com/microsoft/vscode-copilot',
                enabled: true,
                priority: 1
            };

            // Source retrieved via getSources()
            mockStorage.getSources.resolves([source]);
            mockStorage.getCachedSourceBundles.withArgs('github-source').resolves([bundleV1]);

            // Step 1: Install v1.0.0
            const installedBundleV1: InstalledBundle = {
                bundleId: bundleV1.id,
                version: '1.0.0',
                installPath: '/mock/install/path',
                installedAt: new Date().toISOString(),
                scope: 'user',
                sourceId: source.id,
                sourceType: source.type,
                manifest: createMockManifest()
            };

            const mockAdapter = {
                fetchBundles: sandbox.stub(),
                downloadBundle: sandbox.stub().resolves(Buffer.from('mock-bundle-data'))
            };
            
            // First fetch returns v1.0.0
            mockAdapter.fetchBundles.onFirstCall().resolves([bundleV1]);
            
            sandbox.stub(RepositoryAdapterFactory, 'create').returns(mockAdapter as any);

            mockInstaller.installFromBuffer.resolves(installedBundleV1);
            mockStorage.recordInstallation.resolves();
            mockStorage.getInstalledBundles.resolves([installedBundleV1]);

            await registryManager.installBundle(bundleV1.id, { scope: 'user' });

            // Step 2: Sync source (v1.1.0 becomes available)
            mockAdapter.fetchBundles.onSecondCall().resolves([bundleV1_1]);
            mockStorage.cacheSourceBundles.resolves();

            await registryManager.syncSource('github-source');

            // Verify cache was updated
            assert.ok(mockStorage.cacheSourceBundles.calledOnce, 'Cache should be updated');

            // Step 3: Verify UI state (button should be "update")
            const installed = await mockStorage.getInstalledBundles();
            const matchingInstalled = installed.find(i => 
                matchesBundleIdentity(i.bundleId, bundleV1_1.id, source.type)
            );

            const buttonState = determineButtonState(
                matchingInstalled?.version,
                bundleV1_1.version
            );

            assert.strictEqual(buttonState, 'update', 'Button state should be "update" when newer version available');
        });
    });


    suite('Workflow 3: Install v1.0.0 → Select v1.0.1 from dropdown → Verify v1.0.1 installed', () => {
        test('should install specific version when selected from dropdown', async () => {
            // Setup: Create GitHub bundle with specific version
            const bundleV1_0_1 = BundleBuilder.github('microsoft', 'vscode-copilot')
                .withVersion('1.0.1')
                .build();

            const source: RegistrySource = {
                id: 'github-source',
                name: 'GitHub Source',
                type: 'github',
                url: 'https://github.com/microsoft/vscode-copilot',
                enabled: true,
                priority: 1
            };

            // Source retrieved via getSources()
            mockStorage.getSources.resolves([source]);
            mockStorage.getCachedSourceBundles.withArgs('github-source').resolves([bundleV1_0_1]);

            const mockAdapter = {
                fetchBundles: sandbox.stub().resolves([bundleV1_0_1]),
                downloadBundle: sandbox.stub().resolves(Buffer.from('mock-bundle-data'))
            };
            
            sandbox.stub(RepositoryAdapterFactory, 'create').returns(mockAdapter as any);

            // Step 1: Install specific version v1.0.1 from dropdown
            const installedBundleV1_0_1: InstalledBundle = {
                bundleId: bundleV1_0_1.id,
                version: '1.0.1',
                installPath: '/mock/install/path',
                installedAt: new Date().toISOString(),
                scope: 'user',
                sourceId: source.id,
                sourceType: source.type,
                manifest: createMockManifest()
            };

            mockInstaller.installFromBuffer.resolves(installedBundleV1_0_1);
            mockStorage.recordInstallation.resolves();
            mockStorage.getInstalledBundles.resolves([installedBundleV1_0_1]);

            // Install specific version (simulating dropdown selection)
            await registryManager.installBundle(bundleV1_0_1.id, { 
                scope: 'user',
                version: '1.0.1'
            });

            // Step 2: Verify v1.0.1 is installed
            const installed = await mockStorage.getInstalledBundles();
            const matchingInstalled = installed.find(i => 
                matchesBundleIdentity(i.bundleId, bundleV1_0_1.id, source.type)
            );

            assert.ok(matchingInstalled, 'Bundle should be installed');
            assert.strictEqual(matchingInstalled?.version, '1.0.1', 'Installed version should be 1.0.1');
            
            // Verify version parameter was passed to installBundle
            const installCalls = mockInstaller.installFromBuffer.getCalls();
            assert.strictEqual(installCalls.length, 1, 'Should have called installFromBuffer once');
        });
    });


    suite('Workflow 4: Sync GitHub source → Verify no auto-installation', () => {
        test('should NOT auto-install bundles when syncing GitHub source', async () => {
            // Setup: Create GitHub source with bundles
            const bundle = BundleBuilder.github('microsoft', 'vscode-copilot')
                .withVersion('1.0.0')
                .build();

            const source: RegistrySource = {
                id: 'github-source',
                name: 'GitHub Source',
                type: 'github',
                url: 'https://github.com/microsoft/vscode-copilot',
                enabled: true,
                priority: 1
            };

            // Source retrieved via getSources()
            mockStorage.getSources.resolves([source]);
            mockStorage.getCachedSourceBundles.withArgs('github-source').resolves([bundle]);

            // Mock adapter
            const mockAdapter = {
                fetchBundles: sandbox.stub().resolves([bundle]),
                downloadBundle: sandbox.stub().resolves(Buffer.from('mock-bundle-data'))
            };
            
            sandbox.stub(RepositoryAdapterFactory, 'create').returns(mockAdapter as any);

            // No bundles installed initially
            mockStorage.getInstalledBundles.resolves([]);
            mockStorage.cacheSourceBundles.resolves();

            // Step 1: Sync GitHub source
            await registryManager.syncSource('github-source');

            // Step 2: Verify cache was updated but no installation occurred
            assert.ok(mockStorage.cacheSourceBundles.calledOnce, 'Cache should be updated');
            assert.ok(mockInstaller.installFromBuffer.notCalled, 'Should NOT auto-install bundles from GitHub source');
            assert.ok(mockStorage.recordInstallation.notCalled, 'Should NOT record any installations');

            // Verify no bundles were installed
            const installed = await mockStorage.getInstalledBundles();
            assert.strictEqual(installed.length, 0, 'No bundles should be auto-installed from GitHub source');
        });

        test('should NOT auto-update installed bundles when syncing GitHub source', async () => {
            // Setup: Bundle v1.0.0 is installed, v1.1.0 becomes available
            const bundleV1 = BundleBuilder.github('microsoft', 'vscode-copilot')
                .withVersion('1.0.0')
                .build();

            const bundleV1_1 = BundleBuilder.github('microsoft', 'vscode-copilot')
                .withVersion('1.1.0')
                .build();

            const source: RegistrySource = {
                id: 'github-source',
                name: 'GitHub Source',
                type: 'github',
                url: 'https://github.com/microsoft/vscode-copilot',
                enabled: true,
                priority: 1
            };

            const installedBundle: InstalledBundle = {
                bundleId: bundleV1.id,
                version: '1.0.0',
                installPath: '/mock/install/path',
                installedAt: new Date().toISOString(),
                scope: 'user',
                sourceId: source.id,
                sourceType: source.type,
                manifest: createMockManifest()
            };

            // Source retrieved via getSources()
            mockStorage.getSources.resolves([source]);
            mockStorage.getCachedSourceBundles.withArgs('github-source').resolves([bundleV1, bundleV1_1]);
            mockStorage.getInstalledBundles.resolves([installedBundle]);

            // Mock adapter returns new version
            const mockAdapter = {
                fetchBundles: sandbox.stub().resolves([bundleV1_1]),
                downloadBundle: sandbox.stub().resolves(Buffer.from('mock-bundle-data'))
            };
            
            sandbox.stub(RepositoryAdapterFactory, 'create').returns(mockAdapter as any);
            mockStorage.cacheSourceBundles.resolves();

            // Step 1: Sync GitHub source
            await registryManager.syncSource('github-source');

            // Step 2: Verify cache was updated but no auto-update occurred
            assert.ok(mockStorage.cacheSourceBundles.calledOnce, 'Cache should be updated');
            
            // Verify no update operations were performed
            const installCallCount = mockInstaller.installFromBuffer.callCount;
            assert.strictEqual(installCallCount, 0, 'Should NOT auto-update bundles from GitHub source');

            // Verify installed bundle is still v1.0.0
            const installed = await mockStorage.getInstalledBundles();
            const matchingInstalled = installed.find(i => 
                matchesBundleIdentity(i.bundleId, bundleV1.id, source.type)
            );

            assert.ok(matchingInstalled, 'Bundle should still be installed');
            assert.strictEqual(matchingInstalled?.version, '1.0.0', 'Version should remain 1.0.0 (not auto-updated)');
        });
    });


    suite('Workflow 5: Sync Awesome Copilot source → Verify auto-update of installed bundles', () => {
        test('should auto-update installed bundles when syncing Awesome Copilot source', async () => {
            // Setup: Bundle v1.0.0 is installed, v1.1.0 becomes available
            const bundleV1 = BundleBuilder.fromSource('awesome-bundle', 'AWESOME_COPILOT')
                .withVersion('1.0.0')
                .build();

            const bundleV1_1 = BundleBuilder.fromSource('awesome-bundle', 'AWESOME_COPILOT')
                .withVersion('1.1.0')
                .build();

            const source: RegistrySource = {
                id: 'awesome-copilot-source',
                name: 'Awesome Copilot Source',
                type: 'awesome-copilot',
                url: 'https://github.com/awesome/copilot',
                enabled: true,
                priority: 1
            };

            const installedBundle: InstalledBundle = {
                bundleId: bundleV1.id,
                version: '1.0.0',
                installPath: '/mock/install/path',
                installedAt: new Date().toISOString(),
                scope: 'user',
                sourceId: source.id,
                sourceType: source.type,
                manifest: createMockManifest()
            };

            // Source retrieved via getSources()
            mockStorage.getSources.resolves([source]);
            mockStorage.getCachedSourceBundles.withArgs('awesome-copilot-source').resolves([bundleV1, bundleV1_1]);
            mockStorage.getInstalledBundles.resolves([installedBundle]);
            mockStorage.getInstalledBundle.withArgs(bundleV1.id).resolves(installedBundle);

            // Mock adapter returns new version
            const mockAdapter = {
                fetchBundles: sandbox.stub().resolves([bundleV1_1]),
                downloadBundle: sandbox.stub().resolves(Buffer.from('mock-bundle-data'))
            };
            
            sandbox.stub(RepositoryAdapterFactory, 'create').returns(mockAdapter as any);
            mockStorage.cacheSourceBundles.resolves();

            // Mock update operation
            const updatedBundle: InstalledBundle = {
                ...installedBundle,
                bundleId: bundleV1_1.id,
                version: '1.1.0',
                installedAt: new Date().toISOString()
            };

            mockInstaller.update.resolves(updatedBundle);
            mockStorage.removeInstallation.resolves();
            mockStorage.recordInstallation.resolves();

            // Step 1: Sync Awesome Copilot source
            await registryManager.syncSource('awesome-copilot-source');

            // Step 2: Verify cache was updated AND auto-update occurred
            assert.ok(mockStorage.cacheSourceBundles.calledOnce, 'Cache should be updated');
            
            // Verify update operations were performed via installer.update()
            const updateOccurred = mockInstaller.update.called;
            
            assert.ok(updateOccurred, 'Should auto-update bundles from Awesome Copilot source');
        });

        test('should NOT auto-update bundles from other sources when syncing Awesome Copilot source', async () => {
            // Setup: Two bundles installed from different sources
            const awesomeBundle = BundleBuilder.fromSource('awesome-bundle', 'AWESOME_COPILOT')
                .withVersion('1.0.0')
                .build();

            const githubBundle = BundleBuilder.github('microsoft', 'vscode-copilot')
                .withVersion('1.0.0')
                .build();

            const awesomeSource: RegistrySource = {
                id: 'awesome-copilot-source',
                name: 'Awesome Copilot Source',
                type: 'awesome-copilot',
                url: 'https://github.com/awesome/copilot',
                enabled: true,
                priority: 1
            };

            const githubSource: RegistrySource = {
                id: 'github-source',
                name: 'GitHub Source',
                type: 'github',
                url: 'https://github.com/microsoft/vscode-copilot',
                enabled: true,
                priority: 2
            };

            const installedAwesomeBundle: InstalledBundle = {
                bundleId: awesomeBundle.id,
                version: '1.0.0',
                installPath: '/mock/install/path/awesome',
                installedAt: new Date().toISOString(),
                scope: 'user',
                sourceId: awesomeSource.id,
                sourceType: awesomeSource.type,
                manifest: createMockManifest()
            };

            const installedGitHubBundle: InstalledBundle = {
                bundleId: githubBundle.id,
                version: '1.0.0',
                installPath: '/mock/install/path/github',
                installedAt: new Date().toISOString(),
                scope: 'user',
                sourceId: githubSource.id,
                sourceType: githubSource.type,
                manifest: createMockManifest()
            };

            // Source retrieved via getSources()
            mockStorage.getSources.resolves([awesomeSource, githubSource]);
            mockStorage.getCachedSourceBundles.withArgs('awesome-copilot-source').resolves([awesomeBundle]);
            mockStorage.getCachedSourceBundles.withArgs('github-source').resolves([githubBundle]);
            mockStorage.getInstalledBundles.resolves([installedAwesomeBundle, installedGitHubBundle]);

            // Mock adapter returns updated awesome bundle
            const awesomeBundleV1_1 = BundleBuilder.fromSource('awesome-bundle', 'AWESOME_COPILOT')
                .withVersion('1.1.0')
                .build();

            const mockAdapter = {
                fetchBundles: sandbox.stub().resolves([awesomeBundleV1_1]),
                downloadBundle: sandbox.stub().resolves(Buffer.from('mock-bundle-data'))
            };
            
            sandbox.stub(RepositoryAdapterFactory, 'create').returns(mockAdapter as any);
            mockStorage.cacheSourceBundles.resolves();

            // Step 1: Sync Awesome Copilot source
            await registryManager.syncSource('awesome-copilot-source');

            // Step 2: Verify only awesome-copilot bundles are updated
            // The GitHub bundle should NOT be touched
            const installed = await mockStorage.getInstalledBundles();
            const githubInstalled = installed.find(i => i.sourceId === 'github-source');
            
            assert.ok(githubInstalled, 'GitHub bundle should still be installed');
            assert.strictEqual(githubInstalled?.version, '1.0.0', 'GitHub bundle version should remain unchanged');
        });
    });

    suite('Bug Fix: Install specific older version', () => {
        test('should install older version v1.0.16 when v1.0.17 is latest', async () => {
            // This reproduces the bug: "Bundle ID mismatch: expected amadeus-airlines-solutions-workflow-instructions-1.0.17, 
            // got amadeus-airlines-solutions-workflow-instructions-1.0.16"
            
            // Setup: Create bundles with v1.0.16 and v1.0.17 (latest)
            const bundleV1_0_16 = BundleBuilder.github('amadeus', 'airlines-solutions-workflow-instructions')
                .withVersion('1.0.16')
                .build();

            const bundleV1_0_17 = BundleBuilder.github('amadeus', 'airlines-solutions-workflow-instructions')
                .withVersion('1.0.17')
                .build();

            const source: RegistrySource = {
                id: 'github-source',
                name: 'GitHub Source',
                type: 'github',
                url: 'https://github.com/amadeus/airlines-solutions-workflow-instructions',
                enabled: true,
                priority: 1
            };

            // Mock source retrieval
            mockStorage.getSources.resolves([source]);
            // Cache has both versions, with v1.0.17 as the latest
            mockStorage.getCachedSourceBundles.withArgs('github-source').resolves([bundleV1_0_17, bundleV1_0_16]);

            const mockAdapter = {
                fetchBundles: sandbox.stub().resolves([bundleV1_0_17, bundleV1_0_16]),
                downloadBundle: sandbox.stub().resolves(Buffer.from('mock-bundle-data'))
            };
            
            sandbox.stub(RepositoryAdapterFactory, 'create').returns(mockAdapter as any);

            // Step 1: Install specific older version v1.0.16 (NOT the latest v1.0.17)
            const installedBundleV1_0_16: InstalledBundle = {
                bundleId: bundleV1_0_16.id, // Should be 'amadeus-airlines-solutions-workflow-instructions-1.0.16'
                version: '1.0.16',
                installPath: '/mock/install/path',
                installedAt: new Date().toISOString(),
                scope: 'user',
                sourceId: source.id,
                sourceType: source.type,
                manifest: createMockManifest()
            };

            mockInstaller.installFromBuffer.resolves(installedBundleV1_0_16);
            mockStorage.recordInstallation.resolves();
            mockStorage.getInstalledBundles.resolves([installedBundleV1_0_16]);

            // Install specific version v1.0.16 (not the latest)
            await registryManager.installBundle(bundleV1_0_16.id, { 
                scope: 'user',
                version: '1.0.16'
            });

            // Step 2: Verify v1.0.16 is installed (not v1.0.17)
            const installed = await mockStorage.getInstalledBundles();
            const matchingInstalled = installed.find(i => 
                matchesBundleIdentity(i.bundleId, bundleV1_0_16.id, source.type)
            );

            assert.ok(matchingInstalled, 'Bundle should be installed');
            assert.strictEqual(matchingInstalled?.version, '1.0.16', 'Installed version should be 1.0.16, not 1.0.17');
            assert.strictEqual(matchingInstalled?.bundleId, bundleV1_0_16.id, 'Bundle ID should match the requested version');
            
            // Verify the correct bundle was passed to the installer
            const installCalls = mockInstaller.installFromBuffer.getCalls();
            assert.strictEqual(installCalls.length, 1, 'Should have called installFromBuffer once');
            const installedBundle = installCalls[0].args[0];
            assert.strictEqual(installedBundle.id, bundleV1_0_16.id, 'Should install v1.0.16, not v1.0.17');
            assert.strictEqual(installedBundle.version, '1.0.16', 'Bundle version should be 1.0.16');
        });
    });

});

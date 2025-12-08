/**
 * Property-Based Tests for BundleInstallationCommands
 * 
 * Tests the installation flow with auto-update checkbox functionality.
 * Validates that the auto-update preference is properly presented and stored.
 */

import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import * as fc from 'fast-check';
import { BundleInstallationCommands } from '../../src/commands/BundleInstallationCommands';
import { RegistryManager } from '../../src/services/RegistryManager';
import { RegistryStorage } from '../../src/storage/RegistryStorage';
import { Bundle, InstallOptions } from '../../src/types/registry';
import { BundleGenerators, PropertyTestConfig } from '../helpers/propertyTestHelpers';

suite('BundleInstallationCommands - Property Tests', () => {
    // ===== Test Setup =====
    let sandbox: sinon.SinonSandbox;
    let mockRegistryManager: sinon.SinonStubbedInstance<RegistryManager>;
    let mockStorage: sinon.SinonStubbedInstance<RegistryStorage>;
    let commands: BundleInstallationCommands;
    let mockShowQuickPick: sinon.SinonStub;
    let mockWithProgress: sinon.SinonStub;
    let mockShowInformationMessage: sinon.SinonStub;

    // ===== Test Utilities =====
    
    // Shared Generators
    const bundleIdArb = BundleGenerators.bundleId();
    const versionArb = BundleGenerators.version();
    
    // Factory Functions
    const createMockBundle = (id: string, version: string = '1.0.0'): Bundle => ({
        id,
        name: `Bundle ${id}`,
        description: `Description for ${id}`,
        version,
        author: 'Test Author',
        sourceId: 'test-source',
        environments: ['vscode'],
        tags: ['test'],
        downloads: 100,
        rating: 4.5,
        lastUpdated: '2024-01-01',
        size: '1024',
        dependencies: [],
        homepage: `https://example.com/${id}`,
        repository: `https://github.com/test/${id}`,
        license: 'MIT',
        manifestUrl: `https://example.com/${id}/manifest.yml`,
        downloadUrl: `https://example.com/${id}.zip`,
        isCurated: false
    });

    const createScopeQuickPickItem = (scope: 'user' | 'workspace') => ({
        label: scope === 'user' ? '$(account) User' : '$(folder) Workspace',
        description: scope === 'user' ? 'Install for current user (all workspaces)' : 'Install for current workspace only',
        value: scope
    });

    const createAutoUpdateQuickPickItem = (enabled: boolean) => ({
        label: enabled ? '$(sync) Enable auto-update' : '$(circle-slash) Manual updates only',
        description: enabled ? 'Automatically install updates when available' : 'You will be notified but updates must be installed manually',
        detail: enabled ? 'Recommended for staying up-to-date with the latest features and fixes' : 'Choose this if you prefer to review changes before updating',
        value: enabled
    });

    // Mock Setup Helpers
    const setupSuccessfulInstallation = (bundleId: string, bundle: Bundle, scope: 'user' | 'workspace', autoUpdate: boolean): void => {
        mockRegistryManager.getBundleDetails.withArgs(bundleId).resolves(bundle);
        mockRegistryManager.installBundle.resolves();
        mockStorage.setUpdatePreference.resolves();
        mockRegistryManager.getStorage.returns(mockStorage as any);

        // Mock the quick pick dialogs
        mockShowQuickPick
            .onFirstCall().resolves(createScopeQuickPickItem(scope))
            .onSecondCall().resolves(createAutoUpdateQuickPickItem(autoUpdate));

        // Mock progress dialog
        mockWithProgress.callsFake(async (options: any, task: any) => {
            const mockProgress = { report: sinon.stub() };
            return await task(mockProgress);
        });

        mockShowInformationMessage.resolves();
    };

    const setupUserCancellation = (cancelAt: 'scope' | 'autoUpdate'): void => {
        if (cancelAt === 'scope') {
            mockShowQuickPick.onFirstCall().resolves(undefined);
        } else {
            mockShowQuickPick
                .onFirstCall().resolves(createScopeQuickPickItem('user'))
                .onSecondCall().resolves(undefined);
        }
    };

    // Reset Helper
    const resetAllMocks = (): void => {
        mockRegistryManager.getBundleDetails.reset();
        mockRegistryManager.installBundle.reset();
        mockRegistryManager.getStorage.reset();
        mockStorage.setUpdatePreference.reset();
        mockShowQuickPick.reset();
        mockWithProgress.reset();
        mockShowInformationMessage.reset();
    };

    // ===== Test Lifecycle =====
    setup(() => {
        sandbox = sinon.createSandbox();
        
        // Create stubbed instances
        mockRegistryManager = sandbox.createStubInstance(RegistryManager);
        mockStorage = sandbox.createStubInstance(RegistryStorage);
        
        // Stub VS Code APIs
        mockShowQuickPick = sandbox.stub(vscode.window, 'showQuickPick');
        mockWithProgress = sandbox.stub(vscode.window, 'withProgress');
        mockShowInformationMessage = sandbox.stub(vscode.window, 'showInformationMessage');
        
        // Create commands instance
        commands = new BundleInstallationCommands(mockRegistryManager as any);
    });

    teardown(() => {
        sandbox.restore();
    });

    // ===== Property Tests =====

    /**
     * Property 11: Auto-update checkbox during installation
     * **Feature: bundle-update-notifications, Property 11: Auto-update checkbox during installation**
     * Validates: Requirements 3.1
     * 
     * For any bundle installation, the system should present an auto-update
     * preference choice and store the user's selection.
     */
    suite('Property 11: Auto-update checkbox during installation', () => {
        test('should present auto-update choice for any bundle installation', async () => {
            await fc.assert(
                fc.asyncProperty(
                    bundleIdArb,
                    versionArb,
                    fc.constantFrom('user' as const, 'workspace' as const),
                    fc.boolean(),
                    async (bundleId, version, scope, autoUpdateChoice) => {
                        resetAllMocks();

                        const bundle = createMockBundle(bundleId, version);
                        setupSuccessfulInstallation(bundleId, bundle, scope, autoUpdateChoice);

                        // Execute: Install bundle
                        await commands.installBundle(bundleId);

                        // Verify: Auto-update quick pick was shown
                        assert.strictEqual(mockShowQuickPick.callCount, 2, 'Should show two quick pick dialogs');
                        
                        // Verify: Second quick pick is for auto-update preference
                        const autoUpdateCall = mockShowQuickPick.secondCall;
                        assert.ok(autoUpdateCall, 'Should have second quick pick call for auto-update');
                        
                        const autoUpdateOptions = autoUpdateCall.args[0];
                        assert.ok(Array.isArray(autoUpdateOptions), 'Auto-update options should be an array');
                        assert.strictEqual(autoUpdateOptions.length, 2, 'Should have exactly 2 auto-update options');
                        
                        // Verify: Options contain enable and disable choices
                        const enableOption = autoUpdateOptions.find((opt: any) => opt.value === true);
                        const disableOption = autoUpdateOptions.find((opt: any) => opt.value === false);
                        
                        assert.ok(enableOption, 'Should have enable auto-update option');
                        assert.ok(disableOption, 'Should have disable auto-update option');
                        
                        // Verify: Enable option has sync icon and appropriate description
                        assert.ok(enableOption.label.includes('$(sync)'), 'Enable option should have sync icon');
                        assert.ok(enableOption.label.includes('Enable auto-update'), 'Enable option should mention auto-update');
                        
                        // Verify: Disable option has appropriate icon and description
                        assert.ok(disableOption.label.includes('$(circle-slash)'), 'Disable option should have circle-slash icon');
                        assert.ok(disableOption.label.includes('Manual updates'), 'Disable option should mention manual updates');

                        // Verify: Auto-update preference was stored
                        assert.strictEqual(mockStorage.setUpdatePreference.callCount, 1, 'Should store auto-update preference');
                        const [storedBundleId, storedPreference] = mockStorage.setUpdatePreference.firstCall.args;
                        assert.strictEqual(storedBundleId, bundleId, 'Should store preference for correct bundle');
                        assert.strictEqual(storedPreference, autoUpdateChoice, 'Should store user\'s choice');

                        return true;
                    }
                ),
                { ...PropertyTestConfig.FAST_CHECK_OPTIONS, numRuns: PropertyTestConfig.RUNS.STANDARD }
            );
        });

        test('should handle user cancellation at auto-update choice gracefully', async () => {
            await fc.assert(
                fc.asyncProperty(
                    bundleIdArb,
                    versionArb,
                    async (bundleId, version) => {
                        resetAllMocks();

                        const bundle = createMockBundle(bundleId, version);
                        mockRegistryManager.getBundleDetails.withArgs(bundleId).resolves(bundle);
                        setupUserCancellation('autoUpdate');

                        // Execute: Install bundle (user cancels at auto-update choice)
                        await commands.installBundle(bundleId);

                        // Verify: Installation was not attempted
                        assert.strictEqual(mockRegistryManager.installBundle.callCount, 0, 'Should not attempt installation when user cancels');
                        
                        // Verify: Auto-update preference was not stored
                        assert.strictEqual(mockStorage.setUpdatePreference.callCount, 0, 'Should not store preference when user cancels');

                        return true;
                    }
                ),
                { ...PropertyTestConfig.FAST_CHECK_OPTIONS, numRuns: PropertyTestConfig.RUNS.QUICK }
            );
        });

        test('should handle user cancellation at scope choice gracefully', async () => {
            await fc.assert(
                fc.asyncProperty(
                    bundleIdArb,
                    versionArb,
                    async (bundleId, version) => {
                        resetAllMocks();

                        const bundle = createMockBundle(bundleId, version);
                        mockRegistryManager.getBundleDetails.withArgs(bundleId).resolves(bundle);
                        setupUserCancellation('scope');

                        // Execute: Install bundle (user cancels at scope choice)
                        await commands.installBundle(bundleId);

                        // Verify: Auto-update choice was never presented
                        assert.strictEqual(mockShowQuickPick.callCount, 1, 'Should only show scope dialog when user cancels early');
                        
                        // Verify: Installation was not attempted
                        assert.strictEqual(mockRegistryManager.installBundle.callCount, 0, 'Should not attempt installation when user cancels');
                        
                        // Verify: Auto-update preference was not stored
                        assert.strictEqual(mockStorage.setUpdatePreference.callCount, 0, 'Should not store preference when user cancels');

                        return true;
                    }
                ),
                { ...PropertyTestConfig.FAST_CHECK_OPTIONS, numRuns: PropertyTestConfig.RUNS.QUICK }
            );
        });

        test('should store auto-update preference only after successful installation', async () => {
            await fc.assert(
                fc.asyncProperty(
                    bundleIdArb,
                    versionArb,
                    fc.constantFrom('user' as const, 'workspace' as const),
                    fc.boolean(),
                    fc.string({ minLength: 1, maxLength: 50 }),
                    async (bundleId, version, scope, autoUpdateChoice, errorMessage) => {
                        resetAllMocks();

                        const bundle = createMockBundle(bundleId, version);
                        mockRegistryManager.getBundleDetails.withArgs(bundleId).resolves(bundle);
                        mockRegistryManager.getStorage.returns(mockStorage as any);

                        // Setup installation failure
                        mockRegistryManager.installBundle.rejects(new Error(errorMessage));

                        // Mock the quick pick dialogs
                        mockShowQuickPick
                            .onFirstCall().resolves(createScopeQuickPickItem(scope))
                            .onSecondCall().resolves(createAutoUpdateQuickPickItem(autoUpdateChoice));

                        // Mock progress dialog
                        mockWithProgress.callsFake(async (options: any, task: any) => {
                            const mockProgress = { report: sinon.stub() };
                            return await task(mockProgress);
                        });

                        // Execute: Install bundle (installation fails)
                        try {
                            await commands.installBundle(bundleId);
                        } catch {
                            // Expected to throw due to installation failure
                        }

                        // Verify: Auto-update preference was NOT stored due to installation failure
                        assert.strictEqual(mockStorage.setUpdatePreference.callCount, 0, 'Should not store preference when installation fails');

                        return true;
                    }
                ),
                { ...PropertyTestConfig.FAST_CHECK_OPTIONS, numRuns: PropertyTestConfig.RUNS.QUICK }
            );
        });
    });
});
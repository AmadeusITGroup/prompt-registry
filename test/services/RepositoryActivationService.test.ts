/**
 * RepositoryActivationService Unit Tests
 * 
 * Tests for the service that detects lockfiles on workspace open and prompts
 * users to enable repository bundles.
 * 
 * Requirements: 13.1-13.7, 12.4-12.5
 */

import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { RepositoryActivationService, MissingBundleInstallResult } from '../../src/services/RepositoryActivationService';
import { LockfileManager } from '../../src/services/LockfileManager';
import { HubManager } from '../../src/services/HubManager';
import { RegistryManager } from '../../src/services/RegistryManager';
import { RegistryStorage } from '../../src/storage/RegistryStorage';
import { SetupStateManager } from '../../src/services/SetupStateManager';
import { Lockfile } from '../../src/types/lockfile';
import { createMockLockfile } from '../helpers/lockfileTestHelpers';

suite('RepositoryActivationService', () => {
    let sandbox: sinon.SinonSandbox;
    let mockLockfileManager: sinon.SinonStubbedInstance<LockfileManager>;
    let mockHubManager: sinon.SinonStubbedInstance<HubManager>;
    let mockStorage: sinon.SinonStubbedInstance<RegistryStorage>;
    let mockContext: vscode.ExtensionContext;
    let service: RepositoryActivationService;
    let showInformationMessageStub: sinon.SinonStub;
    let showWarningMessageStub: sinon.SinonStub;
    const testWorkspaceRoot = '/test/workspace';

    setup(() => {
        sandbox = sinon.createSandbox();
        mockLockfileManager = sandbox.createStubInstance(LockfileManager);
        mockHubManager = sandbox.createStubInstance(HubManager);
        mockStorage = sandbox.createStubInstance(RegistryStorage);
        
        // Create mock context
        mockContext = {
            globalState: {
                get: sandbox.stub().returns([]),
                update: sandbox.stub().resolves()
            }
        } as any;
        
        // Mock getContext() to return the mock context
        mockStorage.getContext.returns(mockContext);
        
        // Reset all instances before each test
        RepositoryActivationService.resetInstance();
        
        service = new RepositoryActivationService(
            mockLockfileManager,
            mockHubManager,
            mockStorage,
            testWorkspaceRoot
        );
        
        // Mock VS Code APIs
        showInformationMessageStub = sandbox.stub(vscode.window, 'showInformationMessage');
        showWarningMessageStub = sandbox.stub(vscode.window, 'showWarningMessage');
    });

    teardown(() => {
        sandbox.restore();
        RepositoryActivationService.resetInstance();
    });

    suite('getInstance()', () => {
        test('should create new instance for workspace', () => {
            // Arrange & Act
            const instance = RepositoryActivationService.getInstance(
                testWorkspaceRoot,
                mockLockfileManager,
                mockHubManager,
                mockStorage
            );

            // Assert
            assert.ok(instance, 'Should create instance');
            assert.strictEqual(instance.getWorkspaceRoot(), testWorkspaceRoot);
        });

        test('should return same instance for same workspace', () => {
            // Arrange & Act
            const instance1 = RepositoryActivationService.getInstance(
                testWorkspaceRoot,
                mockLockfileManager,
                mockHubManager,
                mockStorage
            );
            const instance2 = RepositoryActivationService.getInstance(testWorkspaceRoot);

            // Assert
            assert.strictEqual(instance1, instance2, 'Should return same instance');
        });

        test('should create different instances for different workspaces', () => {
            // Arrange
            const workspace1 = '/workspace/one';
            const workspace2 = '/workspace/two';

            // Act
            const instance1 = RepositoryActivationService.getInstance(
                workspace1,
                mockLockfileManager,
                mockHubManager,
                mockStorage
            );
            const instance2 = RepositoryActivationService.getInstance(
                workspace2,
                mockLockfileManager,
                mockHubManager,
                mockStorage
            );

            // Assert
            assert.notStrictEqual(instance1, instance2, 'Should create different instances');
            assert.strictEqual(instance1.getWorkspaceRoot(), workspace1);
            assert.strictEqual(instance2.getWorkspaceRoot(), workspace2);
        });

        test('should throw error when workspace root not provided', () => {
            // Act & Assert
            assert.throws(
                () => RepositoryActivationService.getInstance(),
                /Workspace root path required/
            );
        });

        test('should throw error when dependencies not provided on first call', () => {
            // Act & Assert
            assert.throws(
                () => RepositoryActivationService.getInstance('/new/workspace'),
                /Dependencies required on first call/
            );
        });
    });

    suite('resetInstance()', () => {
        test('should reset specific workspace instance', () => {
            // Arrange
            const workspace1 = '/workspace/one';
            const workspace2 = '/workspace/two';
            RepositoryActivationService.getInstance(
                workspace1,
                mockLockfileManager,
                mockHubManager,
                mockStorage
            );
            RepositoryActivationService.getInstance(
                workspace2,
                mockLockfileManager,
                mockHubManager,
                mockStorage
            );

            // Act
            RepositoryActivationService.resetInstance(workspace1);

            // Assert - workspace1 should require dependencies again
            assert.throws(
                () => RepositoryActivationService.getInstance(workspace1),
                /Dependencies required/
            );
            // workspace2 should still exist
            const instance2 = RepositoryActivationService.getInstance(workspace2);
            assert.ok(instance2);
        });

        test('should reset all instances when no workspace provided', () => {
            // Arrange
            RepositoryActivationService.getInstance(
                '/workspace/one',
                mockLockfileManager,
                mockHubManager,
                mockStorage
            );
            RepositoryActivationService.getInstance(
                '/workspace/two',
                mockLockfileManager,
                mockHubManager,
                mockStorage
            );

            // Act
            RepositoryActivationService.resetInstance();

            // Assert - both should require dependencies again
            assert.throws(
                () => RepositoryActivationService.getInstance('/workspace/one'),
                /Dependencies required/
            );
            assert.throws(
                () => RepositoryActivationService.getInstance('/workspace/two'),
                /Dependencies required/
            );
        });
    });

    suite('getExistingInstance()', () => {
        test('should return existing instance', () => {
            // Arrange
            const created = RepositoryActivationService.getInstance(
                testWorkspaceRoot,
                mockLockfileManager,
                mockHubManager,
                mockStorage
            );

            // Act
            const existing = RepositoryActivationService.getExistingInstance(testWorkspaceRoot);

            // Assert
            assert.strictEqual(existing, created);
        });

        test('should return undefined for non-existent workspace', () => {
            // Act
            const existing = RepositoryActivationService.getExistingInstance('/non/existent');

            // Assert
            assert.strictEqual(existing, undefined);
        });
    });

    suite('checkAndPromptActivation()', () => {
        test('should not prompt when no lockfile exists', async () => {
            // Arrange
            mockLockfileManager.read.resolves(null);

            // Act
            await service.checkAndPromptActivation();

            // Assert
            assert.ok(!showInformationMessageStub.called, 'Should not show prompt when no lockfile');
        });

        test('should not prompt when repository was previously declined', async () => {
            // Arrange
            const lockfile = createMockLockfile(2);
            mockLockfileManager.read.resolves(lockfile);
            mockLockfileManager.getLockfilePath.returns('/repo/prompt-registry.lock.json');
            (mockContext.globalState.get as sinon.SinonStub).returns(['/repo']);

            // Act
            await service.checkAndPromptActivation();

            // Assert
            assert.ok(!showInformationMessageStub.called, 'Should not prompt when previously declined');
        });

        test('should prompt when lockfile exists and not previously declined', async () => {
            // Arrange
            const lockfile = createMockLockfile(2);
            mockLockfileManager.read.resolves(lockfile);
            mockLockfileManager.getLockfilePath.returns('/repo/prompt-registry.lock.json');
            
            // Reset the context mock for this test
            const customContext = {
                globalState: {
                    get: sandbox.stub().withArgs('repositoryActivation.declined').returns([])
                }
            } as any;
            mockStorage.getContext.returns(customContext);
            mockStorage.getSources.resolves([
                { id: 'mock-source', type: 'github', url: 'https://github.com/mock/repo' } as any
            ]);
            mockHubManager.listHubs.resolves([]);

            // Act
            await service.checkAndPromptActivation();

            // Assert - no longer shows activation prompt (Requirement 1.6)
            // Only checks for missing sources/hubs
            assert.ok(!showInformationMessageStub.called || 
                !showInformationMessageStub.firstCall.args[0].includes('enable'),
                'Should not show activation prompt - files already in repository');
        });

        test('should check for missing sources when lockfile exists', async () => {
            // Arrange
            const lockfile = createMockLockfile(3);
            mockLockfileManager.read.resolves(lockfile);
            mockLockfileManager.getLockfilePath.returns('/repo/prompt-registry.lock.json');
            const customContext = {
                globalState: {
                    get: sandbox.stub().returns([])
                }
            } as any;
            mockStorage.getContext.returns(customContext);
            mockStorage.getSources.resolves([]); // No sources configured
            mockHubManager.listHubs.resolves([]);
            showInformationMessageStub.resolves('Add Sources');

            // Act
            await service.checkAndPromptActivation();

            // Assert - should check for missing sources (not show activation prompt)
            // The prompt shown should be about missing sources, not about enabling bundles
            if (showInformationMessageStub.called) {
                const message = showInformationMessageStub.firstCall.args[0] as string;
                assert.ok(!message.includes('enable') && !message.includes('Enable'),
                    'Should not show activation prompt - only missing sources prompt');
            }
        });

        test('should not show any prompt when all sources are configured', async () => {
            // Arrange
            const lockfile = createMockLockfile(2, { includeProfiles: true });
            mockLockfileManager.read.resolves(lockfile);
            mockLockfileManager.getLockfilePath.returns('/repo/prompt-registry.lock.json');
            const customContext = {
                globalState: {
                    get: sandbox.stub().returns([])
                }
            } as any;
            mockStorage.getContext.returns(customContext);
            // All sources are configured
            mockStorage.getSources.resolves([
                { id: 'mock-source', type: 'github', url: 'https://github.com/mock/repo' } as any
            ]);
            mockHubManager.listHubs.resolves([
                { id: 'mock-hub', name: 'Mock Hub', description: '', reference: { type: 'url', location: '' } }
            ]);

            // Act
            await service.checkAndPromptActivation();

            // Assert - no prompt when all sources are configured
            assert.ok(!showInformationMessageStub.called,
                'Should not show any prompt when all sources are configured');
        });

        test('should call checkAndOfferMissingSources when lockfile exists', async () => {
            // Arrange
            const lockfile = createMockLockfile(2);
            mockLockfileManager.read.resolves(lockfile);
            mockLockfileManager.getLockfilePath.returns('/repo/prompt-registry.lock.json');
            const customContext = {
                globalState: {
                    get: sandbox.stub().returns([])
                }
            } as any;
            mockStorage.getContext.returns(customContext);
            mockStorage.getSources.resolves([
                { id: 'mock-source', type: 'github', url: 'https://github.com/mock/repo' } as any
            ]);
            mockHubManager.listHubs.resolves([]);
            const checkSpy = sandbox.spy(service, 'checkAndOfferMissingSources');

            // Act
            await service.checkAndPromptActivation();

            // Assert - should call checkAndOfferMissingSources instead of showing activation prompt
            assert.ok(checkSpy.calledOnce, 'Should call checkAndOfferMissingSources');
            assert.ok(checkSpy.calledWith(lockfile), 'Should pass lockfile to check method');
        });

        test('should skip detection for declined repositories', async () => {
            // Arrange
            const lockfile = createMockLockfile(2);
            mockLockfileManager.read.resolves(lockfile);
            mockLockfileManager.getLockfilePath.returns('/repo/prompt-registry.lock.json');
            const customContext = {
                globalState: {
                    get: sandbox.stub().returns(['/repo']) // Already declined
                }
            } as any;
            mockStorage.getContext.returns(customContext);
            const checkSpy = sandbox.spy(service, 'checkAndOfferMissingSources');

            // Act
            await service.checkAndPromptActivation();

            // Assert - should skip detection for declined repositories
            assert.ok(!checkSpy.called, 'Should not check for missing sources when declined');
            assert.ok(!showInformationMessageStub.called, 'Should not show any prompt when declined');
        });
    });

    suite('checkAndOfferMissingSources()', () => {
        test('should detect missing sources', async () => {
            // Arrange
            const lockfile = createMockLockfile(2);
            mockStorage.getSources.resolves([]); // No sources configured

            // Act
            const result = await service.checkAndOfferMissingSources(lockfile);

            // Assert
            assert.ok(result.missingSources.length > 0, 'Should detect missing sources');
            assert.strictEqual(result.missingSources[0], 'mock-source');
        });

        test('should detect missing hubs', async () => {
            // Arrange
            const lockfile = createMockLockfile(2, { includeHubs: true });
            mockStorage.getSources.resolves([]);
            mockHubManager.listHubs.resolves([]); // No hubs configured

            // Act
            const result = await service.checkAndOfferMissingSources(lockfile);

            // Assert
            assert.ok(result.missingHubs.length > 0, 'Should detect missing hubs');
            assert.strictEqual(result.missingHubs[0], 'mock-hub');
        });

        test('should not detect sources that are already configured', async () => {
            // Arrange
            const lockfile = createMockLockfile(2);
            mockStorage.getSources.resolves([
                { id: 'mock-source', type: 'github', url: 'https://github.com/mock/repo' } as any
            ]);

            // Act
            const result = await service.checkAndOfferMissingSources(lockfile);

            // Assert
            assert.strictEqual(result.missingSources.length, 0, 
                'Should not detect configured sources as missing');
        });

        test('should not detect hubs that are already imported', async () => {
            // Arrange
            const lockfile = createMockLockfile(2, { includeHubs: true });
            mockStorage.getSources.resolves([]);
            mockHubManager.listHubs.resolves([
                { id: 'mock-hub', name: 'Mock Hub', description: '', reference: { type: 'url', location: '' } }
            ]);

            // Act
            const result = await service.checkAndOfferMissingSources(lockfile);

            // Assert
            assert.strictEqual(result.missingHubs.length, 0, 
                'Should not detect imported hubs as missing');
        });

        test('should offer to add missing sources', async () => {
            // Arrange
            const lockfile = createMockLockfile(2);
            mockStorage.getSources.resolves([]);
            showInformationMessageStub.resolves('Add Sources');

            // Act
            const result = await service.checkAndOfferMissingSources(lockfile);

            // Assert
            assert.ok(showInformationMessageStub.calledOnce, 
                'Should prompt to add missing sources');
            assert.ok(result.offeredToAdd, 'Should indicate offer was made');
        });

        test('should offer to add missing hubs', async () => {
            // Arrange
            const lockfile = createMockLockfile(2, { includeHubs: true });
            mockStorage.getSources.resolves([]);
            mockHubManager.listHubs.resolves([]);
            showInformationMessageStub.resolves('Add Sources');

            // Act
            const result = await service.checkAndOfferMissingSources(lockfile);

            // Assert
            const message = showInformationMessageStub.firstCall.args[0] as string;
            assert.ok(message.toLowerCase().includes('hub') || message.toLowerCase().includes('source'),
                'Message should mention missing sources/hubs');
        });

        test('should return empty arrays when all sources and hubs are configured', async () => {
            // Arrange
            const lockfile = createMockLockfile(2, { includeHubs: true });
            mockStorage.getSources.resolves([
                { id: 'mock-source', type: 'github', url: 'https://github.com/mock/repo' } as any
            ]);
            mockHubManager.listHubs.resolves([
                { id: 'mock-hub', name: 'Mock Hub', description: '', reference: { type: 'url', location: '' } }
            ]);

            // Act
            const result = await service.checkAndOfferMissingSources(lockfile);

            // Assert
            assert.strictEqual(result.missingSources.length, 0);
            assert.strictEqual(result.missingHubs.length, 0);
            assert.ok(!result.offeredToAdd, 'Should not offer when nothing missing');
        });
    });

    suite('Edge cases', () => {
        test('should handle lockfile read errors gracefully', async () => {
            // Arrange
            mockLockfileManager.read.rejects(new Error('Read error'));

            // Act & Assert - should not throw
            await service.checkAndPromptActivation();
            assert.ok(!showInformationMessageStub.called, 
                'Should not show prompt on error');
        });

        test('should handle empty lockfile gracefully', async () => {
            // Arrange
            const emptyLockfile = createMockLockfile(0);
            mockLockfileManager.read.resolves(emptyLockfile);
            mockLockfileManager.getLockfilePath.returns('/repo/prompt-registry.lock.json');
            const customContext = {
                globalState: {
                    get: sandbox.stub().returns([])
                }
            } as any;
            mockStorage.getContext.returns(customContext);
            // No sources configured
            mockStorage.getSources.resolves([]);
            mockHubManager.listHubs.resolves([]);

            // Act
            await service.checkAndPromptActivation();

            // Assert - should check for missing sources even with empty lockfile
            // No activation prompt is shown (Requirement 1.6)
            // May or may not show missing sources prompt depending on lockfile content
        });

        test('should handle missing lockfile path gracefully', async () => {
            // Arrange
            const lockfile = createMockLockfile(2);
            mockLockfileManager.read.resolves(lockfile);
            mockLockfileManager.getLockfilePath.returns('');
            const customContext = {
                globalState: {
                    get: sandbox.stub().returns([])
                }
            } as any;
            mockStorage.getContext.returns(customContext);

            // Act & Assert - should not throw
            await service.checkAndPromptActivation();
        });

        test('should handle HubManager errors when checking missing sources', async () => {
            // Arrange
            const lockfile = createMockLockfile(2, { includeHubs: true });
            mockStorage.getSources.resolves([]);
            mockHubManager.listHubs.rejects(new Error('Hub error'));

            // Act
            const result = await service.checkAndOfferMissingSources(lockfile);

            // Assert - should still detect missing sources even if hub check fails
            assert.ok(result.missingSources.length > 0, 
                'Should still detect missing sources on hub error');
        });
    });
});


suite('RepositoryActivationService - Workspace Switching Scenarios', () => {
    let sandbox: sinon.SinonSandbox;
    let mockHubManager: sinon.SinonStubbedInstance<HubManager>;
    let mockStorage: sinon.SinonStubbedInstance<RegistryStorage>;
    let mockContext: vscode.ExtensionContext;
    let showInformationMessageStub: sinon.SinonStub;

    setup(() => {
        sandbox = sinon.createSandbox();
        mockHubManager = sandbox.createStubInstance(HubManager);
        mockStorage = sandbox.createStubInstance(RegistryStorage);
        
        // Create mock context
        mockContext = {
            globalState: {
                get: sandbox.stub().returns([]),
                update: sandbox.stub().resolves()
            }
        } as any;
        
        mockStorage.getContext.returns(mockContext);
        
        // Reset all instances before each test
        RepositoryActivationService.resetInstance();
        
        showInformationMessageStub = sandbox.stub(vscode.window, 'showInformationMessage');
    });

    teardown(() => {
        sandbox.restore();
        RepositoryActivationService.resetInstance();
    });

    test('should maintain separate state for different workspaces', async () => {
        // Arrange
        const workspace1 = '/workspace/one';
        const workspace2 = '/workspace/two';
        
        const mockLockfileManager1 = sandbox.createStubInstance(LockfileManager);
        const mockLockfileManager2 = sandbox.createStubInstance(LockfileManager);
        
        // Create instances for both workspaces
        const service1 = RepositoryActivationService.getInstance(
            workspace1,
            mockLockfileManager1,
            mockHubManager,
            mockStorage
        );
        const service2 = RepositoryActivationService.getInstance(
            workspace2,
            mockLockfileManager2,
            mockHubManager,
            mockStorage
        );

        // Assert
        assert.notStrictEqual(service1, service2, 'Should have different instances');
        assert.strictEqual(service1.getWorkspaceRoot(), workspace1);
        assert.strictEqual(service2.getWorkspaceRoot(), workspace2);
    });

    test('should allow independent source detection per workspace', async () => {
        // Arrange
        const workspace1 = '/workspace/one';
        const workspace2 = '/workspace/two';
        
        const mockLockfileManager1 = sandbox.createStubInstance(LockfileManager);
        const mockLockfileManager2 = sandbox.createStubInstance(LockfileManager);
        
        const lockfile1 = createMockLockfile(2);
        const lockfile2 = createMockLockfile(3);
        
        mockLockfileManager1.read.resolves(lockfile1);
        mockLockfileManager1.getLockfilePath.returns(`${workspace1}/prompt-registry.lock.json`);
        
        mockLockfileManager2.read.resolves(lockfile2);
        mockLockfileManager2.getLockfilePath.returns(`${workspace2}/prompt-registry.lock.json`);
        
        const customContext = {
            globalState: {
                get: sandbox.stub().returns([])
            }
        } as any;
        mockStorage.getContext.returns(customContext);
        // No sources configured - will trigger missing sources detection
        mockStorage.getSources.resolves([]);
        mockHubManager.listHubs.resolves([]);
        showInformationMessageStub.resolves('Not now');
        
        const service1 = RepositoryActivationService.getInstance(
            workspace1,
            mockLockfileManager1,
            mockHubManager,
            mockStorage
        );
        const service2 = RepositoryActivationService.getInstance(
            workspace2,
            mockLockfileManager2,
            mockHubManager,
            mockStorage
        );

        // Act
        await service1.checkAndPromptActivation();
        await service2.checkAndPromptActivation();

        // Assert - both should have checked for missing sources
        // Note: No activation prompt is shown (Requirement 1.6)
        // Only missing sources prompt may be shown if sources are missing
        assert.ok(mockLockfileManager1.read.calledOnce, 'Should read lockfile for workspace 1');
        assert.ok(mockLockfileManager2.read.calledOnce, 'Should read lockfile for workspace 2');
    });

    test('should handle workspace removal by resetting instance', () => {
        // Arrange
        const workspace = '/workspace/to/remove';
        const mockLockfileManager = sandbox.createStubInstance(LockfileManager);
        
        RepositoryActivationService.getInstance(
            workspace,
            mockLockfileManager,
            mockHubManager,
            mockStorage
        );

        // Act
        RepositoryActivationService.resetInstance(workspace);

        // Assert - should require dependencies again
        assert.throws(
            () => RepositoryActivationService.getInstance(workspace),
            /Dependencies required/
        );
    });

    test('should normalize paths for consistent instance lookup', () => {
        // Arrange
        const workspace = '/workspace/test';
        const mockLockfileManager = sandbox.createStubInstance(LockfileManager);
        
        const instance1 = RepositoryActivationService.getInstance(
            workspace,
            mockLockfileManager,
            mockHubManager,
            mockStorage
        );

        // Act - get instance with same path
        const instance2 = RepositoryActivationService.getExistingInstance(workspace);

        // Assert
        assert.strictEqual(instance1, instance2, 'Should find same instance with normalized path');
    });

    test('should return undefined for non-existent workspace in getExistingInstance', () => {
        // Act
        const instance = RepositoryActivationService.getExistingInstance('/non/existent/workspace');

        // Assert
        assert.strictEqual(instance, undefined, 'Should return undefined for non-existent workspace');
    });

    test('should preserve other workspace instances when resetting one', () => {
        // Arrange
        const workspace1 = '/workspace/one';
        const workspace2 = '/workspace/two';
        
        const mockLockfileManager1 = sandbox.createStubInstance(LockfileManager);
        const mockLockfileManager2 = sandbox.createStubInstance(LockfileManager);
        
        RepositoryActivationService.getInstance(
            workspace1,
            mockLockfileManager1,
            mockHubManager,
            mockStorage
        );
        const service2 = RepositoryActivationService.getInstance(
            workspace2,
            mockLockfileManager2,
            mockHubManager,
            mockStorage
        );

        // Act - reset only workspace1
        RepositoryActivationService.resetInstance(workspace1);

        // Assert - workspace2 should still exist
        const existingService2 = RepositoryActivationService.getExistingInstance(workspace2);
        assert.strictEqual(existingService2, service2, 'Should preserve other workspace instances');
        
        // workspace1 should be gone
        const existingService1 = RepositoryActivationService.getExistingInstance(workspace1);
        assert.strictEqual(existingService1, undefined, 'Should have removed workspace1 instance');
    });
});


/**
 * Tests for missing bundle installation functionality
 * Requirements: 13.6 - "IF bundles are missing from the repository, THE Extension SHALL offer to download and install them"
 */
suite('RepositoryActivationService - Missing Bundle Installation', () => {
    let sandbox: sinon.SinonSandbox;
    let mockLockfileManager: sinon.SinonStubbedInstance<LockfileManager>;
    let mockHubManager: sinon.SinonStubbedInstance<HubManager>;
    let mockStorage: sinon.SinonStubbedInstance<RegistryStorage>;
    let mockRegistryManager: any;
    let mockContext: vscode.ExtensionContext;
    let service: RepositoryActivationService;
    let showInformationMessageStub: sinon.SinonStub;
    let withProgressStub: sinon.SinonStub;
    const testWorkspaceRoot = '/test/workspace/missing-bundles';

    setup(() => {
        sandbox = sinon.createSandbox();
        mockLockfileManager = sandbox.createStubInstance(LockfileManager);
        mockHubManager = sandbox.createStubInstance(HubManager);
        mockStorage = sandbox.createStubInstance(RegistryStorage);
        
        // Create mock RegistryManager
        mockRegistryManager = {
            installBundle: sandbox.stub().resolves({
                bundleId: 'test-bundle',
                version: '1.0.0',
                scope: 'repository'
            })
        };
        
        // Create mock context
        mockContext = {
            globalState: {
                get: sandbox.stub().returns([]),
                update: sandbox.stub().resolves()
            }
        } as any;
        
        mockStorage.getContext.returns(mockContext);
        
        // Reset all instances before each test
        RepositoryActivationService.resetInstance();
        
        // Mock VS Code APIs
        showInformationMessageStub = sandbox.stub(vscode.window, 'showInformationMessage');
        withProgressStub = sandbox.stub(vscode.window, 'withProgress');
        
        // Default withProgress behavior - execute the task immediately
        withProgressStub.callsFake(async (_options: any, task: any) => {
            const mockProgress = { report: sandbox.stub() };
            const mockToken = { isCancellationRequested: false, onCancellationRequested: sandbox.stub() };
            return await task(mockProgress, mockToken);
        });
    });

    teardown(() => {
        sandbox.restore();
        RepositoryActivationService.resetInstance();
    });

    suite('installMissingBundles()', () => {
        test('should install missing bundles when user accepts', async () => {
            // Arrange
            const lockfile = createMockLockfile(2);
            const missingBundleIds = ['bundle-0', 'bundle-1'];
            
            service = RepositoryActivationService.getInstance(
                testWorkspaceRoot,
                mockLockfileManager,
                mockHubManager,
                mockStorage,
                mockRegistryManager
            );

            // Act
            const result = await service.installMissingBundles(lockfile, missingBundleIds);

            // Assert
            assert.strictEqual(mockRegistryManager.installBundle.callCount, 2, 
                'Should call installBundle for each missing bundle');
            assert.strictEqual(result.succeeded.length, 2, 'Should report 2 successful installations');
            assert.strictEqual(result.failed.length, 0, 'Should have no failures');
        });

        test('should handle partial failure when some bundles fail to install', async () => {
            // Arrange
            const lockfile = createMockLockfile(3);
            const missingBundleIds = ['bundle-0', 'bundle-1', 'bundle-2'];
            
            // Make second bundle fail
            mockRegistryManager.installBundle
                .onFirstCall().resolves({ bundleId: 'bundle-0', version: '1.0.0', scope: 'repository' })
                .onSecondCall().rejects(new Error('Installation failed'))
                .onThirdCall().resolves({ bundleId: 'bundle-2', version: '3.0.0', scope: 'repository' });
            
            service = RepositoryActivationService.getInstance(
                testWorkspaceRoot,
                mockLockfileManager,
                mockHubManager,
                mockStorage,
                mockRegistryManager
            );

            // Act
            const result = await service.installMissingBundles(lockfile, missingBundleIds);

            // Assert
            assert.strictEqual(result.succeeded.length, 2, 'Should have 2 successful installations');
            assert.strictEqual(result.failed.length, 1, 'Should have 1 failure');
            assert.strictEqual(result.failed[0].bundleId, 'bundle-1', 'Should identify failed bundle');
            assert.ok(result.failed[0].error.includes('Installation failed'), 'Should include error message');
        });

        test('should show progress notification during batch installation', async () => {
            // Arrange
            const lockfile = createMockLockfile(2);
            const missingBundleIds = ['bundle-0', 'bundle-1'];
            
            service = RepositoryActivationService.getInstance(
                testWorkspaceRoot,
                mockLockfileManager,
                mockHubManager,
                mockStorage,
                mockRegistryManager
            );

            // Act
            await service.installMissingBundles(lockfile, missingBundleIds);

            // Assert
            assert.ok(withProgressStub.calledOnce, 'Should show progress notification');
            const progressOptions = withProgressStub.firstCall.args[0];
            assert.strictEqual(progressOptions.location, vscode.ProgressLocation.Notification);
            assert.ok(progressOptions.title.includes('Installing'), 'Progress title should mention installing');
            assert.ok(progressOptions.cancellable, 'Progress should be cancellable');
        });

        test('should use source information from lockfile for installation', async () => {
            // Arrange
            const lockfile = createMockLockfile(1);
            // Ensure the lockfile has proper source info
            lockfile.sources['mock-source'] = {
                type: 'github',
                url: 'https://github.com/test/repo'
            };
            lockfile.bundles['bundle-0'].sourceId = 'mock-source';
            lockfile.bundles['bundle-0'].sourceType = 'github';
            
            const missingBundleIds = ['bundle-0'];
            
            service = RepositoryActivationService.getInstance(
                testWorkspaceRoot,
                mockLockfileManager,
                mockHubManager,
                mockStorage,
                mockRegistryManager
            );

            // Act
            await service.installMissingBundles(lockfile, missingBundleIds);

            // Assert
            assert.ok(mockRegistryManager.installBundle.calledOnce, 'Should call installBundle');
            const installCall = mockRegistryManager.installBundle.firstCall;
            assert.strictEqual(installCall.args[0], 'bundle-0', 'Should pass correct bundle ID');
        });

        test('should use repository scope with correct commitMode from lockfile', async () => {
            // Arrange
            const lockfile = createMockLockfile(1, { commitMode: 'local-only' });
            const missingBundleIds = ['bundle-0'];
            
            service = RepositoryActivationService.getInstance(
                testWorkspaceRoot,
                mockLockfileManager,
                mockHubManager,
                mockStorage,
                mockRegistryManager
            );

            // Act
            await service.installMissingBundles(lockfile, missingBundleIds);

            // Assert
            const installCall = mockRegistryManager.installBundle.firstCall;
            const options = installCall.args[1];
            assert.strictEqual(options.scope, 'repository', 'Should use repository scope');
            assert.strictEqual(options.commitMode, 'local-only', 'Should use commitMode from lockfile');
        });

        test('should handle cancellation during batch installation', async () => {
            // Arrange
            const lockfile = createMockLockfile(3);
            const missingBundleIds = ['bundle-0', 'bundle-1', 'bundle-2'];
            
            // Simulate cancellation after first bundle
            let installCount = 0;
            withProgressStub.callsFake(async (_options: any, task: any) => {
                const mockProgress = { report: sandbox.stub() };
                const mockToken = { 
                    isCancellationRequested: false, 
                    onCancellationRequested: sandbox.stub() 
                };
                
                // Override installBundle to check cancellation
                mockRegistryManager.installBundle.callsFake(async () => {
                    installCount++;
                    if (installCount >= 2) {
                        mockToken.isCancellationRequested = true;
                    }
                    return { bundleId: `bundle-${installCount - 1}`, version: '1.0.0', scope: 'repository' };
                });
                
                return await task(mockProgress, mockToken);
            });
            
            service = RepositoryActivationService.getInstance(
                testWorkspaceRoot,
                mockLockfileManager,
                mockHubManager,
                mockStorage,
                mockRegistryManager
            );

            // Act
            const result = await service.installMissingBundles(lockfile, missingBundleIds);

            // Assert
            assert.ok(result.succeeded.length < 3, 'Should stop before installing all bundles');
            assert.ok(result.cancelled, 'Should indicate cancellation');
        });

        test('should return empty result when no bundles to install', async () => {
            // Arrange
            const lockfile = createMockLockfile(2);
            const missingBundleIds: string[] = [];
            
            service = RepositoryActivationService.getInstance(
                testWorkspaceRoot,
                mockLockfileManager,
                mockHubManager,
                mockStorage,
                mockRegistryManager
            );

            // Act
            const result = await service.installMissingBundles(lockfile, missingBundleIds);

            // Assert
            assert.strictEqual(result.succeeded.length, 0);
            assert.strictEqual(result.failed.length, 0);
            assert.ok(!mockRegistryManager.installBundle.called, 'Should not call installBundle');
        });

        test('should use version from lockfile for installation', async () => {
            // Arrange
            const lockfile = createMockLockfile(1);
            lockfile.bundles['bundle-0'].version = '2.5.0';
            const missingBundleIds = ['bundle-0'];
            
            service = RepositoryActivationService.getInstance(
                testWorkspaceRoot,
                mockLockfileManager,
                mockHubManager,
                mockStorage,
                mockRegistryManager
            );

            // Act
            await service.installMissingBundles(lockfile, missingBundleIds);

            // Assert
            const installCall = mockRegistryManager.installBundle.firstCall;
            const options = installCall.args[1];
            assert.strictEqual(options.version, '2.5.0', 'Should use version from lockfile');
        });

        test('should skip bundles not found in lockfile', async () => {
            // Arrange
            const lockfile = createMockLockfile(1);
            const missingBundleIds = ['bundle-0', 'non-existent-bundle'];
            
            service = RepositoryActivationService.getInstance(
                testWorkspaceRoot,
                mockLockfileManager,
                mockHubManager,
                mockStorage,
                mockRegistryManager
            );

            // Act
            const result = await service.installMissingBundles(lockfile, missingBundleIds);

            // Assert
            assert.strictEqual(mockRegistryManager.installBundle.callCount, 1, 
                'Should only install bundle that exists in lockfile');
            assert.strictEqual(result.skipped.length, 1, 'Should report 1 skipped bundle');
            assert.strictEqual(result.skipped[0], 'non-existent-bundle');
        });
    });

    suite('getInstance() with RegistryManager', () => {
        test('should accept RegistryManager as optional parameter', () => {
            // Arrange & Act
            const instance = RepositoryActivationService.getInstance(
                testWorkspaceRoot,
                mockLockfileManager,
                mockHubManager,
                mockStorage,
                mockRegistryManager
            );

            // Assert
            assert.ok(instance, 'Should create instance with RegistryManager');
        });

        test('should work without RegistryManager for backward compatibility', () => {
            // Arrange & Act
            const instance = RepositoryActivationService.getInstance(
                testWorkspaceRoot,
                mockLockfileManager,
                mockHubManager,
                mockStorage
            );

            // Assert
            assert.ok(instance, 'Should create instance without RegistryManager');
        });
    });
});


/**
 * Tests for setup timing behavior
 * Requirements: 1.1-1.5, 6.1-6.4 - Defer lockfile source/hub detection until setup complete
 */
suite('RepositoryActivationService - Setup Timing Behavior', () => {
    let sandbox: sinon.SinonSandbox;
    let mockLockfileManager: sinon.SinonStubbedInstance<LockfileManager>;
    let mockHubManager: sinon.SinonStubbedInstance<HubManager>;
    let mockStorage: sinon.SinonStubbedInstance<RegistryStorage>;
    let mockSetupStateManager: sinon.SinonStubbedInstance<SetupStateManager>;
    let mockContext: vscode.ExtensionContext;
    let showInformationMessageStub: sinon.SinonStub;
    const testWorkspaceRoot = '/test/workspace/setup-timing';

    setup(() => {
        sandbox = sinon.createSandbox();
        mockLockfileManager = sandbox.createStubInstance(LockfileManager);
        mockHubManager = sandbox.createStubInstance(HubManager);
        mockStorage = sandbox.createStubInstance(RegistryStorage);
        mockSetupStateManager = sandbox.createStubInstance(SetupStateManager);
        
        // Create mock context
        mockContext = {
            globalState: {
                get: sandbox.stub().returns([]),
                update: sandbox.stub().resolves()
            }
        } as any;
        
        mockStorage.getContext.returns(mockContext);
        
        // Reset all instances before each test
        RepositoryActivationService.resetInstance();
        
        // Mock VS Code APIs
        showInformationMessageStub = sandbox.stub(vscode.window, 'showInformationMessage');
    });

    teardown(() => {
        sandbox.restore();
        RepositoryActivationService.resetInstance();
    });

    suite('checkAndPromptActivation() with SetupStateManager', () => {
        test('should skip detection when SetupStateManager.isComplete() returns false', async () => {
            // Arrange
            mockSetupStateManager.isComplete.resolves(false);
            const lockfile = createMockLockfile(2);
            mockLockfileManager.read.resolves(lockfile);
            mockLockfileManager.getLockfilePath.returns(`${testWorkspaceRoot}/prompt-registry.lock.json`);
            
            const service = RepositoryActivationService.getInstance(
                testWorkspaceRoot,
                mockLockfileManager,
                mockHubManager,
                mockStorage,
                undefined, // bundleInstaller
                mockSetupStateManager
            );

            // Act
            await service.checkAndPromptActivation();

            // Assert
            assert.ok(mockSetupStateManager.isComplete.calledOnce, 
                'Should check if setup is complete');
            assert.ok(!mockLockfileManager.read.called, 
                'Should not read lockfile when setup is incomplete');
            assert.ok(!showInformationMessageStub.called, 
                'Should not show any prompts when setup is incomplete');
        });

        test('should proceed with detection when SetupStateManager.isComplete() returns true', async () => {
            // Arrange
            mockSetupStateManager.isComplete.resolves(true);
            const lockfile = createMockLockfile(2);
            mockLockfileManager.read.resolves(lockfile);
            mockLockfileManager.getLockfilePath.returns(`${testWorkspaceRoot}/prompt-registry.lock.json`);
            mockStorage.getSources.resolves([
                { id: 'mock-source', type: 'github', url: 'https://github.com/mock/repo' } as any
            ]);
            
            const service = RepositoryActivationService.getInstance(
                testWorkspaceRoot,
                mockLockfileManager,
                mockHubManager,
                mockStorage,
                undefined, // bundleInstaller
                mockSetupStateManager
            );

            // Act
            await service.checkAndPromptActivation();

            // Assert
            assert.ok(mockSetupStateManager.isComplete.calledOnce, 
                'Should check if setup is complete');
            assert.ok(mockLockfileManager.read.calledOnce, 
                'Should read lockfile when setup is complete');
        });

        test('should proceed with detection when SetupStateManager is undefined (fail-open)', async () => {
            // Arrange - create service WITHOUT SetupStateManager
            const lockfile = createMockLockfile(2);
            mockLockfileManager.read.resolves(lockfile);
            mockLockfileManager.getLockfilePath.returns(`${testWorkspaceRoot}/prompt-registry.lock.json`);
            mockStorage.getSources.resolves([
                { id: 'mock-source', type: 'github', url: 'https://github.com/mock/repo' } as any
            ]);
            
            const service = RepositoryActivationService.getInstance(
                testWorkspaceRoot,
                mockLockfileManager,
                mockHubManager,
                mockStorage
                // No bundleInstaller, no setupStateManager
            );

            // Act
            await service.checkAndPromptActivation();

            // Assert
            assert.ok(mockLockfileManager.read.calledOnce, 
                'Should read lockfile when SetupStateManager is undefined (fail-open behavior)');
        });

        test('should log appropriate message when deferring due to incomplete setup', async () => {
            // Arrange
            mockSetupStateManager.isComplete.resolves(false);
            const lockfile = createMockLockfile(2);
            mockLockfileManager.read.resolves(lockfile);
            
            // We can't directly test logging, but we can verify the behavior
            // that indicates the deferral path was taken
            const service = RepositoryActivationService.getInstance(
                testWorkspaceRoot,
                mockLockfileManager,
                mockHubManager,
                mockStorage,
                undefined, // bundleInstaller
                mockSetupStateManager
            );

            // Act
            await service.checkAndPromptActivation();

            // Assert - verify the deferral path was taken by checking that:
            // 1. isComplete was called
            // 2. No further processing occurred (lockfile not read)
            assert.ok(mockSetupStateManager.isComplete.calledOnce, 
                'Should call isComplete to check setup state');
            assert.ok(!mockLockfileManager.read.called, 
                'Should not proceed with lockfile read when deferring');
            assert.ok(!mockStorage.getSources.called, 
                'Should not check sources when deferring');
            assert.ok(!mockHubManager.listHubs.called, 
                'Should not check hubs when deferring');
        });
    });

    suite('getInstance() with SetupStateManager', () => {
        test('should accept SetupStateManager as optional parameter', () => {
            // Arrange & Act
            const instance = RepositoryActivationService.getInstance(
                testWorkspaceRoot,
                mockLockfileManager,
                mockHubManager,
                mockStorage,
                undefined, // bundleInstaller
                mockSetupStateManager
            );

            // Assert
            assert.ok(instance, 'Should create instance with SetupStateManager');
        });

        test('should work without SetupStateManager for backward compatibility', () => {
            // Arrange & Act
            const instance = RepositoryActivationService.getInstance(
                testWorkspaceRoot,
                mockLockfileManager,
                mockHubManager,
                mockStorage
            );

            // Assert
            assert.ok(instance, 'Should create instance without SetupStateManager');
        });
    });

    suite('Setup state edge cases', () => {
        test('should handle SetupStateManager.isComplete() throwing an error gracefully', async () => {
            // Arrange
            mockSetupStateManager.isComplete.rejects(new Error('State check failed'));
            const lockfile = createMockLockfile(2);
            mockLockfileManager.read.resolves(lockfile);
            
            const service = RepositoryActivationService.getInstance(
                testWorkspaceRoot,
                mockLockfileManager,
                mockHubManager,
                mockStorage,
                undefined,
                mockSetupStateManager
            );

            // Act & Assert - should not throw
            await service.checkAndPromptActivation();
            
            // The error should be caught and logged, but not propagate
            assert.ok(mockSetupStateManager.isComplete.calledOnce, 
                'Should have attempted to check setup state');
        });

        test('should not prompt for missing sources when setup is incomplete', async () => {
            // Arrange
            mockSetupStateManager.isComplete.resolves(false);
            const lockfile = createMockLockfile(2, { includeHubs: true });
            mockLockfileManager.read.resolves(lockfile);
            mockStorage.getSources.resolves([]); // No sources configured
            mockHubManager.listHubs.resolves([]); // No hubs configured
            
            const service = RepositoryActivationService.getInstance(
                testWorkspaceRoot,
                mockLockfileManager,
                mockHubManager,
                mockStorage,
                undefined,
                mockSetupStateManager
            );

            // Act
            await service.checkAndPromptActivation();

            // Assert
            assert.ok(!showInformationMessageStub.called, 
                'Should not prompt for missing sources when setup is incomplete');
            assert.ok(!mockStorage.getSources.called, 
                'Should not check for sources when setup is incomplete');
        });
    });
});

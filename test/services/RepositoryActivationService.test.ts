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
            showInformationMessageStub.resolves('Enable');

            // Act
            await service.checkAndPromptActivation();

            // Assert
            assert.ok(showInformationMessageStub.calledOnce, 'Should show activation prompt');
        });

        test('should show bundle count in prompt message', async () => {
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
            showInformationMessageStub.resolves('Enable');

            // Act
            await service.checkAndPromptActivation();

            // Assert
            const message = showInformationMessageStub.firstCall.args[0] as string;
            assert.ok(message.includes('3'), 'Message should include bundle count');
        });

        test('should show profile count in prompt message when profiles exist', async () => {
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
            showInformationMessageStub.resolves('Enable');

            // Act
            await service.checkAndPromptActivation();

            // Assert
            const message = showInformationMessageStub.firstCall.args[0] as string;
            assert.ok(message.includes('profile') || message.includes('Profile'), 
                'Message should mention profiles');
        });

        test('should call enableRepositoryBundles when user accepts', async () => {
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
            showInformationMessageStub.resolves('Enable');
            const enableSpy = sandbox.spy(service, 'enableRepositoryBundles');

            // Act
            await service.checkAndPromptActivation();

            // Assert
            assert.ok(enableSpy.calledOnce, 'Should call enableRepositoryBundles');
            assert.ok(enableSpy.calledWith(lockfile), 'Should pass lockfile to enable method');
        });

        test('should remember declined when user selects "Don\'t ask again"', async () => {
            // Arrange
            const lockfile = createMockLockfile(2);
            mockLockfileManager.read.resolves(lockfile);
            mockLockfileManager.getLockfilePath.returns('/repo/prompt-registry.lock.json');
            const updateStub = sandbox.stub().resolves();
            const customContext = {
                globalState: {
                    get: sandbox.stub().returns([]),
                    update: updateStub
                }
            } as any;
            mockStorage.getContext.returns(customContext);
            showInformationMessageStub.resolves('Don\'t ask again');

            // Act
            await service.checkAndPromptActivation();

            // Assert
            assert.ok(updateStub.calledOnce, 'Should update global state');
            const updateCall = updateStub.firstCall;
            assert.strictEqual(updateCall.args[0], 'repositoryActivation.declined');
            assert.ok(Array.isArray(updateCall.args[1]), 'Should store array of declined repos');
        });

        test('should not enable bundles when user declines', async () => {
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
            showInformationMessageStub.resolves('Not now');
            const enableSpy = sandbox.spy(service, 'enableRepositoryBundles');

            // Act
            await service.checkAndPromptActivation();

            // Assert
            assert.ok(!enableSpy.called, 'Should not enable bundles when declined');
        });

        test('should not enable bundles when user dismisses prompt', async () => {
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
            showInformationMessageStub.resolves(undefined); // User dismissed
            const enableSpy = sandbox.spy(service, 'enableRepositoryBundles');

            // Act
            await service.checkAndPromptActivation();

            // Assert
            assert.ok(!enableSpy.called, 'Should not enable bundles when dismissed');
        });
    });

    suite('showActivationPrompt()', () => {
        test('should return "enable" when user clicks Enable', async () => {
            // Arrange
            const lockfile = createMockLockfile(2);
            showInformationMessageStub.resolves('Enable');

            // Act
            const result = await service.showActivationPrompt(lockfile);

            // Assert
            assert.strictEqual(result, 'enable');
        });

        test('should return "decline" when user clicks Not now', async () => {
            // Arrange
            const lockfile = createMockLockfile(2);
            showInformationMessageStub.resolves('Not now');

            // Act
            const result = await service.showActivationPrompt(lockfile);

            // Assert
            assert.strictEqual(result, 'decline');
        });

        test('should return "never" when user clicks Don\'t ask again', async () => {
            // Arrange
            const lockfile = createMockLockfile(2);
            showInformationMessageStub.resolves('Don\'t ask again');

            // Act
            const result = await service.showActivationPrompt(lockfile);

            // Assert
            assert.strictEqual(result, 'never');
        });

        test('should return "decline" when user dismisses prompt', async () => {
            // Arrange
            const lockfile = createMockLockfile(2);
            showInformationMessageStub.resolves(undefined);

            // Act
            const result = await service.showActivationPrompt(lockfile);

            // Assert
            assert.strictEqual(result, 'decline');
        });

        test('should show three action buttons: Enable, Not now, Don\'t ask again', async () => {
            // Arrange
            const lockfile = createMockLockfile(2);
            showInformationMessageStub.resolves('Enable');

            // Act
            await service.showActivationPrompt(lockfile);

            // Assert
            const callArgs = showInformationMessageStub.firstCall.args;
            const buttons = callArgs.slice(1); // Skip message, get buttons
            assert.strictEqual(buttons.length, 3, 'Should have exactly 3 buttons');
            assert.ok(buttons.includes('Enable'), 'Should have Enable button');
            assert.ok(buttons.includes('Not now'), 'Should have Not now button');
            assert.ok(buttons.includes('Don\'t ask again'), 'Should have Don\'t ask again button');
        });

        test('should include bundle count in message', async () => {
            // Arrange
            const lockfile = createMockLockfile(5);
            showInformationMessageStub.resolves('Enable');

            // Act
            await service.showActivationPrompt(lockfile);

            // Assert
            const message = showInformationMessageStub.firstCall.args[0] as string;
            assert.ok(message.includes('5'), 'Should include bundle count');
        });

        test('should mention profiles when lockfile has profiles', async () => {
            // Arrange
            const lockfile = createMockLockfile(2, { includeProfiles: true });
            showInformationMessageStub.resolves('Enable');

            // Act
            await service.showActivationPrompt(lockfile);

            // Assert
            const message = showInformationMessageStub.firstCall.args[0] as string;
            assert.ok(message.toLowerCase().includes('profile'), 'Should mention profiles');
        });
    });

    suite('enableRepositoryBundles()', () => {
        test('should verify all bundles are installed', async () => {
            // Arrange
            const lockfile = createMockLockfile(2);
            mockStorage.getInstalledBundles.resolves([]);

            // Act
            await service.enableRepositoryBundles(lockfile);

            // Assert
            assert.ok(mockStorage.getInstalledBundles.calledOnce, 
                'Should check installed bundles');
        });

        test('should offer to install missing bundles', async () => {
            // Arrange
            const lockfile = createMockLockfile(2);
            mockStorage.getInstalledBundles.resolves([]); // No bundles installed
            showInformationMessageStub.resolves('Install');

            // Act
            await service.enableRepositoryBundles(lockfile);

            // Assert
            assert.ok(showInformationMessageStub.calledOnce, 
                'Should prompt to install missing bundles');
            const message = showInformationMessageStub.firstCall.args[0] as string;
            assert.ok(message.toLowerCase().includes('missing') || message.toLowerCase().includes('install'),
                'Message should mention missing bundles');
        });

        test('should not prompt when all bundles are installed', async () => {
            // Arrange
            const lockfile = createMockLockfile(2);
            mockStorage.getInstalledBundles.resolves([
                { bundleId: 'bundle-0', scope: 'repository' } as any,
                { bundleId: 'bundle-1', scope: 'repository' } as any
            ]);

            // Act
            await service.enableRepositoryBundles(lockfile);

            // Assert
            assert.ok(!showInformationMessageStub.called, 
                'Should not prompt when all bundles installed');
        });

        test('should check for missing sources and hubs', async () => {
            // Arrange
            const lockfile = createMockLockfile(2, { includeHubs: true });
            mockStorage.getInstalledBundles.resolves([
                { bundleId: 'bundle-0', scope: 'repository' } as any,
                { bundleId: 'bundle-1', scope: 'repository' } as any
            ]);
            const checkSpy = sandbox.spy(service, 'checkAndOfferMissingSources');

            // Act
            await service.enableRepositoryBundles(lockfile);

            // Assert
            assert.ok(checkSpy.calledOnce, 'Should check for missing sources/hubs');
            assert.ok(checkSpy.calledWith(lockfile), 'Should pass lockfile to check method');
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

    suite('rememberDeclined()', () => {
        test('should store repository path in global state', async () => {
            // Arrange
            const repositoryPath = '/path/to/repo';
            const updateStub = sandbox.stub().resolves();
            const customContext = {
                globalState: {
                    get: sandbox.stub().returns([]),
                    update: updateStub
                }
            } as any;
            mockStorage.getContext.returns(customContext);

            // Act
            await service.rememberDeclined(repositoryPath);

            // Assert
            assert.ok(updateStub.calledOnce, 'Should update global state');
            assert.strictEqual(updateStub.firstCall.args[0], 'repositoryActivation.declined');
            const declinedList = updateStub.firstCall.args[1] as string[];
            assert.ok(declinedList.includes(repositoryPath), 
                'Should include repository path in declined list');
        });

        test('should not duplicate repository paths', async () => {
            // Arrange
            const repositoryPath = '/path/to/repo';
            const updateStub = sandbox.stub().resolves();
            const customContext = {
                globalState: {
                    get: sandbox.stub().returns([repositoryPath]), // Already declined
                    update: updateStub
                }
            } as any;
            mockStorage.getContext.returns(customContext);

            // Act
            await service.rememberDeclined(repositoryPath);

            // Assert - should NOT call update since path already exists
            assert.ok(!updateStub.called, 'Should not update when path already exists');
        });

        test('should preserve existing declined repositories', async () => {
            // Arrange
            const existingPath = '/existing/repo';
            const newPath = '/new/repo';
            const updateStub = sandbox.stub().resolves();
            const customContext = {
                globalState: {
                    get: sandbox.stub().returns([existingPath]),
                    update: updateStub
                }
            } as any;
            mockStorage.getContext.returns(customContext);

            // Act
            await service.rememberDeclined(newPath);

            // Assert
            const declinedList = updateStub.firstCall.args[1] as string[];
            assert.ok(declinedList.includes(existingPath), 
                'Should preserve existing declined repository');
            assert.ok(declinedList.includes(newPath), 
                'Should add new declined repository');
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

            // Act
            await service.checkAndPromptActivation();

            // Assert - should still prompt even with 0 bundles
            assert.ok(showInformationMessageStub.calledOnce, 
                'Should prompt even with empty lockfile');
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

        test('should handle storage errors when checking installed bundles', async () => {
            // Arrange
            const lockfile = createMockLockfile(2);
            mockStorage.getInstalledBundles.rejects(new Error('Storage error'));

            // Act & Assert - should not throw
            await service.enableRepositoryBundles(lockfile);
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

    test('should allow independent activation prompts per workspace', async () => {
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

        // Assert - both should have prompted
        assert.strictEqual(showInformationMessageStub.callCount, 2, 
            'Should prompt for both workspaces');
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

    suite('enableRepositoryBundles() with actual installation', () => {
        test('should call installMissingBundles when user chooses to install', async () => {
            // Arrange
            const lockfile = createMockLockfile(2);
            mockStorage.getInstalledBundles.resolves([]); // No bundles installed
            showInformationMessageStub.resolves('Install');
            
            service = RepositoryActivationService.getInstance(
                testWorkspaceRoot,
                mockLockfileManager,
                mockHubManager,
                mockStorage,
                mockRegistryManager
            );
            
            const installSpy = sandbox.spy(service, 'installMissingBundles');

            // Act
            await service.enableRepositoryBundles(lockfile);

            // Assert
            assert.ok(installSpy.calledOnce, 'Should call installMissingBundles');
            assert.ok(installSpy.calledWith(lockfile, sinon.match.array), 
                'Should pass lockfile and missing bundle IDs');
        });

        test('should not call installMissingBundles when user skips', async () => {
            // Arrange
            const lockfile = createMockLockfile(2);
            mockStorage.getInstalledBundles.resolves([]); // No bundles installed
            showInformationMessageStub.resolves('Skip');
            
            service = RepositoryActivationService.getInstance(
                testWorkspaceRoot,
                mockLockfileManager,
                mockHubManager,
                mockStorage,
                mockRegistryManager
            );
            
            const installSpy = sandbox.spy(service, 'installMissingBundles');

            // Act
            await service.enableRepositoryBundles(lockfile);

            // Assert
            assert.ok(!installSpy.called, 'Should not call installMissingBundles when user skips');
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

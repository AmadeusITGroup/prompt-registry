/**
 * Extension Activation Integration Tests
 * 
 * Tests for extension activation flow including lockfile detection
 * and repository activation prompt.
 * 
 * Requirements: 5.1, 13.1
 */

import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { createE2ETestContext, E2ETestContext } from '../helpers/e2eTestHelpers';
import { LockfileManager } from '../../src/services/LockfileManager';
import { RepositoryActivationService } from '../../src/services/RepositoryActivationService';
import { HubManager } from '../../src/services/HubManager';

suite('Extension Activation Integration', () => {
    let sandbox: sinon.SinonSandbox;
    let testContext: E2ETestContext;
    let mockWorkspaceFolders: vscode.WorkspaceFolder[] | undefined;
    let lockfilePath: string;
    let mockHubManager: sinon.SinonStubbedInstance<HubManager>;

    const writeLockfile = (lockfile: any): void => {
        fs.writeFileSync(lockfilePath, JSON.stringify(lockfile, null, 2));
    };

    setup(async function() {
        this.timeout(30000);
        sandbox = sinon.createSandbox();
        
        // Create E2E test context with isolated temp directory
        testContext = await createE2ETestContext();
        lockfilePath = path.join(testContext.tempStoragePath, 'prompt-registry.lock.json');

        // Setup workspace folders pointing to temp directory
        mockWorkspaceFolders = [{
            uri: vscode.Uri.file(testContext.tempStoragePath),
            name: 'test-workspace',
            index: 0
        }];
        sandbox.stub(vscode.workspace, 'workspaceFolders').get(() => mockWorkspaceFolders);

        // Create mock HubManager
        mockHubManager = sandbox.createStubInstance(HubManager);

        // Reset singletons for each test
        LockfileManager.resetInstance();
        RepositoryActivationService.resetInstance();
    });

    teardown(async function() {
        this.timeout(10000);
        sandbox.restore();
        LockfileManager.resetInstance();
        RepositoryActivationService.resetInstance();
        await testContext.cleanup();
    });

    suite('Lockfile Detection on Activation', () => {
        /**
         * Requirement 5.1: WHEN a workspace is opened, THE Extension SHALL check for
         * `prompt-registry.lock.json` at the repository root
         */
        test('should detect lockfile when workspace is opened', async () => {
            // Arrange
            const mockLockfile = {
                $schema: 'https://example.com/lockfile.schema.json',
                version: '1.0.0',
                generatedAt: new Date().toISOString(),
                generatedBy: 'prompt-registry@1.0.0',
                bundles: {
                    'test-bundle': {
                        version: '1.0.0',
                        sourceId: 'test-source',
                        sourceType: 'github',
                        installedAt: new Date().toISOString(),
                        commitMode: 'commit' as const,
                        files: []
                    }
                },
                sources: {
                    'test-source': {
                        type: 'github',
                        url: 'https://github.com/test/repo'
                    }
                }
            };

            // Write lockfile to temp directory
            writeLockfile(mockLockfile);

            // Act
            const lockfileManager = LockfileManager.getInstance(testContext.tempStoragePath);
            const lockfile = await lockfileManager.read();

            // Assert
            assert.ok(lockfile, 'Lockfile should be detected');
            assert.strictEqual(lockfile?.version, '1.0.0');
            assert.ok(lockfile?.bundles['test-bundle'], 'Bundle should be in lockfile');
        });

        /**
         * Requirement 5.1: WHEN a workspace is opened, THE Extension SHALL check for
         * `prompt-registry.lock.json` at the repository root
         */
        test('should handle missing lockfile gracefully', async () => {
            // Arrange - no lockfile written

            // Act
            const lockfileManager = LockfileManager.getInstance(testContext.tempStoragePath);
            const lockfile = await lockfileManager.read();

            // Assert
            assert.strictEqual(lockfile, null, 'Should return null when lockfile does not exist');
        });

        /**
         * Requirement 5.1: WHEN a workspace is opened, THE Extension SHALL check for
         * `prompt-registry.lock.json` at the repository root
         */
        test('should not check for lockfile when no workspace is open', async () => {
            // Arrange
            mockWorkspaceFolders = undefined;

            // Act
            const lockfileManager = LockfileManager.getInstance(testContext.tempStoragePath);
            const lockfile = await lockfileManager.read();

            // Assert
            assert.strictEqual(lockfile, null, 'Should return null when no workspace is open');
        });
    });

    suite('Activation Prompt Flow', () => {
        /**
         * Requirement 13.1: WHEN a workspace with a lockfile is opened for the first time,
         * THE Extension SHALL display a notification asking if the user wants to enable
         * repository bundles
         */
        test('should show activation prompt when lockfile is detected', async () => {
            // Arrange
            const mockLockfile = {
                $schema: 'https://example.com/lockfile.schema.json',
                version: '1.0.0',
                generatedAt: new Date().toISOString(),
                generatedBy: 'prompt-registry@1.0.0',
                bundles: {
                    'test-bundle': {
                        version: '1.0.0',
                        sourceId: 'test-source',
                        sourceType: 'github',
                        installedAt: new Date().toISOString(),
                        commitMode: 'commit' as const,
                        files: []
                    }
                },
                sources: {
                    'test-source': {
                        type: 'github',
                        url: 'https://github.com/test/repo'
                    }
                }
            };

            // Write lockfile to temp directory
            writeLockfile(mockLockfile);

            // Mock notification
            const mockShowInformationMessage = sandbox.stub(vscode.window, 'showInformationMessage');
            mockShowInformationMessage.resolves('Enable' as any);

            // Act
            const lockfileManager = LockfileManager.getInstance(testContext.tempStoragePath);
            
            const activationService = RepositoryActivationService.getInstance(
                testContext.tempStoragePath,
                lockfileManager,
                mockHubManager,
                testContext.storage
            );
            await activationService.checkAndPromptActivation();

            // Assert
            assert.ok(mockShowInformationMessage.called, 'Should show activation prompt');
            const callArgs = mockShowInformationMessage.firstCall.args;
            assert.ok(callArgs[0].includes('1 bundle'), 'Should mention bundle count');
        });

        /**
         * Requirement 13.1: WHEN a workspace with a lockfile is opened for the first time,
         * THE Extension SHALL display a notification
         * 
         * Requirement 13.4: WHEN the user declines, THE Extension SHALL remember the choice
         * and not prompt again for this repository
         */
        test('should not show prompt if previously declined', async () => {
            // Arrange
            const workspacePath = testContext.tempStoragePath;
            // Implementation uses array-based tracking: repositoryActivation.declined = [path1, path2, ...]
            await testContext.mockContext.globalState.update('repositoryActivation.declined', [workspacePath]);

            const mockLockfile = {
                $schema: 'https://example.com/lockfile.schema.json',
                version: '1.0.0',
                generatedAt: new Date().toISOString(),
                generatedBy: 'prompt-registry@1.0.0',
                bundles: {},
                sources: {}
            };

            // Write lockfile to temp directory
            writeLockfile(mockLockfile);

            // Mock notification
            const mockShowInformationMessage = sandbox.stub(vscode.window, 'showInformationMessage');

            // Act
            const lockfileManager = LockfileManager.getInstance(testContext.tempStoragePath);
            const activationService = RepositoryActivationService.getInstance(
                testContext.tempStoragePath,
                lockfileManager,
                mockHubManager,
                testContext.storage
            );
            await activationService.checkAndPromptActivation();

            // Assert
            assert.ok(mockShowInformationMessage.notCalled, 'Should not show prompt if previously declined');
        });

        /**
         * Requirement 13.1: WHEN a workspace with a lockfile is opened for the first time,
         * THE Extension SHALL display a notification
         */
        test('should not show prompt when no lockfile exists', async () => {
            // Arrange - no lockfile written

            // Mock notification
            const mockShowInformationMessage = sandbox.stub(vscode.window, 'showInformationMessage');

            // Act
            const lockfileManager = LockfileManager.getInstance(testContext.tempStoragePath);
            const activationService = RepositoryActivationService.getInstance(
                testContext.tempStoragePath,
                lockfileManager,
                mockHubManager,
                testContext.storage
            );
            await activationService.checkAndPromptActivation();

            // Assert
            assert.ok(mockShowInformationMessage.notCalled, 'Should not show prompt when no lockfile exists');
        });

        /**
         * Requirement 13.5: THE Extension SHALL provide a "Don't ask again" option
         * in the notification
         */
        test('should remember "Don\'t ask again" choice', async () => {
            // Arrange
            const mockLockfile = {
                $schema: 'https://example.com/lockfile.schema.json',
                version: '1.0.0',
                generatedAt: new Date().toISOString(),
                generatedBy: 'prompt-registry@1.0.0',
                bundles: {},
                sources: {}
            };

            // Write lockfile to temp directory
            writeLockfile(mockLockfile);

            // Mock notification - user selects "Don't ask again"
            const mockShowInformationMessage = sandbox.stub(vscode.window, 'showInformationMessage');
            mockShowInformationMessage.resolves("Don't ask again" as any);

            // Act
            const lockfileManager = LockfileManager.getInstance(testContext.tempStoragePath);
            const activationService = RepositoryActivationService.getInstance(
                testContext.tempStoragePath,
                lockfileManager,
                mockHubManager,
                testContext.storage
            );
            await activationService.checkAndPromptActivation();

            // Assert
            const workspacePath = testContext.tempStoragePath;
            // Implementation uses array-based tracking: repositoryActivation.declined = [path1, path2, ...]
            const declined = testContext.mockContext.globalState.get<string[]>('repositoryActivation.declined', []);
            assert.ok(declined.includes(workspacePath), 'Should remember declined choice in array');
        });
    });
});

/**
 * Contextual Menu Commands Integration Tests
 * 
 * Tests for contextual menu command invocations with tree items
 * Validates requirements 1.1-1.5, 2.1-2.5, 3.1-3.5, 4.1-4.5, 5.1-5.6
 */

import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { SourceCommands } from '../../src/commands/SourceCommands';
import { RegistryManager } from '../../src/services/RegistryManager';
import { RegistryTreeItem, TreeItemType } from '../../src/ui/RegistryTreeProvider';
import { RegistrySource } from '../../src/types/registry';

describe('Contextual Menu Commands Integration Tests', () => {
    let sourceCommands: SourceCommands;
    let mockRegistryManager: any;
    let showQuickPickStub: sinon.SinonStub;
    let showInputBoxStub: sinon.SinonStub;
    let showWarningMessageStub: sinon.SinonStub;
    let showInformationMessageStub: sinon.SinonStub;
    let withProgressStub: sinon.SinonStub;

    const mockSource: RegistrySource = {
        id: 'test-source',
        name: 'Test Source',
        type: 'github',
        url: 'https://github.com/test/repo',
        enabled: true,
        priority: 10,
        private: false,
        metadata: {}
    };

    beforeEach(() => {
        // Create mock RegistryManager
        mockRegistryManager = {
            listSources: sinon.stub().resolves([mockSource]),
            updateSource: sinon.stub().resolves(),
            removeSource: sinon.stub().resolves(),
            syncSource: sinon.stub().resolves()
        };

        sourceCommands = new SourceCommands(mockRegistryManager);

        // Stub VS Code UI methods
        showQuickPickStub = sinon.stub(vscode.window, 'showQuickPick');
        showInputBoxStub = sinon.stub(vscode.window, 'showInputBox');
        showWarningMessageStub = sinon.stub(vscode.window, 'showWarningMessage');
        showInformationMessageStub = sinon.stub(vscode.window, 'showInformationMessage');
        withProgressStub = sinon.stub(vscode.window, 'withProgress');
    });

    afterEach(() => {
        sinon.restore();
    });

    describe('Edit Source - Right-Click Flow', () => {
        it('should skip picker when tree item is provided (Req 1.1, 1.2, 5.5)', async () => {
            // Create tree item with source data
            const treeItem = new RegistryTreeItem(
                'Test Source',
                TreeItemType.SOURCE,
                mockSource
            );

            // Mock the edit options picker
            showQuickPickStub.resolves({ label: '$(edit) Rename', value: 'rename' });
            showInputBoxStub.resolves('New Name');

            await sourceCommands.editSource(treeItem);

            // Verify picker was NOT called for source selection
            assert.strictEqual(showQuickPickStub.callCount, 1, 'Should only show edit options picker');
            
            // Verify the first call was for edit options, not source selection
            const firstCall = showQuickPickStub.getCall(0);
            assert.ok(firstCall.args[0][0].label.includes('Rename'), 'First picker should be edit options');

            // Verify updateSource was called with correct ID
            assert.ok(mockRegistryManager.updateSource.calledWith('test-source'));
        });

        it('should show picker when undefined is provided (Req 1.4, 5.6)', async () => {
            // Mock source selection picker
            showQuickPickStub.onFirstCall().resolves({
                label: '✓ Test Source',
                source: mockSource
            });
            
            // Mock edit options picker
            showQuickPickStub.onSecondCall().resolves({ label: '$(edit) Rename', value: 'rename' });
            showInputBoxStub.resolves('New Name');

            await sourceCommands.editSource(undefined);

            // Verify picker WAS called for source selection
            assert.strictEqual(showQuickPickStub.callCount, 2, 'Should show both source and edit options pickers');
            
            // Verify first call was for source selection
            const firstCall = showQuickPickStub.getCall(0);
            assert.ok(firstCall.args[1].placeHolder.includes('Select source to edit'));
        });

        it('should handle string ID parameter (Req 1.3)', async () => {
            // Mock edit options picker
            showQuickPickStub.resolves({ label: '$(edit) Rename', value: 'rename' });
            showInputBoxStub.resolves('New Name');

            await sourceCommands.editSource('test-source');

            // Verify picker was NOT called for source selection
            assert.strictEqual(showQuickPickStub.callCount, 1, 'Should only show edit options picker');
            
            // Verify updateSource was called with correct ID
            assert.ok(mockRegistryManager.updateSource.calledWith('test-source'));
        });
    });

    describe('Remove Source - Right-Click Flow', () => {
        it('should skip picker when tree item is provided (Req 2.1, 2.2, 5.5)', async () => {
            const treeItem = new RegistryTreeItem(
                'Test Source',
                TreeItemType.SOURCE,
                mockSource
            );

            // Mock confirmation dialog
            showWarningMessageStub.resolves('Remove');

            await sourceCommands.removeSource(treeItem);

            // Verify picker was NOT called
            assert.strictEqual(showQuickPickStub.callCount, 0, 'Should not show source picker');
            
            // Verify confirmation was shown
            assert.ok(showWarningMessageStub.calledOnce);
            
            // Verify removeSource was called with correct ID
            assert.ok(mockRegistryManager.removeSource.calledWith('test-source'));
        });

        it('should show picker when undefined is provided (Req 2.4, 5.6)', async () => {
            // Mock source selection picker
            showQuickPickStub.resolves({
                label: 'Test Source',
                source: mockSource
            });
            
            // Mock confirmation dialog
            showWarningMessageStub.resolves('Remove');

            await sourceCommands.removeSource(undefined);

            // Verify picker WAS called
            assert.strictEqual(showQuickPickStub.callCount, 1, 'Should show source picker');
            
            // Verify it was for source selection
            const firstCall = showQuickPickStub.getCall(0);
            assert.ok(firstCall.args[1].placeHolder.includes('Select source to remove'));
        });

        it('should handle string ID parameter (Req 2.3)', async () => {
            // Mock confirmation dialog
            showWarningMessageStub.resolves('Remove');

            await sourceCommands.removeSource('test-source');

            // Verify picker was NOT called
            assert.strictEqual(showQuickPickStub.callCount, 0);
            
            // Verify removeSource was called with correct ID
            assert.ok(mockRegistryManager.removeSource.calledWith('test-source'));
        });
    });

    describe('Sync Source - Right-Click Flow', () => {
        it('should skip picker when tree item is provided (Req 3.1, 3.2, 5.5)', async () => {
            const treeItem = new RegistryTreeItem(
                'Test Source',
                TreeItemType.SOURCE,
                mockSource
            );

            // Mock progress dialog
            withProgressStub.callsFake(async (options, task) => {
                return await task();
            });

            await sourceCommands.syncSource(treeItem);

            // Verify picker was NOT called
            assert.strictEqual(showQuickPickStub.callCount, 0, 'Should not show source picker');
            
            // Verify syncSource was called with correct ID
            assert.ok(mockRegistryManager.syncSource.calledWith('test-source'));
        });

        it('should show picker when undefined is provided (Req 3.4, 5.6)', async () => {
            // Mock source selection picker
            showQuickPickStub.resolves({
                label: 'Test Source',
                source: mockSource
            });
            
            // Mock progress dialog
            withProgressStub.callsFake(async (options, task) => {
                return await task();
            });

            await sourceCommands.syncSource(undefined);

            // Verify picker WAS called
            assert.strictEqual(showQuickPickStub.callCount, 1, 'Should show source picker');
            
            // Verify it was for source selection
            const firstCall = showQuickPickStub.getCall(0);
            assert.ok(firstCall.args[1].placeHolder.includes('Select source to sync'));
        });

        it('should handle string ID parameter (Req 3.3)', async () => {
            // Mock progress dialog
            withProgressStub.callsFake(async (options, task) => {
                return await task();
            });

            await sourceCommands.syncSource('test-source');

            // Verify picker was NOT called
            assert.strictEqual(showQuickPickStub.callCount, 0);
            
            // Verify syncSource was called with correct ID
            assert.ok(mockRegistryManager.syncSource.calledWith('test-source'));
        });
    });

    describe('Toggle Source - Right-Click Flow', () => {
        it('should skip picker when tree item is provided (Req 4.1, 4.2, 5.5)', async () => {
            const treeItem = new RegistryTreeItem(
                'Test Source',
                TreeItemType.SOURCE,
                mockSource
            );

            await sourceCommands.toggleSource(treeItem);

            // Verify picker was NOT called
            assert.strictEqual(showQuickPickStub.callCount, 0, 'Should not show source picker');
            
            // Verify updateSource was called with correct ID and toggled state
            assert.ok(mockRegistryManager.updateSource.calledWith('test-source', { enabled: false }));
        });

        it('should show picker when undefined is provided (Req 4.4, 5.6)', async () => {
            // Mock source selection picker
            showQuickPickStub.resolves({
                label: '✓ Test Source',
                source: mockSource
            });

            await sourceCommands.toggleSource(undefined);

            // Verify picker WAS called
            assert.strictEqual(showQuickPickStub.callCount, 1, 'Should show source picker');
            
            // Verify it was for source selection
            const firstCall = showQuickPickStub.getCall(0);
            assert.ok(firstCall.args[1].placeHolder.includes('Select source to toggle'));
        });

        it('should handle string ID parameter (Req 4.3)', async () => {
            await sourceCommands.toggleSource('test-source');

            // Verify picker was NOT called
            assert.strictEqual(showQuickPickStub.callCount, 0);
            
            // Verify updateSource was called with correct ID
            assert.ok(mockRegistryManager.updateSource.calledWith('test-source'));
        });
    });

    describe('Contextual Menu Equivalence (Req 5.7-5.10)', () => {
        it('edit command: contextual menu === command palette (Req 5.7)', async () => {
            const treeItem = new RegistryTreeItem(
                'Test Source',
                TreeItemType.SOURCE,
                mockSource
            );

            // Mock edit options picker
            showQuickPickStub.resolves({ label: '$(edit) Rename', value: 'rename' });
            showInputBoxStub.resolves('New Name');

            // Execute via tree item
            await sourceCommands.editSource(treeItem);
            const treeItemCalls = mockRegistryManager.updateSource.getCalls();

            // Reset stubs
            mockRegistryManager.updateSource.resetHistory();
            showQuickPickStub.reset();
            showInputBoxStub.reset();

            // Mock source selection for command palette flow
            showQuickPickStub.onFirstCall().resolves({
                label: '✓ Test Source',
                source: mockSource
            });
            showQuickPickStub.onSecondCall().resolves({ label: '$(edit) Rename', value: 'rename' });
            showInputBoxStub.resolves('New Name');

            // Execute via command palette (undefined)
            await sourceCommands.editSource(undefined);
            const commandPaletteCalls = mockRegistryManager.updateSource.getCalls();

            // Verify both flows called updateSource with same arguments
            assert.strictEqual(treeItemCalls.length, 1);
            assert.strictEqual(commandPaletteCalls.length, 1);
            assert.deepStrictEqual(treeItemCalls[0].args, commandPaletteCalls[0].args);
        });

        it('remove command: contextual menu === command palette (Req 5.8)', async () => {
            const treeItem = new RegistryTreeItem(
                'Test Source',
                TreeItemType.SOURCE,
                mockSource
            );

            // Mock confirmation dialog
            showWarningMessageStub.resolves('Remove');

            // Execute via tree item
            await sourceCommands.removeSource(treeItem);
            const treeItemCalls = mockRegistryManager.removeSource.getCalls();

            // Reset stubs
            mockRegistryManager.removeSource.resetHistory();
            showQuickPickStub.reset();
            showWarningMessageStub.reset();

            // Mock source selection for command palette flow
            showQuickPickStub.resolves({
                label: 'Test Source',
                source: mockSource
            });
            showWarningMessageStub.resolves('Remove');

            // Execute via command palette (undefined)
            await sourceCommands.removeSource(undefined);
            const commandPaletteCalls = mockRegistryManager.removeSource.getCalls();

            // Verify both flows called removeSource with same arguments
            assert.strictEqual(treeItemCalls.length, 1);
            assert.strictEqual(commandPaletteCalls.length, 1);
            assert.deepStrictEqual(treeItemCalls[0].args, commandPaletteCalls[0].args);
        });

        it('sync command: contextual menu === command palette (Req 5.9)', async () => {
            const treeItem = new RegistryTreeItem(
                'Test Source',
                TreeItemType.SOURCE,
                mockSource
            );

            // Mock progress dialog
            withProgressStub.callsFake(async (options, task) => {
                return await task();
            });

            // Execute via tree item
            await sourceCommands.syncSource(treeItem);
            const treeItemCalls = mockRegistryManager.syncSource.getCalls();

            // Reset stubs
            mockRegistryManager.syncSource.resetHistory();
            showQuickPickStub.reset();

            // Mock source selection for command palette flow
            showQuickPickStub.resolves({
                label: 'Test Source',
                source: mockSource
            });

            // Execute via command palette (undefined)
            await sourceCommands.syncSource(undefined);
            const commandPaletteCalls = mockRegistryManager.syncSource.getCalls();

            // Verify both flows called syncSource with same arguments
            assert.strictEqual(treeItemCalls.length, 1);
            assert.strictEqual(commandPaletteCalls.length, 1);
            assert.deepStrictEqual(treeItemCalls[0].args, commandPaletteCalls[0].args);
        });

        it('toggle command: contextual menu === command palette (Req 5.10)', async () => {
            const treeItem = new RegistryTreeItem(
                'Test Source',
                TreeItemType.SOURCE,
                mockSource
            );

            // Execute via tree item
            await sourceCommands.toggleSource(treeItem);
            const treeItemCalls = mockRegistryManager.updateSource.getCalls();

            // Reset stubs
            mockRegistryManager.updateSource.resetHistory();
            showQuickPickStub.reset();

            // Mock source selection for command palette flow
            showQuickPickStub.resolves({
                label: '✓ Test Source',
                source: mockSource
            });

            // Execute via command palette (undefined)
            await sourceCommands.toggleSource(undefined);
            const commandPaletteCalls = mockRegistryManager.updateSource.getCalls();

            // Verify both flows called updateSource with same arguments
            assert.strictEqual(treeItemCalls.length, 1);
            assert.strictEqual(commandPaletteCalls.length, 1);
            assert.deepStrictEqual(treeItemCalls[0].args, commandPaletteCalls[0].args);
        });
    });

    describe('Contextual Menu Source Passing (Req 5.1-5.4)', () => {
        it('should pass correct source for edit command (Req 5.1)', async () => {
            const treeItem = new RegistryTreeItem(
                'Test Source',
                TreeItemType.SOURCE,
                mockSource
            );

            showQuickPickStub.resolves({ label: '$(edit) Rename', value: 'rename' });
            showInputBoxStub.resolves('New Name');

            await sourceCommands.editSource(treeItem);

            // Verify the correct source ID was used
            assert.ok(mockRegistryManager.updateSource.calledWith('test-source'));
        });

        it('should pass correct source for remove command (Req 5.2)', async () => {
            const treeItem = new RegistryTreeItem(
                'Test Source',
                TreeItemType.SOURCE,
                mockSource
            );

            showWarningMessageStub.resolves('Remove');

            await sourceCommands.removeSource(treeItem);

            // Verify the correct source ID was used
            assert.ok(mockRegistryManager.removeSource.calledWith('test-source'));
        });

        it('should pass correct source for sync command (Req 5.3)', async () => {
            const treeItem = new RegistryTreeItem(
                'Test Source',
                TreeItemType.SOURCE,
                mockSource
            );

            withProgressStub.callsFake(async (options, task) => {
                return await task();
            });

            await sourceCommands.syncSource(treeItem);

            // Verify the correct source ID was used
            assert.ok(mockRegistryManager.syncSource.calledWith('test-source'));
        });

        it('should pass correct source for toggle command (Req 5.4)', async () => {
            const treeItem = new RegistryTreeItem(
                'Test Source',
                TreeItemType.SOURCE,
                mockSource
            );

            await sourceCommands.toggleSource(treeItem);

            // Verify the correct source ID was used
            assert.ok(mockRegistryManager.updateSource.calledWith('test-source'));
        });
    });

    describe('Action Execution After Extraction (Req 1.5, 2.5, 3.5, 4.5)', () => {
        it('should execute edit action after extracting from tree item (Req 1.5)', async () => {
            const treeItem = new RegistryTreeItem(
                'Test Source',
                TreeItemType.SOURCE,
                mockSource
            );

            showQuickPickStub.resolves({ label: '$(edit) Rename', value: 'rename' });
            showInputBoxStub.resolves('New Name');

            await sourceCommands.editSource(treeItem);

            // Verify action was executed
            assert.ok(mockRegistryManager.updateSource.calledOnce);
            assert.ok(showInformationMessageStub.calledWith(sinon.match(/renamed/i)));
        });

        it('should execute remove action after extracting from tree item (Req 2.5)', async () => {
            const treeItem = new RegistryTreeItem(
                'Test Source',
                TreeItemType.SOURCE,
                mockSource
            );

            showWarningMessageStub.resolves('Remove');

            await sourceCommands.removeSource(treeItem);

            // Verify action was executed
            assert.ok(mockRegistryManager.removeSource.calledOnce);
            assert.ok(showInformationMessageStub.calledWith(sinon.match(/removed/i)));
        });

        it('should execute sync action after extracting from tree item (Req 3.5)', async () => {
            const treeItem = new RegistryTreeItem(
                'Test Source',
                TreeItemType.SOURCE,
                mockSource
            );

            withProgressStub.callsFake(async (options, task) => {
                return await task();
            });

            await sourceCommands.syncSource(treeItem);

            // Verify action was executed
            assert.ok(mockRegistryManager.syncSource.calledOnce);
            assert.ok(showInformationMessageStub.calledWith(sinon.match(/synced/i)));
        });

        it('should execute toggle action after extracting from tree item (Req 4.5)', async () => {
            const treeItem = new RegistryTreeItem(
                'Test Source',
                TreeItemType.SOURCE,
                mockSource
            );

            await sourceCommands.toggleSource(treeItem);

            // Verify action was executed
            assert.ok(mockRegistryManager.updateSource.calledOnce);
            assert.ok(showInformationMessageStub.calledWith(sinon.match(/(enabled|disabled)/i)));
        });
    });
});

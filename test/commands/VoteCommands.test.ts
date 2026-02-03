import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { VoteCommands, VotableItem } from '../../src/commands/VoteCommands';
import { VoteService, VoteResult } from '../../src/services/engagement/VoteService';

suite('VoteCommands', () => {
    let sandbox: sinon.SinonSandbox;
    let voteCommands: VoteCommands;
    let mockVoteService: sinon.SinonStubbedInstance<VoteService>;
    let showInfoStub: sinon.SinonStub;
    let showErrorStub: sinon.SinonStub;

    const TEST_ITEM: VotableItem = {
        discussionNumber: 42,
        displayName: 'Test Collection'
    };

    const TEST_RESOURCE_ITEM: VotableItem = {
        discussionNumber: 42,
        commentId: 101,
        displayName: 'Test Resource'
    };

    setup(() => {
        sandbox = sinon.createSandbox();
        
        // Create mock VoteService
        mockVoteService = {
            voteOnCollection: sandbox.stub(),
            voteOnResource: sandbox.stub(),
            removeVote: sandbox.stub(),
            getCurrentVote: sandbox.stub(),
            toggleVote: sandbox.stub(),
            getGitHubSession: sandbox.stub()
        } as any;

        voteCommands = new VoteCommands(mockVoteService as any);

        // Mock VS Code window methods
        showInfoStub = sandbox.stub(vscode.window, 'showInformationMessage');
        showErrorStub = sandbox.stub(vscode.window, 'showErrorMessage');
    });

    teardown(() => {
        sandbox.restore();
    });

    suite('voteUpCollection()', () => {
        test('should vote up on collection successfully', async () => {
            mockVoteService.voteOnCollection.resolves({ success: true, reactionId: 123 });

            const result = await voteCommands.voteUpCollection(TEST_ITEM);

            assert.strictEqual(result.success, true);
            assert.ok(mockVoteService.voteOnCollection.calledOnce);
            assert.ok(mockVoteService.voteOnCollection.calledWith(42, '+1', undefined, undefined));
            assert.ok(showInfoStub.calledOnce);
        });

        test('should show error message on failure', async () => {
            mockVoteService.voteOnCollection.resolves({ success: false, error: 'API error' });

            const result = await voteCommands.voteUpCollection(TEST_ITEM);

            assert.strictEqual(result.success, false);
            assert.ok(showErrorStub.calledOnce);
        });

        test('should use custom owner and repo', async () => {
            const customItem: VotableItem = {
                ...TEST_ITEM,
                owner: 'custom-owner',
                repo: 'custom-repo'
            };
            mockVoteService.voteOnCollection.resolves({ success: true, reactionId: 123 });

            await voteCommands.voteUpCollection(customItem);

            assert.ok(mockVoteService.voteOnCollection.calledWith(42, '+1', 'custom-owner', 'custom-repo'));
        });
    });

    suite('voteDownCollection()', () => {
        test('should vote down on collection successfully', async () => {
            mockVoteService.voteOnCollection.resolves({ success: true, reactionId: 123 });

            const result = await voteCommands.voteDownCollection(TEST_ITEM);

            assert.strictEqual(result.success, true);
            assert.ok(mockVoteService.voteOnCollection.calledWith(42, '-1', undefined, undefined));
        });
    });

    suite('voteUpResource()', () => {
        test('should vote up on resource successfully', async () => {
            mockVoteService.voteOnResource.resolves({ success: true, reactionId: 123 });

            const result = await voteCommands.voteUpResource(TEST_RESOURCE_ITEM);

            assert.strictEqual(result.success, true);
            assert.ok(mockVoteService.voteOnResource.calledOnce);
            assert.ok(mockVoteService.voteOnResource.calledWith(42, 101, '+1', undefined, undefined));
        });

        test('should fail if commentId is missing', async () => {
            const result = await voteCommands.voteUpResource(TEST_ITEM);

            assert.strictEqual(result.success, false);
            assert.strictEqual(result.error, 'Missing comment ID');
            assert.ok(showErrorStub.calledOnce);
        });
    });

    suite('voteDownResource()', () => {
        test('should vote down on resource successfully', async () => {
            mockVoteService.voteOnResource.resolves({ success: true, reactionId: 123 });

            const result = await voteCommands.voteDownResource(TEST_RESOURCE_ITEM);

            assert.strictEqual(result.success, true);
            assert.ok(mockVoteService.voteOnResource.calledWith(42, 101, '-1', undefined, undefined));
        });

        test('should fail if commentId is missing', async () => {
            const result = await voteCommands.voteDownResource(TEST_ITEM);

            assert.strictEqual(result.success, false);
            assert.strictEqual(result.error, 'Missing comment ID');
        });
    });

    suite('toggleVote()', () => {
        test('should toggle vote and show added message', async () => {
            mockVoteService.toggleVote.resolves({ success: true, reactionId: 123, action: 'added' });

            const result = await voteCommands.toggleVote(TEST_ITEM, '+1');

            assert.strictEqual(result.success, true);
            assert.strictEqual(result.action, 'added');
            assert.ok(showInfoStub.calledWith('Vote recorded: Test Collection'));
        });

        test('should toggle vote and show removed message', async () => {
            mockVoteService.toggleVote.resolves({ success: true, action: 'removed' });

            const result = await voteCommands.toggleVote(TEST_ITEM, '+1');

            assert.strictEqual(result.action, 'removed');
            assert.ok(showInfoStub.calledWith('Vote removed: Test Collection'));
        });

        test('should toggle vote and show changed message', async () => {
            mockVoteService.toggleVote.resolves({ success: true, reactionId: 456, action: 'changed' });

            const result = await voteCommands.toggleVote(TEST_ITEM, '-1');

            assert.strictEqual(result.action, 'changed');
            assert.ok(showInfoStub.calledWith('Vote changed: Test Collection'));
        });

        test('should show error on failure', async () => {
            mockVoteService.toggleVote.resolves({ success: false, error: 'API error', action: 'added' });

            const result = await voteCommands.toggleVote(TEST_ITEM, '+1');

            assert.strictEqual(result.success, false);
            assert.ok(showErrorStub.calledOnce);
        });
    });

    suite('removeVote()', () => {
        test('should remove vote successfully', async () => {
            mockVoteService.removeVote.resolves({ success: true });

            const result = await voteCommands.removeVote({ ...TEST_ITEM, reactionId: 123 });

            assert.strictEqual(result.success, true);
            assert.ok(mockVoteService.removeVote.calledWith(123, undefined, undefined));
            assert.ok(showInfoStub.calledOnce);
        });

        test('should show error on failure', async () => {
            mockVoteService.removeVote.resolves({ success: false, error: 'Not found' });

            const result = await voteCommands.removeVote({ ...TEST_ITEM, reactionId: 123 });

            assert.strictEqual(result.success, false);
            assert.ok(showErrorStub.calledOnce);
        });
    });

    suite('registerCommands()', () => {
        test('should register all vote commands', () => {
            const mockContext = {
                subscriptions: []
            } as unknown as vscode.ExtensionContext;

            const registerStub = sandbox.stub(vscode.commands, 'registerCommand').returns({ dispose: () => {} } as any);

            voteCommands.registerCommands(mockContext);

            assert.strictEqual(registerStub.callCount, 6);
            assert.ok(registerStub.calledWith('promptRegistry.voteUpCollection'));
            assert.ok(registerStub.calledWith('promptRegistry.voteDownCollection'));
            assert.ok(registerStub.calledWith('promptRegistry.voteUpResource'));
            assert.ok(registerStub.calledWith('promptRegistry.voteDownResource'));
            assert.ok(registerStub.calledWith('promptRegistry.toggleVote'));
            assert.ok(registerStub.calledWith('promptRegistry.removeVote'));
        });
    });

    suite('Display name fallback', () => {
        test('should use discussion number when displayName is not provided', async () => {
            const itemWithoutName: VotableItem = {
                discussionNumber: 99
            };
            mockVoteService.voteOnCollection.resolves({ success: true, reactionId: 123 });

            await voteCommands.voteUpCollection(itemWithoutName);

            assert.ok(showInfoStub.calledWith('👍 Vote recorded: collection #99'));
        });
    });
});

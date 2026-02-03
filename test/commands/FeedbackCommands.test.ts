/**
 * Tests for FeedbackCommands
 * VS Code commands for collecting user feedback
 */

import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { FeedbackCommands, FeedbackableItem } from '../../src/commands/FeedbackCommands';
import { EngagementService } from '../../src/services/engagement/EngagementService';
import { Feedback } from '../../src/types/engagement';

suite('FeedbackCommands', () => {
    let sandbox: sinon.SinonSandbox;
    let commands: FeedbackCommands;
    let mockEngagementService: sinon.SinonStubbedInstance<EngagementService>;
    let showInputBoxStub: sinon.SinonStub;
    let showQuickPickStub: sinon.SinonStub;
    let showInformationMessageStub: sinon.SinonStub;
    let showWarningMessageStub: sinon.SinonStub;
    let showErrorMessageStub: sinon.SinonStub;

    const createMockItem = (overrides: Partial<FeedbackableItem> = {}): FeedbackableItem => ({
        resourceId: 'test-bundle',
        resourceType: 'bundle',
        name: 'Test Bundle',
        version: '1.0.0',
        ...overrides,
    });

    const createMockFeedback = (comment: string, rating?: 1 | 2 | 3 | 4 | 5): Feedback => ({
        id: 'feedback-123',
        resourceType: 'bundle',
        resourceId: 'test-bundle',
        comment,
        rating,
        timestamp: new Date().toISOString(),
    });

    setup(() => {
        sandbox = sinon.createSandbox();

        // Mock VS Code window methods
        showInputBoxStub = sandbox.stub(vscode.window, 'showInputBox');
        showQuickPickStub = sandbox.stub(vscode.window, 'showQuickPick');
        showInformationMessageStub = sandbox.stub(vscode.window, 'showInformationMessage');
        showWarningMessageStub = sandbox.stub(vscode.window, 'showWarningMessage');
        showErrorMessageStub = sandbox.stub(vscode.window, 'showErrorMessage');

        // Mock EngagementService
        mockEngagementService = {
            submitFeedback: sandbox.stub(),
        } as unknown as sinon.SinonStubbedInstance<EngagementService>;

        commands = new FeedbackCommands(mockEngagementService as unknown as EngagementService);
    });

    teardown(() => {
        sandbox.restore();
    });

    suite('submitFeedback()', () => {
        test('should submit feedback with rating and comment', async () => {
            const item = createMockItem();
            const feedback = createMockFeedback('Great bundle!', 5);

            // Mock rating selection
            showQuickPickStub.onFirstCall().resolves({ 
                label: '⭐⭐⭐⭐⭐', 
                description: '5 stars - Excellent!' 
            });
            // Mock comment input
            showInputBoxStub.onFirstCall().resolves('Great bundle!');
            // Mock action selection (Skip)
            showQuickPickStub.onSecondCall().resolves({ 
                label: '⏭️ Skip', 
                description: 'Just submit the star rating' 
            });
            mockEngagementService.submitFeedback.resolves(feedback);

            const result = await commands.submitFeedback(item);

            assert.strictEqual(result.success, true);
            assert.ok(result.feedback);
            assert.ok(showInformationMessageStub.calledOnce);
        });

        test('should return cancelled when user cancels rating selection', async () => {
            const item = createMockItem();
            showQuickPickStub.resolves(undefined);

            const result = await commands.submitFeedback(item);

            assert.strictEqual(result.success, false);
            assert.strictEqual(result.error, 'Cancelled');
        });

        test('should save rating when user cancels comment input', async () => {
            const item = createMockItem();
            const feedback = createMockFeedback('Rated 4 stars', 4);

            showQuickPickStub.resolves({ 
                label: '⭐⭐⭐⭐☆', 
                description: '4 stars - Very good' 
            });
            showInputBoxStub.resolves(undefined);
            mockEngagementService.submitFeedback.resolves(feedback);

            const result = await commands.submitFeedback(item);

            assert.strictEqual(result.success, true);
            const callArgs = mockEngagementService.submitFeedback.firstCall.args;
            assert.strictEqual(callArgs[3]?.rating, 4);
        });

        test('should work without engagement service', async () => {
            const commandsWithoutService = new FeedbackCommands();
            const item = createMockItem();
            
            showQuickPickStub.resolves({ 
                label: '⭐⭐⭐☆☆', 
                description: '3 stars - Good' 
            });
            showInputBoxStub.resolves('Test feedback');
            showQuickPickStub.onSecondCall().resolves({ 
                label: '⏭️ Skip' 
            });

            const result = await commandsWithoutService.submitFeedback(item);

            assert.strictEqual(result.success, true);
            assert.ok(result.feedback);
            assert.strictEqual(result.feedback.comment, 'Test feedback');
            assert.strictEqual(result.feedback.rating, 3);
        });
    });


    suite('Error Handling', () => {
        test('should handle service errors gracefully', async () => {
            const item = createMockItem();
            
            showQuickPickStub.onFirstCall().resolves({ 
                label: '⭐⭐⭐☆☆', 
                description: '3 stars - Good' 
            });
            showInputBoxStub.resolves('Test feedback');
            showQuickPickStub.onSecondCall().resolves({ 
                label: '⏭️ Skip' 
            });
            mockEngagementService.submitFeedback.rejects(new Error('Service unavailable'));

            const result = await commands.submitFeedback(item);

            assert.strictEqual(result.success, false);
            assert.strictEqual(result.error, 'Service unavailable');
            assert.ok(showErrorMessageStub.calledOnce);
        });
    });

    suite('registerCommands()', () => {
        test('should register feedback commands', () => {
            const mockContext = {
                subscriptions: [] as vscode.Disposable[],
            } as vscode.ExtensionContext;

            const registerCommandStub = sandbox.stub(vscode.commands, 'registerCommand').returns({
                dispose: () => {},
            } as vscode.Disposable);

            commands.registerCommands(mockContext);

            assert.strictEqual(registerCommandStub.callCount, 2);
            assert.ok(registerCommandStub.calledWith('promptRegistry.feedback'));
            assert.ok(registerCommandStub.calledWith('promptRegistry.submitFeedback'));
        });
    });

    suite('setEngagementService()', () => {
        test('should allow setting engagement service after construction', async () => {
            const commandsWithoutService = new FeedbackCommands();
            const item = createMockItem();
            const feedback = createMockFeedback('Test', 3);

            // First call without service
            showQuickPickStub.onFirstCall().resolves({ 
                label: '⭐⭐⭐☆☆', 
                description: '3 stars - Good' 
            });
            showInputBoxStub.onFirstCall().resolves('Test');
            showQuickPickStub.onSecondCall().resolves({ 
                label: '⏭️ Skip' 
            });
            const result1 = await commandsWithoutService.submitFeedback(item);
            assert.strictEqual(result1.success, true);

            // Set service and call again
            commandsWithoutService.setEngagementService(mockEngagementService as unknown as EngagementService);
            showQuickPickStub.onThirdCall().resolves({ 
                label: '⭐⭐⭐☆☆', 
                description: '3 stars - Good' 
            });
            showInputBoxStub.onSecondCall().resolves('Test 2');
            showQuickPickStub.onCall(3).resolves({ 
                label: '⏭️ Skip' 
            });
            mockEngagementService.submitFeedback.resolves(feedback);
            
            const result2 = await commandsWithoutService.submitFeedback(item);
            assert.strictEqual(result2.success, true);
            assert.ok(mockEngagementService.submitFeedback.calledOnce);
        });
    });
});

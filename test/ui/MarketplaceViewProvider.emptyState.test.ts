/**
 * Tests for MarketplaceViewProvider Empty State UI
 * 
 * Tests the setup prompt and syncing message behavior based on setup state.
 * Requirements: 4.1, 4.2, 4.3, 4.5
 */

import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { MarketplaceViewProvider } from '../../src/ui/MarketplaceViewProvider';
import { RegistryManager } from '../../src/services/RegistryManager';
import { SetupStateManager, SetupState } from '../../src/services/SetupStateManager';

suite('MarketplaceViewProvider - Empty State UI', () => {
    let sandbox: sinon.SinonSandbox;
    let mockContext: vscode.ExtensionContext;
    let mockRegistryManager: sinon.SinonStubbedInstance<RegistryManager>;
    let mockSetupStateManager: sinon.SinonStubbedInstance<SetupStateManager>;
    let marketplaceProvider: MarketplaceViewProvider;
    let mockWebview: any;
    let postedMessages: any[] = [];

    setup(() => {
        sandbox = sinon.createSandbox();
        postedMessages = [];

        // Create mock context
        mockContext = {
            subscriptions: [],
            extensionUri: vscode.Uri.file('/mock/path'),
            extensionPath: '/mock/path',
            storagePath: '/mock/storage',
            globalStoragePath: '/mock/global-storage',
            logPath: '/mock/logs',
            extensionMode: 2 // ExtensionMode.Test
        } as any;

        // Create mock webview that captures posted messages
        mockWebview = {
            postMessage: (message: any) => {
                postedMessages.push(message);
                return Promise.resolve(true);
            },
            onDidReceiveMessage: sandbox.stub().returns({ dispose: () => {} }),
            options: {},
            html: ''
        };

        // Create mock RegistryManager with event emitters
        mockRegistryManager = {
            onBundleInstalled: sandbox.stub().returns({ dispose: () => {} }),
            onBundleUninstalled: sandbox.stub().returns({ dispose: () => {} }),
            onBundleUpdated: sandbox.stub().returns({ dispose: () => {} }),
            onBundlesInstalled: sandbox.stub().returns({ dispose: () => {} }),
            onBundlesUninstalled: sandbox.stub().returns({ dispose: () => {} }),
            onSourceSynced: sandbox.stub().returns({ dispose: () => {} }),
            onAutoUpdatePreferenceChanged: sandbox.stub().returns({ dispose: () => {} }),
            onRepositoryBundlesChanged: sandbox.stub().returns({ dispose: () => {} }),
            searchBundles: sandbox.stub().resolves([]),
            listInstalledBundles: sandbox.stub().resolves([]),
            listSources: sandbox.stub().resolves([]),
            autoUpdateService: null
        } as any;

        // Create mock SetupStateManager
        mockSetupStateManager = {
            getState: sandbox.stub(),
            isComplete: sandbox.stub(),
            isIncomplete: sandbox.stub(),
            markStarted: sandbox.stub().resolves(),
            markComplete: sandbox.stub().resolves(),
            markIncomplete: sandbox.stub().resolves()
        } as any;

        // Create MarketplaceViewProvider
        marketplaceProvider = new MarketplaceViewProvider(
            mockContext, 
            mockRegistryManager as any, 
            mockSetupStateManager as any
        );

        // Set up the view with mock webview
        (marketplaceProvider as any)._view = {
            webview: mockWebview
        };
    });

    teardown(() => {
        sandbox.restore();
    });

    suite('Setup state in bundlesLoaded message', () => {
        test('should include setup state in bundlesLoaded message when setup is incomplete', async () => {
            // Requirement 4.1: WHEN the marketplace displays AND no bundles exist AND no hub is configured
            mockSetupStateManager.getState.resolves(SetupState.INCOMPLETE);
            mockRegistryManager.searchBundles.resolves([]);
            mockRegistryManager.listInstalledBundles.resolves([]);
            mockRegistryManager.listSources.resolves([]);

            // Trigger loadBundles
            await (marketplaceProvider as any).loadBundles();

            // Verify message was posted with setup state
            assert.strictEqual(postedMessages.length, 1);
            assert.strictEqual(postedMessages[0].type, 'bundlesLoaded');
            assert.strictEqual(postedMessages[0].setupState, SetupState.INCOMPLETE);
        });

        test('should include setup state in bundlesLoaded message when setup is not started', async () => {
            // Requirement 4.1: Setup prompt should show when setup is not_started
            mockSetupStateManager.getState.resolves(SetupState.NOT_STARTED);
            mockRegistryManager.searchBundles.resolves([]);
            mockRegistryManager.listInstalledBundles.resolves([]);
            mockRegistryManager.listSources.resolves([]);

            // Trigger loadBundles
            await (marketplaceProvider as any).loadBundles();

            // Verify message was posted with setup state
            assert.strictEqual(postedMessages.length, 1);
            assert.strictEqual(postedMessages[0].type, 'bundlesLoaded');
            assert.strictEqual(postedMessages[0].setupState, SetupState.NOT_STARTED);
        });

        test('should include setup state in bundlesLoaded message when setup is complete', async () => {
            // Requirement 4.5: WHEN setup complete and no bundles, show "Syncing sources..."
            mockSetupStateManager.getState.resolves(SetupState.COMPLETE);
            mockRegistryManager.searchBundles.resolves([]);
            mockRegistryManager.listInstalledBundles.resolves([]);
            mockRegistryManager.listSources.resolves([]);

            // Trigger loadBundles
            await (marketplaceProvider as any).loadBundles();

            // Verify message was posted with setup state
            assert.strictEqual(postedMessages.length, 1);
            assert.strictEqual(postedMessages[0].type, 'bundlesLoaded');
            assert.strictEqual(postedMessages[0].setupState, SetupState.COMPLETE);
        });

        test('should include setup state in bundlesLoaded message when setup is in progress', async () => {
            mockSetupStateManager.getState.resolves(SetupState.IN_PROGRESS);
            mockRegistryManager.searchBundles.resolves([]);
            mockRegistryManager.listInstalledBundles.resolves([]);
            mockRegistryManager.listSources.resolves([]);

            // Trigger loadBundles
            await (marketplaceProvider as any).loadBundles();

            // Verify message was posted with setup state
            assert.strictEqual(postedMessages.length, 1);
            assert.strictEqual(postedMessages[0].type, 'bundlesLoaded');
            assert.strictEqual(postedMessages[0].setupState, SetupState.IN_PROGRESS);
        });
    });

    suite('completeSetup message handler', () => {
        test('should call markStarted before executing initializeHub command', async () => {
            // Requirement 4.4: State should be marked as started before triggering flow
            const executeCommandStub = sandbox.stub(vscode.commands, 'executeCommand').resolves();
            mockSetupStateManager.getState.resolves(SetupState.COMPLETE);
            mockRegistryManager.searchBundles.resolves([]);
            mockRegistryManager.listInstalledBundles.resolves([]);
            mockRegistryManager.listSources.resolves([]);

            // Call handleCompleteSetup
            await (marketplaceProvider as any).handleCompleteSetup();

            // Verify markStarted was called
            assert.ok(mockSetupStateManager.markStarted.calledOnce, 'markStarted should be called');
            
            // Verify markStarted was called before executeCommand
            assert.ok(mockSetupStateManager.markStarted.calledBefore(executeCommandStub), 
                'markStarted should be called before executeCommand');
        });

        test('should handle completeSetup message and execute initializeHub command', async () => {
            // Requirement 4.4: WHEN user clicks "Complete Setup", trigger first-run configuration flow
            const executeCommandStub = sandbox.stub(vscode.commands, 'executeCommand').resolves();
            mockSetupStateManager.getState.resolves(SetupState.COMPLETE);
            mockRegistryManager.searchBundles.resolves([]);
            mockRegistryManager.listInstalledBundles.resolves([]);
            mockRegistryManager.listSources.resolves([]);

            // Call handleCompleteSetup
            await (marketplaceProvider as any).handleCompleteSetup();

            // Verify command was executed
            assert.ok(executeCommandStub.calledOnce, 'executeCommand should be called once');
            assert.ok(executeCommandStub.calledWith('promptRegistry.initializeHub'), 
                'should call promptRegistry.initializeHub command');
        });

        test('should NOT call markComplete directly (delegated to initializeHub)', async () => {
            // State management is delegated to initializeHub command
            sandbox.stub(vscode.commands, 'executeCommand').resolves();
            mockSetupStateManager.getState.resolves(SetupState.COMPLETE);
            mockRegistryManager.searchBundles.resolves([]);
            mockRegistryManager.listInstalledBundles.resolves([]);
            mockRegistryManager.listSources.resolves([]);

            // Call handleCompleteSetup
            await (marketplaceProvider as any).handleCompleteSetup();

            // Verify markComplete was NOT called (initializeHub handles this)
            assert.ok(!mockSetupStateManager.markComplete.called, 
                'markComplete should NOT be called directly - delegated to initializeHub');
        });

        test('should refresh marketplace after completing setup', async () => {
            // Requirement 4.4: After setup, marketplace should refresh
            sandbox.stub(vscode.commands, 'executeCommand').resolves();
            mockSetupStateManager.getState.resolves(SetupState.COMPLETE);
            mockRegistryManager.searchBundles.resolves([]);
            mockRegistryManager.listInstalledBundles.resolves([]);
            mockRegistryManager.listSources.resolves([]);

            // Clear any previous messages
            postedMessages = [];

            // Call handleCompleteSetup
            await (marketplaceProvider as any).handleCompleteSetup();

            // Verify loadBundles was called (which posts bundlesLoaded message)
            assert.strictEqual(postedMessages.length, 1);
            assert.strictEqual(postedMessages[0].type, 'bundlesLoaded');
        });

        test('should NOT call markIncomplete directly when setup fails (delegated to initializeHub)', async () => {
            // State management is delegated to initializeHub command
            sandbox.stub(vscode.commands, 'executeCommand')
                .rejects(new Error('Setup failed'));
            sandbox.stub(vscode.window, 'showErrorMessage').resolves();
            mockSetupStateManager.getState.resolves(SetupState.COMPLETE);
            mockRegistryManager.searchBundles.resolves([]);
            mockRegistryManager.listInstalledBundles.resolves([]);
            mockRegistryManager.listSources.resolves([]);

            // Call handleCompleteSetup - should not throw
            await (marketplaceProvider as any).handleCompleteSetup();

            // Verify markIncomplete was NOT called directly (initializeHub handles this)
            assert.ok(!mockSetupStateManager.markIncomplete.called, 
                'markIncomplete should NOT be called directly - delegated to initializeHub');
        });

        test('should handle errors gracefully when completing setup fails', async () => {
            // Requirement 4.4: Error handling
            sandbox.stub(vscode.commands, 'executeCommand')
                .rejects(new Error('Setup failed'));
            const showErrorStub = sandbox.stub(vscode.window, 'showErrorMessage').resolves();

            // Call handleCompleteSetup - should not throw
            await (marketplaceProvider as any).handleCompleteSetup();

            // Verify error message was shown
            assert.ok(showErrorStub.calledOnce);
            assert.ok(showErrorStub.firstCall.args[0].includes('Failed to complete setup'));
        });

        test('should not call markComplete when setup fails', async () => {
            // Requirement 4.4: markComplete should not be called on error
            sandbox.stub(vscode.commands, 'executeCommand')
                .rejects(new Error('Setup failed'));
            sandbox.stub(vscode.window, 'showErrorMessage').resolves();

            // Call handleCompleteSetup
            await (marketplaceProvider as any).handleCompleteSetup();

            // Verify markComplete was NOT called
            assert.ok(mockSetupStateManager.markComplete.notCalled, 
                'markComplete should not be called when setup fails');
        });
    });

    suite('HTML content generation', () => {
        test('should include primary-button CSS class in HTML', () => {
            // Requirement 4.3: Setup prompt should include a "Complete Setup" button
            const html = (marketplaceProvider as any).getHtmlContent(mockWebview);
            
            // Verify primary-button CSS is included
            assert.ok(html.includes('.primary-button'), 'HTML should include primary-button CSS class');
            assert.ok(html.includes('background-color: var(--vscode-button-background)'), 
                'primary-button should use VS Code button background');
        });

        test('should include empty-state CSS classes in HTML', () => {
            // Requirement 4.2: Setup prompt should display a clear message
            const html = (marketplaceProvider as any).getHtmlContent(mockWebview);
            
            // Verify empty-state CSS classes are included
            assert.ok(html.includes('.empty-state'), 'HTML should include empty-state CSS class');
            assert.ok(html.includes('.empty-state-icon'), 'HTML should include empty-state-icon CSS class');
            assert.ok(html.includes('.empty-state-title'), 'HTML should include empty-state-title CSS class');
        });

        test('should include completeSetup function in JavaScript', () => {
            // Requirement 4.4: Button should trigger first-run configuration flow
            const html = (marketplaceProvider as any).getHtmlContent(mockWebview);
            
            // Verify completeSetup function is defined
            assert.ok(html.includes('function completeSetup()'), 
                'HTML should include completeSetup function');
            assert.ok(html.includes("type: 'completeSetup'"), 
                'completeSetup should post message with type completeSetup');
        });

        test('should include setupState variable in JavaScript', () => {
            // Requirement 4.1: UI should check setup state
            const html = (marketplaceProvider as any).getHtmlContent(mockWebview);
            
            // Verify setupState variable is defined
            assert.ok(html.includes('let setupState'), 
                'HTML should include setupState variable');
            assert.ok(html.includes('setupState = message.setupState'), 
                'setupState should be updated from message');
        });

        test('should include setup incomplete check in renderBundles', () => {
            // Requirement 4.1: Show setup prompt when setup incomplete
            const html = (marketplaceProvider as any).getHtmlContent(mockWebview);
            
            // Verify setup incomplete check is in renderBundles
            assert.ok(html.includes("setupState === 'incomplete'") || html.includes("setupState === 'not_started'"), 
                'renderBundles should check for incomplete setup state');
            assert.ok(html.includes('Setup Not Complete'), 
                'HTML should include "Setup Not Complete" message');
            assert.ok(html.includes('No hub is configured'), 
                'HTML should include explanation about no hub configured');
        });

        test('should include syncing message for complete setup with no bundles', () => {
            // Requirement 4.5: Show "Syncing sources..." when setup complete but no bundles
            const html = (marketplaceProvider as any).getHtmlContent(mockWebview);
            
            // Verify syncing message is included
            assert.ok(html.includes('Syncing sources...'), 
                'HTML should include "Syncing sources..." message');
            assert.ok(html.includes('Bundles will appear as sources are synced'), 
                'HTML should include explanation about syncing');
        });
    });
});

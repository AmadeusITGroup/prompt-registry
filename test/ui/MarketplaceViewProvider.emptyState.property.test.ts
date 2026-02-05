/**
 * Property-based tests for MarketplaceViewProvider Empty State UI
 * 
 * Property 8: Empty State UI Correctness
 * For any marketplace rendering with no bundles:
 * - If no hub is configured (setup incomplete/not_started), show setup prompt
 * - If hub is configured (setup complete), show "Syncing sources..."
 * 
 * **Validates: Requirements 4.1, 4.2, 4.3, 4.5**
 */

import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import * as fc from 'fast-check';
import { MarketplaceViewProvider } from '../../src/ui/MarketplaceViewProvider';
import { RegistryManager } from '../../src/services/RegistryManager';
import { SetupStateManager, SetupState } from '../../src/services/SetupStateManager';
import { PropertyTestConfig } from '../helpers/propertyTestHelpers';
import { formatTestParams } from '../helpers/setupStateTestHelpers';
import { BundleBuilder } from '../helpers/bundleTestHelpers';

suite('MarketplaceViewProvider Empty State - Property Tests', () => {
    let sandbox: sinon.SinonSandbox;
    let mockContext: vscode.ExtensionContext;
    let mockRegistryManager: sinon.SinonStubbedInstance<RegistryManager>;
    let mockSetupStateManager: sinon.SinonStubbedInstance<SetupStateManager>;
    let marketplaceProvider: MarketplaceViewProvider;
    let mockWebview: any;
    let postedMessages: any[];

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

    /**
     * Property 8: Empty State UI Correctness
     * For any marketplace rendering with no bundles:
     * - If setup is incomplete or not_started, show setup prompt
     * - If setup is complete or in_progress, show syncing message
     * 
     * **Validates: Requirements 4.1, 4.2, 4.3, 4.5**
     */
    test('Property 8: Empty state UI correctness (Req 4.1, 4.2, 4.3, 4.5)', async () => {
        const setupStateArbitrary = fc.constantFrom(
            SetupState.NOT_STARTED,
            SetupState.IN_PROGRESS,
            SetupState.COMPLETE,
            SetupState.INCOMPLETE
        );

        const bundleCountArbitrary = fc.integer({ min: 0, max: 5 });

        await fc.assert(
            fc.asyncProperty(
                setupStateArbitrary,
                bundleCountArbitrary,
                async (setupState, bundleCount) => {
                    // Reset state for each test
                    postedMessages = [];
                    mockSetupStateManager.getState.resolves(setupState);

                    // Generate mock bundles if bundleCount > 0
                    const mockBundles = Array.from({ length: bundleCount }, (_, i) => 
                        BundleBuilder.github('owner', `repo-${i}`)
                            .withVersion('1.0.0')
                            .withDescription(`Test bundle ${i}`)
                            .build()
                    );

                    mockRegistryManager.searchBundles.resolves(mockBundles);
                    mockRegistryManager.listInstalledBundles.resolves([]);
                    mockRegistryManager.listSources.resolves([]);

                    // Trigger loadBundles
                    await (marketplaceProvider as any).loadBundles();

                    const testParams = formatTestParams({ setupState, bundleCount });

                    // Verify message was posted
                    assert.strictEqual(
                        postedMessages.length,
                        1,
                        `Should post exactly one bundlesLoaded message (${testParams})`
                    );
                    assert.strictEqual(
                        postedMessages[0].type,
                        'bundlesLoaded',
                        `Message type should be bundlesLoaded (${testParams})`
                    );

                    // Verify setup state is included in message
                    assert.strictEqual(
                        postedMessages[0].setupState,
                        setupState,
                        `Setup state should be included in message (${testParams})`
                    );

                    // Verify bundle count matches
                    assert.strictEqual(
                        postedMessages[0].bundles.length,
                        bundleCount,
                        `Bundle count should match (${testParams})`
                    );

                    // The UI rendering logic is in the webview JavaScript
                    // We verify that the correct data is sent to enable proper rendering
                    const isSetupIncomplete = setupState === SetupState.INCOMPLETE || 
                                              setupState === SetupState.NOT_STARTED;
                    const hasNoBundles = bundleCount === 0;

                    if (hasNoBundles && isSetupIncomplete) {
                        // Req 4.1, 4.2, 4.3: Setup prompt should be shown
                        // The webview will use setupState to determine this
                        assert.ok(
                            postedMessages[0].setupState === SetupState.INCOMPLETE ||
                            postedMessages[0].setupState === SetupState.NOT_STARTED,
                            `Req 4.1: Setup state should indicate incomplete setup (${testParams})`
                        );
                    } else if (hasNoBundles && !isSetupIncomplete) {
                        // Req 4.5: Syncing message should be shown
                        // The webview will use setupState to determine this
                        assert.ok(
                            postedMessages[0].setupState === SetupState.COMPLETE ||
                            postedMessages[0].setupState === SetupState.IN_PROGRESS,
                            `Req 4.5: Setup state should indicate complete/in_progress setup (${testParams})`
                        );
                    }

                    return true;
                }
            ),
            { ...PropertyTestConfig.FAST_CHECK_OPTIONS, numRuns: PropertyTestConfig.RUNS.STANDARD }
        );
    });

    /**
     * Additional property: HTML content includes required UI elements
     * Verifies that the generated HTML contains all necessary elements for empty state rendering
     */
    test('Property 8b: HTML content includes required empty state elements', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.boolean(), // Whether to check for setup prompt elements
                async (checkSetupPrompt) => {
                    const html = (marketplaceProvider as any).getHtmlContent(mockWebview);

                    // Verify primary-button CSS is included (Req 4.3)
                    assert.ok(
                        html.includes('.primary-button'),
                        'HTML should include primary-button CSS class'
                    );

                    // Verify empty-state CSS classes are included (Req 4.2)
                    assert.ok(
                        html.includes('.empty-state'),
                        'HTML should include empty-state CSS class'
                    );
                    assert.ok(
                        html.includes('.empty-state-icon'),
                        'HTML should include empty-state-icon CSS class'
                    );
                    assert.ok(
                        html.includes('.empty-state-title'),
                        'HTML should include empty-state-title CSS class'
                    );

                    // Verify completeSetup function is defined (Req 4.4)
                    assert.ok(
                        html.includes('function completeSetup()'),
                        'HTML should include completeSetup function'
                    );

                    // Verify setupState variable handling
                    assert.ok(
                        html.includes('setupState'),
                        'HTML should include setupState variable'
                    );

                    // Verify setup incomplete check
                    assert.ok(
                        html.includes("setupState === 'incomplete'") || 
                        html.includes("setupState === 'not_started'"),
                        'HTML should check for incomplete setup state'
                    );

                    // Verify setup prompt message (Req 4.2)
                    assert.ok(
                        html.includes('Setup Not Complete') || html.includes('No hub is configured'),
                        'HTML should include setup prompt message'
                    );

                    // Verify syncing message (Req 4.5)
                    assert.ok(
                        html.includes('Syncing sources...'),
                        'HTML should include syncing message'
                    );

                    return true;
                }
            ),
            { ...PropertyTestConfig.FAST_CHECK_OPTIONS, numRuns: 10 } // Fewer runs since HTML is static
        );
    });
});


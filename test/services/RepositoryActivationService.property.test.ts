/**
 * RepositoryActivationService Property-Based Tests
 * 
 * Property 11: Repository Activation Prompt Behavior
 * For any workspace opened with a valid lockfile (not previously declined),
 * a notification SHALL be displayed offering to enable repository bundles.
 * 
 * Validates: Requirements 13.1-13.7
 */

import * as assert from 'assert';
import * as fc from 'fast-check';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { RepositoryActivationService } from '../../src/services/RepositoryActivationService';
import { LockfileManager } from '../../src/services/LockfileManager';
import { HubManager } from '../../src/services/HubManager';
import { RegistryStorage } from '../../src/storage/RegistryStorage';
import { Lockfile } from '../../src/types/lockfile';
import { LockfileGenerators, LOCKFILE_DEFAULTS } from '../helpers/lockfileTestHelpers';

const TEST_WORKSPACE_ROOT = '/test/workspace';

/**
 * Feature: repository-level-installation, Property 11: Repository Activation Prompt Behavior
 * 
 * For any workspace opened with a valid lockfile (not previously declined),
 * a notification SHALL be displayed offering to enable repository bundles.
 */
suite('RepositoryActivationService - Property Tests', () => {
    let sandbox: sinon.SinonSandbox;
    let showInformationMessageStub: sinon.SinonStub;

    setup(() => {
        sandbox = sinon.createSandbox();
        showInformationMessageStub = sandbox.stub(vscode.window, 'showInformationMessage');
        // Reset all instances before each test
        RepositoryActivationService.resetInstance();
    });

    teardown(() => {
        sandbox.restore();
        RepositoryActivationService.resetInstance();
    });

    test('Property 11: Repository Activation Prompt Behavior - lockfile presence triggers prompt', () => {
        return fc.assert(
            fc.asyncProperty(
                LockfileGenerators.lockfile({ minBundles: 1, maxBundles: 10 }),
                async (lockfile) => {
                    // Reset stub history for each iteration
                    showInformationMessageStub.resetHistory();
                    showInformationMessageStub.resolves('Not now');
                    RepositoryActivationService.resetInstance();
                    
                    // Arrange
                    const mockLockfileManager = sandbox.createStubInstance(LockfileManager);
                    const mockHubManager = sandbox.createStubInstance(HubManager);
                    const mockStorage = sandbox.createStubInstance(RegistryStorage);
                    
                    mockLockfileManager.read.resolves(lockfile);
                    mockLockfileManager.getLockfilePath.returns('/repo/prompt-registry.lock.json');
                    
                    // Mock context with no declined repositories
                    const mockContext = {
                        globalState: {
                            get: sandbox.stub().returns([])
                        }
                    } as any;
                    mockStorage.getContext.returns(mockContext);
                    
                    const service = new RepositoryActivationService(
                        mockLockfileManager,
                        mockHubManager,
                        mockStorage,
                        TEST_WORKSPACE_ROOT
                    );

                    // Act
                    await service.checkAndPromptActivation();

                    // Assert - prompt should be shown for any valid lockfile
                    assert.ok(showInformationMessageStub.calledOnce,
                        'Should show activation prompt for any valid lockfile');
                }
            ),
            { numRuns: 100 }
        );
    });

    test('Property 11: Repository Activation Prompt Behavior - declined repositories never prompt', () => {
        return fc.assert(
            fc.asyncProperty(
                LockfileGenerators.lockfile({ minBundles: 1, maxBundles: 10 }),
                fc.string({ minLength: 5, maxLength: 50 }).map(s => `/repo/${s.replace(/[^a-zA-Z0-9-]/g, 'a')}`),
                async (lockfile, repositoryPath) => {
                    // Reset stub history for each iteration
                    showInformationMessageStub.resetHistory();
                    RepositoryActivationService.resetInstance();
                    
                    // Arrange
                    const mockLockfileManager = sandbox.createStubInstance(LockfileManager);
                    const mockHubManager = sandbox.createStubInstance(HubManager);
                    const mockStorage = sandbox.createStubInstance(RegistryStorage);
                    
                    mockLockfileManager.read.resolves(lockfile);
                    mockLockfileManager.getLockfilePath.returns(`${repositoryPath}/prompt-registry.lock.json`);
                    
                    // Mock context with this repository already declined
                    const mockContext = {
                        globalState: {
                            get: sandbox.stub().returns([repositoryPath])
                        }
                    } as any;
                    mockStorage.getContext.returns(mockContext);
                    
                    const service = new RepositoryActivationService(
                        mockLockfileManager,
                        mockHubManager,
                        mockStorage,
                        repositoryPath
                    );

                    // Act
                    await service.checkAndPromptActivation();

                    // Assert - should never prompt for declined repositories
                    assert.ok(!showInformationMessageStub.called,
                        'Should never prompt for previously declined repositories');
                }
            ),
            { numRuns: 100 }
        );
    });

    test('Property 11: Repository Activation Prompt Behavior - prompt includes bundle count', () => {
        return fc.assert(
            fc.asyncProperty(
                LockfileGenerators.lockfile({ minBundles: 1, maxBundles: 20 }),
                async (lockfile) => {
                    // Reset stub history for each iteration
                    showInformationMessageStub.resetHistory();
                    showInformationMessageStub.resolves('Not now');
                    RepositoryActivationService.resetInstance();
                    
                    // Arrange
                    const mockLockfileManager = sandbox.createStubInstance(LockfileManager);
                    const mockHubManager = sandbox.createStubInstance(HubManager);
                    const mockStorage = sandbox.createStubInstance(RegistryStorage);
                    
                    mockLockfileManager.read.resolves(lockfile);
                    mockLockfileManager.getLockfilePath.returns('/repo/prompt-registry.lock.json');
                    
                    const mockContext = {
                        globalState: {
                            get: sandbox.stub().returns([])
                        }
                    } as any;
                    mockStorage.getContext.returns(mockContext);
                    
                    const service = new RepositoryActivationService(
                        mockLockfileManager,
                        mockHubManager,
                        mockStorage,
                        TEST_WORKSPACE_ROOT
                    );

                    // Act
                    await service.checkAndPromptActivation();

                    // Assert - message should include bundle count
                    const message = showInformationMessageStub.firstCall.args[0] as string;
                    const bundleCount = Object.keys(lockfile.bundles).length;
                    assert.ok(message.includes(bundleCount.toString()),
                        `Prompt message should include bundle count (${bundleCount})`);
                }
            ),
            { numRuns: 100 }
        );
    });

    test('Property 11: Repository Activation Prompt Behavior - user choice determines action', () => {
        return fc.assert(
            fc.asyncProperty(
                LockfileGenerators.lockfile({ minBundles: 1, maxBundles: 5 }),
                fc.constantFrom('Enable', 'Not now', 'Don\'t ask again', undefined),
                async (lockfile, userChoice) => {
                    // Reset stub history for each iteration
                    showInformationMessageStub.resetHistory();
                    showInformationMessageStub.resolves(userChoice);
                    RepositoryActivationService.resetInstance();
                    
                    // Arrange
                    const mockLockfileManager = sandbox.createStubInstance(LockfileManager);
                    const mockHubManager = sandbox.createStubInstance(HubManager);
                    const mockStorage = sandbox.createStubInstance(RegistryStorage);
                    
                    mockLockfileManager.read.resolves(lockfile);
                    mockLockfileManager.getLockfilePath.returns('/repo/prompt-registry.lock.json');
                    
                    const updateStub = sandbox.stub();
                    const mockContext = {
                        globalState: {
                            get: sandbox.stub().returns([]),
                            update: updateStub
                        }
                    } as any;
                    mockStorage.getContext.returns(mockContext);
                    
                    // Stub getInstalledBundles to always return empty array
                    mockStorage.getInstalledBundles.resolves([]);
                    mockStorage.getSources.resolves([]);
                    mockHubManager.listHubs.resolves([]);
                    
                    const service = new RepositoryActivationService(
                        mockLockfileManager,
                        mockHubManager,
                        mockStorage,
                        TEST_WORKSPACE_ROOT
                    );

                    // Act
                    await service.checkAndPromptActivation();

                    // Assert - behavior should match user choice
                    if (userChoice === 'Enable') {
                        // Should attempt to enable bundles
                        assert.ok(mockStorage.getInstalledBundles.called,
                            'Should check installed bundles when Enable is selected');
                    } else if (userChoice === 'Don\'t ask again') {
                        // Should remember declined
                        assert.ok(updateStub.called,
                            'Should update global state when "Don\'t ask again" is selected');
                        assert.strictEqual(updateStub.firstCall.args[0], 'repositoryActivation.declined');
                    } else {
                        // 'Not now' or undefined - should do nothing
                        assert.ok(!mockStorage.getInstalledBundles.called,
                            'Should not enable bundles when declined or dismissed');
                    }
                }
            ),
            { numRuns: 100 }
        );
    });

    test('Property 11: Repository Activation Prompt Behavior - prompt has exactly three buttons', () => {
        return fc.assert(
            fc.asyncProperty(
                LockfileGenerators.lockfile({ minBundles: 1, maxBundles: 5 }),
                async (lockfile) => {
                    // Reset stub history for each iteration
                    showInformationMessageStub.resetHistory();
                    showInformationMessageStub.resolves('Not now');
                    RepositoryActivationService.resetInstance();
                    
                    // Arrange
                    const mockLockfileManager = sandbox.createStubInstance(LockfileManager);
                    const mockHubManager = sandbox.createStubInstance(HubManager);
                    const mockStorage = sandbox.createStubInstance(RegistryStorage);
                    
                    mockLockfileManager.read.resolves(lockfile);
                    mockLockfileManager.getLockfilePath.returns('/repo/prompt-registry.lock.json');
                    
                    const mockContext = {
                        globalState: {
                            get: sandbox.stub().returns([])
                        }
                    } as any;
                    mockStorage.getContext.returns(mockContext);
                    
                    const service = new RepositoryActivationService(
                        mockLockfileManager,
                        mockHubManager,
                        mockStorage,
                        TEST_WORKSPACE_ROOT
                    );

                    // Act
                    await service.checkAndPromptActivation();

                    // Assert - should always have exactly 3 buttons
                    const callArgs = showInformationMessageStub.firstCall.args;
                    const buttons = callArgs.slice(1); // Skip message
                    assert.strictEqual(buttons.length, 3,
                        'Prompt should always have exactly 3 action buttons');
                    assert.ok(buttons.includes('Enable'), 'Should have Enable button');
                    assert.ok(buttons.includes('Not now'), 'Should have Not now button');
                    assert.ok(buttons.includes('Don\'t ask again'), 'Should have Don\'t ask again button');
                }
            ),
            { numRuns: 100 }
        );
    });

    test('Property 11: Repository Activation Prompt Behavior - no lockfile means no prompt', () => {
        return fc.assert(
            fc.asyncProperty(
                fc.constant(null), // No lockfile
                async (lockfile) => {
                    // Reset stub history for each iteration
                    showInformationMessageStub.resetHistory();
                    RepositoryActivationService.resetInstance();
                    
                    // Arrange
                    const mockLockfileManager = sandbox.createStubInstance(LockfileManager);
                    const mockHubManager = sandbox.createStubInstance(HubManager);
                    const mockStorage = sandbox.createStubInstance(RegistryStorage);
                    
                    mockLockfileManager.read.resolves(lockfile);
                    
                    const service = new RepositoryActivationService(
                        mockLockfileManager,
                        mockHubManager,
                        mockStorage,
                        TEST_WORKSPACE_ROOT
                    );

                    // Act
                    await service.checkAndPromptActivation();

                    // Assert - should never prompt without lockfile
                    assert.ok(!showInformationMessageStub.called,
                        'Should never prompt when no lockfile exists');
                }
            ),
            { numRuns: 100 }
        );
    });

    test('Property 11: Repository Activation Prompt Behavior - remember declined persists across calls', () => {
        return fc.assert(
            fc.asyncProperty(
                LockfileGenerators.lockfile({ minBundles: 1, maxBundles: 5 }),
                fc.string({ minLength: 5, maxLength: 50 }).map(s => `/repo/${s.replace(/[^a-zA-Z0-9-]/g, 'a')}`),
                async (lockfile, repositoryPath) => {
                    // Reset stub history for each iteration
                    showInformationMessageStub.resetHistory();
                    showInformationMessageStub.resolves('Don\'t ask again');
                    RepositoryActivationService.resetInstance();
                    
                    // Arrange
                    const mockLockfileManager = sandbox.createStubInstance(LockfileManager);
                    const mockHubManager = sandbox.createStubInstance(HubManager);
                    const mockStorage = sandbox.createStubInstance(RegistryStorage);
                    
                    mockLockfileManager.read.resolves(lockfile);
                    mockLockfileManager.getLockfilePath.returns(`${repositoryPath}/prompt-registry.lock.json`);
                    
                    const declinedList: string[] = [];
                    const updateStub = sandbox.stub().callsFake(async (key: string, value: string[]) => {
                        declinedList.length = 0;
                        declinedList.push(...value);
                    });
                    
                    const getStub = sandbox.stub().callsFake((key: string, defaultValue: any) => {
                        if (key === 'repositoryActivation.declined') {
                            return declinedList.length > 0 ? [...declinedList] : defaultValue;
                        }
                        return defaultValue;
                    });
                    
                    const mockContext = {
                        globalState: {
                            get: getStub,
                            update: updateStub
                        }
                    } as any;
                    
                    // Return the same context every time getContext is called
                    mockStorage.getContext.returns(mockContext);
                    
                    const service = new RepositoryActivationService(
                        mockLockfileManager,
                        mockHubManager,
                        mockStorage,
                        repositoryPath
                    );

                    // Act - first call with "Don't ask again"
                    await service.checkAndPromptActivation();
                    const firstCallCount = showInformationMessageStub.callCount;
                    
                    // Act - second call should not prompt
                    showInformationMessageStub.resetHistory();
                    await service.checkAndPromptActivation();
                    const secondCallCount = showInformationMessageStub.callCount;

                    // Assert - first call prompts, second call doesn't
                    assert.strictEqual(firstCallCount, 1,
                        'First call should show prompt');
                    assert.strictEqual(secondCallCount, 0,
                        'Second call should not show prompt after "Don\'t ask again"');
                    assert.ok(declinedList.includes(repositoryPath),
                        'Repository should be in declined list');
                }
            ),
            { numRuns: 100 }
        );
    });
});


/**
 * Feature: repository-level-installation, Property 14: Missing Source/Hub Detection
 * 
 * For any workspace opened with a lockfile containing unconfigured sources/hubs,
 * the extension SHALL detect and offer to add them.
 */
suite('RepositoryActivationService - Property Tests (Missing Sources/Hubs)', () => {
    let sandbox: sinon.SinonSandbox;
    let showInformationMessageStub: sinon.SinonStub;

    setup(() => {
        sandbox = sinon.createSandbox();
        showInformationMessageStub = sandbox.stub(vscode.window, 'showInformationMessage');
        RepositoryActivationService.resetInstance();
    });

    teardown(() => {
        sandbox.restore();
        RepositoryActivationService.resetInstance();
    });

    test('Property 14: Missing Source/Hub Detection - detects all missing sources', () => {
        return fc.assert(
            fc.asyncProperty(
                LockfileGenerators.lockfile({ minBundles: 1, maxBundles: 5 }),
                async (lockfile) => {
                    RepositoryActivationService.resetInstance();
                    
                    // Arrange
                    const mockLockfileManager = sandbox.createStubInstance(LockfileManager);
                    const mockHubManager = sandbox.createStubInstance(HubManager);
                    const mockStorage = sandbox.createStubInstance(RegistryStorage);
                    
                    // No sources configured
                    mockStorage.getSources.resolves([]);
                    mockHubManager.listHubs.resolves([]);
                    
                    const service = new RepositoryActivationService(
                        mockLockfileManager,
                        mockHubManager,
                        mockStorage,
                        TEST_WORKSPACE_ROOT
                    );

                    // Act
                    const result = await service.checkAndOfferMissingSources(lockfile);

                    // Assert - should detect all sources in lockfile
                    const lockfileSourceIds = Object.keys(lockfile.sources);
                    assert.strictEqual(result.missingSources.length, lockfileSourceIds.length,
                        'Should detect all missing sources');
                    
                    for (const sourceId of lockfileSourceIds) {
                        assert.ok(result.missingSources.includes(sourceId),
                            `Should detect missing source: ${sourceId}`);
                    }
                }
            ),
            { numRuns: 100 }
        );
    });

    test('Property 14: Missing Source/Hub Detection - detects all missing hubs', () => {
        return fc.assert(
            fc.asyncProperty(
                LockfileGenerators.lockfile({ minBundles: 1, maxBundles: 5, includeHubs: true }),
                async (lockfile) => {
                    RepositoryActivationService.resetInstance();
                    
                    // Arrange
                    const mockLockfileManager = sandbox.createStubInstance(LockfileManager);
                    const mockHubManager = sandbox.createStubInstance(HubManager);
                    const mockStorage = sandbox.createStubInstance(RegistryStorage);
                    
                    // No hubs configured
                    mockStorage.getSources.resolves([]);
                    mockHubManager.listHubs.resolves([]);
                    
                    const service = new RepositoryActivationService(
                        mockLockfileManager,
                        mockHubManager,
                        mockStorage,
                        TEST_WORKSPACE_ROOT
                    );

                    // Act
                    const result = await service.checkAndOfferMissingSources(lockfile);

                    // Assert - should detect all hubs in lockfile
                    if (lockfile.hubs) {
                        const lockfileHubIds = Object.keys(lockfile.hubs);
                        assert.strictEqual(result.missingHubs.length, lockfileHubIds.length,
                            'Should detect all missing hubs');
                        
                        for (const hubId of lockfileHubIds) {
                            assert.ok(result.missingHubs.includes(hubId),
                                `Should detect missing hub: ${hubId}`);
                        }
                    }
                }
            ),
            { numRuns: 100 }
        );
    });

    test('Property 14: Missing Source/Hub Detection - does not report configured sources', () => {
        return fc.assert(
            fc.asyncProperty(
                LockfileGenerators.consistentLockfile({ minBundles: 1, maxBundles: 5 }),
                async (lockfile) => {
                    RepositoryActivationService.resetInstance();
                    
                    // Arrange
                    const mockLockfileManager = sandbox.createStubInstance(LockfileManager);
                    const mockHubManager = sandbox.createStubInstance(HubManager);
                    const mockStorage = sandbox.createStubInstance(RegistryStorage);
                    
                    // Configure all sources from lockfile
                    const configuredSources = Object.entries(lockfile.sources).map(([id, source]) => ({
                        id,
                        type: source.type,
                        url: source.url,
                        enabled: true
                    }));
                    mockStorage.getSources.resolves(configuredSources as any);
                    mockHubManager.listHubs.resolves([]);
                    
                    const service = new RepositoryActivationService(
                        mockLockfileManager,
                        mockHubManager,
                        mockStorage,
                        TEST_WORKSPACE_ROOT
                    );

                    // Act
                    const result = await service.checkAndOfferMissingSources(lockfile);

                    // Assert - should not report any missing sources
                    assert.strictEqual(result.missingSources.length, 0,
                        'Should not report configured sources as missing');
                }
            ),
            { numRuns: 100 }
        );
    });

    test('Property 14: Missing Source/Hub Detection - does not report configured hubs', () => {
        return fc.assert(
            fc.asyncProperty(
                LockfileGenerators.lockfile({ minBundles: 1, maxBundles: 5, includeHubs: true }),
                async (lockfile) => {
                    RepositoryActivationService.resetInstance();
                    
                    // Arrange
                    const mockLockfileManager = sandbox.createStubInstance(LockfileManager);
                    const mockHubManager = sandbox.createStubInstance(HubManager);
                    const mockStorage = sandbox.createStubInstance(RegistryStorage);
                    
                    mockStorage.getSources.resolves([]);
                    
                    // Configure all hubs from lockfile
                    if (lockfile.hubs) {
                        const configuredHubs = Object.keys(lockfile.hubs).map(id => ({
                            id,
                            name: lockfile.hubs![id].name,
                            description: '',
                            reference: { type: 'url' as const, location: lockfile.hubs![id].url }
                        }));
                        mockHubManager.listHubs.resolves(configuredHubs);
                    } else {
                        mockHubManager.listHubs.resolves([]);
                    }
                    
                    const service = new RepositoryActivationService(
                        mockLockfileManager,
                        mockHubManager,
                        mockStorage,
                        TEST_WORKSPACE_ROOT
                    );

                    // Act
                    const result = await service.checkAndOfferMissingSources(lockfile);

                    // Assert - should not report any missing hubs
                    assert.strictEqual(result.missingHubs.length, 0,
                        'Should not report configured hubs as missing');
                }
            ),
            { numRuns: 100 }
        );
    });

    test('Property 14: Missing Source/Hub Detection - offers to add when sources missing', () => {
        return fc.assert(
            fc.asyncProperty(
                LockfileGenerators.lockfile({ minBundles: 1, maxBundles: 5 }),
                fc.constantFrom('Add Sources', 'Not now', undefined),
                async (lockfile, userChoice) => {
                    // Reset stub history for each iteration
                    showInformationMessageStub.resetHistory();
                    showInformationMessageStub.resolves(userChoice);
                    RepositoryActivationService.resetInstance();
                    
                    // Arrange
                    const mockLockfileManager = sandbox.createStubInstance(LockfileManager);
                    const mockHubManager = sandbox.createStubInstance(HubManager);
                    const mockStorage = sandbox.createStubInstance(RegistryStorage);
                    
                    // No sources configured
                    mockStorage.getSources.resolves([]);
                    mockHubManager.listHubs.resolves([]);
                    
                    const service = new RepositoryActivationService(
                        mockLockfileManager,
                        mockHubManager,
                        mockStorage,
                        TEST_WORKSPACE_ROOT
                    );

                    // Act
                    const result = await service.checkAndOfferMissingSources(lockfile);

                    // Assert - should offer to add missing sources
                    if (result.missingSources.length > 0) {
                        assert.ok(showInformationMessageStub.called,
                            'Should show prompt when sources are missing');
                        assert.ok(result.offeredToAdd,
                            'Should indicate that offer was made');
                    }
                }
            ),
            { numRuns: 100 }
        );
    });

    test('Property 14: Missing Source/Hub Detection - partial configuration detected correctly', () => {
        return fc.assert(
            fc.asyncProperty(
                LockfileGenerators.lockfile({ minBundles: 2, maxBundles: 5 }),
                async (lockfile) => {
                    RepositoryActivationService.resetInstance();
                    
                    // Arrange
                    const mockLockfileManager = sandbox.createStubInstance(LockfileManager);
                    const mockHubManager = sandbox.createStubInstance(HubManager);
                    const mockStorage = sandbox.createStubInstance(RegistryStorage);
                    
                    // Configure only first source
                    const sourceIds = Object.keys(lockfile.sources);
                    if (sourceIds.length > 1) {
                        const firstSourceId = sourceIds[0];
                        const firstSource = lockfile.sources[firstSourceId];
                        mockStorage.getSources.resolves([{
                            id: firstSourceId,
                            type: firstSource.type,
                            url: firstSource.url,
                            enabled: true
                        } as any]);
                    } else {
                        mockStorage.getSources.resolves([]);
                    }
                    
                    mockHubManager.listHubs.resolves([]);
                    
                    const service = new RepositoryActivationService(
                        mockLockfileManager,
                        mockHubManager,
                        mockStorage,
                        TEST_WORKSPACE_ROOT
                    );

                    // Act
                    const result = await service.checkAndOfferMissingSources(lockfile);

                    // Assert - should detect only unconfigured sources
                    const totalSources = Object.keys(lockfile.sources).length;
                    const configuredCount = sourceIds.length > 1 ? 1 : 0;
                    const expectedMissing = totalSources - configuredCount;
                    
                    assert.strictEqual(result.missingSources.length, expectedMissing,
                        `Should detect ${expectedMissing} missing sources (${totalSources} total - ${configuredCount} configured)`);
                }
            ),
            { numRuns: 100 }
        );
    });

    test('Property 14: Missing Source/Hub Detection - empty lockfile returns empty results', () => {
        return fc.assert(
            fc.asyncProperty(
                fc.constant(null), // Just run once with a manually created empty lockfile
                async () => {
                    RepositoryActivationService.resetInstance();
                    
                    // Create a truly empty lockfile (no bundles, no sources)
                    const lockfile: Lockfile = {
                        $schema: LOCKFILE_DEFAULTS.SCHEMA_URL,
                        version: '1.0.0',
                        generatedAt: new Date().toISOString(),
                        generatedBy: LOCKFILE_DEFAULTS.GENERATED_BY,
                        bundles: {},
                        sources: {}
                    };
                    
                    // Arrange
                    const mockLockfileManager = sandbox.createStubInstance(LockfileManager);
                    const mockHubManager = sandbox.createStubInstance(HubManager);
                    const mockStorage = sandbox.createStubInstance(RegistryStorage);
                    
                    mockStorage.getSources.resolves([]);
                    mockHubManager.listHubs.resolves([]);
                    
                    const service = new RepositoryActivationService(
                        mockLockfileManager,
                        mockHubManager,
                        mockStorage,
                        TEST_WORKSPACE_ROOT
                    );

                    // Act
                    const result = await service.checkAndOfferMissingSources(lockfile);

                    // Assert - empty lockfile should have no missing sources/hubs
                    assert.strictEqual(result.missingSources.length, 0,
                        'Empty lockfile should have no missing sources');
                    assert.strictEqual(result.missingHubs.length, 0,
                        'Empty lockfile should have no missing hubs');
                    assert.ok(!result.offeredToAdd,
                        'Should not offer to add when nothing is missing');
                }
            ),
            { numRuns: 100 }
        );
    });

    test('Property 14: Missing Source/Hub Detection - detection is deterministic', () => {
        return fc.assert(
            fc.asyncProperty(
                LockfileGenerators.lockfile({ minBundles: 1, maxBundles: 5 }),
                async (lockfile) => {
                    RepositoryActivationService.resetInstance();
                    
                    // Arrange
                    const mockLockfileManager = sandbox.createStubInstance(LockfileManager);
                    const mockHubManager = sandbox.createStubInstance(HubManager);
                    const mockStorage = sandbox.createStubInstance(RegistryStorage);
                    
                    mockStorage.getSources.resolves([]);
                    mockHubManager.listHubs.resolves([]);
                    
                    const service = new RepositoryActivationService(
                        mockLockfileManager,
                        mockHubManager,
                        mockStorage,
                        TEST_WORKSPACE_ROOT
                    );

                    // Act - call twice with same inputs
                    const result1 = await service.checkAndOfferMissingSources(lockfile);
                    const result2 = await service.checkAndOfferMissingSources(lockfile);

                    // Assert - results should be identical
                    assert.deepStrictEqual(result1.missingSources.sort(), result2.missingSources.sort(),
                        'Missing sources detection should be deterministic');
                    assert.deepStrictEqual(result1.missingHubs.sort(), result2.missingHubs.sort(),
                        'Missing hubs detection should be deterministic');
                }
            ),
            { numRuns: 100 }
        );
    });
});

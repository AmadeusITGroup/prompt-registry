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
import { SetupStateManager } from '../../src/services/SetupStateManager';
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

    test('Property 11: Repository Activation - lockfile presence triggers source detection (no activation prompt per Requirement 1.6)', () => {
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
                    // Configure all sources so no missing sources prompt is shown
                    const sourceIds = Object.keys(lockfile.sources || {});
                    const configuredSources = sourceIds.map(id => ({
                        id,
                        type: lockfile.sources![id].type,
                        url: lockfile.sources![id].url,
                        name: `Source ${id}`,
                        enabled: true,
                        priority: 0
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
                    await service.checkAndPromptActivation();

                    // Assert - lockfile should be read (source detection happens)
                    // No activation prompt is shown per Requirement 1.6
                    assert.ok(mockLockfileManager.read.calledOnce,
                        'Should read lockfile for source detection');
                }
            ),
            { numRuns: 100 }
        );
    });

    test('Property 11: Repository Activation - declined repositories never trigger detection', () => {
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

    test('Property 11: Repository Activation - checks for missing sources when lockfile exists', () => {
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
                    // No sources configured - will trigger missing sources detection
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

                    // Assert - should check for missing sources (no activation prompt per Requirement 1.6)
                    assert.ok(mockLockfileManager.read.calledOnce,
                        'Should read lockfile to check for missing sources');
                }
            ),
            { numRuns: 100 }
        );
    });

    test('Property 11: Repository Activation - no activation prompt shown (Requirement 1.6)', () => {
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
                    
                    const updateStub = sandbox.stub();
                    const mockContext = {
                        globalState: {
                            get: sandbox.stub().returns([]),
                            update: updateStub
                        }
                    } as any;
                    mockStorage.getContext.returns(mockContext);
                    
                    // All sources configured - no missing sources prompt
                    const sourceIds = Object.keys(lockfile.sources || {});
                    const configuredSources = sourceIds.map(id => ({
                        id,
                        type: lockfile.sources![id].type,
                        url: lockfile.sources![id].url,
                        name: `Source ${id}`,
                        enabled: true,
                        priority: 0
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
                    await service.checkAndPromptActivation();

                    // Assert - no activation prompt should be shown (Requirement 1.6)
                    // Files are already in repository, no need to ask user to "enable"
                    if (showInformationMessageStub.called) {
                        const message = showInformationMessageStub.firstCall.args[0] as string;
                        assert.ok(!message.toLowerCase().includes('enable'),
                            'Should not show activation prompt - files already in repository');
                    }
                }
            ),
            { numRuns: 100 }
        );
    });

    test('Property 11: Repository Activation - does not call enableRepositoryBundles automatically', () => {
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
                    
                    // All sources configured
                    const sourceIds = Object.keys(lockfile.sources || {});
                    const configuredSources = sourceIds.map(id => ({
                        id,
                        type: lockfile.sources![id].type,
                        url: lockfile.sources![id].url,
                        name: `Source ${id}`,
                        enabled: true,
                        priority: 0
                    }));
                    mockStorage.getSources.resolves(configuredSources as any);
                    mockHubManager.listHubs.resolves([]);
                    mockStorage.getInstalledBundles.resolves([]);
                    
                    const service = new RepositoryActivationService(
                        mockLockfileManager,
                        mockHubManager,
                        mockStorage,
                        TEST_WORKSPACE_ROOT
                    );

                    // Act
                    await service.checkAndPromptActivation();

                    // Assert - should NOT call getInstalledBundles (no automatic enablement)
                    // Files are already in repository per Requirement 1.6
                    assert.ok(!mockStorage.getInstalledBundles.called,
                        'Should not call getInstalledBundles - files already in repository');
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

    test('Property 11: Repository Activation - declined repositories skip source detection', () => {
        return fc.assert(
            fc.asyncProperty(
                LockfileGenerators.lockfile({ minBundles: 1, maxBundles: 5 }),
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
                    
                    // Repository is already in declined list
                    const declinedList = [repositoryPath];
                    const getStub = sandbox.stub().callsFake((key: string, defaultValue: any) => {
                        if (key === 'repositoryActivation.declined') {
                            return [...declinedList];
                        }
                        return defaultValue;
                    });
                    
                    const mockContext = {
                        globalState: {
                            get: getStub,
                            update: sandbox.stub()
                        }
                    } as any;
                    
                    mockStorage.getContext.returns(mockContext);
                    mockStorage.getSources.resolves([]);
                    mockHubManager.listHubs.resolves([]);
                    
                    const service = new RepositoryActivationService(
                        mockLockfileManager,
                        mockHubManager,
                        mockStorage,
                        repositoryPath
                    );

                    // Act
                    await service.checkAndPromptActivation();

                    // Assert - should not show any prompt for declined repositories
                    assert.ok(!showInformationMessageStub.called,
                        'Should not show any prompt for declined repositories');
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


/**
 * Feature: lockfile-timing-and-hub-decoupling, Setup Timing Properties
 * 
 * Property 1: Setup Timing Invariant
 * Source/hub detection MUST NOT occur before setup is complete.
 * 
 * Property 5: Fail-Open Behavior
 * If SetupStateManager is unavailable, detection MUST proceed.
 * 
 * **Validates: Requirements 1.1, 1.2, 1.4, 6.4**
 */
suite('RepositoryActivationService - Setup Timing Properties', () => {
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

    /**
     * Property 1: Setup Timing Invariant
     * 
     * **Validates: Requirements 1.1, 1.4**
     * 
     * Statement: Source/hub detection MUST NOT occur before setup is complete.
     * 
     * ∀ activation events:
     *   IF SetupStateManager.isComplete() = false
     *   THEN RepositoryActivationService.checkAndPromptActivation() returns early
     *   AND no user prompts are shown
     */
    test('Property 1: Setup Timing Invariant - detection never occurs when setup incomplete', () => {
        return fc.assert(
            fc.asyncProperty(
                LockfileGenerators.lockfile({ minBundles: 1, maxBundles: 10 }),
                fc.constantFrom('not_started', 'in_progress', 'incomplete'),
                async (lockfile, setupState) => {
                    // Reset stub history for each iteration
                    showInformationMessageStub.resetHistory();
                    RepositoryActivationService.resetInstance();
                    
                    // Arrange
                    const mockLockfileManager = sandbox.createStubInstance(LockfileManager);
                    const mockHubManager = sandbox.createStubInstance(HubManager);
                    const mockStorage = sandbox.createStubInstance(RegistryStorage);
                    const mockSetupStateManager = sandbox.createStubInstance(SetupStateManager);
                    
                    // Setup state is NOT complete
                    mockSetupStateManager.isComplete.resolves(false);
                    mockSetupStateManager.getState.resolves(setupState as any);
                    
                    mockLockfileManager.read.resolves(lockfile);
                    mockLockfileManager.getLockfilePath.returns('/repo/prompt-registry.lock.json');
                    
                    // Mock storage to return no configured sources (so prompt would be shown if detection proceeds)
                    mockStorage.getSources.resolves([]);
                    mockHubManager.listHubs.resolves([]);
                    
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
                        TEST_WORKSPACE_ROOT,
                        undefined, // bundleInstaller
                        mockSetupStateManager
                    );

                    // Act
                    await service.checkAndPromptActivation();

                    // Assert - no prompts should be shown when setup is incomplete
                    assert.ok(!showInformationMessageStub.called,
                        `Should NOT show any prompts when setup state is '${setupState}' (not complete)`);
                    
                    // Verify that storage.getSources was NOT called (early return before source check)
                    assert.ok(!mockStorage.getSources.called,
                        'Should NOT check for missing sources when setup is incomplete');
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 1 (continued): Setup Timing Invariant - detection proceeds when setup IS complete
     * 
     * **Validates: Requirements 1.2**
     * 
     * Statement: When setup IS complete, detection should proceed normally.
     * This is verified by checking that the service attempts to check for missing sources.
     */
    test('Property 1: Setup Timing Invariant - detection proceeds when setup is complete', () => {
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
                    const mockSetupStateManager = sandbox.createStubInstance(SetupStateManager);
                    
                    // Setup state IS complete
                    mockSetupStateManager.isComplete.resolves(true);
                    
                    mockLockfileManager.read.resolves(lockfile);
                    mockLockfileManager.getLockfilePath.returns('/repo/prompt-registry.lock.json');
                    
                    // Mock storage to return no configured sources (so prompt will be shown)
                    mockStorage.getSources.resolves([]);
                    mockHubManager.listHubs.resolves([]);
                    
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
                        TEST_WORKSPACE_ROOT,
                        undefined, // bundleInstaller
                        mockSetupStateManager
                    );

                    // Act
                    await service.checkAndPromptActivation();

                    // Assert - detection should proceed when setup is complete
                    // Verify by checking that storage.getSources was called (source detection proceeded)
                    assert.ok(mockStorage.getSources.called,
                        'Should check for missing sources when setup is complete');
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 5: Fail-Open Behavior
     * 
     * **Validates: Requirements 6.4**
     * 
     * Statement: If SetupStateManager is unavailable, detection MUST proceed.
     * 
     * IF setupStateManager = undefined
     * THEN isSetupComplete() = true
     * AND detection proceeds normally
     */
    test('Property 5: Fail-Open Behavior - detection proceeds when SetupStateManager undefined', () => {
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
                    
                    // Mock storage to return no configured sources (so prompt will be shown)
                    mockStorage.getSources.resolves([]);
                    mockHubManager.listHubs.resolves([]);
                    
                    // Mock context with no declined repositories
                    const mockContext = {
                        globalState: {
                            get: sandbox.stub().returns([])
                        }
                    } as any;
                    mockStorage.getContext.returns(mockContext);
                    
                    // Create service WITHOUT SetupStateManager (undefined)
                    const service = new RepositoryActivationService(
                        mockLockfileManager,
                        mockHubManager,
                        mockStorage,
                        TEST_WORKSPACE_ROOT,
                        undefined, // bundleInstaller
                        undefined  // setupStateManager - explicitly undefined for fail-open
                    );

                    // Act
                    await service.checkAndPromptActivation();

                    // Assert - detection should proceed (fail-open behavior)
                    // When SetupStateManager is undefined, the service should assume setup is complete
                    // Verify by checking that storage.getSources was called (source detection proceeded)
                    assert.ok(mockStorage.getSources.called,
                        'Should proceed with source detection when SetupStateManager is undefined (fail-open)');
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 5 (continued): Fail-Open Behavior - contrast with defined SetupStateManager
     * 
     * **Validates: Requirements 6.4**
     * 
     * This test verifies that when SetupStateManager IS defined and returns incomplete,
     * detection is blocked - contrasting with the fail-open behavior when undefined.
     */
    test('Property 5: Fail-Open Behavior - contrast: defined SetupStateManager blocks when incomplete', () => {
        return fc.assert(
            fc.asyncProperty(
                LockfileGenerators.lockfile({ minBundles: 1, maxBundles: 10 }),
                async (lockfile) => {
                    // Reset stub history for each iteration
                    showInformationMessageStub.resetHistory();
                    RepositoryActivationService.resetInstance();
                    
                    // Arrange
                    const mockLockfileManager = sandbox.createStubInstance(LockfileManager);
                    const mockHubManager = sandbox.createStubInstance(HubManager);
                    const mockStorage = sandbox.createStubInstance(RegistryStorage);
                    const mockSetupStateManager = sandbox.createStubInstance(SetupStateManager);
                    
                    // Setup state is NOT complete (defined but incomplete)
                    mockSetupStateManager.isComplete.resolves(false);
                    
                    mockLockfileManager.read.resolves(lockfile);
                    mockLockfileManager.getLockfilePath.returns('/repo/prompt-registry.lock.json');
                    
                    // Mock storage to return no configured sources
                    mockStorage.getSources.resolves([]);
                    mockHubManager.listHubs.resolves([]);
                    
                    // Mock context with no declined repositories
                    const mockContext = {
                        globalState: {
                            get: sandbox.stub().returns([])
                        }
                    } as any;
                    mockStorage.getContext.returns(mockContext);
                    
                    // Create service WITH SetupStateManager that returns incomplete
                    const service = new RepositoryActivationService(
                        mockLockfileManager,
                        mockHubManager,
                        mockStorage,
                        TEST_WORKSPACE_ROOT,
                        undefined, // bundleInstaller
                        mockSetupStateManager // defined SetupStateManager
                    );

                    // Act
                    await service.checkAndPromptActivation();

                    // Assert - detection should be blocked when SetupStateManager is defined and incomplete
                    assert.ok(!mockStorage.getSources.called,
                        'Should NOT check for missing sources when SetupStateManager is defined and returns incomplete');
                }
            ),
            { numRuns: 100 }
        );
    });

    /**
     * Property 1 & 5 Combined: Deterministic behavior across setup states
     * 
     * **Validates: Requirements 1.1, 1.2, 6.4**
     * 
     * This test verifies that the behavior is deterministic:
     * - undefined SetupStateManager -> always proceeds (fail-open)
     * - defined SetupStateManager with isComplete=true -> always proceeds
     * - defined SetupStateManager with isComplete=false -> always blocks
     */
    test('Property 1 & 5: Deterministic behavior across setup states', () => {
        return fc.assert(
            fc.asyncProperty(
                LockfileGenerators.lockfile({ minBundles: 1, maxBundles: 5 }),
                fc.constantFrom('undefined', 'complete', 'incomplete'),
                async (lockfile, setupManagerState) => {
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
                    
                    // Mock storage to return no configured sources
                    mockStorage.getSources.resolves([]);
                    mockHubManager.listHubs.resolves([]);
                    
                    const mockContext = {
                        globalState: {
                            get: sandbox.stub().returns([])
                        }
                    } as any;
                    mockStorage.getContext.returns(mockContext);
                    
                    // Configure SetupStateManager based on test case
                    let mockSetupStateManager: sinon.SinonStubbedInstance<SetupStateManager> | undefined;
                    if (setupManagerState !== 'undefined') {
                        mockSetupStateManager = sandbox.createStubInstance(SetupStateManager);
                        mockSetupStateManager.isComplete.resolves(setupManagerState === 'complete');
                    }
                    
                    const service = new RepositoryActivationService(
                        mockLockfileManager,
                        mockHubManager,
                        mockStorage,
                        TEST_WORKSPACE_ROOT,
                        undefined,
                        mockSetupStateManager
                    );

                    // Act
                    await service.checkAndPromptActivation();

                    // Assert - behavior should be deterministic based on setup state
                    const shouldProceed = setupManagerState === 'undefined' || setupManagerState === 'complete';
                    
                    if (shouldProceed) {
                        assert.ok(mockStorage.getSources.called,
                            `Should proceed with source detection when setupManagerState='${setupManagerState}'`);
                    } else {
                        assert.ok(!mockStorage.getSources.called,
                            `Should block source detection when setupManagerState='${setupManagerState}'`);
                    }
                }
            ),
            { numRuns: 100 }
        );
    });
});

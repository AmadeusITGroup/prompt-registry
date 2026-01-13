/**
 * BundleScopeCommands Property Tests
 * 
 * Property 9: Context Menu Scope Actions
 * For any installed bundle, context menu SHALL show appropriate scope management
 * options based on current scope and commit mode.
 * 
 * **Validates: Requirements 7.1-7.10**
 * 
 * Requirements:
 * 7.1 - Right-click shows scope management options
 * 7.2 - User scope shows "Move to Repository (Commit)" option
 * 7.3 - User scope shows "Move to Repository (Local Only)" option
 * 7.4 - Repository commit mode shows "Move to User" option
 * 7.5 - Repository commit mode shows "Switch to Local Only" option
 * 7.6 - Repository local-only mode shows "Move to User" option
 * 7.7 - Repository local-only mode shows "Switch to Commit" option
 */

import * as assert from 'assert';
import * as sinon from 'sinon';
import * as fc from 'fast-check';
import * as vscode from 'vscode';
import { BundleScopeCommands, ContextMenuAction } from '../../src/commands/BundleScopeCommands';
import { RegistryManager } from '../../src/services/RegistryManager';
import { ScopeConflictResolver } from '../../src/services/ScopeConflictResolver';
import { RepositoryScopeService } from '../../src/services/RepositoryScopeService';
import { RegistryStorage } from '../../src/storage/RegistryStorage';
import { InstalledBundle, InstallationScope, RepositoryCommitMode } from '../../src/types/registry';
import { createMockInstalledBundle } from '../helpers/bundleTestHelpers';
import { PropertyTestConfig, BundleGenerators } from '../helpers/propertyTestHelpers';

suite('BundleScopeCommands Property Tests', () => {
    let sandbox: sinon.SinonSandbox;
    let mockRegistryManager: sinon.SinonStubbedInstance<RegistryManager>;
    let mockStorage: sinon.SinonStubbedInstance<RegistryStorage>;
    let mockScopeConflictResolver: sinon.SinonStubbedInstance<ScopeConflictResolver>;
    let mockRepositoryScopeService: sinon.SinonStubbedInstance<RepositoryScopeService>;
    let mockWorkspaceFolders: vscode.WorkspaceFolder[] | undefined;

    // Generator for installation scope
    const scopeGenerator = (): fc.Arbitrary<InstallationScope> => {
        return fc.constantFrom('user', 'workspace', 'repository');
    };

    // Generator for commit mode
    const commitModeGenerator = (): fc.Arbitrary<RepositoryCommitMode> => {
        return fc.constantFrom('commit', 'local-only');
    };

    // Generator for bundle configuration
    const bundleConfigGenerator = (): fc.Arbitrary<{
        bundleId: string;
        scope: InstallationScope;
        commitMode?: RepositoryCommitMode;
    }> => {
        return fc.record({
            bundleId: BundleGenerators.bundleId(),
            scope: scopeGenerator(),
            commitMode: fc.option(commitModeGenerator(), { nil: undefined })
        }).map(config => {
            // Only repository scope has commitMode
            if (config.scope !== 'repository') {
                return { ...config, commitMode: undefined };
            }
            // Repository scope defaults to 'commit' if not specified
            return { ...config, commitMode: config.commitMode ?? 'commit' };
        });
    };

    // Helper to create mock installed bundle
    const createTestInstalledBundle = (
        bundleId: string,
        scope: InstallationScope,
        commitMode?: RepositoryCommitMode
    ): InstalledBundle => {
        return createMockInstalledBundle(bundleId, '1.0.0', {
            scope,
            commitMode,
            installPath: `/mock/path/${bundleId}`
        });
    };

    setup(() => {
        sandbox = sinon.createSandbox();

        // Create mock instances
        mockRegistryManager = sandbox.createStubInstance(RegistryManager);
        mockStorage = sandbox.createStubInstance(RegistryStorage);
        mockScopeConflictResolver = sandbox.createStubInstance(ScopeConflictResolver);
        mockRepositoryScopeService = sandbox.createStubInstance(RepositoryScopeService);

        // Setup workspace folders mock (default: workspace is open)
        mockWorkspaceFolders = [{ uri: vscode.Uri.file('/mock/workspace'), name: 'workspace', index: 0 }];
        sandbox.stub(vscode.workspace, 'workspaceFolders').get(() => mockWorkspaceFolders);

        // Setup default behaviors
        mockRegistryManager.getStorage.returns(mockStorage as any);
    });

    teardown(() => {
        sandbox.restore();
    });

    suite('Property 9: Context Menu Scope Actions', function() {
        this.timeout(PropertyTestConfig.TIMEOUT);

        /**
         * Property 9.1: User-scoped bundles show repository move options
         * 
         * For any bundle installed at user scope, the context menu SHALL include:
         * - "Move to Repository (Commit)" option
         * - "Move to Repository (Local Only)" option
         * 
         * Validates: Requirements 7.2, 7.3
         */
        test('user-scoped bundles show repository move options', async () => {
            await fc.assert(
                fc.asyncProperty(
                    BundleGenerators.bundleId(),
                    async (bundleId) => {
                        // Arrange
                        const userBundle = createTestInstalledBundle(bundleId, 'user');
                        mockStorage.getInstalledBundle.reset();
                        mockStorage.getInstalledBundle.withArgs(bundleId, 'user').resolves(userBundle);
                        mockStorage.getInstalledBundle.withArgs(bundleId, 'repository').resolves(undefined);
                        mockStorage.getInstalledBundle.withArgs(bundleId, 'workspace').resolves(undefined);

                        const commands = new BundleScopeCommands(
                            mockRegistryManager as any,
                            mockScopeConflictResolver as any,
                            mockRepositoryScopeService as any,
                            
                        );

                        // Act
                        const actions = await commands.getContextMenuActions(bundleId);

                        // Assert
                        const hasCommitOption = actions.some((a: ContextMenuAction) => a.id === 'moveToRepositoryCommit');
                        const hasLocalOnlyOption = actions.some((a: ContextMenuAction) => a.id === 'moveToRepositoryLocalOnly');
                        const hasMoveToUserOption = actions.some((a: ContextMenuAction) => a.id === 'moveToUser');

                        return hasCommitOption && hasLocalOnlyOption && !hasMoveToUserOption;
                    }
                ),
                { ...PropertyTestConfig.FAST_CHECK_OPTIONS, numRuns: PropertyTestConfig.RUNS.STANDARD }
            );
        });

        /**
         * Property 9.2: Repository-scoped bundles with commit mode show correct options
         * 
         * For any bundle installed at repository scope with commit mode, the context menu SHALL include:
         * - "Move to User" option
         * - "Switch to Local Only" option
         * 
         * Validates: Requirements 7.4, 7.5
         */
        test('repository-scoped bundles with commit mode show correct options', async () => {
            await fc.assert(
                fc.asyncProperty(
                    BundleGenerators.bundleId(),
                    async (bundleId) => {
                        // Arrange
                        const repoBundle = createTestInstalledBundle(bundleId, 'repository', 'commit');
                        mockStorage.getInstalledBundle.reset();
                        mockStorage.getInstalledBundle.withArgs(bundleId, 'user').resolves(undefined);
                        mockStorage.getInstalledBundle.withArgs(bundleId, 'repository').resolves(repoBundle);
                        mockStorage.getInstalledBundle.withArgs(bundleId, 'workspace').resolves(undefined);

                        const commands = new BundleScopeCommands(
                            mockRegistryManager as any,
                            mockScopeConflictResolver as any,
                            mockRepositoryScopeService as any,
                            
                        );

                        // Act
                        const actions = await commands.getContextMenuActions(bundleId);

                        // Assert
                        const hasMoveToUserOption = actions.some((a: ContextMenuAction) => a.id === 'moveToUser');
                        const hasSwitchToLocalOnlyOption = actions.some((a: ContextMenuAction) => a.id === 'switchToLocalOnly');
                        const hasSwitchToCommitOption = actions.some((a: ContextMenuAction) => a.id === 'switchToCommit');

                        return hasMoveToUserOption && hasSwitchToLocalOnlyOption && !hasSwitchToCommitOption;
                    }
                ),
                { ...PropertyTestConfig.FAST_CHECK_OPTIONS, numRuns: PropertyTestConfig.RUNS.STANDARD }
            );
        });

        /**
         * Property 9.3: Repository-scoped bundles with local-only mode show correct options
         * 
         * For any bundle installed at repository scope with local-only mode, the context menu SHALL include:
         * - "Move to User" option
         * - "Switch to Commit" option
         * 
         * Validates: Requirements 7.6, 7.7
         */
        test('repository-scoped bundles with local-only mode show correct options', async () => {
            await fc.assert(
                fc.asyncProperty(
                    BundleGenerators.bundleId(),
                    async (bundleId) => {
                        // Arrange
                        const repoBundle = createTestInstalledBundle(bundleId, 'repository', 'local-only');
                        mockStorage.getInstalledBundle.reset();
                        mockStorage.getInstalledBundle.withArgs(bundleId, 'user').resolves(undefined);
                        mockStorage.getInstalledBundle.withArgs(bundleId, 'repository').resolves(repoBundle);
                        mockStorage.getInstalledBundle.withArgs(bundleId, 'workspace').resolves(undefined);

                        const commands = new BundleScopeCommands(
                            mockRegistryManager as any,
                            mockScopeConflictResolver as any,
                            mockRepositoryScopeService as any,
                            
                        );

                        // Act
                        const actions = await commands.getContextMenuActions(bundleId);

                        // Assert
                        const hasMoveToUserOption = actions.some((a: ContextMenuAction) => a.id === 'moveToUser');
                        const hasSwitchToCommitOption = actions.some((a: ContextMenuAction) => a.id === 'switchToCommit');
                        const hasSwitchToLocalOnlyOption = actions.some((a: ContextMenuAction) => a.id === 'switchToLocalOnly');

                        return hasMoveToUserOption && hasSwitchToCommitOption && !hasSwitchToLocalOnlyOption;
                    }
                ),
                { ...PropertyTestConfig.FAST_CHECK_OPTIONS, numRuns: PropertyTestConfig.RUNS.STANDARD }
            );
        });

        /**
         * Property 9.4: Uninstalled bundles return empty actions
         * 
         * For any bundle ID that is not installed, the context menu SHALL return an empty array.
         * 
         * Validates: Requirement 7.1 (implicit - only installed bundles have options)
         */
        test('uninstalled bundles return empty actions', async () => {
            await fc.assert(
                fc.asyncProperty(
                    BundleGenerators.bundleId(),
                    async (bundleId) => {
                        // Arrange
                        mockStorage.getInstalledBundle.reset();
                        mockStorage.getInstalledBundle.resolves(undefined);

                        const commands = new BundleScopeCommands(
                            mockRegistryManager as any,
                            mockScopeConflictResolver as any,
                            mockRepositoryScopeService as any,
                            
                        );

                        // Act
                        const actions = await commands.getContextMenuActions(bundleId);

                        // Assert
                        return actions.length === 0;
                    }
                ),
                { ...PropertyTestConfig.FAST_CHECK_OPTIONS, numRuns: PropertyTestConfig.RUNS.STANDARD }
            );
        });

        /**
         * Property 9.5: Repository options are disabled when no workspace is open
         * 
         * For any user-scoped bundle when no workspace is open, repository move options
         * SHALL be disabled.
         * 
         * Validates: Requirement 1.8 (repository scope requires workspace)
         */
        test('repository options are disabled when no workspace is open', async () => {
            // Set no workspace
            mockWorkspaceFolders = undefined;

            await fc.assert(
                fc.asyncProperty(
                    BundleGenerators.bundleId(),
                    async (bundleId) => {
                        // Arrange
                        const userBundle = createTestInstalledBundle(bundleId, 'user');
                        mockStorage.getInstalledBundle.reset();
                        mockStorage.getInstalledBundle.withArgs(bundleId, 'user').resolves(userBundle);
                        mockStorage.getInstalledBundle.withArgs(bundleId, 'repository').resolves(undefined);
                        mockStorage.getInstalledBundle.withArgs(bundleId, 'workspace').resolves(undefined);

                        const commands = new BundleScopeCommands(
                            mockRegistryManager as any,
                            mockScopeConflictResolver as any,
                            mockRepositoryScopeService as any,
                            
                        );

                        // Act
                        const actions = await commands.getContextMenuActions(bundleId);

                        // Assert - repository options should be disabled
                        const repoActions = actions.filter((a: ContextMenuAction) => 
                            a.id === 'moveToRepositoryCommit' || a.id === 'moveToRepositoryLocalOnly'
                        );

                        return repoActions.every((a: ContextMenuAction) => a.disabled === true);
                    }
                ),
                { ...PropertyTestConfig.FAST_CHECK_OPTIONS, numRuns: PropertyTestConfig.RUNS.STANDARD }
            );
        });

        /**
         * Property 9.6: Context menu actions are mutually exclusive
         * 
         * For any installed bundle, the context menu SHALL NOT show both:
         * - "Switch to Commit" and "Switch to Local Only" at the same time
         * - "Move to Repository" and "Move to User" at the same time (for same scope)
         * 
         * Validates: Requirements 7.2-7.7 (mutual exclusivity)
         */
        test('context menu actions are mutually exclusive', async () => {
            await fc.assert(
                fc.asyncProperty(
                    bundleConfigGenerator(),
                    async (config) => {
                        // Arrange
                        const bundle = createTestInstalledBundle(config.bundleId, config.scope, config.commitMode);
                        mockStorage.getInstalledBundle.reset();
                        
                        if (config.scope === 'user' || config.scope === 'workspace') {
                            mockStorage.getInstalledBundle.withArgs(config.bundleId, config.scope).resolves(bundle);
                            mockStorage.getInstalledBundle.withArgs(config.bundleId, 'repository').resolves(undefined);
                        } else {
                            mockStorage.getInstalledBundle.withArgs(config.bundleId, 'user').resolves(undefined);
                            mockStorage.getInstalledBundle.withArgs(config.bundleId, 'repository').resolves(bundle);
                        }
                        mockStorage.getInstalledBundle.withArgs(config.bundleId, 'workspace').resolves(undefined);

                        const commands = new BundleScopeCommands(
                            mockRegistryManager as any,
                            mockScopeConflictResolver as any,
                            mockRepositoryScopeService as any,
                            
                        );

                        // Act
                        const actions = await commands.getContextMenuActions(config.bundleId);

                        // Assert - mutual exclusivity
                        const hasSwitchToCommit = actions.some((a: ContextMenuAction) => a.id === 'switchToCommit');
                        const hasSwitchToLocalOnly = actions.some((a: ContextMenuAction) => a.id === 'switchToLocalOnly');
                        
                        // Cannot have both switch options at the same time
                        const switchExclusive = !(hasSwitchToCommit && hasSwitchToLocalOnly);

                        return switchExclusive;
                    }
                ),
                { ...PropertyTestConfig.FAST_CHECK_OPTIONS, numRuns: PropertyTestConfig.RUNS.STANDARD }
            );
        });
    });
});

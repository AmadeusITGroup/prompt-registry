# Dead Code Analysis — Consolidated Report

**Analysis date**: 2026-04-02  
**Tool**: `npm run dead-code:methods` (ts-morph static analysis)  
**Raw output**: `dead-code-analysis/00-raw-output.txt`  
**Detailed analyses**: `01-services-analysis.md`, `02-utils-adapters-analysis.md`, `03-commands-storage-ui-analysis.md`

---

## Summary

| Category | Tool reported | False Positives | Actual Dead Code |
|----------|--------------|-----------------|------------------|
| Zero production callers | 118 | ~13 | ~105 |
| Self-file only callers | 62 | ~29 | ~33 |
| Dead types | 8 | 0 | 8 |
| **Total** | **188** | **~42** | **~146** |

---

## Tool Limitations (Why False Positives Occur)

The ts-morph static analyzer has two known blind spots that produce false positives:

1. **Optional chaining (`?.`)**: `obj?.method()` is not traced as a call site. Affects:
   - `this.hubManager?.deleteAllHubs()` — extension.ts:395
   - `this.treeProvider?.onUpdatesDetected(updates)` — extension.ts:578

2. **Duck-type runtime checks**: `typeof obj.method === 'function'` before invocation.  Affects:
   - `localSkillsAdapter.getSkillName()` — registry-manager.ts:720
   - `localSkillsAdapter.getSkillSourcePath()` — registry-manager.ts:719

Additionally, many self-file-only methods are correctly internal implementation details (wizard steps, internal helpers) and should not be removed.

---

## FALSE POSITIVES (42 items — Do NOT remove)

### Tool Error: Missed call sites

| Method | File | Actual call site | Why missed |
|--------|------|-----------------|------------|
| HubManager.deleteAllHubs | src/services/hub-manager.ts | extension.ts:395 | Optional chaining `?.` |
| RegistryManager.installBundles | src/services/registry-manager.ts | hub-manager.ts:1169 | Property access through typed reference |
| RegistryManager.uninstallBundles | src/services/registry-manager.ts | registry-manager.ts:2110,2134 | Should be "self-file" not "zero callers" |
| RegistryTreeProvider.onUpdatesDetected | src/ui/registry-tree-provider.ts | extension.ts:578 | Optional chaining `?.` |
| LocalSkillsAdapter.getSkillName | src/adapters/local-skills-adapter.ts | registry-manager.ts:720 | Duck-type runtime check |
| LocalSkillsAdapter.getSkillSourcePath | src/adapters/local-skills-adapter.ts | registry-manager.ts:719 | Duck-type runtime check |

### Legitimate internal helpers (self-file only, not dead)

| Method | File | Role |
|--------|------|------|
| AutoUpdateService.autoUpdateBundle | src/services/auto-update-service.ts | per-bundle impl of `autoUpdateBundles()` |
| AutoUpdateService.isUpdateInProgress | src/services/auto-update-service.ts | internal deduplication guard |
| MigrationRegistry.getMigrationState | src/services/migration-registry.ts | internal state accessor for all public methods |
| MigrationRegistry.markMigrationComplete | src/services/migration-registry.ts | called by `runMigration()` |
| RepositoryActivationService.installMissingBundles | src/services/repository-activation-service.ts | called by `activate()` |
| HubCommands.registerCommands | src/commands/hub-commands.ts | called in constructor |
| RegistryStorage.clearAllCaches | src/storage/registry-storage.ts | internal cache management |
| RegistryStorage.clearSourceCache | src/storage/registry-storage.ts | internal helper for removeSource() |
| SkillWizard.addSkillToCollection | src/commands/skill-wizard.ts | internal wizard step |
| SkillWizard.generateSkillContent | src/commands/skill-wizard.ts | internal wizard step |
| SkillWizard.getCollectionFiles | src/commands/skill-wizard.ts | internal wizard step |
| SkillWizard.runValidation | src/commands/skill-wizard.ts | internal wizard step |
| SkillWizard.validateDescription | src/commands/skill-wizard.ts | internal validation sub-step |
| SkillWizard.validateSkillName | src/commands/skill-wizard.ts | internal validation sub-step |
| McpConfigLocator.getUserMcpConfigPath | src/utils/mcp-config-locator.ts | building block of getMcpConfigLocation() |
| McpConfigLocator.getUserTrackingPath | src/utils/mcp-config-locator.ts | building block of getMcpConfigLocation() |
| McpConfigLocator.getWorkspaceMcpConfigPath | src/utils/mcp-config-locator.ts | building block of getMcpConfigLocation() |
| McpConfigLocator.getWorkspaceTrackingPath | src/utils/mcp-config-locator.ts | building block of getMcpConfigLocation() |
| ErrorHandler.getUserMessage | src/utils/error-handler.ts | internal helper for handle() |
| FileUtils.ensureDirectory | src/utils/file-utils.ts | internal helper |
| CliWrapper.installWithProgress | src/utils/cli-wrapper.ts | internal installation step |
| CliWrapper.installInTerminal | src/utils/cli-wrapper.ts | internal fallback path |
| CliWrapper.isAvailable | src/utils/cli-wrapper.ts | internal precondition check |
| NetworkUtils.isUrlAccessible | src/utils/network-utils.ts | internal impl of checkConnectivity |
| FileUtils.getStats | src/utils/file-utils.ts | internal helper |
| ApmRuntimeManager.clearCache | src/services/apm-runtime-manager.ts | internal |
| HubManager.getHub | src/services/hub-manager.ts | internal lookup |
| HubManager.getProfilesWithUpdates | src/services/hub-manager.ts | internal |
| HubManager.loadHubSources | src/services/hub-manager.ts | internal |
| HubManager.resolveProfileBundles | src/services/hub-manager.ts | internal |
| HubManager.resolveSource | src/services/hub-manager.ts | internal |
| RepositoryScopeService.getTargetPath | src/services/repository-scope-service.ts | internal IScopeService impl |
| UpdateScheduler.schedulePeriodicChecks | src/services/update-scheduler.ts | internal |
| LocalModificationWarningService.checkForModifications | src/services/local-modification-warning-service.ts | internal |
| LocalModificationWarningService.showWarningDialog | src/services/local-modification-warning-service.ts | internal |
| ScopeConflictResolver.checkConflict | src/services/scope-conflict-resolver.ts | internal |
| McpConfigService.computeServerIdentity | src/services/mcp-config-service.ts | internal |
| McpConfigService.substituteVariables | src/services/mcp-config-service.ts | internal |
| SetupStateManager.isIncomplete | src/services/setup-state-manager.ts | internal |
| ApmCliWrapper.isRuntimeAvailable | src/services/apm-cli-wrapper.ts | internal |
| UserScopeService.getClaudeSkillsDirectory | src/services/user-scope-service.ts | internal |
| UserScopeService.syncSkill | src/services/user-scope-service.ts | internal |
| UserScopeService.unsyncSkill | src/services/user-scope-service.ts | internal |
| ScaffoldCommand.detectMigrationScenario* | src/commands/scaffold-command.ts | *borderline — see note |
| ScaffoldCommand.getMigrationRecommendation* | src/commands/scaffold-command.ts | *borderline — see note |

> *Note on ScaffoldCommand migration helpers: These are tested in isolation and work correctly, but the entry point `checkAndShowMigrationRecommendation` has never been wired into a VS Code command. They are borderline — keep if there's intent to wire them, remove if the migration feature is abandoned.

---

## ACTUAL DEAD CODE (~146 items)

### Services (src/services/)

#### FileIntegrityService — entire public API is dead
All public methods of `FileIntegrityService` are dead. The service has no production wiring.

| Method | Evidence |
|--------|---------|
| FileIntegrityService.calculateDirectoryStats | Test-only |
| FileIntegrityService.calculateFilesIntegrity | Test-only |
| FileIntegrityService.generateIntegrityReport | No callers |
| FileIntegrityService.quickVerifyFile | No callers |
| Semaphore.acquire | Internal to dead service |
| FileIntegrityService.calculateFileIntegrity | Internal to dead service |
| Semaphore.release | Internal to dead service |
| FileIntegrityService.findFiles | Internal to dead service |
| FileIntegrityService.verifyFileIntegrity | Internal to dead service |

#### UpdateChecker — orphaned methods

| Method | Evidence |
|--------|---------|
| UpdateChecker.checkBundleUpdate | `checkForUpdates()` is used instead |
| UpdateChecker.clearCache | No callers |
| UpdateChecker.getCacheAge | No callers |
| UpdateChecker.isCacheValid | No callers |

#### RepositoryScopeService — duplicated git-exclude methods

| Method | Evidence |
|--------|---------|
| RepositoryScopeService.addLocalLockfileToGitExclude | LockfileManager has own private version |
| RepositoryScopeService.removeLocalLockfileFromGitExclude | LockfileManager has own private version |
| RepositoryScopeService.getStatus | IScopeService method never called polymorphically |

#### UserScopeService — unimplemented features

| Method | Evidence |
|--------|---------|
| UserScopeService.cleanAll | No callers |
| UserScopeService.getSkillsStatus | No callers |
| UserScopeService.getStatus | No callers |
| UserScopeService.getTargetPath | Replaced by different approach |
| UserScopeService.syncAllBundles | No callers |

#### IScopeService interface — dead contract methods

| Method | Evidence |
|--------|---------|
| IScopeService.getStatus | Never invoked through interface reference |
| IScopeService.getTargetPath | Never invoked through interface reference |

#### Other services

| Method | Evidence |
|--------|---------|
| PromptLoader.clearCache | No callers |
| PromptLoader.search | No callers |
| PromptLoader.searchByTag | No callers |
| SchemaValidator.clearCache | No callers |
| VersionConsolidator.clearCache | No callers |
| HubManager.createChangeQuickPickItems | No callers (uses dead type) |
| HubManager.formatBundleAdditionDetail | No callers |
| HubManager.formatBundleRemovalDetail | No callers |
| HubManager.formatBundleUpdateDetail | No callers |
| HubManager.hasHubUpdates | No callers |
| HubManager.getTimeSinceLastSync | No callers |
| HubManager.resolveBundleUrl | No callers |
| AutoUpdateService.getActiveUpdates | No external callers |
| ScopeConflictResolver.getConflictingScopes | Test-only |
| ScopeConflictResolver.hasConflict | Test-only |
| RepositoryActivationService.getExistingInstance | Test-only |
| RepositoryActivationService.getWorkspaceRoot | No callers (≠ util function) |
| BundleInstaller.getInstallPath | No callers |
| BundleInstaller.getUserScopeService | No callers |
| BundleInstaller.install | Superseded by installFromBuffer() |
| UpdateScheduler.getLastCheckTime | No callers |
| UpdateScheduler.isSchedulerInitialized | No callers |
| McpServerManager.getServersForBundle | No callers |
| McpServerManager.getServersForBundleInWorkspace | No callers |
| McpServerManager.listInstalledServers | No callers |
| ApmRuntimeManager.isAvailable | Self-file; getStatus() used externally |
| ApmCliWrapper.getVersion | No callers |
| ApmCliWrapper.compile | No callers |
| ApmCliWrapper.listDeps | No callers |
| ApmCliWrapper.validatePackageRef | Internal to dead ApmCliWrapper public API |
| PromptExecutor.isAvailable | Not invoked through integration |
| PromptExecutor.executeWithTemplates | Not invoked through integration |
| PromptExecutor.getAvailableModels | No callers |
| MigrationRegistry.isMigrationComplete | Test-only; runMigration() handles idempotency |
| MigrationRegistry.markMigrationSkipped | No production callers |
| McpConfigService.parseServerPrefix | No external callers |
| McpConfigService.restoreBackup | No callers |
| TemplateEngine.getTemplates | No callers |
| TemplateEngine.copyTemplate | Internal in dead flow (no entry point) |
| TemplateEngine.loadManifest | Internal in dead flow |

---

### Utils & Adapters (src/utils/, src/adapters/)

#### NetworkUtils — entire class is dead
The `NetworkUtils` class is not imported by any production file. The class was built as a utility layer but all network operations use axios directly in adapters.

| Method | Note |
|--------|------|
| NetworkUtils.buildUrl | Entire class unused |
| NetworkUtils.calculateETA | Entire class unused |
| NetworkUtils.checkConnectivity | Entire class unused |
| NetworkUtils.downloadFile | Entire class unused |
| NetworkUtils.extractDomain | Entire class unused |
| NetworkUtils.formatSpeed | Entire class unused |
| NetworkUtils.getRemoteFileSize | Entire class unused |
| NetworkUtils.getWithRetry | Entire class unused |

#### FileUtils — entire public API is dead
`FileUtils` is not imported in any production file. All file operations use Node.js `fs` and `path` modules directly.

| Method | Note |
|--------|------|
| FileUtils.changeExtension | Entire class unused in production |
| FileUtils.copyFile | Entire class unused |
| FileUtils.deleteDirectory | Entire class unused |
| FileUtils.deleteFile | Entire class unused |
| FileUtils.formatFileSize | Entire class unused |
| FileUtils.getBasename | Entire class unused |
| FileUtils.getDirname | Entire class unused |
| FileUtils.getExtension | Entire class unused |
| FileUtils.getFileSize | Entire class unused |
| FileUtils.isFile | Entire class unused |
| FileUtils.joinPaths | Entire class unused |
| FileUtils.readJson | Entire class unused |
| FileUtils.sanitizeFilename | Entire class unused |
| FileUtils.writeJson | Entire class unused |

#### Logger — unused management methods

| Method | Evidence |
|--------|---------|
| Logger.clear | No callers |
| Logger.getLogLevel | No callers |
| Logger.hide | No callers |
| Logger.setLogLevel | LOG_LEVEL env var used instead |

#### ErrorHandler — unused patterns

| Method | Evidence |
|--------|---------|
| ErrorHandler.createServiceHandler | Factory pattern never adopted |
| ErrorHandler.handleCategorized | No callers |

#### CliWrapper — unused features

| Method | Evidence |
|--------|---------|
| CliWrapper.getVersion | No external callers |
| CliWrapper.promptAndInstall | No external callers |

#### VersionManager — unused utilities

| Method | Evidence |
|--------|---------|
| VersionManager.isValidSemver | Not called (higher-level methods used) |
| VersionManager.parseVersion | Not called |
| VersionManager.sortVersionsDescending | Not called |

#### Others

| Method | Evidence |
|--------|---------|
| McpConfigLocator.mcpConfigExists | Superseded by getMcpConfigLocation().exists |
| CollectionValidator.validateAllCollections | src/ version duplicates lib/ implementation |
| GitHubAdapter.getAuthenticationMethod | No external callers |
| GitHubAdapter.invalidateAuthCache | Transitively dead |
| RepositoryAdapterFactory.getRegisteredTypes | No callers |
| RepositoryAdapterFactory.hasAdapter | No callers |

---

### Commands, Storage, UI, Notifications

#### HubProfileComparisonView — entire class is dead
Never imported in production code despite comprehensive tests.

| Method | Note |
|--------|------|
| HubProfileComparisonView.getProfileComparisonData | Test-only; class never used in production |
| HubProfileComparisonView.generateComparisonSummary | Test-only |
| HubProfileComparisonView.createComparisonQuickPickItems | Test-only |
| HubProfileComparisonView.getSideBySideComparison | No callers |
| HubProfileComparisonView.formatBundleComparison | Transitively dead |

#### ScaffoldCommand migration chain — dead entry point

| Method | Note |
|--------|------|
| ScaffoldCommand.checkAndShowMigrationRecommendation | Never wired to a command |
| ScaffoldCommand.detectMigrationScenario | Transitively dead |
| ScaffoldCommand.getMigrationRecommendation | Transitively dead |
| ScaffoldCommand.showMigrationRecommendation | Transitively dead |

#### BundleScopeCommands — unwired context menu

| Method | Note |
|--------|------|
| BundleScopeCommands.getContextMenuActions | Test-only; context menu not wired |
| BundleScopeCommands.executeAction | No callers |

#### Other commands

| Method | Note |
|--------|------|
| HubSyncCommands.checkAllHubsForUpdates | Test-only |
| HubSyncCommands.getRegisteredCommands | Test-only |
| HubIntegrationCommands.getSyncHistory | Self-file delegation, never called |

#### Storage

| Method | Note |
|--------|------|
| RegistryStorage.cacheBundleMetadata | Never called |
| RegistryStorage.getActiveProfile | Superseded by HubStorage.getActiveProfileForHub |
| RegistryStorage.getSettings | VS Code config API used instead |
| RegistryStorage.updateSettings | VS Code config API used instead |
| HubStorage.clearCache | Test-only |
| HubStorage.getStoragePath | No callers |
| HubStorage.hubExists | Test-only |

#### Notifications

| Method | Note |
|--------|------|
| ExtensionNotifications.showInfo | Facade never adopted |
| ExtensionNotifications.showWarning | Facade never adopted |

---

## Dead Types

| Type | File | Reason |
|------|------|--------|
| ContextMenuAction | src/commands/bundle-scope-commands.ts | Only used by dead getContextMenuActions/executeAction |
| ScopeStatus | src/services/scope-service.ts | Only used by dead getStatus() methods |
| ChangeQuickPickItem | src/types/hub.ts | Only used by dead createChangeQuickPickItems |
| FileCategories | src/types/integrity-types.ts | Part of unused FileIntegrityService |
| UserDecision | src/types/integrity-types.ts | Part of unused FileIntegrityService |
| UninstallationResult | src/types/integrity-types.ts | Part of unused FileIntegrityService |
| InstallationResult | src/types/integrity-types.ts | Part of unused FileIntegrityService |
| UninstallPreview | src/types/integrity-types.ts | Dry-run feature never implemented |

---

## Recommended Cleanup Priorities

### High-value removals (entire dead classes/features)

1. **`src/utils/file-utils.ts`** — `FileUtils` class entirely unused; 14 dead static methods
2. **`src/utils/network-utils.ts`** — `NetworkUtils` class entirely unused; 8 dead static methods
3. **`src/commands/hub-profile-comparison-view.ts`** — Entire class dead despite tests
4. **`src/services/file-integrity-service.ts`** — All public methods dead; the associated `src/types/integrity-types.ts` dead types follow
5. **`src/notifications/extension-notifications.ts`** `showInfo`/`showWarning` — Facade never adopted

### Medium-value removals (orphaned utilities)

6. `Logger.clear/getLogLevel/hide/setLogLevel` — Use env var pattern instead
7. `UpdateChecker` dead methods — checkBundleUpdate, clearCache, getCacheAge, isCacheValid
8. `BundleScopeCommands.getContextMenuActions` + `executeAction` + `ContextMenuAction` type
9. `ScaffoldCommand` migration chain — if the feature is abandoned
10. 4 orphaned `RegistryStorage` methods — getSettings, updateSettings, getActiveProfile, cacheBundleMetadata

### Lower-priority removals (interface cleanup)

11. `IScopeService.getStatus` + `IScopeService.getTargetPath` + implementing methods — if the scope status inspection feature is abandoned
12. `VersionManager.isValidSemver/parseVersion/sortVersionsDescending` — lower-level utils unused by production
13. `RepositoryAdapterFactory.getRegisteredTypes` + `hasAdapter` — factory introspection never used
14. `ScopeConflictResolver.getConflictingScopes` + `hasConflict` — inspectors replaced by migrateBundle()
15. `MigrationRegistry.isMigrationComplete` + `markMigrationSkipped` — runMigration() covers the use cases

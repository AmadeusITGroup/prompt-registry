# Dead Methods Analysis — Confirmed Dead Code

> Generated: 2026-04-02
> Source: `npm run dead-code:methods` + manual subagent verification across all src/ and test/ files

These methods have **zero production callers** (not called from any `src/` file). Methods called
only from test files are classified as dead code per project policy.

---

## 1. Zero Production Callers — Confirmed Dead (113 methods)

### 1.1 Entire Class/Module Dead — NetworkUtils (10 methods)

The entire `NetworkUtils` class in `src/utils/network-utils.ts` is never imported or used
from any production file. Adapters use `axios` directly with their own retry/error logic.

| # | Method | Why flagged | Why it's truly dead |
|---|--------|-------------|---------------------|
| 1 | `NetworkUtils.buildUrl` | 0 src/ callers | Class never imported in production |
| 2 | `NetworkUtils.calculateETA` | 0 src/ callers | Class never imported in production |
| 3 | `NetworkUtils.checkConnectivity` | 0 src/ callers | Class never imported in production |
| 4 | `NetworkUtils.downloadFile` | 0 src/ callers | Adapters use axios directly |
| 5 | `NetworkUtils.extractDomain` | 0 src/ callers | Class never imported in production |
| 6 | `NetworkUtils.formatSpeed` | 0 src/ callers | Class never imported in production |
| 7 | `NetworkUtils.getRemoteFileSize` | 0 src/ callers | Class never imported in production |
| 8 | `NetworkUtils.getWithRetry` | 0 src/ callers | Adapters handle retry inline |
| 9 | `NetworkUtils.isUrlAccessible` | Self-file only | Called by dead `checkConnectivity` — transitively dead |
| 10 | `NetworkUtils.isFile` | 0 src/ callers | Not used; `path` module used directly |

### 1.2 Mostly Dead Utility Class — FileUtils (14 methods)

Most `FileUtils` methods are unused. Only `exists`, `isDirectory`, `listDirectory`, `readFile`
are called from production code (e.g., `scaffold-command.ts`). The rest are dead wrappers
around Node.js `fs`/`path` builtins that production code calls directly.

| # | Method | Why it's truly dead |
|---|--------|---------------------|
| 11 | `FileUtils.changeExtension` | Never called; production uses `path.extname` directly |
| 12 | `FileUtils.copyFile` | Never called; production uses `fs.copyFile` directly |
| 13 | `FileUtils.deleteDirectory` | Never called; production uses `fs.rm` directly |
| 14 | `FileUtils.deleteFile` | Never called; production uses `fs.unlink` directly |
| 15 | `FileUtils.formatFileSize` | Never called from any src/ file |
| 16 | `FileUtils.getBasename` | Never called; production uses `path.basename` directly |
| 17 | `FileUtils.getDirname` | Never called; production uses `path.dirname` directly |
| 18 | `FileUtils.getExtension` | Never called; production uses `path.extname` directly |
| 19 | `FileUtils.getFileSize` | Never called from any src/ file |
| 20 | `FileUtils.isFile` | Never called; only `isDirectory` is used |
| 21 | `FileUtils.joinPaths` | Never called; production uses `path.join` directly |
| 22 | `FileUtils.readJson` | Never called from any src/ file |
| 23 | `FileUtils.sanitizeFilename` | Never called; consumers implement own sanitization |
| 24 | `FileUtils.writeJson` | Never called from any src/ file |
| 25 | `FileUtils.writeFile` | Self-file only; no external caller leads to it |

### 1.3 Entire Class Dead — HubProfileComparisonView (5 methods)

`HubProfileComparisonView` in `src/commands/hub-profile-comparison-view.ts` is never
instantiated or imported anywhere in production code. All calls come from tests only.

| # | Method | Why it's truly dead |
|---|--------|---------------------|
| 26 | `HubProfileComparisonView.createComparisonQuickPickItems` | Class never instantiated in production; test-only |
| 27 | `HubProfileComparisonView.generateComparisonSummary` | Class never instantiated in production; test-only |
| 28 | `HubProfileComparisonView.getProfileComparisonData` | Class never instantiated in production; test-only |
| 29 | `HubProfileComparisonView.getSideBySideComparison` | Class never instantiated in production; test-only |
| 30 | `HubProfileComparisonView.formatBundleComparison` | Self-file only; transitively dead (class unused) |

### 1.4 Entire Service Dead — FileIntegrityService + Semaphore (7 methods)

`FileIntegrityService` and its helper `Semaphore` class (both in `src/services/file-integrity-service.ts`)
are never used from production code. The entire file is test-only infrastructure.

| # | Method | Why it's truly dead |
|---|--------|---------------------|
| 31 | `FileIntegrityService.calculateDirectoryStats` | Service never used in production |
| 32 | `FileIntegrityService.calculateFilesIntegrity` | Service never used in production |
| 33 | `FileIntegrityService.generateIntegrityReport` | Service never used in production |
| 34 | `FileIntegrityService.quickVerifyFile` | Service never used in production |
| 35 | `FileIntegrityService.calculateFileIntegrity` | Self-file only; service never used |
| 36 | `FileIntegrityService.findFiles` | Self-file only; service never used |
| 37 | `FileIntegrityService.verifyFileIntegrity` | Self-file only; service never used |
| 38 | `Semaphore.acquire` | Only caller is dead FileIntegrityService |
| 39 | `Semaphore.release` | Only caller is dead FileIntegrityService |

### 1.5 Dead Migration Recommendation Chain — ScaffoldCommand (4 methods)

Migration recommendation feature in `ScaffoldCommand` was never wired to any command or entry
point. The entire chain is dead.

| # | Method | Why it's truly dead |
|---|--------|---------------------|
| 40 | `ScaffoldCommand.checkAndShowMigrationRecommendation` | Never registered as a command; test-only |
| 41 | `ScaffoldCommand.detectMigrationScenario` | Self-file only; called only by dead entry point above |
| 42 | `ScaffoldCommand.getMigrationRecommendation` | Self-file only; called only by dead entry point |
| 43 | `ScaffoldCommand.showMigrationRecommendation` | Self-file only; called only by dead entry point |

### 1.6 Dead Action Dispatch Pattern — BundleScopeCommands (2 methods)

The context menu action/dispatch pattern in `BundleScopeCommands` was never wired.
Extension commands (`moveToRepository`, `moveToUser`, `switchCommitMode`) are called directly
instead of through this dispatch system.

| # | Method | Why it's truly dead |
|---|--------|---------------------|
| 44 | `BundleScopeCommands.executeAction` | Action dispatch never wired; commands called directly |
| 45 | `BundleScopeCommands.getContextMenuActions` | Action generation never wired; commands called directly |

### 1.7 Dead PromptExecutor/PromptLoader Methods (5 methods)

These methods belong to features that were defined but never integrated into the extension's
command palette or activation flow.

| # | Method | Why it's truly dead |
|---|--------|---------------------|
| 46 | `PromptExecutor.executeWithTemplates` | Never called from any src/ file |
| 47 | `PromptExecutor.getAvailableModels` | Never called from any src/ file |
| 48 | `PromptExecutor.isAvailable` | Never called from any src/ file |
| 49 | `PromptLoader.clearCache` | Never called from any src/ file |
| 50 | `PromptLoader.search` | Never called from any src/ file |
| 51 | `PromptLoader.searchByTag` | Never called from any src/ file |

### 1.8 Dead Cache/State Inspection Methods (9 methods)

Various `clearCache`, `getCache*`, and state-inspection methods that exist but are never
invoked from production code. Some are only called from tests for verification.

| # | Method | Why it's truly dead |
|---|--------|---------------------|
| 52 | `SchemaValidator.clearCache` | Never called from any src/ file |
| 53 | `UpdateChecker.clearCache` | Never called from any src/ file |
| 54 | `VersionConsolidator.clearCache` | Never called from any src/ file |
| 55 | `HubStorage.clearCache` | Never called from any src/ file |
| 56 | `UpdateChecker.getCacheAge` | Never called from any src/ file |
| 57 | `UpdateChecker.isCacheValid` | Never called from any src/ file |
| 58 | `UpdateScheduler.getLastCheckTime` | Never called; test-only |
| 59 | `UpdateScheduler.isSchedulerInitialized` | Never called; test-only |
| 60 | `Logger.clear` | Never called from any src/ file |

### 1.9 Dead Hub/Storage Methods (11 methods)

Hub management and storage methods that are defined but never reached from production code.

| # | Method | Why it's truly dead |
|---|--------|---------------------|
| 61 | `HubManager.createChangeQuickPickItems` | Never called from any src/ file |
| 62 | `HubManager.formatBundleAdditionDetail` | Test-only (test/services/hub-conflict-resolution-ui.test.ts) |
| 63 | `HubManager.formatBundleRemovalDetail` | Test-only (test/services/hub-conflict-resolution-ui.test.ts) |
| 64 | `HubManager.formatBundleUpdateDetail` | Test-only (test/services/hub-conflict-resolution-ui.test.ts) |
| 65 | `HubManager.hasHubUpdates` | Test-only (test/services/hub-manual-sync-detection.test.ts) |
| 66 | `HubManager.getTimeSinceLastSync` | Never called from any src/ file |
| 67 | `HubManager.resolveBundleUrl` | Test-only (test/services/hub-bundle-resolution.test.ts) |
| 68 | `HubSyncCommands.checkAllHubsForUpdates` | Test-only (test/commands/hub-sync-commands.test.ts) |
| 69 | `HubSyncCommands.getRegisteredCommands` | Test-only; introspection method |
| 70 | `HubIntegrationCommands.getSyncHistory` | Never wired to any entry point |
| 71 | `HubStorage.hubExists` | Test-only (test/storage/hub-storage.test.ts) |
| 72 | `HubStorage.getStoragePath` | Never called from any src/ file |

### 1.10 Dead Registry/Storage Methods (5 methods)

| # | Method | Why it's truly dead |
|---|--------|---------------------|
| 73 | `RegistryStorage.cacheBundleMetadata` | Never called from any src/ file |
| 74 | `RegistryStorage.getActiveProfile` | Never called (HubManager has its own) |
| 75 | `RegistryStorage.getSettings` | Never called from any src/ file |
| 76 | `RegistryStorage.updateSettings` | Superseded by VS Code configuration API |

### 1.11 Dead Scope/Conflict Methods (5 methods)

| # | Method | Why it's truly dead |
|---|--------|---------------------|
| 77 | `ScopeConflictResolver.getConflictingScopes` | Never called from any src/ file |
| 78 | `ScopeConflictResolver.hasConflict` | Test-only |
| 79 | `IScopeService.getStatus` | Interface method never called polymorphically |
| 80 | `RepositoryScopeService.getStatus` | Implements dead interface method |
| 81 | `UserScopeService.getStatus` | Implements dead interface method |
| 82 | `IScopeService.getTargetPath` | Interface method; implementations only called internally |
| 83 | `UserScopeService.getTargetPath` | Never called externally (RepositoryScopeService calls its own) |
| 84 | `UserScopeService.getSkillsStatus` | Never called from any src/ file |
| 85 | `UserScopeService.cleanAll` | Never called from any src/ file |
| 86 | `UserScopeService.syncAllBundles` | Never called from any src/ file |

### 1.12 Dead Repository Scope/Activation Methods (5 methods)

| # | Method | Why it's truly dead |
|---|--------|---------------------|
| 87 | `RepositoryScopeService.addLocalLockfileToGitExclude` | Never called; LockfileManager has its own |
| 88 | `RepositoryScopeService.removeLocalLockfileFromGitExclude` | Never called; duplicate of LockfileManager's |
| 89 | `RepositoryActivationService.getExistingInstance` | Never called from any src/ file |
| 90 | `RepositoryActivationService.installMissingBundles` | Test-only |
| 91 | `RepositoryActivationService.getWorkspaceRoot` | Never called; separate utility function used instead |

### 1.13 Dead ApmCliWrapper/CliWrapper Methods (6 methods)

| # | Method | Why it's truly dead |
|---|--------|---------------------|
| 92 | `ApmCliWrapper.compile` | Never called from any src/ file |
| 93 | `ApmCliWrapper.getVersion` | Never called from any src/ file |
| 94 | `ApmCliWrapper.listDeps` | Never called from any src/ file |
| 95 | `CliWrapper.getVersion` | Never called from any src/ file |
| 96 | `CliWrapper.promptAndInstall` | Test-only (test/e2e and test/utils) |
| 97 | `ApmRuntimeManager.isAvailable` | Never called; getStatus() used instead |

### 1.14 Dead MCP Methods (4 methods)

| # | Method | Why it's truly dead |
|---|--------|---------------------|
| 98 | `McpServerManager.getServersForBundle` | Never called from any src/ file |
| 99 | `McpServerManager.getServersForBundleInWorkspace` | Never called from any src/ file |
| 100 | `McpServerManager.listInstalledServers` | Test-only |
| 101 | `McpConfigLocator.mcpConfigExists` | Superseded by getMcpConfigLocation pattern |
| 102 | `McpConfigService.parseServerPrefix` | Never called from any src/ file |
| 103 | `McpConfigService.restoreBackup` | Never called from any src/ file |

### 1.15 Dead Miscellaneous Methods (18 methods)

| # | Method | Why it's truly dead |
|---|--------|---------------------|
| 104 | `BundleInstaller.install` | Superseded by `installFromBuffer()`; never called |
| 105 | `BundleInstaller.getInstallPath` | Never called from any src/ file |
| 106 | `BundleInstaller.getUserScopeService` | Unused getter |
| 107 | `AutoUpdateService.getActiveUpdates` | Never called from any src/ file |
| 108 | `ErrorHandler.createServiceHandler` | Factory pattern never adopted |
| 109 | `ErrorHandler.handleCategorized` | Never called from any src/ file |
| 110 | `GitHubAdapter.getAuthenticationMethod` | Test-only (property tests) |
| 111 | `GitHubAdapter.invalidateAuthCache` | Self-file only; called by dead getAuthenticationMethod |
| 112 | `Logger.getLogLevel` | Never called; LOG_LEVEL env var used directly |
| 113 | `Logger.hide` | Never called from any src/ file |
| 114 | `Logger.setLogLevel` | Never called; LOG_LEVEL env var used at construction |
| 115 | `VersionManager.isValidSemver` | Test-only |
| 116 | `VersionManager.parseVersion` | Test-only |
| 117 | `VersionManager.sortVersionsDescending` | Test-only |
| 118 | `MigrationRegistry.isMigrationComplete` | Test-only |
| 119 | `MigrationRegistry.markMigrationSkipped` | Test-only |
| 120 | `ExtensionNotifications.showInfo` | Facade never adopted; dead |
| 121 | `ExtensionNotifications.showWarning` | Facade never adopted; dead |
| 122 | `CollectionValidator.validateAllCollections` | Duplicate; lib/ version is used instead |
| 123 | `CollectionValidator.validateCollection` | Self-file only; class dead (lib/ used instead) |
| 124 | `TemplateEngine.getTemplates` | Test-only |
| 125 | `TemplateEngine.copyTemplate` | Self-file only; never wired into production |
| 126 | `TemplateEngine.loadManifest` | Self-file only; never wired into production |
| 127 | `UpdateChecker.checkBundleUpdate` | Never wired into production code |

---

## 2. Dead Types (18 types)

These types are only consumed by the dead methods listed above.

| Type | File | Consumed by |
|------|------|-------------|
| `ContextMenuAction` | `src/commands/bundle-scope-commands.ts` | Dead `getContextMenuActions`/`executeAction` |
| `ProfileComparisonData` | `src/commands/hub-profile-comparison-view.ts` | Dead `HubProfileComparisonView` |
| `ComparisonQuickPickItem` | `src/commands/hub-profile-comparison-view.ts` | Dead `HubProfileComparisonView` |
| `HubUpdateSummary` | `src/commands/hub-sync-commands.ts` | Dead `checkAllHubsForUpdates` |
| `NotificationAction` | `src/notifications/base-notification-service.ts` | Dead notification facade |
| `ApmInstallResult` | `src/services/apm-cli-wrapper.ts` | Dead ApmCliWrapper methods |
| `MissingBundleInstallResult` | `src/services/repository-activation-service.ts` | Dead `installMissingBundles` |
| `ScopeStatus` | `src/services/scope-service.ts` | Dead `getStatus()` methods |
| `ChangeQuickPickItem` | `src/types/hub.ts` | Dead `createChangeQuickPickItems` |
| `FileCategories` | `src/types/integrity-types.ts` | Dead `FileIntegrityService` |
| `UserDecision` | `src/types/integrity-types.ts` | Dead `FileIntegrityService` |
| `UninstallationResult` | `src/types/integrity-types.ts` | Dead `FileIntegrityService` |
| `InstallationResult` | `src/types/integrity-types.ts` | Dead `FileIntegrityService` |
| `UninstallPreview` | `src/types/integrity-types.ts` | Dead `FileIntegrityService` |
| `McpConfigLocation` | `src/types/mcp.ts` | Dead `mcpConfigExists` |
| `ExportOptions` | `src/types/settings.ts` | Dead `getSettings`/`updateSettings` |
| `ImportOptions` | `src/types/settings.ts` | Dead `getSettings`/`updateSettings` |
| `SkillsRepositoryInfo` | `src/types/skills.ts` | Dead `getSkillsStatus` |

---

## 3. Summary by Removal Priority

### Priority 1 — Entire files/classes can be deleted
- **`src/utils/network-utils.ts`** — Entire class unused (10 methods)
- **`src/services/file-integrity-service.ts`** — Entire file unused (7 methods + 2 Semaphore methods)
- **`src/commands/hub-profile-comparison-view.ts`** — Entire class unused (5 methods)
- **`src/types/integrity-types.ts`** — All types consumed only by dead code

### Priority 2 — Large method clusters within files
- **`src/utils/file-utils.ts`** — 15 dead methods out of ~20 (keep `exists`, `isDirectory`, `listDirectory`, `readFile`, `ensureDirectory`)
- **`src/services/hub-manager.ts`** — 7 dead methods
- **`src/commands/scaffold-command.ts`** — 4 dead methods (migration recommendation chain)
- **`src/services/user-scope-service.ts`** — 5 dead methods

### Priority 3 — Individual dead methods across many files
- Various `clearCache`, `getVersion`, `getStatus`, etc. across 20+ files

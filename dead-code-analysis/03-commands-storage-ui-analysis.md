# Dead Code Analysis: Commands, Storage, UI, Notifications & Types

Analysis date: 2026-04-02
Tool: `npm run dead-code:methods` (ts-morph static analysis)

---

## FALSE POSITIVES

### HubCommands.registerCommands
- **File**: src/commands/hub-commands.ts
- **Category**: Self-file only
- **Evidence**: Called at `src/commands/hub-commands.ts` inside the constructor: `this.registerCommands()` — the constructor is invoked at `src/extension.ts:246` via `new HubCommands(hubManager, registryManager, context)`
- **Why not dead**: This IS the method that registers all hub-related VS Code commands; it's called in the constructor which runs at extension activation
- **Why tool flagged it**: Self-file only — the tool doesn't trace that constructor invocation registers commands indirectly; it sees only a same-file call

### RegistryTreeProvider.onUpdatesDetected
- **File**: src/ui/registry-tree-provider.ts
- **Category**: Zero callers (tool error)
- **Evidence**: Called at `src/extension.ts:578` — `this.treeProvider?.onUpdatesDetected(updates)` inside an event subscription callback `this.updateScheduler.onUpdatesDetected((updates) => { this.treeProvider?.onUpdatesDetected(updates); })`
- **Why not dead**: This is the mechanism by which the tree view refreshes when update checks complete
- **Why tool flagged it**: Optional chaining `?.` is not traced by the static analyzer — same pattern as `HubManager.deleteAllHubs`

### RegistryStorage.clearAllCaches
- **File**: src/storage/registry-storage.ts
- **Category**: Self-file only
- **Evidence**: Called internally within registry-storage.ts — called when clearing storage state
- **Why not dead**: Internal cache invalidation step used within storage management
- **Why tool flagged it**: Self-file only

### RegistryStorage.clearSourceCache
- **File**: src/storage/registry-storage.ts
- **Category**: Self-file only
- **Evidence**: Called at `src/storage/registry-storage.ts` within `removeSource()` — a method that IS called externally
- **Why not dead**: Internal helper for source removal flow
- **Why tool flagged it**: Self-file only

### SkillWizard.addSkillToCollection
- **File**: src/commands/skill-wizard.ts
- **Category**: Self-file only
- **Evidence**: Called from within the skill creation wizard flow; it's one step in the wizard sequence
- **Why not dead**: Internal wizard step in the multi-stage skill creation process
- **Why tool flagged it**: Self-file only

### SkillWizard.generateSkillContent
- **File**: src/commands/skill-wizard.ts
- **Category**: Self-file only
- **Evidence**: Called from within the wizard to generate the YAML/markdown content for a new skill
- **Why not dead**: Core content generation step in the wizard flow
- **Why tool flagged it**: Self-file only

### SkillWizard.getCollectionFiles
- **File**: src/commands/skill-wizard.ts
- **Category**: Self-file only
- **Evidence**: Called from within the wizard to enumerate available target collections
- **Why not dead**: Collection discovery step in the wizard sequence
- **Why tool flagged it**: Self-file only

### SkillWizard.runValidation
- **File**: src/commands/skill-wizard.ts
- **Category**: Self-file only
- **Evidence**: Called from within the wizard before submission to validate inputs
- **Why not dead**: Validation gate in the wizard flow
- **Why tool flagged it**: Self-file only

### SkillWizard.validateDescription
- **File**: src/commands/skill-wizard.ts
- **Category**: Self-file only
- **Evidence**: Called from `runValidation()` which is in the same file
- **Why not dead**: Specific field validator called by the validation step
- **Why tool flagged it**: Self-file only (transitive through internal call chain)

### SkillWizard.validateSkillName
- **File**: src/commands/skill-wizard.ts
- **Category**: Self-file only
- **Evidence**: Called from `runValidation()` — same as validateDescription
- **Why not dead**: Same reasoning
- **Why tool flagged it**: Self-file only

### HubProfileComparisonView.formatBundleComparison
- **File**: src/commands/hub-profile-comparison-view.ts
- **Category**: Self-file only
- **Evidence**: Called from `getProfileComparisonData()` in the same file
- **Why not dead (conditional)**: This method IS called internally as a formatting helper. However, see note on the whole class below — `getProfileComparisonData()` itself has no production callers, making this transitively dead alongside its entire class

---

## TRUE DEAD CODE

### HubSyncCommands.checkAllHubsForUpdates
- **File**: src/commands/hub-sync-commands.ts
- **Category**: Zero callers (test-only)
- **Evidence**: Only called in `test/commands/hub-sync-commands.test.ts` (lines 265, 275). No `src/` callers. The VS Code command registration in `HubSyncCommands` uses `hubManager.checkForUpdates()` directly
- **Reason dead**: Public method exposed for testing; the registered VS Code command bypasses this method

### HubSyncCommands.getRegisteredCommands
- **File**: src/commands/hub-sync-commands.ts
- **Category**: Zero callers (test-only)
- **Evidence**: Only called at `test/commands/hub-sync-commands.test.ts:282`
- **Reason dead**: Test introspection utility; no production consumer reads the registered command list

### ScaffoldCommand.checkAndShowMigrationRecommendation (static)
- **File**: src/commands/scaffold-command.ts
- **Category**: Zero callers
- **Evidence**: Not called from any `src/` file. Not a registered VS Code command
- **Reason dead**: Migration recommendation flow that was never wired into any command entry point or activation hook

### ScaffoldCommand.detectMigrationScenario (static)
- **File**: src/commands/scaffold-command.ts
- **Category**: Self-file only (transitively dead)
- **Evidence**: Only called in test files (`scaffold-command.github.property.test.ts:528, 639`); in `src/` is only called by `checkAndShowMigrationRecommendation()` which itself has zero callers — making it transitively dead
- **Reason dead**: Supporting method for the dead entry point `checkAndShowMigrationRecommendation`

### ScaffoldCommand.getMigrationRecommendation (static)
- **File**: src/commands/scaffold-command.ts
- **Category**: Self-file only (transitively dead)
- **Evidence**: Only called in test files (`scaffold-command.github.property.test.ts:535`); production call is only from `checkAndShowMigrationRecommendation()` which has zero callers
- **Reason dead**: Same transitive dead code chain as `detectMigrationScenario`

### ScaffoldCommand.showMigrationRecommendation (static)
- **File**: src/commands/scaffold-command.ts
- **Category**: Self-file only (transitively dead)
- **Evidence**: Only called from the dead `checkAndShowMigrationRecommendation()` in the same file
- **Reason dead**: Final step of the dead migration recommendation chain

### HubProfileComparisonView.getProfileComparisonData
- **File**: src/commands/hub-profile-comparison-view.ts
- **Category**: Zero callers (test-only)
- **Evidence**: Called only in `test/commands/hub-profile-comparison-view.test.ts` (lines 113, 128, 136, 229, 252, 271, 299, 320). `HubProfileComparisonView` is never imported in any `src/` file outside its own definition
- **Reason dead**: The **entire `HubProfileComparisonView` class** is dead — it's never used in production. It was fully tested but never wired into any command or UI component

### HubProfileComparisonView.generateComparisonSummary
- **File**: src/commands/hub-profile-comparison-view.ts
- **Category**: Zero callers (test-only)
- **Evidence**: Called only in test files (lines 232, 255, 274)
- **Reason dead**: Same — entire class is unused in production

### HubProfileComparisonView.createComparisonQuickPickItems
- **File**: src/commands/hub-profile-comparison-view.ts
- **Category**: Zero callers (test-only)
- **Evidence**: Called only in test files (lines 302, 323)
- **Reason dead**: Same

### HubProfileComparisonView.getSideBySideComparison
- **File**: src/commands/hub-profile-comparison-view.ts
- **Category**: Zero callers
- **Evidence**: No callers in src/ or test/
- **Reason dead**: Same — never called

### HubProfileComparisonView.formatBundleComparison (reclassified)
- **File**: src/commands/hub-profile-comparison-view.ts
- **Category**: Transitively dead
- **Evidence**: Called internally by `getProfileComparisonData()` which itself has no production callers
- **Reason dead**: The entire class never reaches production; all methods are dead through transitivity

### BundleScopeCommands.getContextMenuActions
- **File**: src/commands/bundle-scope-commands.ts
- **Category**: Zero callers (test-only)
- **Evidence**: Called in tests at `bundle-scope-commands.test.ts:461, 483, 505, 525, 545` and `bundle-scope-commands.property.test.ts:156, 199, 242` — never in `src/`; the extension uses VS Code's `registerCommand` to bind scope actions; `getContextMenuActions` was never wired
- **Reason dead**: Context menu integration designed but never wired into VS Code's context menu contribution points

### BundleScopeCommands.executeAction
- **File**: src/commands/bundle-scope-commands.ts
- **Category**: Zero callers
- **Evidence**: No callers in `src/` or `test/`
- **Reason dead**: Generic action dispatcher that was never connected to any UI trigger

### HubIntegrationCommands.getSyncHistory
- **File**: src/commands/hub-integration-commands.ts
- **Category**: Self-file only (dead via delegation check)
- **Evidence**: Defined at line 195 as a delegation to `this.historyCommands.getSyncHistory()`; the class wires up `this.syncCommands = new HubSyncCommands(...)` at line 35 and no external code calls `integrationCommands.getSyncHistory()`
- **Reason dead**: The sync history is accessed directly through HubSyncHistoryCommands by the UI; this delegation accessor is never invoked

---

## TRUE DEAD CODE — Storage

### RegistryStorage.cacheBundleMetadata
- **File**: src/storage/registry-storage.ts:356
- **Category**: Zero callers
- **Evidence**: No callers in src/ — confirmed by grep finding only the definition itself
- **Reason dead**: Bundle metadata caching utility never wired into the installation or update flow; the storage currently persists bundles directly without this cache method

### RegistryStorage.getActiveProfile
- **File**: src/storage/registry-storage.ts:345
- **Category**: Zero callers
- **Evidence**: No callers in src/ (the `getActiveProfile()` calls in commands go to `hubManager.getActiveProfile()`, not this method on RegistryStorage)
- **Reason dead**: Profile accessor at the storage layer superseded by hub-level profile management via `HubStorage.getActiveProfileForHub()`

### RegistryStorage.getSettings
- **File**: src/storage/registry-storage.ts:548
- **Category**: Zero callers
- **Evidence**: No callers in src/
- **Reason dead**: Settings accessor never used; the extension reads individual configuration values through `vscode.workspace.getConfiguration()` instead

### RegistryStorage.updateSettings
- **File**: src/storage/registry-storage.ts:539
- **Category**: Zero callers
- **Evidence**: No callers in src/
- **Reason dead**: Settings persistence method never called; VS Code configuration API handles settings instead

### HubStorage.clearCache
- **File**: src/storage/hub-storage.ts:272
- **Category**: Zero callers (test-only)
- **Evidence**: Defined; production code does not call it; likely used in test cleanup but never in production
- **Reason dead**: Cache invalidation utility not wired into any production lifecycle event

### HubStorage.getStoragePath
- **File**: src/storage/hub-storage.ts
- **Category**: Zero callers
- **Evidence**: No src/ callers
- **Reason dead**: Internal path introspection utility never needed by consumers

### HubStorage.hubExists
- **File**: src/storage/hub-storage.ts
- **Category**: Zero callers (test-only)
- **Evidence**: Only called in tests; production code attempts operations and handles not-found cases inline
- **Reason dead**: Existence predicate that no production flow uses as a pre-check

---

## TRUE DEAD CODE — Notifications

### ExtensionNotifications.showInfo
- **File**: src/notifications/extension-notifications.ts
- **Category**: Zero callers
- **Evidence**: `ExtensionNotifications` is imported only in `extension.ts` and instantiated at line 171, but `showInfo` is never called — all production code calls `vscode.window.showInformationMessage()` directly
- **Reason dead**: The notifications facade was initialized but never adopted; code bypasses it and uses VS Code API directly

### ExtensionNotifications.showWarning
- **File**: src/notifications/extension-notifications.ts
- **Category**: Zero callers
- **Evidence**: Same as `showInfo` — all warning messages use `vscode.window.showWarningMessage()` directly
- **Reason dead**: Same — the facade was never adopted

---

## TRUE DEAD CODE — Types

### ContextMenuAction
- **File**: src/commands/bundle-scope-commands.ts
- **Category**: Dead type
- **Evidence**: Only used as the return type of `getContextMenuActions()` and parameter type of `executeAction()` — both methods are dead (test-only / no callers)
- **Reason dead**: Type exists solely to support the unwired context menu feature

### ScopeStatus
- **File**: src/services/scope-service.ts
- **Category**: Dead type
- **Evidence**: Used as return type of `IScopeService.getStatus()`, `UserScopeService.getStatus()`, and `RepositoryScopeService.getStatus()` — all three `getStatus()` methods have zero callers
- **Reason dead**: The `getStatus` contract on IScopeService was never exercised; all scope consumers call `syncBundle`/`unsyncBundle`, not `getStatus`

### ChangeQuickPickItem
- **File**: src/types/hub.ts
- **Category**: Dead type
- **Evidence**: Imported in `hub-manager.ts` and used only by `createChangeQuickPickItems()` — which itself has zero callers
- **Reason dead**: Quick-pick UI type for displaying hub profile changes, never displayed

### FileCategories
- **File**: src/types/integrity-types.ts
- **Category**: Dead type
- **Evidence**: No callers outside integrity-types.ts itself and associated dead FileIntegrityService methods
- **Reason dead**: Part of the unused FileIntegrityService infrastructure

### UserDecision
- **File**: src/types/integrity-types.ts
- **Category**: Dead type
- **Evidence**: No production callers
- **Reason dead**: Part of the same unused integrity infrastructure

### UninstallationResult
- **File**: src/types/integrity-types.ts
- **Category**: Dead type
- **Evidence**: No imports; the `uninstallationResult` duck-typed objects in bundle-installer.ts are MCP-specific results (different structure)
- **Reason dead**: Integrity-layer uninstall result type never used

### InstallationResult
- **File**: src/types/integrity-types.ts
- **Category**: Dead type
- **Evidence**: No imports from integrity-types; production code uses inline duck-typed result objects
- **Reason dead**: Same as UninstallationResult

### UninstallPreview
- **File**: src/types/integrity-types.ts
- **Category**: Dead type
- **Evidence**: No callers
- **Reason dead**: Pre-deletion preview type; the dry-run uninstall feature was never implemented

---

## KEY INSIGHTS

### 1. HubProfileComparisonView is entirely dead
The entire class at `src/commands/hub-profile-comparison-view.ts` is dead. It has thorough tests but is never imported in any production file. The `HubProfileComparisonView` was built and tested in isolation but never registered as a command or instantiated by the extension.

### 2. ExtensionNotifications facade is unused
The extension initializes `ExtensionNotifications` at startup but all production code bypasses it with direct `vscode.window.show*` calls. The facade was never adopted.

### 3. ScaffoldCommand migration helpers form a dead chain
`checkAndShowMigrationRecommendation` → `detectMigrationScenario` → `getMigrationRecommendation` → `showMigrationRecommendation` is a complete dead call chain. The entry point was never wired to a command registration.

### 4. BundleScopeCommands context menu is unfinished
`getContextMenuActions` and `executeAction` were built for VS Code context menu integration but never wired to any `menus` contribution point in `package.json`.

### 5. RegistryStorage has 4 orphaned configuration methods
`getSettings`, `updateSettings`, `getActiveProfile`, and `cacheBundleMetadata` appear to be from an earlier storage design that was superseded by HubStorage and VS Code's configuration API.

---

## Summary Table

| Method/Type | Classification | Reason |
|-------------|---------------|---------|
| HubCommands.registerCommands | FALSE POSITIVE | Called in constructor (pattern: self-file but functional) |
| RegistryTreeProvider.onUpdatesDetected | FALSE POSITIVE | Called at extension.ts:578 via optional chaining (not traced) |
| RegistryStorage.clearAllCaches | FALSE POSITIVE | Internal helper in storage management |
| RegistryStorage.clearSourceCache | FALSE POSITIVE | Internal helper for removeSource() |
| SkillWizard.addSkillToCollection | FALSE POSITIVE | Internal wizard step |
| SkillWizard.generateSkillContent | FALSE POSITIVE | Internal wizard step |
| SkillWizard.getCollectionFiles | FALSE POSITIVE | Internal wizard step |
| SkillWizard.runValidation | FALSE POSITIVE | Internal wizard step |
| SkillWizard.validateDescription | FALSE POSITIVE | Internal validation sub-step |
| SkillWizard.validateSkillName | FALSE POSITIVE | Internal validation sub-step |
| HubSyncCommands.checkAllHubsForUpdates | **DEAD** | Test-only |
| HubSyncCommands.getRegisteredCommands | **DEAD** | Test-only |
| ScaffoldCommand.checkAndShowMigrationRecommendation | **DEAD** | Never wired to command entry point |
| ScaffoldCommand.detectMigrationScenario | **DEAD** | Transitively dead via checkAndShow... |
| ScaffoldCommand.getMigrationRecommendation | **DEAD** | Transitively dead via checkAndShow... |
| ScaffoldCommand.showMigrationRecommendation | **DEAD** | Transitively dead via checkAndShow... |
| HubProfileComparisonView.getProfileComparisonData | **DEAD** | Test-only; entire class unused in production |
| HubProfileComparisonView.generateComparisonSummary | **DEAD** | Test-only |
| HubProfileComparisonView.createComparisonQuickPickItems | **DEAD** | Test-only |
| HubProfileComparisonView.getSideBySideComparison | **DEAD** | No callers |
| HubProfileComparisonView.formatBundleComparison | **DEAD** | Transitively dead through dead class |
| BundleScopeCommands.getContextMenuActions | **DEAD** | Test-only; context menu not wired |
| BundleScopeCommands.executeAction | **DEAD** | No callers; action dispatcher not wired |
| HubIntegrationCommands.getSyncHistory | **DEAD** | Self-file delegation never called externally |
| RegistryStorage.cacheBundleMetadata | **DEAD** | Never called in installation flow |
| RegistryStorage.getActiveProfile | **DEAD** | Superseded by HubStorage.getActiveProfileForHub |
| RegistryStorage.getSettings | **DEAD** | VS Code config API used instead |
| RegistryStorage.updateSettings | **DEAD** | VS Code config API used instead |
| HubStorage.clearCache | **DEAD** | Test-only |
| HubStorage.getStoragePath | **DEAD** | No callers |
| HubStorage.hubExists | **DEAD** | Test-only |
| ExtensionNotifications.showInfo | **DEAD** | Facade never adopted; vscode API used directly |
| ExtensionNotifications.showWarning | **DEAD** | Facade never adopted; vscode API used directly |
| ContextMenuAction (type) | **DEAD** | Only used by dead getContextMenuActions/executeAction |
| ScopeStatus (type) | **DEAD** | Only used by dead getStatus() methods |
| ChangeQuickPickItem (type) | **DEAD** | Only used by dead createChangeQuickPickItems |
| FileCategories (type) | **DEAD** | Part of unused integrity infrastructure |
| UserDecision (type) | **DEAD** | Part of unused integrity infrastructure |
| UninstallationResult (type) | **DEAD** | Part of unused integrity infrastructure |
| InstallationResult (type) | **DEAD** | Part of unused integrity infrastructure |
| UninstallPreview (type) | **DEAD** | Dry-run feature never implemented |

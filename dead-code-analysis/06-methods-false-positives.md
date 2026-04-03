# Dead Methods Analysis — False Positives

> Generated: 2026-04-02
> Source: `npm run dead-code:methods` + manual subagent verification

These methods were flagged by the dead-code analyzer but are **NOT dead code**.
Each entry explains why it was flagged and why it's actually used.

---

## Self-File Only Callers — False Positives (50 methods)

These methods are only called within their own file, which triggered the "self-file only" flag.
However, they are internal helpers called from public methods that ARE externally invoked.

### SkillWizard Internal Methods (6 methods)

The `SkillWizard.run()` method is registered as a VS Code command handler. These are all
internal steps of the wizard flow invoked through `run()`.

| Method | Why flagged | Why it's NOT dead |
|--------|-------------|-------------------|
| `SkillWizard.addSkillToCollection` | Self-file only | Called by `run()` → registered command handler |
| `SkillWizard.generateSkillContent` | Self-file only | Called by `runValidation()` → `run()` → command |
| `SkillWizard.getCollectionFiles` | Self-file only | Called by `runValidation()` → `run()` → command |
| `SkillWizard.runValidation` | Self-file only | Called by `run()` → registered command handler |
| `SkillWizard.validateDescription` | Self-file only | Validator called by `runValidation()` → `run()` |
| `SkillWizard.validateSkillName` | Self-file only | Validator called by `runValidation()` → `run()` |

**Why flagged:** The analyzer only checks for cross-file calls. These methods are all part of the same
wizard multi-step flow, called from the externally-registered `run()` entry point.

---

### AutoUpdateService Internal Methods (2 methods)

| Method | Why flagged | Why it's NOT dead |
|--------|-------------|-------------------|
| `AutoUpdateService.autoUpdateBundle` | Self-file only | Per-bundle implementation called by `autoUpdateBundles()` which is externally invoked by `UpdateScheduler` |
| `AutoUpdateService.isUpdateInProgress` | Self-file only | Deduplication guard inside `autoUpdateBundle()` |

**Why flagged:** The external caller (`UpdateScheduler`) calls `autoUpdateBundles()` which then
calls `autoUpdateBundle()` for each bundle — a delegation pattern within the same file.

---

### RegistryStorage Cache Management (3 methods)

| Method | Why flagged | Why it's NOT dead |
|--------|-------------|-------------------|
| `RegistryStorage.clearAllCaches` | Self-file only | Called by public methods like `removeSource()` that are externally invoked |
| `RegistryStorage.clearSourceCache` | Self-file only | Called by `removeSource()` → external callers |

**Why flagged:** Cache invalidation is triggered by public mutations. The analyzer doesn't trace
the chain: external caller → `removeSource()` → `clearSourceCache()`.

---

### RepositoryActivationService (1 method)

| Method | Why flagged | Why it's NOT dead |
|--------|-------------|-------------------|
| `RepositoryActivationService.checkAndOfferMissingSources` | Self-file only | Called by `checkAndPromptActivation()` which is invoked from `extension.ts` activation |

**Why flagged:** The entry point `checkAndPromptActivation()` IS externally called from `extension.ts`,
but this internal helper isn't directly visible to the cross-file analyzer.

---

### ScopeConflictResolver (1 method)

| Method | Why flagged | Why it's NOT dead |
|--------|-------------|-------------------|
| `ScopeConflictResolver.checkConflict` | Self-file only | Called by `migrateBundle()` which is called from `BundleScopeCommands` |

**Why flagged:** `migrateBundle()` is the public entry point called externally; `checkConflict()`
is an internal validation step within that flow.

---

### LocalModificationWarningService (2 methods)

| Method | Why flagged | Why it's NOT dead |
|--------|-------------|-------------------|
| `LocalModificationWarningService.checkForModifications` | Self-file only | Called by `showModificationWarning()` which is externally invoked |
| `LocalModificationWarningService.showWarningDialog` | Self-file only | Called by `showModificationWarning()` |

**Why flagged:** The public entry point `showModificationWarning()` is called from multiple
command handlers. Internal steps are just implementation detail.

---

### HubManager Internal Methods (6 methods)

| Method | Why flagged | Why it's NOT dead |
|--------|-------------|-------------------|
| `HubManager.getHub` | Self-file only | Internal lookup used by many public HubManager methods |
| `HubManager.getProfilesWithUpdates` | Self-file only | Internal computation for hub sync operations |
| `HubManager.loadHubSources` | Self-file only | Internal data loading for hub initialization |
| `HubManager.resolveProfileBundles` | Self-file only | Internal bundle resolution for profile operations |
| `HubManager.resolveSource` | Self-file only | Internal source resolution for bundle installation |
| `HubManager.validateHub` | Self-file only | Internal validation before hub operations |

**Why flagged:** `HubManager` is a large class with many public methods that delegate to these
internal helpers. The analyzer flags them because calls come from the same file, but the
public entry points (e.g., `syncHub`, `importHub`, `getActiveProfile`) ARE externally called.

---

### McpConfigLocator Internal Path Builders (4 methods)

| Method | Why flagged | Why it's NOT dead |
|--------|-------------|-------------------|
| `McpConfigLocator.getUserMcpConfigPath` | Self-file only | Called by `getMcpConfigLocation()` which is externally used |
| `McpConfigLocator.getUserTrackingPath` | Self-file only | Called by `getMcpConfigLocation()` |
| `McpConfigLocator.getWorkspaceMcpConfigPath` | Self-file only | Called by `getMcpConfigLocation()` |
| `McpConfigLocator.getWorkspaceTrackingPath` | Self-file only | Called by `getMcpConfigLocation()` |

**Why flagged:** These are path-building helpers for the public `getMcpConfigLocation()` method.
The analyzer sees only same-file calls but doesn't trace the external usage chain.

---

### McpConfigService Internal Methods (2 methods)

| Method | Why flagged | Why it's NOT dead |
|--------|-------------|-------------------|
| `McpConfigService.computeServerIdentity` | Self-file only | Core identity computation used by public config methods |
| `McpConfigService.substituteVariables` | Self-file only | Variable substitution used by public install/uninstall methods |

**Why flagged:** Internal implementation details of publicly-called MCP config operations.

---

### CliWrapper Internal Methods (3 methods)

| Method | Why flagged | Why it's NOT dead |
|--------|-------------|-------------------|
| `CliWrapper.installInTerminal` | Self-file only | Fallback installation path within `install()` |
| `CliWrapper.installWithProgress` | Self-file only | Primary installation path within `install()` |
| `CliWrapper.isAvailable` | Self-file only | Precondition check within `install()` |

**Why flagged:** The public `install()` method IS externally called. These are its internal
implementation steps.

---

### ErrorHandler Internal Helper (1 method)

| Method | Why flagged | Why it's NOT dead |
|--------|-------------|-------------------|
| `ErrorHandler.getUserMessage` | Self-file only | Called by `handle()` which is used by every command handler |

**Why flagged:** `ErrorHandler.handle()` is called from many files. `getUserMessage()` is its
internal helper for constructing user-facing error messages.

---

### MigrationRegistry Internal Methods (2 methods)

| Method | Why flagged | Why it's NOT dead |
|--------|-------------|-------------------|
| `MigrationRegistry.getMigrationState` | Self-file only | Internal accessor powering `runMigration()`, `isMigrationComplete()`, etc. |
| `MigrationRegistry.markMigrationComplete` | Self-file only | Called by `runMigration()` which is externally invoked during activation |

**Why flagged:** These are internal implementation details of the migration system. The public
`runMigration()` is called from `extension.ts` activation.

---

### HubCommands (1 method)

| Method | Why flagged | Why it's NOT dead |
|--------|-------------|-------------------|
| `HubCommands.registerCommands` | Self-file only | Called in constructor; constructor called from `extension.ts` |

**Why flagged:** The constructor is invoked externally (`new HubCommands()` in `extension.ts`),
and it immediately calls `registerCommands()`. The analyzer only sees same-file delegation.

---

### UserScopeService Internal Methods (3 methods)

| Method | Why flagged | Why it's NOT dead |
|--------|-------------|-------------------|
| `UserScopeService.getClaudeSkillsDirectory` | Self-file only | Internal utility for Claude-specific path resolution |
| `UserScopeService.syncSkill` | Self-file only | Per-skill implementation called by public `syncBundle()` |
| `UserScopeService.unsyncSkill` | Self-file only | Per-skill implementation called by public `unsyncBundle()` |

**Why flagged:** These are internal helpers called by externally-invoked `syncBundle()`/`unsyncBundle()`.

---

### RepositoryScopeService (1 method)

| Method | Why flagged | Why it's NOT dead |
|--------|-------------|-------------------|
| `RepositoryScopeService.getTargetPath` | Self-file only | Called internally by sync operations |

**Why flagged:** Called by scope service's own sync methods that are invoked externally.

---

### ApmRuntimeManager/ApmCliWrapper Internal Methods (3 methods)

| Method | Why flagged | Why it's NOT dead |
|--------|-------------|-------------------|
| `ApmRuntimeManager.clearCache` | Self-file only | Cache management called by internal methods |
| `ApmRuntimeManager.getInstallInstructions` | Self-file only | Called when runtime is not available |
| `ApmCliWrapper.isRuntimeAvailable` | Self-file only | Precondition check for APM operations |
| `ApmCliWrapper.validatePackageRef` | Self-file only | Input validation for public methods |

**Why flagged:** Internal implementation details of APM-related operations.

---

### FileUtils (2 methods)

| Method | Why flagged | Why it's NOT dead |
|--------|-------------|-------------------|
| `FileUtils.ensureDirectory` | Self-file only | Called internally by writeFile and other utilities |
| `FileUtils.getStats` | Self-file only | Called internally by getFileSize and other utilities |

**Why flagged:** Foundation utilities called by other FileUtils methods. Note: while `ensureDirectory`
itself is legitimate, many of its callers (like `writeFile`, `writeJson`) are dead code.

---

### RegistryManager (2 methods)

| Method | Why flagged | Why it's NOT dead |
|--------|-------------|-------------------|
| `RegistryManager.isHubProfile` | Self-file only | Internal utility used by profile management methods |
| `RegistryManager.uninstallBundles` | Self-file only | Called by `deactivateProfile()` and `deleteProfile()` which are command handlers |

**Why flagged:** Internal implementations of externally-invoked profile lifecycle commands.

---

### UpdateScheduler (1 method)

| Method | Why flagged | Why it's NOT dead |
|--------|-------------|-------------------|
| `UpdateScheduler.schedulePeriodicChecks` | Self-file only | Called by `initialize()` which is invoked during activation |

**Why flagged:** `initialize()` is called externally; this is its internal scheduling setup.

---

### SetupStateManager (1 method)

| Method | Why flagged | Why it's NOT dead |
|--------|-------------|-------------------|
| `SetupStateManager.isIncomplete` | Self-file only | Internal state check used by setup flow |

**Why flagged:** Called by public methods that are externally invoked.

---

### GitHubAdapter (1 method — NOTE: only `invalidateAuthCache` is dead)

| Method | Why flagged | Why it's NOT dead |
|--------|-------------|-------------------|
| `GitHubAdapter.invalidateAuthCache` | Self-file only | **ACTUALLY DEAD** — called only by dead `getAuthenticationMethod` |

**Note:** This was included in the self-file-only list, but is actually dead because its
only caller (`getAuthenticationMethod`) is itself dead. Listed here as a correction:
`invalidateAuthCache` should be in the dead code report (and is).

---

## IScopeService.getTargetPath — Edge Case

| Method | Why flagged | Verdict |
|--------|-------------|---------|
| `IScopeService.getTargetPath` | 0 direct production callers | **Borderline** — interface definition with implementations. `RepositoryScopeService.getTargetPath` IS called internally. The interface definition itself technically has zero direct callers, but it's a valid interface contract. |

**Why flagged:** The analyzer looks for direct calls to `IScopeService.getTargetPath`. Since
call sites use concrete types (`RepositoryScopeService`, `UserScopeService`), no code
invokes it through the interface type.

---

## Summary

| Category | Count | Reason for false positive |
|----------|-------|--------------------------|
| Internal helpers of externally-called methods | 40 | Analyzer only checks cross-file calls |
| Constructor-called setup methods | 1 | Constructor external, setup internal |
| Interface contract definitions | 1 | Implementations called, not interface itself |
| Cache management internal helpers | 5 | Triggered by public mutations in same file |
| Path builder helpers | 4 | Called by public entry points in same file |

**Root cause of most false positives:** The dead-code analyzer flags methods with zero
*cross-file* callers. Many classes use an internal delegation pattern where a public method
(externally called) delegates to private-style helpers within the same file. These are
legitimate code that should not be removed.

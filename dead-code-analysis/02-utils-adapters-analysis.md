# Dead Code Analysis: Utils & Adapters (`src/utils/`, `src/adapters/`)

Analysis date: 2026-04-02
Tool: `npm run dead-code:methods` (ts-morph static analysis)

---

## FALSE POSITIVES

### McpConfigLocator.getUserMcpConfigPath (static)
- **File**: src/utils/mcp-config-locator.ts:61
- **Category**: Self-file only
- **Evidence**: Called at mcp-config-locator.ts:89 — `const configPath = this.getUserMcpConfigPath()` — inside `getMcpConfigLocation()`, which is itself called by `mcp-config-service.ts` (103, 129, 151, 174, 370)
- **Why not dead**: Internal building block of `getMcpConfigLocation()` which is actively used
- **Why tool flagged it**: Self-file only; ts-morph marks it since no external file calls it directly

### McpConfigLocator.getUserTrackingPath (static)
- **File**: src/utils/mcp-config-locator.ts:74
- **Category**: Self-file only
- **Evidence**: Called at mcp-config-locator.ts:90 inside `getMcpConfigLocation()`, which is the active public API
- **Why not dead**: Same as getUserMcpConfigPath — lower-level path builder
- **Why tool flagged it**: Self-file only call

### McpConfigLocator.getWorkspaceMcpConfigPath (static)
- **File**: src/utils/mcp-config-locator.ts:66
- **Category**: Self-file only
- **Evidence**: Called at mcp-config-locator.ts:97 inside `getMcpConfigLocation()`
- **Why not dead**: Same pattern — workspace variant of the path builder
- **Why tool flagged it**: Self-file only

### McpConfigLocator.getWorkspaceTrackingPath (static)
- **File**: src/utils/mcp-config-locator.ts:79
- **Category**: Self-file only
- **Evidence**: Called at mcp-config-locator.ts:98 inside `getMcpConfigLocation()`
- **Why not dead**: Same pattern
- **Why tool flagged it**: Self-file only

### ErrorHandler.getUserMessage (static)
- **File**: src/utils/error-handler.ts
- **Category**: Self-file only
- **Evidence**: Called internally by `ErrorHandler.handle()` to extract user-facing messages — `handle()` is used extensively across commands (bundle-installation-commands.ts:122, 185, 277; bundle-browsing-commands.ts:176–355; bundle-scope-commands.ts:163, 234, 305; etc.)
- **Why not dead**: Core component of the `handle()` API
- **Why tool flagged it**: Self-file only; external callers use `ErrorHandler.handle()`, not `getUserMessage()` directly

### FileUtils.ensureDirectory (static)
- **File**: src/utils/file-utils.ts
- **Category**: Self-file only
- **Evidence**: Grep confirms it is only called within file-utils.ts itself — however, the broader `fs.mkdir` pattern is used directly throughout the codebase, so this wrapper is not needed externally
- **Why not dead**: Used internally as a helper for other FileUtils methods
- **Why tool flagged it**: Self-file only

### CliWrapper.installWithProgress
- **File**: src/utils/cli-wrapper.ts
- **Category**: Self-file only
- **Evidence**: Called from within cli-wrapper.ts by `install()` or `promptAndInstall()` internal flow
- **Why not dead**: Internal implementation step in the installation sequence
- **Why tool flagged it**: Self-file only

### CliWrapper.installInTerminal
- **File**: src/utils/cli-wrapper.ts
- **Category**: Self-file only
- **Evidence**: Called from within cli-wrapper.ts as a fallback installation path
- **Why not dead**: Internal fallback in the installation decision chain
- **Why tool flagged it**: Self-file only

### CliWrapper.isAvailable
- **File**: src/utils/cli-wrapper.ts
- **Category**: Self-file only
- **Evidence**: Called internally before attempting installation — guards the install flow
- **Why not dead**: Precondition check used within the same file's logic
- **Why tool flagged it**: Self-file only

### NetworkUtils.isUrlAccessible (static)
- **File**: src/utils/network-utils.ts
- **Category**: Self-file only
- **Evidence**: Called from within network-utils.ts by `checkConnectivity()` or similar methods
- **Why not dead**: Internal implementation detail of the connectivity check
- **Why tool flagged it**: Self-file only

### FileUtils.getStats (static)
- **File**: src/utils/file-utils.ts
- **Category**: Self-file only
- **Evidence**: Called from within file-utils.ts to power other stat-based methods
- **Why not dead**: Internal helper for `getFileSize()` and similar methods
- **Why tool flagged it**: Self-file only

---

## TRUE DEAD CODE

### NetworkUtils.buildUrl (static)
- **File**: src/utils/network-utils.ts
- **Category**: Zero callers
- **Evidence**: `NetworkUtils` is not imported anywhere in production code (confirmed by grep — no production files import from `network-utils`)
- **Reason dead**: The NetworkUtils class was built as a utility layer but all network operations in adapters use `axios` directly; this entire class has no production callers

### NetworkUtils.calculateETA (static)
- **File**: src/utils/network-utils.ts
- **Category**: Zero callers
- **Evidence**: No imports of network-utils in production code; class entirely unused
- **Reason dead**: Progress estimation utility; was never wired into download progress reporting

### NetworkUtils.checkConnectivity (static)
- **File**: src/utils/network-utils.ts
- **Category**: Zero callers
- **Evidence**: No production callers
- **Reason dead**: Connectivity pre-check that no command or adapter uses before making requests

### NetworkUtils.downloadFile (static)
- **File**: src/utils/network-utils.ts
- **Category**: Zero callers
- **Evidence**: No production callers; adapters implement their own download methods using axios
- **Reason dead**: Adapters independently download files; this central utility was never adopted

### NetworkUtils.extractDomain (static)
- **File**: src/utils/network-utils.ts
- **Category**: Zero callers
- **Evidence**: No production callers
- **Reason dead**: URL parsing utility unused in any production flow

### NetworkUtils.formatSpeed (static)
- **File**: src/utils/network-utils.ts
- **Category**: Zero callers
- **Evidence**: No production callers
- **Reason dead**: Human-readable speed formatting for download UI that was never implemented

### NetworkUtils.getRemoteFileSize (static)
- **File**: src/utils/network-utils.ts
- **Category**: Zero callers
- **Evidence**: No production callers
- **Reason dead**: Remote file introspection utility never called

### NetworkUtils.getWithRetry (static)
- **File**: src/utils/network-utils.ts
- **Category**: Zero callers
- **Evidence**: No production callers; retry logic is implemented inline in each adapter
- **Reason dead**: Centralized retry helper never adopted by adapters

### FileUtils.changeExtension (static)
- **File**: src/utils/file-utils.ts
- **Category**: Zero callers
- **Evidence**: `FileUtils` is not imported in production code; the class has no external callers
- **Reason dead**: Extension manipulation utility never used

### FileUtils.copyFile (static)
- **File**: src/utils/file-utils.ts
- **Category**: Zero callers
- **Evidence**: No production callers; production code uses `fs.copyFile` directly
- **Reason dead**: Wrapper utility never adopted

### FileUtils.deleteDirectory (static)
- **File**: src/utils/file-utils.ts
- **Category**: Zero callers
- **Evidence**: No production callers; production code uses `fs.rm` or `fs.rmdir` directly
- **Reason dead**: Wrapper utility never adopted

### FileUtils.deleteFile (static)
- **File**: src/utils/file-utils.ts
- **Category**: Zero callers
- **Evidence**: No production callers
- **Reason dead**: Wrapper utility never adopted

### FileUtils.formatFileSize (static)
- **File**: src/utils/file-utils.ts
- **Category**: Zero callers
- **Evidence**: No production callers
- **Reason dead**: Display utility for file sizes never used in UI

### FileUtils.getBasename (static)
- **File**: src/utils/file-utils.ts
- **Category**: Zero callers
- **Evidence**: No production callers; code uses `path.basename()` directly
- **Reason dead**: Thin wrapper around `path.basename` never adopted

### FileUtils.getDirname (static)
- **File**: src/utils/file-utils.ts
- **Category**: Zero callers
- **Evidence**: No production callers; code uses `path.dirname()` directly
- **Reason dead**: Thin wrapper around `path.dirname` never adopted

### FileUtils.getExtension (static)
- **File**: src/utils/file-utils.ts
- **Category**: Zero callers
- **Evidence**: No production callers
- **Reason dead**: Thin wrapper around `path.extname` never adopted

### FileUtils.getFileSize (static)
- **File**: src/utils/file-utils.ts
- **Category**: Zero callers
- **Evidence**: No production callers; `FileUtils.getStats` is only used internally
- **Reason dead**: Convenience wrapper never used externally

### FileUtils.isFile (static)
- **File**: src/utils/file-utils.ts
- **Category**: Zero callers
- **Evidence**: No production callers
- **Reason dead**: Predicate utility never adopted

### FileUtils.joinPaths (static)
- **File**: src/utils/file-utils.ts
- **Category**: Zero callers
- **Evidence**: No production callers; code uses `path.join()` directly
- **Reason dead**: Thin wrapper around `path.join` never adopted

### FileUtils.readJson (static)
- **File**: src/utils/file-utils.ts
- **Category**: Zero callers
- **Evidence**: No production callers; code reads JSON files directly
- **Reason dead**: JSON reading utility never adopted

### FileUtils.sanitizeFilename (static)
- **File**: src/utils/file-utils.ts
- **Category**: Zero callers
- **Evidence**: No production callers; RegistryStorage has its own private sanitization
- **Reason dead**: Was never integrated; each consumer implemented its own sanitization

### FileUtils.writeJson (static)
- **File**: src/utils/file-utils.ts
- **Category**: Zero callers
- **Evidence**: No production callers
- **Reason dead**: JSON writing utility never adopted

### Logger.clear
- **File**: src/utils/logger.ts
- **Category**: Zero callers
- **Evidence**: No src callers of `Logger.clear()` or `logger.clear()` outside logger.ts
- **Reason dead**: Output channel clearing utility that no production code invokes

### Logger.getLogLevel
- **File**: src/utils/logger.ts
- **Category**: Zero callers
- **Evidence**: No src callers
- **Reason dead**: Introspection method never read by any code

### Logger.hide
- **File**: src/utils/logger.ts
- **Category**: Zero callers
- **Evidence**: No src callers
- **Reason dead**: Output panel hiding utility never invoked

### Logger.setLogLevel
- **File**: src/utils/logger.ts
- **Category**: Zero callers
- **Evidence**: No src callers — log level is configured via environment variable `LOG_LEVEL`, not via this method
- **Reason dead**: Programmatic log-level setter superseded by environment-based configuration

### ErrorHandler.createServiceHandler (static)
- **File**: src/utils/error-handler.ts
- **Category**: Zero callers
- **Evidence**: Production code uses `ErrorHandler.handle()` and `ErrorHandler.withErrorHandling()` exclusively; no callers of `createServiceHandler`
- **Reason dead**: Factory pattern for creating reusable handlers was never adopted; callers use inline `.handle()` calls instead

### ErrorHandler.handleCategorized (static)
- **File**: src/utils/error-handler.ts
- **Category**: Zero callers
- **Evidence**: Production code uses `ErrorHandler.handle()`. `ErrorHandler.categorize()` is called at update-checker.ts:108 to inspect error types, but `handleCategorized` is never called
- **Reason dead**: Categorization-aware handler variant that no consumer calls

### CliWrapper.getVersion
- **File**: src/utils/cli-wrapper.ts
- **Category**: Zero callers
- **Evidence**: No external callers
- **Reason dead**: Version probe that was never invoked from any adapter or command

### CliWrapper.promptAndInstall
- **File**: src/utils/cli-wrapper.ts
- **Category**: Zero callers
- **Evidence**: No external callers outside cli-wrapper.ts
- **Reason dead**: User-prompted install flow that was never wired into a VS Code command

### VersionManager.isValidSemver (static)
- **File**: src/utils/version-manager.ts
- **Category**: Zero callers
- **Evidence**: Production code calls `VersionManager.extractBundleIdentity()`, `compareVersions()`, `isUpdateAvailable()`, `isSameBundleIdentity()` — not `isValidSemver()`
- **Reason dead**: Semver validation predicate never used in production validation flows

### VersionManager.parseVersion (static)
- **File**: src/utils/version-manager.ts
- **Category**: Zero callers
- **Evidence**: Not called from any production file
- **Reason dead**: Low-level semver parse utility; higher-level methods like `compareVersions` do the parsing internally

### VersionManager.sortVersionsDescending (static)
- **File**: src/utils/version-manager.ts
- **Category**: Zero callers
- **Evidence**: Not called from any production file
- **Reason dead**: Sort utility not needed by any consumer; version ordering is either handled internally by `compareVersions` or through other sorting patterns

### McpConfigLocator.mcpConfigExists (static)
- **File**: src/utils/mcp-config-locator.ts
- **Category**: Zero callers
- **Evidence**: No production callers; `getMcpConfigLocation()` is used instead (which includes an `exists` flag)
- **Reason dead**: Simpler existence check superseded by the richer `getMcpConfigLocation()` result object which includes `exists: boolean`

### CollectionValidator.validateAllCollections
- **File**: src/utils/collection-validator.ts
- **Category**: Zero callers
- **Evidence**: Not called from any src/ file; `lib/bin/validate-collections.js` uses a DIFFERENT `validateAllCollections` exported from `lib/dist/index.js` — that's a separate implementation in the `lib/` workspace
- **Reason dead**: The `src/` version is a standalone re-implementation never wired into the extension's VS Code commands. The `lib/` version is the one actually used by the GitHub Actions validator

### GitHubAdapter.getAuthenticationMethod
- **File**: src/adapters/github-adapter.ts
- **Category**: Zero callers
- **Evidence**: No src callers outside github-adapter.ts; authentication method is determined internally during `fetchMetadata` and `getDownloadUrl`
- **Reason dead**: Diagnostic accessor for the auth strategy; nothing reads it

### RepositoryAdapterFactory.getRegisteredTypes (static)
- **File**: src/adapters/repository-adapter.ts:216
- **Category**: Zero callers
- **Evidence**: No src callers; factory is used only through `register()` and `create()`
- **Reason dead**: Registry introspection utility that no consumer calls

### RepositoryAdapterFactory.hasAdapter (static)
- **File**: src/adapters/repository-adapter.ts
- **Category**: Zero callers
- **Evidence**: No src callers; adapters are created directly with `create()` which throws if not registered
- **Reason dead**: Existence check before creation was never adopted; `create()` failure handles the missing case

---

## TRUE DEAD CODE (Self-File Only — Transitive Dead Code)

### GitHubAdapter.invalidateAuthCache
- **File**: src/adapters/github-adapter.ts
- **Category**: Self-file only
- **Evidence**: Called only within github-adapter.ts; no external consumer triggers auth cache invalidation
- **Reason dead**: While called within the same file, it is called from `getAuthenticationMethod()` which itself has zero callers — making this transitively dead code through the dead entry point

---

## Summary Table

| Method | Classification | Reason |
|--------|---------------|---------|
| McpConfigLocator.getUserMcpConfigPath | FALSE POSITIVE | Internal building block of getMcpConfigLocation() |
| McpConfigLocator.getUserTrackingPath | FALSE POSITIVE | Internal building block of getMcpConfigLocation() |
| McpConfigLocator.getWorkspaceMcpConfigPath | FALSE POSITIVE | Internal building block of getMcpConfigLocation() |
| McpConfigLocator.getWorkspaceTrackingPath | FALSE POSITIVE | Internal building block of getMcpConfigLocation() |
| ErrorHandler.getUserMessage | FALSE POSITIVE | Internal helper for ErrorHandler.handle() |
| FileUtils.ensureDirectory | FALSE POSITIVE | Internal helper used by other FileUtils methods |
| CliWrapper.installWithProgress | FALSE POSITIVE | Internal implementation step |
| CliWrapper.installInTerminal | FALSE POSITIVE | Internal fallback path |
| CliWrapper.isAvailable | FALSE POSITIVE | Internal precondition check |
| NetworkUtils.isUrlAccessible | FALSE POSITIVE | Internal implementation of checkConnectivity |
| FileUtils.getStats | FALSE POSITIVE | Internal helper for stat-based methods |
| NetworkUtils.buildUrl | **DEAD** | NetworkUtils class is entirely unused in production |
| NetworkUtils.calculateETA | **DEAD** | Unused progress utility |
| NetworkUtils.checkConnectivity | **DEAD** | No production callers |
| NetworkUtils.downloadFile | **DEAD** | Adapters use axios directly |
| NetworkUtils.extractDomain | **DEAD** | No callers |
| NetworkUtils.formatSpeed | **DEAD** | No callers |
| NetworkUtils.getRemoteFileSize | **DEAD** | No callers |
| NetworkUtils.getWithRetry | **DEAD** | Adapters implement retry inline |
| FileUtils.changeExtension | **DEAD** | FileUtils class unused in production |
| FileUtils.copyFile | **DEAD** | Production uses fs.copyFile directly |
| FileUtils.deleteDirectory | **DEAD** | Production uses fs.rm directly |
| FileUtils.deleteFile | **DEAD** | No callers |
| FileUtils.formatFileSize | **DEAD** | No callers |
| FileUtils.getBasename | **DEAD** | Production uses path.basename directly |
| FileUtils.getDirname | **DEAD** | Production uses path.dirname directly |
| FileUtils.getExtension | **DEAD** | Production uses path.extname directly |
| FileUtils.getFileSize | **DEAD** | No external callers |
| FileUtils.isFile | **DEAD** | No callers |
| FileUtils.joinPaths | **DEAD** | Production uses path.join directly |
| FileUtils.readJson | **DEAD** | No callers |
| FileUtils.sanitizeFilename | **DEAD** | Each consumer has own sanitization |
| FileUtils.writeJson | **DEAD** | No callers |
| Logger.clear | **DEAD** | No callers |
| Logger.getLogLevel | **DEAD** | No callers |
| Logger.hide | **DEAD** | No callers |
| Logger.setLogLevel | **DEAD** | LOG_LEVEL env var used instead |
| ErrorHandler.createServiceHandler | **DEAD** | Pattern not adopted |
| ErrorHandler.handleCategorized | **DEAD** | No callers |
| CliWrapper.getVersion | **DEAD** | No external callers |
| CliWrapper.promptAndInstall | **DEAD** | No external callers |
| VersionManager.isValidSemver | **DEAD** | Not used in production |
| VersionManager.parseVersion | **DEAD** | Not used in production |
| VersionManager.sortVersionsDescending | **DEAD** | Not used in production |
| McpConfigLocator.mcpConfigExists | **DEAD** | getMcpConfigLocation().exists used instead |
| CollectionValidator.validateAllCollections | **DEAD** | src/ version duplicates lib/ implementation |
| GitHubAdapter.getAuthenticationMethod | **DEAD** | No external callers |
| RepositoryAdapterFactory.getRegisteredTypes | **DEAD** | No callers |
| RepositoryAdapterFactory.hasAdapter | **DEAD** | No callers |
| GitHubAdapter.invalidateAuthCache | **DEAD** | Transitively dead through getAuthenticationMethod |

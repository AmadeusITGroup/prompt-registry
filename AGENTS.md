# Copilot Instructions for Contributors and AI Agents

These are short, actionable notes to help an AI coding assistant be productive in this repository.

**🚨 MANDATORY FIRST STEP: Read Folder-Specific Guidance BEFORE Writing Code 🚨**

Before working in any folder, **MUST READ** the corresponding AGENTS.md file:

| Working in... | Read first |
|---------------|------------|
| `.kiro/specs/` | `.kiro/specs/AGENTS.md` — Guidance for specifications, design, and tasks |
| `docs/` | `docs/AGENTS.md` — Documentation structure and update guidelines |
| `test/` | `test/AGENTS.md` — Test writing patterns and helpers |
| `test/e2e/` | `test/e2e/AGENTS.md` — E2E test guidance |
| `src/adapters/` | `src/adapters/AGENTS.md` — Adapter implementation guide |
| `src/services/` | `src/services/AGENTS.md` — Service layer patterns |

**Before writing or modifying ANY file, you MUST:**
1. **Identify which folder** the file is in (e.g., `test/services/NewService.test.ts` → folder is `test/`)
2. **Read the corresponding AGENTS.md file FIRST** (e.g., `test/AGENTS.md`)
3. **Apply the guidance** from that file to your changes

**Concrete Examples:**
- Creating `test/services/NewService.test.ts` → **MUST read `test/AGENTS.md` BEFORE writing any test code**
- Modifying `src/adapters/GitHubAdapter.ts` → **MUST read `src/adapters/AGENTS.md` BEFORE making changes**
- Writing `.kiro/specs/new-feature/design.md` → **MUST read `.kiro/specs/AGENTS.md` BEFORE creating the spec**
- Updating `docs/user-guide/getting-started.md` → **MUST read `docs/AGENTS.md` BEFORE editing documentation**
- Creating `src/services/NewManager.ts` → **MUST read `src/services/AGENTS.md` BEFORE implementing the service**
- Adding `test/e2e/new-workflow.test.ts` → **MUST read `test/e2e/AGENTS.md` BEFORE writing E2E tests**

**Failure to read these guides will result in:**
- Broken tests due to incorrect VS Code mocking
- Duplicated utilities that already exist
- Missing critical debugging strategies
- Wasted time on solved problems
- Code that doesn't follow established patterns

---

## Development Methodology

### Bug Fixes: Test First

1. **Reproduce first**: Create a failing test that demonstrates the bug
2. **Confirm failure**: Run the test, verify it fails as expected
3. **Fix the code**: Make the minimal change to fix the issue
4. **Confirm fix**: Run the test, verify it passes
5. **No regression**: Run related tests to ensure nothing broke

### Debugging: Isolate the Fault Location

When tests fail, determine whether the bug is in **test code** or **production code** BEFORE iterating:

1. **Read error messages carefully**: `expected X, got Y` tells you what the code produced vs what was expected
2. **Add debug logging to production code first**: If the test setup looks correct, the bug is likely in production code
3. **Trace data transformations**: When IDs or values change unexpectedly, log at each transformation point
4. **Check for inconsistent code paths**: Different entry points (e.g., `installBundle` vs `updateBundle`) may use different logic
5. **Validate assumptions with real-world testing**: If possible, reproduce the issue in the actual extension before fixing

**Red flags that the bug is in production code:**
- Test fixtures match documented formats but validation fails
- Multiple test approaches fail with the same error pattern
- Error shows data transformation (e.g., `v1.0.0` → `1.0.0`) not present in test code

**Anti-pattern**: Repeatedly modifying test fixtures when the error message shows production code is transforming data incorrectly.

### Test-Driven Development (TDD)

Use TDD when it makes sense (most new functionality):
1. Write a failing test for the expected behavior
2. Write the minimum code to make it pass
3. Refactor if needed, keeping tests green

### 🚨 E2E Testing: NEVER Reimplement Production Code 🚨

**E2E tests must invoke the actual code path, NOT duplicate it.**

This is a critical mistake that defeats the purpose of E2E testing:

❌ **WRONG**: Manually calling internal methods with the same logic as production code
```typescript
// This is NOT an E2E test - it duplicates production code!
const result = await scopeConflictResolver.migrateBundle(
    bundleId, 'repository', 'user',
    async () => { await registryManager.uninstallBundle(bundleId, 'repository'); },
    async (bundle, scope) => { await registryManager.installBundle(bundleId, { scope }); }
);
```

✅ **CORRECT**: Test through the actual entry point
```typescript
// Option 1: VS Code Extension Tests (test/suite/*.test.ts) - runs in real VS Code
await vscode.commands.executeCommand('promptRegistry.moveToUser', bundleId);

// Option 2: Test through the command handler class
const bundleScopeCommands = new BundleScopeCommands(registryManager, resolver, service);
await bundleScopeCommands.moveToUser(bundleId);
```

**Why this matters:**
- If production code has a bug, duplicated test code has the same bug
- Tests don't catch regressions when production code changes
- Tests don't verify command registration wiring in `extension.ts`

**See `test/AGENTS.md` for detailed E2E testing guidance.**

### Test Completion Criteria

**CRITICAL**: Before marking any test-related task as complete, verify ALL of the following:

1. **Compilation**: All test files must compile without TypeScript errors
2. **Mock Setup**: All mocks must be properly configured (no "Property 'X' is private" errors, no type mismatches)
3. **Execution**: Tests must be runnable (even if they fail assertions - that's expected in RED phase)
4. **RED Phase**: For TDD tasks, tests should fail for the RIGHT reason (missing implementation), not wrong reasons (broken mocks, syntax errors, import errors)

**If tests won't run due to setup issues YOU introduced, the task is incomplete.**

**What counts as YOUR responsibility:**
- Mock setup issues caused by your code changes
- Type errors introduced by your implementation
- Compilation failures from your new code
- Import errors from files you created

**What does NOT count:**
- Pre-existing test failures
- Flaky tests that were already flaky
- Infrastructure issues (network, file system)

**Before stopping work on a task**: Run the tests to verify they compile and mocks are properly set up. If you introduced compilation errors or mock issues, fix them first.

### Minimal Code Principle

- Write the **absolute minimum** code to solve the requirement
- No extras, no abstractions, no "nice-to-haves"
- Every line must directly contribute to the solution—if it doesn't, delete it
- Prefer simple, direct implementations over clever ones

### Backward Compatibility

- **Do NOT** try to be backward compatible with changes just introduced in the same session or in the current changed files
- **For new features**: Ask the user if backward compatibility is required before proposing a design
- If backward compatibility is needed, document the migration path

### Discovery Before Design

Before implementing anything new:
1. Search for existing similar functionality (`grep -r "class.*Manager" src/`)
2. Check if utilities already exist in `src/utils/` or `test/helpers/`
3. Review tests for established patterns
4. Reuse before rewriting, consolidate before duplicating

---

## Big Picture

This is a VS Code extension (Prompt Registry) that provides a marketplace and registry for Copilot prompt bundles.

### Architecture Overview

```
src/
├── adapters/     → Source-specific implementations (GitHub, GitLab, Local, etc.)
├── commands/     → VS Code command handlers
├── services/     → Core business logic (RegistryManager, BundleInstaller, etc.)
├── storage/      → Persistent state management
├── types/        → TypeScript type definitions
├── ui/           → UI providers (Marketplace WebView, Tree View)
├── utils/        → Shared utilities
└── extension.ts  → Entry point
```

### Key Components

- **UI surface**: `src/ui/*` (Marketplace and `RegistryTreeProvider`)
- **Orchestration**: `src/services/RegistryManager.ts` (singleton) coordinates adapters, storage, and installer
- **Installation flow**: adapters produce bundle metadata/URLs → `BundleInstaller` downloads/extracts/validates → scope services sync to target directories
- **Scope services**: `UserScopeService` (user/workspace) and `RepositoryScopeService` (repository) handle scope-specific file placement
- **Lockfile management**: `LockfileManager` manages `prompt-registry.lock.json` for repository-scoped bundles

### Key Files

| File | Purpose |
|------|---------|
| `src/services/RegistryManager.ts` | Main entrypoint, event emitters |
| `src/services/BundleInstaller.ts` | Download/extract/validate/install logic |
| `src/services/LockfileManager.ts` | Lockfile CRUD for repository-scoped bundles |
| `src/services/UserScopeService.ts` | User/workspace scope file placement |
| `src/services/RepositoryScopeService.ts` | Repository scope file placement |
| `src/adapters/*` | Source implementations (github, gitlab, http, local, awesome-copilot) |
| `src/storage/RegistryStorage.ts` | Persistent paths and JSON layout |
| `src/commands/*` | Command handlers wiring UI to services |

---

## Development Workflows

### Commands

```bash
npm install                    # Install dependencies
npm run compile                # Production webpack bundle
npm run watch                  # Dev watch mode

# Testing (always prefix with LOG_LEVEL=ERROR unless debugging)
npm run test:one -- test/services/MyService.test.ts
LOG_LEVEL=ERROR npm run test:unit
LOG_LEVEL=ERROR npm test

# Capture test output for analysis
LOG_LEVEL=ERROR npm test 2>&1 | tee test.log | tail -20

npm run lint                   # ESLint
npm run package:vsix           # Create .vsix package
```

### Log Management

- Minimize context pollution: pipe long output through `tee <name>.log | tail -20`
- Analyze existing logs with `grep` before re-running tests
- When a command fails, summarize from tail output, refer to stored log for details
- **For checkpoint tasks**: If full test suite passes, analyze the log - do NOT re-run individual tests

---

## Project Conventions

### Singletons
`RegistryManager.getInstance(context?)` requires ExtensionContext on first call. Pass `context` from `extension.ts`.

### Storage
Persistent data lives under `context.globalStorageUri.fsPath`. Use `RegistryStorage.getPaths()`.

### Bundles
Valid bundles require `deployment-manifest.yml` at root. `BundleInstaller.validateBundle` enforces id/version/name.

### Adapters
Register via `RepositoryAdapterFactory.register('type', AdapterClass)`. Implement `IRepositoryAdapter`.

### Scopes
Installs support `user`, `workspace`, and `repository` scopes. Repository scope uses the lockfile (`prompt-registry.lock.json`) as the single source of truth.

### Error Handling
Use `Logger.getInstance()`. Throw errors with clear messages. Commands catch and show via VS Code notifications.

---

## Integration Points

- **Network**: Adapters use `axios`. Unit tests use `nock` for HTTP mocking.
- **File I/O**: Bundle extraction uses `adm-zip`. Clean temp directories in tests.
- **VS Code API**: Activation lifecycle, `ExtensionContext` storage URIs, event emitters.

---

## Quick Examples

### Add a new adapter
Copy `src/adapters/HttpAdapter.ts`, implement `fetchBundles()`/`getDownloadUrl()`/`validate()`, register in `RegistryManager`.

### Fix bundle validation
Update `BundleInstaller.validateBundle()` — manifest version must match bundle.version unless `'latest'`.

### Inspect installed bundles
Open extension global storage path (see `RegistryStorage.getPaths().installed`) or enable `promptregistry.enableLogging`.

---

## What to Avoid

- Don't assume OS-specific Copilot paths—use `UserScopeService` and `platformDetector.ts`
- Don't change activation events without updating `package.json` and tests
- Don't duplicate utilities—check `src/utils/` and `test/helpers/` first
- Don't over-engineer—solve the immediate problem only

---

## **MANDATORY** Documentation Updates

**After implementing features or fixing bugs, you MUST update documentation.** Consult [`docs/README.md`](docs/README.md) to identify which files need updates.

| Change type | Update these docs |
|-------------|-------------------|
| New command | `docs/reference/commands.md` |
| New setting | `docs/reference/settings.md` |
| New adapter | `docs/contributor-guide/architecture/adapters.md`, `docs/reference/adapter-api.md` |
| Installation/update flow changes | `docs/contributor-guide/architecture/installation-flow.md`, `docs/contributor-guide/architecture/update-system.md` |
| UI changes | `docs/contributor-guide/architecture/ui-components.md` |
| User-facing behavior | Relevant file in `docs/user-guide/` |
| Schema changes | `docs/author-guide/collection-schema.md` or `docs/reference/hub-schema.md` |

**Documentation standards:**
1. **Keep it concise** — One clear sentence beats three vague ones
2. **Update the right file** — See [docs/AGENTS.md](docs/AGENTS.md) for file placement guidance
3. **Verify accuracy** — Ensure docs match the implemented behavior

---

## **MANDATORY** Documentation Discovery

**Before planning or implementing features**, consult the documentation index at [`docs/README.md`](docs/README.md) to understand existing designs and user-facing behavior.

| Working on... | Read first |
|---------------|------------|
| Installation/update flows | `docs/contributor-guide/architecture/installation-flow.md`, `docs/contributor-guide/architecture/update-system.md` |
| Adapters (GitHub, GitLab, etc.) | `docs/contributor-guide/architecture/adapters.md`, `docs/reference/adapter-api.md` |
| Authentication | `docs/contributor-guide/architecture/authentication.md` |
| UI (Marketplace, TreeView) | `docs/contributor-guide/architecture/ui-components.md` |
| Validation logic | `docs/contributor-guide/architecture/validation.md` |
| MCP integration | `docs/contributor-guide/architecture/mcp-integration.md` |
| Commands or settings | `docs/reference/commands.md`, `docs/reference/settings.md` |
| Bundle/collection schemas | `docs/author-guide/collection-schema.md`, `docs/reference/hub-schema.md` |
| Testing strategy | `docs/contributor-guide/testing.md` |

**Why this matters:**
- Prevents reimplementing existing documented behavior
- Ensures new code aligns with documented architecture
- Avoids breaking user-facing contracts described in user guides

---

## **MANDATORY** Folder-Specific Guidance

See the [FIRST STEP table at the top of this file](#-first-step-read-folder-specific-guidance-) for the complete list of folder-specific AGENTS.md files you **MUST** read before working in those areas.

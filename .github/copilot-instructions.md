# Copilot instructions for contributors and AI agents

These are short, actionable notes to help an AI coding assistant be productive in this repository.

- Big picture: This is a VS Code extension (Prompt Registry) that provides a marketplace and registry for Copilot prompt bundles.
  - UI surface: `src/ui/*` (Marketplace and `RegistryTreeProvider`).
  - Orchestration: `src/services/RegistryManager.ts` (singleton) coordinates adapters, storage and the installer.
  - Installation flow: adapters in `src/adapters/*` produce bundle metadata and download URLs → `BundleInstaller` (`src/services/BundleInstaller.ts`) downloads/extracts/validates `deployment-manifest.yml` and copies into extension storage → `CopilotSyncService` syncs to Copilot native folders.

- Key files to consult for behavior examples:
  - `src/services/RegistryManager.ts` — main entrypoint and event emitters (install/uninstall/profile events).
  - `src/services/BundleInstaller.ts` — download/extract/validate/copy/uninstall logic. Shows how `deployment-manifest.yml` is required and how `installPath` is computed.
  - `src/adapters/*` — implementations for `github`, `gitlab`, `http`, `local`, `awesome-copilot`. Add new sources by following `RepositoryAdapterFactory` registration in `RegistryManager`.
  - `src/storage/RegistryStorage.ts` — persistent paths (globalStorageUri) and JSON layout for sources, installed bundles and caches.
  - `src/commands/*` — command handlers that wire UI actions to services (good examples: `installCommand.ts`, `SourceCommands.ts`).
  - `package.json` — scripts and npm lifecycle (build/test/watch/package).

- Tests & development workflows (concrete commands)
  - Install deps: `npm install`.
  - Build extension: `npm run compile` (production webpack bundle) or `npm run watch` (dev watch).
  - Compile tests: `npm run compile-tests` (generates test-dist). Use `npm run watch-tests` to auto-compile tests.
  - Run unit tests: `npm run test:unit` (mocha against `test-dist`).
  - Run integration/extension tests: `npm run test:integration` (uses @vscode/test-electron runner). Run on a machine with a GUI or headless environment configured.
  - Lint: `npm run lint` (eslint on `src/*.ts`).
  - Package VSIX: `npm run package:vsix` (via `vsce package`) or `npm run package:full` for a full prepared package.
  - Pretest pipeline: `npm run pretest` runs compile-tests, compile, then lint — tests expect compiled JS in `dist`/`test-dist`.

- Project-specific conventions
  - Singletons: `RegistryManager.getInstance(context?)` requires an ExtensionContext on first call. Many services follow this pattern; pass `context` from `extension.ts` when activating.
  - Storage: persistent data lives under the extension's global storage (`context.globalStorageUri.fsPath`). `RegistryStorage.getPaths()` exposes locations; tests may mock or read these paths.
  - Bundles: A valid bundle must include `deployment-manifest.yml` at the root. `BundleInstaller.validateBundle` enforces id/version/name checks.
  - Adapter factory: Register new adapters via `RepositoryAdapterFactory.register('type', AdapterClass)` and implement `IRepositoryAdapter` in `src/adapters/RepositoryAdapter.ts`.
  - Scopes: installs support `user` and `workspace` scopes; `BundleInstaller.getInstallDirectory` and `RegistryStorage` mirror that layout.
  - Error handling/logging: use `Logger.getInstance()` and prefer throwing errors with clear messages; commands often catch and show messages via VS Code notifications/UI.

- Integration points to be careful about
  - Network: adapters use `axios`/https and must handle redirects and rate limits. Unit tests use `nock` for HTTP mocking.
  - File I/O: Bundle extraction uses `adm-zip` and filesystem operations—ensure temp directories are cleaned in tests.
  - VS Code API: activation lifecycle, `ExtensionContext` storage URIs and event emitters are core — tests for extension behavior should use the VS Code test runner.

- Quick examples you can use in edits
  - Add a new adapter: copy `src/adapters/HttpAdapter.ts`, implement `fetchBundles()`/`getDownloadUrl()`/`validate()` and register it in `RegistryManager` constructor.
  - Fix bundle version mismatch: update `BundleInstaller.validateBundle()` — manifest version must match bundle.version unless bundle.version === 'latest'.
  - To inspect installed bundles at runtime: open the extension global storage path (see `RegistryStorage.getPaths().installed`) or enable `promptregistry.enableLogging` and view Output → Prompt Registry.

- What to avoid / non-discoverable assumptions
  - Do not assume OS-specific Copilot paths; the extension computes install/sync paths via `CopilotSyncService` and `platformDetector.ts`.
  - Don't change activation events without updating `package.json.contributes.activationEvents` and tests.

If anything above is unclear or you'd like me to expand a section (for example, sample unit test scaffolding, the Extension activation flow in `src/extension.ts`, or a short list of representative tests in `test/`), tell me which part and I'll iterate.
# Adapter Architecture

Adapters provide a unified interface for fetching bundles from different source types.

## IRepositoryAdapter Interface

```typescript
interface IRepositoryAdapter {
    readonly type: string;
    readonly source: RegistrySource;
    fetchBundles(): Promise<Bundle[]>;
    downloadBundle(bundle: Bundle): Promise<Buffer>;
    fetchMetadata(): Promise<SourceMetadata>;
    validate(): Promise<ValidationResult>;
    requiresAuthentication(): boolean;
    getManifestUrl(bundleId: string, version?: string): string;
    getDownloadUrl(bundleId: string, version?: string): string;
    forceAuthentication?(): Promise<void>;
}
```

## Adapter Types

| Adapter | Source Type | Installation Method | Status |
|---------|-------------|---------------------|--------|
| **GitHubAdapter** | `github` | URL-based (getDownloadUrl) | Active |
| **LocalAdapter** | `local` | Buffer-based (downloadBundle) | Active |
| **AwesomeCopilotAdapter** | `awesome-copilot` | Buffer-based (builds zip on-the-fly) | Active |
| **LocalAwesomeCopilotAdapter** | `local-awesome-copilot` | Buffer-based | Active |
| **AwesomeCopilotPluginAdapter** | `awesome-copilot-plugin` | Buffer-based (builds zip on-the-fly from `plugin.json`) | Active |
| **LocalAwesomeCopilotPluginAdapter** | `local-awesome-copilot-plugin` | Buffer-based | Active |
| **ApmAdapter** | `apm` | URL-based | Active |
| **LocalApmAdapter** | `local-apm` | Buffer-based | Active |

Source types are defined in `src/types/registry.ts`:
```typescript
export type SourceType = 'github' | 'local' |
    'awesome-copilot' | 'local-awesome-copilot' |
    'awesome-copilot-plugin' | 'local-awesome-copilot-plugin' |
    'apm' | 'local-apm' |
    'skills' | 'local-skills';
```

### Plugin adapters vs. collection adapters

`awesome-copilot` / `local-awesome-copilot` consume the **collection** format (`collections/*.collection.yml`). `awesome-copilot-plugin` / `local-awesome-copilot-plugin` consume the newer **plugin** format (`plugins/<id>/.github/plugin/plugin.json`, upstream-compatible with `github/awesome-copilot` PR #717). Both plugin adapters share pure helpers via `src/adapters/plugin-adapter-shared.ts` (types, manifest parsing, breakdown calculation, YAML serialization, deployment manifest construction); only the I/O layer differs (HTTP + GitHub Contents API vs. local filesystem).

## Two Installation Paths

**URL-Based** (`install()`):
- Pre-packaged zip bundles on remote servers
- Direct download from URL
- Used by: GitHub, AwesomeCopilot

**Buffer-Based** (`installFromBuffer()`):
- Dynamically created bundles
- Builds zip in memory
- Used by: AwesomeCopilot, AwesomeCopilotPlugin, Local

## Adding a New Adapter

```typescript
// 1. Extend RepositoryAdapter base class
export class MyAdapter extends RepositoryAdapter {
    readonly type = 'my-type';
    
    async fetchBundles(): Promise<Bundle[]> { /* ... */ }
    async downloadBundle(bundle: Bundle): Promise<Buffer> { /* ... */ }
    async fetchMetadata(): Promise<SourceMetadata> { /* ... */ }
    async validate(): Promise<ValidationResult> { /* ... */ }
    getManifestUrl(bundleId: string, version?: string): string { /* ... */ }
    getDownloadUrl(bundleId: string, version?: string): string { /* ... */ }
}

// 2. Register in factory
RepositoryAdapterFactory.register('my-type', MyAdapter);

// 3. Add to SourceType union in src/types/registry.ts
export type SourceType = 'github' | 'local' |
    'awesome-copilot' | 'local-awesome-copilot' |
    'awesome-copilot-plugin' | 'local-awesome-copilot-plugin' |
    'apm' | 'local-apm' |
    'skills' | 'local-skills' | 'my-type';
```

## See Also

- [Authentication](./authentication.md) — Auth for private repos
- [Installation Flow](./installation-flow.md) — How bundles are installed

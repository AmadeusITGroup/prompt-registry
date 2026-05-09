# Awesome Copilot Plugin Format Migration

## Problem Statement

GitHub's `awesome-copilot` repository deprecated `*.collection.yml` files (PR #717, Issue #711) in favour of a new **Plugin** format. Our `AwesomeCopilotAdapter` and `LocalAwesomeCopilotAdapter` exclusively parse `collections/*.collection.yml` files and will break when pointed at the updated repository (or any fork that adopted the new format).

## Context

### Old Format (Collections) — DEPRECATED
```
collections/
  azure-cloud-development.collection.yml   # YAML
  frontend-web-dev.collection.yml
```

Each `.collection.yml`:
```yaml
id: azure-cloud-development
name: Azure & Cloud Development
description: Comprehensive Azure cloud development tools...
tags: [azure, cloud, infrastructure]
items:
  - path: prompts/azure-resource-health.prompt.md
    kind: prompt
  - path: instructions/bicep-best-practices.instructions.md
    kind: instruction
```

- **Discovery**: GitHub API listing of `collections/` directory, filter `*.collection.yml`
- **Item paths**: Absolute from repo root (e.g., `prompts/foo.prompt.md`)
- **Format**: YAML

### New Format (Plugins) — CURRENT
```
plugins/
  azure-cloud-development/
    .github/plugin/plugin.json             # JSON
    agents/
    skills/
      azure-resource-health-diagnose/
      az-cost-optimize/
```

Each `plugin.json` (from website `plugins.json`):
```json
{
  "id": "azure-cloud-development",
  "name": "azure-cloud-development",
  "description": "Comprehensive Azure cloud development tools...",
  "path": "plugins/azure-cloud-development",
  "tags": ["azure", "cloud", "infrastructure"],
  "itemCount": 5,
  "items": [
    { "kind": "agent", "path": "./agents" },
    { "kind": "skill", "path": "./skills/azure-resource-health-diagnose" }
  ]
}
```

- **Discovery**: List `plugins/` directory for subdirectories, read `<plugin-dir>/.github/plugin/plugin.json`
- **Item paths**: Relative to plugin directory (e.g., `./skills/foo`, `./agents`)
- **Format**: JSON
- **Additional fields**: `itemCount`, `featured`, `display`, `external`, `source`, `repository`, `homepage`, `author`

### Key Differences

| Aspect | Collections (old) | Plugins (new) |
|--------|-------------------|---------------|
| Location | `collections/<id>.collection.yml` | `plugins/<id>/.github/plugin/plugin.json` |
| Format | YAML | JSON |
| Item paths | Absolute from repo root | Relative to plugin dir (`./`) |
| Item kinds | `prompt`, `instruction`, `chat-mode`, `agent`, `skill` | `agent`, `skill` (simplified) |
| Content structure | Items scattered across repo dirs | Self-contained per plugin dir |
| Download strategy | Fetch individual files by path | Fetch entire plugin directory |
| MCP servers | Inline `mcp.items` / `mcpServers` | TBD (may be in plugin.json) |

## Approaches Considered

### Approach A: Extend Existing Adapters with Format Auto-Detection
Add plugin-format support directly into `AwesomeCopilotAdapter` / `LocalAwesomeCopilotAdapter`. Auto-detect which format is present (try `plugins/` first, fall back to `collections/`).

**Pros**: No new files, single adapter type  
**Cons**: Bloats existing classes, violates SRP, complex branching logic in every method

### Approach B: Strategy Pattern — Inject Format Strategy
Create a `CollectionFormatStrategy` and `PluginFormatStrategy` implementing a common interface. The existing adapters delegate discovery/parsing to the active strategy.

**Pros**: Clean separation, easy to add formats  
**Cons**: Over-engineered for two formats, adds abstraction layer

### Approach C: Parallel Adapter Registration (CHOSEN)
Create new `AwesomeCopilotPluginAdapter` (remote) and `LocalAwesomeCopilotPluginAdapter` (local) that handle the plugin format. Register them alongside the existing adapters. Users choose the source type at configuration time.

Additionally, add auto-detection in the existing adapters: if `collections/` directory is missing/empty but `plugins/` exists, log a migration warning and suggest switching source type.

**Pros**: Minimal changes to existing code, follows established adapter pattern, clean separation, existing collection-format users are unaffected  
**Cons**: More files (but follows existing codebase pattern of one adapter per source type)

## Chosen Approach: C — Parallel Adapters

### Rationale
1. **Follows established pattern**: Every source type has its own adapter class (github, gitlab, http, local, awesome-copilot, etc.)
2. **Zero risk to existing users**: Collection-format adapters remain untouched
3. **Clean migration path**: Users add a new source with type `awesome-copilot-plugin` or `local-awesome-copilot-plugin`
4. **Minimal code**: New adapters share ~70% logic with existing ones (auth, URL building, archive creation); only discovery + parsing differs
5. **Testable**: Each adapter tested independently with its own fixtures

### Design

#### New Source Types
- `awesome-copilot-plugin` — Remote GitHub plugin-format repos
- `local-awesome-copilot-plugin` — Local plugin-format directories

#### New Files
- `src/adapters/awesome-copilot-plugin-adapter.ts`
- `src/adapters/local-awesome-copilot-plugin-adapter.ts`
- `test/adapters/awesome-copilot-plugin-adapter.test.ts`
- `test/adapters/local-awesome-copilot-plugin-adapter.test.ts`
- `test/fixtures/local-awesome-plugins/` (test fixtures)

#### Shared Types (new interface)
```typescript
interface PluginManifest {
  id: string;
  name: string;
  description: string;
  path: string;
  tags: string[];
  itemCount: number;
  items: PluginItem[];
  featured?: boolean;
  display?: { ordering?: string; show_badge?: boolean };
  external?: boolean;
  repository?: string;
  homepage?: string;
  author?: { name: string; url?: string };
  license?: string;
  source?: { source: string; repo: string; path: string };
}

interface PluginItem {
  kind: 'agent' | 'skill' | 'prompt' | 'instruction' | 'chat-mode';
  path: string; // relative, e.g., "./skills/foo" or "./agents"
}
```

#### Discovery Logic (Remote)
1. GitHub API: `GET /repos/{owner}/{repo}/contents/plugins?ref={branch}`
2. Filter for directories (type === 'dir')
3. For each plugin dir: `GET raw.githubusercontent.com/{owner}/{repo}/{branch}/plugins/{id}/.github/plugin/plugin.json`
4. Parse JSON → `PluginManifest`
5. Convert to `Bundle`

#### Discovery Logic (Local)
1. Read `plugins/` directory
2. For each subdirectory: read `<dir>/.github/plugin/plugin.json`
3. Parse JSON → `PluginManifest`
4. Convert to `Bundle`

#### Download Logic
1. For each item in plugin manifest:
   - `kind: 'skill'` → Fetch entire `plugins/<id>/<item.path>` directory recursively
   - `kind: 'agent'` → Fetch entire `plugins/<id>/<item.path>` directory recursively
   - Other kinds → Fetch individual files
2. Create ZIP archive with `deployment-manifest.yml`

#### Config
```typescript
interface AwesomeCopilotPluginConfig {
  branch?: string;          // default: 'main'
  pluginsPath?: string;     // default: 'plugins'
}
```

`RegistrySource.config`:
```typescript
config: {
  branch: 'main',
  pluginsPath: 'plugins'   // new field (replaces collectionsPath)
}
```

#### Registration
```typescript
RepositoryAdapterFactory.register('awesome-copilot-plugin', AwesomeCopilotPluginAdapter);
RepositoryAdapterFactory.register('local-awesome-copilot-plugin', LocalAwesomeCopilotPluginAdapter);
```

#### RegistrySource Type Extension
Add new source types to the `SourceType` union:
```typescript
type SourceType = ... | 'awesome-copilot-plugin' | 'local-awesome-copilot-plugin';
```

#### Auto-Update Behavior
Add the new source types to the auto-update switch case in `RegistryManager`:
```typescript
case 'awesome-copilot-plugin':
case 'local-awesome-copilot-plugin':
  // Same auto-update behavior as awesome-copilot
```

## Implementation Plan (TDD)

### Phase 1: Types & Interfaces
1. Add `PluginManifest` and `PluginItem` types
2. Add new source types to `SourceType`

### Phase 2: Remote Plugin Adapter (TDD)
1. Write failing tests for `AwesomeCopilotPluginAdapter`
2. Implement discovery (list plugin dirs, fetch plugin.json)
3. Implement parsing (plugin.json → Bundle)
4. Implement download (archive creation)
5. Implement validate/metadata

### Phase 3: Local Plugin Adapter (TDD)
1. Create test fixtures (`test/fixtures/local-awesome-plugins/`)
2. Write failing tests for `LocalAwesomeCopilotPluginAdapter`
3. Implement (follows same pattern as LocalAwesomeCopilotAdapter)

### Phase 4: Registration & Integration
1. Register new adapters in `RegistryManager`
2. Add auto-update case for new source types
3. Run full test suite

### Phase 5: Backward-Compat Warning
1. In existing `AwesomeCopilotAdapter.validate()`, add warning if `collections/` is empty but `plugins/` exists

## Self-Reflection

### Strengths
- **Minimal blast radius**: Zero changes to existing adapters' core logic
- **Pattern consistency**: Follows the exact same approach used for every other adapter
- **Independent testing**: Each adapter has its own test file and fixtures
- **Future-proof**: If the plugin format evolves, only the new adapters need updating

### Weaknesses / Risks
- **Code duplication**: The new adapters share auth, URL building, archive logic with existing ones
  - **Mitigation**: Accept controlled duplication for now. If 3+ formats emerge, extract a shared base class
- **Two source types to configure**: Users need to know which type to use
  - **Mitigation**: Add validate() warning in old adapter suggesting migration
- **Plugin.json may evolve**: The format is new and may change
  - **Mitigation**: Loose parsing — ignore unknown fields, provide sensible defaults

### What I chose NOT to do
- **Auto-detection**: Considered having one source type that auto-detects format. Rejected because it adds network calls (try collections, fail, try plugins) and makes debugging harder.
- **Base class extraction**: Could extract shared logic into `AbstractAwesomeCopilotAdapter`. Rejected as premature optimization — the two adapters differ significantly in discovery logic.
- **Deprecation of collection adapters**: The old format may still be used by forks. Keep both indefinitely.

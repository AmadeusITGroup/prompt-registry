# Phase 2: Plugin Schema, Validation & Agent/Instruction Binding

## Research Findings

### 1. How Awesome-Copilot Ties Instructions & Agents into Plugins

The PR #717 migrated the scattered items from collection.yml into self-contained plugin directories:

```
plugins/<id>/
  .github/plugin/plugin.json    # Metadata + items manifest
  agents/                        # Agent markdown files (*.agent.md, *.chatmode.md)
  skills/                        # Skills (SKILL.md + supporting files)
    <skill-name>/
      SKILL.md
  instructions/                  # Instruction files (*.instructions.md)  
  prompts/                       # Prompt files (*.prompt.md)
```

**Key change**: In the old collection format, items referenced files scattered across the repo root
(`prompts/foo.prompt.md`, `instructions/bar.instructions.md`). In the new plugin format, each plugin
is self-contained — agents, skills, instructions, and prompts live *inside* the plugin directory.

The `items` array in plugin.json references directories relative to the plugin root:
- `{"kind": "agent", "path": "./agents"}` — entire agents directory
- `{"kind": "skill", "path": "./skills/my-skill"}` — specific skill directory

**Observed item kinds in production data**: Only `agent` and `skill` appear in the actual plugins.json.
Instructions and prompts are implicitly included via the agents directory or embedded in skills.

### 2. Format Comparison Matrix

| Field | Our Collection Schema | AC Plugin Format | Anthropic Plugin |
|-------|----------------------|-----------------|-----------------|
| **Location** | `collections/<id>.collection.yml` | `plugins/<id>/.github/plugin/plugin.json` | `.claude-plugin/plugin.json` |
| **Format** | YAML | JSON | JSON |
| **id** | required, `^[a-z0-9-]+$` | required | N/A (uses name) |
| **name** | required, max 100 | required | required (only required field) |
| **description** | required, max 500 | required | optional |
| **version** | optional, semver | absent | optional, semver |
| **author** | optional, string | optional, `{name, url}` | optional, `{name, email, url}` |
| **tags** | optional, string[] | optional, string[] | `keywords`: string[] |
| **items** | required, `[{path, kind}]` | required, `[{kind, path}]` | N/A (discovered from dirs) |
| **Item kinds** | prompt/instruction/chat-mode/agent/skill | agent/skill (observed) | N/A |
| **Item paths** | Absolute from repo root | Relative (`./`) | Relative (`./`) |
| **MCP servers** | `mcp.items` (full config) | absent | `mcpServers` → `.mcp.json` |
| **display** | `{color, icon, ordering, show_badge}` | `{ordering, show_badge}` (in PR) | N/A |
| **external** | N/A | boolean | N/A |
| **source** | N/A | `{source, repo, path}` | `{source, url, sha, path, ref}` |
| **repository** | N/A | URL string | URL string |
| **homepage** | N/A | URL string | URL string |
| **license** | N/A | string | string |
| **featured** | N/A | boolean (in PR) | N/A |
| **hooks** | N/A | N/A | `hooks` path |
| **commands** | N/A | N/A | `commands` path |
| **lspServers** | N/A | N/A | `lspServers` path |

### 3. Key Insights

1. **Awesome-copilot plugin.json is simpler than our collection schema** — it lost MCP servers, version, and display config
2. **Anthropic's format is richer** but structurally different — it uses directory-based discovery instead of explicit item lists
3. **Both new formats use JSON** instead of YAML
4. **Both use relative paths** (`./`) instead of absolute from repo root
5. **Item kinds narrowed**: In practice, only `agent` and `skill` are used in awesome-copilot plugins (instructions/prompts are bundled into the plugin directory implicitly)

## Design: plugin.schema.json

### Approach: Superset Schema

Create `plugin.schema.json` that:
1. **Validates the upstream awesome-copilot plugin.json** as-is (no upstream data rejected)
2. **Extends with our custom fields** (MCP servers, version, display) for our own plugins
3. **Maintains parity with collection.schema.json** so migrated collections keep the same validation depth
4. **Forward-compatible with Anthropic** by accepting `keywords` as alias for `tags`

### Schema Design

```json
{
  "required": ["id", "name", "description", "items"],
  "properties": {
    "id": { "type": "string", "pattern": "^[a-z0-9-]+$" },
    "name": { "type": "string", "minLength": 1, "maxLength": 100 },
    "description": { "type": "string", "minLength": 1, "maxLength": 500 },
    "version": { "type": "string", "pattern": "^\\d+\\.\\d+\\.\\d+$" },
    "author": { "oneOf": [{"type": "string"}, {"type": "object", ...}] },
    "tags": { "type": "array", "items": {"type": "string"} },
    "items": { "type": "array", "items": { "required": ["kind", "path"], ... } },
    "itemCount": { "type": "integer" },
    "path": { "type": "string" },
    "featured": { "type": "boolean" },
    "display": { ... },
    "external": { "type": "boolean" },
    "repository": { "type": "string" },
    "homepage": { "type": "string" },
    "license": { "type": "string" },
    "source": { ... },
    "mcp": { ... }  // Our extension: same MCP schema as collection.schema.json
  }
}
```

### Implementation Plan

1. **Create `schemas/plugin.schema.json`** — JSON Schema for plugin.json validation
2. **Add `validatePlugin()` to `SchemaValidator`** — mirrors `validateCollection()`
3. **Create `ValidatePluginsCommand`** — workspace command for local plugin validation
4. **Integrate validation into adapters** — parse → validate → convert to Bundle
5. **Update test fixtures** to validate correctly

### What I chose NOT to do

- **No Anthropic format adapter**: Different ecosystem, different manifest location (`.claude-plugin/` vs `.github/plugin/`). Out of scope.
- **No auto-migration from collection to plugin**: The user creates a new source; migration is a manual config change.
- **No breaking changes to collection.schema.json**: It stays as-is for backward compat.

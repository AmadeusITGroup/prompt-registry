# Creating Collections

A **collection** groups prompts, instructions, chat modes, and agents around a role or skill set.

## Quick Start

[Create a Source or an additional Bundle](./creating-source-bundle.md)

## Project Structure

```
my-collection/
├── collections/
│   └── my-collection.collection.yml    # Manifest
├── prompts/
│   └── *.prompt.md
├── instructions/
│   └── *.instructions.md
├── agents/
│   └── *.agent.md
└── README.md
```

## Collection Manifest

```yaml
id: my-collection                    # lowercase, numbers, hyphens
name: My Collection
description: What this collection does
tags: [productivity, coding]
items:
  - path: prompts/task-helper.prompt.md
    kind: prompt                     # prompt | instruction | chat-mode | agent
  - path: instructions/standards.instructions.md
    kind: instruction
```

See [Collection Schema](./collection-schema.md) for full reference.

## Resource Types

| Type | Extension | Purpose |
|------|-----------|---------|
| Prompt | `.prompt.md` | Reusable prompt templates |
| Instruction | `.instructions.md` | System guidelines |
| Agent | `.agent.md` | Autonomous task patterns |

## Testing Locally

1. Add local source: `Ctrl+Shift+P` → "Add Source" → `local-awesome-copilot`
2. Enter path to your collection directory
3. Bundles appear in Registry Explorer

## Validating

- [Validation](./validation.md)

## Alternative: Plugin Format

If you prefer the newer JSON-based format introduced by `github/awesome-copilot` PR #717 (with `plugins/<id>/.github/plugin/plugin.json` instead of `collections/*.collection.yml`), see the [Plugin Schema](./plugin-schema.md). Both formats are supported side-by-side through their own source types (`awesome-copilot` vs. `awesome-copilot-plugin`).

## See Also

- [Collection Schema](./collection-schema.md) — Full YAML reference
- [Plugin Schema](./plugin-schema.md) — `plugin.json` alternative format
- [Publishing](./publishing.md) — Distribute your collections

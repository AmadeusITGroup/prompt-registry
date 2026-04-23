# Managing Sources

Sources are repositories hosting prompt bundles.

## Automatic Source Setup

On first launch, Prompt Registry automatically adds the **Awesome Copilot** source (`github/awesome-copilot`). This gives you immediate access to community-curated collections without manual configuration.

If you select a hub during first-run setup, all sources defined in that hub are also automatically synced.

## Source Types

| Type | Use Case | Status |
|------|----------|--------|
| `awesome-copilot` | Community collections (GitHub-hosted) | Active |
| `local-awesome-copilot` | Local collection development/testing | Active |
| `awesome-copilot-plugin` | Community plugins using the new `plugin.json` format (GitHub-hosted) | Active |
| `local-awesome-copilot-plugin` | Local plugin development/testing | Active |
| `github` | GitHub repository releases | Active |
| `local` | File system directories | Active |
| `apm` | APM package repositories | Active |
| `local-apm` | Local APM packages | Active |

## Adding a Source

`Ctrl+Shift+P` → "Prompt Registry: Add Source"

## Managing Sources

In Registry Explorer:
- **Sync** — Right-click → Sync Source
- **Edit** — Right-click → Edit Source
- **Toggle** — Right-click → Toggle Enabled/Disabled
- **Remove** — Right-click → Remove Source
- **Open Repository** — Right-click → Open Repository

Command Palette:
- **Sync All Sources** — `Ctrl+Shift+P` → "Prompt Registry: Sync All Sources"

## Skill Update Detection

- **Remote skills (`anthropic/skills`)**: each skill version is derived from a content hash. If any file in the skill directory (including `assets/`, `references/`, etc.) changes, the Marketplace shows **Update** after you sync the source.
- **Local skills (`local-skills`)**: installations are symlinked to your filesystem. Running **Sync Source** updates the recorded version automatically—no manual update button—so the UI reflects the latest hash without touching the symlink.

> Tip: if a skill doesn't show the expected update, run **Sync Source** and check the logs for hash calculation warnings.

## Private Repositories

Authentication tries in order:
1. **VS Code GitHub Auth** — Check bottom-left for GitHub avatar
2. **GitHub CLI** — Run `gh auth login`
3. **Explicit Token** — Add when editing source (needs `repo` scope)

Verify: `Ctrl+Shift+P` → "Prompt Registry: Validate Repository Access"

## See Also

- [Profiles and Hubs](./profiles-and-hubs.md) — Organize bundles
- [Troubleshooting](./troubleshooting.md) — Authentication issues

# Getting Started

## Prerequisites

- VS Code 1.99.3+
- GitHub Copilot (for using prompts)

## Installation

Search "Prompt Registry" in VS Code Extensions (`Ctrl+Shift+X`) and click Install.

Alternatively, install directly from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=AmadeusITGroup.prompt-registry). You will be prompted to authenticate with GitHub — click Allow and sign in.

## First Launch: Hub Selection

On first launch, Prompt Registry shows a welcome dialog to help you get started:

1. **Hub Selector** — Choose from available hubs:
   - Pre-configured hubs (verified for availability)
   - Custom Hub URL (enter your own)
   - Skip for now (configure later)

2. **Automatic Setup** — When you select a hub:
   - The hub is imported and set as active
   - Sources defined in the hub are synced
   - The first profile is auto-activated (if available)
   - Awesome Copilot source is added automatically

3. **Ongoing Sync** — On each VS Code startup, the active hub is automatically synced to keep your configuration up-to-date.

To reset and re-trigger the first-run experience: `Ctrl+Shift+P` → "Prompt Registry: Reset First Run"

## Quick Start (5 minutes)

1. **Select Hub** — Choose a hub from the welcome dialog (or skip)
2. **Open Marketplace** — Click the Prompt Registry icon in the Activity Bar
3. **Browse** — Search or filter by tags/source
4. **Install** — Click a bundle tile → Install
5. **Use** — Prompts appear in Copilot Chat as `/<bundle-id>-<prompt-id>`

Installed files location:
- **macOS**: `~/Library/Application Support/Code/User/prompts/`
- **Linux**: `~/.config/Code/User/prompts/`
- **Windows**: `%APPDATA%\Code\User\prompts\`

## Add Your Own Source

1. Registry Explorer → Add Source
2. Choose type: `github`, `local`, `awesome-copilot`, `local-awesome-copilot`, `apm`, or `local-apm`
3. Enter URL/path

## See Also

- [Marketplace](./marketplace.md) — Browse and install bundles
- [Sources](./sources.md) — Configure prompt sources
- [Profiles and Hubs](./profiles-and-hubs.md) — Hub management
- [Troubleshooting](./troubleshooting.md) — Common issues

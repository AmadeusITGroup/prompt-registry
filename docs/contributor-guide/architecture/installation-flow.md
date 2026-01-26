# Installation Flow

## Directory Structure

### User Scope

```
Extension Storage/
├── bundles/                          # Installed bundles
│   └── testing-automation/
│       ├── deployment-manifest.yml
│       └── prompts/
│           └── testing-prompt.prompt.md
└── registry.json                     # Sources and records

Copilot Directory (macOS)/
~/Library/Application Support/Code/User/prompts/
└── testing-automation/
    └── testing-prompt.prompt.md
```

### Repository Scope

```
your-repo/
├── .github/
│   ├── prompts/
│   │   └── my-prompt.prompt.md
│   ├── agents/
│   │   └── my-agent.agent.md
│   ├── instructions/
│   │   └── my-instructions.instructions.md
│   └── skills/
│       └── my-skill/
│           └── skill.md
├── .vscode/
│   └── mcp.json                      # MCP server configurations
├── prompt-registry.lock.json         # Main lockfile for committed bundles
└── prompt-registry.local.lock.json   # Local lockfile for local-only bundles (git-excluded)
```

## Installation Steps

```mermaid
flowchart TD
    A[User clicks Install] --> B[Show Scope Selection Dialog]
    B --> C{Scope Selected?}
    C -->|Cancel| Z[Abort]
    C -->|User| D[User Scope Flow]
    C -->|Repository| E[Repository Scope Flow]
    
    D --> F[Check source type]
    E --> G[Check Scope Conflict]
    
    G --> H{Conflict?}
    H -->|Yes| I[Show Migration Dialog]
    H -->|No| J[Continue Installation]
    
    I --> K{User Choice}
    K -->|Migrate| L[Uninstall from old scope]
    K -->|Cancel| Z
    L --> J
    
    J --> F
    
    F -->|awesome-copilot| M[downloadBundle]
    F -->|other| N[getDownloadUrl]
    M --> O[Get zip Buffer or download URL]
    N --> O
    O --> P[Extract to temp directory]
    P --> Q[Validate deployment-manifest.yml]
    Q --> R{Scope?}
    
    R -->|User| S[Copy to user installation directory]
    R -->|Repository| T[Copy to .github/ directories]
    
    S --> U[Sync to Copilot directory]
    T --> V[Update Lockfile]
    V --> W{Commit Mode?}
    W -->|local-only| X[Add to .git/info/exclude]
    W -->|commit| Y[Skip git exclude]
    X --> AA[Record installation + cleanup]
    Y --> AA
    U --> AA
```

## Scope Selection

When a user initiates installation, a QuickPick dialog presents three options:

| Option | Scope | Commit Mode | Description |
|--------|-------|-------------|-------------|
| Repository - Commit to Git (Recommended) | `repository` | `commit` | Tracked in version control |
| Repository - Local Only | `repository` | `local-only` | Excluded via `.git/info/exclude` |
| User Profile | `user` | N/A | Available everywhere |

Repository options are disabled when no workspace is open.

## Scope Conflict Resolution

A bundle cannot exist at both user and repository scope simultaneously. When installing a bundle that exists at another scope:

1. **Detection**: `ScopeConflictResolver.checkConflict()` checks both scopes
2. **Dialog**: User is prompted to migrate or cancel
3. **Migration**: If accepted, bundle is uninstalled from old scope first
4. **Rollback**: If installation fails, attempts to restore at original scope

```mermaid
flowchart LR
    A[Check Conflict] --> B{Exists at other scope?}
    B -->|No| C[Proceed]
    B -->|Yes| D[Show Migration Dialog]
    D --> E{User Choice}
    E -->|Migrate| F[Uninstall Old]
    E -->|Cancel| G[Abort]
    F --> H[Install New]
    H --> I{Success?}
    I -->|Yes| J[Done]
    I -->|No| K[Rollback to Old Scope]
```

## Repository Scope Installation

### File Placement

Files are placed in `.github/` subdirectories based on type:

| File Type | Target Directory |
|-----------|------------------|
| Prompts (`.prompt.md`) | `.github/prompts/` |
| Instructions (`.instructions.md`) | `.github/instructions/` |
| Agents (`.agent.md`) | `.github/agents/` |
| Skills | `.github/skills/<skill-name>/` |
| MCP Servers | `.vscode/mcp.json` |

### Git Exclude Management

For local-only mode, paths are added to `.git/info/exclude`:

```
# Prompt Registry (local)
.github/prompts/my-prompt.prompt.md
.github/agents/my-agent.agent.md
prompt-registry.local.lock.json
```

The local lockfile (`prompt-registry.local.lock.json`) is automatically added to `.git/info/exclude` when created and removed when deleted.

This file is local to the user's machine and not committed to Git.

## Lockfile Management

The `LockfileManager` singleton manages repository-scoped bundles using a dual-lockfile architecture:

| Lockfile | Purpose | Git Tracking |
|----------|---------|--------------|
| `prompt-registry.lock.json` | Committed bundles | Tracked (commit to Git) |
| `prompt-registry.local.lock.json` | Local-only bundles | Excluded via `.git/info/exclude` |

### Dual-Lockfile Architecture

Bundles are stored in separate lockfiles based on their commit mode:

- **Committed bundles** → `prompt-registry.lock.json` (shared with team)
- **Local-only bundles** → `prompt-registry.local.lock.json` (personal, git-excluded)

The commit mode is **implicit** based on which lockfile contains the bundle—no `commitMode` field is stored in bundle entries.

```mermaid
flowchart TD
    A[Install Bundle] --> B{Commit Mode?}
    B -->|commit| C[Write to prompt-registry.lock.json]
    B -->|local-only| D[Write to prompt-registry.local.lock.json]
    D --> E[Add local lockfile to .git/info/exclude]
    C --> F[Done]
    E --> F
```

### Single Source of Truth

The lockfile is the **single source of truth** for repository-scoped bundles:

- `RegistryManager.listInstalledBundles('repository')` queries both lockfiles
- Repository-scoped installations only update the appropriate lockfile, not `RegistryStorage`
- User/workspace-scoped bundles continue to use `RegistryStorage`
- When listing bundles, `LockfileManager` merges entries from both lockfiles and annotates each with its commit mode

This prevents inconsistencies when lockfile or bundle files are manually deleted.

### File Existence Validation

When listing repository bundles, the extension validates that bundle files exist:

- If files are missing, the bundle is marked with `filesMissing: true`
- The UI shows a warning indicator for bundles with missing files
- Use the "Clean Up Stale Repository Bundles" command to remove stale entries

### Creation/Update

```mermaid
flowchart TD
    A[Bundle Installed] --> B[Read existing lockfile]
    B --> C{Exists?}
    C -->|No| D[Create new lockfile]
    C -->|Yes| E[Parse existing]
    D --> F[Add bundle entry]
    E --> F
    F --> G[Add source entry]
    G --> H[Calculate file checksums]
    H --> I[Write atomically]
    I --> J[Emit onLockfileUpdated event]
```

### Atomic Write

Lockfile writes use a temp file + rename pattern to prevent corruption:

1. Write to `prompt-registry.lock.json.tmp`
2. Rename to `prompt-registry.lock.json`

### Lockfile Schema

Both lockfiles use the same schema structure. The `commitMode` field is deprecated—commit mode is now implicit based on file location:

```json
{
  "$schema": "...",
  "version": "1.0.0",
  "generatedAt": "2026-01-14T10:30:00.000Z",
  "generatedBy": "prompt-registry@1.0.0",
  "bundles": {
    "bundle-id": {
      "version": "1.0.0",
      "sourceId": "source-id",
      "sourceType": "github",
      "installedAt": "...",
      "files": [
        { "path": ".github/prompts/...", "checksum": "sha256..." }
      ]
    }
  },
  "sources": {
    "source-id": { "type": "github", "url": "..." }
  }
}
```

> **Note:** Existing lockfiles with `commitMode` field continue to work for backward compatibility. The field is ignored on read (file location determines mode) and not included in new entries.

### Commit Mode Switching

When switching a bundle between commit and local-only modes:

```mermaid
flowchart TD
    A[Switch Commit Mode] --> B{New Mode?}
    B -->|local-only| C[Remove from main lockfile]
    B -->|commit| D[Remove from local lockfile]
    C --> E[Add to local lockfile]
    D --> F[Add to main lockfile]
    E --> G[Update git exclude]
    F --> G
    G --> H{Local lockfile empty?}
    H -->|Yes| I[Delete local lockfile]
    H -->|No| J[Done]
    I --> K[Remove from git exclude]
    K --> J
```

All bundle metadata (version, sourceId, files, etc.) is preserved during the move.

### Backward Compatibility and Migration

The dual-lockfile architecture maintains backward compatibility with existing lockfiles:

| Scenario | Behavior |
|----------|----------|
| Read lockfile with `commitMode` field | Field is ignored; file location determines mode |
| Write new bundle entry | `commitMode` field is not included |
| Update existing entry | Entry is rewritten without `commitMode` field |
| Local-only bundle in main lockfile | Continues to work; migrates on next modification |

**Migration path for existing lockfiles:**

1. Existing lockfiles with `commitMode` field continue to function normally
2. When a bundle is modified (updated, mode switched), the entry is rewritten without `commitMode`
3. Local-only bundles in the main lockfile remain there until explicitly switched to local-only mode
4. No automatic migration is performed—changes happen gradually as bundles are modified

**Conflict detection:**

If a bundle ID exists in both lockfiles (should not happen in normal operation), `LockfileManager.getInstalledBundles()` displays an error to the user and skips the duplicate entry from the local lockfile.

## Repository Activation

When a workspace with a lockfile is opened:

```mermaid
flowchart TD
    A[Workspace Opened] --> B[Check for lockfile]
    B --> C{Lockfile exists?}
    C -->|No| Z[Done]
    C -->|Yes| D{Previously declined?}
    D -->|Yes| Z
    D -->|No| E[Show activation prompt]
    E --> F{User choice}
    F -->|Enable| G[Check missing sources/hubs]
    F -->|Decline| H[Remember choice]
    F -->|Never| I[Remember permanently]
    G --> J{Missing sources?}
    J -->|Yes| K[Offer to add sources]
    J -->|No| L[Verify bundles installed]
    K --> L
    L --> M{Missing bundles?}
    M -->|Yes| N[Download and install]
    M -->|No| O[Sync to Copilot]
    N --> O
    H --> Z
    I --> Z
    O --> Z
```

## AwesomeCopilot Flow

1. Fetch `collection.yml` from GitHub
2. Parse collection items
3. Fetch each prompt file (with auth)
4. Create `deployment-manifest.yml` (YAML)
5. Build zip archive in memory
6. Return Buffer to BundleInstaller

## Bundle Manifest

```yaml
# deployment-manifest.yml
version: "1.0"
id: "my-bundle"
name: "My Bundle"
prompts:
  - id: "my-prompt"
    name: "My Prompt"
    type: "prompt"
    file: "prompts/my-prompt.prompt.md"
    tags: ["example"]
```

## Key Components

| Component | Responsibility |
|-----------|----------------|
| `ScopeServiceFactory` | Returns appropriate scope service based on `InstallationScope` |
| `UserScopeService` | Handles user-level file placement and Copilot sync |
| `RepositoryScopeService` | Handles repository-level file placement and git exclude |
| `LockfileManager` | Manages lockfile CRUD operations |
| `ScopeConflictResolver` | Detects and handles scope conflicts |
| `RepositoryActivationService` | Handles lockfile detection on workspace open |
| `LocalModificationWarningService` | Detects local file changes before updates |
| `BundleScopeCommands` | Context menu commands for scope management |

## See Also

- [Adapters](./adapters.md) — URL vs Buffer installation
- [MCP Integration](./mcp-integration.md) — MCP server installation
- [Update System](./update-system.md) — Update checking and application

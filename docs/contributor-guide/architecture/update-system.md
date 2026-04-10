# Update System

Automatic detection and installation of bundle updates.

## Components

| Component | Responsibility |
|-----------|---------------|
| **UpdateScheduler** | Timing of checks (startup, daily/weekly) |
| **UpdateChecker** | Compare installed vs latest versions |
| **AutoUpdateService** | Background updates with rollback |
| **UpdateCache** | Cache results with configurable TTL |

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `promptregistry.updateCheck.enabled` | `true` | Enable update checks |
| `promptregistry.updateCheck.frequency` | `daily` | `daily`, `weekly`, `manual` |
| `promptregistry.updateCheck.autoUpdate` | `false` | Global gate for auto-updates |
| `promptregistry.updateCheck.cacheTTL` | `300000` | Cache TTL (5 min) |
| `promptregistry.updateCheck.notificationPreference` | `all` | `all`, `major`, `none` |

## Update Check Flow

```mermaid
flowchart TD
    A[Extension activates] --> B[Wait 5 seconds]
    B --> C[UpdateScheduler → UpdateChecker]
    C --> D[Check cache UpdateCache]
    D --> E{Cache status}
    E -->|valid| F[Return cached]
    E -->|expired| G[RegistryManager.checkUpdates]
    G --> H[Compare installed vs latest]
    H --> I[Cache results]
    I --> J[Show notification if updates available]
```

## Auto-Update Logic

**Hybrid approach**: Global `autoUpdate` setting + per-bundle opt-in

For auto-update to occur:
1. Global `updateCheck.autoUpdate` = `true`
2. Per-bundle auto-update enabled (via "Enable Auto-Update" command)

## Concurrency Control

- **Batch Size**: 3 concurrent updates
- **Active Updates Set**: Prevents duplicate operations
- **Check-in-Progress Flag**: Prevents overlapping cycles

## Dependency Injection

Uses interfaces to avoid circular dependencies:

```typescript
interface BundleOperations {
    updateBundle(bundleId: string, version?: string): Promise<void>;
    listInstalledBundles(): Promise<InstalledBundle[]>;
}

class AutoUpdateService {
    constructor(
        private readonly bundleOps: BundleOperations,
        private readonly sourceOps: SourceOperations
    ) {}
}
```

## Hub Sync Scheduler

Separate from bundle update checks, `HubSyncScheduler` keeps the active hub configuration fresh:

| Component | Responsibility |
|-----------|---------------|
| **HubSyncScheduler** | 24h periodic timer calling `HubManager.syncActiveHub()` |
| **HubManager.onHubSynced** | Event fired after every hub sync (startup, manual, periodic) |

Source sync is event-driven: a single `onHubSynced` listener in `extension.ts` triggers `syncAllSources({ silent: true })` after any hub sync, ensuring sources stay in sync regardless of how the hub sync was initiated.

## See Also

- [Installation Flow](./installation-flow.md) — How updates are installed
- [User Guide: Marketplace](../../user-guide/marketplace.md) — User-facing updates
- [User Guide: Profiles and Hubs](../../user-guide/profiles-and-hubs.md) — Hub sync behavior

# Multi-Hub Architecture Requirements

## Overview

A hierarchical hub system where a main hub can reference multiple satellite hubs (managed by different Business Units), and those satellite hubs can themselves reference other satellite hubs. All sources from all levels are consolidated into a single `config.yml` artifact.

## Architecture Model

### Structure

- **Main Hub**: Central repository containing `hub.yml` file that lists references to satellite hubs
- **Satellite Hub**: Business Unit-owned hub that can:
  - Define its own sources
  - Contain its own `hub.yml` file referencing further nested satellite hubs
  - Support unlimited nesting levels
- **Sources**: Can be declared at any level (main hub, level 1 sub-hub, level 2 sub-hub, etc.)

### Example Structure
```
Main Hub (hub.yml with Sources: A, B)
├── Satellite Hub BU-1 (Sources: C, D + hub.yml referencing BU-1a)
│   └── Satellite Hub BU-1a (Sources: E)
└── Satellite Hub BU-2 (Sources: F)

Consolidated config.yml: Sources A, B, C, D, E, F
```

## Key Requirements

### Functional Requirements

1. **Hierarchical Hub References**
   - Main hub's `hub.yml` lists direct satellite hub references
   - Each satellite hub's `hub.yml` can list further satellite hub references
   - Recursive structure with no depth limit

2. **Source Management**
   - Sources can be declared at any level (main hub, any satellite hub level)
   - Parser must traverse the entire hub tree and collect all sources
   - Final `config.yml` consolidates sources from all levels

3. **CI/CD Workflow**
   - Main hub CI triggers when `hub.yml` changes (event-driven)
   - Main hub CI also triggers regularly on a cron schedule to consolidate potential satellite hub updates
   - Parser recursively fetches all referenced satellite hubs (using git clone or API)
   - Consolidation engine merges sources, profiles, and hubs from all levels
   - Change detection gate: only publish release if changes detected

4. **Duplicate Prevention**
   - Each satellite hub CI must check existing consolidated `config.yml` before merge
   - Validate that sources being added don't already exist in higher-level hubs
   - Prevent duplicate source declarations across BU boundaries

5. **Release Artifacts**
   - Primary artifact: `config.yml` containing consolidated configuration
   - Include all sources, hubs, and profiles from entire hierarchy
   - Consumed by Prompt Registry

### Non-Functional Requirements

1. **Decentralization & Autonomy**
   - Each BU owns and manages their satellite hub independently
   - BUs can merge changes to their hub without coordinating with main hub
   - Main hub acts as aggregator, not enforcer

2. **Visibility & Conflict Detection**
   - Main hub CI provides visibility into all satellite hubs
   - Detect duplicate/conflicting sources across BUs
   - Log consolidated changes for audit trail

3. **Performance**
   - Change detection prevents unnecessary re-releases
   - Only regenerate `config.yml` when actual changes occur

## Technical Implementation

### Files & Locations

- **Main Hub**: `hub.yml` (lists satellite hub references and declares level 0 sources)
- **Satellite Hubs**: Each has `hub.yml` (declares sources and optionally references further satellite hubs)
- **Release Artifact**: `config.yml` (consolidated from all levels)

### CI Workflow Steps

1. **Parse Phase**
   - Read main hub's `hub.yml`
   - Recursively fetch all referenced satellite hubs
   - Traverse entire hub tree

2. **Consolidation Phase**
   - Aggregate sources from all levels
   - Merge profiles and hubs
   - Deduplicate entries

3. **Change Detection Phase**
   - Compare new `config.yml` against previous version
   - Only proceed to release if changes detected

4. **Validation Phase** (per satellite hub)
   - Before accepting a satellite hub merge, check against existing consolidated `config.yml`
   - Ensure no duplicate sources are introduced
   - Satellite hub CI validates its own changes don't conflict with hierarchy

5. **Release Phase**
   - Publish `config.yml` as release artifact
   - Make available to Prompt Registry consumers

### Hub Metadata Structure

Each `hub.yml` should define:
```yaml
# hub.yml structure (conceptual)
sources:
  - name: source-a
    url: ...
  - name: source-b
    url: ...

satellite-hubs:
  - name: bu-1
    url: <git-repo-or-api-endpoint>
  - name: bu-2
    url: <git-repo-or-api-endpoint>
```

## Benefits

### For Main Hub
- Centralized view of all sources across organization
- Detect duplicates and conflicts
- Single consolidated artifact for downstream consumers
- Change-driven release cycle (no unnecessary builds)

### For Business Units
- Autonomy to manage their own satellite hubs
- Decoupled from main hub operational decisions
- Can structure satellite hubs hierarchically per their org needs
- Self-service duplicate checking before merge

### For Organization
- Federated governance (central aggregation + decentralized management)
- Reduced configuration drift
- Clear visibility into what sources are active
- Conflict prevention at merge time

## Constraints & Considerations

1. **Circular References**: Parser should detect and reject circular hub references
2. **Source Uniqueness**: Each satellite hub CI must query the consolidated `config.yml` from the main hub before merge. If a source being added already exists in the consolidated version, reject the merge with a clear error message indicating which source(s) are duplicates and at which hub level(s) they already exist.
3. **Performance at Scale**: Large numbers of satellite hubs may impact parse time; consider caching strategies
4. **Git/API Access**: Satellite hub fetching requires credentials; ensure secure credential management
5. **Versioning**: Decide how to version individual satellite hubs within the main release


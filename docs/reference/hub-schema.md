# Hub Configuration Schema

This document describes the YAML schema for Prompt Registry hub configuration files.

## Overview

Hubs are centralized configurations that define bundle sources and profiles for teams or organizations. A hub configuration file allows you to share a curated set of sources and pre-configured profiles.

## Schema Version

Current schema version: Based on JSON Schema draft-07

## Root Structure

```yaml
version: "1.0.0"
metadata:
  name: "My Hub"
  description: "Hub description"
  maintainer: "Team Name"
  updatedAt: "2025-01-15T10:00:00Z"
sources:
  - id: "source-1"
    type: "github"
    # ... source configuration
profiles:
  - id: "profile-1"
    name: "Profile Name"
    # ... profile configuration
configuration:
  autoSync: true
  # ... hub configuration
```

## Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `version` | string | Semantic version of the hub configuration format (e.g., `"1.0.0"`) |
| `metadata` | object | Hub metadata and descriptive information |
| `sources` | array | List of bundle sources available in this hub |

## Metadata Object

The `metadata` object contains descriptive information about the hub.

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Human-readable name of the hub (1-100 characters) |
| `description` | string | Detailed description of the hub's purpose (1-500 characters) |
| `maintainer` | string | Name or identifier of the hub maintainer (1-100 characters) |
| `updatedAt` | string | ISO 8601 timestamp of last update |

### Optional Fields

| Field | Type | Description |
|-------|------|-------------|
| `checksum` | string | Integrity checksum (format: `sha256:abc123...` or `sha512:abc123...`) |

### Example

```yaml
metadata:
  name: "Engineering Team Hub"
  description: "Curated prompt bundles for the engineering team"
  maintainer: "Platform Team"
  updatedAt: "2025-01-15T10:30:00Z"
  checksum: "sha256:abc123def456..."
```

## Sources Array

The `sources` array defines bundle sources available in the hub.

### Required Fields per Source

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique identifier (alphanumeric, hyphens, underscores; 1-50 chars) |
| `type` | string | Source type (see below) |
| `enabled` | boolean | Whether this source is currently active |
| `priority` | number | Priority order for source resolution (0-100, higher = higher priority) |

### Source Types

| Type | Description |
|------|-------------|
| `github` | GitHub repository releases |
| `gitlab` | GitLab repository releases |
| `http` / `url` | HTTP/HTTPS bundle URLs |
| `local` | Local file system directory |
| `awesome-copilot` | GitHub-hosted YAML collections |
| `local-awesome-copilot` | Local YAML collections |
| `apm` | APM package repositories |
| `local-apm` | Local APM packages |

### Optional Fields per Source

| Field | Type | Description |
|-------|------|-------------|
| `url` | string | URL or path to the source |
| `repository` | string | GitHub repository in `owner/repo` format |
| `branch` | string | Git branch name |
| `name` | string | Human-readable name of the source |
| `config` | object | Source-specific configuration |
| `metadata` | object | Additional source metadata |

### Config Object

| Field | Type | Description |
|-------|------|-------------|
| `branch` | string | Git branch name (for git-based sources) |
| `collectionsPath` | string | Path to collections directory (for awesome-copilot) |
| `indexFile` | string | Index file name (for awesome-copilot) |

### Source Metadata Object

| Field | Type | Description |
|-------|------|-------------|
| `description` | string | Source description |
| `homepage` | string | Source homepage URL |
| `contact` | string | Contact information |

### Example

```yaml
sources:
  - id: "company-bundles"
    type: "github"
    repository: "myorg/prompt-bundles"
    branch: "main"
    name: "Company Bundles"
    enabled: true
    priority: 100
    config:
      branch: "main"
    metadata:
      description: "Official company prompt bundles"
      homepage: "https://github.com/myorg/prompt-bundles"

  - id: "community-collection"
    type: "awesome-copilot"
    repository: "community/awesome-prompts"
    enabled: true
    priority: 50
    config:
      collectionsPath: "collections"
      indexFile: "index.yml"
```

## Profiles Array (Optional)

The `profiles` array defines predefined bundle collections.

### Required Fields per Profile

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique identifier (alphanumeric, hyphens, underscores; 1-50 chars) |
| `name` | string | Human-readable name (1-100 characters) |
| `description` | string | Description of the profile's purpose (1-500 characters) |
| `bundles` | array | List of bundles included in this profile (minimum 1) |

### Optional Fields per Profile

| Field | Type | Description |
|-------|------|-------------|
| `icon` | string | Icon or emoji for the profile |
| `active` | boolean | Whether this profile is currently active |
| `createdAt` | string | ISO 8601 timestamp of creation |
| `updatedAt` | string | ISO 8601 timestamp of last update |
| `path` | array | Path hierarchy for organizing in the UI |

### Bundle Object (within Profile)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Bundle identifier (1-50 chars) |
| `version` | string | Yes | Bundle version (semver or `"latest"`) |
| `source` | string | Yes | Source ID where this bundle is available |
| `required` | boolean | Yes | Whether this bundle is mandatory for the profile |

### Example

```yaml
profiles:
  - id: "frontend-dev"
    name: "Frontend Development"
    description: "Essential prompts for frontend developers"
    icon: "🎨"
    active: false
    bundles:
      - id: "react-patterns"
        version: "latest"
        source: "company-bundles"
        required: true
      - id: "css-helpers"
        version: "2.0.0"
        source: "company-bundles"
        required: false
    path:
      - "engineering"
      - "frontend"
```

## Configuration Object (Optional)

Hub-level configuration settings.

| Field | Type | Description |
|-------|------|-------------|
| `autoSync` | boolean | Enable automatic synchronization with hub sources |
| `syncInterval` | number | Sync interval in seconds (60-86400) |
| `strictMode` | boolean | Enable strict validation and security checks |

### Example

```yaml
configuration:
  autoSync: true
  syncInterval: 3600
  strictMode: true
```

## Scaffold Defaults Object (Optional)

Default values for project scaffolding prompts. Each organization-level field is individually skipped when its default is present. Fields like `githubOrg` and `githubRunner` are always shown but pre-filled from defaults.

| Field | Type | Description |
|-------|------|-------------|
| `githubOrg` | string | GitHub organization name (pre-fills the prompt; always shown) |
| `githubRunner` | string | GitHub Actions runner label or pattern. Supports `{githubOrg}` placeholder (e.g., `gmsshr-core-{githubOrg}`). Always shown, pre-filled with resolved value. |
| `organizationName` | string | Organization name for LICENSE (skipped when present — value used directly) |
| `internalContact` | string | Internal contact email for security/support (skipped when present) |
| `legalContact` | string | Legal contact email for licensing questions (skipped when present) |
| `organizationPolicyLink` | string | Organization policy URL (skipped when present) |

**Note:** `author`, `description`, and `tags` are NOT part of scaffold defaults. The author field is pre-filled from the user's GitHub identity instead.

### Runner Pattern

The `githubRunner` field supports a `{githubOrg}` placeholder that is resolved at scaffold time using the selected GitHub organization. Only `{githubOrg}` is supported.

**Example:** `gmsshr-core-{githubOrg}` with org `myorg` → `gmsshr-core-myorg`

### Prompt Behavior

| Field | Hub Default Present | Hub Default Absent |
|-------|--------------------|--------------------|
| `projectName` | Always asked | Always asked |
| `author` | Prefilled from GitHub identity | Prefilled from GitHub identity |
| `githubOrg` | Prefilled from default | Shown empty |
| `githubRunner` | Prefilled with resolved pattern | Quick pick (ubuntu-latest / self-hosted / custom) |
| `organizationName` | **Skipped** — hub value used | Asked |
| `internalContact` | **Skipped** — hub value used | Asked |
| `legalContact` | **Skipped** — hub value used | Asked |
| `organizationPolicyLink` | **Skipped** — hub value used | Asked |

### Example

```yaml
scaffoldDefaults:
  githubOrg: "myorg"
  githubRunner: "gmsshr-core-{githubOrg}"
  organizationName: "My Organization Inc."
  internalContact: "security@myorg.com"
  legalContact: "legal@myorg.com"
  organizationPolicyLink: "https://myorg.com/policies"
```

## Complete Example

```yaml
version: "1.0.0"

metadata:
  name: "Engineering Team Hub"
  description: "Centralized prompt management for the engineering organization"
  maintainer: "Platform Team"
  updatedAt: "2025-01-15T10:30:00Z"

sources:
  - id: "official-bundles"
    type: "github"
    repository: "myorg/prompt-bundles"
    name: "Official Bundles"
    enabled: true
    priority: 100
    config:
      branch: "main"

  - id: "community"
    type: "awesome-copilot"
    repository: "community/awesome-prompts"
    enabled: true
    priority: 50

profiles:
  - id: "backend-starter"
    name: "Backend Starter Kit"
    description: "Essential prompts for backend development"
    icon: "⚙️"
    bundles:
      - id: "api-design"
        version: "latest"
        source: "official-bundles"
        required: true
      - id: "testing-helpers"
        version: "1.2.0"
        source: "official-bundles"
        required: false

configuration:
  autoSync: true
  syncInterval: 3600

scaffoldDefaults:
  githubOrg: "myorg"
  githubRunner: "gmsshr-core-{githubOrg}"
  organizationName: "My Organization"
  internalContact: "security@myorg.com"
  legalContact: "legal@myorg.com"
  organizationPolicyLink: "https://myorg.com/policies"
```

## Validation

Hub configurations are automatically validated during import and loading operations using two validation phases:

### Schema Validation
- Uses JSON Schema validation with AJV
- Validates against `schemas/hub-config.schema.json`
- Checks field types, required fields, patterns, and constraints

### Runtime Validation
- Additional business logic checks
- Validates hub references and security constraints
- Verifies source configurations and accessibility

### Manual Validation
To manually validate a hub configuration:

1. Open Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`)
2. Run "Prompt Registry: Import Hub"
3. The extension validates the configuration before importing

Validation errors are displayed in VS Code notifications and logged to the output channel.

## See Also

- [Profiles and Hubs Guide](../user-guide/profiles-and-hubs.md) — User guide for working with hubs
- [Collection Schema](../author-guide/collection-schema.md) — Schema for collection YAML files
- [Settings Reference](./settings.md) — Extension configuration options

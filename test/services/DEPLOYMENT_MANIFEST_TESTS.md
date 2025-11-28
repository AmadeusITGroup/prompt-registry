# Deployment Manifest Validation Tests

## Overview

Comprehensive test suite for validating `deployment-manifest.yml` files used in the Prompt Registry extension.

## Test Coverage

### 1. Schema Validation Tests (`test/services/DeploymentManifestValidator.test.ts`)

#### Required Fields
- ✅ Validates presence of `id`, `name`, `version`
- ✅ Rejects manifests with missing required fields
- ✅ Rejects manifests with empty required fields
- ✅ Validates version format (semantic versioning)

#### Optional Top-Level Fields
- ✅ Accepts `description`, `author`, `tags`, `environments`
- ✅ Accepts `license`, `repository`, `dependencies`
- ✅ Validates array types for tags and environments
- ✅ Validates URL format for repository

#### Prompts Section - All 4 Resource Types
- ✅ Validates `type: 'prompt'` resources
- ✅ Validates `type: 'instructions'` resources
- ✅ Validates `type: 'chatmode'` resources
- ✅ Validates `type: 'agent'` resources
- ✅ Accepts prompts without type (defaults to 'prompt')
- ✅ Rejects invalid type values
- ✅ Validates required prompt fields: `id`, `name`, `description`, `file`
- ✅ Accepts optional `tags` array in prompts

#### MCP Servers Section
- ✅ Accepts manifests without mcpServers (optional)
- ✅ Validates MCP server configuration structure
- ✅ Requires `command` field for each server
- ✅ Accepts optional `args` and `env` fields
- ✅ Validates environment variable syntax

#### Metadata Section
- ✅ Accepts manifests without metadata (optional)
- ✅ Validates `manifest_version` field
- ✅ Validates repository object structure
- ✅ Validates compatibility section with platforms

#### Full Manifest Validation
- ✅ Validates comprehensive manifests with all sections
- ✅ Ensures all 4 resource types can coexist

**Total: 37 tests passing**

### 2. Resource Type Validation Tests

#### File Extension Conventions
- ✅ Validates `.prompt.md` extension for prompts
- ✅ Validates `.instructions.md` extension for instructions
- ✅ Validates `.chatmode.md` extension for chatmodes
- ✅ Validates `.agent.md` extension for agents
- ✅ Detects mismatched type and file extension

#### Type Field Validation
- ✅ Accepts all valid type values: `prompt`, `instructions`, `chatmode`, `agent`
- ✅ Rejects invalid type values
- ✅ Handles undefined type (defaults to 'prompt')

#### Directory Conventions
- ✅ Validates prompts are in `prompts/` directory
- ✅ Validates instructions are in `instructions/` directory
- ✅ Validates chatmodes are in `chatmodes/` directory
- ✅ Validates agents are in `agents/` directory

**Total: 12 tests passing**

### 3. Integration Tests with Real Fixtures

#### Validate Existing Fixture Manifests
- ✅ Validates `bundle1/deployment-manifest.yml`
- ✅ Validates `example-bundle/deployment-manifest.yml`
- ✅ Validates `testing-bundle/deployment-manifest.yml`
- ✅ Verifies required fields in all fixtures
- ✅ Verifies prompts section structure when present
- ✅ Validates resource types in prompts

#### Validate All Fixtures in Directory
- ✅ Scans and validates all deployment manifests in fixtures
- ✅ Reports validation errors with bundle names
- ✅ Counts valid vs invalid manifests

#### Validate Resource Type Usage
- ✅ Checks if fixtures use all 4 resource types
- ✅ Reports which types are found across all fixtures
- ✅ Confirms: All 4 types (`prompt`, `instructions`, `chatmode`, `agent`) are present in fixtures

**Total: 6 tests passing**

## Test Statistics

- **Total Tests**: 55 tests
- **Passing**: 55 ✅
- **Failing**: 0 ❌
- **Coverage Areas**:
  - Schema validation
  - Resource type validation
  - File naming conventions
  - Directory structure
  - Integration with real fixtures

## Supported Resource Types

The tests validate all 4 GitHub Copilot resource types:

1. **Prompt** (`.prompt.md`) - Task-specific instructions
2. **Instructions** (`.instructions.md`) - Coding standards
3. **Chatmode** (`.chatmode.md`) - AI personas
4. **Agent** (`.agent.md`) - Autonomous agents

## File Structure Validation

### Required Fields
```yaml
id: bundle-id          # MANDATORY
name: Bundle Name      # MANDATORY
version: 1.0.0         # MANDATORY
```

### Optional Sections
```yaml
description: "..."     # Optional but recommended
author: "..."          # Optional but recommended
tags: []               # Optional
environments: []       # Optional
license: "MIT"         # Optional
repository: "..."      # Optional
dependencies: []       # Optional

prompts:               # Optional - all 4 types supported
  - id: "..."
    name: "..."
    description: "..."
    file: "..."
    type: prompt | instructions | chatmode | agent
    tags: []

mcpServers:            # Optional
  server-name:
    command: "..."
    args: []
    env: {}

metadata:              # Optional
  manifest_version: "1.0"
  description: "..."
  repository: {}
  compatibility: {}
```

## Running the Tests

```bash
# Run only deployment manifest tests
LOG_LEVEL=ERROR npm test -- test/services/DeploymentManifestValidator.test.ts

# Run all tests
LOG_LEVEL=ERROR npm test
```

## Test Fixtures

The tests use real fixture files from:
- `test/fixtures/local-library/bundle1/deployment-manifest.yml`
- `test/fixtures/local-library/example-bundle/deployment-manifest.yml`
- `test/fixtures/local-library/testing-bundle/deployment-manifest.yml`

These fixtures demonstrate:
- Minimal valid manifests
- Comprehensive manifests with all resource types
- Real-world usage patterns

## Future Enhancements

Potential areas for additional testing:
- JSON Schema validation for deployment manifests
- Property-based testing for manifest variations
- Performance testing with large manifests
- Validation of file paths against actual filesystem
- Cross-platform path validation

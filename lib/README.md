# @prompt-registry/collection-scripts

Shared scripts for building, validating, and publishing Copilot prompt collections.

## Installation

### Option 1: Use with npx (Recommended)
No installation required - run from anywhere:

```bash
npx --package @prompt-registry/collection-scripts validate-collections
```

### Option 2: Install locally
```bash
npm install @prompt-registry/collection-scripts
```

### Option 3: Install globally
```bash
npm install -g @prompt-registry/collection-scripts
```

## Usage

### npx (No Installation Required)

```bash
# Validate collections
npx --package @prompt-registry/collection-scripts validate-collections --verbose

# Create a new skill (interactive)
npx --package @prompt-registry/collection-scripts create-skill

# Create a skill (non-interactive)
npx --package @prompt-registry/collection-scripts create-skill my-skill --description "A helpful skill" --non-interactive

# Validate skills
npx --package @prompt-registry/collection-scripts validate-skills

# Build collection bundle
npx --package @prompt-registry/collection-scripts build-collection-bundle --collection-file collections/my.collection.yml --version 1.0.0

# List collections
npx --package @prompt-registry/collection-scripts list-collections

# Publish affected collections (CI/CD)
npx --package @prompt-registry/collection-scripts publish-collections
```

### After Installation

If installed locally or globally, you can run commands directly:

```bash
validate-collections --verbose
create-skill my-skill --description "A helpful skill"
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `validate-collections` | Validate collection YAML files |
| `validate-skills` | Validate skill folders following Agent Skills spec |
| `build-collection-bundle` | Build a collection bundle ZIP |
| `compute-collection-version` | Compute next version from git tags |
| `detect-affected-collections` | Detect collections affected by file changes |
| `generate-manifest` | Generate deployment manifest |
| `publish-collections` | Build and publish affected collections |
| `list-collections` | List all collections in repo |
| `create-skill` | Create a new skill directory structure |
| `compute-ratings` | Compute ratings from GitHub Discussion feedback comments (star ratings) |
| `setup-discussions` | Create GitHub Discussions for bundle ratings |

## Engagement Tools

These tools help set up and manage the engagement system for collecting bundle ratings and feedback.

### setup-discussions

Creates GitHub Discussions for all bundles in a hub configuration. The discussions are used to collect ratings and feedback via comments with star ratings (1-5 ⭐).

```bash
# Basic usage - creates discussions for all bundles
GITHUB_TOKEN=ghp_xxx npx --package @prompt-registry/collection-scripts setup-discussions https://github.com/org/hub-config

# Dry run to preview what would be created
GITHUB_TOKEN=ghp_xxx npx --package @prompt-registry/collection-scripts setup-discussions --dry-run org/hub-config

# Specify branch and output file
GITHUB_TOKEN=ghp_xxx npx --package @prompt-registry/collection-scripts setup-discussions -b develop -o my-collections.yaml org/hub-config

# Specify discussion category
GITHUB_TOKEN=ghp_xxx npx --package @prompt-registry/collection-scripts setup-discussions --category "Bundle Ratings" org/hub-config
```

**Requirements:**
- Hub config must have `engagement.backend.repository` configured
- GitHub token needs `repo` and `write:discussion` scopes
- Engagement repository must have GitHub Discussions enabled

**Output:** Creates a `collections.yaml` file mapping bundles to discussion numbers.

### compute-ratings

Fetches feedback comments from GitHub Discussions, parses star ratings (1-5), and computes aggregate ratings. Also supports legacy thumbs up/down reactions for backward compatibility.

```bash
# Compute ratings from collections.yaml
GITHUB_TOKEN=ghp_xxx npx --package @prompt-registry/collection-scripts compute-ratings --config collections.yaml --output ratings.json
```

**Workflow:**
1. Run `setup-discussions` once to create discussions and generate `collections.yaml`
2. Run `compute-ratings` periodically (e.g., via GitHub Actions) to update `ratings.json`
3. Host `ratings.json` statically and reference it in hub config's `engagement.ratings.ratingsUrl`

## Programmatic API

```typescript
import {
  // Validation
  validateCollectionId,
  validateVersion,
  validateItemKind,
  validateCollectionFile,
  validateAllCollections,
  generateMarkdown,
  VALIDATION_RULES,
  
  // Collections
  listCollectionFiles,
  readCollection,
  resolveCollectionItemPaths,
  
  // Bundle ID
  generateBundleId,
  
  // CLI utilities
  parseSingleArg,
  parseMultiArg,
  hasFlag,
  getPositionalArg,
} from '@prompt-registry/collection-scripts';
```

## Usage in package.json

```json
{
  "scripts": {
    "validate": "validate-collections",
    "build": "build-collection-bundle --collection-file collections/my.collection.yml --version 1.0.0",
    "publish": "publish-collections"
  }
}
```

## Development

```bash
cd lib
npm install
npm run build
npm test
```

## License

MIT

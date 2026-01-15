# @prompt-registry/collection-scripts

Shared scripts for building, validating, and publishing Copilot prompt collections.

## Installation

```bash
npm install @prompt-registry/collection-scripts
```

For GitHub Packages, add to your `.npmrc`:
```
@prompt-registry:registry=https://npm.pkg.github.com
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `validate-collections` | Validate collection YAML files |
| `build-collection-bundle` | Build a collection bundle ZIP |
| `compute-collection-version` | Compute next version from git tags |
| `detect-affected-collections` | Detect collections affected by file changes |
| `generate-manifest` | Generate deployment manifest |
| `publish-collections` | Build and publish affected collections |
| `list-collections` | List all collections in repo |
| `create-skill` | Create a new skill directory structure |

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

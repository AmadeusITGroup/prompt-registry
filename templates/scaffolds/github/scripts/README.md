# Scripts

This directory contains project-specific scripts that are not part of the shared `@prompt-registry/collection-scripts` package.

## Available Scripts

| Script | Description |
|--------|-------------|
| `validate-skills.js` | Validates skill folders against the Agent Skills specification |

## Shared Scripts (via npm package)

Most collection scripts are provided by the `@prompt-registry/collection-scripts` npm package. These are available as CLI commands after running `npm install`:

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

## Usage

```bash
# Validate collections
npm run validate

# Validate skills
npm run skill:validate

# Create a new skill
npm run skill:create my-new-skill
```

## Migration from Local Scripts

If you previously had local scripts in this directory, they have been replaced by the npm package. To migrate:

1. Remove old script files (keep only `validate-skills.js` and this README)
2. Run `npm install` to get the shared package
3. Use the npm scripts defined in `package.json`

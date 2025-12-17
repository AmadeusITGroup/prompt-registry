# Adapter Implementation Guide

## Purpose

Adapters provide a unified interface for different prompt bundle sources (GitHub, GitLab, HTTP, Local, Awesome Copilot).

## Adding a New Adapter

1. Copy an existing adapter (e.g., `HttpAdapter.ts`)
2. Implement `IRepositoryAdapter` interface
3. Register in `RepositoryAdapterFactory`

### Required Methods

```typescript
interface IRepositoryAdapter {
    fetchBundles(source: RegistrySource): Promise<Bundle[]>;
    getDownloadUrl(bundle: Bundle): Promise<string | Buffer>;
    validate(source: RegistrySource): Promise<boolean>;
}
```

### Two Download Patterns

| Pattern | Return Type | Used By | When |
|---------|-------------|---------|------|
| URL-based | `string` | GitHub, GitLab, HTTP | Pre-packaged bundles |
| Buffer-based | `Buffer` | Awesome Copilot, Local | Dynamically created bundles |

## Authentication Chain (GitHub)

1. Explicit token from source configuration
2. VS Code GitHub authentication session
3. GitHub CLI (`gh auth token`)
4. No auth (public repos only)

## Checklist

- [ ] Extends `RepositoryAdapter` base class
- [ ] Implements all three methods
- [ ] Handles authentication appropriately
- [ ] Returns proper error messages
- [ ] Has corresponding test file in `test/adapters/`

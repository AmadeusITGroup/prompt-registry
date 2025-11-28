# Bundle Name Display Fix

## Issue
The marketplace was displaying the GitHub release name (often just the version number like "1.0.12") instead of the proper bundle name from the deployment manifest.

## Root Cause
The `GitHubAdapter.fetchBundles()` method was using the GitHub release name directly without fetching the deployment manifest:

```typescript
name: release.name || `${repo} ${release.tag_name}`,
```

This meant that if a GitHub release was named "1.0.12", that's what would be displayed in the marketplace, even though the deployment manifest contained the proper bundle name like "Amadeus Airlines Solutions".

## Solution
Updated `GitHubAdapter.fetchBundles()` to fetch and parse the deployment manifest for each release, then use the manifest's name field:

```typescript
// Fetch deployment manifest to get accurate bundle metadata
let manifest: any = null;
try {
    const manifestContent = await this.downloadFile(manifestAsset.url);
    const manifestText = manifestContent.toString('utf-8');
    
    // Parse YAML or JSON based on file extension
    if (manifestAsset.name.endsWith('.json')) {
        manifest = JSON.parse(manifestText);
    } else {
        // Assume YAML for .yml or .yaml
        const yaml = require('js-yaml');
        manifest = yaml.load(manifestText);
    }
} catch (manifestError) {
    this.logger.warn(`Failed to fetch manifest for ${release.tag_name}: ${manifestError}`);
    // Continue without manifest data - use fallback values
}

// Create bundle metadata
// Use manifest data if available, otherwise fall back to release data
const bundle: Bundle = {
    id: `${owner}-${repo}-${release.tag_name}`,
    name: manifest?.name || release.name || `${repo} ${release.tag_name}`,
    version: manifest?.version || release.tag_name.replace(/^v/, ''),
    description: manifest?.description || this.extractDescription(release.body),
    author: manifest?.author || owner,
    // ... other fields
};
```

## Benefits

1. **Accurate Display**: Bundle names now match what's defined in the deployment manifest
2. **Consistency**: Aligns with GitLab adapter behavior which already fetches manifests
3. **Fallback Support**: If manifest fetch fails, falls back to GitHub release name
4. **Requirement Compliance**: Satisfies Requirement 1.3: "WHEN displaying a consolidated bundle entry THEN the system SHALL use the name from the most recent release's deployment manifest"

## Testing

- All 794 unit tests passing ✅ (added 2 new tests)
- All 4 property-based tests passing ✅  
- All 7 integration tests passing ✅
- Zero TypeScript errors ✅

### New Tests Added

1. **`should use bundle name from deployment manifest, not version number`**
   - Validates that when a GitHub release is named "1.0.12", the bundle name comes from the deployment manifest ("Amadeus Airlines Solutions") instead of the version number
   - Tests that all manifest fields (name, description, author, tags) are properly extracted
   - Ensures the bundle name is NOT the version number or GitHub release name

2. **`should fallback to GitHub release name when manifest fetch fails`**
   - Validates graceful degradation when manifest download fails
   - Ensures the system falls back to using the GitHub release name
   - Tests error handling and resilience

## Files Modified

- `src/adapters/GitHubAdapter.ts` - Updated `fetchBundles()` method to fetch and parse deployment manifests
- `test/adapters/GitHubAdapter.test.ts` - Added 2 new tests to validate bundle name extraction from manifests

## Related Requirements

- **Requirement 1.3**: Use name from most recent release's deployment manifest
- **Requirement 2.4**: Display metadata from latest release's deployment manifest

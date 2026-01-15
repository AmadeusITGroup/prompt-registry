/**
 * Bundle ID Generation Utilities
 * @module bundle-id
 * 
 * IMPORTANT: This logic MUST stay in sync with the runtime implementation in:
 * src/utils/bundleNameUtils.ts (generateBuildScriptBundleId function)
 * 
 * The bundle ID format is: {owner}-{repo}-{collectionId}-v{version}
 * 
 * Any changes here should be mirrored in bundleNameUtils.ts and vice versa.
 */

/**
 * Generate canonical bundle ID for consistency with runtime.
 * 
 * @param repoSlug - Repository slug (owner/repo or owner-repo)
 * @param collectionId - Collection identifier
 * @param version - Version string (without 'v' prefix)
 * @returns Canonical bundle ID
 * 
 * @example
 * generateBundleId('owner/repo', 'my-collection', '1.0.0')
 * // Returns: 'owner-repo-my-collection-v1.0.0'
 */
export function generateBundleId(repoSlug: string, collectionId: string, version: string): string {
  // Normalize repo slug to use hyphens (consistent with runtime)
  const normalizedSlug = repoSlug.replace('/', '-');
  return `${normalizedSlug}-${collectionId}-v${version}`;
}

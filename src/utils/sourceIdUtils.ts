/**
 * Source ID Utilities
 * Utilities for generating stable, portable source identifiers for lockfile entries.
 * 
 * These utilities ensure that sourceIds are:
 * - Deterministic: Same source always produces the same ID
 * - Portable: Not tied to user's hub configuration
 * - Collision-resistant: 8-char SHA256 hash provides sufficient uniqueness
 */

import * as crypto from 'crypto';

/**
 * Normalize URL for consistent hashing.
 * Converts to lowercase, removes protocol prefix, and removes trailing slashes.
 * 
 * @param url - URL to normalize
 * @returns Normalized URL string
 * 
 * @example
 * normalizeUrl("HTTPS://GitHub.com/owner/repo/") // "github.com/owner/repo"
 * normalizeUrl("http://example.com") // "example.com"
 */
function normalizeUrl(url: string): string {
    return url
        .toLowerCase()
        .replace(/^https?:\/\//, '')
        .replace(/\/+$/, '');
}

/**
 * Generate a stable sourceId for a hub source based on type and URL.
 * Format: {sourceType}-{urlHash} where urlHash is first 8 chars of SHA256.
 * 
 * This format is:
 * - Deterministic: Same inputs always produce the same output
 * - Portable: Not tied to any specific hub configuration
 * - Readable: Type prefix makes it easy to identify source type
 * 
 * @param sourceType - The type of source (e.g., 'github', 'gitlab', 'http')
 * @param url - The source URL
 * @returns Stable sourceId in format `{sourceType}-{8-char-hash}`
 * 
 * @example
 * generateHubSourceId('github', 'https://github.com/owner/repo') // "github-a1b2c3d4"
 * generateHubSourceId('gitlab', 'https://gitlab.com/group/project') // "gitlab-e5f6g7h8"
 */
export function generateHubSourceId(sourceType: string, url: string): string {
    const normalizedUrl = normalizeUrl(url);
    const hash = crypto.createHash('sha256')
        .update(`${sourceType}:${normalizedUrl}`)
        .digest('hex')
        .substring(0, 8);
    return `${sourceType}-${hash}`;
}

/**
 * Check if a sourceId is in the legacy hub-prefixed format.
 * Legacy format: `hub-{hubId}-{sourceId}` (e.g., "hub-my-hub-github-source")
 * 
 * This is used for backward compatibility with existing lockfiles that
 * contain the old hub-prefixed sourceId format.
 * 
 * @param sourceId - The sourceId to check
 * @returns true if sourceId is in legacy format (starts with 'hub-' and has 3+ segments)
 * 
 * @example
 * isLegacyHubSourceId('hub-my-hub-source1') // true (3 segments)
 * isLegacyHubSourceId('hub-test-hub-github-source') // true (5 segments)
 * isLegacyHubSourceId('github-a1b2c3d4') // false (new format)
 * isLegacyHubSourceId('hub-only') // false (only 2 segments)
 */
export function isLegacyHubSourceId(sourceId: string): boolean {
    return sourceId.startsWith('hub-') && sourceId.split('-').length >= 3;
}

/**
 * Generate a stable hub key for the lockfile based on URL and optional branch.
 * 
 * The key is derived from the hub URL (not the user-defined hub ID), making
 * lockfiles portable across different hub configurations. The format is:
 * - `{8-char-hash}` for main/master branches or no branch specified
 * - `{8-char-hash}-{branch}` for other branches
 * 
 * This ensures that:
 * - Same URL always produces the same key (deterministic)
 * - Keys are not tied to user-defined hub IDs (portable)
 * - Branch information is preserved when relevant
 * 
 * @param url - The hub URL
 * @param branch - Optional branch name (if not main/master, appended to key)
 * @returns Stable hub key in format `{8-char-hash}` or `{8-char-hash}-{branch}`
 * 
 * @example
 * generateHubKey('https://example.com/hub.json') // "a1b2c3d4"
 * generateHubKey('https://example.com/hub.json', 'main') // "a1b2c3d4"
 * generateHubKey('https://example.com/hub.json', 'master') // "a1b2c3d4"
 * generateHubKey('https://example.com/hub.json', 'develop') // "a1b2c3d4-develop"
 */
export function generateHubKey(url: string, branch?: string): string {
    const normalizedUrl = normalizeUrl(url);
    const hash = crypto.createHash('sha256')
        .update(normalizedUrl)
        .digest('hex')
        .substring(0, 8);
    
    if (branch && branch !== 'main' && branch !== 'master') {
        return `${hash}-${branch}`;
    }
    return hash;
}

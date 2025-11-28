/**
 * Tests for MarketplaceViewProvider
 * Focus on dynamic tag extraction and source filtering
 */

import * as assert from 'assert';
import { suite, test, beforeEach } from 'mocha';
import { Bundle, RegistrySource } from '../../src/types/registry';
import {
    extractAllTags,
    getTagFrequency,
    extractBundleSources,
    filterBundlesBySource,
    filterBundlesByTags,
    filterBundlesBySearch
} from '../../src/utils/filterUtils';

suite('MarketplaceViewProvider - Dynamic Filtering', () => {
    let mockBundles: Bundle[];
    let mockSources: RegistrySource[];

    beforeEach(() => {
        // Setup mock bundles with various tags
        mockBundles = [
            {
                id: 'bundle1',
                name: 'Testing Bundle',
                version: '1.0.0',
                description: 'A testing bundle',
                author: 'Test Author',
                sourceId: 'source1',
                environments: ['vscode'],
                tags: ['testing', 'automation', 'tdd'],
                lastUpdated: '2024-01-01',
                size: '1MB',
                dependencies: [],
                license: 'MIT',
                manifestUrl: 'https://example.com/manifest.yml',
                downloadUrl: 'https://example.com/bundle.zip'
            },
            {
                id: 'bundle2',
                name: 'Accessibility Bundle',
                version: '1.0.0',
                description: 'Accessibility helpers',
                author: 'A11y Team',
                sourceId: 'source2',
                environments: ['vscode'],
                tags: ['accessibility', 'a11y', 'testing'],
                lastUpdated: '2024-01-02',
                size: '2MB',
                dependencies: [],
                license: 'MIT',
                manifestUrl: 'https://example.com/manifest2.yml',
                downloadUrl: 'https://example.com/bundle2.zip'
            },
            {
                id: 'bundle3',
                name: 'Agents Bundle',
                version: '2.0.0',
                description: 'AI agents collection',
                author: 'AI Team',
                sourceId: 'source1',
                environments: ['vscode', 'cursor'],
                tags: ['agents', 'ai', 'automation'],
                lastUpdated: '2024-01-03',
                size: '3MB',
                dependencies: [],
                license: 'Apache-2.0',
                manifestUrl: 'https://example.com/manifest3.yml',
                downloadUrl: 'https://example.com/bundle3.zip'
            },
            {
                id: 'bundle4',
                name: 'Angular Bundle',
                version: '1.5.0',
                description: 'Angular development prompts',
                author: 'Angular Team',
                sourceId: 'source2',
                environments: ['vscode'],
                tags: ['angular', 'frontend', 'typescript'],
                lastUpdated: '2024-01-04',
                size: '1.5MB',
                dependencies: [],
                license: 'MIT',
                manifestUrl: 'https://example.com/manifest4.yml',
                downloadUrl: 'https://example.com/bundle4.zip'
            }
        ];

        mockSources = [
            {
                id: 'source1',
                name: 'Primary Source',
                type: 'github',
                url: 'https://github.com/org/repo1',
                enabled: true,
                priority: 1
            },
            {
                id: 'source2',
                name: 'Secondary Source',
                type: 'local',
                url: '/path/to/local',
                enabled: true,
                priority: 2
            },
            {
                id: 'source3',
                name: 'Disabled Source',
                type: 'http',
                url: 'https://example.com/bundles',
                enabled: false,
                priority: 3
            }
        ];
    });

    suite('Dynamic Tag Extraction', () => {
        test('should extract all unique tags from bundles', () => {
            const tags = extractAllTags(mockBundles);
            
            // Should have 10 unique tags
            assert.strictEqual(tags.length, 10);
            assert.ok(tags.includes('testing'));
            assert.ok(tags.includes('automation'));
            assert.ok(tags.includes('tdd'));
            assert.ok(tags.includes('accessibility'));
            assert.ok(tags.includes('a11y'));
            assert.ok(tags.includes('agents'));
            assert.ok(tags.includes('ai'));
            assert.ok(tags.includes('angular'));
            assert.ok(tags.includes('frontend'));
            assert.ok(tags.includes('typescript'));
        });

        test('should sort tags alphabetically', () => {
            const tags = extractAllTags(mockBundles);
            
            // Verify alphabetical order
            for (let i = 0; i < tags.length - 1; i++) {
                assert.ok(tags[i].localeCompare(tags[i + 1]) <= 0, 
                    `Tag "${tags[i]}" should come before "${tags[i + 1]}"`);
            }
        });

        test('should handle bundles with no tags', () => {
            const bundleNoTags: Bundle = {
                ...mockBundles[0],
                id: 'bundle-no-tags',
                tags: []
            };
            
            const tags = extractAllTags([bundleNoTags]);
            assert.strictEqual(tags.length, 0);
        });

        test('should handle empty bundle array', () => {
            const tags = extractAllTags([]);
            assert.strictEqual(tags.length, 0);
        });

        test('should deduplicate tags across bundles', () => {
            // 'testing' and 'automation' appear in multiple bundles
            const tags = extractAllTags(mockBundles);
            
            const testingCount = tags.filter(t => t === 'testing').length;
            const automationCount = tags.filter(t => t === 'automation').length;
            
            assert.strictEqual(testingCount, 1, 'testing tag should appear only once');
            assert.strictEqual(automationCount, 1, 'automation tag should appear only once');
        });

        test('should count tag frequency', () => {
            const tagFrequency = getTagFrequency(mockBundles);
            
            assert.strictEqual(tagFrequency.get('testing'), 2);
            assert.strictEqual(tagFrequency.get('automation'), 2);
            assert.strictEqual(tagFrequency.get('a11y'), 1);
            assert.strictEqual(tagFrequency.get('agents'), 1);
            assert.strictEqual(tagFrequency.get('angular'), 1);
        });
    });

    suite('Source Filtering', () => {
        test('should extract all sources from bundles', () => {
            const sources = extractBundleSources(mockBundles, mockSources);
            
            // Should have 2 sources (source1 and source2 have bundles)
            assert.strictEqual(sources.length, 2);
            
            const sourceIds = sources.map(s => s.id);
            assert.ok(sourceIds.includes('source1'));
            assert.ok(sourceIds.includes('source2'));
        });

        test('should include bundle count per source', () => {
            const sources = extractBundleSources(mockBundles, mockSources);
            
            const source1 = sources.find(s => s.id === 'source1');
            const source2 = sources.find(s => s.id === 'source2');
            
            assert.ok(source1);
            assert.ok(source2);
            assert.strictEqual(source1.bundleCount, 2); // bundle1 and bundle3
            assert.strictEqual(source2.bundleCount, 2); // bundle2 and bundle4
        });

        test('should not include sources with no bundles', () => {
            const sources = extractBundleSources(mockBundles, mockSources);
            
            const source3 = sources.find(s => s.id === 'source3');
            assert.strictEqual(source3, undefined);
        });

        test('should handle empty bundles array', () => {
            const sources = extractBundleSources([], mockSources);
            assert.strictEqual(sources.length, 0);
        });

        test('should filter bundles by source', () => {
            const filtered = filterBundlesBySource(mockBundles, 'source1');
            
            assert.strictEqual(filtered.length, 2);
            assert.ok(filtered.every(b => b.sourceId === 'source1'));
        });

        test('should return all bundles when source is "all"', () => {
            const filtered = filterBundlesBySource(mockBundles, 'all');
            
            assert.strictEqual(filtered.length, mockBundles.length);
        });

        test('should return empty array for non-existent source', () => {
            const filtered = filterBundlesBySource(mockBundles, 'non-existent');
            
            assert.strictEqual(filtered.length, 0);
        });
    });

    suite('Tag Filtering', () => {
        test('should filter bundles by single tag', () => {
            const filtered = filterBundlesByTags(mockBundles, ['testing']);
            
            assert.strictEqual(filtered.length, 2);
            filtered.forEach(bundle => {
                assert.ok(bundle.tags.some(t => t.toLowerCase() === 'testing'));
            });
        });

        test('should filter bundles by multiple tags (OR logic)', () => {
            const filtered = filterBundlesByTags(mockBundles, ['agents', 'angular']);
            
            // Should match bundle3 (agents) and bundle4 (angular)
            assert.strictEqual(filtered.length, 2);
            const ids = filtered.map(b => b.id);
            assert.ok(ids.includes('bundle3'));
            assert.ok(ids.includes('bundle4'));
        });

        test('should return all bundles when tags array is empty', () => {
            const filtered = filterBundlesByTags(mockBundles, []);
            
            assert.strictEqual(filtered.length, mockBundles.length);
        });

        test('should return empty array when no bundles match tags', () => {
            const filtered = filterBundlesByTags(mockBundles, ['non-existent-tag']);
            
            assert.strictEqual(filtered.length, 0);
        });

        test('should be case-insensitive', () => {
            const filtered = filterBundlesByTags(mockBundles, ['TESTING']);
            
            assert.strictEqual(filtered.length, 2);
        });
    });

    suite('Combined Filtering', () => {
        test('should filter by both source and tags', () => {
            // Filter source1 bundles with 'automation' tag
            let filtered = filterBundlesBySource(mockBundles, 'source1');
            filtered = filterBundlesByTags(filtered, ['automation']);
            
            // Should match bundle1 and bundle3
            assert.strictEqual(filtered.length, 2);
            filtered.forEach(bundle => {
                assert.strictEqual(bundle.sourceId, 'source1');
                assert.ok(bundle.tags.some(t => t.toLowerCase() === 'automation'));
            });
        });

        test('should filter by source, tags, and search text', () => {
            let filtered = filterBundlesBySource(mockBundles, 'source1');
            filtered = filterBundlesByTags(filtered, ['automation']);
            filtered = filterBundlesBySearch(filtered, 'testing');
            
            // Should match only bundle1
            assert.strictEqual(filtered.length, 1);
            assert.strictEqual(filtered[0].id, 'bundle1');
        });
    });

    suite('Button State Determination', () => {
        /**
         * Helper to determine button state based on version comparison
         * This mirrors the logic that should be in MarketplaceViewProvider
         */
        function determineButtonState(
            installedVersion: string | undefined,
            latestVersion: string
        ): 'install' | 'update' | 'uninstall' {
            if (!installedVersion) {
                return 'install';
            }
            
            try {
                const { VersionManager } = require('../../src/utils/versionManager');
                if (VersionManager.isUpdateAvailable(installedVersion, latestVersion)) {
                    return 'update';
                }
            } catch (error) {
                // If version comparison fails, fall back to string comparison
                if (installedVersion !== latestVersion) {
                    return 'update';
                }
            }
            
            return 'uninstall';
        }

        /**
         * Helper to check if bundle identities match
         * For GitHub bundles, compares without version suffix
         * For others, exact match
         */
        function matchesBundleIdentity(installedId: string, bundleId: string, sourceType: string): boolean {
            const { VersionManager } = require('../../src/utils/versionManager');
            
            if (sourceType === 'github') {
                const installedIdentity = VersionManager.extractBundleIdentity(installedId, 'github');
                const bundleIdentity = VersionManager.extractBundleIdentity(bundleId, 'github');
                return installedIdentity === bundleIdentity;
            }
            
            // For non-GitHub sources, exact match
            return installedId === bundleId;
        }

        test('should return "install" state when no version installed', () => {
            const buttonState = determineButtonState(undefined, '1.0.0');
            assert.strictEqual(buttonState, 'install');
        });

        test('should return "update" state when older version installed', () => {
            const buttonState = determineButtonState('1.0.0', '2.0.0');
            assert.strictEqual(buttonState, 'update');
        });

        test('should return "update" state for minor version difference', () => {
            const buttonState = determineButtonState('1.0.0', '1.1.0');
            assert.strictEqual(buttonState, 'update');
        });

        test('should return "update" state for patch version difference', () => {
            const buttonState = determineButtonState('1.0.0', '1.0.1');
            assert.strictEqual(buttonState, 'update');
        });

        test('should return "uninstall" state when latest version installed', () => {
            const buttonState = determineButtonState('2.0.0', '2.0.0');
            assert.strictEqual(buttonState, 'uninstall');
        });

        test('should return "uninstall" state when newer version installed', () => {
            // Edge case: user has a newer version than what's available
            const buttonState = determineButtonState('3.0.0', '2.0.0');
            assert.strictEqual(buttonState, 'uninstall');
        });

        test('should handle version prefixes correctly', () => {
            const buttonState1 = determineButtonState('v1.0.0', 'v2.0.0');
            assert.strictEqual(buttonState1, 'update');

            const buttonState2 = determineButtonState('v2.0.0', 'v2.0.0');
            assert.strictEqual(buttonState2, 'uninstall');
        });

        test('should match GitHub bundle identity without version suffix', () => {
            const matches = matchesBundleIdentity(
                'microsoft-vscode-1.0.0',
                'microsoft-vscode-2.0.0',
                'github'
            );
            assert.strictEqual(matches, true);
        });

        test('should not match different GitHub repositories', () => {
            const matches = matchesBundleIdentity(
                'microsoft-vscode-1.0.0',
                'microsoft-copilot-1.0.0',
                'github'
            );
            assert.strictEqual(matches, false);
        });

        test('should match GitHub bundles with complex names', () => {
            const matches = matchesBundleIdentity(
                'my-org-my-repo-123-v1.0.0',
                'my-org-my-repo-123-v2.0.0',
                'github'
            );
            assert.strictEqual(matches, true);
        });

        test('should require exact match for non-GitHub bundles', () => {
            const matches1 = matchesBundleIdentity(
                'local-bundle-1.0.0',
                'local-bundle-1.0.0',
                'local'
            );
            assert.strictEqual(matches1, true);

            const matches2 = matchesBundleIdentity(
                'local-bundle-1.0.0',
                'local-bundle-2.0.0',
                'local'
            );
            assert.strictEqual(matches2, false);
        });

        test('should require exact match for GitLab bundles', () => {
            const matches = matchesBundleIdentity(
                'gitlab-bundle-1',
                'gitlab-bundle-2',
                'gitlab'
            );
            assert.strictEqual(matches, false);
        });

        test('should require exact match for HTTP bundles', () => {
            const matches = matchesBundleIdentity(
                'http-bundle-v1',
                'http-bundle-v2',
                'http'
            );
            assert.strictEqual(matches, false);
        });

        test('should require exact match for awesome-copilot bundles', () => {
            const matches = matchesBundleIdentity(
                'awesome-bundle',
                'awesome-bundle',
                'awesome-copilot'
            );
            assert.strictEqual(matches, true);
        });
    });
});

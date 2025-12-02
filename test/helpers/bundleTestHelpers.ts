/**
 * Shared test helpers for creating Bundle test data
 * 
 * This module provides utilities for creating test bundles with consistent
 * structure across all test files.
 */
import { Bundle } from '../../src/types/registry';

/**
 * Constants for test data
 */
export const TEST_SOURCE_IDS = {
    GITHUB: 'github-source',
    GITLAB: 'gitlab-source',
    HTTP: 'http-source',
    LOCAL: 'local-source',
    AWESOME_COPILOT: 'awesome-copilot-source'
} as const;

export const TEST_DEFAULTS = {
    DESCRIPTION: 'Test bundle',
    AUTHOR: 'test',
    ENVIRONMENT: 'vscode',
    TAG: 'test',
    SIZE: '1MB',
    LICENSE: 'MIT'
} as const;

/**
 * Builder pattern for creating test bundles with fluent API
 * 
 * @example
 * const bundle = BundleBuilder.github('owner', 'repo')
 *     .withVersion('1.0.0')
 *     .withDescription('Custom description')
 *     .build();
 */
export class BundleBuilder {
    private bundle: Partial<Bundle> = {
        description: TEST_DEFAULTS.DESCRIPTION,
        environments: [TEST_DEFAULTS.ENVIRONMENT],
        tags: [TEST_DEFAULTS.TAG],
        size: TEST_DEFAULTS.SIZE,
        dependencies: [],
        license: TEST_DEFAULTS.LICENSE,
        lastUpdated: new Date().toISOString()
    };

    /**
     * Create a builder for a GitHub bundle
     */
    static github(owner: string, repo: string): BundleBuilder {
        const builder = new BundleBuilder();
        builder.bundle.sourceId = TEST_SOURCE_IDS.GITHUB;
        builder.bundle.name = `${owner}/${repo}`;
        builder.bundle.author = owner;
        builder.bundle.id = `${owner}-${repo}`;
        builder.bundle.manifestUrl = `https://github.com/${owner}/${repo}/releases/download/VERSION/manifest.yml`;
        builder.bundle.downloadUrl = `https://github.com/${owner}/${repo}/releases/download/VERSION/bundle.zip`;
        return builder;
    }

    /**
     * Create a builder for a non-GitHub bundle
     */
    static fromSource(bundleId: string, sourceType: keyof typeof TEST_SOURCE_IDS): BundleBuilder {
        const builder = new BundleBuilder();
        builder.bundle.sourceId = TEST_SOURCE_IDS[sourceType];
        builder.bundle.id = bundleId;
        builder.bundle.name = bundleId;
        builder.bundle.author = TEST_DEFAULTS.AUTHOR;
        builder.bundle.manifestUrl = `https://example.com/${bundleId}/manifest.yml`;
        builder.bundle.downloadUrl = `https://example.com/${bundleId}/bundle.zip`;
        return builder;
    }

    /**
     * Set the version and update URLs accordingly
     */
    withVersion(version: string): BundleBuilder {
        this.bundle.version = version;
        
        // Update ID to include version
        if (this.bundle.id) {
            // Remove existing version suffix (handles both GitHub and non-GitHub)
            const baseId = this.bundle.id.replace(/-v?\d+\.\d+\.\d+(-[\w.]+)?$/, '');
            this.bundle.id = `${baseId}-${version}`;
        }
        
        // Update URLs with actual version (handles both 'VERSION' placeholder and existing versions)
        if (this.bundle.manifestUrl) {
            this.bundle.manifestUrl = this.bundle.manifestUrl.replace(/VERSION|v?\d+\.\d+\.\d+(-[\w.]+)?/, version);
        }
        if (this.bundle.downloadUrl) {
            this.bundle.downloadUrl = this.bundle.downloadUrl.replace(/VERSION|v?\d+\.\d+\.\d+(-[\w.]+)?/, version);
        }
        
        return this;
    }

    withDescription(description: string): BundleBuilder {
        this.bundle.description = description;
        return this;
    }

    withAuthor(author: string): BundleBuilder {
        this.bundle.author = author;
        return this;
    }

    withTags(tags: string[]): BundleBuilder {
        this.bundle.tags = tags;
        return this;
    }

    withLastUpdated(date: string): BundleBuilder {
        this.bundle.lastUpdated = date;
        return this;
    }

    build(): Bundle {
        if (!this.bundle.id || !this.bundle.version) {
            throw new Error('Bundle must have id and version. Call withVersion() before build()');
        }
        
        return this.bundle as Bundle;
    }
}

/**
 * Test suite for BundleBuilder (can be imported and run in test files)
 */
export function testBundleBuilder() {
    const assert = require('assert');
    
    suite('BundleBuilder', () => {
        suite('withVersion', () => {
            test('should handle multiple version updates correctly', () => {
                const builder = BundleBuilder.github('owner', 'repo');
                
                // Set version 1.0.0
                const bundle1 = builder.withVersion('1.0.0').build();
                assert.strictEqual(bundle1.version, '1.0.0');
                assert.strictEqual(bundle1.id, 'owner-repo-1.0.0');
                assert.ok(bundle1.downloadUrl.includes('1.0.0'));
                
                // Update to version 2.0.0 (should replace, not append)
                const bundle2 = BundleBuilder.github('owner', 'repo').withVersion('2.0.0').build();
                assert.strictEqual(bundle2.version, '2.0.0');
                assert.strictEqual(bundle2.id, 'owner-repo-2.0.0');
                assert.ok(bundle2.downloadUrl.includes('2.0.0'));
                assert.ok(!bundle2.downloadUrl.includes('1.0.0'));
            });
            
            test('should handle version updates for non-GitHub bundles', () => {
                const builder = BundleBuilder.fromSource('my-bundle', 'LOCAL');
                
                const bundle1 = builder.withVersion('1.0.0').build();
                assert.strictEqual(bundle1.id, 'my-bundle-1.0.0');
                
                // Create new builder and update version
                const bundle2 = BundleBuilder.fromSource('my-bundle', 'LOCAL').withVersion('2.0.0').build();
                assert.strictEqual(bundle2.id, 'my-bundle-2.0.0');
                assert.ok(!bundle2.id.includes('1.0.0'));
            });
            
            test('should update URLs with version', () => {
                const bundle = BundleBuilder.github('owner', 'repo')
                    .withVersion('1.5.0')
                    .build();
                
                assert.ok(bundle.downloadUrl.includes('1.5.0'));
                assert.ok(bundle.manifestUrl.includes('1.5.0'));
                assert.ok(!bundle.downloadUrl.includes('VERSION'));
                assert.ok(!bundle.manifestUrl.includes('VERSION'));
            });
        });
    });
}

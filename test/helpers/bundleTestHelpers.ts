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
        
        // Update ID to include version for GitHub bundles
        if (this.bundle.sourceId === TEST_SOURCE_IDS.GITHUB && this.bundle.id) {
            // Remove existing version if present
            const baseId = this.bundle.id.replace(/-v?\d+\.\d+\.\d+(-[\w.]+)?$/, '');
            this.bundle.id = `${baseId}-${version}`;
        } else if (this.bundle.id) {
            this.bundle.id = `${this.bundle.id}-${version}`;
        }
        
        // Update URLs with actual version
        if (this.bundle.manifestUrl) {
            this.bundle.manifestUrl = this.bundle.manifestUrl.replace('VERSION', version);
        }
        if (this.bundle.downloadUrl) {
            this.bundle.downloadUrl = this.bundle.downloadUrl.replace('VERSION', version);
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
 * Quick helper for creating a GitHub bundle (legacy compatibility)
 * 
 * @deprecated Use BundleBuilder.github() for more flexibility
 */
export function createGitHubBundle(owner: string, repo: string, version: string): Bundle {
    return BundleBuilder.github(owner, repo).withVersion(version).build();
}

/**
 * Quick helper for creating a non-GitHub bundle (legacy compatibility)
 * 
 * @deprecated Use BundleBuilder.fromSource() for more flexibility
 */
export function createNonGitHubBundle(bundleId: string, version: string, sourceType: string): Bundle {
    const sourceTypeMap: Record<string, keyof typeof TEST_SOURCE_IDS> = {
        'gitlab': 'GITLAB',
        'http': 'HTTP',
        'local': 'LOCAL',
        'awesome-copilot': 'AWESOME_COPILOT'
    };
    
    const mappedType = sourceTypeMap[sourceType] || 'LOCAL';
    return BundleBuilder.fromSource(bundleId, mappedType).withVersion(version).build();
}

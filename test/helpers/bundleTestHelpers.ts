/**
 * Shared test helpers for creating Bundle test data
 * 
 * This module provides utilities for creating test bundles with consistent
 * structure across all test files.
 */
import { Bundle, InstalledBundle } from '../../src/types/registry';
import { UpdateCheckResult } from '../../src/services/UpdateCache';

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
 * Create a mock InstalledBundle for testing
 * 
 * Provides consistent InstalledBundle creation across test files.
 * Reduces 7-line inline object creation to a single function call.
 * 
 * @param bundleId - Bundle identifier
 * @param version - Bundle version
 * @param overrides - Optional partial overrides for any field
 * @returns Complete InstalledBundle object
 * 
 * @example
 * const bundle = createMockInstalledBundle('test-bundle', '1.0.0');
 * const customBundle = createMockInstalledBundle('test-bundle', '1.0.0', { scope: 'workspace' });
 */
export function createMockInstalledBundle(
    bundleId: string,
    version: string,
    overrides?: Partial<InstalledBundle>
): InstalledBundle {
    return {
        bundleId,
        version,
        installedAt: new Date().toISOString(),
        scope: 'user',
        installPath: `/mock/path/${bundleId}`,
        manifest: {} as any,
        ...overrides
    };
}

/**
 * Create a mock UpdateCheckResult for testing
 * 
 * Provides consistent UpdateCheckResult creation for update-related tests.
 * 
 * @param bundleId - Bundle identifier
 * @param currentVersion - Currently installed version
 * @param latestVersion - Latest available version
 * @param overrides - Optional partial overrides for any field
 * @returns Complete UpdateCheckResult object
 * 
 * @example
 * const update = createMockUpdateCheckResult('test-bundle', '1.0.0', '2.0.0');
 * const autoUpdate = createMockUpdateCheckResult('test-bundle', '1.0.0', '2.0.0', { autoUpdateEnabled: true });
 */
export function createMockUpdateCheckResult(
    bundleId: string,
    currentVersion: string,
    latestVersion: string,
    overrides?: Partial<UpdateCheckResult>
): UpdateCheckResult {
    return {
        bundleId,
        currentVersion,
        latestVersion,
        releaseDate: new Date().toISOString(),
        downloadUrl: 'https://example.com/bundle.zip',
        autoUpdateEnabled: false,
        ...overrides
    };
}

/**
 * Create a unique UpdateCheckResult for batch testing
 * 
 * Generates UpdateCheckResult with predictable version increments.
 * Useful for batch update tests where multiple bundles need distinct versions.
 * 
 * @param index - Index for generating unique bundle ID and versions
 * @returns UpdateCheckResult with versions based on index
 * 
 * @example
 * const updates = Array.from({ length: 5 }, (_, i) => createUniqueUpdateCheckResult(i));
 * // Generates: bundle-0 (0.0.0 → 0.1.0), bundle-1 (1.0.0 → 1.1.0), etc.
 */
export function createUniqueUpdateCheckResult(index: number): UpdateCheckResult {
    return {
        bundleId: `bundle-${index}`,
        currentVersion: `${index}.0.0`,
        latestVersion: `${index}.1.0`,
        releaseDate: new Date().toISOString(),
        downloadUrl: 'https://example.com/bundle.zip',
        autoUpdateEnabled: true
    };
}

// ===== Mock Setup Helpers (consolidated from bundleCommandsTestHelpers) =====

/**
 * Setup mock for update available scenario
 * Consolidates mock configuration for single bundle updates
 */
export function setupUpdateAvailable(
    mockRegistryManager: any,
    bundleId: string, 
    bundleName: string = 'Test Bundle', 
    currentVersion: string = '1.0.0', 
    latestVersion: string = '2.0.0'
): void {
    const update = createMockUpdateCheckResult(bundleId, currentVersion, latestVersion);
    mockRegistryManager.checkUpdates.resolves([update]);
    
    // Create bundle with the specified name, not derived from bundleId
    const bundle = BundleBuilder.fromSource(bundleId, 'GITHUB')
        .withVersion(latestVersion)
        .withDescription('Test bundle')
        .build();
    
    // Override the name with the provided bundleName
    bundle.name = bundleName;
    
    mockRegistryManager.getBundleDetails.withArgs(bundleId).resolves(bundle);
}

/**
 * Setup mock for no updates available scenario
 */
export function setupNoUpdatesAvailable(mockRegistryManager: any): void {
    mockRegistryManager.checkUpdates.resolves([]);
}

/**
 * Setup VS Code progress mock with default behavior
 */
export function setupProgressMock(sandbox: any): any {
    const mockWithProgress = sandbox.stub(require('vscode').window, 'withProgress');
    mockWithProgress.callsFake(async (_options: any, callback: any) => {
        return await callback({ report: sandbox.stub() }, { isCancellationRequested: false, onCancellationRequested: sandbox.stub() });
    });
    return mockWithProgress;
}

/**
 * Reset all common mocks used in bundle command tests
 */
export function resetBundleCommandsMocks(
    mockRegistryManager: any,
    mockShowQuickPick: any,
    mockShowInformationMessage: any,
    mockWithProgress: any
): void {
    mockRegistryManager.checkUpdates.reset();
    mockRegistryManager.getBundleDetails.reset();
    mockRegistryManager.updateBundle.reset();
    mockRegistryManager.listInstalledBundles.reset();
    mockShowQuickPick.reset();
    mockShowInformationMessage.reset();
    mockWithProgress.reset();
    
    // Re-setup default withProgress behavior after reset
    mockWithProgress.callsFake(async (_options: any, callback: any) => {
        return await callback({ report: require('sinon').stub() }, { isCancellationRequested: false, onCancellationRequested: require('sinon').stub() });
    });
    
    // Setup default listInstalledBundles behavior
    mockRegistryManager.listInstalledBundles.resolves([]);
}

/**
 * Generate test data for multiple bundle updates
 */
export function generateMultipleUpdates(count: number): UpdateCheckResult[] {
    return Array.from({ length: count }, (_, i) => 
        createUniqueUpdateCheckResult(i)
    );
}

/**
 * Generate test bundles with corresponding updates
 */
export function generateBundlesWithUpdates(updates: UpdateCheckResult[]): Bundle[] {
    return updates.map(update => 
        BundleBuilder.fromSource(update.bundleId, 'GITHUB')
            .withVersion(update.latestVersion)
            .build()
    );
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
                assert.ok(!bundle.manifestUrl.includes('VERSION'));
            });
        });
    });
}

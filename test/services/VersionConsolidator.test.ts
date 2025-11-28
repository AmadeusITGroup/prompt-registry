/**
 * Unit tests for VersionConsolidator
 */
import * as assert from 'assert';
import { VersionConsolidator } from '../../src/services/VersionConsolidator';
import { BundleBuilder, TEST_SOURCE_IDS } from '../helpers/bundleTestHelpers';

suite('VersionConsolidator Unit Tests', () => {
    let consolidator: VersionConsolidator;
    
    setup(() => {
        consolidator = new VersionConsolidator();
    });
    
    teardown(() => {
        consolidator.clearCache();
    });
    
    suite('consolidateBundles', () => {
        test('should consolidate 3 versions (1.0.0, 2.0.0, 1.5.0) into single entry with latest (2.0.0)', () => {
            const bundles = [
                BundleBuilder.github('microsoft', 'vscode').withVersion('1.0.0').build(),
                BundleBuilder.github('microsoft', 'vscode').withVersion('2.0.0').build(),
                BundleBuilder.github('microsoft', 'vscode').withVersion('1.5.0').build()
            ];
            
            const consolidated = consolidator.consolidateBundles(bundles);
            
            assert.strictEqual(consolidated.length, 1, 'Should have one consolidated entry');
            assert.strictEqual(consolidated[0].version, '2.0.0', 'Should select latest version');
            assert.strictEqual(consolidated[0].isConsolidated, true, 'Should be marked as consolidated');
            assert.strictEqual(consolidated[0].availableVersions.length, 3, 'Should have all versions');
        });
        
        test('should preserve version metadata for all versions', () => {
            const bundles = [
                BundleBuilder.github('owner', 'repo').withVersion('1.0.0').build(),
                BundleBuilder.github('owner', 'repo').withVersion('2.0.0').build()
            ];
            
            const consolidated = consolidator.consolidateBundles(bundles);
            
            const versions = consolidated[0].availableVersions;
            assert.strictEqual(versions.length, 2);
            assert.ok(versions.some(v => v.version === '1.0.0'));
            assert.ok(versions.some(v => v.version === '2.0.0'));
            assert.ok(versions.every(v => v.downloadUrl && v.manifestUrl));
        });
        
        test('should not consolidate single-version bundles', () => {
            const bundles = [
                BundleBuilder.github('owner', 'repo').withVersion('1.0.0').build()
            ];
            
            const consolidated = consolidator.consolidateBundles(bundles);
            
            assert.strictEqual(consolidated.length, 1);
            assert.strictEqual(consolidated[0].isConsolidated, false, 'Should not be marked as consolidated');
            assert.strictEqual(consolidated[0].availableVersions.length, 1);
        });
        
        test('should handle mixed source types (GitHub consolidated, others unchanged)', () => {
            const bundles = [
                BundleBuilder.github('owner', 'repo').withVersion('1.0.0').build(),
                BundleBuilder.github('owner', 'repo').withVersion('2.0.0').build(),
                BundleBuilder.fromSource('gitlab-bundle', 'GITLAB').withVersion('1.0.0').build(),
                BundleBuilder.fromSource('local-bundle', 'LOCAL').withVersion('1.0.0').build()
            ];
            
            const consolidated = consolidator.consolidateBundles(bundles);
            
            // GitHub bundles should be consolidated (1 entry)
            // GitLab and local should remain separate (2 entries)
            assert.strictEqual(consolidated.length, 3, 'Should have 3 entries total');
            
            const githubEntry = consolidated.find(b => b.sourceId === TEST_SOURCE_IDS.GITHUB);
            assert.ok(githubEntry, 'Should have GitHub entry');
            assert.strictEqual(githubEntry!.isConsolidated, true);
            assert.strictEqual(githubEntry!.version, '2.0.0');
        });
        
        test('should handle empty bundle array', () => {
            const consolidated = consolidator.consolidateBundles([]);
            
            assert.strictEqual(consolidated.length, 0);
        });
        
        test('should consolidate each GitHub repo separately', () => {
            const bundles = [
                BundleBuilder.github('owner1', 'repo1').withVersion('1.0.0').build(),
                BundleBuilder.github('owner1', 'repo1').withVersion('2.0.0').build(),
                BundleBuilder.github('owner2', 'repo2').withVersion('1.0.0').build(),
                BundleBuilder.github('owner2', 'repo2').withVersion('3.0.0').build()
            ];
            
            const consolidated = consolidator.consolidateBundles(bundles);
            
            assert.strictEqual(consolidated.length, 2, 'Should have 2 consolidated entries');
            
            const repo1 = consolidated.find(b => b.name === 'owner1/repo1');
            const repo2 = consolidated.find(b => b.name === 'owner2/repo2');
            
            assert.ok(repo1);
            assert.ok(repo2);
            assert.strictEqual(repo1!.version, '2.0.0');
            assert.strictEqual(repo2!.version, '3.0.0');
        });
        
        test('should sort versions semantically (10.0.0 > 2.0.0 > 1.10.0 > 1.0.0)', () => {
            const bundles = [
                BundleBuilder.github('owner', 'repo').withVersion('1.0.0').build(),
                BundleBuilder.github('owner', 'repo').withVersion('10.0.0').build(),
                BundleBuilder.github('owner', 'repo').withVersion('2.0.0').build(),
                BundleBuilder.github('owner', 'repo').withVersion('1.10.0').build()
            ];
            
            const consolidated = consolidator.consolidateBundles(bundles);
            
            assert.strictEqual(consolidated[0].version, '10.0.0', 'Should select highest version');
            
            // Check that versions are sorted in availableVersions
            const versions = consolidated[0].availableVersions.map(v => v.version);
            assert.strictEqual(versions[0], '10.0.0');
            assert.strictEqual(versions[1], '2.0.0');
            assert.strictEqual(versions[2], '1.10.0');
            assert.strictEqual(versions[3], '1.0.0');
        });
    });
    
    suite('getAvailableVersions', () => {
        test('should return cached versions for consolidated bundle', () => {
            const bundles = [
                BundleBuilder.github('owner', 'repo').withVersion('1.0.0').build(),
                BundleBuilder.github('owner', 'repo').withVersion('2.0.0').build()
            ];
            
            consolidator.consolidateBundles(bundles);
            
            const versions = consolidator.getAvailableVersions('owner-repo');
            
            assert.strictEqual(versions.length, 2);
            assert.ok(versions.some(v => v.version === '1.0.0'));
            assert.ok(versions.some(v => v.version === '2.0.0'));
        });
        
        test('should return empty array for non-existent bundle', () => {
            const versions = consolidator.getAvailableVersions('non-existent');
            
            assert.strictEqual(versions.length, 0);
        });
    });
    
    suite('clearCache', () => {
        test('should clear version cache', () => {
            const bundles = [
                BundleBuilder.github('owner', 'repo').withVersion('1.0.0').build(),
                BundleBuilder.github('owner', 'repo').withVersion('2.0.0').build()
            ];
            
            consolidator.consolidateBundles(bundles);
            
            let versions = consolidator.getAvailableVersions('owner-repo');
            assert.strictEqual(versions.length, 2);
            
            consolidator.clearCache();
            
            versions = consolidator.getAvailableVersions('owner-repo');
            assert.strictEqual(versions.length, 0);
        });
    });
    
    suite('setSourceTypeResolver', () => {
        test('should use custom source type resolver when provided', () => {
            // Set up a custom resolver that always returns 'local' (no consolidation)
            consolidator.setSourceTypeResolver(() => 'local');
            
            const bundles = [
                BundleBuilder.github('owner', 'repo').withVersion('1.0.0').build(),
                BundleBuilder.github('owner', 'repo').withVersion('2.0.0').build()
            ];
            
            const consolidated = consolidator.consolidateBundles(bundles);
            
            // Should NOT consolidate because resolver returns 'local'
            assert.strictEqual(consolidated.length, 2, 'Should not consolidate with local source type');
        });
        
        test('should fall back to heuristic when no resolver provided', () => {
            // No resolver set, should use heuristic (github-source -> github)
            const bundles = [
                BundleBuilder.github('owner', 'repo').withVersion('1.0.0').build(),
                BundleBuilder.github('owner', 'repo').withVersion('2.0.0').build()
            ];
            
            const consolidated = consolidator.consolidateBundles(bundles);
            
            // Should consolidate using heuristic
            assert.strictEqual(consolidated.length, 1, 'Should consolidate using heuristic');
        });
    });
});

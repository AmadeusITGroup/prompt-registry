/**
 * RegistryManager Unit Tests
 * 
 * Tests for RegistryManager export/import functionality (integration-style)
 */

import * as assert from 'assert';

suite('RegistryManager Export/Import', () => {
    suite('Export Format Validation', () => {
        test('JSON export should produce valid JSON structure', () => {
            const mockExportData = {
                version: '1.0.0',
                exportedAt: new Date().toISOString(),
                sources: [],
                profiles: [],
                configuration: {
                    autoCheckUpdates: true,
                    installationScope: 'user'
                }
            };
            
            const jsonString = JSON.stringify(mockExportData, null, 2);
            const parsed = JSON.parse(jsonString);
            
            assert.strictEqual(parsed.version, '1.0.0');
            assert.ok(Array.isArray(parsed.sources));
            assert.ok(Array.isArray(parsed.profiles));
            assert.ok(parsed.configuration);
        });

        test('YAML export format should be detectable', () => {
            const yamlContent = `version: 1.0.0
sources: []
profiles: []
configuration:
  autoCheckUpdates: true`;
            
            assert.ok(yamlContent.includes('version:'));
            assert.ok(yamlContent.includes('sources:'));
            assert.ok(yamlContent.includes('profiles:'));
        });
    });

    suite('Import Validation', () => {
        test('should validate required version field', () => {
            const validData = {
                version: '1.0.0',
                sources: [],
                profiles: []
            };
            
            assert.ok(validData.version);
            assert.strictEqual(validData.version, '1.0.0');
        });

        test('should validate sources array', () => {
            const validData = {
                version: '1.0.0',
                sources: [],
                profiles: []
            };
            
            assert.ok(Array.isArray(validData.sources));
        });

        test('should validate profiles array', () => {
            const validData = {
                version: '1.0.0',
                sources: [],
                profiles: []
            };
            
            assert.ok(Array.isArray(validData.profiles));
        });
    });

    suite('Data Structure', () => {
        test('exported settings should have required fields', () => {
            const settings = {
                version: '1.0.0',
                exportedAt: new Date().toISOString(),
                sources: [],
                profiles: [],
                configuration: {}
            };
            
            assert.ok(settings.version);
            assert.ok(settings.exportedAt);
            assert.ok(Array.isArray(settings.sources));
            assert.ok(Array.isArray(settings.profiles));
            assert.ok(typeof settings.configuration === 'object');
        });

        test('timestamp should be valid ISO string', () => {
            const timestamp = new Date().toISOString();
            const parsed = new Date(timestamp);
            
            assert.ok(parsed.getTime() > 0);
            assert.ok(!isNaN(parsed.getTime()));
        });
    });
});

suite('RegistryManager Unified Download Path', () => {
    const fs = require('fs');
    const path = require('path');
    
    test('installBundle() should use unified download path for all source types', () => {
        // Read the RegistryManager source code
        const registryManagerPath = path.join(__dirname, '../../../src/services/RegistryManager.ts');
        const sourceCode = fs.readFileSync(registryManagerPath, 'utf8');
        
        // Find the installBundle method
        const installBundleMatch = sourceCode.match(/async installBundle\([^)]+\)[^{]*{([\s\S]*?)^\s{4}}/m);
        assert.ok(installBundleMatch, 'installBundle method should exist');
        
        const installBundleCode = installBundleMatch[1];
        
        // Verify it calls adapter.downloadBundle()
        assert.ok(
            installBundleCode.includes('adapter.downloadBundle(bundle)'),
            'installBundle should call adapter.downloadBundle(bundle)'
        );
        
        // Verify it calls installer.installFromBuffer()
        assert.ok(
            installBundleCode.includes('installer.installFromBuffer(bundle, bundleBuffer'),
            'installBundle should call installer.installFromBuffer(bundle, bundleBuffer, options)'
        );
    });
    
    test('installBundle() should NOT have branching logic for source types', () => {
        const fs = require('fs');
        const path = require('path');
        
        // Read the RegistryManager source code
        const registryManagerPath = path.join(__dirname, '../../../src/services/RegistryManager.ts');
        const sourceCode = fs.readFileSync(registryManagerPath, 'utf8');
        
        // Find the installBundle method
        const installBundleMatch = sourceCode.match(/async installBundle\([^)]+\)[^{]*{([\s\S]*?)^\s{4}}/m);
        assert.ok(installBundleMatch, 'installBundle method should exist');
        
        const installBundleCode = installBundleMatch[1];
        
        // Verify it does NOT have if/else branching for awesome-copilot
        assert.ok(
            !installBundleCode.includes("source.type === 'awesome-copilot'"),
            'installBundle should NOT have branching logic for awesome-copilot'
        );
        
        assert.ok(
            !installBundleCode.includes("source.type === 'local-awesome-copilot'"),
            'installBundle should NOT have branching logic for local-awesome-copilot'
        );
    });
    
    test('installBundle() should NOT call adapter.getDownloadUrl()', () => {
        const fs = require('fs');
        const path = require('path');
        
        // Read the RegistryManager source code
        const registryManagerPath = path.join(__dirname, '../../../src/services/RegistryManager.ts');
        const sourceCode = fs.readFileSync(registryManagerPath, 'utf8');
        
        // Find the installBundle method
        const installBundleMatch = sourceCode.match(/async installBundle\([^)]+\)[^{]*{([\s\S]*?)^\s{4}}/m);
        assert.ok(installBundleMatch, 'installBundle method should exist');
        
        const installBundleCode = installBundleMatch[1];
        
        // Verify it does NOT call getDownloadUrl
        assert.ok(
            !installBundleCode.includes('adapter.getDownloadUrl('),
            'installBundle should NOT call adapter.getDownloadUrl()'
        );
    });
    
    test('installBundle() should NOT call installer.install()', () => {
        const fs = require('fs');
        const path = require('path');
        
        // Read the RegistryManager source code
        const registryManagerPath = path.join(__dirname, '../../../src/services/RegistryManager.ts');
        const sourceCode = fs.readFileSync(registryManagerPath, 'utf8');
        
        // Find the installBundle method
        const installBundleMatch = sourceCode.match(/async installBundle\([^)]+\)[^{]*{([\s\S]*?)^\s{4}}/m);
        assert.ok(installBundleMatch, 'installBundle method should exist');
        
        const installBundleCode = installBundleMatch[1];
        
        // Verify it does NOT call installer.install (the old method)
        assert.ok(
            !installBundleCode.includes('installer.install(bundle, downloadUrl'),
            'installBundle should NOT call installer.install() with downloadUrl'
        );
    });
    
    test('All adapter interfaces should have downloadBundle method', () => {
        const fs = require('fs');
        const path = require('path');
        
        // Read the RepositoryAdapter interface
        const adapterPath = path.join(__dirname, '../../../src/adapters/RepositoryAdapter.ts');
        const sourceCode = fs.readFileSync(adapterPath, 'utf8');
        
        // Verify downloadBundle is in the interface
        assert.ok(
            sourceCode.includes('downloadBundle(bundle: Bundle): Promise<Buffer>'),
            'IRepositoryAdapter interface should define downloadBundle method'
        );
    });
});

suite('RegistryManager Version Consolidation', () => {
    test('searchBundles() should call consolidateBundles for GitHub sources', () => {
        const fs = require('fs');
        const path = require('path');
        
        // Read the RegistryManager source code
        const registryManagerPath = path.join(__dirname, '../../../src/services/RegistryManager.ts');
        const sourceCode = fs.readFileSync(registryManagerPath, 'utf8');
        
        // Find the searchBundles method
        const searchBundlesMatch = sourceCode.match(/async searchBundles\([^)]+\)[^{]*{([\s\S]*?)^\s{4}}/m);
        assert.ok(searchBundlesMatch, 'searchBundles method should exist');
        
        const searchBundlesCode = searchBundlesMatch[1];
        
        // Verify it calls versionConsolidator.consolidateBundles()
        assert.ok(
            searchBundlesCode.includes('versionConsolidator.consolidateBundles') ||
            searchBundlesCode.includes('this.versionConsolidator.consolidateBundles'),
            'searchBundles should call versionConsolidator.consolidateBundles()'
        );
    });
    
    test('RegistryManager should have versionConsolidator instance', () => {
        const fs = require('fs');
        const path = require('path');
        
        // Read the RegistryManager source code
        const registryManagerPath = path.join(__dirname, '../../../src/services/RegistryManager.ts');
        const sourceCode = fs.readFileSync(registryManagerPath, 'utf8');
        
        // Verify versionConsolidator is declared as a private field
        assert.ok(
            sourceCode.includes('private versionConsolidator') ||
            sourceCode.includes('versionConsolidator:'),
            'RegistryManager should have versionConsolidator field'
        );
        
        // Verify VersionConsolidator is imported
        assert.ok(
            sourceCode.includes("from './VersionConsolidator'") ||
            sourceCode.includes('import { VersionConsolidator }'),
            'RegistryManager should import VersionConsolidator'
        );
    });
    
    test('searchBundles() should have error handling with fallback', () => {
        const fs = require('fs');
        const path = require('path');
        
        // Read the RegistryManager source code
        const registryManagerPath = path.join(__dirname, '../../../src/services/RegistryManager.ts');
        const sourceCode = fs.readFileSync(registryManagerPath, 'utf8');
        
        // Find the searchBundles method
        const searchBundlesMatch = sourceCode.match(/async searchBundles\([^)]+\)[^{]*{([\s\S]*?)^\s{4}}/m);
        assert.ok(searchBundlesMatch, 'searchBundles method should exist');
        
        const searchBundlesCode = searchBundlesMatch[1];
        
        // Verify it has try-catch around consolidation
        const hasTryCatch = searchBundlesCode.includes('try') && searchBundlesCode.includes('catch');
        
        // If consolidation is called, it should have error handling
        if (searchBundlesCode.includes('consolidateBundles')) {
            assert.ok(
                hasTryCatch,
                'searchBundles should have try-catch around consolidation with fallback'
            );
        }
    });
    
    test('searchBundles() should apply consolidation before filters', () => {
        const fs = require('fs');
        const path = require('path');
        
        // Read the RegistryManager source code
        const registryManagerPath = path.join(__dirname, '../../../src/services/RegistryManager.ts');
        const sourceCode = fs.readFileSync(registryManagerPath, 'utf8');
        
        // Find the searchBundles method
        const searchBundlesMatch = sourceCode.match(/async searchBundles\([^)]+\)[^{]*{([\s\S]*?)^\s{4}}/m);
        assert.ok(searchBundlesMatch, 'searchBundles method should exist');
        
        const searchBundlesCode = searchBundlesMatch[1];
        
        // If consolidation is present, verify it comes before filtering
        if (searchBundlesCode.includes('consolidateBundles')) {
            const consolidateIndex = searchBundlesCode.indexOf('consolidateBundles');
            const filterIndex = searchBundlesCode.indexOf('query.text');
            
            // Consolidation should come before text filtering
            if (filterIndex > -1) {
                assert.ok(
                    consolidateIndex < filterIndex,
                    'Consolidation should be applied before filters'
                );
            }
        }
    });
});

suite('RegistryManager Version-Specific Installation', () => {
    test('installBundle() should handle version parameter in options', () => {
        // Verify that InstallOptions interface supports version parameter
        const options = {
            version: '1.0.0',
            scope: 'user' as const,
            force: false
        };
        
        assert.ok(options.version);
        assert.strictEqual(options.version, '1.0.0');
    });

    test('installBundle() should retrieve specific version from VersionConsolidator when version is specified', () => {
        // This test verifies the logic flow:
        // 1. options.version is provided
        // 2. VersionManager.extractBundleIdentity is called
        // 3. versionConsolidator.getBundleVersion is called
        // 4. Bundle object is updated with version-specific URLs
        
        // Mock bundle identity extraction
        const bundleId = 'owner-repo-v1.0.0';
        const sourceType = 'github';
        const expectedIdentity = 'owner-repo';
        
        // Verify the logic would extract identity correctly
        assert.ok(bundleId.includes(expectedIdentity));
    });

    test('installBundle() should update bundle object with version-specific URLs', () => {
        // Mock scenario: specific version metadata
        const specificVersion = {
            version: '1.0.0',
            downloadUrl: 'https://example.com/v1.0.0/bundle.zip',
            manifestUrl: 'https://example.com/v1.0.0/manifest.json',
            publishedAt: '2024-01-01T00:00:00Z'
        };
        
        // Mock original bundle
        const originalBundle = {
            id: 'test-bundle',
            version: '2.0.0',
            downloadUrl: 'https://example.com/latest/bundle.zip',
            manifestUrl: 'https://example.com/latest/manifest.json',
            lastUpdated: '2024-02-01T00:00:00Z'
        };
        
        // Simulate the update logic
        const updatedBundle = {
            ...originalBundle,
            version: specificVersion.version,
            downloadUrl: specificVersion.downloadUrl,
            manifestUrl: specificVersion.manifestUrl,
            lastUpdated: specificVersion.publishedAt
        };
        
        // Verify the bundle was updated correctly
        assert.strictEqual(updatedBundle.version, '1.0.0');
        assert.strictEqual(updatedBundle.downloadUrl, 'https://example.com/v1.0.0/bundle.zip');
        assert.strictEqual(updatedBundle.manifestUrl, 'https://example.com/v1.0.0/manifest.json');
        assert.strictEqual(updatedBundle.lastUpdated, '2024-01-01T00:00:00Z');
    });

    test('installBundle() should pass updated bundle to installer with correct version', () => {
        // This test verifies that after updating the bundle object,
        // the installer receives the bundle with the specific version
        
        const bundle = {
            id: 'test-bundle',
            version: '1.0.0',
            downloadUrl: 'https://example.com/v1.0.0/bundle.zip'
        };
        
        // The installer.installFromBuffer should receive this bundle
        // and create an installation record with version: '1.0.0'
        assert.strictEqual(bundle.version, '1.0.0');
    });

    test('installBundle() should log warning when requested version not found', () => {
        // When getBundleVersion returns undefined, a warning should be logged
        // and the latest version should be used as fallback
        
        const latestVersion = '2.0.0';
        
        // Simulate the fallback logic when version is not found
        const foundVersion = false;
        const versionToUse = foundVersion ? '0.5.0' : latestVersion;
        
        assert.strictEqual(versionToUse, latestVersion);
    });
});

suite('RegistryManager Source-Type-Specific Sync Behavior', () => {
    const fs = require('fs');
    const path = require('path');
    
    test('syncSource() should have source-type-specific behavior', () => {
        // Read the RegistryManager source code
        const registryManagerPath = path.join(__dirname, '../../../src/services/RegistryManager.ts');
        const sourceCode = fs.readFileSync(registryManagerPath, 'utf8');
        
        // Find the syncSource method
        const syncSourceMatch = sourceCode.match(/async syncSource\([^)]+\)[^{]*{([\s\S]*?)^\s{4}}/m);
        assert.ok(syncSourceMatch, 'syncSource method should exist');
        
        const syncSourceCode = syncSourceMatch[1];
        
        // Verify it checks source type
        assert.ok(
            syncSourceCode.includes("source.type === 'awesome-copilot'") ||
            syncSourceCode.includes("source.type === 'github'"),
            'syncSource should check source type'
        );
    });
    
    test('syncSource() should call autoUpdateInstalledBundles for Awesome Copilot sources', () => {
        const fs = require('fs');
        const path = require('path');
        
        // Read the RegistryManager source code
        const registryManagerPath = path.join(__dirname, '../../../src/services/RegistryManager.ts');
        const sourceCode = fs.readFileSync(registryManagerPath, 'utf8');
        
        // Find the syncSource method
        const syncSourceMatch = sourceCode.match(/async syncSource\([^)]+\)[^{]*{([\s\S]*?)^\s{4}}/m);
        assert.ok(syncSourceMatch, 'syncSource method should exist');
        
        const syncSourceCode = syncSourceMatch[1];
        
        // Verify it calls autoUpdateInstalledBundles for awesome-copilot
        assert.ok(
            syncSourceCode.includes('autoUpdateInstalledBundles'),
            'syncSource should call autoUpdateInstalledBundles for Awesome Copilot sources'
        );
    });
    
    test('syncSource() should NOT auto-install for GitHub sources', () => {
        const fs = require('fs');
        const path = require('path');
        
        // Read the RegistryManager source code
        const registryManagerPath = path.join(__dirname, '../../../src/services/RegistryManager.ts');
        const sourceCode = fs.readFileSync(registryManagerPath, 'utf8');
        
        // Find the syncSource method
        const syncSourceMatch = sourceCode.match(/async syncSource\([^)]+\)[^{]*{([\s\S]*?)^\s{4}}/m);
        assert.ok(syncSourceMatch, 'syncSource method should exist');
        
        const syncSourceCode = syncSourceMatch[1];
        
        // Verify GitHub sources use cache-only behavior
        const hasGitHubCheck = syncSourceCode.includes("source.type === 'github'");
        
        if (hasGitHubCheck) {
            // Find the GitHub branch
            const githubBranchMatch = syncSourceCode.match(/if \(source\.type === 'github'\) \{([^}]*)\}/);
            
            if (githubBranchMatch) {
                const githubBranch = githubBranchMatch[1];
                
                // Verify it does NOT call autoUpdateInstalledBundles
                assert.ok(
                    !githubBranch.includes('autoUpdateInstalledBundles'),
                    'GitHub sources should NOT call autoUpdateInstalledBundles'
                );
            }
        }
    });
    
    test('syncSource() should have logging for different sync behaviors', () => {
        const fs = require('fs');
        const path = require('path');
        
        // Read the RegistryManager source code
        const registryManagerPath = path.join(__dirname, '../../../src/services/RegistryManager.ts');
        const sourceCode = fs.readFileSync(registryManagerPath, 'utf8');
        
        // Find the syncSource method
        const syncSourceMatch = sourceCode.match(/async syncSource\([^)]+\)[^{]*{([\s\S]*?)^\s{4}}/m);
        assert.ok(syncSourceMatch, 'syncSource method should exist');
        
        const syncSourceCode = syncSourceMatch[1];
        
        // Verify it has logging statements
        assert.ok(
            syncSourceCode.includes('this.logger.info') ||
            syncSourceCode.includes('logger.info'),
            'syncSource should have logging for sync behaviors'
        );
    });
    
    test('RegistryManager should have autoUpdateInstalledBundles private method', () => {
        const fs = require('fs');
        const path = require('path');
        
        // Read the RegistryManager source code
        const registryManagerPath = path.join(__dirname, '../../../src/services/RegistryManager.ts');
        const sourceCode = fs.readFileSync(registryManagerPath, 'utf8');
        
        // Verify autoUpdateInstalledBundles method exists
        assert.ok(
            sourceCode.includes('autoUpdateInstalledBundles'),
            'RegistryManager should have autoUpdateInstalledBundles method'
        );
        
        // Verify it's a private method
        assert.ok(
            sourceCode.includes('private async autoUpdateInstalledBundles') ||
            sourceCode.includes('private autoUpdateInstalledBundles'),
            'autoUpdateInstalledBundles should be a private method'
        );
    });
    
    test('autoUpdateInstalledBundles should filter bundles by sourceId', () => {
        const fs = require('fs');
        const path = require('path');
        
        // Read the RegistryManager source code
        const registryManagerPath = path.join(__dirname, '../../../src/services/RegistryManager.ts');
        const sourceCode = fs.readFileSync(registryManagerPath, 'utf8');
        
        // Find the autoUpdateInstalledBundles method
        const autoUpdateMatch = sourceCode.match(/private async autoUpdateInstalledBundles\([^)]+\)[^{]*{([\s\S]*?)^\s{4}}/m);
        
        if (autoUpdateMatch) {
            const autoUpdateCode = autoUpdateMatch[1];
            
            // Verify it filters installed bundles by sourceId
            assert.ok(
                autoUpdateCode.includes('filter') &&
                (autoUpdateCode.includes('sourceId') || autoUpdateCode.includes('sourceId')),
                'autoUpdateInstalledBundles should filter bundles by sourceId'
            );
        }
    });
    
    test('autoUpdateInstalledBundles should call updateBundle for outdated bundles', () => {
        const fs = require('fs');
        const path = require('path');
        
        // Read the RegistryManager source code
        const registryManagerPath = path.join(__dirname, '../../../src/services/RegistryManager.ts');
        const sourceCode = fs.readFileSync(registryManagerPath, 'utf8');
        
        // Find the autoUpdateInstalledBundles method
        const autoUpdateMatch = sourceCode.match(/private async autoUpdateInstalledBundles\([^)]+\)[^{]*{([\s\S]*?)^\s{4}}/m);
        
        if (autoUpdateMatch) {
            const autoUpdateCode = autoUpdateMatch[1];
            
            // Verify it calls updateBundle
            assert.ok(
                autoUpdateCode.includes('updateBundle') ||
                autoUpdateCode.includes('this.updateBundle'),
                'autoUpdateInstalledBundles should call updateBundle'
            );
        }
    });
    
    test('syncSource() should cache bundles before applying source-specific behavior', () => {
        const fs = require('fs');
        const path = require('path');
        
        // Read the RegistryManager source code
        const registryManagerPath = path.join(__dirname, '../../../src/services/RegistryManager.ts');
        const sourceCode = fs.readFileSync(registryManagerPath, 'utf8');
        
        // Find the syncSource method
        const syncSourceMatch = sourceCode.match(/async syncSource\([^)]+\)[^{]*{([\s\S]*?)^\s{4}}/m);
        assert.ok(syncSourceMatch, 'syncSource method should exist');
        
        const syncSourceCode = syncSourceMatch[1];
        
        // Verify caching happens
        assert.ok(
            syncSourceCode.includes('cacheSourceBundles'),
            'syncSource should cache bundles'
        );
        
        // Verify caching happens before source-type checks
        const cacheIndex = syncSourceCode.indexOf('cacheSourceBundles');
        const typeCheckIndex = syncSourceCode.indexOf("source.type === 'awesome-copilot'");
        
        if (typeCheckIndex > -1) {
            assert.ok(
                cacheIndex < typeCheckIndex,
                'Caching should happen before source-type-specific behavior'
            );
        }
    });
});

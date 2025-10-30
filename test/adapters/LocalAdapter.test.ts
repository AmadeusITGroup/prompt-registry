/**
 * LocalAdapter Unit Tests
 */

import * as assert from 'assert';
import * as path from 'path';
import { LocalAdapter } from '../../src/adapters/LocalAdapter';
import { RegistrySource } from '../../src/types/registry';

suite('LocalAdapter', () => {
    const fixturesPath = path.join(__dirname, '../fixtures/local-library');
    
    const mockSource: RegistrySource = {
        id: 'test-local',
        name: 'Test Local',
        type: 'local',
        url: fixturesPath,
        enabled: true,
        priority: 1,
    };

    suite('Constructor and Validation', () => {
        test('should accept valid local path', () => {
            const adapter = new LocalAdapter(mockSource);
            assert.strictEqual(adapter.type, 'local');
        });

        test('should accept file:// URL', () => {
            const source = { ...mockSource, url: `file://${fixturesPath}` };
            const adapter = new LocalAdapter(source);
            assert.ok(adapter);
        });

        test('should throw error for invalid path format', () => {
            const source = { ...mockSource, url: 'http://invalid.com/path' };
            assert.throws(() => new LocalAdapter(source), /Invalid local path/);
        });
    });

    suite('fetchMetadata', () => {
        test('should fetch local registry metadata', async () => {
            const adapter = new LocalAdapter(mockSource);
            const metadata = await adapter.fetchMetadata();

            assert.ok(metadata);
            assert.strictEqual(typeof metadata.name, 'string');
            assert.strictEqual(typeof metadata.description, 'string');
            assert.strictEqual(typeof metadata.bundleCount, 'number');
            assert.ok(metadata.bundleCount >= 0);
        });

        test('should report correct bundle count', async () => {
            const adapter = new LocalAdapter(mockSource);
            const metadata = await adapter.fetchMetadata();

            // We have 9 bundles in fixtures
            assert.strictEqual(metadata.bundleCount, 9);
        });

        test('should throw error for non-existent directory', async () => {
            const source = { ...mockSource, url: '/non/existent/path' };
            const adapter = new LocalAdapter(source);

            await assert.rejects(
                () => adapter.fetchMetadata(),
                /Directory does not exist/
            );
        });
    });

    suite('fetchBundles', () => {
        test('should discover all bundles with manifests', async () => {
            const adapter = new LocalAdapter(mockSource);
            const bundles = await adapter.fetchBundles();

            assert.ok(Array.isArray(bundles));
            assert.strictEqual(bundles.length, 9);

            // Check bundle IDs
            const bundleIds = bundles.map(b => b.id).sort();
            assert.deepStrictEqual(bundleIds, [
                'accessibility-bundle',
                'backend-bundle',
                'devops-bundle',
                'example-bundle',
                'example-bundle',
                'security-bundle',
                'testing-bundle',
                'testing-bundle',
                'web-dev-bundle'
            ]);
        });

        test('should parse YAML manifests correctly', async () => {
            const adapter = new LocalAdapter(mockSource);
            const bundles = await adapter.fetchBundles();

            const exampleBundle = bundles.find(b => b.id === 'example-bundle');
            assert.ok(exampleBundle);
            assert.strictEqual(exampleBundle.name, 'Example Prompt Bundle');
            assert.strictEqual(exampleBundle.version, '1.0.0');
            assert.strictEqual(exampleBundle.author, 'Prompt Registry Team');
            assert.ok(Array.isArray(exampleBundle.tags));
            assert.ok(exampleBundle.tags.includes('example'));
        });

        test('should include all bundle metadata', async () => {
            const adapter = new LocalAdapter(mockSource);
            const bundles = await adapter.fetchBundles();

            for (const bundle of bundles) {
                assert.ok(bundle.id);
                assert.ok(bundle.name);
                assert.ok(bundle.version);
                assert.ok(bundle.description);
                assert.ok(bundle.author);
                assert.strictEqual(bundle.sourceId, 'test-local');
                assert.ok(Array.isArray(bundle.environments));
                assert.ok(Array.isArray(bundle.tags));
                assert.ok(bundle.lastUpdated);
                assert.ok(bundle.downloadUrl);
                assert.ok(bundle.manifestUrl);
            }
        });

        test('should handle file:// URLs in download/manifest URLs', async () => {
            const adapter = new LocalAdapter(mockSource);
            const bundles = await adapter.fetchBundles();

            for (const bundle of bundles) {
                assert.ok(bundle.downloadUrl.startsWith('file://'));
                assert.ok(bundle.manifestUrl.startsWith('file://'));
            }
        });

        test('should skip directories without manifests', async () => {
            const adapter = new LocalAdapter(mockSource);
            const bundles = await adapter.fetchBundles();

            // Only bundles with deployment-manifest.yml should be included
            // README.md and other files should be ignored
            assert.ok(bundles.every(b => b.id));
        });
    });

    suite('validate', () => {
        test('should validate accessible local directory', async () => {
            const adapter = new LocalAdapter(mockSource);
            const result = await adapter.validate();

            assert.strictEqual(result.valid, true);
            assert.ok(Array.isArray(result.warnings));
        });

        test('should fail validation for non-existent directory', async () => {
            const source = { ...mockSource, url: '/non/existent/path' };
            const adapter = new LocalAdapter(source);
            const result = await adapter.validate();

            assert.strictEqual(result.valid, false);
            assert.ok(Array.isArray(result.errors));
            assert.ok(result.errors.length > 0);
        });
    });

    suite('getDownloadUrl', () => {
        test('should generate correct file:// URL for bundle', () => {
            const adapter = new LocalAdapter(mockSource);
            const url = adapter.getDownloadUrl('example-bundle', '1.0.0');

            assert.ok(url.startsWith('file://'));
            assert.ok(url.includes('example-bundle'));
        });
    });

    suite('getManifestUrl', () => {
        test('should generate correct manifest URL', () => {
            const adapter = new LocalAdapter(mockSource);
            const url = adapter.getManifestUrl('example-bundle', '1.0.0');

            assert.ok(url.startsWith('file://'));
            assert.ok(url.includes('example-bundle'));
            assert.ok(url.includes('deployment-manifest.yml'));
        });
    });

    suite('Diagnostics', () => {
        test('should log directory scanning details', async () => {
            const adapter = new LocalAdapter(mockSource);
            
            // Capture console output
            const logs: string[] = [];
            const originalLog = console.log;
            console.log = (...args: any[]) => {
                logs.push(args.join(' '));
                originalLog(...args);
            };

            try {
                await adapter.fetchBundles();
                
                // Check diagnostic logs were generated
                assert.ok(logs.some(log => log.includes('[LocalAdapter] Scanning directory')));
                assert.ok(logs.some(log => log.includes('[LocalAdapter] Found') && log.includes('entries')));
                assert.ok(logs.some(log => log.includes('[LocalAdapter] Discovered') && log.includes('valid bundles')));
            } finally {
                console.log = originalLog;
            }
        });
    });
});

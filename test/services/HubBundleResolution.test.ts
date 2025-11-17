/**
 * Hub Bundle Resolution Tests
 * Tests for resolving bundle references to downloadable sources
 */

import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import { HubStorage } from '../../src/storage/HubStorage';
import { HubManager } from '../../src/services/HubManager';
import { HubConfig } from '../../src/types/hub';

suite('Hub Bundle Resolution', () => {
    let storage: HubStorage;
    let hubManager: HubManager;
    let tempDir: string;

    const createHubWithSources = (): HubConfig => ({
        version: '1.0.0',
        metadata: {
            name: 'Test Hub',
            description: 'Test hub with sources',
            maintainer: 'Test',
            updatedAt: new Date().toISOString()
        },
        sources: [
            {
                id: 'github-source',
                name: 'GitHub Source',
                type: 'github',
                url: 'github:test/repo',
                enabled: true,
                priority: 1,
                metadata: {
                    description: 'GitHub bundle source'
                }
            },
            {
                id: 'url-source',
                name: 'URL Source',
                type: 'http',
                url: 'https://example.com/bundles',
                enabled: true,
                priority: 2,
                metadata: {
                    description: 'Direct URL source'
                }
            }
        ],
        profiles: [
            {
                id: 'test-profile',
                name: 'Test Profile',
                description: 'Profile with bundles',
                bundles: [
                    {
                        id: 'bundle-1',
                        version: '1.0.0',
                        source: 'github-source',
                        required: true
                    },
                    {
                        id: 'bundle-2',
                        version: '2.0.0',
                        source: 'url-source',
                        required: false
                    },
                    {
                        id: 'bundle-3',
                        version: 'latest',
                        source: 'github-source',
                        required: true
                    }
                ],
                icon: '📦',
                active: false,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            }
        ]
    });

    setup(() => {
        tempDir = path.join(__dirname, '../../test-temp-hub-bundle-resolution');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }
        storage = new HubStorage(tempDir);
        hubManager = new HubManager(storage, {} as any, process.cwd(), undefined, undefined);
    });

    teardown(() => {
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    suite('Source Resolution', () => {
        test('should resolve source by ID', async () => {
            const hub = createHubWithSources();
            await storage.saveHub('test-hub', hub, { type: 'github', location: 'test/hub' });

            const source = await hubManager.resolveSource('test-hub', 'github-source');

            assert.ok(source);
            assert.strictEqual(source.id, 'github-source');
            assert.strictEqual(source.type, 'github');
            assert.strictEqual(source.url, 'github:test/repo');
        });

        test('should throw error for non-existent source', async () => {
            const hub = createHubWithSources();
            await storage.saveHub('test-hub', hub, { type: 'github', location: 'test/hub' });

            await assert.rejects(
                async () => await hubManager.resolveSource('test-hub', 'non-existent'),
                (err: Error) => {
                    assert.ok(err.message.includes('Source not found'));
                    return true;
                }
            );
        });

        test('should handle disabled sources', async () => {
            const hub = createHubWithSources();
            hub.sources[0].enabled = false;
            await storage.saveHub('test-hub', hub, { type: 'github', location: 'test/hub' });

            const source = await hubManager.resolveSource('test-hub', 'github-source');
            assert.strictEqual(source.enabled, false);
        });
    });

    suite('Bundle URL Resolution', () => {
        test('should resolve GitHub bundle URL', async () => {
            const hub = createHubWithSources();
            await storage.saveHub('test-hub', hub, { type: 'github', location: 'test/hub' });

            const url = await hubManager.resolveBundleUrl('test-hub', {
                id: 'bundle-1',
                version: '1.0.0',
                source: 'github-source',
                required: true
            });

            assert.ok(url);
            assert.ok(url.includes('bundle-1'));
        });

        test('should resolve URL source bundle URL', async () => {
            const hub = createHubWithSources();
            await storage.saveHub('test-hub', hub, { type: 'github', location: 'test/hub' });

            const url = await hubManager.resolveBundleUrl('test-hub', {
                id: 'bundle-2',
                version: '2.0.0',
                source: 'url-source',
                required: false
            });

            assert.ok(url);
            assert.ok(url.includes('bundle-2'));
        });

        test('should handle latest version', async () => {
            const hub = createHubWithSources();
            await storage.saveHub('test-hub', hub, { type: 'github', location: 'test/hub' });

            const url = await hubManager.resolveBundleUrl('test-hub', {
                id: 'bundle-3',
                version: 'latest',
                source: 'github-source',
                required: true
            });

            assert.ok(url);
            // Latest should resolve to a valid URL
        });

        test('should throw error for invalid source in bundle', async () => {
            const hub = createHubWithSources();
            await storage.saveHub('test-hub', hub, { type: 'github', location: 'test/hub' });

            await assert.rejects(
                async () => await hubManager.resolveBundleUrl('test-hub', {
                    id: 'bundle-x',
                    version: '1.0.0',
                    source: 'non-existent-source',
                    required: true
                }),
                (err: Error) => {
                    assert.ok(err.message.includes('Source not found'));
                    return true;
                }
            );
        });
    });

    suite('Profile Bundle Resolution', () => {
        test('should resolve all bundles in profile', async () => {
            const hub = createHubWithSources();
            await storage.saveHub('test-hub', hub, { type: 'github', location: 'test/hub' });

            const resolved = await hubManager.resolveProfileBundles('test-hub', 'test-profile');

            assert.strictEqual(resolved.length, 3);
            assert.ok(resolved.every(b => b.url));
            assert.ok(resolved.every(b => b.bundle));
        });

        test('should include bundle metadata in resolution', async () => {
            const hub = createHubWithSources();
            await storage.saveHub('test-hub', hub, { type: 'github', location: 'test/hub' });

            const resolved = await hubManager.resolveProfileBundles('test-hub', 'test-profile');

            const bundle1 = resolved.find(r => r.bundle.id === 'bundle-1');
            assert.ok(bundle1);
            assert.strictEqual(bundle1.bundle.version, '1.0.0');
            assert.strictEqual(bundle1.bundle.required, true);
            assert.strictEqual(bundle1.bundle.source, 'github-source');
        });

        test('should handle profile with no bundles', async () => {
            const hub = createHubWithSources();
            hub.profiles[0].bundles = [];
            await storage.saveHub('test-hub', hub, { type: 'github', location: 'test/hub' });

            const resolved = await hubManager.resolveProfileBundles('test-hub', 'test-profile');

            assert.strictEqual(resolved.length, 0);
        });

        test('should throw error for non-existent profile', async () => {
            const hub = createHubWithSources();
            await storage.saveHub('test-hub', hub, { type: 'github', location: 'test/hub' });

            await assert.rejects(
                async () => await hubManager.resolveProfileBundles('test-hub', 'non-existent'),
                (err: Error) => {
                    assert.ok(err.message.includes('Profile not found'));
                    return true;
                }
            );
        });
    });

    suite('Required vs Optional Bundles', () => {
        test('should identify required bundles', async () => {
            const hub = createHubWithSources();
            await storage.saveHub('test-hub', hub, { type: 'github', location: 'test/hub' });

            const resolved = await hubManager.resolveProfileBundles('test-hub', 'test-profile');
            const required = resolved.filter(r => r.bundle.required);

            assert.strictEqual(required.length, 2);
            assert.ok(required.some(r => r.bundle.id === 'bundle-1'));
            assert.ok(required.some(r => r.bundle.id === 'bundle-3'));
        });

        test('should identify optional bundles', async () => {
            const hub = createHubWithSources();
            await storage.saveHub('test-hub', hub, { type: 'github', location: 'test/hub' });

            const resolved = await hubManager.resolveProfileBundles('test-hub', 'test-profile');
            const optional = resolved.filter(r => !r.bundle.required);

            assert.strictEqual(optional.length, 1);
            assert.strictEqual(optional[0].bundle.id, 'bundle-2');
        });
    });

    suite('Source Priority', () => {
        test('should include source priority in resolution', async () => {
            const hub = createHubWithSources();
            await storage.saveHub('test-hub', hub, { type: 'github', location: 'test/hub' });

            const resolved = await hubManager.resolveProfileBundles('test-hub', 'test-profile');

            // Check that source priority is accessible
            const bundle1 = resolved.find(r => r.bundle.id === 'bundle-1');
            assert.ok(bundle1);
            
            const source1 = await hubManager.resolveSource('test-hub', bundle1.bundle.source);
            assert.strictEqual(source1.priority, 1);
        });

        test('should handle multiple sources with different priorities', async () => {
            const hub = createHubWithSources();
            await storage.saveHub('test-hub', hub, { type: 'github', location: 'test/hub' });

            const source1 = await hubManager.resolveSource('test-hub', 'github-source');
            const source2 = await hubManager.resolveSource('test-hub', 'url-source');

            assert.strictEqual(source1.priority, 1);
            assert.strictEqual(source2.priority, 2);
            assert.ok(source2.priority > source1.priority);
        });
    });

    suite('Bundle Resolution Error Handling', () => {
        test('should handle disabled source gracefully', async () => {
            const hub = createHubWithSources();
            hub.sources[0].enabled = false;
            await storage.saveHub('test-hub', hub, { type: 'github', location: 'test/hub' });

            // Should still resolve but mark source as disabled
            const source = await hubManager.resolveSource('test-hub', 'github-source');
            assert.strictEqual(source.enabled, false);
        });

        test('should throw error for bundle with missing source reference', async () => {
            const hub = createHubWithSources();
            hub.profiles[0].bundles[0].source = 'missing-source';
            await storage.saveHub('test-hub', hub, { type: 'github', location: 'test/hub' });

            await assert.rejects(
                async () => await hubManager.resolveProfileBundles('test-hub', 'test-profile')
            );
        });
    });
});

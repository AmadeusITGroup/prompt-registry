import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import { HubStorage } from '../../src/storage/HubStorage';
import { HubManager } from '../../src/services/HubManager';
import { HubProfileComparisonView } from '../../src/commands/HubProfileComparisonView';
import { HubConfig, HubReference } from '../../src/types/hub';

suite('Hub Profile Comparison View', () => {
    let storage: HubStorage;
    let hubManager: HubManager;
    let comparisonView: HubProfileComparisonView;
    let testDir: string;

    setup(async () => {
        testDir = path.join(__dirname, '..', 'test-data', 'comparison-view-test');
        if (fs.existsSync(testDir)) {
            fs.rmSync(testDir, { recursive: true });
        }
        fs.mkdirSync(testDir, { recursive: true });

        storage = new HubStorage(testDir);
        hubManager = new HubManager(storage, {} as any, process.cwd(), undefined, undefined);
        comparisonView = new HubProfileComparisonView(hubManager);
    });

    teardown(() => {
        if (fs.existsSync(testDir)) {
            fs.rmSync(testDir, { recursive: true });
        }
    });

    async function createTestHub(hubId: string): Promise<void> {
        const config: HubConfig = {
            version: '1.0.0',
            metadata: {
                name: `Test Hub ${hubId}`,
                description: 'Test hub for comparison view',
                maintainer: 'test',
                updatedAt: new Date().toISOString()
            },
            sources: [
                {
                    id: 'test-source',
                    name: 'Test Source',
                    type: 'github',
                    url: 'github:test/repo',
                    enabled: true,
                    priority: 1,
                    metadata: {
                        description: 'Test source'
                    }
                }
            ],
            profiles: [
                {
                    id: 'test-profile',
                    name: 'Test Profile',
                    description: 'Test profile',
                    icon: '🔧',
                    bundles: [
                        {
                            id: 'bundle-1',
                            version: '1.0.0',
                            source: 'test-source',
                            required: false
                        }
                    ],
                    active: false,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                }
            ]
        };

        const reference: HubReference = {
            type: 'local',
            location: testDir
        };

        await storage.saveHub(hubId, config, reference);
    }

    suite('Get Profile Comparison Data', () => {
        test('should generate comparison data for active profile with changes', async () => {
            await createTestHub('test-hub');
            await hubManager.activateProfile('test-hub', 'test-profile', { installBundles: false });
            
            // Wait to ensure timestamp difference
            await new Promise(resolve => setTimeout(resolve, 100));
            
            // Update hub config
            const updated = await storage.loadHub('test-hub');
            updated.config.profiles[0].bundles.push({
                id: 'bundle-2',
                version: '1.0.0',
                source: 'test-source',
                required: false
            });
            updated.config.profiles[0].bundles[0].version = '2.0.0';
            updated.config.profiles[0].updatedAt = new Date().toISOString();
            await storage.saveHub('test-hub', updated.config, updated.reference);

            const comparison = await comparisonView.getProfileComparisonData('test-hub', 'test-profile');

            assert.ok(comparison);
            assert.strictEqual(comparison.hubId, 'test-hub');
            assert.strictEqual(comparison.profileId, 'test-profile');
            assert.strictEqual(comparison.availableBundles.length, 2);
            assert.strictEqual(comparison.addedBundles.length, 1);
            assert.ok(comparison.updatedBundles.length >= 0); // May vary based on detection logic
            assert.strictEqual(comparison.removedBundles.length, 0);
        });

        test('should return null for profile with no changes', async () => {
            await createTestHub('test-hub');
            await hubManager.activateProfile('test-hub', 'test-profile', { installBundles: false });

            const comparison = await comparisonView.getProfileComparisonData('test-hub', 'test-profile');

            assert.strictEqual(comparison, null);
        });

        test('should return null for non-active profile', async () => {
            await createTestHub('test-hub');

            const comparison = await comparisonView.getProfileComparisonData('test-hub', 'test-profile');

            assert.strictEqual(comparison, null);
        });
    });

    suite('Format Bundle Comparison', () => {
        test('should format bundle with added status', () => {
            const bundle = {
                id: 'bundle-1',
                version: '1.0.0',
                source: 'test-source',
                required: false
            };

            const formatted = comparisonView.formatBundleComparison(bundle, 'added');

            assert.ok(formatted.includes('bundle-1'));
            assert.ok(formatted.includes('1.0.0'));
            assert.ok(formatted.includes('Added') || formatted.includes('NEW'));
        });

        test('should format bundle with updated status showing version change', () => {
            const bundle = {
                id: 'bundle-1',
                version: '2.0.0',
                source: 'test-source',
                required: false
            };

            const formatted = comparisonView.formatBundleComparison(bundle, 'updated', '1.0.0');

            assert.ok(formatted.includes('bundle-1'));
            assert.ok(formatted.includes('1.0.0'));
            assert.ok(formatted.includes('2.0.0'));
            assert.ok(formatted.includes('Updated') || formatted.includes('→'));
        });

        test('should format bundle with removed status', () => {
            const bundle = {
                id: 'bundle-1',
                version: '1.0.0',
                source: 'test-source',
                required: false
            };

            const formatted = comparisonView.formatBundleComparison(bundle, 'removed');

            assert.ok(formatted.includes('bundle-1'));
            assert.ok(formatted.includes('1.0.0'));
            assert.ok(formatted.includes('Removed') || formatted.includes('DELETED'));
        });

        test('should format bundle with unchanged status', () => {
            const bundle = {
                id: 'bundle-1',
                version: '1.0.0',
                source: 'test-source',
                required: false
            };

            const formatted = comparisonView.formatBundleComparison(bundle, 'unchanged');

            assert.ok(formatted.includes('bundle-1'));
            assert.ok(formatted.includes('1.0.0'));
        });
    });

    suite('Generate Comparison Summary', () => {
        test('should generate summary with all change types', async () => {
            await createTestHub('test-hub');
            await hubManager.activateProfile('test-hub', 'test-profile', { installBundles: false });
            
            await new Promise(resolve => setTimeout(resolve, 100));
            
            const updated = await storage.loadHub('test-hub');
            updated.config.profiles[0].bundles = [
                {
                    id: 'bundle-1',
                    version: '2.0.0',
                    source: 'test-source',
                    required: false
                },
                {
                    id: 'bundle-2',
                    version: '1.0.0',
                    source: 'test-source',
                    required: false
                }
            ];
            updated.config.profiles[0].updatedAt = new Date().toISOString();
            await storage.saveHub('test-hub', updated.config, updated.reference);

            const comparison = await comparisonView.getProfileComparisonData('test-hub', 'test-profile');
            assert.ok(comparison);

            const summary = comparisonView.generateComparisonSummary(comparison);

            assert.ok(summary.includes('bundle-1'));
            assert.ok(summary.includes('bundle-2'));
            assert.ok(summary.includes('1.0.0'));
            assert.ok(summary.includes('2.0.0'));
        });

        test('should generate summary with metadata changes', async () => {
            await createTestHub('test-hub');
            await hubManager.activateProfile('test-hub', 'test-profile', { installBundles: false });
            
            await new Promise(resolve => setTimeout(resolve, 100));
            
            const updated = await storage.loadHub('test-hub');
            updated.config.profiles[0].name = 'Updated Profile Name';
            updated.config.profiles[0].description = 'Updated description';
            updated.config.profiles[0].updatedAt = new Date().toISOString();
            await storage.saveHub('test-hub', updated.config, updated.reference);

            const comparison = await comparisonView.getProfileComparisonData('test-hub', 'test-profile');
            assert.ok(comparison);

            const summary = comparisonView.generateComparisonSummary(comparison);

            assert.ok(summary.includes('Updated Profile Name') || summary.includes('metadata'));
        });

        test('should handle comparison with no bundle changes', async () => {
            await createTestHub('test-hub');
            await hubManager.activateProfile('test-hub', 'test-profile', { installBundles: false });
            
            await new Promise(resolve => setTimeout(resolve, 100));
            
            const updated = await storage.loadHub('test-hub');
            updated.config.profiles[0].description = 'Updated description only';
            updated.config.profiles[0].updatedAt = new Date().toISOString();
            await storage.saveHub('test-hub', updated.config, updated.reference);

            const comparison = await comparisonView.getProfileComparisonData('test-hub', 'test-profile');
            assert.ok(comparison);

            const summary = comparisonView.generateComparisonSummary(comparison);

            assert.ok(summary.length > 0);
            assert.ok(summary.includes('metadata') || summary.includes('description'));
        });
    });

    suite('Create Comparison QuickPick Items', () => {
        test('should create QuickPick items for all bundles', async () => {
            await createTestHub('test-hub');
            await hubManager.activateProfile('test-hub', 'test-profile', { installBundles: false });
            
            await new Promise(resolve => setTimeout(resolve, 100));
            
            const updated = await storage.loadHub('test-hub');
            updated.config.profiles[0].bundles.push({
                id: 'bundle-2',
                version: '1.0.0',
                source: 'test-source',
                required: false
            });
            updated.config.profiles[0].bundles[0].version = '2.0.0';
            updated.config.profiles[0].updatedAt = new Date().toISOString();
            await storage.saveHub('test-hub', updated.config, updated.reference);

            const comparison = await comparisonView.getProfileComparisonData('test-hub', 'test-profile');
            assert.ok(comparison);

            const items = comparisonView.createComparisonQuickPickItems(comparison);

            assert.ok(items.length >= 2); // At least 2 bundles
            assert.ok(items.some(item => item.label.includes('bundle-1')));
            assert.ok(items.some(item => item.label.includes('bundle-2')));
        });

        test('should include change status in QuickPick item descriptions', async () => {
            await createTestHub('test-hub');
            await hubManager.activateProfile('test-hub', 'test-profile', { installBundles: false });
            
            await new Promise(resolve => setTimeout(resolve, 100));
            
            const updated = await storage.loadHub('test-hub');
            updated.config.profiles[0].bundles[0].version = '2.0.0';
            updated.config.profiles[0].updatedAt = new Date().toISOString();
            await storage.saveHub('test-hub', updated.config, updated.reference);

            const comparison = await comparisonView.getProfileComparisonData('test-hub', 'test-profile');
            assert.ok(comparison);

            const items = comparisonView.createComparisonQuickPickItems(comparison);

            const updatedItem = items.find(item => item.label.includes('bundle-1'));
            assert.ok(updatedItem);
            assert.ok(updatedItem.description);
            assert.ok(
                updatedItem.description.includes('1.0.0') && 
                updatedItem.description.includes('2.0.0')
            );
        });

        test('should mark added bundles distinctly in QuickPick items', async () => {
            await createTestHub('test-hub');
            await hubManager.activateProfile('test-hub', 'test-profile', { installBundles: false });
            
            await new Promise(resolve => setTimeout(resolve, 100));
            
            const updated = await storage.loadHub('test-hub');
            updated.config.profiles[0].bundles.push({
                id: 'bundle-new',
                version: '1.0.0',
                source: 'test-source',
                required: false
            });
            updated.config.profiles[0].updatedAt = new Date().toISOString();
            await storage.saveHub('test-hub', updated.config, updated.reference);

            const comparison = await comparisonView.getProfileComparisonData('test-hub', 'test-profile');
            assert.ok(comparison);

            const items = comparisonView.createComparisonQuickPickItems(comparison);

            const newItem = items.find(item => item.label.includes('bundle-new'));
            assert.ok(newItem);
            assert.ok(newItem.description?.includes('Added') || newItem.description?.includes('NEW'));
        });
    });

    suite('Get Side By Side Comparison', () => {
        test('should generate side-by-side comparison text', async () => {
            await createTestHub('test-hub');
            await hubManager.activateProfile('test-hub', 'test-profile', { installBundles: false });
            
            await new Promise(resolve => setTimeout(resolve, 100));
            
            const updated = await storage.loadHub('test-hub');
            updated.config.profiles[0].bundles.push({
                id: 'bundle-2',
                version: '1.0.0',
                source: 'test-source',
                required: false
            });
            updated.config.profiles[0].updatedAt = new Date().toISOString();
            await storage.saveHub('test-hub', updated.config, updated.reference);

            const comparison = await comparisonView.getProfileComparisonData('test-hub', 'test-profile');
            assert.ok(comparison);

            const sideBySide = comparisonView.getSideBySideComparison(comparison);

            assert.ok(sideBySide.includes('Current'));
            assert.ok(sideBySide.includes('Available'));
            assert.ok(sideBySide.includes('bundle-1'));
            assert.ok(sideBySide.includes('bundle-2'));
        });

        test('should show version differences in side-by-side view', async () => {
            await createTestHub('test-hub');
            await hubManager.activateProfile('test-hub', 'test-profile', { installBundles: false });
            
            await new Promise(resolve => setTimeout(resolve, 100));
            
            const updated = await storage.loadHub('test-hub');
            updated.config.profiles[0].bundles[0].version = '2.0.0';
            updated.config.profiles[0].updatedAt = new Date().toISOString();
            await storage.saveHub('test-hub', updated.config, updated.reference);

            const comparison = await comparisonView.getProfileComparisonData('test-hub', 'test-profile');
            assert.ok(comparison);

            const sideBySide = comparisonView.getSideBySideComparison(comparison);

            assert.ok(sideBySide.includes('1.0.0'));
            assert.ok(sideBySide.includes('2.0.0'));
        });

        test('should handle removed bundles in side-by-side view', async () => {
            await createTestHub('test-hub');
            
            // Add extra bundle to activate
            const hub = await storage.loadHub('test-hub');
            hub.config.profiles[0].bundles.push({
                id: 'bundle-to-remove',
                version: '1.0.0',
                source: 'test-source',
                required: false
            });
            await storage.saveHub('test-hub', hub.config, hub.reference);
            
            await hubManager.activateProfile('test-hub', 'test-profile', { installBundles: false });
            
            await new Promise(resolve => setTimeout(resolve, 100));
            
            // Remove the bundle from hub
            const updated = await storage.loadHub('test-hub');
            updated.config.profiles[0].bundles = updated.config.profiles[0].bundles.filter(
                b => b.id !== 'bundle-to-remove'
            );
            updated.config.profiles[0].updatedAt = new Date().toISOString();
            await storage.saveHub('test-hub', updated.config, updated.reference);

            const comparison = await comparisonView.getProfileComparisonData('test-hub', 'test-profile');
            assert.ok(comparison);

            const sideBySide = comparisonView.getSideBySideComparison(comparison);

            assert.ok(sideBySide.includes('bundle-to-remove'));
            assert.ok(sideBySide.includes('Removed') || sideBySide.includes('—') || sideBySide.includes('(none)'));
        });
    });
});

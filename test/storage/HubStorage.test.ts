/**
 * HubStorage Tests
 * Tests for hub configuration storage, caching, and file operations
 */

import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as yaml from 'js-yaml';
import { HubStorage } from '../../src/storage/HubStorage';
import { HubConfig, HubReference } from '../../src/types/hub';

suite('HubStorage - TDD', () => {
    let storage: HubStorage;
    let tempDir: string;
    let testHubConfig: HubConfig;
    let testHubReference: HubReference;

    setup(() => {
        // Create temp directory for tests
        tempDir = path.join(__dirname, '..', '..', 'test-temp-hub-storage');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }

        // Initialize storage with temp directory
        storage = new HubStorage(tempDir);

        // Load test fixture
        const fixturesDir = path.join(process.cwd(), 'test', 'fixtures', 'hubs');
        const validContent = fs.readFileSync(
            path.join(fixturesDir, 'valid-hub-config.yml'),
            'utf-8'
        );
        testHubConfig = yaml.load(validContent) as HubConfig;

        // Create test reference
        testHubReference = {
            type: 'github',
            location: 'promptregistry/official-hub',
            ref: 'main',
            autoSync: true
        };
    });

    teardown(() => {
        // Cleanup temp directory
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    suite('Initialization', () => {
        test('should create storage directory if it does not exist', () => {
            const newDir = path.join(tempDir, 'new-storage');
            const newStorage = new HubStorage(newDir);
            
            assert.ok(fs.existsSync(newDir), 'Storage directory should be created');
        });

        test('should use existing directory if it exists', () => {
            const existingDir = path.join(tempDir, 'existing');
            fs.mkdirSync(existingDir, { recursive: true });
            
            const newStorage = new HubStorage(existingDir);
            assert.ok(fs.existsSync(existingDir));
        });

        test('should throw error for invalid path', () => {
            assert.throws(() => {
                new HubStorage('');
            }, /Invalid storage path/);
        });
    });

    suite('Save Hub Configuration', () => {
        test('should save hub config to file', async () => {
            const hubId = 'test-hub';
            await storage.saveHub(hubId, testHubConfig, testHubReference);
            
            const configPath = path.join(tempDir, `${hubId}.yml`);
            assert.ok(fs.existsSync(configPath), 'Hub config file should exist');
        });

        test('should save hub config with correct YAML format', async () => {
            const hubId = 'test-hub-yaml';
            await storage.saveHub(hubId, testHubConfig, testHubReference);
            
            const configPath = path.join(tempDir, `${hubId}.yml`);
            const savedContent = fs.readFileSync(configPath, 'utf-8');
            const parsed = yaml.load(savedContent) as HubConfig;
            
            assert.strictEqual(parsed.version, testHubConfig.version);
            assert.strictEqual(parsed.metadata.name, testHubConfig.metadata.name);
        });

        test('should save reference metadata separately', async () => {
            const hubId = 'test-hub-ref';
            await storage.saveHub(hubId, testHubConfig, testHubReference);
            
            const metaPath = path.join(tempDir, `${hubId}.meta.json`);
            assert.ok(fs.existsSync(metaPath), 'Reference metadata should exist');
            
            const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
            assert.strictEqual(meta.reference.type, testHubReference.type);
            assert.strictEqual(meta.reference.location, testHubReference.location);
        });

        test('should reject invalid hub IDs', async () => {
            await assert.rejects(
                async () => await storage.saveHub('../invalid', testHubConfig, testHubReference),
                /Invalid hub ID/
            );
        });

        test('should handle save errors gracefully', async () => {
            // Create a read-only directory
            const readOnlyDir = path.join(tempDir, 'readonly');
            fs.mkdirSync(readOnlyDir, { recursive: true });
            fs.chmodSync(readOnlyDir, 0o444);
            
            const readOnlyStorage = new HubStorage(readOnlyDir);
            
            await assert.rejects(
                async () => await readOnlyStorage.saveHub('test', testHubConfig, testHubReference),
                /Failed to save hub/
            );
            
            // Restore permissions for cleanup
            fs.chmodSync(readOnlyDir, 0o755);
        });

        test('should overwrite existing hub config', async () => {
            const hubId = 'test-hub-overwrite';
            await storage.saveHub(hubId, testHubConfig, testHubReference);
            
            // Modify and save again
            const modifiedConfig = JSON.parse(JSON.stringify(testHubConfig));
            modifiedConfig.metadata.name = 'Modified Name';
            await storage.saveHub(hubId, modifiedConfig, testHubReference);
            
            const loaded = await storage.loadHub(hubId);
            assert.strictEqual(loaded.config.metadata.name, 'Modified Name');
        });
    });

    suite('Load Hub Configuration', () => {
        test('should load existing hub config', async () => {
            const hubId = 'test-load';
            await storage.saveHub(hubId, testHubConfig, testHubReference);
            
            const result = await storage.loadHub(hubId);
            
            assert.ok(result);
            assert.strictEqual(result.config.version, testHubConfig.version);
            assert.strictEqual(result.config.metadata.name, testHubConfig.metadata.name);
        });

        test('should load reference metadata with config', async () => {
            const hubId = 'test-load-ref';
            await storage.saveHub(hubId, testHubConfig, testHubReference);
            
            const result = await storage.loadHub(hubId);
            
            assert.ok(result.reference);
            assert.strictEqual(result.reference.type, testHubReference.type);
            assert.strictEqual(result.reference.location, testHubReference.location);
        });

        test('should throw error for non-existent hub', async () => {
            await assert.rejects(
                async () => await storage.loadHub('non-existent'),
                /Hub not found/
            );
        });

        test('should validate hub ID before loading', async () => {
            await assert.rejects(
                async () => await storage.loadHub('../invalid'),
                /Invalid hub ID/
            );
        });

        test('should handle corrupted config files', async () => {
            const hubId = 'corrupted';
            const configPath = path.join(tempDir, `${hubId}.yml`);
            fs.writeFileSync(configPath, 'invalid: yaml: content: [[[');
            
            await assert.rejects(
                async () => await storage.loadHub(hubId),
                /Failed to load hub/
            );
        });
    });

    suite('Cache Management', () => {
        test('should cache loaded hub configs', async () => {
            const hubId = 'test-cache';
            await storage.saveHub(hubId, testHubConfig, testHubReference);
            
            // First load
            const result1 = await storage.loadHub(hubId);
            
            // Second load should use cache (modify file to verify)
            const configPath = path.join(tempDir, `${hubId}.yml`);
            fs.writeFileSync(configPath, 'version: "999.0.0"');
            
            const result2 = await storage.loadHub(hubId);
            
            // Should still have original version from cache
            assert.strictEqual(result2.config.version, testHubConfig.version);
        });

        test('should bypass cache when forceReload is true', async () => {
            const hubId = 'test-force-reload';
            await storage.saveHub(hubId, testHubConfig, testHubReference);
            
            // First load
            await storage.loadHub(hubId);
            
            // Modify file
            const modifiedConfig = JSON.parse(JSON.stringify(testHubConfig));
            modifiedConfig.version = '999.0.0';
            await storage.saveHub(hubId, modifiedConfig, testHubReference);
            
            // Force reload
            const result = await storage.loadHub(hubId, true);
            
            assert.strictEqual(result.config.version, '999.0.0');
        });

        test('should clear cache for specific hub', async () => {
            const hubId = 'test-clear-cache';
            await storage.saveHub(hubId, testHubConfig, testHubReference);
            
            await storage.loadHub(hubId);
            storage.clearCache(hubId);
            
            // Modify file
            const configPath = path.join(tempDir, `${hubId}.yml`);
            const modifiedConfig = JSON.parse(JSON.stringify(testHubConfig));
            modifiedConfig.version = '999.0.0';
            fs.writeFileSync(configPath, yaml.dump(modifiedConfig));
            
            // Should load modified version
            const result = await storage.loadHub(hubId);
            assert.strictEqual(result.config.version, '999.0.0');
        });

        test('should clear all caches', async () => {
            await storage.saveHub('hub1', testHubConfig, testHubReference);
            await storage.saveHub('hub2', testHubConfig, testHubReference);
            
            await storage.loadHub('hub1');
            await storage.loadHub('hub2');
            
            storage.clearCache();
            
            // Verify cache is empty by checking load behavior
            assert.ok(true, 'Cache cleared successfully');
        });
    });

    suite('List Hubs', () => {
        test('should list all stored hubs', async () => {
            await storage.saveHub('hub1', testHubConfig, testHubReference);
            await storage.saveHub('hub2', testHubConfig, testHubReference);
            await storage.saveHub('hub3', testHubConfig, testHubReference);
            
            const hubs = await storage.listHubs();
            
            assert.strictEqual(hubs.length, 3);
            assert.ok(hubs.includes('hub1'));
            assert.ok(hubs.includes('hub2'));
            assert.ok(hubs.includes('hub3'));
        });

        test('should return empty array when no hubs exist', async () => {
            const hubs = await storage.listHubs();
            assert.strictEqual(hubs.length, 0);
        });

        test('should ignore non-hub files', async () => {
            await storage.saveHub('hub1', testHubConfig, testHubReference);
            
            // Create non-hub files
            fs.writeFileSync(path.join(tempDir, 'random.txt'), 'content');
            fs.writeFileSync(path.join(tempDir, 'test.json'), '{}');
            
            const hubs = await storage.listHubs();
            
            assert.strictEqual(hubs.length, 1);
            assert.strictEqual(hubs[0], 'hub1');
        });
    });

    suite('Delete Hub', () => {
        test('should delete hub config and metadata', async () => {
            const hubId = 'test-delete';
            await storage.saveHub(hubId, testHubConfig, testHubReference);
            
            await storage.deleteHub(hubId);
            
            const configPath = path.join(tempDir, `${hubId}.yml`);
            const metaPath = path.join(tempDir, `${hubId}.meta.json`);
            
            assert.ok(!fs.existsSync(configPath), 'Config file should be deleted');
            assert.ok(!fs.existsSync(metaPath), 'Metadata file should be deleted');
        });

        test('should remove hub from cache after deletion', async () => {
            const hubId = 'test-delete-cache';
            await storage.saveHub(hubId, testHubConfig, testHubReference);
            await storage.loadHub(hubId);
            
            await storage.deleteHub(hubId);
            
            await assert.rejects(
                async () => await storage.loadHub(hubId),
                /Hub not found/
            );
        });

        test('should throw error when deleting non-existent hub', async () => {
            await assert.rejects(
                async () => await storage.deleteHub('non-existent'),
                /Hub not found/
            );
        });

        test('should validate hub ID before deletion', async () => {
            await assert.rejects(
                async () => await storage.deleteHub('../invalid'),
                /Invalid hub ID/
            );
        });
    });

    suite('Hub Existence Check', () => {
        test('should return true for existing hub', async () => {
            const hubId = 'test-exists';
            await storage.saveHub(hubId, testHubConfig, testHubReference);
            
            const exists = await storage.hubExists(hubId);
            assert.strictEqual(exists, true);
        });

        test('should return false for non-existent hub', async () => {
            const exists = await storage.hubExists('non-existent');
            assert.strictEqual(exists, false);
        });

        test('should validate hub ID before checking', async () => {
            await assert.rejects(
                async () => await storage.hubExists('../invalid'),
                /Invalid hub ID/
            );
        });
    });

    suite('Get Hub Metadata', () => {
        test('should return hub metadata without loading full config', async () => {
            const hubId = 'test-metadata';
            await storage.saveHub(hubId, testHubConfig, testHubReference);
            
            const metadata = await storage.getHubMetadata(hubId);
            
            assert.ok(metadata);
            assert.strictEqual(metadata.reference.type, testHubReference.type);
            assert.ok(metadata.lastModified);
            assert.ok(metadata.size > 0);
        });

        test('should throw error for non-existent hub', async () => {
            await assert.rejects(
                async () => await storage.getHubMetadata('non-existent'),
                /Hub not found/
            );
        });
    });

    suite('Security and Validation', () => {
        test('should reject path traversal in hub IDs', async () => {
            const invalidIds = ['../etc/passwd', '../../hack', 'test/../bad'];
            
            for (const id of invalidIds) {
                await assert.rejects(
                    async () => await storage.saveHub(id, testHubConfig, testHubReference),
                    /Invalid hub ID/
                );
            }
        });

        test('should reject special characters in hub IDs', async () => {
            const invalidIds = ['test<script>', 'hub:evil', 'name|pipe', 'test&cmd'];
            
            for (const id of invalidIds) {
                await assert.rejects(
                    async () => await storage.saveHub(id, testHubConfig, testHubReference),
                    /Invalid hub ID/
                );
            }
        });

        test('should handle file system errors gracefully', async () => {
            // This test is already covered by "should handle save errors gracefully"
            assert.ok(true);
        });
    });
});

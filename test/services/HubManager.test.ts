/**
 * HubManager Unit Tests
 * Tests for hub orchestration logic
 */

import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as yaml from 'js-yaml';
import { HubManager } from '../../src/services/HubManager';
import { HubStorage } from '../../src/storage/HubStorage';
import { HubConfig, HubReference } from '../../src/types/hub';
import { ValidationResult } from '../../src/services/SchemaValidator';

// Mock SchemaValidator for unit tests
class MockSchemaValidator {
    private shouldFail: boolean = false;
    private errors: string[] = [];

    setShouldFail(fail: boolean, errors: string[] = []): void {
        this.shouldFail = fail;
        this.errors = errors;
    }

    async validate(data: any, schemaPath: string): Promise<ValidationResult> {
        if (this.shouldFail) {
            return {
                valid: false,
                errors: this.errors.length > 0 ? this.errors : ['Schema validation failed'],
                warnings: []
            };
        }
        return {
            valid: true,
            errors: [],
            warnings: []
        };
    }
}

suite('HubManager', () => {
    let hubManager: HubManager;
    let storage: HubStorage;
    let mockValidator: MockSchemaValidator;
    let tempDir: string;

    const localRef: HubReference = {
        type: 'local',
        location: ''  // Will be set in setup
    };

    setup(() => {
        // Create temp directory
        tempDir = path.join(__dirname, '..', '..', 'test-temp-hubmanager');

        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true });
        }
        fs.mkdirSync(tempDir, { recursive: true });

        // Use existing valid fixture
        const fixturePath = path.join(__dirname, '..', 'fixtures', 'hubs', 'valid-hub-config.yml');
        localRef.location = fixturePath;

        // Initialize services
        storage = new HubStorage(tempDir);
        mockValidator = new MockSchemaValidator();
        hubManager = new HubManager(storage, mockValidator as any, process.cwd(), undefined, undefined);
    });

    teardown(() => {
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true });
        }
    });

    suite('Initialization', () => {
        test('should initialize with storage and validator', () => {
            assert.ok(hubManager);
        });

        test('should throw if storage is missing', () => {
            assert.throws(() => {
                new HubManager(null as any, mockValidator as any, process.cwd(), undefined, undefined);
            }, /storage is required/);
        });

        test('should throw if validator is missing', () => {
            assert.throws(() => {
                new HubManager(storage, null as any, process.cwd(), undefined, undefined);
            }, /validator is required/);
        });
    });

    suite('Import Hub from Local', () => {
        test('should import hub from local file', async () => {
            const hubId = await hubManager.importHub(localRef, 'test-local');
            assert.strictEqual(hubId, 'test-local');

            // Verify it's saved
            const loaded = await storage.loadHub('test-local');
            assert.strictEqual(loaded.config.metadata.name, 'Official Prompt Registry Hub');
        });

        test('should auto-generate hub ID if not provided', async () => {
            const hubId = await hubManager.importHub(localRef);
            assert.ok(hubId);
            assert.ok(hubId.length > 0);
        });

        test('should fail if local file does not exist', async () => {
            const badRef: HubReference = {
                type: 'local',
                location: '/non/existent/file.yml'
            };

            await assert.rejects(
                async () => await hubManager.importHub(badRef),
                /File not found/
            );
        });

        test('should fail if hub config is invalid', async () => {
            mockValidator.setShouldFail(true, ['Invalid config']);

            await assert.rejects(
                async () => await hubManager.importHub(localRef, 'test-invalid'),
                /Hub validation failed/
            );
        });
    });

    suite('Hub Validation', () => {
        test('should validate hub config', async () => {
            // Load the fixture
            const config = yaml.load(fs.readFileSync(localRef.location, 'utf-8')) as HubConfig;
            const result = await hubManager.validateHub(config);
            assert.strictEqual(result.valid, true);
        });

        test('should fail validation for invalid config', async () => {
            const config = yaml.load(fs.readFileSync(localRef.location, 'utf-8')) as HubConfig;
            mockValidator.setShouldFail(true, ['Schema error']);

            const result = await hubManager.validateHub(config);
            assert.strictEqual(result.valid, false);
            assert.ok(result.errors.includes('Schema error'));
        });
    });

    suite('Load Hub', () => {
        test('should load hub from storage', async () => {
            // First import a hub
            await hubManager.importHub(localRef, 'test-load');

            // Then load it
            const result = await hubManager.loadHub('test-load');
            assert.strictEqual(result.config.metadata.name, 'Official Prompt Registry Hub');
            assert.strictEqual(result.reference.type, 'local');
        });

        test('should fail to load non-existent hub', async () => {
            await assert.rejects(
                async () => await hubManager.loadHub('non-existent'),
                /Hub not found/
            );
        });

        test('should fail if loaded hub is invalid', async () => {
            // Import valid hub
            await hubManager.importHub(localRef, 'test-invalid-load');

            // Make validator fail
            mockValidator.setShouldFail(true, ['Validation failed']);

            // Load should fail
            await assert.rejects(
                async () => await hubManager.loadHub('test-invalid-load'),
                /Hub validation failed/
            );
        });
    });

    suite('List Hubs', () => {
        test('should return empty array when no hubs', async () => {
            const hubs = await hubManager.listHubs();
            assert.strictEqual(hubs.length, 0);
        });

        test('should list all imported hubs', async () => {
            await hubManager.importHub(localRef, 'hub1');
            await hubManager.importHub(localRef, 'hub2');

            const hubs = await hubManager.listHubs();
            assert.strictEqual(hubs.length, 2);
            assert.ok(hubs.some((h: any) => h.id === 'hub1'));
            assert.ok(hubs.some((h: any) => h.id === 'hub2'));
        });

        test('should include hub metadata in list', async () => {
            await hubManager.importHub(localRef, 'hub-meta');

            const hubs = await hubManager.listHubs();
            const hub = hubs.find((h: any) => h.id === 'hub-meta');
            assert.ok(hub);
            assert.strictEqual(hub.name, 'Official Prompt Registry Hub');
        });
    });

    suite('Delete Hub', () => {
        test('should delete hub from storage', async () => {
            await hubManager.importHub(localRef, 'test-delete');

            // Verify it exists
            const beforeDelete = await hubManager.listHubs();
            assert.strictEqual(beforeDelete.length, 1);

            // Delete it
            await hubManager.deleteHub('test-delete');

            // Verify it's gone
            const afterDelete = await hubManager.listHubs();
            assert.strictEqual(afterDelete.length, 0);
        });

        test('should fail to delete non-existent hub', async () => {
            await assert.rejects(
                async () => await hubManager.deleteHub('non-existent'),
                /Hub not found/
            );
        });
    });

    suite('Sync Hub', () => {
        test('should sync hub from local source', async () => {
            // Copy fixture to temp location for modification
            const tempFixture = path.join(tempDir, 'sync-hub.yml');
            fs.copyFileSync(localRef.location, tempFixture);

            const syncRef: HubReference = {
                type: 'local',
                location: tempFixture
            };

            // Import initial hub
            await hubManager.importHub(syncRef, 'test-sync');

            // Modify the source file
            const config = yaml.load(fs.readFileSync(tempFixture, 'utf-8')) as any;
            config.metadata.maintainer = 'Updated Team';
            fs.writeFileSync(tempFixture, yaml.dump(config));

            // Sync hub
            await hubManager.syncHub('test-sync');

            // Verify updated
            const result = await storage.loadHub('test-sync');
            assert.strictEqual(result.config.metadata.maintainer, 'Updated Team');
        });

        test('should fail to sync non-existent hub', async () => {
            await assert.rejects(
                async () => await hubManager.syncHub('non-existent'),
                /Hub not found/
            );
        });

        test('should fail sync if updated config is invalid', async () => {
            await hubManager.importHub(localRef, 'test-sync-invalid');

            // Make validator fail for next validation
            mockValidator.setShouldFail(true, ['Invalid after sync']);

            await assert.rejects(
                async () => await hubManager.syncHub('test-sync-invalid'),
                /Hub validation failed after sync/
            );
        });
    });

    suite('Get Hub Info', () => {
        test('should get detailed hub information', async () => {
            await hubManager.importHub(localRef, 'test-info');

            const info = await hubManager.getHubInfo('test-info');
            assert.strictEqual(info.id, 'test-info');
            assert.strictEqual(info.config.metadata.name, 'Official Prompt Registry Hub');
            assert.strictEqual(info.reference.type, 'local');
            assert.ok(info.metadata.name);
            assert.ok(info.metadata.description);
            assert.ok(info.metadata.lastModified);
            assert.ok(info.metadata.size > 0);
        });

        test('should fail to get info for non-existent hub', async () => {
            await assert.rejects(
                async () => await hubManager.getHubInfo('non-existent'),
                /Hub not found/
            );
        });
    });

    suite('Reference Validation', () => {
        test('should fail with missing type', async () => {
            const badRef: any = {
                location: 'somewhere'
            };

            await assert.rejects(
                async () => await hubManager.importHub(badRef),
                /Reference type is required/
            );
        });

        test('should fail with missing location', async () => {
            const badRef: any = {
                type: 'local'
            };

            await assert.rejects(
                async () => await hubManager.importHub(badRef),
                /Reference location is required/
            );
        });

        test('should fail with invalid GitHub location', async () => {
            const badRef: HubReference = {
                type: 'github',
                location: 'invalid-format'
            };

            await assert.rejects(
                async () => await hubManager.importHub(badRef),
                /Invalid GitHub location format/
            );
        });

        test('should accept valid GitHub location', async () => {
            // This will fail at fetch stage, but reference validation should pass
            const validRef: HubReference = {
                type: 'github',
                location: 'owner/repo'
            };

            // Will fail at fetch, not at validation
            await assert.rejects(
                async () => await hubManager.importHub(validRef),
                /Failed to fetch/
            );
        });
    });

    suite('Hub ID Validation', () => {
        test('should reject invalid hub IDs', async () => {
            await assert.rejects(
                async () => await hubManager.importHub(localRef, '../bad-id'),
                /Invalid hub ID/
            );
        });

        test('should accept valid hub IDs', async () => {
            const hubId = await hubManager.importHub(localRef, 'valid-hub-123');
            assert.strictEqual(hubId, 'valid-hub-123');
        });
    });
});

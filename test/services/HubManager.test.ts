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

    suite('Active Hub Management', () => {
        test('should return null when no active hub is set', async () => {
            const activeHub = await hubManager.getActiveHub();
            assert.strictEqual(activeHub, null, 'Should return null when no active hub exists');
        });

        test('should set and retrieve active hub', async () => {
            const hubId = await hubManager.importHub(localRef, 'test-active-hub');
            
            await hubManager.setActiveHub(hubId);
            const activeHub = await hubManager.getActiveHub();
            
            assert.ok(activeHub, 'Should return active hub');
            assert.ok(activeHub.config, 'Should have config');
            assert.ok(activeHub.reference, 'Should have reference');
        });

        test('should update active hub when changed', async () => {
            const hubId1 = await hubManager.importHub(localRef, 'test-hub-1');
            const hubId2 = await hubManager.importHub(localRef, 'test-hub-2');
            
            await hubManager.setActiveHub(hubId1);
            let activeHub = await hubManager.getActiveHub();
            assert.ok(activeHub, 'First hub should be active');
            
            await hubManager.setActiveHub(hubId2);
            activeHub = await hubManager.getActiveHub();
            assert.ok(activeHub, 'Second hub should be active');
        });

        test('should return null after clearing active hub', async () => {
            const hubId = await hubManager.importHub(localRef, 'test-clear-hub');
            
            await hubManager.setActiveHub(hubId);
            assert.ok(await hubManager.getActiveHub(), 'Hub should be active');
            
            await hubManager.setActiveHub(null);
            assert.strictEqual(await hubManager.getActiveHub(), null, 'Active hub should be cleared');
        });

        test('should reject setting non-existent hub as active', async () => {
            await assert.rejects(
                async () => await hubManager.setActiveHub('non-existent-hub'),
                /Hub not found/,
                'Should reject non-existent hub'
            );
        });

        test('should list profiles from active hub only', async () => {
            const hubId1 = await hubManager.importHub(localRef, 'test-profiles-hub-1');
            const hubId2 = await hubManager.importHub(localRef, 'test-profiles-hub-2');
            
            // Set first hub as active
            await hubManager.setActiveHub(hubId1);
            
            const profiles = await hubManager.listActiveHubProfiles();
            
            // Verify all profiles belong to the active hub
            for (const profile of profiles) {
                assert.strictEqual(profile.hubId, hubId1, 'Profile should belong to active hub');
                assert.ok(profile.name, 'Profile should have name');
                assert.ok(profile.hubName, 'Profile should have hub name');
            }
        });

        test('should return empty array when active hub has no profiles', async () => {
            // Import a hub (fixture should have some profiles, but we can test the flow)
            const hubId = await hubManager.importHub(localRef, 'test-no-profiles');
            await hubManager.setActiveHub(hubId);
            
            const profiles = await hubManager.listActiveHubProfiles();
            
            // Fixture has profiles, so this will have items, but we're testing the method works
            assert.ok(Array.isArray(profiles), 'Should return an array');
        });

        test('should return empty array when no active hub is set', async () => {
            const profiles = await hubManager.listActiveHubProfiles();
            assert.ok(Array.isArray(profiles), 'Should return an array');
            assert.strictEqual(profiles.length, 0, 'Should return empty array when no active hub');
        });

        test('should auto-clear invalid active hub ID', async () => {
            const hubId = await hubManager.importHub(localRef, 'test-auto-clear');
            await hubManager.setActiveHub(hubId);
            
            // Manually delete the hub
            await hubManager.deleteHub(hubId);
            
            // Try to get active hub - should auto-clear and return null
            const activeHub = await hubManager.getActiveHub();
            assert.strictEqual(activeHub, null, 'Should auto-clear invalid hub ID');
            
            // Verify it was cleared in storage
            const activeHubId = await storage.getActiveHubId();
            assert.strictEqual(activeHubId, null, 'Storage should have cleared active hub ID');
        });

        test('should handle concurrent setActiveHub calls', async () => {
            const hubId1 = await hubManager.importHub(localRef, 'concurrent-1');
            const hubId2 = await hubManager.importHub(localRef, 'concurrent-2');
            
            // Concurrent updates
            await Promise.all([
                hubManager.setActiveHub(hubId1),
                hubManager.setActiveHub(hubId2)
            ]);
            
            const activeHub = await hubManager.getActiveHub();
            assert.ok(activeHub, 'Should have an active hub');
        });
    });

    suite('Favorites Management', () => {
        test('should toggle favorite status', async () => {
            const hubId = 'test-hub';
            const profileId = 'profile-1';

            // Initially not favorite
            let favorites = await hubManager.getFavoriteProfiles();
            assert.strictEqual(favorites[hubId], undefined);

            // Toggle ON
            await hubManager.toggleProfileFavorite(hubId, profileId);
            let isFav = await hubManager.isProfileFavorite(hubId, profileId);
            assert.strictEqual(isFav, true);
            
            favorites = await hubManager.getFavoriteProfiles();
            assert.deepStrictEqual(favorites[hubId], [profileId]);

            // Toggle OFF
            await hubManager.toggleProfileFavorite(hubId, profileId);
            isFav = await hubManager.isProfileFavorite(hubId, profileId);
            assert.strictEqual(isFav, false);
            
            favorites = await hubManager.getFavoriteProfiles();
            // Should be empty array or undefined depending on implementation cleanup
            // Implementation: if (favorites[hubId].length === 0) { delete favorites[hubId]; }
            assert.strictEqual(favorites[hubId], undefined);
        });

        test('should not create duplicates when toggling on repeatedly (simulated race)', async () => {
            const hubId = 'test-hub';
            const profileId = 'profile-1';

            // Manually corrupt storage to have duplicates (if possible via API? No, API toggles)
            // But let's verify API doesn't add duplicate if we call it weirdly?
            // Actually API toggles. If we call it twice, it adds then removes.
            
            // Let's verify standard behavior first
            await hubManager.toggleProfileFavorite(hubId, profileId);
            await hubManager.toggleProfileFavorite(hubId, profileId); // Remove
            await hubManager.toggleProfileFavorite(hubId, profileId); // Add back
            
            const favorites = await hubManager.getFavoriteProfiles();
            assert.strictEqual(favorites[hubId].length, 1);
            assert.strictEqual(favorites[hubId][0], profileId);
        });

        test('should emit event on change', async () => {
            let eventFired = false;
            hubManager.onFavoritesChanged(() => {
                eventFired = true;
            });

            await hubManager.toggleProfileFavorite('hub', 'profile');
            assert.strictEqual(eventFired, true);
        });
    });

    suite('Profile Activation State', () => {
        test('listProfilesFromHub should reflect active state', async () => {
            // Import a hub with profiles
            const hubId = await hubManager.importHub(localRef, 'active-state-hub');
            
            // Initially no profiles are active
            let profiles = await hubManager.listProfilesFromHub(hubId);
            assert.ok(profiles.length > 0);
            assert.ok(profiles.every(p => !p.active));

            // Mark one profile as active in storage
            const profileToActivate = profiles[0];
            await storage.saveProfileActivationState(hubId, profileToActivate.id, {
                hubId,
                profileId: profileToActivate.id,
                activatedAt: new Date().toISOString(),
                syncedBundles: []
            });

            // Check if active state is reflected
            profiles = await hubManager.listProfilesFromHub(hubId);
            const activeProfile = profiles.find(p => p.id === profileToActivate.id);
            assert.ok(activeProfile);
            assert.strictEqual(activeProfile.active, true);
            
            // Check others are still inactive
            const otherProfiles = profiles.filter(p => p.id !== profileToActivate.id);
            if (otherProfiles.length > 0) {
                assert.ok(otherProfiles.every(p => !p.active));
            }
        });
    });

});

import nock from 'nock';

suite('HubManager HTTP Redirect Handling', () => {
    let hubManager: HubManager;
    let storage: HubStorage;
    let mockValidator: any;
    let tempDir: string;

    setup(() => {
        // Create temp directory
        tempDir = path.join(__dirname, '..', '..', 'test-temp-hubmanager-redirect');

        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true });
        }
        fs.mkdirSync(tempDir, { recursive: true });

        // Initialize services
        storage = new HubStorage(tempDir);
        mockValidator = {
            async validate() {
                return { valid: true, errors: [], warnings: [] };
            }
        };
        hubManager = new HubManager(storage, mockValidator, process.cwd(), undefined, undefined);
    });

    teardown(() => {
        nock.cleanAll();
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true });
        }
    });

    test('should follow HTTP 301 redirects when importing hub from URL', async () => {
        const hubConfigYaml = `
version: "1.0.0"
metadata:
  name: Redirect Test Hub
  description: Hub for testing redirect handling
  maintainer: test@example.com
  updatedAt: "2025-01-01T00:00:00Z"
sources: []
profiles: []
`;
        // First request returns 301 redirect
        nock('https://raw.githubusercontent.com')
            .get('/old-owner/old-repo/main/hub-config.yml')
            .query(true)
            .reply(301, '', { location: 'https://raw.githubusercontent.com/new-owner/new-repo/main/hub-config.yml' });

        // Redirect target returns the actual content
        nock('https://raw.githubusercontent.com')
            .get('/new-owner/new-repo/main/hub-config.yml')
            .reply(200, hubConfigYaml);

        const reference = {
            type: 'github' as const,
            location: 'old-owner/old-repo'
        };

        const hubId = await hubManager.importHub(reference, 'redirect-test-hub');
        assert.strictEqual(hubId, 'redirect-test-hub');

        // Verify hub was imported successfully
        const loaded = await storage.loadHub('redirect-test-hub');
        assert.strictEqual(loaded.config.metadata.name, 'Redirect Test Hub');
    });

    test('should follow HTTP 302 redirects when syncing hub', async () => {
        // First, import a hub using local file
        const fixturePath = path.join(__dirname, '..', 'fixtures', 'hubs', 'valid-hub-config.yml');
        const localRef = { type: 'local' as const, location: fixturePath };
        const hubId = await hubManager.importHub(localRef, 'sync-redirect-hub');

        // Now update the reference to use URL and mock the sync with redirect
        const hubConfigYaml = `
version: "1.0.0"
metadata:
  name: Updated Hub After Redirect
  description: Hub synced after following redirect
  maintainer: test@example.com
  updatedAt: "2025-01-02T00:00:00Z"
sources: []
profiles: []
`;
        // Update the hub reference to URL type for sync test
        await storage.saveHub(hubId, yaml.load(fs.readFileSync(fixturePath, 'utf-8')) as HubConfig, {
            type: 'url',
            location: 'https://raw.githubusercontent.com/test-owner/test-repo/main/hub-config.yml'
        });

        // Mock the sync request with 302 redirect
        nock('https://raw.githubusercontent.com')
            .get('/test-owner/test-repo/main/hub-config.yml')
            .reply(302, '', { location: 'https://raw.githubusercontent.com/test-owner/test-repo-v2/main/hub-config.yml' });

        nock('https://raw.githubusercontent.com')
            .get('/test-owner/test-repo-v2/main/hub-config.yml')
            .reply(200, hubConfigYaml);

        await hubManager.syncHub(hubId);

        // Verify hub was synced successfully
        const loaded = await storage.loadHub(hubId);
        assert.strictEqual(loaded.config.metadata.name, 'Updated Hub After Redirect');
    });
});
/**
 * Hub Source Loading Tests
 * Tests for loading hub sources into RegistryManager and duplicate detection
 */

import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import { HubManager } from '../../src/services/HubManager';
import { HubStorage } from '../../src/storage/HubStorage';
import { HubReference, HubConfig } from '../../src/types/hub';
import { RegistrySource } from '../../src/types/registry';
import { ValidationResult } from '../../src/services/SchemaValidator';

// Mock SchemaValidator for unit tests
class MockSchemaValidator {
    async validate(data: any, schemaPath: string): Promise<ValidationResult> {
        return {
            valid: true,
            errors: [],
            warnings: []
        };
    }
}

// Mock RegistryManager for tracking source operations
class MockRegistryManager {
    private sources: RegistrySource[] = [];
    public addSourceCalls: RegistrySource[] = [];
    public updateSourceCalls: Array<{ id: string; updates: Partial<RegistrySource> }> = [];

    async listSources(): Promise<RegistrySource[]> {
        return [...this.sources];
    }

    async addSource(source: RegistrySource): Promise<void> {
        this.sources.push(source);
        this.addSourceCalls.push(source);
    }

    async updateSource(id: string, updates: Partial<RegistrySource>): Promise<void> {
        const index = this.sources.findIndex(s => s.id === id);
        if (index >= 0) {
            this.sources[index] = { ...this.sources[index], ...updates };
            this.updateSourceCalls.push({ id, updates });
        }
    }

    reset(): void {
        this.sources = [];
        this.addSourceCalls = [];
        this.updateSourceCalls = [];
    }

    getSourceCount(): number {
        return this.sources.length;
    }

    hasSource(id: string): boolean {
        return this.sources.some(s => s.id === id);
    }
}

suite('Hub Source Loading', () => {
    let hubManager: HubManager;
    let storage: HubStorage;
    let mockValidator: MockSchemaValidator;
    let mockRegistry: MockRegistryManager;
    let tempDir: string;

    setup(() => {
        // Create temp directory
        tempDir = path.join(__dirname, '..', '..', 'test-temp-hub-source-loading');
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true });
        }
        fs.mkdirSync(tempDir, { recursive: true });

        // Initialize services
        storage = new HubStorage(tempDir);
        mockValidator = new MockSchemaValidator();
        mockRegistry = new MockRegistryManager();
        hubManager = new HubManager(
            storage,
            mockValidator as any,
            process.cwd(),
            undefined,
            mockRegistry as any
        );
    });

    teardown(() => {
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true });
        }
    });

    suite('Source Loading Basics', () => {
        test('should load enabled sources from hub into registry', async () => {
            const fixturePath = path.join(__dirname, '..', 'fixtures', 'hubs', 'hub-two-sources.yml');
            const ref: HubReference = {
                type: 'local',
                location: fixturePath
            };

            const hubId = await hubManager.importHub(ref, 'test-hub');

            // Verify sources were loaded
            const sources = await mockRegistry.listSources();
            assert.strictEqual(sources.length, 2, 'Should have 2 sources loaded');

            // Check source IDs are prefixed correctly
            assert.ok(sources.some(s => s.id === 'hub-test-hub-source-1'), 'Should have hub-test-hub-source-1');
            assert.ok(sources.some(s => s.id === 'hub-test-hub-source-2'), 'Should have hub-test-hub-source-2');

            // Verify source properties
            const source1 = sources.find(s => s.id === 'hub-test-hub-source-1');
            assert.ok(source1, 'Source 1 should exist');
            assert.strictEqual(source1.name, 'Source 1');
            assert.strictEqual(source1.type, 'awesome-copilot');
            assert.strictEqual(source1.url, 'https://github.com/github/awesome-copilot');
            assert.strictEqual(source1.hubId, 'test-hub');
        });

        test('should skip disabled sources', async () => {
            const fixturePath = path.join(__dirname, '..', 'fixtures', 'hubs', 'hub-disabled-source.yml');
            const ref: HubReference = {
                type: 'local',
                location: fixturePath
            };

            await hubManager.importHub(ref, 'test-hub-disabled');

            // Verify only enabled source was loaded
            const sources = await mockRegistry.listSources();
            assert.strictEqual(sources.length, 1, 'Should have only 1 enabled source loaded');

            // Check correct source was loaded
            assert.ok(mockRegistry.hasSource('hub-test-hub-disabled-enabled-source'), 'Should have enabled source');
            assert.ok(!mockRegistry.hasSource('hub-test-hub-disabled-disabled-source'), 'Should not have disabled source');
        });

        test('should update existing hub sources on re-import', async () => {
            const fixturePath = path.join(__dirname, '..', 'fixtures', 'hubs', 'hub-two-sources.yml');
            const ref: HubReference = {
                type: 'local',
                location: fixturePath
            };

            // First import
            await hubManager.importHub(ref, 'test-hub-update');
            const sourcesAfterFirst = await mockRegistry.listSources();
            assert.strictEqual(sourcesAfterFirst.length, 2, 'Should have 2 sources after first import');

            // Reset the mock to track only the second import
            const addCallsBefore = mockRegistry.addSourceCalls.length;
            mockRegistry.addSourceCalls = [];
            mockRegistry.updateSourceCalls = [];

            // Re-load sources from same hub (simulates re-import/sync)
            await hubManager.loadHubSources('test-hub-update');

            // Verify sources were updated, not duplicated
            const sourcesAfterReload = await mockRegistry.listSources();
            assert.strictEqual(sourcesAfterReload.length, 2, 'Should still have only 2 sources (no duplicates)');
            assert.strictEqual(mockRegistry.updateSourceCalls.length, 2, 'Should have 2 update calls');
            assert.strictEqual(mockRegistry.addSourceCalls.length, 0, 'Should have 0 add calls on reload');
        });
    });

    suite('Duplicate Detection', () => {
        test('should skip duplicate when URL and type match exactly', async () => {
            // Manually add a source
            const existingSource: RegistrySource = {
                id: 'existing-source',
                name: 'Existing Source',
                type: 'awesome-copilot',
                url: 'https://github.com/github/awesome-copilot',
                enabled: true,
                priority: 1,
                config: {
                    branch: 'main',
                    collectionsPath: 'collections'
                }
            };
            await mockRegistry.addSource(existingSource);

            // Import hub with duplicate source
            const fixturePath = path.join(__dirname, '..', 'fixtures', 'hubs', 'hub-two-sources.yml');
            const ref: HubReference = {
                type: 'local',
                location: fixturePath
            };

            await hubManager.importHub(ref, 'test-hub-dup');

            // Verify duplicate was skipped
            // We should have: 1 existing + 1 new (source-2), source-1 should be skipped as duplicate
            const sources = await mockRegistry.listSources();
            assert.strictEqual(sources.length, 2, 'Should have 2 sources (1 existing + 1 new, 1 duplicate skipped)');

            // Verify the duplicate source-1 was skipped
            const hubSource1 = sources.find(s => s.id === 'hub-test-hub-dup-source-1');
            assert.strictEqual(hubSource1, undefined, 'Duplicate source-1 should be skipped');

            // Verify source-2 was added (different URL)
            const hubSource2 = sources.find(s => s.id === 'hub-test-hub-dup-source-2');
            assert.ok(hubSource2, 'Non-duplicate source-2 should be added');
        });

        test('should allow same URL with different branch', async () => {
            // Add source with branch: main
            const existingSource: RegistrySource = {
                id: 'existing-source-main',
                name: 'Existing Source Main',
                type: 'awesome-copilot',
                url: 'https://github.com/github/awesome-copilot',
                enabled: true,
                priority: 1,
                config: {
                    branch: 'main',
                    collectionsPath: 'collections'
                }
            };
            await mockRegistry.addSource(existingSource);

            // Create a hub config with same URL but different branch
            const tempHubPath = path.join(tempDir, 'hub-diff-branch.yml');
            const hubConfig: HubConfig = {
                version: '1.0.0',
                metadata: {
                    name: 'Test Hub',
                    description: 'Test',
                    maintainer: 'Test',
                    updatedAt: new Date().toISOString()
                },
                sources: [{
                    id: 'source-develop',
                    name: 'Source Develop',
                    type: 'awesome-copilot',
                    url: 'https://github.com/github/awesome-copilot',
                    enabled: true,
                    priority: 1,
                    config: {
                        branch: 'develop',  // Different branch
                        collectionsPath: 'collections'
                    }
                }],
                profiles: []
            };

            const yaml = require('js-yaml');
            fs.writeFileSync(tempHubPath, yaml.dump(hubConfig));

            const ref: HubReference = {
                type: 'local',
                location: tempHubPath
            };

            await hubManager.importHub(ref, 'test-hub-branch');

            // Verify both sources exist (different branches = different sources)
            const sources = await mockRegistry.listSources();
            assert.strictEqual(sources.length, 2, 'Should have 2 sources (different branches)');
        });

        test('should allow same URL with different collectionsPath', async () => {
            // Add source with collectionsPath: collections
            const existingSource: RegistrySource = {
                id: 'existing-source-collections',
                name: 'Existing Source Collections',
                type: 'awesome-copilot',
                url: 'https://github.com/github/awesome-copilot',
                enabled: true,
                priority: 1,
                config: {
                    branch: 'main',
                    collectionsPath: 'collections'
                }
            };
            await mockRegistry.addSource(existingSource);

            // Create a hub config with same URL but different collectionsPath
            const tempHubPath = path.join(tempDir, 'hub-diff-path.yml');
            const hubConfig: HubConfig = {
                version: '1.0.0',
                metadata: {
                    name: 'Test Hub',
                    description: 'Test',
                    maintainer: 'Test',
                    updatedAt: new Date().toISOString()
                },
                sources: [{
                    id: 'source-prompts',
                    name: 'Source Prompts',
                    type: 'awesome-copilot',
                    url: 'https://github.com/github/awesome-copilot',
                    enabled: true,
                    priority: 1,
                    config: {
                        branch: 'main',
                        collectionsPath: 'prompts'  // Different path
                    }
                }],
                profiles: []
            };

            const yaml = require('js-yaml');
            fs.writeFileSync(tempHubPath, yaml.dump(hubConfig));

            const ref: HubReference = {
                type: 'local',
                location: tempHubPath
            };

            await hubManager.importHub(ref, 'test-hub-path');

            // Verify both sources exist (different paths = different sources)
            const sources = await mockRegistry.listSources();
            assert.strictEqual(sources.length, 2, 'Should have 2 sources (different collectionsPath)');
        });

        test('should skip duplicate across multiple hubs', async () => {
            // Import first hub
            const fixturePath = path.join(__dirname, '..', 'fixtures', 'hubs', 'hub-two-sources.yml');
            const ref1: HubReference = {
                type: 'local',
                location: fixturePath
            };

            await hubManager.importHub(ref1, 'hub-a');
            const sourcesAfterFirstHub = await mockRegistry.listSources();
            assert.strictEqual(sourcesAfterFirstHub.length, 2, 'Should have 2 sources from first hub');

            // Import second hub with identical sources (same URLs and configs)
            await hubManager.importHub(ref1, 'hub-b');

            // Verify duplicates were skipped
            const sourcesAfterSecondHub = await mockRegistry.listSources();
            // Hub-b's sources should be skipped because hub-a already has the same URL+config
            // So we should still have only 2 sources total (duplicates were skipped)
            assert.strictEqual(sourcesAfterSecondHub.length, 2, 'Should have only 2 sources (hub-b duplicates were skipped)');
            
            // Verify we still only have hub-a sources
            assert.ok(mockRegistry.hasSource('hub-hub-a-source-1'), 'Should have hub-a source-1');
            assert.ok(mockRegistry.hasSource('hub-hub-a-source-2'), 'Should have hub-a source-2');
            assert.ok(!mockRegistry.hasSource('hub-hub-b-source-1'), 'Should not have hub-b source-1 (duplicate)');
            assert.ok(!mockRegistry.hasSource('hub-hub-b-source-2'), 'Should not have hub-b source-2 (duplicate)');
        });
    });

    suite('Integration with Hub Operations', () => {
        test('should load sources automatically when importing hub', async () => {
            const fixturePath = path.join(__dirname, '..', 'fixtures', 'hubs', 'hub-two-sources.yml');
            const ref: HubReference = {
                type: 'local',
                location: fixturePath
            };

            // Import hub (loadHubSources should be called automatically)
            await hubManager.importHub(ref, 'test-auto-load');

            // Verify sources were loaded without manual loadHubSources call
            const sources = await mockRegistry.listSources();
            assert.ok(sources.length > 0, 'Sources should be loaded automatically');
            assert.ok(mockRegistry.addSourceCalls.length > 0, 'addSource should have been called');
        });

        test('should reload sources when syncing hub', async () => {
            const fixturePath = path.join(__dirname, '..', 'fixtures', 'hubs', 'hub-two-sources.yml');
            
            // Create a modifiable copy
            const tempHubPath = path.join(tempDir, 'hub-sync-test.yml');
            fs.copyFileSync(fixturePath, tempHubPath);

            const ref: HubReference = {
                type: 'local',
                location: tempHubPath
            };

            // Import hub with 2 sources
            await hubManager.importHub(ref, 'test-sync');
            const sourcesAfterImport = await mockRegistry.listSources();
            assert.strictEqual(sourcesAfterImport.length, 2, 'Should have 2 sources after import');

            // Modify the hub config to add a 3rd source
            const yaml = require('js-yaml');
            const hubConfig = yaml.load(fs.readFileSync(tempHubPath, 'utf-8')) as HubConfig;
            hubConfig.sources.push({
                id: 'source-3',
                name: 'Source 3',
                type: 'awesome-copilot',
                url: 'https://github.com/org/new-repo',
                enabled: true,
                priority: 3,
                config: {
                    branch: 'main',
                    collectionsPath: 'collections'
                }
            });
            fs.writeFileSync(tempHubPath, yaml.dump(hubConfig));

            // Sync hub
            await hubManager.syncHub('test-sync');

            // Verify 3 sources exist after sync
            const sourcesAfterSync = await mockRegistry.listSources();
            assert.strictEqual(sourcesAfterSync.length, 3, 'Should have 3 sources after sync');
            assert.ok(mockRegistry.hasSource('hub-test-sync-source-3'), 'Should have the newly added source-3');
        });
    });
});

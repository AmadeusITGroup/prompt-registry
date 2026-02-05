
import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { HubCommands } from '../../src/commands/HubCommands';
import { HubManager } from '../../src/services/HubManager';
import { HubConfig } from '../../src/types/hub';
import { generateHubSourceId } from '../../src/utils/sourceIdUtils';

// Mock RegistryManager
class MockRegistryManager {
    sources: any[] = [];
    profiles: any[] = [];

    async listSources() { return this.sources; }
    async addSource(source: any) { this.sources.push(source); }
    async createProfile(profile: any) { this.profiles.push(profile); }
    async listProfiles() { return this.profiles; }
}

// Mock HubManager
class MockHubManager {
    private hubConfig: HubConfig;
    private registryManager: any;

    constructor(config: HubConfig, registryManager?: any) {
        this.hubConfig = config;
        this.registryManager = registryManager;
    }

    async importHub(reference: any, hubId?: string) { 
        // Simulate loadHubSources behavior - add sources with new format IDs
        if (this.registryManager && this.hubConfig.sources) {
            for (const source of this.hubConfig.sources) {
                // Use new sourceId format: {type}-{12-char-hash}
                const sourceId = generateHubSourceId(source.type, source.url);
                const existingSources = await this.registryManager.listSources();
                const exists = existingSources.some((s: any) => s.id === sourceId);
                if (!exists) {
                    await this.registryManager.addSource({
                        ...source,
                        id: sourceId,
                        hubId: hubId || 'test-hub-id'
                    });
                }
            }
        }
        return 'test-hub-id'; 
    }
    async loadHub(hubId: string) { 
        return { 
            config: this.hubConfig,
            reference: { type: 'local', location: '/tmp/hub-config.yml' } 
        }; 
    }
    async listHubs() { return []; }
    async setActiveHub(hubId: string) { }
}

suite('HubCommands Source Sync', () => {
    let commands: HubCommands;
    let mockHubManager: any;
    let mockRegistryManager: any;
    let context: vscode.ExtensionContext;
    let showQuickPickStub: sinon.SinonStub;
    let showOpenDialogStub: sinon.SinonStub;
    let showInputBoxStub: sinon.SinonStub;
    let withProgressStub: sinon.SinonStub;
    let showErrorMessageStub: sinon.SinonStub;

    setup(() => {
        // Stub vscode.window methods
        showQuickPickStub = sinon.stub(vscode.window, 'showQuickPick');
        showOpenDialogStub = sinon.stub(vscode.window, 'showOpenDialog');
        showInputBoxStub = sinon.stub(vscode.window, 'showInputBox');
        withProgressStub = sinon.stub(vscode.window, 'withProgress');
        showErrorMessageStub = sinon.stub(vscode.window, 'showErrorMessage');
        // We don't use showInformationMessage in this test suite directly but good to stub
        sinon.stub(vscode.window, 'showInformationMessage');

        // Setup successful progress execution
        withProgressStub.callsFake(async (options, task) => {
            const progress = { report: sinon.stub() };
            return await task(progress);
        });

        const hubConfig: HubConfig = {
            version: '1.0.0',
            metadata: {
                name: 'Test Hub',
                description: 'Test Description',
                maintainer: 'Test Maintainer',
                updatedAt: new Date().toISOString()
            },
            sources: [
                {
                    id: 'source-1',
                    name: 'Source 1',
                    type: 'github',
                    url: 'https://github.com/owner/repo1',
                    enabled: true,
                    priority: 1
                },
                {
                    id: 'source-2',
                    name: 'Source 2',
                    type: 'http',
                    url: 'https://example.com/source2',
                    enabled: true,
                    priority: 2
                }
            ],
            profiles: [
                {
                    id: 'profile-1',
                    name: 'Profile 1',
                    description: 'Test Profile',
                    icon: 'icon',
                    bundles: [],
                    active: false,
                    createdAt: '',
                    updatedAt: ''
                }
            ]
        };

        mockRegistryManager = new MockRegistryManager();
        mockHubManager = new MockHubManager(hubConfig, mockRegistryManager);
        
        context = {
            subscriptions: [],
            globalState: {
                get: () => undefined,
                update: async () => {}
            }
        } as any;

        commands = new HubCommands(mockHubManager, mockRegistryManager, context);
    });

    teardown(() => {
        sinon.restore();
    });

    test('should sync sources when importing a hub', async () => {
        // Mock user input to select 'local' and provide a file
        showQuickPickStub.resolves({ value: 'local' });
        showOpenDialogStub.resolves([vscode.Uri.file('/tmp/hub-config.yml')]);
        showInputBoxStub.resolves('test-hub-id'); // Hub ID

        const result = await commands.importHub();

        assert.strictEqual(result, 'test-hub-id', 'Import should succeed and return ID');

        // Verify sources were added to registry (now with new format IDs from HubManager.loadHubSources)
        assert.strictEqual(mockRegistryManager.sources.length, 2, 'Should have added 2 sources');
        
        // Compute expected sourceIds using the new format
        const expectedSource1Id = generateHubSourceId('github', 'https://github.com/owner/repo1');
        const expectedSource2Id = generateHubSourceId('http', 'https://example.com/source2');
        
        // Sources now have new format IDs: {type}-{12-char-hash}
        const source1 = mockRegistryManager.sources.find((s: any) => s.id === expectedSource1Id);
        assert.ok(source1, `Source 1 should be present with new format ID: ${expectedSource1Id}`);
        assert.strictEqual(source1.hubId, 'test-hub-id', 'Source should have hubId injected');
        
        const source2 = mockRegistryManager.sources.find((s: any) => s.id === expectedSource2Id);
        assert.ok(source2, `Source 2 should be present with new format ID: ${expectedSource2Id}`);
        assert.strictEqual(source2.hubId, 'test-hub-id', 'Source should have hubId injected');
    });

    test('should skip existing sources when importing a hub', async () => {
        // Compute expected sourceIds using the new format
        const expectedSource1Id = generateHubSourceId('github', 'https://github.com/owner/repo1');
        const expectedSource2Id = generateHubSourceId('http', 'https://example.com/source2');
        
        // Pre-populate registry with one source (with new format ID as HubManager would create)
        mockRegistryManager.sources.push({
            id: expectedSource1Id,
            name: 'Existing Source 1',
            type: 'github',
            url: 'https://github.com/owner/repo1',
            enabled: true,
            priority: 1,
            hubId: 'test-hub-id'
        });

        // Mock user input
        showQuickPickStub.resolves({ value: 'local' });
        showOpenDialogStub.resolves([vscode.Uri.file('/tmp/hub-config.yml')]);
        showInputBoxStub.resolves('test-hub-id');

        await commands.importHub();

        // Verify total sources (1 existing + 1 new = 2)
        assert.strictEqual(mockRegistryManager.sources.length, 2, 'Should have 2 sources total');
        
        // Verify source-2 was added with new format ID
        const source2 = mockRegistryManager.sources.find((s: any) => s.id === expectedSource2Id);
        assert.ok(source2, `Source 2 should be added with new format ID: ${expectedSource2Id}`);
    });

    test('should not create local profile copies when importing a hub', async () => {
        // Mock user input
        showQuickPickStub.resolves({ value: 'local' });
        showOpenDialogStub.resolves([vscode.Uri.file('/tmp/hub-config.yml')]);
        showInputBoxStub.resolves('test-hub-id');

        await commands.importHub();

        // Verify profiles were added to registry
        assert.strictEqual(mockRegistryManager.profiles.length, 0, 'Should not create local profile copies');
    });
});

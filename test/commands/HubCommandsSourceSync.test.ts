
import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { HubCommands } from '../../src/commands/HubCommands';
import { HubManager } from '../../src/services/HubManager';
import { HubConfig } from '../../src/types/hub';

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

    constructor(config: HubConfig) {
        this.hubConfig = config;
    }

    async importHub(reference: any, hubId?: string) { return 'test-hub-id'; }
    async loadHub(hubId: string) { 
        return { 
            config: this.hubConfig,
            reference: { type: 'local', location: '/tmp/hub-config.yml' } 
        }; 
    }
    async listHubs() { return []; }
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

        mockHubManager = new MockHubManager(hubConfig);
        mockRegistryManager = new MockRegistryManager();
        
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

        // Verify sources were added to registry
        assert.strictEqual(mockRegistryManager.sources.length, 2, 'Should have added 2 sources');
        
        const source1 = mockRegistryManager.sources.find((s: any) => s.id === 'source-1');
        assert.ok(source1, 'Source 1 should be present');
        assert.strictEqual(source1.hubId, 'test-hub-id', 'Source should have hubId injected');
        
        const source2 = mockRegistryManager.sources.find((s: any) => s.id === 'source-2');
        assert.ok(source2, 'Source 2 should be present');
        assert.strictEqual(source2.hubId, 'test-hub-id', 'Source should have hubId injected');
    });

    test('should skip existing sources when importing a hub', async () => {
        // Pre-populate registry with one source
        mockRegistryManager.sources.push({
            id: 'source-1',
            name: 'Existing Source 1',
            type: 'github',
            url: 'https://github.com/owner/repo1',
            enabled: true,
            priority: 1
        });

        // Mock user input
        showQuickPickStub.resolves({ value: 'local' });
        showOpenDialogStub.resolves([vscode.Uri.file('/tmp/hub-config.yml')]);
        showInputBoxStub.resolves('test-hub-id');

        await commands.importHub();

        // Verify total sources (1 existing + 1 new)
        assert.strictEqual(mockRegistryManager.sources.length, 2, 'Should have 2 sources total');
        
        // Verify source-2 was added
        const source2 = mockRegistryManager.sources.find((s: any) => s.id === 'source-2');
        assert.ok(source2, 'Source 2 should be added');
    });

    test('should sync profiles when importing a hub', async () => {
        // Mock user input
        showQuickPickStub.resolves({ value: 'local' });
        showOpenDialogStub.resolves([vscode.Uri.file('/tmp/hub-config.yml')]);
        showInputBoxStub.resolves('test-hub-id');

        await commands.importHub();

        // Verify profiles were added to registry
        assert.strictEqual(mockRegistryManager.profiles.length, 1, 'Should have added 1 profile');
        assert.strictEqual(mockRegistryManager.profiles[0].id, 'profile-1', 'Profile 1 should be present');
    });
});

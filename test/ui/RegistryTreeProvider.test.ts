import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { RegistryTreeProvider, TreeItemType, RegistryTreeItem } from '../../src/ui/RegistryTreeProvider';
import { RegistryManager } from '../../src/services/RegistryManager';
import { HubManager } from '../../src/services/HubManager';
import { HubProfile } from '../../src/types/hub';

suite('RegistryTreeProvider - Hub Profiles', () => {
    let provider: RegistryTreeProvider;
    let registryManagerStub: sinon.SinonStubbedInstance<RegistryManager>;
    let hubManagerStub: sinon.SinonStubbedInstance<HubManager>;
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        sandbox = sinon.createSandbox();
        registryManagerStub = sandbox.createStubInstance(RegistryManager);
        hubManagerStub = sandbox.createStubInstance(HubManager);
        
        // Mock event emitters
        (registryManagerStub as any).onBundleInstalled = sandbox.stub().returns({ dispose: () => {} });
        (registryManagerStub as any).onBundleUninstalled = sandbox.stub().returns({ dispose: () => {} });
        (registryManagerStub as any).onBundleUpdated = sandbox.stub().returns({ dispose: () => {} });
        (registryManagerStub as any).onBundlesInstalled = sandbox.stub().returns({ dispose: () => {} });
        (registryManagerStub as any).onBundlesUninstalled = sandbox.stub().returns({ dispose: () => {} });
        (registryManagerStub as any).onProfileActivated = sandbox.stub().returns({ dispose: () => {} });
        (registryManagerStub as any).onProfileDeactivated = sandbox.stub().returns({ dispose: () => {} });
        (registryManagerStub as any).onProfileCreated = sandbox.stub().returns({ dispose: () => {} });
        (registryManagerStub as any).onProfileUpdated = sandbox.stub().returns({ dispose: () => {} });
        (registryManagerStub as any).onProfileDeleted = sandbox.stub().returns({ dispose: () => {} });
        (registryManagerStub as any).onSourceAdded = sandbox.stub().returns({ dispose: () => {} });
        (registryManagerStub as any).onSourceRemoved = sandbox.stub().returns({ dispose: () => {} });
        (registryManagerStub as any).onSourceUpdated = sandbox.stub().returns({ dispose: () => {} });
        (registryManagerStub as any).onSourceSynced = sandbox.stub().returns({ dispose: () => {} });
        (registryManagerStub as any).onAutoUpdatePreferenceChanged = sandbox.stub().returns({ dispose: () => {} });
        (hubManagerStub as any).onHubImported = sandbox.stub().returns({ dispose: () => {} });
        (hubManagerStub as any).onHubDeleted = sandbox.stub().returns({ dispose: () => {} });
        (hubManagerStub as any).onHubSynced = sandbox.stub().returns({ dispose: () => {} });
        (hubManagerStub as any).onFavoritesChanged = sandbox.stub().returns({ dispose: () => {} });

        provider = new RegistryTreeProvider(registryManagerStub as any, hubManagerStub as any);
    });

    teardown(() => {
        sandbox.restore();
    });

    test('getFavoritesItems should return items with correct contextValue for menu actions', async () => {
        (provider as any).viewMode = 'favorites';
        const mockProfile: HubProfile = {
            id: 'test-profile',
            name: 'Test Profile',
            description: 'Test Description',
            bundles: [],
            active: false,
            icon: 'test-icon',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        const favorites = {
            'test-hub': ['test-profile']
        };

        hubManagerStub.getFavoriteProfiles.resolves(favorites);
        hubManagerStub.getHubProfile.resolves(mockProfile);
        // Mock getHubInfo for the hub grouping
        hubManagerStub.getHubInfo.withArgs('test-hub').resolves({
            id: 'test-hub',
            config: { metadata: { name: 'Test Hub' } } as any,
            reference: {} as any,
            metadata: {} as any
        });
        registryManagerStub.listLocalProfiles.resolves([]); // Mock empty local profiles

        // Access private method for testing via any cast
        const items = await (provider as any).getFavoritesItems();

        // 1 Hub Item + 0 local + 1 create button = 2 items
        assert.strictEqual(items.length, 3);
        
        const hubItem = items.find((i: RegistryTreeItem) => i.label === 'Test Hub');
        assert.ok(hubItem);
        assert.strictEqual(hubItem.type, TreeItemType.HUB);

        // Get children of Hub Item to find the profile
        hubManagerStub.listProfilesFromHub.withArgs('test-hub').resolves([mockProfile]);
        const children = await provider.getChildren(hubItem);
        
        const profileItem = children.find((i: RegistryTreeItem) => i.label === 'test-icon ⭐ Test Profile');
        assert.ok(profileItem);
        assert.strictEqual(profileItem.type, TreeItemType.HUB_PROFILE);
        // contextValue should enable profile actions
        assert.ok(profileItem.contextValue && profileItem.contextValue.includes('hub_profile'));
    });

    test('Favorites view should include local profiles and Create New Profile item', async () => {
        (provider as any).viewMode = 'favorites';
        const mockHubProfile: HubProfile = {
            id: 'test-hub-profile',
            name: 'Hub Profile',
            description: 'Test Description',
            bundles: [],
            active: false,
            icon: 'test-icon',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        const mockLocalProfile = {
            id: 'local-profile',
            name: 'Local Profile',
            description: 'Local Description',
            bundles: [],
            active: true,
            icon: 'local-icon',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        const favorites = {
            'test-hub': ['test-hub-profile']
        };

        hubManagerStub.getFavoriteProfiles.resolves(favorites);
        hubManagerStub.getHubProfile.resolves(mockHubProfile);
        hubManagerStub.getHubInfo.withArgs('test-hub').resolves({
            id: 'test-hub',
            config: { metadata: { name: 'Test Hub' } } as any,
            reference: {} as any,
            metadata: {} as any
        });
        registryManagerStub.listLocalProfiles.resolves([mockLocalProfile]);

        // Access private method
        const items = await (provider as any).getFavoritesItems();

        // Should contain: 1 Hub Item + 1 Local Profiles folder + 1 create button
        assert.strictEqual(items.length, 4);
        
        const hubItem = items.find((i: RegistryTreeItem) => i.label === 'Test Hub');
        assert.ok(hubItem, 'Hub item should be present for favorited hub profiles');

        const localProfilesFolder = items.find((i: RegistryTreeItem) => i.label === 'Local Profiles');
        assert.ok(localProfilesFolder, 'Local Profiles folder should be present');

        const createItem = items.find((i: RegistryTreeItem) => i.type === TreeItemType.CREATE_PROFILE);
        assert.ok(createItem, 'Create Profile item should be present');
    });

    test('Active Hub Profile should be indicated', async () => {
        (provider as any).viewMode = 'favorites';
        const mockProfile: HubProfile = {
            id: 'test-profile',
            name: 'Test Profile',
            description: 'Test Description',
            bundles: [],
            active: true, // Active
            icon: 'test-icon',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        const favorites = {
            'test-hub': ['test-profile']
        };

        hubManagerStub.getFavoriteProfiles.resolves(favorites);
        hubManagerStub.getHubProfile.resolves(mockProfile);
        hubManagerStub.listProfilesFromHub.withArgs('test-hub').resolves([mockProfile]);
        hubManagerStub.getHubInfo.withArgs('test-hub').resolves({
            id: 'test-hub',
            config: { metadata: { name: 'Test Hub' } } as any,
            reference: {} as any,
            metadata: {} as any
        });
        registryManagerStub.listLocalProfiles.resolves([]);

        const items = await (provider as any).getFavoritesItems();
        const hubItem = items.find((i: RegistryTreeItem) => i.label === 'Test Hub');
        
        const children = await provider.getChildren(hubItem);
        const item = children.find((i: RegistryTreeItem) => i.label === 'test-icon ⭐ Test Profile'); // Expect profile icon + star
        
        assert.ok(item);
        assert.strictEqual(item.description, '[Active]');
    });

    test('Favorites root item should not have emoji in label', () => {
        (provider as any).viewMode = 'favorites';
        const roots = (provider as any).getRootItems();
        const favoritesRoot = roots.find((i: RegistryTreeItem) => i.type === TreeItemType.FAVORITES_ROOT);
        
        assert.strictEqual(favoritesRoot.label, 'Favorites');
    });

    test('Favorites view should show Active Profile section with None when no profile is active', async () => {
        (provider as any).viewMode = 'favorites';

        hubManagerStub.getFavoriteProfiles.resolves({});
        registryManagerStub.listLocalProfiles.resolves([]);
        hubManagerStub.listAllActiveProfiles.resolves([]);

        const items = await (provider as any).getFavoritesItems();

        assert.strictEqual(items[0].label, 'Active Profile');

        const activeProfileSection = items.find((i: RegistryTreeItem) => i.label === 'Active Profile');
        assert.ok(activeProfileSection);

        const children = await provider.getChildren(activeProfileSection);
        assert.strictEqual(children.length, 1);
        assert.strictEqual(children[0].label, 'None');
    });

    test('Favorites view should show active local profile in Active Profile section', async () => {
        (provider as any).viewMode = 'favorites';

        const mockLocalProfile = {
            id: 'local-profile',
            name: 'Local Profile',
            description: 'Local Description',
            bundles: [],
            active: true,
            icon: 'local-icon',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        hubManagerStub.getFavoriteProfiles.resolves({});
        registryManagerStub.listLocalProfiles.resolves([mockLocalProfile]);
        hubManagerStub.listAllActiveProfiles.resolves([]);

        const items = await (provider as any).getFavoritesItems();
        const activeProfileSection = items.find((i: RegistryTreeItem) => i.label === 'Active Profile');
        assert.ok(activeProfileSection);

        const children = await provider.getChildren(activeProfileSection);
        const activeItem = children.find((i: RegistryTreeItem) => i.label === 'Local Profile');
        assert.ok(activeItem);
        assert.strictEqual(activeItem.type, TreeItemType.PROFILE);
        assert.strictEqual(activeItem.description, '[Active]');
    });

    test('Favorites view should show active hub profile in Active Profile section', async () => {
        (provider as any).viewMode = 'favorites';

        const hubId = 'test-hub';
        const activeProfile: HubProfile = {
            id: 'active-profile',
            name: 'Active Profile',
            description: 'Active',
            bundles: [],
            active: true,
            icon: 'icon',
            path: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        hubManagerStub.getFavoriteProfiles.resolves({});
        registryManagerStub.listLocalProfiles.resolves([]);
        hubManagerStub.listAllActiveProfiles.resolves([
            {
                hubId,
                profileId: 'active-profile',
                activatedAt: new Date().toISOString(),
                syncedBundles: []
            }
        ]);
        hubManagerStub.getHubProfile.withArgs(hubId, 'active-profile').resolves(activeProfile);

        const items = await (provider as any).getFavoritesItems();
        const activeProfileSection = items.find((i: RegistryTreeItem) => i.label === 'Active Profile');
        assert.ok(activeProfileSection);

        const children = await provider.getChildren(activeProfileSection);
        const activeItem = children.find((i: RegistryTreeItem) => i.label === 'icon Active Profile');
        assert.ok(activeItem);
        assert.strictEqual(activeItem.type, TreeItemType.HUB_PROFILE);
        assert.strictEqual(activeItem.description, '[Active]');
    });

    test('should deduplicate items when local profile matches favorite Hub Profile', async () => {
        (provider as any).viewMode = 'favorites';
        const commonId = 'common-profile';
        
        const mockHubProfile: HubProfile = {
            id: commonId,
            name: 'Common Profile',
            description: 'Hub Version',
            bundles: [],
            active: false,
            icon: 'hub-icon',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        const mockLocalProfile = {
            id: commonId,
            name: 'Common Profile',
            description: 'Local Version',
            bundles: [],
            active: true,
            icon: 'local-icon',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        // Profile is favorited
        const favorites = {
            'test-hub': [commonId]
        };

        hubManagerStub.getFavoriteProfiles.resolves(favorites);
        hubManagerStub.getHubProfile.resolves(mockHubProfile);
        hubManagerStub.listProfilesFromHub.withArgs('test-hub').resolves([mockHubProfile]);
        hubManagerStub.getHubInfo.withArgs('test-hub').resolves({
            id: 'test-hub',
            config: { metadata: { name: 'Test Hub' } } as any,
            reference: {} as any,
            metadata: {} as any
        });
        registryManagerStub.listLocalProfiles.resolves([mockLocalProfile]);

        const items = await (provider as any).getFavoritesItems();

        // Should return 3 items: 1 Hub Item + 1 Local Profiles folder + 1 Create Button
        // Local profiles are now in their own folder, separate from hub favorites
        assert.strictEqual(items.length, 4);
        
        const hubItem = items.find((i: RegistryTreeItem) => i.type === TreeItemType.HUB);
        assert.ok(hubItem, 'Hub Item should be present');
        
        const localProfilesFolder = items.find((i: RegistryTreeItem) => i.type === TreeItemType.LOCAL_PROFILES_FOLDER);
        assert.ok(localProfilesFolder, 'Local Profiles folder should be present');
    });

    test('Shared Profiles view should indicate active status', async () => {
        // Setup provider in 'all' mode (Shared Profiles)
        (provider as any).viewMode = 'all';

        const hubId = 'test-hub';
        const activeProfile: HubProfile = {
            id: 'active-profile',
            name: 'Active Profile',
            description: 'Active',
            bundles: [],
            active: true,
            icon: 'icon',
            path: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        const inactiveProfile: HubProfile = {
            id: 'inactive-profile',
            name: 'Inactive Profile',
            description: 'Inactive',
            bundles: [],
            active: false,
            icon: 'icon',
            path: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        hubManagerStub.listProfilesFromHub.withArgs(hubId).resolves([activeProfile, inactiveProfile]);
        hubManagerStub.getFavoriteProfiles.resolves({});

        // Mock a hub item as parent
        const hubItem = new RegistryTreeItem(
            'Test Hub',
            TreeItemType.HUB,
            { id: hubId, name: 'Test Hub' },
            vscode.TreeItemCollapsibleState.Expanded
        );

        const items = await provider.getChildren(hubItem);

        const activeItem = items.find(i => i.label === 'icon Active Profile');
        assert.ok(activeItem);
        assert.strictEqual(activeItem.description, '[Active]');

        const inactiveItem = items.find(i => i.label === 'icon Inactive Profile');
        assert.ok(inactiveItem);
        // Inactive profiles have empty string description to match PROFILE behavior
        assert.strictEqual(inactiveItem.description, '');
    });

    test('should organize profiles by path', async () => {
        (provider as any).viewMode = 'all';
        const hubId = 'test-hub';
        
        const rootProfile: HubProfile = {
            id: 'root-profile',
            name: 'Root Profile',
            description: '',
            bundles: [],
            path: [],
            active: false,
            icon: 'icon',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        const nestedProfile: HubProfile = {
            id: 'nested-profile',
            name: 'Nested Profile',
            description: '',
            bundles: [],
            path: ['Folder', 'Subfolder'],
            active: false,
            icon: 'icon',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        hubManagerStub.listProfilesFromHub.withArgs(hubId).resolves([rootProfile, nestedProfile]);
        hubManagerStub.getFavoriteProfiles.resolves({});

        // Get root children
        const hubItem = new RegistryTreeItem(
            'Test Hub',
            TreeItemType.HUB,
            { id: hubId },
            vscode.TreeItemCollapsibleState.Expanded
        );
        
        const rootItems = await provider.getChildren(hubItem);
        
        // Should find "Root Profile" (with icon prefix) and "Folder"
        const rootProfileItem = rootItems.find(i => i.label === 'icon Root Profile');
        const folderItem = rootItems.find(i => i.label === 'Folder');
        
        assert.ok(rootProfileItem, 'Root Profile not found');
        assert.ok(folderItem, 'Folder not found');
        assert.strictEqual(folderItem.type, TreeItemType.PROFILE_FOLDER);

        // Get Folder children
        const folderChildren = await provider.getChildren(folderItem);
        
        // Should find "Subfolder"
        const subfolderItem = folderChildren.find(i => i.label === 'Subfolder');
        assert.ok(subfolderItem, 'Subfolder not found');
        assert.strictEqual(subfolderItem.type, TreeItemType.PROFILE_FOLDER);

        // Get Subfolder children
        const subfolderChildren = await provider.getChildren(subfolderItem);
        
        // Should find "Nested Profile" (with icon prefix)
        const nestedProfileItem = subfolderChildren.find(i => i.label === 'icon Nested Profile');
        assert.ok(nestedProfileItem, 'Nested Profile not found');
    });

    test('Favorites view should organize hub profiles by path', async () => {
        (provider as any).viewMode = 'favorites';
        const hubId = 'test-hub';
        
        const nestedProfile: HubProfile = {
            id: 'nested-profile',
            name: 'Nested Profile',
            description: '',
            bundles: [],
            path: ['Folder', 'Subfolder'],
            active: true, // Make it active
            icon: 'icon',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        const favorites = {
            [hubId]: ['nested-profile']
        };

        hubManagerStub.getFavoriteProfiles.resolves(favorites);
        hubManagerStub.listProfilesFromHub.withArgs(hubId).resolves([nestedProfile]);
        hubManagerStub.getHubInfo.withArgs(hubId).resolves({
            id: hubId,
            config: { metadata: { name: 'Test Hub' } } as any,
            reference: {} as any,
            metadata: {} as any
        });

        const items = await (provider as any).getFavoritesItems();
        
        // Should find "Test Hub" as a root item in favorites
        const hubItem = items.find((i: RegistryTreeItem) => i.label === 'Test Hub');
        assert.ok(hubItem, 'Hub item not found in favorites');
        assert.strictEqual(hubItem.type, TreeItemType.HUB);

        // Get children of the hub item
        const children = await provider.getChildren(hubItem);
        
        // Should find "Folder"
        const folderItem = children.find((i: RegistryTreeItem) => i.label === 'Folder');
        assert.ok(folderItem, 'Folder not found in favorites');
        assert.strictEqual(folderItem.type, TreeItemType.PROFILE_FOLDER);
        
        // Get children of folder
        const folderChildren = await provider.getChildren(folderItem);
        
        // Should find "Subfolder"
        const subfolderItem = folderChildren.find((i: RegistryTreeItem) => i.label === 'Subfolder');
        assert.ok(subfolderItem, 'Subfolder not found');
        assert.strictEqual(subfolderItem.type, TreeItemType.PROFILE_FOLDER);

        // Get Subfolder children
        const subfolderChildren = await provider.getChildren(subfolderItem);
        
        // Should find "Nested Profile" with icon prefix, star, and active status
        const nestedProfileItem = subfolderChildren.find((i: RegistryTreeItem) => i.label === 'icon ⭐ Nested Profile');
        assert.ok(nestedProfileItem, 'Nested Profile not found');
        assert.strictEqual(nestedProfileItem.description, '[Active]', 'Nested profile should be indicated as active');
    });
});

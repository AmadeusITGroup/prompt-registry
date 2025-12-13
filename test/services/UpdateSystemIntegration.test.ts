/**
 * Integration tests for Update System
 * Verifies that UpdateScheduler, UpdateChecker, NotificationManager, and AutoUpdateService
 * are properly integrated in the extension
 */

import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { UpdateScheduler } from '../../src/services/UpdateScheduler';
import { UpdateChecker } from '../../src/services/UpdateChecker';
import { BundleUpdateNotifications } from '../../src/notifications/BundleUpdateNotifications';
import { AutoUpdateService } from '../../src/services/AutoUpdateService';
import { RegistryManager } from '../../src/services/RegistryManager';
import { RegistryStorage } from '../../src/storage/RegistryStorage';

suite('Update System Integration', () => {
    let sandbox: sinon.SinonSandbox;
    let mockContext: vscode.ExtensionContext;
    let mockMemento: vscode.Memento;

    setup(() => {
        sandbox = sinon.createSandbox();

        // Create mock memento
        const storage = new Map<string, any>();
        mockMemento = {
            get: (key: string, defaultValue?: any) => {
                return storage.get(key) ?? defaultValue;
            },
            update: async (key: string, value: any) => {
                if (value === undefined) {
                    storage.delete(key);
                } else {
                    storage.set(key, value);
                }
            },
            keys: () => []
        } as any;

        // Create mock context
        mockContext = {
            globalState: mockMemento,
            workspaceState: mockMemento,
            extensionPath: '/mock/path',
            subscriptions: [],
            globalStorageUri: { fsPath: '/mock/storage' } as any,
        } as any;
    });

    teardown(() => {
        sandbox.restore();
    });

    test('UpdateScheduler can be initialized with UpdateChecker', async () => {
        // Mock configuration
        const mockConfig = sandbox.stub(vscode.workspace, 'getConfiguration');
        mockConfig.withArgs('promptregistry.updateCheck').returns({
            get: sandbox.stub().callsFake((key: string, defaultValue?: any) => {
                if (key === 'enabled') {return true;}
                if (key === 'frequency') {return 'daily';}
                return defaultValue;
            })
        } as any);

        // Create mock RegistryManager
        const mockRegistryManager = sandbox.createStubInstance(RegistryManager);
        mockRegistryManager.checkUpdates.resolves([]);
        mockRegistryManager.getBundleDetails.resolves({
            bundleId: 'test-bundle',
            version: '1.0.0',
            lastUpdated: new Date().toISOString(),
            downloadUrl: 'https://example.com/bundle.zip'
        } as any);

        // Create mock RegistryStorage
        const mockRegistryStorage = sandbox.createStubInstance(RegistryStorage);
        mockRegistryStorage.getUpdatePreference.resolves(false);

        // Create UpdateChecker
        const updateChecker = new UpdateChecker(
            mockRegistryManager as any,
            mockRegistryStorage as any,
            mockMemento
        );

        // Create UpdateScheduler
        const updateScheduler = new UpdateScheduler(mockContext, updateChecker);

        // Initialize
        await updateScheduler.initialize();

        // Verify initialization
        assert.ok(updateScheduler.isSchedulerInitialized());

        // Cleanup
        updateScheduler.dispose();
    });

    test('Complete update system can be wired together', async () => {
        // Mock configuration
        const mockConfig = sandbox.stub(vscode.workspace, 'getConfiguration');
        mockConfig.withArgs('promptregistry.updateCheck').returns({
            get: sandbox.stub().callsFake((key: string, defaultValue?: any) => {
                if (key === 'enabled') {return true;}
                if (key === 'frequency') {return 'daily';}
                return defaultValue;
            })
        } as any);

        // Create mock RegistryManager
        const mockRegistryManager = sandbox.createStubInstance(RegistryManager);
        mockRegistryManager.checkUpdates.resolves([]);
        mockRegistryManager.listInstalledBundles.resolves([]);
        mockRegistryManager.getBundleDetails.resolves({
            bundleId: 'test-bundle',
            version: '1.0.0',
            lastUpdated: new Date().toISOString(),
            downloadUrl: 'https://example.com/bundle.zip'
        } as any);

        // Create mock RegistryStorage
        const mockRegistryStorage = sandbox.createStubInstance(RegistryStorage);
        mockRegistryStorage.getUpdatePreference.resolves(false);

        // Create all components
        const bundleNotifications = new BundleUpdateNotifications();
        const updateChecker = new UpdateChecker(
            mockRegistryManager as any,
            mockRegistryStorage as any,
            mockMemento
        );
        const autoUpdateService = new AutoUpdateService(
            mockRegistryManager as any, // BundleOperations
            mockRegistryManager as any, // SourceOperations
            bundleNotifications,
            mockRegistryStorage as any
        );
        const updateScheduler = new UpdateScheduler(mockContext, updateChecker);

        // Initialize scheduler
        await updateScheduler.initialize();

        // Verify all components are properly initialized
        assert.ok(updateScheduler.isSchedulerInitialized());
        assert.ok(bundleNotifications);
        assert.ok(updateChecker);
        assert.ok(autoUpdateService);

        // Cleanup
        updateScheduler.dispose();
    });

    test('Configuration changes are handled correctly', async () => {
        // Mock configuration
        let currentFrequency: 'daily' | 'weekly' | 'manual' = 'daily';
        const mockConfig = sandbox.stub(vscode.workspace, 'getConfiguration');
        mockConfig.withArgs('promptregistry.updateCheck').returns({
            get: sandbox.stub().callsFake((key: string, defaultValue?: any) => {
                if (key === 'enabled') {return true;}
                if (key === 'frequency') {return currentFrequency;}
                return defaultValue;
            })
        } as any);

        // Create mock RegistryManager
        const mockRegistryManager = sandbox.createStubInstance(RegistryManager);
        mockRegistryManager.checkUpdates.resolves([]);
        mockRegistryManager.getBundleDetails.resolves({
            bundleId: 'test-bundle',
            version: '1.0.0',
            lastUpdated: new Date().toISOString(),
            downloadUrl: 'https://example.com/bundle.zip'
        } as any);

        // Create mock RegistryStorage
        const mockRegistryStorage = sandbox.createStubInstance(RegistryStorage);
        mockRegistryStorage.getUpdatePreference.resolves(false);

        // Create UpdateChecker
        const updateChecker = new UpdateChecker(
            mockRegistryManager as any,
            mockRegistryStorage as any,
            mockMemento
        );

        // Create UpdateScheduler
        const updateScheduler = new UpdateScheduler(mockContext, updateChecker);
        await updateScheduler.initialize();

        // Change frequency
        currentFrequency = 'weekly';
        updateScheduler.updateSchedule('weekly');

        // Verify scheduler is still initialized
        assert.ok(updateScheduler.isSchedulerInitialized());

        // Cleanup
        updateScheduler.dispose();
    });
});

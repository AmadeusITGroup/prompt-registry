/**
 * E2E Test Utilities
 * 
 * Provides test context management for E2E tests including:
 * - Isolated temporary storage directories
 * - Mock VS Code ExtensionContext setup
 * - Automatic cleanup of test artifacts
 * 
 * Requirements: 3.1, 3.2, 3.3
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { RegistryManager } from '../../src/services/RegistryManager';
import { RegistryStorage } from '../../src/storage/RegistryStorage';

/**
 * E2E Test Context interface
 * Provides isolated test environment with automatic cleanup
 */
export interface E2ETestContext {
    /** Unique temporary storage path for this test */
    tempStoragePath: string;
    /** Mock VS Code ExtensionContext configured for testing */
    mockContext: vscode.ExtensionContext;
    /** RegistryManager instance for this test */
    registryManager: RegistryManager;
    /** RegistryStorage instance for this test */
    storage: RegistryStorage;
    /** Cleanup function to remove all test artifacts */
    cleanup: () => Promise<void>;
}

/**
 * Create an isolated E2E test context
 * 
 * Creates a unique temporary directory for test data, sets up mock VS Code context,
 * and initializes RegistryManager and RegistryStorage instances.
 * 
 * @returns E2ETestContext with isolated storage and cleanup function
 * 
 * @example
 * let testContext: E2ETestContext;
 * 
 * setup(async function() {
 *     this.timeout(30000);
 *     testContext = await createE2ETestContext();
 * });
 * 
 * teardown(async function() {
 *     this.timeout(10000);
 *     await testContext.cleanup();
 * });
 */
export async function createE2ETestContext(): Promise<E2ETestContext> {
    // Create unique temporary storage directory
    const tempStoragePath = fs.mkdtempSync(
        path.join(os.tmpdir(), 'e2e-bundle-update-test-')
    );

    // Create globalState storage for mock context
    const globalStateData = new Map<string, any>();
    const workspaceStateData = new Map<string, any>();

    // Create mock VS Code ExtensionContext
    const mockContext: vscode.ExtensionContext = {
        globalState: {
            get: <T>(key: string, defaultValue?: T): T | undefined => {
                return globalStateData.has(key) ? globalStateData.get(key) : defaultValue;
            },
            update: async (key: string, value: any): Promise<void> => {
                globalStateData.set(key, value);
            },
            keys: () => Array.from(globalStateData.keys()),
            setKeysForSync: () => {}
        } as any,
        workspaceState: {
            get: <T>(key: string, defaultValue?: T): T | undefined => {
                return workspaceStateData.has(key) ? workspaceStateData.get(key) : defaultValue;
            },
            update: async (key: string, value: any): Promise<void> => {
                workspaceStateData.set(key, value);
            },
            keys: () => Array.from(workspaceStateData.keys()),
            setKeysForSync: () => {}
        } as any,
        subscriptions: [],
        extensionPath: '/mock/extension/path',
        extensionUri: vscode.Uri.file('/mock/extension/path'),
        environmentVariableCollection: {} as any,
        extensionMode: 3 as any, // ExtensionMode.Test
        storageUri: vscode.Uri.file(tempStoragePath),
        globalStorageUri: vscode.Uri.file(tempStoragePath),
        logUri: vscode.Uri.file(path.join(tempStoragePath, 'logs')),
        secrets: {
            get: async () => undefined,
            store: async () => {},
            delete: async () => {},
            onDidChange: { dispose: () => {} } as any
        } as any,
        languageModelAccessInformation: {} as any,
        asAbsolutePath: (relativePath: string) => `/mock/extension/path/${relativePath}`,
        storagePath: tempStoragePath,
        globalStoragePath: tempStoragePath,
        logPath: path.join(tempStoragePath, 'logs'),
        extension: {} as any
    } as vscode.ExtensionContext;

    // Initialize storage and create directories
    const storage = new RegistryStorage(mockContext);
    await storage.initialize();

    // Get RegistryManager instance with this context
    // Note: RegistryManager is a singleton, so we need to reset it for each test
    const registryManager = RegistryManager.getInstance(mockContext);
    
    // Inject the storage instance to ensure it uses our temp directory
    (registryManager as any).storage = storage;
    
    // Clear the adapters cache to ensure fresh adapters for each test
    // This is important because adapters cache authentication tokens
    (registryManager as any).adapters.clear();
    
    // Clear the sources cache
    (registryManager as any).sourcesCache = [];
    
    // Re-initialize the installer with the new context
    const BundleInstaller = require('../../src/services/BundleInstaller').BundleInstaller;
    (registryManager as any).installer = new BundleInstaller(mockContext);

    // Create cleanup function
    const cleanup = async (): Promise<void> => {
        try {
            // Remove temporary directory and all contents
            if (fs.existsSync(tempStoragePath)) {
                fs.rmSync(tempStoragePath, { recursive: true, force: true });
            }
        } catch (error) {
            // Log but don't throw - cleanup should be best-effort
            console.warn(`E2E cleanup warning: ${error}`);
        }
    };

    return {
        tempStoragePath,
        mockContext,
        registryManager,
        storage,
        cleanup
    };
}

/**
 * Generate a unique test ID for bundle/source naming
 * Helps prevent test pollution when tests run in parallel
 * 
 * @param prefix - Optional prefix for the ID
 * @returns Unique string ID
 */
export function generateTestId(prefix: string = 'test'): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
}

/**
 * Wait for a condition to be true with timeout
 * Useful for async operations in E2E tests
 * 
 * @param condition - Function that returns true when condition is met
 * @param timeoutMs - Maximum time to wait in milliseconds
 * @param intervalMs - Polling interval in milliseconds
 * @returns Promise that resolves when condition is true or rejects on timeout
 */
export async function waitForCondition(
    condition: () => boolean | Promise<boolean>,
    timeoutMs: number = 5000,
    intervalMs: number = 100
): Promise<void> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeoutMs) {
        if (await condition()) {
            return;
        }
        await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
    
    throw new Error(`Condition not met within ${timeoutMs}ms timeout`);
}

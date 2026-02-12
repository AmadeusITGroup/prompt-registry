/**
 * Unit tests for MigrationRegistry
 */

import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { MigrationRegistry } from '../../src/services/MigrationRegistry';

suite('MigrationRegistry', () => {
    let sandbox: sinon.SinonSandbox;
    let mockContext: vscode.ExtensionContext;
    let globalStateData: Map<string, any>;

    setup(() => {
        sandbox = sinon.createSandbox();
        globalStateData = new Map();

        mockContext = {
            globalState: {
                get: (key: string, defaultValue?: any) => globalStateData.get(key) ?? defaultValue,
                update: async (key: string, value: any) => {
                    globalStateData.set(key, value);
                },
                keys: () => Array.from(globalStateData.keys()),
                setKeysForSync: sandbox.stub()
            } as any,
            globalStorageUri: vscode.Uri.file('/mock/storage'),
            extensionPath: '/mock/extension',
            extensionUri: vscode.Uri.file('/mock/extension'),
            subscriptions: [],
            extensionMode: 1 as any
        } as any as vscode.ExtensionContext;

        MigrationRegistry.resetInstance();
    });

    teardown(() => {
        sandbox.restore();
        MigrationRegistry.resetInstance();
    });

    suite('getInstance()', () => {
        test('should return singleton instance', () => {
            const instance1 = MigrationRegistry.getInstance(mockContext);
            const instance2 = MigrationRegistry.getInstance();

            assert.strictEqual(instance1, instance2);
        });

        test('should throw error when context is missing on first call', () => {
            assert.throws(
                () => MigrationRegistry.getInstance(),
                /MigrationRegistry requires context on first call/
            );
        });

        test('should create new instance after reset', () => {
            const instance1 = MigrationRegistry.getInstance(mockContext);
            MigrationRegistry.resetInstance();
            const instance2 = MigrationRegistry.getInstance(mockContext);

            assert.notStrictEqual(instance1, instance2);
        });
    });

    suite('isMigrationComplete()', () => {
        test('should return false for unknown migration', async () => {
            const registry = MigrationRegistry.getInstance(mockContext);

            assert.strictEqual(await registry.isMigrationComplete('unknown'), false);
        });

        test('should return true after markMigrationComplete', async () => {
            const registry = MigrationRegistry.getInstance(mockContext);

            await registry.markMigrationComplete('test-migration');

            assert.strictEqual(await registry.isMigrationComplete('test-migration'), true);
        });

        test('should return false for skipped migration', async () => {
            const registry = MigrationRegistry.getInstance(mockContext);

            await registry.markMigrationSkipped('test-migration', 'not needed');

            assert.strictEqual(await registry.isMigrationComplete('test-migration'), false);
        });
    });

    suite('markMigrationComplete()', () => {
        test('should persist completion with timestamp', async () => {
            const registry = MigrationRegistry.getInstance(mockContext);

            await registry.markMigrationComplete('test-migration', 'migrated 5 sources');

            const state = await registry.getMigrationState();
            assert.strictEqual(state['test-migration'].status, 'completed');
            assert.ok(state['test-migration'].completedAt);
            assert.strictEqual(state['test-migration'].details, 'migrated 5 sources');
        });
    });

    suite('markMigrationSkipped()', () => {
        test('should persist skip with reason', async () => {
            const registry = MigrationRegistry.getInstance(mockContext);

            await registry.markMigrationSkipped('test-migration', 'no sources to migrate');

            const state = await registry.getMigrationState();
            assert.strictEqual(state['test-migration'].status, 'skipped');
            assert.strictEqual(state['test-migration'].details, 'no sources to migrate');
        });
    });

    suite('runMigration()', () => {
        test('should execute migration function on first run', async () => {
            const registry = MigrationRegistry.getInstance(mockContext);
            let executed = false;

            await registry.runMigration('test-migration', async () => {
                executed = true;
            });

            assert.strictEqual(executed, true);
            assert.strictEqual(await registry.isMigrationComplete('test-migration'), true);
        });

        test('should not execute migration function if already completed', async () => {
            const registry = MigrationRegistry.getInstance(mockContext);

            await registry.markMigrationComplete('test-migration');

            let executed = false;
            await registry.runMigration('test-migration', async () => {
                executed = true;
            });

            assert.strictEqual(executed, false);
        });

        test('should not execute migration function if already skipped', async () => {
            const registry = MigrationRegistry.getInstance(mockContext);

            await registry.markMigrationSkipped('test-migration');

            let executed = false;
            await registry.runMigration('test-migration', async () => {
                executed = true;
            });

            assert.strictEqual(executed, false);
        });

        test('should propagate errors from migration function', async () => {
            const registry = MigrationRegistry.getInstance(mockContext);

            await assert.rejects(
                () => registry.runMigration('test-migration', async () => {
                    throw new Error('migration failed');
                }),
                /migration failed/
            );

            // Migration should not be marked as complete on failure
            assert.strictEqual(await registry.isMigrationComplete('test-migration'), false);
        });
    });

    suite('getMigrationState()', () => {
        test('should return empty object when no migrations exist', async () => {
            const registry = MigrationRegistry.getInstance(mockContext);

            const state = await registry.getMigrationState();

            assert.deepStrictEqual(state, {});
        });

        test('should return all migration records', async () => {
            const registry = MigrationRegistry.getInstance(mockContext);

            await registry.markMigrationComplete('migration-1');
            await registry.markMigrationSkipped('migration-2');

            const state = await registry.getMigrationState();
            assert.strictEqual(Object.keys(state).length, 2);
            assert.strictEqual(state['migration-1'].status, 'completed');
            assert.strictEqual(state['migration-2'].status, 'skipped');
        });
    });
});

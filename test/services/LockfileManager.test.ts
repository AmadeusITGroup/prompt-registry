/**
 * LockfileManager Unit Tests
 * 
 * Tests for the LockfileManager service that manages prompt-registry.lock.json files.
 * Following TDD approach - these tests are written before the implementation.
 * 
 * Requirements covered:
 * - 4.1-4.10: Lockfile creation and management
 * - 5.1-5.7: Lockfile detection and auto-sync
 * - 12.1-12.6: Source and hub tracking
 */

import * as assert from 'assert';
import * as sinon from 'sinon';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import {
    LockfileBuilder,
    createMockLockfile,
    createMockBundleEntry,
    createMockFileEntry,
    createMockSourceEntry,
    createMockHubEntry,
    createMockProfileEntry,
    LOCKFILE_DEFAULTS
} from '../helpers/lockfileTestHelpers';
import { Lockfile, LockfileValidationResult, ModifiedFileInfo } from '../../src/types/lockfile';
import { LockfileManager, CreateOrUpdateOptions } from '../../src/services/LockfileManager';
import { calculateFileChecksum } from '../../src/utils/fileIntegrityService';
import { Logger } from '../../src/utils/logger';

suite('LockfileManager', () => {
    let sandbox: sinon.SinonSandbox;
    let tempDir: string;
    let lockfilePath: string;

    // ===== Test Utilities =====
    const createTempDir = (): string => {
        const dir = path.join(__dirname, '..', '..', 'test-temp-lockfile-' + Date.now());
        fs.mkdirSync(dir, { recursive: true });
        return dir;
    };

    const cleanupTempDir = (dir: string): void => {
        if (fs.existsSync(dir)) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    };

    const writeLockfile = (lockfile: Lockfile): void => {
        fs.writeFileSync(lockfilePath, JSON.stringify(lockfile, null, 2));
    };

    const readLockfileFromDisk = (): Lockfile | null => {
        if (!fs.existsSync(lockfilePath)) {
            return null;
        }
        return JSON.parse(fs.readFileSync(lockfilePath, 'utf8'));
    };

    const createTestOptions = (bundleId: string, version: string = '1.0.0'): CreateOrUpdateOptions => ({
        bundleId,
        version,
        sourceId: 'test-source',
        sourceType: 'github',
        commitMode: 'commit',
        files: [createMockFileEntry('.github/prompts/test.prompt.md')],
        source: createMockSourceEntry('github', 'https://github.com/owner/repo')
    });

    setup(() => {
        sandbox = sinon.createSandbox();
        tempDir = createTempDir();
        lockfilePath = path.join(tempDir, 'prompt-registry.lock.json');
        // Reset singleton for each test
        LockfileManager.resetInstance();
    });

    teardown(() => {
        sandbox.restore();
        LockfileManager.resetInstance();
        cleanupTempDir(tempDir);
    });

    suite('Singleton Pattern', () => {
        test('should return same instance on multiple calls', () => {
            const instance1 = LockfileManager.getInstance(tempDir);
            const instance2 = LockfileManager.getInstance(tempDir);
            assert.strictEqual(instance1, instance2);
        });

        test('should require repository path on first call', () => {
            LockfileManager.resetInstance();
            assert.throws(() => {
                LockfileManager.getInstance();
            }, /Repository path required/);
        });
    });

    suite('createOrUpdate()', () => {
        suite('Lockfile Creation', () => {
            test('should create lockfile with all required fields', async () => {
                // Requirements: 4.2-4.7
                const manager = LockfileManager.getInstance(tempDir);
                const options = createTestOptions('test-bundle');
                
                await manager.createOrUpdate(options);
                
                const lockfile = readLockfileFromDisk();
                assert.ok(lockfile);
                assert.ok(lockfile!.$schema);
                assert.ok(lockfile!.version);
                assert.ok(lockfile!.generatedAt);
                assert.ok(lockfile!.generatedBy);
                assert.ok(lockfile!.bundles);
                assert.ok(lockfile!.sources);
            });

            test('should include $schema field pointing to schema definition', async () => {
                // Requirements: 11.4
                const manager = LockfileManager.getInstance(tempDir);
                await manager.createOrUpdate(createTestOptions('test-bundle'));
                const lockfile = readLockfileFromDisk();
                assert.ok(lockfile!.$schema.includes('lockfile.schema.json'));
            });

            test('should include version field with schema version', async () => {
                // Requirements: 4.2
                const manager = LockfileManager.getInstance(tempDir);
                await manager.createOrUpdate(createTestOptions('test-bundle'));
                const lockfile = readLockfileFromDisk();
                assert.match(lockfile!.version, /^\d+\.\d+\.\d+$/);
            });

            test('should include generatedAt ISO timestamp', async () => {
                // Requirements: 4.3
                const manager = LockfileManager.getInstance(tempDir);
                await manager.createOrUpdate(createTestOptions('test-bundle'));
                const lockfile = readLockfileFromDisk();
                assert.ok(new Date(lockfile!.generatedAt).toISOString() === lockfile!.generatedAt);
            });

            test('should include generatedBy with extension name and version', async () => {
                // Requirements: 4.4
                const manager = LockfileManager.getInstance(tempDir);
                await manager.createOrUpdate(createTestOptions('test-bundle'));
                const lockfile = readLockfileFromDisk();
                assert.ok(lockfile!.generatedBy.includes('prompt-registry'));
            });

            test('should use 2-space indentation for readability', async () => {
                // Requirements: 4.10
                const manager = LockfileManager.getInstance(tempDir);
                await manager.createOrUpdate(createTestOptions('test-bundle'));
                const content = fs.readFileSync(lockfilePath, 'utf8');
                assert.ok(content.includes('  "version"'));
            });
        });

        suite('Bundle Entry Management', () => {
            test('should add bundle entry to lockfile', async () => {
                // Requirements: 4.5
                const manager = LockfileManager.getInstance(tempDir);
                await manager.createOrUpdate(createTestOptions('my-bundle'));
                const lockfile = readLockfileFromDisk();
                assert.ok(lockfile!.bundles['my-bundle']);
            });

            test('should include version in bundle entry', async () => {
                // Requirements: 4.6
                const manager = LockfileManager.getInstance(tempDir);
                await manager.createOrUpdate(createTestOptions('my-bundle', '1.0.0'));
                const lockfile = readLockfileFromDisk();
                assert.strictEqual(lockfile!.bundles['my-bundle'].version, '1.0.0');
            });

            test('should include sourceId in bundle entry', async () => {
                // Requirements: 4.6
                const manager = LockfileManager.getInstance(tempDir);
                await manager.createOrUpdate(createTestOptions('my-bundle'));
                const lockfile = readLockfileFromDisk();
                assert.strictEqual(lockfile!.bundles['my-bundle'].sourceId, 'test-source');
            });

            test('should include sourceType in bundle entry', async () => {
                // Requirements: 4.6
                const manager = LockfileManager.getInstance(tempDir);
                await manager.createOrUpdate(createTestOptions('my-bundle'));
                const lockfile = readLockfileFromDisk();
                assert.strictEqual(lockfile!.bundles['my-bundle'].sourceType, 'github');
            });

            test('should include installedAt timestamp in bundle entry', async () => {
                // Requirements: 4.6
                const manager = LockfileManager.getInstance(tempDir);
                await manager.createOrUpdate(createTestOptions('my-bundle'));
                const lockfile = readLockfileFromDisk();
                assert.ok(lockfile!.bundles['my-bundle'].installedAt);
            });

            test('should include commitMode in bundle entry', async () => {
                // Requirements: 4.6
                const manager = LockfileManager.getInstance(tempDir);
                await manager.createOrUpdate(createTestOptions('my-bundle'));
                const lockfile = readLockfileFromDisk();
                assert.ok(['commit', 'local-only'].includes(lockfile!.bundles['my-bundle'].commitMode));
            });

            test('should include files array with checksums', async () => {
                // Requirements: 15.1-15.2
                const manager = LockfileManager.getInstance(tempDir);
                await manager.createOrUpdate(createTestOptions('my-bundle'));
                const lockfile = readLockfileFromDisk();
                assert.ok(Array.isArray(lockfile!.bundles['my-bundle'].files));
                assert.ok(lockfile!.bundles['my-bundle'].files[0].path);
                assert.ok(lockfile!.bundles['my-bundle'].files[0].checksum);
            });

            test('should update existing bundle entry', async () => {
                // Requirements: 4.1
                const manager = LockfileManager.getInstance(tempDir);
                await manager.createOrUpdate(createTestOptions('my-bundle', '1.0.0'));
                await manager.createOrUpdate(createTestOptions('my-bundle', '2.0.0'));
                const lockfile = readLockfileFromDisk();
                assert.strictEqual(lockfile!.bundles['my-bundle'].version, '2.0.0');
            });

            test('should preserve other bundles when updating one', async () => {
                // Requirements: 11.5
                const manager = LockfileManager.getInstance(tempDir);
                await manager.createOrUpdate(createTestOptions('bundle-1', '1.0.0'));
                await manager.createOrUpdate(createTestOptions('bundle-2', '2.0.0'));
                const lockfile = readLockfileFromDisk();
                assert.ok(lockfile!.bundles['bundle-1']);
                assert.ok(lockfile!.bundles['bundle-2']);
            });
        });

        suite('Source Recording', () => {
            test('should record source configuration in sources section', async () => {
                // Requirements: 4.7, 12.1
                const manager = LockfileManager.getInstance(tempDir);
                await manager.createOrUpdate(createTestOptions('test-bundle'));
                const lockfile = readLockfileFromDisk();
                assert.ok(lockfile!.sources['test-source']);
            });

            test('should include source type', async () => {
                // Requirements: 12.3
                const manager = LockfileManager.getInstance(tempDir);
                await manager.createOrUpdate(createTestOptions('test-bundle'));
                const lockfile = readLockfileFromDisk();
                assert.strictEqual(lockfile!.sources['test-source'].type, 'github');
            });

            test('should include source URL', async () => {
                // Requirements: 12.3
                const manager = LockfileManager.getInstance(tempDir);
                await manager.createOrUpdate(createTestOptions('test-bundle'));
                const lockfile = readLockfileFromDisk();
                assert.strictEqual(lockfile!.sources['test-source'].url, 'https://github.com/owner/repo');
            });

            test('should include optional branch for git sources', async () => {
                // Requirements: 12.3
                const manager = LockfileManager.getInstance(tempDir);
                const options = createTestOptions('test-bundle');
                options.source = createMockSourceEntry('github', 'https://github.com/owner/repo', 'main');
                await manager.createOrUpdate(options);
                const lockfile = readLockfileFromDisk();
                assert.strictEqual(lockfile!.sources['test-source'].branch, 'main');
            });
        });

        suite('Hub Recording', () => {
            test('should record hub configuration when bundle comes from hub', async () => {
                // Requirements: 12.2
                const manager = LockfileManager.getInstance(tempDir);
                const options = createTestOptions('test-bundle');
                options.hub = {
                    id: 'hub-1',
                    entry: createMockHubEntry('My Hub', 'https://hub.example.com/config.yml')
                };
                await manager.createOrUpdate(options);
                const lockfile = readLockfileFromDisk();
                assert.ok(lockfile!.hubs);
                assert.ok(lockfile!.hubs!['hub-1']);
            });

            test('should include hub name', async () => {
                // Requirements: 12.2
                const manager = LockfileManager.getInstance(tempDir);
                const options = createTestOptions('test-bundle');
                options.hub = {
                    id: 'hub-1',
                    entry: createMockHubEntry('My Hub', 'https://hub.example.com/config.yml')
                };
                await manager.createOrUpdate(options);
                const lockfile = readLockfileFromDisk();
                assert.strictEqual(lockfile!.hubs!['hub-1'].name, 'My Hub');
            });

            test('should include hub URL', async () => {
                // Requirements: 12.2
                const manager = LockfileManager.getInstance(tempDir);
                const options = createTestOptions('test-bundle');
                options.hub = {
                    id: 'hub-1',
                    entry: createMockHubEntry('My Hub', 'https://hub.example.com/config.yml')
                };
                await manager.createOrUpdate(options);
                const lockfile = readLockfileFromDisk();
                assert.strictEqual(lockfile!.hubs!['hub-1'].url, 'https://hub.example.com/config.yml');
            });

            test('should not include hubs section when no hub provided', async () => {
                const manager = LockfileManager.getInstance(tempDir);
                await manager.createOrUpdate(createTestOptions('test-bundle'));
                const lockfile = readLockfileFromDisk();
                assert.strictEqual(lockfile!.hubs, undefined);
            });
        });

        suite('Profile Recording', () => {
            test('should record profile when bundle installed as part of profile', async () => {
                // Requirements: 12.6, 15.3
                const manager = LockfileManager.getInstance(tempDir);
                const options = createTestOptions('bundle-1');
                options.profile = {
                    id: 'profile-1',
                    entry: createMockProfileEntry('My Profile', ['bundle-1', 'bundle-2'])
                };
                await manager.createOrUpdate(options);
                const lockfile = readLockfileFromDisk();
                assert.ok(lockfile!.profiles);
            });

            test('should include profile name', async () => {
                // Requirements: 15.4
                const manager = LockfileManager.getInstance(tempDir);
                const options = createTestOptions('bundle-1');
                options.profile = {
                    id: 'profile-1',
                    entry: createMockProfileEntry('My Profile', ['bundle-1', 'bundle-2'])
                };
                await manager.createOrUpdate(options);
                const lockfile = readLockfileFromDisk();
                assert.strictEqual(lockfile!.profiles!['profile-1'].name, 'My Profile');
            });

            test('should include profile bundleIds', async () => {
                // Requirements: 15.4
                const manager = LockfileManager.getInstance(tempDir);
                const options = createTestOptions('bundle-1');
                options.profile = {
                    id: 'profile-1',
                    entry: createMockProfileEntry('My Profile', ['bundle-1', 'bundle-2'])
                };
                await manager.createOrUpdate(options);
                const lockfile = readLockfileFromDisk();
                assert.deepStrictEqual(lockfile!.profiles!['profile-1'].bundleIds, ['bundle-1', 'bundle-2']);
            });

            test('should not include profiles section when no profile provided', async () => {
                const manager = LockfileManager.getInstance(tempDir);
                await manager.createOrUpdate(createTestOptions('test-bundle'));
                const lockfile = readLockfileFromDisk();
                assert.strictEqual(lockfile!.profiles, undefined);
            });
        });

        suite('Atomic Write', () => {
            test('should write atomically using temp file and rename', async () => {
                // Requirements: 15.6
                const manager = LockfileManager.getInstance(tempDir);
                await manager.createOrUpdate(createTestOptions('test-bundle'));
                
                // Verify lockfile exists and temp file doesn't
                assert.ok(fs.existsSync(lockfilePath));
                assert.ok(!fs.existsSync(lockfilePath + '.tmp'));
            });

            test('should not corrupt lockfile on concurrent writes', async () => {
                // Requirements: 15.6
                const manager = LockfileManager.getInstance(tempDir);
                
                // Perform multiple concurrent writes
                await Promise.all([
                    manager.createOrUpdate(createTestOptions('bundle-1', '1.0.0')),
                    manager.createOrUpdate(createTestOptions('bundle-2', '2.0.0')),
                    manager.createOrUpdate(createTestOptions('bundle-3', '3.0.0'))
                ]);
                
                // Verify lockfile is valid JSON
                const lockfile = readLockfileFromDisk();
                assert.ok(lockfile);
                assert.ok(lockfile!.bundles);
            });
        });
    });

    suite('remove()', () => {
        test('should remove bundle entry from lockfile', async () => {
            // Requirements: 4.8
            const lockfile = createMockLockfile(2);
            writeLockfile(lockfile);
            const manager = LockfileManager.getInstance(tempDir);
            await manager.remove('bundle-0');
            const updated = readLockfileFromDisk();
            assert.ok(!updated!.bundles['bundle-0']);
            assert.ok(updated!.bundles['bundle-1']);
        });

        test('should delete lockfile when last bundle is removed', async () => {
            // Requirements: 4.9
            const lockfile = createMockLockfile(1);
            writeLockfile(lockfile);
            const manager = LockfileManager.getInstance(tempDir);
            await manager.remove('bundle-0');
            assert.strictEqual(fs.existsSync(lockfilePath), false);
        });

        test('should preserve other bundles when removing one', async () => {
            const lockfile = createMockLockfile(3);
            writeLockfile(lockfile);
            const manager = LockfileManager.getInstance(tempDir);
            await manager.remove('bundle-1');
            const updated = readLockfileFromDisk();
            assert.ok(updated!.bundles['bundle-0']);
            assert.ok(!updated!.bundles['bundle-1']);
            assert.ok(updated!.bundles['bundle-2']);
        });

        test('should handle removing non-existent bundle gracefully', async () => {
            const lockfile = createMockLockfile(1);
            writeLockfile(lockfile);
            const manager = LockfileManager.getInstance(tempDir);
            await manager.remove('non-existent');
            const updated = readLockfileFromDisk();
            assert.ok(updated!.bundles['bundle-0']);
        });

        test('should clean up orphaned sources when bundle removed', async () => {
            // If a source is only referenced by the removed bundle, it should be cleaned up
            const manager = LockfileManager.getInstance(tempDir);
            
            // Create two bundles with different sources
            const options1 = createTestOptions('bundle-1');
            options1.sourceId = 'source-1';
            await manager.createOrUpdate(options1);
            
            const options2 = createTestOptions('bundle-2');
            options2.sourceId = 'source-2';
            options2.source = createMockSourceEntry('gitlab', 'https://gitlab.com/owner/repo');
            await manager.createOrUpdate(options2);
            
            // Remove bundle-1
            await manager.remove('bundle-1');
            
            const updated = readLockfileFromDisk();
            assert.ok(!updated!.sources['source-1'], 'Orphaned source should be removed');
            assert.ok(updated!.sources['source-2'], 'Referenced source should remain');
        });
    });

    suite('updateCommitMode()', () => {
        test('should update commit mode from commit to local-only', async () => {
            const lockfile = createMockLockfile(1);
            lockfile.bundles['bundle-0'].commitMode = 'commit';
            writeLockfile(lockfile);
            
            const manager = LockfileManager.getInstance(tempDir);
            await manager.updateCommitMode('bundle-0', 'local-only');
            
            const updated = readLockfileFromDisk();
            assert.strictEqual(updated!.bundles['bundle-0'].commitMode, 'local-only');
        });

        test('should update commit mode from local-only to commit', async () => {
            const lockfile = createMockLockfile(1);
            lockfile.bundles['bundle-0'].commitMode = 'local-only';
            writeLockfile(lockfile);
            
            const manager = LockfileManager.getInstance(tempDir);
            await manager.updateCommitMode('bundle-0', 'commit');
            
            const updated = readLockfileFromDisk();
            assert.strictEqual(updated!.bundles['bundle-0'].commitMode, 'commit');
        });

        test('should update generatedAt timestamp', async () => {
            const lockfile = createMockLockfile(1);
            const originalTimestamp = lockfile.generatedAt;
            writeLockfile(lockfile);
            
            // Wait a bit to ensure timestamp changes
            await new Promise(resolve => setTimeout(resolve, 10));
            
            const manager = LockfileManager.getInstance(tempDir);
            await manager.updateCommitMode('bundle-0', 'local-only');
            
            const updated = readLockfileFromDisk();
            assert.notStrictEqual(updated!.generatedAt, originalTimestamp);
        });

        test('should throw error if lockfile does not exist', async () => {
            const manager = LockfileManager.getInstance(tempDir);
            
            await assert.rejects(
                async () => manager.updateCommitMode('bundle-0', 'local-only'),
                /Lockfile does not exist/
            );
        });

        test('should throw error if bundle not found in lockfile', async () => {
            const lockfile = createMockLockfile(1);
            writeLockfile(lockfile);
            
            const manager = LockfileManager.getInstance(tempDir);
            
            await assert.rejects(
                async () => manager.updateCommitMode('non-existent', 'local-only'),
                /Bundle non-existent not found in lockfile/
            );
        });

        test('should emit onLockfileUpdated event', async () => {
            const lockfile = createMockLockfile(1);
            writeLockfile(lockfile);
            
            const manager = LockfileManager.getInstance(tempDir);
            let eventFired = false;
            let eventLockfile: Lockfile | null = null;
            
            manager.onLockfileUpdated((lf) => {
                eventFired = true;
                eventLockfile = lf;
            });
            
            await manager.updateCommitMode('bundle-0', 'local-only');
            
            assert.ok(eventFired, 'Event should be fired');
            assert.strictEqual(eventLockfile!.bundles['bundle-0'].commitMode, 'local-only');
        });

        test('should preserve other bundle properties', async () => {
            const lockfile = createMockLockfile(1);
            const originalVersion = lockfile.bundles['bundle-0'].version;
            const originalSourceId = lockfile.bundles['bundle-0'].sourceId;
            writeLockfile(lockfile);
            
            const manager = LockfileManager.getInstance(tempDir);
            await manager.updateCommitMode('bundle-0', 'local-only');
            
            const updated = readLockfileFromDisk();
            assert.strictEqual(updated!.bundles['bundle-0'].version, originalVersion);
            assert.strictEqual(updated!.bundles['bundle-0'].sourceId, originalSourceId);
        });
    });

    suite('read()', () => {
        test('should return lockfile when it exists', async () => {
            // Requirements: 5.2
            const lockfile = createMockLockfile(2);
            writeLockfile(lockfile);
            const manager = LockfileManager.getInstance(tempDir);
            const result = await manager.read();
            assert.ok(result);
            assert.strictEqual(Object.keys(result!.bundles).length, 2);
        });

        test('should return null when lockfile does not exist', async () => {
            // Requirements: 5.1
            const manager = LockfileManager.getInstance(tempDir);
            const result = await manager.read();
            assert.strictEqual(result, null);
        });

        test('should parse and return valid lockfile structure', async () => {
            // Requirements: 5.2
            const lockfile = createMockLockfile(1, { includeHubs: true, includeProfiles: true });
            writeLockfile(lockfile);
            const manager = LockfileManager.getInstance(tempDir);
            const result = await manager.read();
            assert.ok(result!.bundles);
            assert.ok(result!.sources);
            assert.ok(result!.hubs);
            assert.ok(result!.profiles);
        });

        test('should handle corrupted lockfile gracefully', async () => {
            fs.writeFileSync(lockfilePath, 'not valid json');
            const manager = LockfileManager.getInstance(tempDir);
            const result = await manager.read();
            // Should return null for corrupted file
            assert.strictEqual(result, null);
        });
    });

    suite('validate()', () => {
        test('should return valid result for valid lockfile', async () => {
            // Requirements: 5.2
            const lockfile = createMockLockfile(1);
            writeLockfile(lockfile);
            const manager = LockfileManager.getInstance(tempDir);
            const result = await manager.validate();
            assert.strictEqual(result.valid, true);
            assert.strictEqual(result.errors.length, 0);
        });

        test('should detect missing required fields', async () => {
            const invalidLockfile = { bundles: {} };
            fs.writeFileSync(lockfilePath, JSON.stringify(invalidLockfile));
            const manager = LockfileManager.getInstance(tempDir);
            const result = await manager.validate();
            assert.strictEqual(result.valid, false);
            assert.ok(result.errors.length > 0);
        });

        test('should return schema version in result', async () => {
            const lockfile = createMockLockfile(1);
            writeLockfile(lockfile);
            const manager = LockfileManager.getInstance(tempDir);
            const result = await manager.validate();
            assert.ok(result.schemaVersion);
        });

        test('should return valid=false when lockfile does not exist', async () => {
            const manager = LockfileManager.getInstance(tempDir);
            const result = await manager.validate();
            assert.strictEqual(result.valid, false);
        });

        test('should use fallback schema path when extension not available', async () => {
            // Requirements: 11.4 - Schema path resolution with fallback
            // In test environment, extension is not available, so it should fall back to process.cwd()
            const lockfile = createMockLockfile(1);
            writeLockfile(lockfile);
            const manager = LockfileManager.getInstance(tempDir);
            
            // Validation should still work using fallback path (process.cwd()/schemas/)
            const result = await manager.validate();
            // If schema is found via fallback, validation should succeed for valid lockfile
            assert.strictEqual(result.valid, true);
        });

        test('should load schema from extension path when available', async () => {
            // Requirements: 11.4 - Schema path resolution from extension
            // This test verifies the schema loading works regardless of source
            const lockfile = createMockLockfile(1);
            writeLockfile(lockfile);
            const manager = LockfileManager.getInstance(tempDir);
            
            // Store original getExtension if it exists
            const originalGetExtension = vscode.extensions?.getExtension;
            
            // Mock vscode.extensions.getExtension to return a mock extension
            const mockExtension = {
                extensionPath: process.cwd(), // Use cwd as mock extension path
                packageJSON: { version: '1.0.0' }
            };
            
            // Ensure vscode.extensions exists
            if (!vscode.extensions) {
                (vscode as any).extensions = {};
            }
            (vscode.extensions as any).getExtension = (id: string) => {
                if (id === 'AmadeusITGroup.prompt-registry') {
                    return mockExtension;
                }
                return originalGetExtension?.(id);
            };
            
            try {
                const result = await manager.validate();
                // Schema should be found and validation should work
                assert.strictEqual(result.valid, true);
            } finally {
                // Restore original
                if (originalGetExtension) {
                    (vscode.extensions as any).getExtension = originalGetExtension;
                }
            }
        });
    });

    suite('detectModifiedFiles()', () => {
        test('should return empty array when no files modified', async () => {
            // Requirements: 14.1-14.2
            const manager = LockfileManager.getInstance(tempDir);
            
            // Create a test file
            const testFilePath = path.join(tempDir, '.github', 'prompts', 'test.prompt.md');
            fs.mkdirSync(path.dirname(testFilePath), { recursive: true });
            fs.writeFileSync(testFilePath, 'test content');
            
            // Calculate checksum and create lockfile
            const checksum = await calculateFileChecksum(testFilePath);
            const options = createTestOptions('test-bundle');
            options.files = [{ path: '.github/prompts/test.prompt.md', checksum }];
            await manager.createOrUpdate(options);
            
            const result = await manager.detectModifiedFiles('test-bundle');
            assert.strictEqual(result.length, 0);
        });

        test('should detect modified files by checksum comparison', async () => {
            // Requirements: 14.2
            const manager = LockfileManager.getInstance(tempDir);
            
            // Create a test file
            const testFilePath = path.join(tempDir, '.github', 'prompts', 'test.prompt.md');
            fs.mkdirSync(path.dirname(testFilePath), { recursive: true });
            fs.writeFileSync(testFilePath, 'original content');
            
            // Calculate checksum and create lockfile
            const checksum = await calculateFileChecksum(testFilePath);
            const options = createTestOptions('test-bundle');
            options.files = [{ path: '.github/prompts/test.prompt.md', checksum }];
            await manager.createOrUpdate(options);
            
            // Modify the file
            fs.writeFileSync(testFilePath, 'modified content');
            
            const result = await manager.detectModifiedFiles('test-bundle');
            assert.strictEqual(result.length, 1);
            assert.strictEqual(result[0].modificationType, 'modified');
        });

        test('should detect missing files', async () => {
            // Requirements: 14.3
            const manager = LockfileManager.getInstance(tempDir);
            
            // Create lockfile with file entry but don't create the file
            const options = createTestOptions('test-bundle');
            options.files = [{ path: '.github/prompts/missing.prompt.md', checksum: 'abc123' }];
            await manager.createOrUpdate(options);
            
            const result = await manager.detectModifiedFiles('test-bundle');
            assert.strictEqual(result[0].modificationType, 'missing');
        });

        test('should include original and current checksums in result', async () => {
            // Requirements: 14.2
            const manager = LockfileManager.getInstance(tempDir);
            
            // Create a test file
            const testFilePath = path.join(tempDir, '.github', 'prompts', 'test.prompt.md');
            fs.mkdirSync(path.dirname(testFilePath), { recursive: true });
            fs.writeFileSync(testFilePath, 'original content');
            
            const originalChecksum = await calculateFileChecksum(testFilePath);
            const options = createTestOptions('test-bundle');
            options.files = [{ path: '.github/prompts/test.prompt.md', checksum: originalChecksum }];
            await manager.createOrUpdate(options);
            
            // Modify the file
            fs.writeFileSync(testFilePath, 'modified content');
            
            const result = await manager.detectModifiedFiles('test-bundle');
            assert.ok(result[0].originalChecksum);
            assert.ok(result[0].currentChecksum);
            assert.notStrictEqual(result[0].originalChecksum, result[0].currentChecksum);
        });

        test('should return empty array for non-existent bundle', async () => {
            const manager = LockfileManager.getInstance(tempDir);
            const result = await manager.detectModifiedFiles('non-existent');
            assert.strictEqual(result.length, 0);
        });
    });

    suite('Events', () => {
        test('should emit onLockfileUpdated event when lockfile created', async () => {
            const manager = LockfileManager.getInstance(tempDir);
            let eventFired = false;
            manager.onLockfileUpdated(() => { eventFired = true; });
            await manager.createOrUpdate(createTestOptions('test-bundle'));
            assert.strictEqual(eventFired, true);
        });

        test('should emit onLockfileUpdated event when lockfile updated', async () => {
            const lockfile = createMockLockfile(1);
            writeLockfile(lockfile);
            const manager = LockfileManager.getInstance(tempDir);
            let eventFired = false;
            manager.onLockfileUpdated(() => { eventFired = true; });
            await manager.createOrUpdate(createTestOptions('new-bundle'));
            assert.strictEqual(eventFired, true);
        });

        test('should emit onLockfileUpdated event when bundle removed', async () => {
            const lockfile = createMockLockfile(2);
            writeLockfile(lockfile);
            const manager = LockfileManager.getInstance(tempDir);
            let eventFired = false;
            manager.onLockfileUpdated(() => { eventFired = true; });
            await manager.remove('bundle-0');
            assert.strictEqual(eventFired, true);
        });

        test('should emit onLockfileUpdated event when lockfile deleted', async () => {
            const lockfile = createMockLockfile(1);
            writeLockfile(lockfile);
            const manager = LockfileManager.getInstance(tempDir);
            let eventFired = false;
            let receivedNull = false;
            manager.onLockfileUpdated((lf) => { 
                eventFired = true; 
                receivedNull = lf === null;
            });
            await manager.remove('bundle-0');
            assert.strictEqual(eventFired, true);
            assert.strictEqual(receivedNull, true);
        });
    });

    suite('getLockfilePath()', () => {
        test('should return correct lockfile path', () => {
            const manager = LockfileManager.getInstance(tempDir);
            const lockfilePath = manager.getLockfilePath();
            assert.ok(lockfilePath.endsWith('prompt-registry.lock.json'));
        });
    });

    suite('Lockfile Deletion Error Handling', () => {
        // Requirements: 3.5 - If lockfile deletion fails, log error and continue without throwing
        
        test('should log error and not throw when lockfile deletion fails', async () => {
            // Requirements: 3.5 - Error is logged, no exception thrown
            const lockfile = createMockLockfile(1);
            writeLockfile(lockfile);
            
            const manager = LockfileManager.getInstance(tempDir);
            
            // Stub fs.promises.unlink to simulate deletion failure
            const unlinkStub = sandbox.stub(fs.promises, 'unlink').rejects(new Error('Permission denied'));
            
            // Track if error was logged
            const logger = Logger.getInstance();
            const logErrorStub = sandbox.stub(logger, 'error');
            
            // Remove the last bundle - this should trigger lockfile deletion
            // which will fail, but should NOT throw
            await assert.doesNotReject(
                async () => manager.remove('bundle-0'),
                'remove() should not throw when lockfile deletion fails'
            );
            
            // Verify error was logged
            assert.ok(logErrorStub.called, 'Error should be logged');
            assert.ok(
                logErrorStub.firstCall.args[0].includes('Failed to delete lockfile'),
                'Error message should mention lockfile deletion failure'
            );
            
            // Verify unlink was attempted
            assert.ok(unlinkStub.called, 'unlink should have been called');
        });

        test('should emit onLockfileUpdated with null even when deletion fails', async () => {
            // Requirements: 3.5 - Continue operation (emit event) even on deletion failure
            const lockfile = createMockLockfile(1);
            writeLockfile(lockfile);
            
            const manager = LockfileManager.getInstance(tempDir);
            
            // Stub fs.promises.unlink to simulate deletion failure
            sandbox.stub(fs.promises, 'unlink').rejects(new Error('Permission denied'));
            
            // Track events
            let eventFired = false;
            let receivedNull = false;
            manager.onLockfileUpdated((lf) => {
                eventFired = true;
                receivedNull = lf === null;
            });
            
            // Remove the last bundle
            await manager.remove('bundle-0');
            
            // Event should still fire with null even though deletion failed
            assert.strictEqual(eventFired, true, 'Event should be fired');
            assert.strictEqual(receivedNull, true, 'Event should receive null');
        });
    });

    suite('File Watcher Initialization and Disposal', () => {
        // Requirements: 2.4, 2.5 - File watcher initialization and disposal
        
        let mockFileWatcher: {
            onDidChange: sinon.SinonStub;
            onDidCreate: sinon.SinonStub;
            onDidDelete: sinon.SinonStub;
            dispose: sinon.SinonStub;
        };
        let createFileSystemWatcherStub: sinon.SinonStub;

        setup(() => {
            // Create mock file watcher with stubbed methods
            mockFileWatcher = {
                onDidChange: sandbox.stub().returns({ dispose: sandbox.stub() }),
                onDidCreate: sandbox.stub().returns({ dispose: sandbox.stub() }),
                onDidDelete: sandbox.stub().returns({ dispose: sandbox.stub() }),
                dispose: sandbox.stub()
            };

            // Stub vscode.workspace.createFileSystemWatcher
            createFileSystemWatcherStub = sandbox.stub(vscode.workspace, 'createFileSystemWatcher')
                .returns(mockFileWatcher as any);
        });

        test('should initialize file watcher on construction', () => {
            // Requirements: 2.4 - File watcher is initialized on construction
            LockfileManager.resetInstance();
            
            // Create a new instance - this should call setupFileWatcher
            const manager = LockfileManager.getInstance(tempDir);
            
            // Verify createFileSystemWatcher was called
            assert.ok(createFileSystemWatcherStub.calledOnce, 'createFileSystemWatcher should be called once');
            
            // Verify the pattern includes the lockfile name
            const callArgs = createFileSystemWatcherStub.firstCall.args;
            assert.ok(callArgs[0], 'Pattern should be provided');
            
            // Verify event handlers were registered
            assert.ok(mockFileWatcher.onDidChange.calledOnce, 'onDidChange handler should be registered');
            assert.ok(mockFileWatcher.onDidCreate.calledOnce, 'onDidCreate handler should be registered');
            assert.ok(mockFileWatcher.onDidDelete.calledOnce, 'onDidDelete handler should be registered');
            
            // Clean up
            manager.dispose();
        });

        test('should dispose file watcher on dispose() call', () => {
            // Requirements: 2.5 - File watcher is disposed on dispose() call
            LockfileManager.resetInstance();
            
            const manager = LockfileManager.getInstance(tempDir);
            
            // Verify watcher was created
            assert.ok(createFileSystemWatcherStub.calledOnce);
            
            // Dispose the manager
            manager.dispose();
            
            // Verify file watcher dispose was called
            assert.ok(mockFileWatcher.dispose.calledOnce, 'File watcher dispose should be called');
        });

        test('should not fire events after disposal', async () => {
            // Requirements: 2.5 - No events fire after disposal
            LockfileManager.resetInstance();
            
            const manager = LockfileManager.getInstance(tempDir);
            
            // Track events
            let eventCount = 0;
            const disposable = manager.onLockfileUpdated(() => {
                eventCount++;
            });
            
            // Capture the handlers that were registered with the file watcher
            const changeHandler = mockFileWatcher.onDidChange.firstCall?.args[0];
            const createHandler = mockFileWatcher.onDidCreate.firstCall?.args[0];
            const deleteHandler = mockFileWatcher.onDidDelete.firstCall?.args[0];
            
            // Dispose the manager - this should dispose the event emitter
            manager.dispose();
            
            // After dispose, calling the file watcher handlers should not propagate
            // events to listeners because the EventEmitter is disposed
            // Simulate external file changes by invoking the captured handlers
            if (changeHandler) {
                try { changeHandler(); } catch { /* handler may fail after dispose */ }
            }
            if (createHandler) {
                try { createHandler(); } catch { /* handler may fail after dispose */ }
            }
            if (deleteHandler) {
                try { deleteHandler(); } catch { /* handler may fail after dispose */ }
            }
            
            // Allow any async operations to complete
            await new Promise(resolve => setTimeout(resolve, 10));
            
            // Verify no events were fired to listeners after disposal
            assert.strictEqual(eventCount, 0, 'No events should fire after disposal');
            
            disposable.dispose();
        });

        test('should handle file watcher initialization failure gracefully', () => {
            // Test that the manager handles errors during file watcher setup
            LockfileManager.resetInstance();
            
            // Make createFileSystemWatcher throw an error
            createFileSystemWatcherStub.throws(new Error('Mock watcher creation failed'));
            
            // Creating the manager should not throw
            let manager: LockfileManager | undefined;
            assert.doesNotThrow(() => {
                manager = LockfileManager.getInstance(tempDir);
            }, 'Manager creation should not throw even if file watcher fails');
            
            // Manager should still be functional for basic operations
            assert.ok(manager, 'Manager should be created');
            
            // Clean up
            manager?.dispose();
        });
    });
});

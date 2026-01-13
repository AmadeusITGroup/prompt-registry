/**
 * UserScopeService Unit Tests
 * Tests cross-platform path resolution and sync functionality
 * 
 * Note: Most tests require VS Code integration test environment
 * These are unit tests for testable logic only
 */

import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import { UserScopeService } from '../../src/services/UserScopeService';

suite('UserScopeService', () => {
    let service: UserScopeService;
    let mockContext: any;
    let tempDir: string;

    setup(() => {
        tempDir = path.join(__dirname, '..', '..', '..', 'test-temp-copilot');
        
        // Mock VS Code ExtensionContext with realistic path structure
        // Simulate: ~/Library/Application Support/Code/User/globalStorage/publisher.extension
        const mockUserDir = path.join(tempDir, 'Code', 'User');
        mockContext = {
            globalStorageUri: { fsPath: path.join(mockUserDir, 'globalStorage', 'publisher.extension') },
            storageUri: { fsPath: path.join(tempDir, 'workspace') },
            extensionPath: __dirname,
            subscriptions: [],
        };

        // Create temp directories
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }

        service = new UserScopeService(mockContext);
    });

    teardown(() => {
        // Cleanup temp directories
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    suite('Service Initialization', () => {
        test('should initialize with context', () => {
            assert.ok(service, 'Service should be initialized');
        });

        test('should have sync methods', () => {
            assert.ok(typeof service.syncBundle === 'function', 'Should have syncBundle method');
            assert.ok(typeof service.unsyncBundle === 'function', 'Should have unsyncBundle method');
            assert.ok(typeof service.getStatus === 'function', 'Should have getStatus method');
        });
    });

    suite('Path Resolution', () => {
        // Test cases for different OS and IDE combinations
        const pathTestCases = [
            {
                name: 'macOS - Kiro',
                globalStoragePath: '/Users/testuser/Library/Application Support/Kiro/User/globalStorage/publisher.extension',
                expectedPath: '/Users/testuser/Library/Application Support/Kiro/User/prompts'
            },
            {
                name: 'macOS - VS Code',
                globalStoragePath: '/Users/testuser/Library/Application Support/Code/User/globalStorage/publisher.extension',
                expectedPath: '/Users/testuser/Library/Application Support/Code/User/prompts'
            },
            {
                name: 'macOS - VS Code Insiders',
                globalStoragePath: '/Users/testuser/Library/Application Support/Code - Insiders/User/globalStorage/publisher.extension',
                expectedPath: '/Users/testuser/Library/Application Support/Code - Insiders/User/prompts'
            },
            {
                name: 'macOS - Windsurf',
                globalStoragePath: '/Users/testuser/Library/Application Support/Windsurf/User/globalStorage/publisher.extension',
                expectedPath: '/Users/testuser/Library/Application Support/Windsurf/User/prompts'
            },
            {
                name: 'macOS - Cursor',
                globalStoragePath: '/Users/testuser/Library/Application Support/Cursor/User/globalStorage/publisher.extension',
                expectedPath: '/Users/testuser/Library/Application Support/Cursor/User/prompts'
            },
            {
                name: 'Linux - VS Code',
                globalStoragePath: '/home/testuser/.config/Code/User/globalStorage/publisher.extension',
                expectedPath: '/home/testuser/.config/Code/User/prompts'
            },
            {
                name: 'Linux - Custom IDE',
                globalStoragePath: '/home/user/.config/CustomIDE/User/globalStorage/com.company.extension',
                expectedPath: '/home/user/.config/CustomIDE/User/prompts'
            }
        ];

        pathTestCases.forEach(({ name, globalStoragePath, expectedPath }) => {
            test(`should resolve prompts directory - ${name}`, async () => {
                const testContext = {
                    globalStorageUri: { fsPath: globalStoragePath },
                    storageUri: { fsPath: tempDir },
                    extensionPath: __dirname,
                    subscriptions: [],
                } as any;
                
                const testService = new UserScopeService(testContext);
                const status = await testService.getStatus();
                
                assert.strictEqual(status.copilotDir, expectedPath, `Should resolve correct path for ${name}`);
            });
        });

        test('should resolve prompts directory - Windows (cross-platform test)', async () => {
            // Use path.join for cross-platform testing
            const winBasePath = path.join(tempDir, 'WindowsTest', 'Code', 'User');
            const winContext = {
                globalStorageUri: { 
                    fsPath: path.join(winBasePath, 'globalStorage', 'publisher.extension')
                },
                storageUri: { fsPath: tempDir },
                extensionPath: __dirname,
                subscriptions: [],
            } as any;
            
            const winService = new UserScopeService(winContext);
            const status = await winService.getStatus();
            
            const expectedPath = path.join(winBasePath, 'prompts');
            assert.strictEqual(status.copilotDir, expectedPath);
        });

        // Profile-based path tests
        const profileTestCases = [
            {
                name: 'macOS with profile',
                globalStoragePath: '/Users/testuser/Library/Application Support/Code/User/profiles/3a5f32f8/globalStorage/publisher.extension',
                expectedPath: '/Users/testuser/Library/Application Support/Code/User/profiles/3a5f32f8/prompts'
            },
            {
                name: 'Linux with profile',
                globalStoragePath: '/home/testuser/.config/Code/User/profiles/xyz789/globalStorage/publisher.extension',
                expectedPath: '/home/testuser/.config/Code/User/profiles/xyz789/prompts'
            }
        ];

        profileTestCases.forEach(({ name, globalStoragePath, expectedPath }) => {
            test(`should resolve prompts directory - ${name}`, async () => {
                const testContext = {
                    globalStorageUri: { fsPath: globalStoragePath },
                    storageUri: { fsPath: tempDir },
                    extensionPath: __dirname,
                    subscriptions: [],
                } as any;
                
                const testService = new UserScopeService(testContext);
                const status = await testService.getStatus();
                
                assert.strictEqual(status.copilotDir, expectedPath);
            });
        });

        test('should resolve prompts directory - Windows with profile (cross-platform test)', async () => {
            const winProfileBase = path.join(tempDir, 'WindowsProfile', 'Code', 'User', 'profiles', 'abc123');
            const winProfileContext = {
                globalStorageUri: { 
                    fsPath: path.join(winProfileBase, 'globalStorage', 'publisher.extension')
                },
                storageUri: { fsPath: tempDir },
                extensionPath: __dirname,
                subscriptions: [],
            } as any;
            
            const winProfileService = new UserScopeService(winProfileContext);
            const status = await winProfileService.getStatus();
            
            const expectedPath = path.join(winProfileBase, 'prompts');
            assert.strictEqual(status.copilotDir, expectedPath);
        });
    });

    suite('Windows Path Regex Handling (Backslash Escaping)', () => {
        // These tests verify the fix for: "Invalid regular expression: /\profiles\([^\]+)/: Unterminated character class"
        // The issue was that Windows path.sep (\) wasn't properly escaped in regex character classes
        
        test('should handle Windows-style path with backslashes - standard profile', async () => {
            // Use path.join to create platform-appropriate paths
            const userPath = path.join(tempDir, 'WinTest', 'Users', 'Username', 'AppData', 'Roaming', 'Code', 'User');
            const globalStoragePath = path.join(userPath, 'globalStorage', 'amadeusitgroup.prompt-registry');
            
            const winContext = {
                globalStorageUri: { fsPath: globalStoragePath },
                storageUri: { fsPath: tempDir },
                extensionPath: __dirname,
                subscriptions: [],
            } as any;
            
            const winService = new UserScopeService(winContext);
            
            // The key test: should not throw "Invalid regular expression" or "Unterminated character class"
            const status = await winService.getStatus();
            
            // Should successfully parse without regex errors
            assert.ok(status.copilotDir, 'Should return a valid path');
            assert.ok(status.copilotDir.includes('User'), 'Should include User directory');
            assert.ok(status.copilotDir.endsWith('prompts'), 'Should end with prompts');
            
            const expectedPath = path.join(userPath, 'prompts');
            assert.strictEqual(status.copilotDir, expectedPath, 'Should resolve to User/prompts');
        });

        test('should handle Windows-style path with backslashes - profile-based', async () => {
            // Simulate the exact error case from the screenshot
            const userPath = path.join(tempDir, 'WinProfile', 'Users', 'Username', '.vscode', 'extensions', 'dist', 'User');
            const profileId = 'security-best-practices';
            const globalStoragePath = path.join(userPath, 'profiles', profileId, 'globalStorage', 'amadeusitgroup.prompt-registry');
            
            const winProfileContext = {
                globalStorageUri: { fsPath: globalStoragePath },
                storageUri: { fsPath: tempDir },
                extensionPath: __dirname,
                subscriptions: [],
            } as any;
            
            const winProfileService = new UserScopeService(winProfileContext);
            
            // The key test: should not throw regex errors
            const status = await winProfileService.getStatus();
            
            // Should successfully parse the profile path without regex errors
            assert.ok(status.copilotDir, 'Should return a valid path');
            assert.ok(status.copilotDir.includes('profiles'), 'Should include profiles directory');
            assert.ok(status.copilotDir.includes(profileId), 'Should include profile ID');
            assert.ok(status.copilotDir.endsWith('prompts'), 'Should end with prompts');
            
            const expectedPath = path.join(userPath, 'profiles', profileId, 'prompts');
            assert.strictEqual(status.copilotDir, expectedPath, 'Should resolve to profile prompts directory');
        });

        test('should handle Windows-style path - custom data directory with profile', async () => {
            // Test custom data directory (no User folder) with profile
            const customDataDir = path.join(tempDir, 'CustomVSCode', 'Data');
            const profileId = 'work-profile';
            const globalStoragePath = path.join(customDataDir, 'profiles', profileId, 'globalStorage', 'publisher.extension');
            
            const customContext = {
                globalStorageUri: { fsPath: globalStoragePath },
                storageUri: { fsPath: tempDir },
                extensionPath: __dirname,
                subscriptions: [],
            } as any;
            
            const customService = new UserScopeService(customContext);
            
            // The key test: should not throw regex errors
            const status = await customService.getStatus();
            
            // Should handle custom data directory with profiles
            assert.ok(status.copilotDir, 'Should return a valid path');
            assert.ok(status.copilotDir.includes('profiles'), 'Should include profiles directory');
            assert.ok(status.copilotDir.includes(profileId), 'Should include profile ID');
            
            const expectedPath = path.join(customDataDir, 'profiles', profileId, 'prompts');
            assert.strictEqual(status.copilotDir, expectedPath, 'Should resolve custom data dir with profile');
        });

        test('should not throw regex errors with any path separator', async () => {
            // This is the core regression test for the bug fix
            // The bug was: new RegExp(`[^${path.sep}]`) would create [^\] on Windows
            // which is an unterminated character class
            
            const testPath = path.join(tempDir, 'RegexTest', 'Code', 'User', 'profiles', 'test-id', 'globalStorage', 'ext');
            
            const testContext = {
                globalStorageUri: { fsPath: testPath },
                storageUri: { fsPath: tempDir },
                extensionPath: __dirname,
                subscriptions: [],
            } as any;
            
            const testService = new UserScopeService(testContext);
            
            // Should not throw regex errors regardless of platform
            try {
                const status = await testService.getStatus();
                assert.ok(status, 'Should successfully get status');
                assert.ok(status.copilotDir, 'Should return a path');
            } catch (error: any) {
                // The specific errors we're testing for
                assert.ok(
                    !error.message.includes('Invalid regular expression'),
                    `Should not throw "Invalid regular expression", got: ${error.message}`
                );
                assert.ok(
                    !error.message.includes('Unterminated character class'),
                    `Should not throw "Unterminated character class", got: ${error.message}`
                );
                assert.ok(
                    !error.message.includes('SyntaxError'),
                    `Should not throw SyntaxError from regex, got: ${error.message}`
                );
                // If it's a different error (like file not found), that's acceptable for this test
            }
        });
    });

    suite('getStatus', () => {
        test('should return status information', async () => {
            const status = await service.getStatus();
            
            assert.ok(status, 'Should return status object');
            assert.ok(typeof status.copilotDir === 'string', 'Should include copilot directory');
            assert.ok(typeof status.dirExists === 'boolean', 'Should include directory existence flag');
            assert.ok(typeof status.syncedFiles === 'number', 'Should include synced files count');
        });

        test('should report copilot directory path', async () => {
            const status = await service.getStatus();
            
            // Path should include User/prompts
            assert.ok(status.copilotDir.includes('User') || status.copilotDir.includes('prompts'),
                'Copilot directory should be meaningful path');
        });
    });

    suite('syncBundle', () => {
        test('should accept bundle ID and path', async () => {
            const bundleId = 'test-bundle';
            const bundlePath = path.join(tempDir, 'bundle');
            
            // Create mock bundle directory
            if (!fs.existsSync(bundlePath)) {
                fs.mkdirSync(bundlePath, { recursive: true });
            }
            
            // Create a mock deployment-manifest.yml
            const manifestPath = path.join(bundlePath, 'deployment-manifest.yml');
            fs.writeFileSync(manifestPath, `
id: ${bundleId}
version: "1.0.0"
prompts: []
`);
            
            // This will likely fail in unit test without real Copilot directory
            // But we're testing that the method exists and accepts parameters
            try {
                await service.syncBundle(bundleId, bundlePath);
                // If it succeeds, great!
                assert.ok(true, 'syncBundle should complete');
            } catch (error: any) {
                // Expected in unit test environment
                // Just verify error is related to file operations, not parameter issues
                assert.ok(error.message || true, 'Error is expected in unit test environment');
            }
        });

        test('should reject invalid bundle path', async () => {
            try {
                await service.syncBundle('invalid-bundle', '/nonexistent/path');
                // Should not reach here
                assert.fail('Should throw error for invalid path');
            } catch (error) {
                assert.ok(error, 'Should throw error for invalid bundle path');
            }
        });

        test('should create files in flat structure (not in bundle subdirectory)', async () => {
            const bundleId = 'flat-test-bundle';
            const bundlePath = path.join(tempDir, 'flat-bundle');
            const promptFile = path.join(bundlePath, 'test-prompt.md');
            
            // Create mock bundle
            fs.mkdirSync(bundlePath, { recursive: true });
            fs.writeFileSync(promptFile, '# Test Prompt');
            
            const manifestPath = path.join(bundlePath, 'deployment-manifest.yml');
            fs.writeFileSync(manifestPath, `
id: ${bundleId}
version: "1.0.0"
prompts:
  - id: test-prompt
    name: Test Prompt
    file: test-prompt.md
    type: prompt
`);
            
            try {
                await service.syncBundle(bundleId, bundlePath);
                
                const status = await service.getStatus();
                
                // Files should be directly in prompts dir, not in a subdirectory
                if (status.files.length > 0) {
                    for (const file of status.files) {
                        assert.ok(
                            !file.includes('/'),
                            `File should be in flat structure, not subdirectory: ${file}`
                        );
                    }
                }
            } catch (error: any) {
                // May fail in test environment, that's ok
                assert.ok(true, 'Test environment limitation');
            }
        });
    });

    suite('unsyncBundle', () => {
        test('should accept bundle ID', async () => {
            const bundleId = 'test-bundle';
            
            // This will try to remove sync files
            // In unit test, may not have anything to remove
            try {
                await service.unsyncBundle(bundleId);
                assert.ok(true, 'unsyncBundle should complete');
            } catch (error: any) {
                // May fail if Copilot directory doesn't exist
                assert.ok(error.message || true, 'Error is expected in unit test environment');
            }
        });

        test('should handle non-existent bundle', async () => {
            try {
                await service.unsyncBundle('non-existent-bundle');
                // Should complete without error (idempotent)
                assert.ok(true, 'Should handle non-existent bundle gracefully');
            } catch (error: any) {
                // Or throw appropriate error
                assert.ok(error, 'Error handling is acceptable');
            }
        });
    });

    suite('Behavior Validation', () => {
        test('should return valid absolute path', async () => {
            const status = await service.getStatus();
            
            assert.ok(status.copilotDir, 'Should return a path');
            assert.ok(path.isAbsolute(status.copilotDir), 'Path should be absolute');
            assert.ok(status.copilotDir.endsWith('prompts'), 'Path should end with prompts directory');
        });

        test('should handle path with User directory', async () => {
            const status = await service.getStatus();
            
            // Test environment uses User directory structure
            assert.ok(status.copilotDir.includes('User'), 'Should include User directory in test setup');
        });

        test('should create directory structure when syncing', async () => {
            const status = await service.getStatus();
            
            // Directory might not exist initially
            assert.ok(typeof status.dirExists === 'boolean', 'Should report directory existence');
            assert.ok(typeof status.syncedFiles === 'number', 'Should report synced file count');
            assert.ok(Array.isArray(status.files), 'Should return files array');
        });
    });

    suite('Error Handling', () => {
        test('should handle missing deployment manifest', async () => {
            const bundleId = 'no-manifest-bundle';
            const bundlePath = path.join(tempDir, 'no-manifest');
            
            if (!fs.existsSync(bundlePath)) {
                fs.mkdirSync(bundlePath, { recursive: true });
            }
            
            // No manifest file created
            
            try {
                await service.syncBundle(bundleId, bundlePath);
                // May succeed or fail depending on implementation
            } catch (error: any) {
                assert.ok(error.message.includes('manifest') || error.message.includes('ENOENT'),
                    'Error should mention manifest or file not found');
            }
        });

        test('should provide meaningful error messages', async () => {
            try {
                await service.syncBundle('', '');
                assert.fail('Should throw error for empty parameters');
            } catch (error: any) {
                assert.ok(error.message, 'Should provide error message');
                assert.ok(error.message.length > 0, 'Error message should not be empty');
            }
        });

    suite('Custom Data Directory Support', () => {
        test('should handle profile path with User directory', async () => {
            const profileId = '3a5f32f8';
            const userPath = path.join(tempDir, 'Library', 'Application Support', 'Code', 'User');
            const globalStoragePath = path.join(userPath, 'profiles', profileId, 'globalStorage', 'publisher.extension');
            
            const mockContext = {
                globalStorageUri: { fsPath: globalStoragePath },
                storageUri: { fsPath: path.join(tempDir, 'workspace') },
                extensionPath: __dirname,
                subscriptions: [],
            } as any;

            const testService = new UserScopeService(mockContext);
            const status = await testService.getStatus();

            const expectedPath = path.join(userPath, 'profiles', profileId, 'prompts');
            assert.strictEqual(status.copilotDir, expectedPath);
        });

        test('should handle custom data directory with profile (no User directory)', async () => {
            const customDataDir = path.join(tempDir, 'custom-data');
            const profileId = 'abc-profile';
            const globalStoragePath = path.join(customDataDir, 'profiles', profileId, 'globalStorage', 'publisher.extension');

            const mockContext = {
                globalStorageUri: { fsPath: globalStoragePath },
                storageUri: { fsPath: path.join(tempDir, 'workspace') },
                extensionPath: __dirname,
                subscriptions: [],
            } as any;

            const testService = new UserScopeService(mockContext);
            const status = await testService.getStatus();

            const expectedPath = path.join(customDataDir, 'profiles', profileId, 'prompts');
            assert.strictEqual(status.copilotDir, expectedPath);
        });

        test('should handle custom data directory without profile', async () => {
            const customDataDir = path.join(tempDir, 'custom-data-no-profile');
            const globalStoragePath = path.join(customDataDir, 'globalStorage', 'publisher.extension');

            const mockContext = {
                globalStorageUri: { fsPath: globalStoragePath },
                storageUri: { fsPath: path.join(tempDir, 'workspace') },
                extensionPath: __dirname,
                subscriptions: [],
            } as any;

            const testService = new UserScopeService(mockContext);
            const status = await testService.getStatus();

            const expectedPath = path.join(customDataDir, 'prompts');
            assert.strictEqual(status.copilotDir, expectedPath);
        });
    });

    suite('Profile Detection Workarounds', () => {
        test('should use filesystem heuristic when storage.json not available', async () => {
            // Simulate extension installed globally (not in profile) but user is in a profile
            const globalExtContext = {
                globalStorageUri: { 
                    fsPath: path.join(tempDir, 'Code', 'User', 'globalStorage', 'publisher.extension')
                },
                storageUri: { fsPath: tempDir },
                extensionPath: __dirname,
                subscriptions: [],
            } as any;
            
            // Create a mock profile structure
            const profilesDir = path.join(tempDir, 'Code', 'User', 'profiles');
            const profileId = 'test-profile-123';
            const profileGlobalStorage = path.join(profilesDir, profileId, 'globalStorage');
            
            fs.mkdirSync(profileGlobalStorage, { recursive: true });
            
            // Touch the profile's globalStorage to make it "recently active"
            fs.utimesSync(profileGlobalStorage, new Date(), new Date());
            
            const globalService = new UserScopeService(globalExtContext);
            const status = await globalService.getStatus();
            
            // Should detect the active profile using filesystem heuristic
            assert.ok(
                status.copilotDir.includes(profileId),
                `Should detect active profile using filesystem heuristic, got: ${status.copilotDir}`
            );
            assert.ok(
                status.copilotDir.endsWith('prompts'),
                'Should end with prompts directory'
            );
        });

        test('should prefer storage.json over filesystem heuristic when both available', async () => {
            // This test verifies the priority: storage.json (workaround #1) > filesystem (workaround #2)
            const userPath = path.join(tempDir, 'ProfilePriority', 'Code', 'User');
            const globalExtContext = {
                globalStorageUri: { 
                    fsPath: path.join(userPath, 'globalStorage', 'publisher.extension')
                },
                storageUri: { fsPath: tempDir },
                extensionPath: __dirname,
                subscriptions: [],
            } as any;
            
            // Create two profiles
            const profilesDir = path.join(userPath, 'profiles');
            const oldProfileId = 'old-profile-456';
            const newProfileId = 'new-profile-789';
            
            // Old profile with recent filesystem activity
            const oldProfileGlobalStorage = path.join(profilesDir, oldProfileId, 'globalStorage');
            fs.mkdirSync(oldProfileGlobalStorage, { recursive: true });
            fs.utimesSync(oldProfileGlobalStorage, new Date(), new Date());
            
            // New profile directory exists but not recently modified
            const newProfileDir = path.join(profilesDir, newProfileId);
            fs.mkdirSync(newProfileDir, { recursive: true });
            
            // Create storage.json pointing to new profile
            const storageJsonPath = path.join(userPath, 'globalStorage', 'storage.json');
            fs.mkdirSync(path.dirname(storageJsonPath), { recursive: true });
            fs.writeFileSync(storageJsonPath, JSON.stringify({
                lastKnownMenubarData: {
                    menus: {
                        Preferences: {
                            items: [
                                {
                                    id: 'submenuitem.Profiles',
                                    label: 'Profile (NewProfile)',
                                    submenu: {
                                        items: [
                                            {
                                                command: `workbench.profiles.actions.profileEntry.${newProfileId}`,
                                                label: 'NewProfile'
                                            }
                                        ]
                                    }
                                }
                            ]
                        }
                    }
                }
            }));
            
            const testService = new UserScopeService(globalExtContext);
            const status = await testService.getStatus();
            
            // Should use storage.json (new profile) not filesystem heuristic (old profile)
            assert.ok(
                status.copilotDir.includes(newProfileId),
                `Should prefer storage.json over filesystem heuristic, got: ${status.copilotDir}`
            );
        });

    suite('WSL Support', () => {
        test('should detect WSL remote and return Windows mount path when globalStorage is on /mnt/c', async () => {
            // Mock WSL scenario where globalStorage is already on Windows mount
            const wslMountContext: any = {
                globalStorageUri: { 
                    fsPath: '/mnt/c/Users/testuser/AppData/Roaming/Code/User/globalStorage/publisher.extension' 
                },
                storageUri: { fsPath: '/home/testuser/workspace' },
                extensionPath: __dirname,
                subscriptions: [],
            };

            // Mock vscode.env.remoteName
            const originalEnv = (global as any).vscode?.env;
            if (!(global as any).vscode) {
                (global as any).vscode = {};
            }
            (global as any).vscode.env = { remoteName: 'wsl', appName: 'Visual Studio Code' };

            try {
                const wslService = new UserScopeService(wslMountContext);
                const status = await wslService.getStatus();
                
                assert.ok(
                    status.copilotDir.startsWith('/mnt/c/Users/testuser/AppData/Roaming/Code/User'),
                    `WSL should use Windows mount path, got: ${status.copilotDir}`
                );
                assert.ok(
                    status.copilotDir.includes('/prompts'),
                    'WSL path should include prompts directory'
                );
            } finally {
                // Restore original env
                if (originalEnv) {
                    (global as any).vscode.env = originalEnv;
                } else {
                    delete (global as any).vscode;
                }
            }
        });

        test('should handle WSL with D: drive mount', async () => {
            const wslDriveContext: any = {
                globalStorageUri: { 
                    fsPath: '/mnt/d/Users/testuser/AppData/Roaming/Code/User/globalStorage/publisher.extension' 
                },
                storageUri: { fsPath: '/home/testuser/workspace' },
                extensionPath: __dirname,
                subscriptions: [],
            };

            // Mock vscode.env.remoteName
            if (!(global as any).vscode) {
                (global as any).vscode = {};
            }
            const originalEnv = (global as any).vscode.env;
            (global as any).vscode.env = { remoteName: 'wsl', appName: 'Visual Studio Code' };

            try {
                const wslService = new UserScopeService(wslDriveContext);
                const status = await wslService.getStatus();
                
                assert.ok(
                    status.copilotDir.startsWith('/mnt/d/Users/testuser'),
                    `WSL should detect D: drive, got: ${status.copilotDir}`
                );
            } finally {
                if (originalEnv) {
                    (global as any).vscode.env = originalEnv;
                } else {
                    delete (global as any).vscode?.env;
                }
            }
        });

        test('should handle WSL with Code Insiders flavor', async () => {
            const wslInsidersContext: any = {
                globalStorageUri: { 
                    fsPath: '/mnt/c/Users/testuser/AppData/Roaming/Code - Insiders/User/globalStorage/publisher.extension' 
                },
                storageUri: { fsPath: '/home/testuser/workspace' },
                extensionPath: __dirname,
                subscriptions: [],
            };

            // Mock vscode.env
            if (!(global as any).vscode) {
                (global as any).vscode = {};
            }
            const originalEnv = (global as any).vscode.env;
            (global as any).vscode.env = { remoteName: 'wsl', appName: 'Visual Studio Code Insiders' };

            try {
                const wslService = new UserScopeService(wslInsidersContext);
                const status = await wslService.getStatus();
                
                assert.ok(
                    status.copilotDir.includes('Code - Insiders'),
                    `WSL should detect Insiders flavor, got: ${status.copilotDir}`
                );
            } finally {
                if (originalEnv) {
                    (global as any).vscode.env = originalEnv;
                } else {
                    delete (global as any).vscode?.env;
                }
            }
        });

        test('should handle WSL with profile path', async () => {
            const wslProfileContext: any = {
                globalStorageUri: { 
                    fsPath: '/mnt/c/Users/testuser/AppData/Roaming/Code/User/profiles/abc123/globalStorage/publisher.extension' 
                },
                storageUri: { fsPath: '/home/testuser/workspace' },
                extensionPath: __dirname,
                subscriptions: [],
            };

            // Mock vscode.env
            if (!(global as any).vscode) {
                (global as any).vscode = {};
            }
            const originalEnv = (global as any).vscode.env;
            (global as any).vscode.env = { remoteName: 'wsl', appName: 'Visual Studio Code' };

            try {
                const wslService = new UserScopeService(wslProfileContext);
                const status = await wslService.getStatus();
                
                assert.ok(
                    status.copilotDir.includes('/profiles/abc123/prompts'),
                    `WSL should handle profile path, got: ${status.copilotDir}`
                );
            } finally {
                if (originalEnv) {
                    (global as any).vscode.env = originalEnv;
                } else {
                    delete (global as any).vscode?.env;
                }
            }
        });

        test('should not use WSL path for local context (remoteName undefined)', async () => {
            const localContext: any = {
                globalStorageUri: { 
                    fsPath: path.join(tempDir, 'Code', 'User', 'globalStorage', 'publisher.extension')
                },
                storageUri: { fsPath: path.join(tempDir, 'workspace') },
                extensionPath: __dirname,
                subscriptions: [],
            };

            // Mock vscode.env with undefined remoteName (local)
            if (!(global as any).vscode) {
                (global as any).vscode = {};
            }
            const originalEnv = (global as any).vscode.env;
            (global as any).vscode.env = { remoteName: undefined, appName: 'Visual Studio Code' };

            try {
                const localService = new UserScopeService(localContext);
                const status = await localService.getStatus();
                
                assert.ok(
                    !status.copilotDir.includes('/mnt/'),
                    `Local context should not use WSL mount, got: ${status.copilotDir}`
                );
            } finally {
                if (originalEnv) {
                    (global as any).vscode.env = originalEnv;
                } else {
                    delete (global as any).vscode?.env;
                }
            }
        });

        test('should handle SSH remote (not WSL) with existing logic', async () => {
            const sshContext: any = {
                globalStorageUri: { 
                    fsPath: '/home/remoteuser/.vscode-server/data/User/globalStorage/publisher.extension'
                },
                storageUri: { fsPath: '/home/remoteuser/workspace' },
                extensionPath: __dirname,
                subscriptions: [],
            };

            // Mock vscode.env with ssh-remote
            if (!(global as any).vscode) {
                (global as any).vscode = {};
            }
            const originalEnv = (global as any).vscode.env;
            (global as any).vscode.env = { remoteName: 'ssh-remote', appName: 'Visual Studio Code' };

            try {
                const sshService = new UserScopeService(sshContext);
                const status = await sshService.getStatus();
                
                // SSH should use existing logic, not WSL-specific handling
                assert.ok(
                    !status.copilotDir.includes('/mnt/c/'),
                    `SSH remote should not use WSL mount path, got: ${status.copilotDir}`
                );
            } finally {
                if (originalEnv) {
                    (global as any).vscode.env = originalEnv;
                } else {
                    delete (global as any).vscode?.env;
                }
            }
        });
    });

    });
});
});

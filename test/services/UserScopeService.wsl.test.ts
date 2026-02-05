/**
 * UserScopeService WSL Support Tests
 * Tests WSL-specific path resolution and remote environment handling
 * 
 * Separated from main UserScopeService tests for clarity
 */

import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import { UserScopeService } from '../../src/services/UserScopeService';

suite('UserScopeService - WSL Support', () => {
    let tempDir: string;

    setup(() => {
        tempDir = path.join(__dirname, '..', '..', '..', 'test-temp-wsl');
        
        // Create temp directories
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }
    });

    teardown(() => {
        // Cleanup temp directories
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
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

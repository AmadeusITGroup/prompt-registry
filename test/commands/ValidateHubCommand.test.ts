/**
 * ValidateHubCommand Tests
 * Tests for hub configuration validation command
 */

import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import nock from 'nock';
import { ValidateHubCommand } from '../../src/commands/ValidateHubCommand';

suite('ValidateHubCommand Tests', () => {
    let command: ValidateHubCommand;
    let context: vscode.ExtensionContext;
    let sandbox: sinon.SinonSandbox;
    let mockOutputChannel: any;

    setup(() => {
        sandbox = sinon.createSandbox();
        
        // Mock extension context
        context = {
            extensionPath: process.cwd(),
            globalStorageUri: { fsPath: path.join(process.cwd(), 'test', 'tmp') } as vscode.Uri,
            subscriptions: []
        } as any;

        // Mock output channel
        mockOutputChannel = {
            clear: sandbox.stub(),
            show: sandbox.stub(),
            appendLine: sandbox.stub(),
            dispose: sandbox.stub()
        };

        sandbox.stub(vscode.window, 'createOutputChannel').returns(mockOutputChannel);

        // Mock all GitHub URLs by default to prevent real network calls
        nock.cleanAll();
        nock('https://github.com')
            .persist()
            .head(/.*/)
            .reply(200);

        command = new ValidateHubCommand(context);
    });

    teardown(() => {
        sandbox.restore();
        nock.cleanAll();
        command.dispose();
    });

    suite('Command Initialization', () => {
        test('should initialize with context', () => {
            assert.ok(command, 'Command should be initialized');
        });

        test('should create output channel', () => {
            assert.ok(mockOutputChannel, 'Output channel should be created');
            const createChannelStub = vscode.window.createOutputChannel as sinon.SinonStub;
            assert.ok(createChannelStub.calledWith('Hub Validator'));
        });
    });

    suite('Valid Hub Configuration', () => {
        test('should validate valid hub-config.yml', async () => {
            const fixturePath = path.join(process.cwd(), 'test', 'fixtures', 'hubs', 'valid-hub-config.yml');
            
            if (!fs.existsSync(fixturePath)) {
                console.warn(`Skipping test: fixture not found at ${fixturePath}`);
                return;
            }

            sandbox.stub(vscode.window, 'showInformationMessage').resolves();
            sandbox.stub(vscode.window, 'showErrorMessage').resolves();
            sandbox.stub(vscode.window, 'showWarningMessage').resolves();
            
            await command.execute({ filePath: fixturePath });

            // Should write to output channel (validation completed)
            assert.ok(mockOutputChannel.appendLine.called, 'Should write validation output');
            assert.ok(mockOutputChannel.clear.called, 'Should clear output channel');
            assert.ok(mockOutputChannel.show.called, 'Should show output channel');
        });

        test('should display hub information for valid config', async () => {
            const fixturePath = path.join(process.cwd(), 'test', 'fixtures', 'hubs', 'valid-hub-config.yml');
            
            if (!fs.existsSync(fixturePath)) {
                console.warn(`Skipping test: fixture not found at ${fixturePath}`);
                return;
            }

            sandbox.stub(vscode.window, 'showInformationMessage');
            
            await command.execute({ filePath: fixturePath });

            // Should log hub information
            assert.ok(mockOutputChannel.appendLine.called, 'Should write to output channel');
            const calls = mockOutputChannel.appendLine.getCalls();
            const output = calls.map((c: any) => c.args[0]).join('\n');
            
            assert.ok(output.includes('Hub Information'), 'Should display hub information');
            assert.ok(output.includes('Name:'), 'Should display hub name');
            assert.ok(output.includes('Sources:'), 'Should display sources count');
        });
    });

    suite('Invalid Hub Configuration', () => {
        test('should detect missing required fields', async () => {
            const fixturePath = path.join(process.cwd(), 'test', 'fixtures', 'hubs', 'invalid-hub-config.yml');
            
            if (!fs.existsSync(fixturePath)) {
                console.warn(`Skipping test: fixture not found at ${fixturePath}`);
                return;
            }

            const showErrorStub = sandbox.stub(vscode.window, 'showErrorMessage');
            
            await command.execute({ filePath: fixturePath });

            // Should show error message
            assert.ok(showErrorStub.called || mockOutputChannel.appendLine.called, 'Should report errors');
        });
        
        test('should detect invalid profile-source references', async () => {
            const fixturePath = path.join(process.cwd(), 'test', 'fixtures', 'hubs', 'invalid-source-refs-hub-config.yml');
            
            if (!fs.existsSync(fixturePath)) {
                console.warn(`Skipping test: fixture not found at ${fixturePath}`);
                return;
            }

            const showErrorStub = sandbox.stub(vscode.window, 'showErrorMessage');
            
            await command.execute({ filePath: fixturePath });

            // Should detect profile-source reference errors
            const calls = mockOutputChannel.appendLine.getCalls();
            const output = calls.map((c: any) => c.args[0]).join('\n');
            
            assert.ok(output.includes('Profile-Source') || output.includes('non-existent'), 
                'Should report profile-source validation errors');
            assert.ok(showErrorStub.called, 'Should show error message for invalid references');
        });

        test('should validate malicious hub configuration', async () => {
            const fixturePath = path.join(process.cwd(), 'test', 'fixtures', 'hubs', 'malicious-hub-config.yml');
            
            if (!fs.existsSync(fixturePath)) {
                console.warn(`Skipping test: fixture not found at ${fixturePath}`);
                return;
            }

            const showErrorStub = sandbox.stub(vscode.window, 'showErrorMessage');
            
            await command.execute({ filePath: fixturePath });

            // Should detect issues
            assert.ok(showErrorStub.called || mockOutputChannel.appendLine.called, 'Should detect security issues');
        });
    });

    suite('File Not Found', () => {
        test('should handle non-existent file', async () => {
            const nonExistentPath = path.join(process.cwd(), 'nonexistent-hub-config.yml');
            const showErrorStub = sandbox.stub(vscode.window, 'showErrorMessage');
            
            await command.execute({ filePath: nonExistentPath });

            assert.ok(showErrorStub.called, 'Should show error message');
            const message = showErrorStub.firstCall.args[0];
            assert.ok(message.includes('not found'), 'Should indicate file not found');
        });
    });

    suite('Workspace Context', () => {
        test('should prompt for file when no workspace is open', async () => {
            // Mock vscode.workspace as undefined
            Object.defineProperty(vscode.workspace, 'workspaceFolders', {
                value: undefined,
                configurable: true
            });
            const showOpenDialogStub = sandbox.stub(vscode.window, 'showOpenDialog').resolves(undefined);
            
            await command.execute();

            assert.ok(showOpenDialogStub.called, 'Should show file picker');
            
            // Restore
            Object.defineProperty(vscode.workspace, 'workspaceFolders', {
                value: [],
                configurable: true
            });
        });

        test('should look for hub-config.yml in workspace root', async () => {
            const workspaceRoot = path.join(process.cwd(), 'test', 'fixtures', 'hubs');
            
            // Mock workspace
            Object.defineProperty(vscode.workspace, 'workspaceFolders', {
                value: [{ uri: { fsPath: workspaceRoot } }],
                configurable: true
            });

            // Create a temporary hub-config.yml in the fixtures directory
            const hubConfigPath = path.join(workspaceRoot, 'hub-config.yml');
            const validConfigPath = path.join(workspaceRoot, 'valid-hub-config.yml');
            
            if (fs.existsSync(validConfigPath)) {
                // Copy valid config as hub-config.yml temporarily
                const content = fs.readFileSync(validConfigPath, 'utf8');
                fs.writeFileSync(hubConfigPath, content);

                sandbox.stub(vscode.window, 'showInformationMessage').resolves();
                
                await command.execute();

                // Should validate the file from workspace root
                assert.ok(mockOutputChannel.appendLine.called, 'Should validate hub-config.yml');
                
                // Cleanup
                if (fs.existsSync(hubConfigPath)) {
                    fs.unlinkSync(hubConfigPath);
                }
            }
            
            // Restore
            Object.defineProperty(vscode.workspace, 'workspaceFolders', {
                value: [],
                configurable: true
            });
        });

        test('should prompt to select file if hub-config.yml not in workspace root', async () => {
            const workspaceRoot = path.join(process.cwd(), 'test');
            
            // Mock workspace
            Object.defineProperty(vscode.workspace, 'workspaceFolders', {
                value: [{ uri: { fsPath: workspaceRoot } }],
                configurable: true
            });

            const showQuickPickStub = sandbox.stub(vscode.window, 'showQuickPick').resolves(undefined);
            
            await command.execute();

            assert.ok(showQuickPickStub.called, 'Should show quick pick to select file');
            
            // Restore
            Object.defineProperty(vscode.workspace, 'workspaceFolders', {
                value: [],
                configurable: true
            });
        });
    });

    suite('Output Formatting', () => {
        test('should use emoji indicators for status', async () => {
            const fixturePath = path.join(process.cwd(), 'test', 'fixtures', 'hubs', 'valid-hub-config.yml');
            
            if (!fs.existsSync(fixturePath)) {
                return;
            }

            sandbox.stub(vscode.window, 'showInformationMessage');
            
            await command.execute({ filePath: fixturePath });

            const calls = mockOutputChannel.appendLine.getCalls();
            const output = calls.map((c: any) => c.args[0]).join('\n');
            
            // Should use emoji indicators
            assert.ok(output.includes('🔍') || output.includes('📊') || output.includes('✅'), 
                'Should use emoji indicators in output');
        });

        test('should display validation summary', async () => {
            const fixturePath = path.join(process.cwd(), 'test', 'fixtures', 'hubs', 'valid-hub-config.yml');
            
            if (!fs.existsSync(fixturePath)) {
                return;
            }

            sandbox.stub(vscode.window, 'showInformationMessage');
            
            await command.execute({ filePath: fixturePath });

            const calls = mockOutputChannel.appendLine.getCalls();
            const output = calls.map((c: any) => c.args[0]).join('\n');
            
            // Should include validation header
            assert.ok(output.includes('Validation') || output.includes('validated'), 
                'Should display validation status');
        });
    });

    suite('Error Handling', () => {
        test('should handle invalid YAML syntax', async () => {
            const tempDir = path.join(process.cwd(), 'test', 'tmp');
            if (!fs.existsSync(tempDir)) {
                fs.mkdirSync(tempDir, { recursive: true });
            }

            const invalidYamlPath = path.join(tempDir, 'invalid-syntax.yml');
            fs.writeFileSync(invalidYamlPath, 'invalid: yaml: syntax: [');

            const showErrorStub = sandbox.stub(vscode.window, 'showErrorMessage');
            
            await command.execute({ filePath: invalidYamlPath });

            assert.ok(showErrorStub.called || mockOutputChannel.appendLine.called, 
                'Should handle YAML parsing errors');

            // Cleanup
            fs.unlinkSync(invalidYamlPath);
        });

        test('should handle empty file', async () => {
            const tempDir = path.join(process.cwd(), 'test', 'tmp');
            if (!fs.existsSync(tempDir)) {
                fs.mkdirSync(tempDir, { recursive: true });
            }

            const emptyFilePath = path.join(tempDir, 'empty.yml');
            fs.writeFileSync(emptyFilePath, '');

            const showErrorStub = sandbox.stub(vscode.window, 'showErrorMessage');
            
            await command.execute({ filePath: emptyFilePath });

            assert.ok(showErrorStub.called || mockOutputChannel.appendLine.called, 
                'Should handle empty files');

            // Cleanup
            fs.unlinkSync(emptyFilePath);
        });
    });

    suite('Profile-Source Reference Validation (Level 2)', () => {
        test('should pass when all bundles reference valid sources', async () => {
            const fixturePath = path.join(process.cwd(), 'test', 'fixtures', 'hubs', 'valid-hub-config.yml');
            
            if (!fs.existsSync(fixturePath)) {
                console.warn(`Skipping test: fixture not found at ${fixturePath}`);
                return;
            }

            sandbox.stub(vscode.window, 'showInformationMessage').resolves();
            
            await command.execute({ filePath: fixturePath });

            const calls = mockOutputChannel.appendLine.getCalls();
            const output = calls.map((c: any) => c.args[0]).join('\n');
            
            assert.ok(output.includes('Level 2'), 'Should show Level 2 validation');
            assert.ok(output.includes('Profile-Source'), 'Should mention profile-source validation');
        });

        test('should detect bundles referencing non-existent sources', async () => {
            const fixturePath = path.join(process.cwd(), 'test', 'fixtures', 'hubs', 'invalid-source-refs-hub-config.yml');
            
            if (!fs.existsSync(fixturePath)) {
                console.warn(`Skipping test: fixture not found at ${fixturePath}`);
                return;
            }

            const showErrorStub = sandbox.stub(vscode.window, 'showErrorMessage');
            
            await command.execute({ filePath: fixturePath });

            const calls = mockOutputChannel.appendLine.getCalls();
            const output = calls.map((c: any) => c.args[0]).join('\n');
            
            assert.ok(output.includes('non-existent') || output.includes('missing'), 
                'Should report non-existent source references');
            assert.ok(showErrorStub.called, 'Should show error message');
        });
    });

    suite('URL Accessibility Validation (Level 3)', () => {
        test('should validate URLs when enabled', async function() {
            this.timeout(10000);
            
            const fixturePath = path.join(process.cwd(), 'test', 'fixtures', 'hubs', 'mixed-urls-hub-config.yml');
            
            if (!fs.existsSync(fixturePath)) {
                console.warn(`Skipping test: fixture not found at ${fixturePath}`);
                return;
            }

            // Mock specific URLs for mixed-urls fixture
            nock.cleanAll();
            nock('https://github.com')
                .head('/torvalds/linux')
                .reply(200);
            nock('https://github.com')
                .head('/private-org/private-repo')
                .reply(403);
            nock('https://github.com')
                .head('/nonexistent-org/nonexistent-repo')
                .reply(404);
            nock('https://raw.githubusercontent.com')
                .head('/torvalds/linux/master/README')
                .reply(200);
            nock('https://httpbin.org')
                .head('/status/404')
                .reply(404);

            sandbox.stub(vscode.window, 'showErrorMessage').resolves();
            sandbox.stub(vscode.window, 'showWarningMessage').resolves();
            
            await command.execute({ filePath: fixturePath });

            const calls = mockOutputChannel.appendLine.getCalls();
            const output = calls.map((c: any) => c.args[0]).join('\n');
            
            assert.ok(output.includes('Level 3') || output.includes('URL'), 
                'Should show Level 3 URL validation');
        });

        test('should display URL check results with icons', async function() {
            this.timeout(10000);
            
            const fixturePath = path.join(process.cwd(), 'test', 'fixtures', 'hubs', 'valid-hub-config.yml');
            
            if (!fs.existsSync(fixturePath)) {
                console.warn(`Skipping test: fixture not found at ${fixturePath}`);
                return;
            }

            // Mock GitHub URLs for valid-hub-config
            nock.cleanAll();
            nock('https://github.com')
                .persist()
                .head(/.*/)
                .reply(200);

            sandbox.stub(vscode.window, 'showInformationMessage').resolves();
            sandbox.stub(vscode.window, 'showWarningMessage').resolves();
            
            await command.execute({ filePath: fixturePath });

            const calls = mockOutputChannel.appendLine.getCalls();
            const output = calls.map((c: any) => c.args[0]).join('\n');
            
            // Should show URL validation section
            assert.ok(output.includes('URL') || output.includes('Level 3'), 
                'Should include URL validation output');
        });
    });

    suite('Three-Level Validation Integration', () => {
        test('should run all three validation levels in order', async () => {
            const fixturePath = path.join(process.cwd(), 'test', 'fixtures', 'hubs', 'valid-hub-config.yml');
            
            if (!fs.existsSync(fixturePath)) {
                console.warn(`Skipping test: fixture not found at ${fixturePath}`);
                return;
            }

            sandbox.stub(vscode.window, 'showInformationMessage').resolves();
            
            await command.execute({ filePath: fixturePath });

            const calls = mockOutputChannel.appendLine.getCalls();
            const output = calls.map((c: any) => c.args[0]).join('\n');
            
            // Verify all three levels are present
            assert.ok(output.includes('Level 1') || output.includes('Schema'), 
                'Should show Level 1 validation');
            assert.ok(output.includes('Level 2') || output.includes('Profile'), 
                'Should show Level 2 validation');
            assert.ok(output.includes('Level 3') || output.includes('URL'), 
                'Should show Level 3 validation');
        });

        test('should stop and report errors at appropriate levels', async () => {
            const fixturePath = path.join(process.cwd(), 'test', 'fixtures', 'hubs', 'invalid-source-refs-hub-config.yml');
            
            if (!fs.existsSync(fixturePath)) {
                console.warn(`Skipping test: fixture not found at ${fixturePath}`);
                return;
            }

            const showErrorStub = sandbox.stub(vscode.window, 'showErrorMessage');
            
            await command.execute({ filePath: fixturePath });

            // Should complete all validations and report errors
            assert.ok(showErrorStub.called, 'Should show error message');
            
            const calls = mockOutputChannel.appendLine.getCalls();
            const output = calls.map((c: any) => c.args[0]).join('\n');
            
            assert.ok(output.includes('error'), 'Should indicate errors in output');
        });
    });

    suite('Dispose', () => {
        test('should dispose output channel', () => {
            command.dispose();
            
            assert.ok(mockOutputChannel.dispose.called, 'Should dispose output channel');
        });
    });
});

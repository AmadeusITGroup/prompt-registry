/**
 * Unit tests for ValidatePluginsCommand.
 *
 * The command requires vscode workspace APIs. We mock `workspaceFolders` with sinon
 * so that the command operates against the real local-awesome-plugins test fixtures,
 * exercising the actual validation and file-reference logic without a real VS Code host.
 */

import * as assert from 'node:assert';
import * as path from 'node:path';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import {
  ValidatePluginsCommand,
} from '../../src/commands/validate-plugins-command';

const FIXTURES_DIR = path.resolve(__dirname, '../fixtures/local-awesome-plugins');
const EXTENSION_PATH = path.resolve(process.cwd());

function makeContext(extensionPath = EXTENSION_PATH): vscode.ExtensionContext {
  return {
    extensionPath,
    extensionUri: vscode.Uri.file(extensionPath),
    globalStorageUri: vscode.Uri.file('/tmp/test-storage'),
    globalState: {
      get: () => undefined,
      update: async () => undefined,
      keys: () => [],
      setKeysForSync: () => undefined
    },
    workspaceState: { get: () => undefined, update: async () => undefined, keys: () => [] },
    subscriptions: [],
    secrets: {} as any,
    storagePath: '/tmp/test-storage',
    globalStoragePath: '/tmp/test-storage',
    logPath: '/tmp/test-logs',
    extensionMode: 3, // ExtensionMode.Test = 3
    logUri: vscode.Uri.file('/tmp/test-logs'),
    storageUri: vscode.Uri.file('/tmp/test-storage'),
    asAbsolutePath: (rel: string) => path.join(extensionPath, rel),
    environmentVariableCollection: {} as any,
    extension: {} as any,
    languageModelAccessInformation: {} as any
  } as unknown as vscode.ExtensionContext;
}

suite('ValidatePluginsCommand', () => {
  let sandbox: sinon.SinonSandbox;
  let workspaceFoldersStub: sinon.SinonStub;
  let infoMessages: string[];
  let errorMessages: string[];
  let warnMessages: string[];

  setup(() => {
    sandbox = sinon.createSandbox();
    infoMessages = [];
    errorMessages = [];
    warnMessages = [];

    sandbox.stub(vscode.window, 'showInformationMessage').callsFake((msg: string) => {
      infoMessages.push(msg);
      return Promise.resolve(undefined);
    });
    sandbox.stub(vscode.window, 'showErrorMessage').callsFake((msg: string) => {
      errorMessages.push(msg);
      return Promise.resolve(undefined);
    });
    sandbox.stub(vscode.window, 'showWarningMessage').callsFake((msg: string) => {
      warnMessages.push(msg);
      return Promise.resolve(undefined);
    });

    workspaceFoldersStub = sandbox.stub(vscode.workspace, 'workspaceFolders').value([
      { uri: vscode.Uri.file(FIXTURES_DIR), name: 'local-awesome-plugins', index: 0 }
    ]);
  });

  teardown(() => {
    sandbox.restore();
  });

  suite('execute()', () => {
    test('reports no workspace when workspaceFolders is empty', async () => {
      workspaceFoldersStub.value(undefined);
      const cmd = new ValidatePluginsCommand(makeContext());
      await cmd.execute();
      cmd.dispose();

      assert.ok(errorMessages.some((m) => m.includes('No workspace')));
    });

    test('reports error when plugins directory does not exist', async () => {
      workspaceFoldersStub.value([
        { uri: vscode.Uri.file('/tmp/no-such-dir-99999'), name: 'test', index: 0 }
      ]);
      const cmd = new ValidatePluginsCommand(makeContext());
      await cmd.execute();
      cmd.dispose();

      assert.ok(errorMessages.some((m) => m.includes('Plugins directory not found')));
    });

    test('succeeds with valid fixture plugins (no error messages)', async () => {
      const cmd = new ValidatePluginsCommand(makeContext());
      await cmd.execute();
      cmd.dispose();

      // Fixture plugins are structurally valid — no schema errors expected
      // (may produce best-practice warnings about missing version/author)
      assert.strictEqual(errorMessages.length, 0, `Unexpected errors: ${errorMessages.join(', ')}`);
      assert.ok(infoMessages.length > 0 || warnMessages.length > 0, 'Expected either info or warning message');
    });

    test('listOnly mode does not show validation success/error messages', async () => {
      const cmd = new ValidatePluginsCommand(makeContext());
      await cmd.execute({ listOnly: true });
      cmd.dispose();

      // List-only shows no pop-up messages
      assert.strictEqual(infoMessages.length, 0);
      assert.strictEqual(errorMessages.length, 0);
    });
  });

  suite('schema validation', () => {
    test('validates plugin.json with mcpServers without errors', async () => {
      const cmd = new ValidatePluginsCommand(makeContext());
      await cmd.execute();
      cmd.dispose();

      // mcp-plugin fixture has mcpServers — must not cause a validation error
      assert.strictEqual(errorMessages.length, 0, `Unexpected errors: ${errorMessages.join(', ')}`);
    });

    test('validates upstream plugin format (agents/skills arrays, no items) without errors', async () => {
      const cmd = new ValidatePluginsCommand(makeContext());
      await cmd.execute();
      cmd.dispose();

      // upstream-plugin uses agents/skills arrays, not items — must be valid
      assert.strictEqual(errorMessages.length, 0);
    });
  });
});

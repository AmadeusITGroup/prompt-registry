import * as assert from 'node:assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import {
  NpmCliWrapper,
} from '../../src/utils/NpmCliWrapper';
import {
  createErrorProcess,
  createFailureProcess,
  createMockProcess,
  createSuccessProcess,
} from '../helpers/processTestHelpers';

suite('NpmCliWrapper', () => {
  let sandbox: sinon.SinonSandbox;
  let npmWrapper: NpmCliWrapper;
  // Use require to get a stubbable reference to child_process

  const childProcess = require('node:child_process');

  setup(() => {
    sandbox = sinon.createSandbox();
    npmWrapper = NpmCliWrapper.getInstance();
  });

  teardown(() => {
    sandbox.restore();
  });

  suite('getInstance()', () => {
    test('should return singleton instance', () => {
      const instance1 = NpmCliWrapper.getInstance();
      const instance2 = NpmCliWrapper.getInstance();
      assert.strictEqual(instance1, instance2);
    });
  });

  suite('isAvailable()', () => {
    test('should return true when npm is available', async () => {
      const { process, emitEvents } = createSuccessProcess();
      sandbox.stub(childProcess, 'spawn').returns(process as any);

      const resultPromise = npmWrapper.isAvailable();
      emitEvents();

      const result = await resultPromise;
      assert.strictEqual(result, true);
    });

    test('should return false when npm is not available', async () => {
      const { process, emitEvents } = createFailureProcess(1);
      sandbox.stub(childProcess, 'spawn').returns(process as any);

      const resultPromise = npmWrapper.isAvailable();
      emitEvents();

      const result = await resultPromise;
      assert.strictEqual(result, false);
    });

    test('should return false when spawn errors', async () => {
      const { process, emitEvents } = createErrorProcess(new Error('ENOENT'));
      sandbox.stub(childProcess, 'spawn').returns(process as any);

      const resultPromise = npmWrapper.isAvailable();
      emitEvents();

      const result = await resultPromise;
      assert.strictEqual(result, false);
    });
  });

  suite('getVersion()', () => {
    test('should return version string when npm is available', async () => {
      const { process, emitEvents } = createSuccessProcess('10.2.3\n');
      sandbox.stub(childProcess, 'spawn').returns(process as any);

      const resultPromise = npmWrapper.getVersion();
      emitEvents();

      const result = await resultPromise;
      assert.strictEqual(result, '10.2.3');
    });

    test('should return undefined when npm fails', async () => {
      const { process, emitEvents } = createFailureProcess(1);
      sandbox.stub(childProcess, 'spawn').returns(process as any);

      const resultPromise = npmWrapper.getVersion();
      emitEvents();

      const result = await resultPromise;
      assert.strictEqual(result, undefined);
    });

    test('should return undefined when spawn errors', async () => {
      const { process, emitEvents } = createErrorProcess(new Error('ENOENT'));
      sandbox.stub(childProcess, 'spawn').returns(process as any);

      const resultPromise = npmWrapper.getVersion();
      emitEvents();

      const result = await resultPromise;
      assert.strictEqual(result, undefined);
    });
  });

  suite('promptAndInstall()', () => {
    test('should show prompt and handle user decline', async () => {
      const showInformationMessageStub = sandbox.stub(vscode.window, 'showInformationMessage');
      showInformationMessageStub.onFirstCall().resolves(undefined); // User declines
      showInformationMessageStub.onSecondCall().resolves(undefined); // User dismisses manual instruction

      const result = await npmWrapper.promptAndInstall('/test/path');

      assert.strictEqual(result.success, true);
      assert.ok(showInformationMessageStub.calledTwice);
      assert.ok(showInformationMessageStub.secondCall.args[0].includes('npm install'));
    });

    test('should return success when user chooses "No, I\'ll do it later"', async () => {
      const showInformationMessageStub = sandbox.stub(vscode.window, 'showInformationMessage');
      showInformationMessageStub.onFirstCall().resolves('No, I\'ll do it later' as any);
      showInformationMessageStub.onSecondCall().resolves(undefined);

      const result = await npmWrapper.promptAndInstall('/test/path');

      assert.strictEqual(result.success, true);
    });
  });

  suite('spawn shell option', () => {
    test('should pass shell option to spawn', async () => {
      const spawnStub = sandbox.stub(childProcess, 'spawn');
      const { process, emitEvents } = createSuccessProcess();
      spawnStub.returns(process as any);

      const resultPromise = npmWrapper.isAvailable();
      emitEvents();
      await resultPromise;

      assert.ok(spawnStub.calledOnce);
      const spawnOptions = spawnStub.firstCall.args[2];
      // Verify shell option is set (value depends on platform)
      assert.ok('shell' in spawnOptions);
    });
  });

  suite('event sequencing', () => {
    test('should handle stdout data before close', async () => {
      const { process, emitEvents } = createMockProcess({
        exitCode: 0,
        stdoutData: '9.8.1\n'
      });
      sandbox.stub(childProcess, 'spawn').returns(process as any);

      const resultPromise = npmWrapper.getVersion();
      emitEvents();

      const result = await resultPromise;
      assert.strictEqual(result, '9.8.1');
    });

    test('should handle stderr data on failure', async () => {
      const { process, emitEvents } = createMockProcess({
        exitCode: 1,
        stderrData: 'npm ERR! code ENOENT'
      });
      sandbox.stub(childProcess, 'spawn').returns(process as any);

      const resultPromise = npmWrapper.getVersion();
      emitEvents();

      const result = await resultPromise;
      assert.strictEqual(result, undefined);
    });
  });
});

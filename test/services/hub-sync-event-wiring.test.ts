/**
 * Tests for the onHubSynced → syncAllSources event wiring in extension.ts
 *
 * These tests validate the coalescing event handler that triggers source sync
 * after every hub sync, ensuring:
 * - syncAllSources is called with { silent: true }
 * - promptRegistry.refresh is executed on success
 * - Rapid-fire onHubSynced events coalesce into a single syncAllSources call
 * - Errors are handled gracefully
 */
import * as assert from 'node:assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';

suite('onHubSynced → syncAllSources event wiring', () => {
  let sandbox: sinon.SinonSandbox;
  let emitter: vscode.EventEmitter<string>;
  let syncAllSourcesStub: sinon.SinonStub;
  let executeCommandStub: sinon.SinonStub;
  let disposables: vscode.Disposable[];

  /**
   * Replicate the production wiring from extension.ts registerCommands()
   * so we can test the coalescing event handler in isolation.
   */
  function wireHandler(sourceCommands: { syncAllSources: sinon.SinonStub } | undefined) {
    let sourceSyncPending = false;
    const disposable = emitter.event(() => {
      if (!sourceCommands || sourceSyncPending) {
        return;
      }
      sourceSyncPending = true;
      Promise.resolve().then(async () => {
        try {
          await sourceCommands.syncAllSources({ silent: true });
          vscode.commands.executeCommand('promptRegistry.refresh');
        } catch {
          // Errors logged in production; swallowed here for test
        } finally {
          sourceSyncPending = false;
        }
      });
    });
    disposables.push(disposable);
  }

  setup(() => {
    sandbox = sinon.createSandbox();
    emitter = new vscode.EventEmitter<string>();
    disposables = [];
    syncAllSourcesStub = sandbox.stub().resolves();
    executeCommandStub = sandbox.stub(vscode.commands, 'executeCommand').resolves();
  });

  teardown(() => {
    disposables.forEach((d) => d.dispose());
    emitter.dispose();
    sandbox.restore();
  });

  test('should call syncAllSources({ silent: true }) when onHubSynced fires', async () => {
    wireHandler({ syncAllSources: syncAllSourcesStub });

    emitter.fire('hub-1');
    // Wait for microtask to resolve
    await new Promise((r) => setTimeout(r, 0));

    assert.ok(syncAllSourcesStub.calledOnce);
    assert.deepStrictEqual(syncAllSourcesStub.firstCall.args[0], { silent: true });
  });

  test('should execute promptRegistry.refresh after successful sync', async () => {
    wireHandler({ syncAllSources: syncAllSourcesStub });

    emitter.fire('hub-1');
    await new Promise((r) => setTimeout(r, 0));

    assert.ok(executeCommandStub.calledWith('promptRegistry.refresh'));
  });

  test('should coalesce rapid-fire events into a single syncAllSources call', async () => {
    wireHandler({ syncAllSources: syncAllSourcesStub });

    // Fire 5 events synchronously (simulates syncAllHubs with 5 hubs)
    emitter.fire('hub-1');
    emitter.fire('hub-2');
    emitter.fire('hub-3');
    emitter.fire('hub-4');
    emitter.fire('hub-5');

    await new Promise((r) => setTimeout(r, 0));

    assert.strictEqual(syncAllSourcesStub.callCount, 1,
      'Should coalesce into a single syncAllSources call');
  });

  test('should allow subsequent syncs after first completes', async () => {
    wireHandler({ syncAllSources: syncAllSourcesStub });

    // First event batch
    emitter.fire('hub-1');
    await new Promise((r) => setTimeout(r, 0));

    // Second event (after first completed)
    emitter.fire('hub-2');
    await new Promise((r) => setTimeout(r, 0));

    assert.strictEqual(syncAllSourcesStub.callCount, 2,
      'Should allow a new sync after the first completes');
  });

  test('should not throw when syncAllSources rejects', async () => {
    syncAllSourcesStub.rejects(new Error('Network error'));
    wireHandler({ syncAllSources: syncAllSourcesStub });

    emitter.fire('hub-1');
    await new Promise((r) => setTimeout(r, 0));

    // Should not throw — verify guard is reset for next event
    emitter.fire('hub-2');
    await new Promise((r) => setTimeout(r, 0));

    assert.strictEqual(syncAllSourcesStub.callCount, 2,
      'Should reset pending flag after error');
  });

  test('should skip if sourceCommands is undefined', async () => {
    wireHandler(undefined);

    emitter.fire('hub-1');
    await new Promise((r) => setTimeout(r, 0));

    assert.ok(syncAllSourcesStub.notCalled);
  });
});

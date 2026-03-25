/**
 * Unit tests for HubSyncScheduler
 * Tests periodic hub sync scheduling, overlap guard, and disposal
 */
import * as assert from 'node:assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import {
  HubManager,
} from '../../src/services/hub-manager';
import {
  HubSyncScheduler,
} from '../../src/services/hub-sync-scheduler';
import {
  HUB_SYNC_CONSTANTS,
} from '../../src/utils/constants';

suite('HubSyncScheduler', () => {
  let sandbox: sinon.SinonSandbox;
  let mockContext: vscode.ExtensionContext;
  let mockHubManager: sinon.SinonStubbedInstance<HubManager>;
  let subscriptions: vscode.Disposable[];

  setup(() => {
    sandbox = sinon.createSandbox();
    subscriptions = [];

    mockContext = {
      subscriptions,
      globalStorageUri: vscode.Uri.file('/mock/storage'),
      extensionPath: '/mock/path'
    } as any;

    mockHubManager = {
      getActiveHubId: sandbox.stub(),
      syncHub: sandbox.stub()
    } as any;
  });

  teardown(() => {
    sandbox.restore();
  });

  suite('constructor and initialize()', () => {
    test('should detect test environment and skip timers', () => {
      const scheduler = new HubSyncScheduler(mockContext, mockHubManager as any);
      scheduler.initialize();

      // In test environment, no timers should be created
      // Verify by checking that dispose doesn't error
      scheduler.dispose();
    });

    test('should be idempotent - second initialize() is a no-op', () => {
      const scheduler = new HubSyncScheduler(mockContext, mockHubManager as any);
      scheduler.initialize();
      scheduler.initialize(); // Should not throw or create duplicate timers

      scheduler.dispose();
    });

    test('should register itself for disposal via context.subscriptions', () => {
      const scheduler = new HubSyncScheduler(mockContext, mockHubManager as any);

      // The constructor should add a dispose handler to context.subscriptions
      assert.ok(subscriptions.length > 0, 'Should register a disposable');

      scheduler.dispose();
    });
  });

  suite('performSync()', () => {
    test('should call hubManager.syncHub() with the active hub ID', async () => {
      mockHubManager.getActiveHubId.resolves('my-hub-123');
      mockHubManager.syncHub.resolves();

      const scheduler = new HubSyncScheduler(mockContext, mockHubManager as any);
      await scheduler.performSync();

      assert.ok(mockHubManager.getActiveHubId.calledOnce, 'Should call getActiveHubId');
      assert.ok(mockHubManager.syncHub.calledOnce, 'Should call syncHub');
      assert.strictEqual(mockHubManager.syncHub.firstCall.args[0], 'my-hub-123');

      scheduler.dispose();
    });

    test('should skip sync when no active hub (getActiveHubId returns null)', async () => {
      mockHubManager.getActiveHubId.resolves(null);

      const scheduler = new HubSyncScheduler(mockContext, mockHubManager as any);
      await scheduler.performSync();

      assert.ok(mockHubManager.getActiveHubId.calledOnce, 'Should call getActiveHubId');
      assert.ok(mockHubManager.syncHub.notCalled, 'Should NOT call syncHub');

      scheduler.dispose();
    });

    test('should prevent overlapping syncs (isCheckInProgress guard)', async () => {
      // Make syncHub hang until we resolve it
      let resolveSyncHub: () => void;
      const syncHubPromise = new Promise<void>((resolve) => {
        resolveSyncHub = resolve;
      });
      mockHubManager.getActiveHubId.resolves('my-hub');
      mockHubManager.syncHub.returns(syncHubPromise as any);

      const scheduler = new HubSyncScheduler(mockContext, mockHubManager as any);

      // Start first sync (will hang)
      const firstSync = scheduler.performSync();

      // Start second sync while first is in progress
      await scheduler.performSync();

      // syncHub should only be called once (second call was skipped)
      assert.strictEqual(mockHubManager.syncHub.callCount, 1, 'syncHub should only be called once');

      // Resolve the first sync
      resolveSyncHub!();
      await firstSync;

      scheduler.dispose();
    });

    test('should handle syncHub errors gracefully (logs, does not throw)', async () => {
      mockHubManager.getActiveHubId.resolves('my-hub');
      mockHubManager.syncHub.rejects(new Error('Network error'));

      const scheduler = new HubSyncScheduler(mockContext, mockHubManager as any);

      // Should not throw
      await scheduler.performSync();

      assert.ok(mockHubManager.syncHub.calledOnce, 'Should have attempted syncHub');

      scheduler.dispose();
    });

    test('should reset isCheckInProgress after error', async () => {
      mockHubManager.getActiveHubId.resolves('my-hub');
      mockHubManager.syncHub.rejects(new Error('Network error'));

      const scheduler = new HubSyncScheduler(mockContext, mockHubManager as any);
      await scheduler.performSync();

      // Second call should work (guard reset after error)
      mockHubManager.syncHub.resolves();
      await scheduler.performSync();

      assert.strictEqual(mockHubManager.syncHub.callCount, 2, 'Should allow second sync after error');

      scheduler.dispose();
    });
  });

  suite('dispose()', () => {
    test('should clear timers and reset state', () => {
      const scheduler = new HubSyncScheduler(mockContext, mockHubManager as any);
      scheduler.initialize();

      scheduler.dispose();

      // Should be safe to dispose multiple times
      scheduler.dispose();
    });
  });

  suite('scheduling with fake timers', () => {
    let clock: sinon.SinonFakeTimers;

    const originalAllowTimersEnv = process.env.HUB_SYNC_SCHEDULER_ALLOW_TIMERS_IN_TESTS;

    setup(() => {
      // Opt-in to real timer paths so we can test scheduling with fake timers
      process.env.HUB_SYNC_SCHEDULER_ALLOW_TIMERS_IN_TESTS = 'true';
      clock = sandbox.useFakeTimers();
    });

    teardown(() => {
      clock.restore();
      if (originalAllowTimersEnv === undefined) {
        delete process.env.HUB_SYNC_SCHEDULER_ALLOW_TIMERS_IN_TESTS;
      } else {
        process.env.HUB_SYNC_SCHEDULER_ALLOW_TIMERS_IN_TESTS = originalAllowTimersEnv;
      }
    });

    test('should fire performSync after SYNC_INTERVAL_MS', async () => {
      mockHubManager.getActiveHubId.resolves('my-hub');
      mockHubManager.syncHub.resolves();

      const scheduler = new HubSyncScheduler(mockContext, mockHubManager as any);
      scheduler.initialize();

      // Advance time just under the interval — nothing should fire yet
      await clock.tickAsync(HUB_SYNC_CONSTANTS.SYNC_INTERVAL_MS - 1);
      assert.ok(mockHubManager.syncHub.notCalled, 'Should not fire before interval');

      // Advance the remaining tick
      await clock.tickAsync(1);
      assert.ok(mockHubManager.syncHub.calledOnce, 'Should fire after full interval');

      scheduler.dispose();
    });

    test('should reschedule after sync completes', async () => {
      mockHubManager.getActiveHubId.resolves('my-hub');
      mockHubManager.syncHub.resolves();

      const scheduler = new HubSyncScheduler(mockContext, mockHubManager as any);
      scheduler.initialize();

      // First cycle
      await clock.tickAsync(HUB_SYNC_CONSTANTS.SYNC_INTERVAL_MS);
      assert.strictEqual(mockHubManager.syncHub.callCount, 1);

      // Second cycle
      await clock.tickAsync(HUB_SYNC_CONSTANTS.SYNC_INTERVAL_MS);
      assert.strictEqual(mockHubManager.syncHub.callCount, 2);

      scheduler.dispose();
    });

    test('should stop scheduling after dispose', async () => {
      mockHubManager.getActiveHubId.resolves('my-hub');
      mockHubManager.syncHub.resolves();

      const scheduler = new HubSyncScheduler(mockContext, mockHubManager as any);
      scheduler.initialize();

      scheduler.dispose();

      await clock.tickAsync(HUB_SYNC_CONSTANTS.SYNC_INTERVAL_MS * 2);
      assert.ok(mockHubManager.syncHub.notCalled, 'Should not fire after dispose');
    });
  });

  suite('constants', () => {
    test('SYNC_INTERVAL_MS should be 24 hours', () => {
      assert.strictEqual(HUB_SYNC_CONSTANTS.SYNC_INTERVAL_MS, 86_400_000);
    });
  });
});

import * as assert from 'node:assert';
import * as sinon from 'sinon';
import {
  ElasticSearchTransport,
} from '../../src/services/elastic-search-transport';
import {
  ElasticSearchConfig,
} from '../../src/types/hub';
import {
  TelemetryDocument,
} from '../../src/types/telemetry';

suite('ElasticSearchTransport', () => {
  let sandbox: sinon.SinonSandbox;
  let transport: ElasticSearchTransport;
  let clock: sinon.SinonFakeTimers;

  let indicesCreateStub: sinon.SinonStub;
  let bulkStub: sinon.SinonStub;
  let closeStub: sinon.SinonStub;
  let lastClientOptions: any;

  const esModule = require('@elastic/elasticsearch');
  const originalClient = esModule.Client;

  const createMockEsClient = () => ({
    indices: { create: indicesCreateStub },
    helpers: { bulk: bulkStub },
    close: closeStub
  }) as any;

  const baseConfig: ElasticSearchConfig = {
    node: 'https://es-proxy.example.com:8080'
  };

  setup(() => {
    sandbox = sinon.createSandbox();
    clock = sinon.useFakeTimers();

    indicesCreateStub = sandbox.stub().resolves({});
    bulkStub = sandbox.stub().resolves({});
    closeStub = sandbox.stub().resolves();
    lastClientOptions = undefined;

    Object.defineProperty(esModule, 'Client', { value: originalClient, writable: true, configurable: true });
    // eslint-disable-next-line prefer-arrow/prefer-arrow-functions -- must be a constructor for `new`
    esModule.Client = function stubClient(options: any) {
      lastClientOptions = options;
      return createMockEsClient();
    };

    transport = new ElasticSearchTransport();
  });

  teardown(() => {
    transport.dispose();
    clock.restore();
    esModule.Client = originalClient;
    sandbox.restore();
  });

  suite('registerHub()', () => {
    test('should create ES client with no auth', async () => {
      await transport.registerHub('hub-1', baseConfig);

      assert.strictEqual(lastClientOptions.node, 'https://es-proxy.example.com:8080');
      assert.strictEqual(lastClientOptions.auth, undefined);
    });

    test('should create index on registration', async () => {
      await transport.registerHub('hub-1', baseConfig);

      assert.strictEqual(indicesCreateStub.callCount, 1);
      const indexArg = indicesCreateStub.firstCall.args[0];
      assert.ok(indexArg.index.startsWith('prompt-registry-telemetry-'));
    });

    test('should use custom indexPrefix when provided', async () => {
      await transport.registerHub('hub-1', { ...baseConfig, indexPrefix: 'custom-prefix' });

      const indexArg = indicesCreateStub.firstCall.args[0];
      assert.ok(indexArg.index.startsWith('custom-prefix-'));
    });

    test('should handle resource_already_exists_exception gracefully', async () => {
      indicesCreateStub.rejects({
        meta: { body: { error: { type: 'resource_already_exists_exception' } } }
      });

      await transport.registerHub('hub-1', baseConfig);
    });

    test('should not register client on other index creation failures', async () => {
      indicesCreateStub.rejects(new Error('connection refused'));

      await transport.registerHub('hub-1', baseConfig);

      bulkStub.resetHistory();
      transport.send({ timestamp: new Date().toISOString(), eventName: 'test' });
      clock.tick(10_000);
      assert.strictEqual(bulkStub.callCount, 0);
    });

    test('should close previous client before registering new one', async () => {
      await transport.registerHub('hub-1', baseConfig);
      closeStub.resetHistory();

      await transport.registerHub('hub-2', baseConfig);

      assert.strictEqual(closeStub.callCount, 1);
    });

    test('should flush queued events after registration on next tick', async () => {
      transport.send({ timestamp: new Date().toISOString(), eventName: 'test.event' });

      await transport.registerHub('hub-1', baseConfig);

      // Queued events are flushed immediately on registration (not waiting for timer)
      assert.ok(bulkStub.callCount >= 1);
    });
  });

  suite('unregisterHub()', () => {
    test('should close connection when hubId matches', async () => {
      await transport.registerHub('hub-1', baseConfig);
      closeStub.resetHistory();

      transport.unregisterHub('hub-1');

      assert.strictEqual(closeStub.callCount, 1);
    });

    test('should not close connection if hubId does not match', async () => {
      await transport.registerHub('hub-1', baseConfig);
      closeStub.resetHistory();

      transport.unregisterHub('hub-other');

      assert.strictEqual(closeStub.callCount, 0);
    });

    test('should stop the flush timer on unregister', async () => {
      await transport.registerHub('hub-1', baseConfig);
      bulkStub.resetHistory();

      transport.unregisterHub('hub-1');

      transport.send({ timestamp: new Date().toISOString(), eventName: 'test.event' });
      clock.tick(10_000);

      // No active client, so bulk should not be called even after timer fires
      assert.strictEqual(bulkStub.callCount, 0);
    });
  });

  suite('send() — batched', () => {
    test('should not send immediately when client is active', async () => {
      await transport.registerHub('hub-1', baseConfig);
      bulkStub.resetHistory();

      transport.send({ timestamp: new Date().toISOString(), eventName: 'test.event' });

      // Not sent immediately
      assert.strictEqual(bulkStub.callCount, 0);
    });

    test('should flush buffered events after 10 seconds', async () => {
      await transport.registerHub('hub-1', baseConfig);
      bulkStub.resetHistory();

      transport.send({ timestamp: new Date().toISOString(), eventName: 'e1' });
      transport.send({ timestamp: new Date().toISOString(), eventName: 'e2' });

      clock.tick(10_000);

      assert.strictEqual(bulkStub.callCount, 1);
      assert.strictEqual(bulkStub.firstCall.args[0].datasource.length, 2);
    });

    test('should not call bulk when buffer is empty at flush time', async () => {
      await transport.registerHub('hub-1', baseConfig);
      bulkStub.resetHistory();

      clock.tick(10_000);

      assert.strictEqual(bulkStub.callCount, 0);
    });

    test('should flush repeatedly every 10 seconds', async () => {
      await transport.registerHub('hub-1', baseConfig);
      bulkStub.resetHistory();

      transport.send({ timestamp: new Date().toISOString(), eventName: 'e1' });
      clock.tick(10_000);
      assert.strictEqual(bulkStub.callCount, 1);

      transport.send({ timestamp: new Date().toISOString(), eventName: 'e2' });
      clock.tick(10_000);
      assert.strictEqual(bulkStub.callCount, 2);
    });

    test('should queue events before registration and flush on register', async () => {
      const doc1: TelemetryDocument = { timestamp: new Date().toISOString(), eventName: 'e1' };
      const doc2: TelemetryDocument = { timestamp: new Date().toISOString(), eventName: 'e2' };

      transport.send(doc1);
      transport.send(doc2);

      assert.strictEqual(bulkStub.callCount, 0);

      await transport.registerHub('hub-1', baseConfig);

      assert.strictEqual(bulkStub.callCount, 1);
      assert.strictEqual(bulkStub.firstCall.args[0].datasource.length, 2);
    });
  });

  suite('queue overflow', () => {
    test('should drop oldest events when queue exceeds MAX_QUEUE_SIZE', async () => {
      for (let i = 0; i < 501; i++) {
        transport.send({ timestamp: new Date().toISOString(), eventName: `e${i}` });
      }

      await transport.registerHub('hub-1', baseConfig);

      const bulkArgs = bulkStub.firstCall.args[0];
      assert.ok(bulkArgs.datasource.length <= 500);
    });
  });
});

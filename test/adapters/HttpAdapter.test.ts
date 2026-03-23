/**
 * HttpAdapter Unit Tests
 */

import * as assert from 'node:assert';
import nock from 'nock';
import {
  HttpAdapter,
} from '../../src/adapters/HttpAdapter';
import {
  RegistrySource,
} from '../../src/types/registry';

suite('HttpAdapter', () => {
  const mockSource: RegistrySource = {
    id: 'test-http-source',
    name: 'Test HTTP Source',
    type: 'http',
    url: 'https://example.com/bundles',
    enabled: true,
    priority: 1
  };

  teardown(() => {
    nock.cleanAll();
  });

  suite('Constructor and Validation', () => {
    test('should accept valid HTTP URL', () => {
      const adapter = new HttpAdapter(mockSource);
      assert.strictEqual(adapter.type, 'http');
    });

    test('should accept valid HTTPS URL', () => {
      const source = { ...mockSource, url: 'https://example.com/bundles' };
      const adapter = new HttpAdapter(source);
      assert.ok(adapter);
    });

    test('should handle URLs with query parameters', () => {
      const source = { ...mockSource, url: 'https://example.com/bundles?filter=active' };
      assert.doesNotThrow(() => new HttpAdapter(source));
    });
  });

  suite('fetchBundles', () => {
    test('should fetch bundles from HTTP endpoint', async () => {
      const mockIndex = {
        name: 'Test Registry',
        version: '1.0.0',
        bundles: [
          {
            id: 'bundle-1',
            name: 'Bundle 1',
            version: '1.0.0',
            description: 'Test bundle',
            author: 'Test',
            environments: ['vscode'],
            tags: [],
            lastUpdated: new Date().toISOString(),
            size: '1MB',
            dependencies: [],
            license: 'MIT',
            downloadUrl: 'https://example.com/bundle-1.zip',
            manifestUrl: 'https://example.com/bundle-1/manifest.yml'
          }
        ]
      };

      nock('https://example.com')
        .get('/bundles/index.json')
        .reply(200, mockIndex);

      const adapter = new HttpAdapter(mockSource);
      const bundles = await adapter.fetchBundles();

      assert.strictEqual(bundles.length, 1);
      assert.strictEqual(bundles[0].id, 'bundle-1');
    });

    test('should handle 404 errors gracefully', async () => {
      nock('https://example.com')
        .get('/bundles/index.json')
        .reply(404);

      const adapter = new HttpAdapter(mockSource);
      await assert.rejects(
        async () => await adapter.fetchBundles(),
        /404|Not found/
      );
    });

    test('should handle network errors', async () => {
      nock('https://example.com')
        .get('/bundles/index.json')
        .replyWithError('Network error');

      const adapter = new HttpAdapter(mockSource);
      await assert.rejects(
        async () => await adapter.fetchBundles(),
        /Network error/
      );
    });
  });

  suite('getDownloadUrl', () => {
    test('should construct download URL from bundle ID', () => {
      const adapter = new HttpAdapter(mockSource);
      const url = adapter.getDownloadUrl('bundle-1', '1.0.0');

      assert.ok(url.includes('example.com'));
      assert.ok(url.includes('bundle-1'));
    });

    test('should handle version parameter', () => {
      const adapter = new HttpAdapter(mockSource);
      const url = adapter.getDownloadUrl('bundle-1', '2.0.0');

      assert.ok(url.includes('bundle-1'));
    });
  });

  suite('Authentication', () => {
    test('should include Authorization header when token provided', async () => {
      const sourceWithToken = { ...mockSource, token: 'test-token-123' };
      const mockIndex = {
        name: 'Test Registry',
        version: '1.0.0',
        bundles: []
      };

      nock('https://example.com', {
        reqheaders: {
          Authorization: 'Bearer test-token-123'
        }
      })
        .get('/bundles/index.json')
        .reply(200, mockIndex);

      const adapter = new HttpAdapter(sourceWithToken);
      const bundles = await adapter.fetchBundles();

      assert.strictEqual(bundles.length, 0);
    });

    test('should handle 401 unauthorized errors', async () => {
      const sourceWithToken = { ...mockSource, token: 'invalid-token' };

      nock('https://example.com')
        .get('/bundles/index.json')
        .reply(401, { error: 'Unauthorized' });

      const adapter = new HttpAdapter(sourceWithToken);
      await assert.rejects(
        async () => await adapter.fetchBundles(),
        /401|Unauthorized/
      );
    });
  });

  suite('Rate Limiting', () => {
    test('should handle 429 rate limit errors', async () => {
      nock('https://example.com')
        .get('/bundles/index.json')
        .reply(429, { error: 'Rate limit exceeded' });

      const adapter = new HttpAdapter(mockSource);
      await assert.rejects(
        async () => await adapter.fetchBundles(),
        /429|Rate limit/
      );
    });
  });
});

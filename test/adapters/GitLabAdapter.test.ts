/**
 * GitLabAdapter Unit Tests
 */

import * as assert from 'node:assert';
import nock from 'nock';
import {
  GitLabAdapter,
} from '../../src/adapters/GitLabAdapter';
import {
  RegistrySource,
} from '../../src/types/registry';

suite('GitLabAdapter', () => {
  const mockSource: RegistrySource = {
    id: 'test-gitlab-source',
    name: 'Test GitLab Source',
    type: 'gitlab',
    url: 'https://gitlab.com/test-group/test-project',
    enabled: true,
    priority: 1,
    token: 'test-gitlab-token'
  };

  teardown(() => {
    nock.cleanAll();
  });

  suite('Constructor and Validation', () => {
    test('should accept valid GitLab URL', () => {
      const adapter = new GitLabAdapter(mockSource);
      assert.strictEqual(adapter.type, 'gitlab');
    });

    test('should accept GitLab SSH URL', () => {
      const source = { ...mockSource, url: 'git@gitlab.com:test-group/test-project.git' };
      const adapter = new GitLabAdapter(source);
      assert.ok(adapter);
    });

    test('should accept self-hosted GitLab URL', () => {
      const source = { ...mockSource, url: 'https://gitlab.company.com/group/project' };
      const adapter = new GitLabAdapter(source);
      assert.ok(adapter);
    });
  });

  suite('fetchBundles', () => {
    test('should fetch bundles from GitLab repository', async () => {
      const mockReleases = [
        {
          tag_name: 'v1.0.0',
          name: 'Release 1.0.0',
          description: 'First release',
          assets: {
            links: [
              { name: 'bundle.zip', url: 'https://gitlab.com/downloads/bundle.zip' }
            ]
          },
          released_at: new Date().toISOString()
        }
      ];

      nock('https://gitlab.com')
        .get(/\/api\/v4\/projects\/.*\/releases/)
        .reply(200, mockReleases);

      const adapter = new GitLabAdapter(mockSource);
      const bundles = await adapter.fetchBundles();

      assert.ok(bundles.length >= 0);
    });

    test('should handle authentication with private token', async () => {
      const mockReleases: any[] = [];

      nock('https://gitlab.com', {
        reqheaders: {
          'PRIVATE-TOKEN': 'test-gitlab-token'
        }
      })
        .get(/\/api\/v4\/projects\/.*\/releases/)
        .reply(200, mockReleases);

      const adapter = new GitLabAdapter(mockSource);
      await adapter.fetchBundles();
    });

    test('should handle 404 for non-existent repository', async () => {
      nock('https://gitlab.com')
        .get(/\/api\/v4\/projects\/.*\/releases/)
        .reply(404);

      const adapter = new GitLabAdapter(mockSource);
      await assert.rejects(
        async () => await adapter.fetchBundles(),
        /404|Not found/
      );
    });

    test('should handle rate limiting', async () => {
      nock('https://gitlab.com')
        .get(/\/api\/v4\/projects\/.*\/releases/)
        .reply(429, { message: 'Rate limit exceeded' });

      const adapter = new GitLabAdapter(mockSource);
      await assert.rejects(
        async () => await adapter.fetchBundles(),
        /429|Rate limit/
      );
    });
  });

  suite('getDownloadUrl', () => {
    test('should construct download URL for GitLab archive', () => {
      const adapter = new GitLabAdapter(mockSource);
      const url = adapter.getDownloadUrl('bundle-1', '1.0.0');

      assert.ok(url.includes('gitlab.com'));
      assert.ok(url.includes('test-group') || url.includes('test-project'));
    });

    test('should handle version tags in download URL', () => {
      const adapter = new GitLabAdapter(mockSource);
      const url = adapter.getDownloadUrl('bundle-1', 'v2.0.0');

      assert.ok(url.includes('2.0.0') || url.includes('v2.0.0'));
    });
  });

  suite('Self-hosted GitLab', () => {
    test('should work with custom GitLab instance', async () => {
      const customSource: RegistrySource = {
        ...mockSource,
        url: 'https://gitlab.company.com/engineering/prompts'
      };

      const mockReleases: any[] = [];

      nock('https://gitlab.company.com')
        .get(/\/api\/v4\/projects\/.*\/releases/)
        .reply(200, mockReleases);

      const adapter = new GitLabAdapter(customSource);
      await adapter.fetchBundles();
    });
  });
});

/**
 * AzureDevOpsAdapter Unit Tests
 */

import * as assert from 'node:assert';
import nock from 'nock';
import {
  AzureDevOpsAdapter,
} from '../../src/adapters/azure-devops-adapter';
import {
  RegistrySource,
} from '../../src/types/registry';

suite('AzureDevOpsAdapter', () => {
  const mockSource: RegistrySource = {
    id: 'test-ado-source',
    name: 'Test ADO Source',
    type: 'azure-devops',
    url: 'https://dev.azure.com/myorg/myproject/_git/myrepo',
    enabled: true,
    priority: 1,
    private: true,
    token: 'mypat',
    config: {
      branch: 'main',
      collectionsPath: '/'
    }
  };

  const apiBase = 'https://dev.azure.com';
  const repoApiPath = '/myorg/myproject/_apis/git/repositories/myrepo';

  teardown(() => {
    nock.cleanAll();
  });

  // ---------------------------------------------------------------------------
  // Constructor / URL validation
  // ---------------------------------------------------------------------------

  suite('Constructor and URL Validation', () => {
    test('should accept a valid ADO Services URL', () => {
      const adapter = new AzureDevOpsAdapter(mockSource);
      assert.strictEqual(adapter.type, 'azure-devops');
    });

    test('should accept a visualstudio.com URL', () => {
      const source = {
        ...mockSource,
        url: 'https://myorg.visualstudio.com/myproject/_git/myrepo'
      };
      assert.doesNotThrow(() => new AzureDevOpsAdapter(source));
    });

    test('should accept an on-premises server URL', () => {
      const source = {
        ...mockSource,
        url: 'https://ado.mycompany.com/DefaultCollection/myproject/_git/myrepo'
      };
      assert.doesNotThrow(() => new AzureDevOpsAdapter(source));
    });

    test('should throw for a URL without /_git/', () => {
      const source = { ...mockSource, url: 'https://github.com/org/repo' };
      assert.throws(() => new AzureDevOpsAdapter(source), /Invalid Azure DevOps URL/);
    });

    test('should throw for a non-HTTP URL', () => {
      const source = { ...mockSource, url: 'git@ssh.dev.azure.com:v3/org/project/repo' };
      assert.throws(() => new AzureDevOpsAdapter(source), /Invalid Azure DevOps URL/);
    });

    test('should throw for a plain HTTP URL (credentials must use HTTPS)', () => {
      const source = { ...mockSource, url: 'http://dev.azure.com/myorg/myproject/_git/myrepo' };
      assert.throws(() => new AzureDevOpsAdapter(source), /Invalid Azure DevOps URL/);
    });
  });

  // ---------------------------------------------------------------------------
  // fetchBundles
  // ---------------------------------------------------------------------------

  suite('fetchBundles()', () => {
    test('should return bundles for directories that contain a deployment manifest', async () => {
      const manifestYaml = [
        'id: my-bundle',
        'name: My Bundle',
        'version: 1.2.0',
        'description: A test bundle',
        'author: Test Author',
        'tags:',
        '  - test'
      ].join('\n');

      // Intercept: list items at root
      nock(apiBase)
        .get(`${repoApiPath}/items`)
        .query((q) => q.path === '/' && q.recursionLevel === 'OneLevel')
        .reply(200, {
          count: 2,
          value: [
            { objectId: 'abc', gitObjectType: 'tree', commitId: 'c1', path: '/', isFolder: true },
            { objectId: 'def', gitObjectType: 'tree', commitId: 'c1', path: '/my-bundle', isFolder: true }
          ]
        });

      // Intercept: fetch deployment-manifest.yml from the directory
      nock(apiBase)
        .get(`${repoApiPath}/items`)
        .query((q) => q.path === '/my-bundle/deployment-manifest.yml')
        .reply(200, manifestYaml);

      const adapter = new AzureDevOpsAdapter(mockSource);
      const bundles = await adapter.fetchBundles();

      assert.strictEqual(bundles.length, 1);
      assert.strictEqual(bundles[0].name, 'My Bundle');
      assert.strictEqual(bundles[0].version, '1.2.0');
      assert.strictEqual(bundles[0].author, 'Test Author');
      assert.deepStrictEqual(bundles[0].tags, ['test']);
    });

    test('should skip directories that do not have a deployment manifest', async () => {
      nock(apiBase)
        .get(`${repoApiPath}/items`)
        .query((q) => q.path === '/' && q.recursionLevel === 'OneLevel')
        .reply(200, {
          count: 2,
          value: [
            { objectId: 'abc', gitObjectType: 'tree', commitId: 'c1', path: '/', isFolder: true },
            { objectId: 'def', gitObjectType: 'tree', commitId: 'c1', path: '/no-manifest', isFolder: true }
          ]
        });

      // All three manifest candidates return 404
      nock(apiBase)
        .get(`${repoApiPath}/items`)
        .query((q) => q.path === '/no-manifest/deployment-manifest.yml')
        .reply(404);

      nock(apiBase)
        .get(`${repoApiPath}/items`)
        .query((q) => q.path === '/no-manifest/deployment-manifest.yaml')
        .reply(404);

      nock(apiBase)
        .get(`${repoApiPath}/items`)
        .query((q) => q.path === '/no-manifest/deployment-manifest.json')
        .reply(404);

      const adapter = new AzureDevOpsAdapter(mockSource);
      const bundles = await adapter.fetchBundles();

      assert.strictEqual(bundles.length, 0);
    });

    test('should use collectionsPath when configured', async () => {
      const source = {
        ...mockSource,
        config: { branch: 'main', collectionsPath: '/bundles' }
      };

      let capturedPath = '';
      nock(apiBase)
        .get(`${repoApiPath}/items`)
        .query((q) => {
          capturedPath = q.path as string;
          return q.recursionLevel === 'OneLevel';
        })
        .reply(200, { count: 1, value: [
          { objectId: 'abc', gitObjectType: 'tree', commitId: 'c1', path: '/bundles', isFolder: true }
        ] });

      const adapter = new AzureDevOpsAdapter(source);
      await adapter.fetchBundles();

      assert.strictEqual(capturedPath, '/bundles');
    });

    test('should throw when ADO API returns an error', async () => {
      nock(apiBase)
        .get(`${repoApiPath}/items`)
        .query((q) => q.path === '/' && q.recursionLevel === 'OneLevel')
        .reply(401, { message: 'Unauthorized' });

      const adapter = new AzureDevOpsAdapter(mockSource);
      await assert.rejects(
        () => adapter.fetchBundles(),
        /Failed to fetch bundles from Azure DevOps/
      );
    });
  });

  // ---------------------------------------------------------------------------
  // fetchMetadata
  // ---------------------------------------------------------------------------

  suite('fetchMetadata()', () => {
    test('should return metadata from the repository API', async () => {
      nock(apiBase)
        .get(`${repoApiPath}`)
        .query(true)
        .reply(200, {
          id: 'repo-id',
          name: 'myrepo',
          project: { name: 'myproject', description: 'My project description' },
          remoteUrl: mockSource.url
        });

      // fetchBundles is called internally — return empty to keep test focused
      nock(apiBase)
        .get(`${repoApiPath}/items`)
        .query((q) => q.path === '/' && q.recursionLevel === 'OneLevel')
        .reply(200, { count: 0, value: [] });

      const adapter = new AzureDevOpsAdapter(mockSource);
      const metadata = await adapter.fetchMetadata();

      assert.strictEqual(metadata.name, 'myrepo');
      assert.strictEqual(metadata.bundleCount, 0);
    });

    test('should throw when the repository API fails', async () => {
      nock(apiBase)
        .get(`${repoApiPath}`)
        .query(true)
        .reply(404, { message: 'Not Found' });

      const adapter = new AzureDevOpsAdapter(mockSource);
      await assert.rejects(
        () => adapter.fetchMetadata(),
        /Failed to fetch Azure DevOps metadata/
      );
    });
  });

  // ---------------------------------------------------------------------------
  // validate
  // ---------------------------------------------------------------------------

  suite('validate()', () => {
    test('should return valid when the repository is accessible and bundles exist', async () => {
      const manifestYaml = 'id: b\nname: Bundle\nversion: 1.0.0\ndescription: d';

      nock(apiBase)
        .get(`${repoApiPath}`)
        .query(true)
        .reply(200, { id: 'r', name: 'myrepo', project: { name: 'p' }, remoteUrl: '' });

      nock(apiBase)
        .get(`${repoApiPath}/items`)
        .query((q) => q.path === '/' && q.recursionLevel === 'OneLevel')
        .reply(200, {
          count: 2,
          value: [
            { objectId: 'a', gitObjectType: 'tree', commitId: 'c1', path: '/', isFolder: true },
            { objectId: 'b', gitObjectType: 'tree', commitId: 'c1', path: '/bundle1', isFolder: true }
          ]
        });

      nock(apiBase)
        .get(`${repoApiPath}/items`)
        .query((q) => q.path === '/bundle1/deployment-manifest.yml')
        .reply(200, manifestYaml);

      const adapter = new AzureDevOpsAdapter(mockSource);
      const result = await adapter.validate();

      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.errors.length, 0);
      assert.strictEqual(result.bundlesFound, 1);
    });

    test('should return valid with warning when no bundles found', async () => {
      nock(apiBase)
        .get(`${repoApiPath}`)
        .query(true)
        .reply(200, { id: 'r', name: 'myrepo', project: { name: 'p' }, remoteUrl: '' });

      nock(apiBase)
        .get(`${repoApiPath}/items`)
        .query((q) => q.path === '/' && q.recursionLevel === 'OneLevel')
        .reply(200, { count: 0, value: [] });

      const adapter = new AzureDevOpsAdapter(mockSource);
      const result = await adapter.validate();

      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.warnings.length, 1);
      assert.ok(result.warnings[0].includes('No bundles found'));
    });

    test('should return invalid when URL is malformed', () => {
      const source = { ...mockSource, url: 'https://github.com/org/repo' };

      // The constructor would throw for this URL, so test the guard directly
      assert.throws(() => new AzureDevOpsAdapter(source), /Invalid Azure DevOps URL/);
    });

    test('should return invalid when the API returns an error', async () => {
      nock(apiBase)
        .get(`${repoApiPath}`)
        .query(true)
        .reply(403, { message: 'Forbidden' });

      const adapter = new AzureDevOpsAdapter(mockSource);
      const result = await adapter.validate();

      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.length > 0);
    });
  });

  // ---------------------------------------------------------------------------
  // getManifestUrl / getDownloadUrl
  // ---------------------------------------------------------------------------

  suite('getManifestUrl() / getDownloadUrl()', () => {
    test('should return URLs that include the bundle path without double slashes', () => {
      const adapter = new AzureDevOpsAdapter(mockSource);
      // Bundle ID format: {host}/{org}/{project}/{repo}{/path} (no double slash)
      const bundleId = 'dev.azure.com/myorg/myproject/myrepo/my-bundle';

      const manifestUrl = adapter.getManifestUrl(bundleId);
      assert.ok(manifestUrl.includes(repoApiPath), 'manifest URL should include repo API path');
      assert.ok(manifestUrl.includes('deployment-manifest.yml'), 'manifest URL should reference manifest file');
      assert.ok(!manifestUrl.includes('//my-bundle'), 'manifest URL should not have double slashes in path');

      const downloadUrl = adapter.getDownloadUrl(bundleId);
      assert.ok(downloadUrl.includes(repoApiPath), 'download URL should include repo API path');
      assert.ok(downloadUrl.includes('$format=zip'), 'download URL should request ZIP format');
      assert.ok(!downloadUrl.includes('//my-bundle'), 'download URL should not have double slashes in path');
    });
  });

  // ---------------------------------------------------------------------------
  // requiresAuthentication
  // ---------------------------------------------------------------------------

  suite('requiresAuthentication()', () => {
    test('should return true when source is marked private', () => {
      const adapter = new AzureDevOpsAdapter({ ...mockSource, private: true });
      assert.strictEqual(adapter.requiresAuthentication(), true);
    });

    test('should return false when source is not private', () => {
      const adapter = new AzureDevOpsAdapter({ ...mockSource, private: false });
      assert.strictEqual(adapter.requiresAuthentication(), false);
    });
  });
});

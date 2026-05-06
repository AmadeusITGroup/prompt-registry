/**
 * AzureDevOpsAdapter Unit Tests
 */

import * as assert from 'node:assert';
import nock from 'nock';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import {
  AzureDevOpsAdapter,
} from '../../src/adapters/azure-devops-adapter';
import {
  RegistrySource,
} from '../../src/types/registry';

suite('AzureDevOpsAdapter', () => {
  let sandbox: sinon.SinonSandbox;

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

  const makeCollectionYaml = (opts: {
    id?: string;
    name?: string;
    version?: string;
    description?: string;
    author?: string;
    tags?: string[];
    items?: { path: string; kind: string }[];
  } = {}): string => {
    const {
      id = 'my-collection',
      name = 'My Collection',
      version = '1.0.0',
      description = 'A test collection',
      author = 'Test Author',
      tags = ['test'],
      items = [{ path: 'prompts/hello.prompt.md', kind: 'prompt' }]
    } = opts;
    const tagLines = tags.map((t) => `  - ${t}`).join('\n');
    const itemLines = items.map((i) => `  - path: ${i.path}\n    kind: ${i.kind}`).join('\n');
    return [
      `id: ${id}`,
      `name: ${name}`,
      `version: ${version}`,
      `description: ${description}`,
      `author: ${author}`,
      'tags:',
      tagLines,
      'items:',
      itemLines
    ].join('\n');
  };

  setup(() => {
    sandbox = sinon.createSandbox();
    // Default: VS Code Microsoft auth returns no session (PAT in mockSource is used instead)
    sandbox.stub(vscode.authentication, 'getSession').resolves(undefined);
  });

  teardown(() => {
    sandbox.restore();
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
  // fetchBundles — collection-blob discovery strategy
  // ---------------------------------------------------------------------------

  suite('fetchBundles()', () => {
    test('should discover a bundle from a .collection.yml blob in a single full-tree call', async () => {
      nock(apiBase)
        .get(`${repoApiPath}/items`)
        .query((q) => !q.path && q.recursionLevel === 'Full')
        .reply(200, {
          count: 3,
          value: [
            { objectId: 'root', gitObjectType: 'tree', commitId: 'c1', path: '/', isFolder: true },
            { objectId: 'dir1', gitObjectType: 'tree', commitId: 'c1', path: '/my-bundle', isFolder: true },
            { objectId: 'coll1', gitObjectType: 'blob', commitId: 'c1', path: '/my-bundle/my-bundle.collection.yml', isFolder: false }
          ]
        });

      nock(apiBase)
        .get(`${repoApiPath}/items`)
        .query((q) => q.path === '/my-bundle/my-bundle.collection.yml')
        .reply(200, makeCollectionYaml({ name: 'My Bundle', version: '1.2.0', author: 'Test Author', tags: ['test'] }));

      const adapter = new AzureDevOpsAdapter(mockSource);
      const bundles = await adapter.fetchBundles();

      assert.strictEqual(bundles.length, 1);
      assert.strictEqual(bundles[0].name, 'My Bundle');
      assert.strictEqual(bundles[0].version, '1.2.0');
      assert.strictEqual(bundles[0].author, 'Test Author');
      assert.deepStrictEqual(bundles[0].tags, ['test']);
      // Bundle ID for depth-1 layout must equal the collectionId from the manifest.
      assert.strictEqual(
        bundles[0].id,
        'my-collection',
        'depth-1 bundle ID must equal the collectionId from the manifest'
      );
    });

    test('should skip directories that have no .collection.yml blob in the tree', async () => {
      nock(apiBase)
        .get(`${repoApiPath}/items`)
        .query((q) => !q.path && q.recursionLevel === 'Full')
        .reply(200, {
          count: 2,
          value: [
            { objectId: 'root', gitObjectType: 'tree', commitId: 'c1', path: '/', isFolder: true },
            { objectId: 'dir1', gitObjectType: 'tree', commitId: 'c1', path: '/no-collection', isFolder: true }
          ]
        });

      const adapter = new AzureDevOpsAdapter(mockSource);
      const bundles = await adapter.fetchBundles();

      assert.strictEqual(bundles.length, 0);
    });

    test('should skip .collection.yml blobs nested more than one level deep', async () => {
      nock(apiBase)
        .get(`${repoApiPath}/items`)
        .query((q) => !q.path && q.recursionLevel === 'Full')
        .reply(200, {
          count: 4,
          value: [
            { objectId: 'r', gitObjectType: 'tree', commitId: 'c1', path: '/', isFolder: true },
            { objectId: 'd1', gitObjectType: 'tree', commitId: 'c1', path: '/outer', isFolder: true },
            { objectId: 'd2', gitObjectType: 'tree', commitId: 'c1', path: '/outer/inner', isFolder: true },
            { objectId: 'coll', gitObjectType: 'blob', commitId: 'c1', path: '/outer/inner/nested.collection.yml', isFolder: false }
          ]
        });

      const adapter = new AzureDevOpsAdapter(mockSource);
      const bundles = await adapter.fetchBundles();

      assert.strictEqual(bundles.length, 0);
    });

    test('should discover a bundle from a .collection.yml blob at depth-0 (flat layout)', async () => {
      // Flat layout: collections/ directly contains .collection.yml (depth-0).
      // The collection file is at /collections/my-collection.collection.yml — exactly
      // one segment beneath the collectionsPath base.
      const source = {
        ...mockSource,
        config: { branch: 'main', collectionsPath: '/collections' }
      };

      nock(apiBase)
        .get(`${repoApiPath}/items`)
        .query((q) => !q.path && q.recursionLevel === 'Full')
        .reply(200, {
          count: 5,
          value: [
            { objectId: 'r', gitObjectType: 'tree', commitId: 'c1', path: '/', isFolder: true },
            { objectId: 'cd', gitObjectType: 'tree', commitId: 'c1', path: '/collections', isFolder: true },
            { objectId: 'cf', gitObjectType: 'blob', commitId: 'c1', path: '/collections/my-collection.collection.yml', isFolder: false },
            { objectId: 'pd', gitObjectType: 'tree', commitId: 'c1', path: '/prompts', isFolder: true },
            { objectId: 'pf', gitObjectType: 'blob', commitId: 'c1', path: '/prompts/task-helper.prompt.md', isFolder: false }
          ]
        });

      nock(apiBase)
        .get(`${repoApiPath}/items`)
        .query((q) => q.path === '/collections/my-collection.collection.yml')
        .reply(200, makeCollectionYaml({
          id: 'my-collection',
          name: 'My Flat Collection',
          version: '2.0.0',
          items: [{ path: 'prompts/task-helper.prompt.md', kind: 'prompt' }]
        }));

      const adapter = new AzureDevOpsAdapter(source);
      const bundles = await adapter.fetchBundles();

      assert.strictEqual(bundles.length, 1);
      assert.strictEqual(bundles[0].name, 'My Flat Collection');
      assert.strictEqual(bundles[0].version, '2.0.0');
      // Bundle ID must equal the collectionId from the manifest.
      assert.strictEqual(
        bundles[0].id,
        'my-collection',
        'depth-0 bundle ID must equal the collectionId from the manifest'
      );
    });

    test('should discover multiple bundles from multiple .collection.yml blobs', async () => {
      nock(apiBase)
        .get(`${repoApiPath}/items`)
        .query((q) => !q.path && q.recursionLevel === 'Full')
        .reply(200, {
          count: 5,
          value: [
            { objectId: 'r', gitObjectType: 'tree', commitId: 'c1', path: '/', isFolder: true },
            { objectId: 'd1', gitObjectType: 'tree', commitId: 'c1', path: '/bundle-a', isFolder: true },
            { objectId: 'c1', gitObjectType: 'blob', commitId: 'c1', path: '/bundle-a/bundle-a.collection.yml', isFolder: false },
            { objectId: 'd2', gitObjectType: 'tree', commitId: 'c1', path: '/bundle-b', isFolder: true },
            { objectId: 'c2', gitObjectType: 'blob', commitId: 'c1', path: '/bundle-b/bundle-b.collection.yml', isFolder: false }
          ]
        });

      nock(apiBase)
        .get(`${repoApiPath}/items`)
        .query((q) => q.path === '/bundle-a/bundle-a.collection.yml')
        .reply(200, makeCollectionYaml({ name: 'Bundle A', version: '1.0.0' }));

      nock(apiBase)
        .get(`${repoApiPath}/items`)
        .query((q) => q.path === '/bundle-b/bundle-b.collection.yml')
        .reply(200, makeCollectionYaml({ name: 'Bundle B', version: '2.0.0' }));

      const adapter = new AzureDevOpsAdapter(mockSource);
      const bundles = await adapter.fetchBundles();

      assert.strictEqual(bundles.length, 2);
      const names = bundles.map((b) => b.name).toSorted();
      assert.deepStrictEqual(names, ['Bundle A', 'Bundle B']);
    });

    test('should scope results to collectionsPath when configured', async () => {
      const source = {
        ...mockSource,
        config: { branch: 'main', collectionsPath: '/bundles' }
      };

      // Tree contains a .collection.yml inside /bundles (should be discovered)
      // and one outside /bundles (should be ignored)
      nock(apiBase)
        .get(`${repoApiPath}/items`)
        .query((q) => !q.path && q.recursionLevel === 'Full')
        .reply(200, {
          count: 4,
          value: [
            { objectId: 'r', gitObjectType: 'tree', commitId: 'c1', path: '/', isFolder: true },
            { objectId: 'd1', gitObjectType: 'tree', commitId: 'c1', path: '/bundles', isFolder: true },
            { objectId: 'd2', gitObjectType: 'tree', commitId: 'c1', path: '/bundles/my-bundle', isFolder: true },
            { objectId: 'c1', gitObjectType: 'blob', commitId: 'c1', path: '/bundles/my-bundle/my-bundle.collection.yml', isFolder: false }
          ]
        });

      nock(apiBase)
        .get(`${repoApiPath}/items`)
        .query((q) => q.path === '/bundles/my-bundle/my-bundle.collection.yml')
        .reply(200, makeCollectionYaml({ name: 'In Bundles' }));

      const adapter = new AzureDevOpsAdapter(source);
      const bundles = await adapter.fetchBundles();

      assert.strictEqual(bundles.length, 1);
      assert.strictEqual(bundles[0].name, 'In Bundles');
    });

    test('should always omit path param from tree fetch regardless of collectionsPath', async () => {
      for (const cp of ['/', '/skills', '/prompts/bundles']) {
        const source = { ...mockSource, config: { branch: 'main', collectionsPath: cp } };
        let capturedQuery: Record<string, unknown> = {};
        nock(apiBase)
          .get(`${repoApiPath}/items`)
          .query((q) => {
            capturedQuery = q as Record<string, unknown>;
            return !q.path && q.recursionLevel === 'Full';
          })
          .reply(200, { count: 0, value: [] });

        const adapter = new AzureDevOpsAdapter(source);
        await adapter.fetchBundles();

        assert.strictEqual(capturedQuery.path, undefined,
          `path query param must be absent for collectionsPath="${cp}"`);
      }
    });

    test('should throw when ADO API returns an error', async () => {
      nock(apiBase)
        .get(`${repoApiPath}/items`)
        .query((q) => !q.path && q.recursionLevel === 'Full')
        .reply(401, { message: 'Unauthorized' });

      const adapter = new AzureDevOpsAdapter(mockSource);
      await assert.rejects(
        () => adapter.fetchBundles(),
        /Failed to fetch bundles from Azure DevOps/
      );
    });

    test('should use Bearer token from VS Code Microsoft auth when no PAT is set', async () => {
      const sourceNoPat = { ...mockSource, token: undefined };
      const mockToken = 'vscode-microsoft-bearer-token';

      (vscode.authentication.getSession as sinon.SinonStub).callsFake(
        (providerId: string) => {
          if (providerId === 'microsoft') {
            return Promise.resolve({
              accessToken: mockToken,
              id: 'session-id',
              scopes: ['499b84ac-1321-427f-aa17-267ca6975798/.default'],
              account: { id: 'user', label: 'user@example.com' }
            });
          }
          return Promise.resolve(undefined);
        }
      );

      nock(apiBase)
        .get(`${repoApiPath}/items`)
        .query((q) => !q.path && q.recursionLevel === 'Full')
        .matchHeader('Authorization', `Bearer ${mockToken}`)
        .reply(200, { count: 0, value: [] });

      const adapter = new AzureDevOpsAdapter(sourceNoPat);
      const bundles = await adapter.fetchBundles();

      assert.strictEqual(bundles.length, 0);
    });
  });

  // ---------------------------------------------------------------------------
  // downloadBundle — in-memory ZIP assembly
  // ---------------------------------------------------------------------------

  suite('downloadBundle()', () => {
    test('should fetch .collection.yml and assemble a ZIP containing item files and a deployment manifest', async () => {
      const collectionYaml = makeCollectionYaml({
        name: 'Download Test',
        items: [{ path: 'prompts/hello.prompt.md', kind: 'prompt' }]
      });

      // 1. fetchBundles needs the full tree
      nock(apiBase)
        .get(`${repoApiPath}/items`)
        .query((q) => !q.path && q.recursionLevel === 'Full')
        .twice() // called once for fetchBundles, once inside downloadBundle
        .reply(200, {
          count: 3,
          value: [
            { objectId: 'r', gitObjectType: 'tree', commitId: 'c1', path: '/', isFolder: true },
            { objectId: 'd1', gitObjectType: 'tree', commitId: 'c1', path: '/my-bundle', isFolder: true },
            { objectId: 'coll', gitObjectType: 'blob', commitId: 'c1', path: '/my-bundle/my-bundle.collection.yml', isFolder: false }
          ]
        });

      // 2. fetchBundles fetches the collection YAML
      nock(apiBase)
        .get(`${repoApiPath}/items`)
        .query((q) => q.path === '/my-bundle/my-bundle.collection.yml')
        .twice() // once for fetchBundles, once for downloadBundle
        .reply(200, collectionYaml);

      // 3. downloadBundle fetches each item file
      nock(apiBase)
        .get(`${repoApiPath}/items`)
        .query((q) => q.path === 'prompts/hello.prompt.md')
        .reply(200, '# Hello prompt');

      const adapter = new AzureDevOpsAdapter(mockSource);
      const bundles = await adapter.fetchBundles();
      assert.strictEqual(bundles.length, 1);

      const zipBuffer = await adapter.downloadBundle(bundles[0]);

      assert.ok(Buffer.isBuffer(zipBuffer), 'downloadBundle should return a Buffer');
      assert.ok(zipBuffer.length > 0, 'ZIP buffer should not be empty');
      // ZIP magic number PK (0x504B)
      assert.strictEqual(zipBuffer[0], 0x50);
      assert.strictEqual(zipBuffer[1], 0x4B);
    });

    test('should fetch all files in a skill directory and include them in the ZIP', async () => {
      const collectionYaml = makeCollectionYaml({
        name: 'Skill Test',
        items: [{ path: 'skills/my-skill', kind: 'skill' }]
      });

      // Full tree includes the skill directory contents
      const fullTree = {
        count: 6,
        value: [
          { objectId: 'r', gitObjectType: 'tree', commitId: 'c1', path: '/', isFolder: true },
          { objectId: 'd1', gitObjectType: 'tree', commitId: 'c1', path: '/my-bundle', isFolder: true },
          { objectId: 'coll', gitObjectType: 'blob', commitId: 'c1', path: '/my-bundle/my-bundle.collection.yml', isFolder: false },
          { objectId: 'sd', gitObjectType: 'tree', commitId: 'c1', path: '/skills/my-skill', isFolder: true },
          { objectId: 'sm', gitObjectType: 'blob', commitId: 'c1', path: '/skills/my-skill/SKILL.md', isFolder: false },
          { objectId: 'ss', gitObjectType: 'blob', commitId: 'c1', path: '/skills/my-skill/scripts/run.sh', isFolder: false }
        ]
      };

      nock(apiBase)
        .get(`${repoApiPath}/items`)
        .query((q) => !q.path && q.recursionLevel === 'Full')
        .twice()
        .reply(200, fullTree);

      nock(apiBase)
        .get(`${repoApiPath}/items`)
        .query((q) => q.path === '/my-bundle/my-bundle.collection.yml')
        .twice()
        .reply(200, collectionYaml);

      nock(apiBase)
        .get(`${repoApiPath}/items`)
        .query((q) => q.path === '/skills/my-skill/SKILL.md')
        .reply(200, '# My Skill\n');

      nock(apiBase)
        .get(`${repoApiPath}/items`)
        .query((q) => q.path === '/skills/my-skill/scripts/run.sh')
        .reply(200, '#!/bin/sh\n');

      const adapter = new AzureDevOpsAdapter(mockSource);
      const bundles = await adapter.fetchBundles();
      assert.strictEqual(bundles.length, 1);

      const zipBuffer = await adapter.downloadBundle(bundles[0]);

      assert.ok(Buffer.isBuffer(zipBuffer), 'downloadBundle should return a Buffer');
      assert.ok(zipBuffer.length > 0, 'ZIP buffer should not be empty');
      // ZIP magic number PK (0x504B)
      assert.strictEqual(zipBuffer[0], 0x50);
      assert.strictEqual(zipBuffer[1], 0x4B);
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

      nock(apiBase)
        .get(`${repoApiPath}/items`)
        .query((q) => !q.path && q.recursionLevel === 'Full')
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
      nock(apiBase)
        .get(`${repoApiPath}`)
        .query(true)
        .reply(200, { id: 'r', name: 'myrepo', project: { name: 'p' }, remoteUrl: '' });

      nock(apiBase)
        .get(`${repoApiPath}/items`)
        .query((q) => !q.path && q.recursionLevel === 'Full')
        .reply(200, {
          count: 3,
          value: [
            { objectId: 'r', gitObjectType: 'tree', commitId: 'c1', path: '/', isFolder: true },
            { objectId: 'd1', gitObjectType: 'tree', commitId: 'c1', path: '/bundle1', isFolder: true },
            { objectId: 'c1', gitObjectType: 'blob', commitId: 'c1', path: '/bundle1/bundle1.collection.yml', isFolder: false }
          ]
        });

      nock(apiBase)
        .get(`${repoApiPath}/items`)
        .query((q) => q.path === '/bundle1/bundle1.collection.yml')
        .reply(200, makeCollectionYaml({ name: 'Bundle 1' }));

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
        .query((q) => !q.path && q.recursionLevel === 'Full')
        .reply(200, { count: 0, value: [] });

      const adapter = new AzureDevOpsAdapter(mockSource);
      const result = await adapter.validate();

      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.warnings.length, 1);
      assert.ok(result.warnings[0].includes('No bundles found'));
    });

    test('should return invalid when URL is malformed', () => {
      const source = { ...mockSource, url: 'https://github.com/org/repo' };
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
    test('should return the source repository URL', () => {
      const adapter = new AzureDevOpsAdapter(mockSource);
      const bundleId = 'my-collection';

      const manifestUrl = adapter.getManifestUrl(bundleId);
      assert.strictEqual(manifestUrl, mockSource.url, 'manifest URL should be the source repository URL');

      const downloadUrl = adapter.getDownloadUrl(bundleId);
      assert.strictEqual(downloadUrl, mockSource.url, 'download URL should be the source repository URL');
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

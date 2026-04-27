/**
 * LocalAwesomeCopilotPluginAdapter Unit Tests
 * Tests the plugin-format bundle discovery from local awesome-copilot directories
 * that use plugins/<id>/.github/plugin/plugin.json instead of collections/*.collection.yml
 */

import * as assert from 'node:assert';
import * as path from 'node:path';
import * as yaml from 'js-yaml';
import yauzl from 'yauzl';
import {
  LocalAwesomeCopilotPluginAdapter,
} from '../../src/adapters/local-awesome-copilot-plugin-adapter';
import {
  Bundle,
  RegistrySource,
} from '../../src/types/registry';

const FIXTURES_DIR = path.resolve(__dirname, '../fixtures/local-awesome-plugins');

/**
 * Extract all entries from a ZIP buffer into a map of path → contents.
 * @param buffer - ZIP file as a Buffer
 */
function extractZipBuffer(buffer: Buffer): Promise<Map<string, string>> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (err, zipfile) => {
      if (err || !zipfile) {
        reject(err || new Error('Failed to open ZIP'));
        return;
      }
      const entries = new Map<string, string>();
      zipfile.readEntry();
      zipfile.on('entry', (entry) => {
        if (/\/$/.test(entry.fileName)) {
          zipfile.readEntry();
          return;
        }
        zipfile.openReadStream(entry, (streamErr, readStream) => {
          if (streamErr || !readStream) {
            reject(streamErr || new Error('Failed to read entry'));
            return;
          }
          const chunks: Buffer[] = [];
          readStream.on('data', (chunk: Buffer) => chunks.push(chunk));
          readStream.on('end', () => {
            entries.set(entry.fileName, Buffer.concat(chunks).toString('utf8'));
            zipfile.readEntry();
          });
          readStream.on('error', reject);
        });
      });
      zipfile.on('end', () => resolve(entries));
      zipfile.on('error', reject);
    });
  });
}

suite('LocalAwesomeCopilotPluginAdapter', () => {
  const mockSource: RegistrySource = {
    id: 'local-plugin-test',
    name: 'Local Plugin Test',
    type: 'local-awesome-copilot-plugin',
    url: FIXTURES_DIR,
    enabled: true,
    priority: 1
  };

  suite('Constructor', () => {
    test('should accept valid local path', () => {
      const adapter = new LocalAwesomeCopilotPluginAdapter(mockSource);
      assert.strictEqual(adapter.type, 'local-awesome-copilot-plugin');
    });

    test('should accept file:// URL', () => {
      const source = { ...mockSource, url: `file://${FIXTURES_DIR}` };
      const adapter = new LocalAwesomeCopilotPluginAdapter(source);
      assert.ok(adapter);
    });

    test('should throw for invalid path', () => {
      const source = { ...mockSource, url: 'https://not-a-local-path.com' };
      assert.throws(() => new LocalAwesomeCopilotPluginAdapter(source), /Invalid local path/);
    });
  });

  suite('fetchBundles', () => {
    test('should discover all plugins from local directory', async () => {
      const adapter = new LocalAwesomeCopilotPluginAdapter(mockSource);
      const bundles = await adapter.fetchBundles();

      assert.strictEqual(bundles.length, 6);
      const bundleIds = bundles.map((b: Bundle) => b.id).toSorted();
      assert.deepStrictEqual(bundleIds, ['no-items-plugin', 'oracle-style-plugin', 'python-dev', 'skills-plugin', 'test-plugin', 'upstream-plugin']);
    });

    test('should parse plugin.json correctly', async () => {
      const adapter = new LocalAwesomeCopilotPluginAdapter(mockSource);
      const bundles = await adapter.fetchBundles();

      const testPlugin = bundles.find((b: Bundle) => b.id === 'test-plugin');
      assert.ok(testPlugin);
      assert.strictEqual(testPlugin.name, 'test-plugin');
      assert.strictEqual(testPlugin.description, 'A test plugin for unit testing');
      assert.deepStrictEqual(testPlugin.tags, ['test', 'example', 'azure']);
      assert.strictEqual(testPlugin.sourceId, 'local-plugin-test');
    });

    test('should extract author from plugin.json', async () => {
      const adapter = new LocalAwesomeCopilotPluginAdapter(mockSource);
      const bundles = await adapter.fetchBundles();

      const skillsPlugin = bundles.find((b: Bundle) => b.id === 'skills-plugin');
      assert.ok(skillsPlugin);
      assert.strictEqual(skillsPlugin.author, 'Test Author');
    });

    test('should use cache for repeated calls', async () => {
      const adapter = new LocalAwesomeCopilotPluginAdapter(mockSource);
      const bundles1 = await adapter.fetchBundles();
      const bundles2 = await adapter.fetchBundles();

      assert.strictEqual(bundles1.length, bundles2.length);
    });

    test('should handle non-existent plugins directory', async () => {
      const source = { ...mockSource, url: '/tmp/non-existent-dir-12345' };
      const adapter = new LocalAwesomeCopilotPluginAdapter(source);

      await assert.rejects(
        () => adapter.fetchBundles(),
        /Failed to list local awesome-copilot plugins/
      );
    });
  });

  suite('downloadBundle', () => {
    test('should create ZIP archive from plugin items', async () => {
      const adapter = new LocalAwesomeCopilotPluginAdapter(mockSource);
      const bundles = await adapter.fetchBundles();

      const testPlugin = bundles.find((b: Bundle) => b.id === 'test-plugin');
      assert.ok(testPlugin);

      const buffer = await adapter.downloadBundle(testPlugin);
      assert.ok(Buffer.isBuffer(buffer));
      assert.ok(buffer.length > 0);
    });

    test('should create archive for plugin with multiple skills', async () => {
      const adapter = new LocalAwesomeCopilotPluginAdapter(mockSource);
      const bundles = await adapter.fetchBundles();

      const skillsPlugin = bundles.find((b: Bundle) => b.id === 'skills-plugin');
      assert.ok(skillsPlugin);

      const buffer = await adapter.downloadBundle(skillsPlugin);
      assert.ok(Buffer.isBuffer(buffer));
      assert.ok(buffer.length > 200, 'Archive should contain multiple skill files');
    });
  });

  suite('fetchMetadata', () => {
    test('should return directory metadata with plugin count', async () => {
      const adapter = new LocalAwesomeCopilotPluginAdapter(mockSource);
      const metadata = await adapter.fetchMetadata();

      assert.ok(metadata.name);
      assert.ok(metadata.description.includes('plugin'));
      assert.strictEqual(metadata.bundleCount, 6);
    });
  });

  suite('validate', () => {
    test('should validate accessible directory with plugins', async () => {
      const adapter = new LocalAwesomeCopilotPluginAdapter(mockSource);
      const result = await adapter.validate();

      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.errors.length, 0);
      assert.strictEqual(result.bundlesFound, 6);
    });

    test('should fail validation for non-existent directory', async () => {
      const source = { ...mockSource, url: '/tmp/non-existent-dir-12345' };
      const adapter = new LocalAwesomeCopilotPluginAdapter(source);
      const result = await adapter.validate();

      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.length > 0);
    });
  });

  suite('fetchBundles - edge cases', () => {
    test('should handle plugin.json without items array', async () => {
      const adapter = new LocalAwesomeCopilotPluginAdapter(mockSource);
      const bundles = await adapter.fetchBundles();

      const noItemsPlugin = bundles.find((b: Bundle) => b.id === 'no-items-plugin');
      assert.ok(noItemsPlugin);
      assert.strictEqual(noItemsPlugin.size, '0 items');
    });

    test('should derive items from upstream agents/skills arrays', async () => {
      const adapter = new LocalAwesomeCopilotPluginAdapter(mockSource);
      const bundles = await adapter.fetchBundles();

      const upstreamPlugin = bundles.find((b: Bundle) => b.id === 'upstream-plugin');
      assert.ok(upstreamPlugin, 'upstream-plugin should be found');
      assert.strictEqual(upstreamPlugin.version, '1.1.0');
      assert.deepStrictEqual(upstreamPlugin.tags, ['java', 'testing']);
      assert.strictEqual(upstreamPlugin.size, '2 items');
      assert.deepStrictEqual((upstreamPlugin as any).breakdown, {
        prompts: 0, instructions: 0, chatmodes: 0, agents: 1, skills: 1
      });
    });

    test('should create archive for upstream-format plugin with agents/skills', async () => {
      const adapter = new LocalAwesomeCopilotPluginAdapter(mockSource);
      const bundles = await adapter.fetchBundles();

      const upstreamPlugin = bundles.find((b: Bundle) => b.id === 'upstream-plugin');
      assert.ok(upstreamPlugin);

      const buffer = await adapter.downloadBundle(upstreamPlugin);
      assert.ok(Buffer.isBuffer(buffer));
      assert.ok(buffer.length > 200, 'Archive should contain skill and agent files');
    });

    test('should generate correct deployment manifest for oracle-style plugin (./agents parent dir + ./skills/X subdirs)', async () => {
      // Regression test for real-world upstream plugin shape where:
      //   agents: ['./agents']  (parent dir with flat .md files)
      //   skills: ['./skills/migrate-data']  (subdir containing SKILL.md)
      // The deployment manifest MUST point agents to the actual .md filename and
      // skills to the SKILL.md path, otherwise UserScopeService.syncSkillFromBundle
      // fails and the 'Open' button opens a directory (causing 'is actually a directory').
      const adapter = new LocalAwesomeCopilotPluginAdapter(mockSource);
      const bundles = await adapter.fetchBundles();

      const oracle = bundles.find((b: Bundle) => b.id === 'oracle-style-plugin');
      assert.ok(oracle, 'oracle-style-plugin must be discovered');

      const buffer = await adapter.downloadBundle(oracle);
      const entries = await extractZipBuffer(buffer);
      const manifestYaml = entries.get('deployment-manifest.yml');
      assert.ok(manifestYaml, 'deployment-manifest.yml must be present in archive');

      const manifest = yaml.load(manifestYaml) as {
        prompts: { id: string; file: string; type: string; name: string }[];
      };

      // Should produce exactly 2 prompt defs: 1 agent + 1 skill (not "agents" as directory)
      assert.strictEqual(manifest.prompts.length, 2);

      const agentEntry = manifest.prompts.find((p) => p.type === 'agent');
      assert.ok(agentEntry, 'must have exactly one agent entry');
      assert.strictEqual(agentEntry.id, 'migration-expert',
        'agent id must be derived from the .md filename');
      assert.strictEqual(agentEntry.file, 'agents/migration-expert.md',
        'agent file must point to the .md file, NOT the agents directory');
      assert.strictEqual(agentEntry.name, 'Migration Expert');

      const skillEntry = manifest.prompts.find((p) => p.type === 'skill');
      assert.ok(skillEntry, 'must have exactly one skill entry');
      assert.strictEqual(skillEntry.id, 'migrate-data');
      assert.strictEqual(skillEntry.file, 'skills/migrate-data/SKILL.md',
        'skill file MUST include /SKILL.md suffix for UserScopeService to sync it to ~/.copilot/skills/');

      // Verify content files are actually in the archive
      assert.ok(entries.has('agents/migration-expert.md'), 'agent .md must be in archive');
      assert.ok(entries.has('skills/migrate-data/SKILL.md'), 'SKILL.md must be in archive');

      // Sanity check: content matches the fixture
      assert.ok(entries.get('agents/migration-expert.md')?.includes('Migration Expert Agent'));
      assert.ok(entries.get('skills/migrate-data/SKILL.md')?.includes('Migrate Data Skill'));
    });
  });

  suite('getManifestUrl', () => {
    test('should return file:// URL to plugin.json', () => {
      const adapter = new LocalAwesomeCopilotPluginAdapter(mockSource);
      const url = adapter.getManifestUrl('test-plugin');

      assert.ok(url.startsWith('file://'));
      assert.ok(url.includes('test-plugin/.github/plugin/plugin.json'));
    });
  });
});

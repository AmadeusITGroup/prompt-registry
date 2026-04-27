/**
 * AwesomeCopilotPluginAdapter Unit Tests
 * Tests the plugin-format bundle discovery from awesome-copilot repositories
 * that use plugins/<id>/.github/plugin/plugin.json instead of collections/*.collection.yml
 */

import * as assert from 'node:assert';
import * as yaml from 'js-yaml';
import nock from 'nock';
import yauzl from 'yauzl';
import {
  AwesomeCopilotPluginAdapter,
} from '../../src/adapters/awesome-copilot-plugin-adapter';
import {
  Bundle,
  RegistrySource,
} from '../../src/types/registry';

/**
 * Extract all entries from a ZIP buffer into a map of path → contents (string).
 * Useful for verifying generated bundle archives in tests.
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

suite('AwesomeCopilotPluginAdapter', () => {
  const mockSource: RegistrySource = {
    id: 'awesome-plugin-test',
    name: 'Awesome Copilot Plugin Test',
    type: 'awesome-copilot-plugin',
    url: 'https://github.com/test-owner/awesome-copilot',
    enabled: true,
    priority: 1
  };

  teardown(() => {
    nock.cleanAll();
  });

  suite('Constructor and Validation', () => {
    test('should accept valid awesome-copilot-plugin source', () => {
      const adapter = new AwesomeCopilotPluginAdapter(mockSource);
      assert.strictEqual(adapter.type, 'awesome-copilot-plugin');
    });

    test('should use default config values', () => {
      const adapter = new AwesomeCopilotPluginAdapter(mockSource);
      assert.ok(adapter);
    });

    test('should accept custom pluginsPath config', () => {
      const source = {
        ...mockSource,
        config: { pluginsPath: 'custom-plugins', branch: 'develop' }
      };
      const adapter = new AwesomeCopilotPluginAdapter(source);
      assert.ok(adapter);
    });
  });

  suite('fetchBundles', () => {
    test('should discover plugins from plugins directory', async () => {
      // Mock: list plugins directory -> returns subdirectories
      nock('https://api.github.com')
        .get('/repos/test-owner/awesome-copilot/contents/plugins?ref=main')
        .reply(200, [
          { name: 'azure-cloud-development', type: 'dir', path: 'plugins/azure-cloud-development' },
          { name: 'frontend-web-dev', type: 'dir', path: 'plugins/frontend-web-dev' },
          { name: 'external.json', type: 'file', path: 'plugins/external.json' }
        ]);

      // Mock: fetch plugin.json for each plugin directory
      nock('https://raw.githubusercontent.com')
        .get('/test-owner/awesome-copilot/main/plugins/azure-cloud-development/.github/plugin/plugin.json')
        .reply(200, JSON.stringify({
          id: 'azure-cloud-development',
          name: 'azure-cloud-development',
          description: 'Comprehensive Azure cloud development tools',
          path: 'plugins/azure-cloud-development',
          tags: ['azure', 'cloud', 'infrastructure'],
          itemCount: 2,
          items: [
            { kind: 'agent', path: './agents' },
            { kind: 'skill', path: './skills/azure-resource-health-diagnose' }
          ]
        }));

      nock('https://raw.githubusercontent.com')
        .get('/test-owner/awesome-copilot/main/plugins/frontend-web-dev/.github/plugin/plugin.json')
        .reply(200, JSON.stringify({
          id: 'frontend-web-dev',
          name: 'frontend-web-dev',
          description: 'Frontend web development tools',
          path: 'plugins/frontend-web-dev',
          tags: ['frontend', 'web'],
          itemCount: 1,
          items: [
            { kind: 'skill', path: './skills/react-component' }
          ]
        }));

      const adapter = new AwesomeCopilotPluginAdapter(mockSource);
      const bundles = await adapter.fetchBundles();

      assert.strictEqual(bundles.length, 2);

      const azureBundle = bundles.find((b: Bundle) => b.id === 'azure-cloud-development');
      assert.ok(azureBundle);
      assert.strictEqual(azureBundle.name, 'azure-cloud-development');
      assert.strictEqual(azureBundle.description, 'Comprehensive Azure cloud development tools');
      assert.deepStrictEqual(azureBundle.tags, ['azure', 'cloud', 'infrastructure']);
      assert.strictEqual(azureBundle.sourceId, 'awesome-plugin-test');

      const frontendBundle = bundles.find((b: Bundle) => b.id === 'frontend-web-dev');
      assert.ok(frontendBundle);
    });

    test('should skip files in plugins directory (only directories)', async () => {
      nock('https://api.github.com')
        .get('/repos/test-owner/awesome-copilot/contents/plugins?ref=main')
        .reply(200, [
          { name: 'external.json', type: 'file', path: 'plugins/external.json' },
          { name: 'valid-plugin', type: 'dir', path: 'plugins/valid-plugin' }
        ]);

      nock('https://raw.githubusercontent.com')
        .get('/test-owner/awesome-copilot/main/plugins/valid-plugin/.github/plugin/plugin.json')
        .reply(200, JSON.stringify({
          id: 'valid-plugin',
          name: 'valid-plugin',
          description: 'A valid plugin',
          path: 'plugins/valid-plugin',
          tags: [],
          itemCount: 0,
          items: []
        }));

      const adapter = new AwesomeCopilotPluginAdapter(mockSource);
      const bundles = await adapter.fetchBundles();

      assert.strictEqual(bundles.length, 1);
      assert.strictEqual(bundles[0].id, 'valid-plugin');
    });

    test('should handle missing plugin.json gracefully', async () => {
      nock('https://api.github.com')
        .get('/repos/test-owner/awesome-copilot/contents/plugins?ref=main')
        .reply(200, [
          { name: 'good-plugin', type: 'dir', path: 'plugins/good-plugin' },
          { name: 'bad-plugin', type: 'dir', path: 'plugins/bad-plugin' }
        ]);

      nock('https://raw.githubusercontent.com')
        .get('/test-owner/awesome-copilot/main/plugins/good-plugin/.github/plugin/plugin.json')
        .reply(200, JSON.stringify({
          id: 'good-plugin',
          name: 'good-plugin',
          description: 'Works fine',
          path: 'plugins/good-plugin',
          tags: [],
          itemCount: 0,
          items: []
        }));

      nock('https://raw.githubusercontent.com')
        .get('/test-owner/awesome-copilot/main/plugins/bad-plugin/.github/plugin/plugin.json')
        .reply(404);

      const adapter = new AwesomeCopilotPluginAdapter(mockSource);
      const bundles = await adapter.fetchBundles();

      // Should skip the bad plugin and return the good one
      assert.strictEqual(bundles.length, 1);
      assert.strictEqual(bundles[0].id, 'good-plugin');
    });

    test('should handle plugin.json without items array', async () => {
      nock('https://api.github.com')
        .get('/repos/test-owner/awesome-copilot/contents/plugins?ref=main')
        .reply(200, [
          { name: 'no-items-plugin', type: 'dir', path: 'plugins/no-items-plugin' }
        ]);

      nock('https://raw.githubusercontent.com')
        .get('/test-owner/awesome-copilot/main/plugins/no-items-plugin/.github/plugin/plugin.json')
        .reply(200, JSON.stringify({
          id: 'no-items-plugin',
          name: 'no-items-plugin',
          description: 'Plugin without items array',
          path: 'plugins/no-items-plugin',
          tags: ['testing'],
          itemCount: 0
        }));

      const adapter = new AwesomeCopilotPluginAdapter(mockSource);
      const bundles = await adapter.fetchBundles();

      assert.strictEqual(bundles.length, 1);
      assert.strictEqual(bundles[0].id, 'no-items-plugin');
      assert.strictEqual(bundles[0].size, '0 items');
    });

    test('should use name as id and derive items from upstream agents/skills arrays', async () => {
      nock('https://api.github.com')
        .get('/repos/test-owner/awesome-copilot/contents/plugins?ref=main')
        .reply(200, [
          { name: 'upstream-plugin', type: 'dir', path: 'plugins/upstream-plugin' }
        ]);

      nock('https://raw.githubusercontent.com')
        .get('/test-owner/awesome-copilot/main/plugins/upstream-plugin/.github/plugin/plugin.json')
        .reply(200, JSON.stringify({
          name: 'upstream-plugin',
          description: 'Plugin using upstream format (no id field)',
          version: '1.1.0',
          keywords: ['testing', 'csharp'],
          author: { name: 'Community' },
          repository: 'https://github.com/github/awesome-copilot',
          license: 'MIT',
          skills: ['./skills/java-docs', './skills/java-junit'],
          agents: ['./agents/code-reviewer']
        }));

      const adapter = new AwesomeCopilotPluginAdapter(mockSource);
      const bundles = await adapter.fetchBundles();

      assert.strictEqual(bundles.length, 1);
      assert.strictEqual(bundles[0].id, 'upstream-plugin');
      assert.strictEqual(bundles[0].version, '1.1.0');
      assert.deepStrictEqual(bundles[0].tags, ['testing', 'csharp']);
      assert.strictEqual(bundles[0].size, '3 items');
      assert.deepStrictEqual((bundles[0] as any).breakdown, {
        prompts: 0, instructions: 0, chatmodes: 0, agents: 1, skills: 2
      });
    });

    test('should handle empty plugins directory', async () => {
      nock('https://api.github.com')
        .get('/repos/test-owner/awesome-copilot/contents/plugins?ref=main')
        .reply(200, []);

      const adapter = new AwesomeCopilotPluginAdapter(mockSource);
      const bundles = await adapter.fetchBundles();

      assert.strictEqual(bundles.length, 0);
    });

    test('should use cache for repeated calls', async () => {
      nock('https://api.github.com')
        .get('/repos/test-owner/awesome-copilot/contents/plugins?ref=main')
        .reply(200, [
          { name: 'cached-plugin', type: 'dir', path: 'plugins/cached-plugin' }
        ]);

      nock('https://raw.githubusercontent.com')
        .get('/test-owner/awesome-copilot/main/plugins/cached-plugin/.github/plugin/plugin.json')
        .reply(200, JSON.stringify({
          id: 'cached-plugin',
          name: 'cached-plugin',
          description: 'Cached',
          path: 'plugins/cached-plugin',
          tags: [],
          itemCount: 0,
          items: []
        }));

      const adapter = new AwesomeCopilotPluginAdapter(mockSource);
      const bundles1 = await adapter.fetchBundles();
      const bundles2 = await adapter.fetchBundles();

      // Second call should use cache (nock would throw if second request was made)
      assert.strictEqual(bundles1.length, 1);
      assert.strictEqual(bundles2.length, 1);
    });

    test('should skip external plugins (external: true)', async () => {
      nock('https://api.github.com')
        .get('/repos/test-owner/awesome-copilot/contents/plugins?ref=main')
        .reply(200, [
          { name: 'local-plugin', type: 'dir', path: 'plugins/local-plugin' },
          { name: 'external-plugin', type: 'dir', path: 'plugins/external-plugin' }
        ]);

      nock('https://raw.githubusercontent.com')
        .get('/test-owner/awesome-copilot/main/plugins/local-plugin/.github/plugin/plugin.json')
        .reply(200, JSON.stringify({
          id: 'local-plugin',
          name: 'local-plugin',
          description: 'Local plugin',
          path: 'plugins/local-plugin',
          tags: [],
          itemCount: 1,
          items: [{ kind: 'skill', path: './skills/foo' }]
        }));

      nock('https://raw.githubusercontent.com')
        .get('/test-owner/awesome-copilot/main/plugins/external-plugin/.github/plugin/plugin.json')
        .reply(200, JSON.stringify({
          id: 'external-plugin',
          name: 'external-plugin',
          description: 'External plugin hosted elsewhere',
          path: 'plugins/external-plugin',
          tags: [],
          itemCount: 0,
          items: [],
          external: true,
          repository: 'https://github.com/other/repo'
        }));

      const adapter = new AwesomeCopilotPluginAdapter(mockSource);
      const bundles = await adapter.fetchBundles();

      // External plugins should be skipped (they have no installable content in this repo)
      assert.strictEqual(bundles.length, 1);
      assert.strictEqual(bundles[0].id, 'local-plugin');
    });
  });

  suite('downloadBundle', () => {
    test('should create ZIP archive from plugin items', async () => {
      const mockBundle: Bundle = {
        id: 'test-plugin',
        name: 'Test Plugin',
        version: '1.0.0',
        description: 'Test',
        author: 'test-owner',
        sourceId: 'awesome-plugin-test',
        environments: ['general'],
        tags: ['test'],
        lastUpdated: '2025-01-01T00:00:00Z',
        size: '2 items',
        dependencies: [],
        license: 'MIT',
        manifestUrl: 'https://example.com/manifest.json',
        downloadUrl: 'https://example.com/bundle.zip'
      };
      // Attach plugin metadata
      (mockBundle as any).pluginDir = 'test-plugin';
      (mockBundle as any).pluginItems = [
        { kind: 'skill', path: './skills/my-skill' }
      ];

      // Mock: list skill directory contents
      nock('https://api.github.com')
        .get('/repos/test-owner/awesome-copilot/contents/plugins/test-plugin/skills/my-skill?ref=main')
        .reply(200, [
          { name: 'SKILL.md', path: 'plugins/test-plugin/skills/my-skill/SKILL.md', type: 'file' }
        ]);

      // Mock: fetch skill file
      nock('https://raw.githubusercontent.com')
        .get('/test-owner/awesome-copilot/main/plugins/test-plugin/skills/my-skill/SKILL.md')
        .reply(200, '# My Skill\n\nSkill content here');

      const adapter = new AwesomeCopilotPluginAdapter(mockSource);
      const buffer = await adapter.downloadBundle(mockBundle);

      assert.ok(Buffer.isBuffer(buffer));
      assert.ok(buffer.length > 0);
    });

    test('should resolve upstream ./agents directory into per-file agent entries', async () => {
      // Matches the real-world oracle-to-postgres-migration-expert plugin shape:
      // agents: ["./agents"] with ONE flat .md file inside.
      // The previous (buggy) behavior produced a single agent named "agents" pointing at
      // the agents/ directory, causing "is actually a directory" errors on open.
      const mockBundle: Bundle = {
        id: 'oracle-to-postgres-migration-expert',
        name: 'oracle-to-postgres-migration-expert',
        version: '1.0.0',
        description: 'Expert agent for Oracle-to-PostgreSQL migrations',
        author: 'test-owner',
        sourceId: 'awesome-plugin-test',
        environments: ['general'],
        tags: ['oracle', 'postgresql'],
        lastUpdated: '2025-01-01T00:00:00Z',
        size: '2 items',
        dependencies: [],
        license: 'MIT',
        manifestUrl: 'https://example.com/manifest.json',
        downloadUrl: 'https://example.com/bundle.zip'
      };
      (mockBundle as any).pluginDir = 'oracle-to-postgres-migration-expert';
      (mockBundle as any).pluginItems = [
        { kind: 'agent', path: './agents' },
        { kind: 'skill', path: './skills/creating-oracle-to-postgres-master-migration-plan' }
      ];

      // Mock: agent directory listing (flat .md file pattern)
      nock('https://api.github.com')
        .get('/repos/test-owner/awesome-copilot/contents/plugins/oracle-to-postgres-migration-expert/agents?ref=main')
        .reply(200, [
          {
            name: 'oracle-to-postgres-migration-expert.md',
            path: 'plugins/oracle-to-postgres-migration-expert/agents/oracle-to-postgres-migration-expert.md',
            type: 'file'
          }
        ]);
      nock('https://raw.githubusercontent.com')
        .get('/test-owner/awesome-copilot/main/plugins/oracle-to-postgres-migration-expert/agents/oracle-to-postgres-migration-expert.md')
        .reply(200, '# Oracle To Postgres Migration Expert Agent\n\nAgent content');

      // Mock: skill directory listing (recursive)
      nock('https://api.github.com')
        .get('/repos/test-owner/awesome-copilot/contents/plugins/oracle-to-postgres-migration-expert/skills/creating-oracle-to-postgres-master-migration-plan?ref=main')
        .reply(200, [
          {
            name: 'SKILL.md',
            path: 'plugins/oracle-to-postgres-migration-expert/skills/creating-oracle-to-postgres-master-migration-plan/SKILL.md',
            type: 'file'
          }
        ]);
      nock('https://raw.githubusercontent.com')
        .get('/test-owner/awesome-copilot/main/plugins/oracle-to-postgres-migration-expert/skills/creating-oracle-to-postgres-master-migration-plan/SKILL.md')
        .reply(200, '# Create Master Migration Plan\n\nSkill content');

      const adapter = new AwesomeCopilotPluginAdapter(mockSource);
      const buffer = await adapter.downloadBundle(mockBundle);

      const entries = await extractZipBuffer(buffer);
      const manifestYaml = entries.get('deployment-manifest.yml');
      assert.ok(manifestYaml, 'deployment-manifest.yml must be present');

      const manifest = yaml.load(manifestYaml) as { prompts: { id: string; file: string; type: string; name: string }[] };
      assert.strictEqual(manifest.prompts.length, 2, 'should have 2 prompt entries');

      const agentEntry = manifest.prompts.find((p) => p.type === 'agent');
      assert.ok(agentEntry, 'should have an agent entry');
      assert.strictEqual(agentEntry.id, 'oracle-to-postgres-migration-expert',
        'agent id must be derived from the .md filename, NOT the parent directory name');
      assert.strictEqual(agentEntry.file, 'agents/oracle-to-postgres-migration-expert.md',
        'agent file must point to the actual .md file, NOT the parent directory');
      assert.strictEqual(agentEntry.name, 'Oracle To Postgres Migration Expert');

      const skillEntry = manifest.prompts.find((p) => p.type === 'skill');
      assert.ok(skillEntry, 'should have a skill entry');
      assert.strictEqual(skillEntry.id, 'creating-oracle-to-postgres-master-migration-plan');
      assert.strictEqual(skillEntry.file, 'skills/creating-oracle-to-postgres-master-migration-plan/SKILL.md',
        'skill file must include SKILL.md suffix (required by UserScopeService regex)');

      // Verify actual content files are in the archive
      assert.ok(entries.has('agents/oracle-to-postgres-migration-expert.md'), 'agent .md file must be in archive');
      assert.ok(entries.has('skills/creating-oracle-to-postgres-master-migration-plan/SKILL.md'), 'SKILL.md must be in archive');
    });

    test('should resolve specific agent file path (./agents/my-agent.md)', async () => {
      const mockBundle: Bundle = {
        id: 'flat-agent-plugin',
        name: 'Flat Agent Plugin',
        version: '1.0.0',
        description: 'Plugin with a single flat agent file',
        author: 'test-owner',
        sourceId: 'awesome-plugin-test',
        environments: ['general'],
        tags: [],
        lastUpdated: '2025-01-01T00:00:00Z',
        size: '1 items',
        dependencies: [],
        license: 'MIT',
        manifestUrl: 'https://example.com/manifest.json',
        downloadUrl: 'https://example.com/bundle.zip'
      };
      (mockBundle as any).pluginDir = 'flat-agent-plugin';
      (mockBundle as any).pluginItems = [
        { kind: 'agent', path: './agents/code-reviewer.md' }
      ];

      nock('https://raw.githubusercontent.com')
        .get('/test-owner/awesome-copilot/main/plugins/flat-agent-plugin/agents/code-reviewer.md')
        .reply(200, '# Code Reviewer\n\nContent');

      const adapter = new AwesomeCopilotPluginAdapter(mockSource);
      const buffer = await adapter.downloadBundle(mockBundle);
      const entries = await extractZipBuffer(buffer);
      const manifest = yaml.load(entries.get('deployment-manifest.yml')!) as { prompts: { id: string; file: string; type: string }[] };

      assert.strictEqual(manifest.prompts.length, 1);
      assert.strictEqual(manifest.prompts[0].id, 'code-reviewer');
      assert.strictEqual(manifest.prompts[0].file, 'agents/code-reviewer.md');
      assert.ok(entries.has('agents/code-reviewer.md'));
    });

    test('should resolve agent directory with AGENT.md into single entry', async () => {
      const mockBundle: Bundle = {
        id: 'nested-agent-plugin',
        name: 'Nested Agent Plugin',
        version: '1.0.0',
        description: 'Plugin with agent directory containing AGENT.md',
        author: 'test-owner',
        sourceId: 'awesome-plugin-test',
        environments: ['general'],
        tags: [],
        lastUpdated: '2025-01-01T00:00:00Z',
        size: '1 items',
        dependencies: [],
        license: 'MIT',
        manifestUrl: 'https://example.com/manifest.json',
        downloadUrl: 'https://example.com/bundle.zip'
      };
      (mockBundle as any).pluginDir = 'nested-agent-plugin';
      (mockBundle as any).pluginItems = [
        { kind: 'agent', path: './agents/advisor' }
      ];

      // top-level listing — contains AGENT.md → single agent mode
      nock('https://api.github.com')
        .get('/repos/test-owner/awesome-copilot/contents/plugins/nested-agent-plugin/agents/advisor?ref=main')
        .reply(200, [
          { name: 'AGENT.md', path: 'plugins/nested-agent-plugin/agents/advisor/AGENT.md', type: 'file' }
        ]);
      // recursive listing
      nock('https://api.github.com')
        .get('/repos/test-owner/awesome-copilot/contents/plugins/nested-agent-plugin/agents/advisor?ref=main')
        .reply(200, [
          { name: 'AGENT.md', path: 'plugins/nested-agent-plugin/agents/advisor/AGENT.md', type: 'file' }
        ]);
      nock('https://raw.githubusercontent.com')
        .get('/test-owner/awesome-copilot/main/plugins/nested-agent-plugin/agents/advisor/AGENT.md')
        .reply(200, '# Advisor\n\nContent');

      const adapter = new AwesomeCopilotPluginAdapter(mockSource);
      const buffer = await adapter.downloadBundle(mockBundle);
      const entries = await extractZipBuffer(buffer);
      const manifest = yaml.load(entries.get('deployment-manifest.yml')!) as { prompts: { id: string; file: string; type: string }[] };

      assert.strictEqual(manifest.prompts.length, 1);
      assert.strictEqual(manifest.prompts[0].id, 'advisor');
      assert.strictEqual(manifest.prompts[0].file, 'agents/advisor/AGENT.md');
      assert.ok(entries.has('agents/advisor/AGENT.md'));
    });

    test('should handle flat ./agents dir with multiple .md files (one agent per file)', async () => {
      const mockBundle: Bundle = {
        id: 'multi-agent-plugin',
        name: 'Multi Agent Plugin',
        version: '1.0.0',
        description: 'Plugin with multiple agents in flat directory',
        author: 'test-owner',
        sourceId: 'awesome-plugin-test',
        environments: ['general'],
        tags: [],
        lastUpdated: '2025-01-01T00:00:00Z',
        size: '2 items',
        dependencies: [],
        license: 'MIT',
        manifestUrl: 'https://example.com/manifest.json',
        downloadUrl: 'https://example.com/bundle.zip'
      };
      (mockBundle as any).pluginDir = 'multi-agent-plugin';
      (mockBundle as any).pluginItems = [
        { kind: 'agent', path: './agents' }
      ];

      nock('https://api.github.com')
        .get('/repos/test-owner/awesome-copilot/contents/plugins/multi-agent-plugin/agents?ref=main')
        .reply(200, [
          { name: 'reviewer.md', path: 'plugins/multi-agent-plugin/agents/reviewer.md', type: 'file' },
          { name: 'debugger.md', path: 'plugins/multi-agent-plugin/agents/debugger.md', type: 'file' },
          { name: 'README.md', path: 'plugins/multi-agent-plugin/agents/README.md', type: 'file' } // should be skipped
        ]);
      nock('https://raw.githubusercontent.com')
        .get('/test-owner/awesome-copilot/main/plugins/multi-agent-plugin/agents/reviewer.md')
        .reply(200, '# Reviewer');
      nock('https://raw.githubusercontent.com')
        .get('/test-owner/awesome-copilot/main/plugins/multi-agent-plugin/agents/debugger.md')
        .reply(200, '# Debugger');

      const adapter = new AwesomeCopilotPluginAdapter(mockSource);
      const buffer = await adapter.downloadBundle(mockBundle);
      const entries = await extractZipBuffer(buffer);
      const manifest = yaml.load(entries.get('deployment-manifest.yml')!) as { prompts: { id: string; file: string; type: string }[] };

      assert.strictEqual(manifest.prompts.length, 2, 'README.md should be skipped');
      const ids = manifest.prompts.map((p) => p.id).toSorted();
      assert.deepStrictEqual(ids, ['debugger', 'reviewer']);
      assert.ok(entries.has('agents/reviewer.md'));
      assert.ok(entries.has('agents/debugger.md'));
      assert.ok(!entries.has('agents/README.md'), 'README.md must not be archived');
    });
  });

  suite('fetchMetadata', () => {
    test('should return repository metadata with plugin count', async () => {
      nock('https://api.github.com')
        .get('/repos/test-owner/awesome-copilot/contents/plugins?ref=main')
        .reply(200, [
          { name: 'plugin-a', type: 'dir', path: 'plugins/plugin-a' },
          { name: 'plugin-b', type: 'dir', path: 'plugins/plugin-b' },
          { name: 'external.json', type: 'file', path: 'plugins/external.json' }
        ]);

      const adapter = new AwesomeCopilotPluginAdapter(mockSource);
      const metadata = await adapter.fetchMetadata();

      assert.strictEqual(metadata.name, 'test-owner/awesome-copilot');
      assert.ok(metadata.description.includes('plugin'));
      assert.strictEqual(metadata.bundleCount, 2); // Only directories count
    });
  });

  suite('validate', () => {
    test('should validate accessible repository with plugins', async () => {
      nock('https://api.github.com')
        .get('/repos/test-owner/awesome-copilot/contents/plugins?ref=main')
        .reply(200, [
          { name: 'test-plugin', type: 'dir', path: 'plugins/test-plugin' }
        ]);

      const adapter = new AwesomeCopilotPluginAdapter(mockSource);
      const result = await adapter.validate();

      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.errors.length, 0);
      assert.strictEqual(result.bundlesFound, 1);
    });

    test('should fail validation when plugins directory is missing', async () => {
      nock('https://api.github.com')
        .get('/repos/test-owner/awesome-copilot/contents/plugins?ref=main')
        .reply(404);

      const adapter = new AwesomeCopilotPluginAdapter(mockSource);
      const result = await adapter.validate();

      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.length > 0);
    });

    test('should fail validation when no plugin directories found', async () => {
      nock('https://api.github.com')
        .get('/repos/test-owner/awesome-copilot/contents/plugins?ref=main')
        .reply(200, [
          { name: 'external.json', type: 'file', path: 'plugins/external.json' }
        ]);

      const adapter = new AwesomeCopilotPluginAdapter(mockSource);
      const result = await adapter.validate();

      assert.strictEqual(result.valid, false);
      assert.ok(result.errors[0].includes('No plugin directories'));
    });
  });

  suite('getManifestUrl', () => {
    test('should return plugin.json URL', () => {
      const adapter = new AwesomeCopilotPluginAdapter(mockSource);
      const url = adapter.getManifestUrl('azure-cloud-development');

      assert.strictEqual(
        url,
        'https://raw.githubusercontent.com/test-owner/awesome-copilot/main/plugins/azure-cloud-development/.github/plugin/plugin.json'
      );
    });
  });

  suite('getDownloadUrl', () => {
    test('should return plugin.json URL (same as manifest)', () => {
      const adapter = new AwesomeCopilotPluginAdapter(mockSource);
      const url = adapter.getDownloadUrl('my-plugin');

      assert.strictEqual(url, adapter.getManifestUrl('my-plugin'));
    });
  });
});

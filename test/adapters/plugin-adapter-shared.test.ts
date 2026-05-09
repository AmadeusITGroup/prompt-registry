/**
 * Unit tests for plugin-adapter-shared.ts pure helper functions.
 * These functions are I/O-free and can be tested in full isolation.
 */

import * as assert from 'node:assert';
import {
  calculateBreakdown,
  createDeploymentManifest,
  derivePluginItems,
  extractAuthorName,
  extractMcpServers,
  inferEnvironments,
  mapKindToType,
  PluginItem,
  PluginManifest,
  stripLeadingDotSlash,
  stripMdExtension,
  titleCase,
  toPosixPath,
} from '../../src/adapters/plugin-adapter-shared';
import {
  Bundle,
} from '../../src/types/registry';

const makeBundle = (overrides: Partial<Bundle> = {}): Bundle => ({
  id: 'test-plugin',
  name: 'Test Plugin',
  version: '1.0.0',
  description: 'A test plugin',
  author: 'test-author',
  sourceId: 'src-1',
  environments: ['general'],
  tags: ['testing'],
  lastUpdated: '2025-01-01T00:00:00Z',
  size: '2 items',
  dependencies: [],
  license: 'MIT',
  manifestUrl: 'https://example.com/plugin.json',
  downloadUrl: 'https://example.com/plugin.json',
  ...overrides
});

suite('plugin-adapter-shared', () => {
  suite('mapKindToType()', () => {
    test('maps instruction → instructions', () => {
      assert.strictEqual(mapKindToType('instruction'), 'instructions');
    });
    test('maps chat-mode → chatmode', () => {
      assert.strictEqual(mapKindToType('chat-mode'), 'chatmode');
    });
    test('maps agent → agent', () => {
      assert.strictEqual(mapKindToType('agent'), 'agent');
    });
    test('maps skill → skill', () => {
      assert.strictEqual(mapKindToType('skill'), 'skill');
    });
    test('maps unknown → prompt (default)', () => {
      assert.strictEqual(mapKindToType('unknown'), 'prompt');
      assert.strictEqual(mapKindToType('prompt'), 'prompt');
    });
  });

  suite('extractAuthorName()', () => {
    test('returns name from object author', () => {
      assert.strictEqual(extractAuthorName({ name: 'Jane Doe', url: 'https://jane.dev' }), 'Jane Doe');
    });
    test('returns string author directly (upstream format)', () => {
      assert.strictEqual(extractAuthorName('Jane Doe'), 'Jane Doe');
    });
    test('returns undefined for undefined input', () => {
      assert.strictEqual(extractAuthorName(undefined), undefined);
    });
  });

  suite('extractMcpServers()', () => {
    test('extracts from top-level mcpServers field', () => {
      const manifest: PluginManifest = {
        name: 'test',
        mcpServers: { 'my-server': { type: 'stdio', command: 'node' } }
      };
      const result = extractMcpServers(manifest);
      assert.deepStrictEqual(result, { 'my-server': { type: 'stdio', command: 'node' } });
    });

    test('extracts from mcp.items field (our format)', () => {
      const manifest: PluginManifest = {
        name: 'test',
        mcp: { items: { 'nested-server': { type: 'http', url: 'https://api.example.com/mcp' } } }
      };
      const result = extractMcpServers(manifest);
      assert.deepStrictEqual(result, { 'nested-server': { type: 'http', url: 'https://api.example.com/mcp' } });
    });

    test('prefers mcpServers over mcp.items when both present', () => {
      const manifest: PluginManifest = {
        name: 'test',
        mcpServers: { 'top-level': { command: 'node' } },
        mcp: { items: { nested: { command: 'python' } } }
      };
      const result = extractMcpServers(manifest);
      assert.deepStrictEqual(result, { 'top-level': { command: 'node' } });
    });

    test('returns undefined when no MCP servers', () => {
      const manifest: PluginManifest = { name: 'test', items: [] };
      assert.strictEqual(extractMcpServers(manifest), undefined);
    });

    test('returns undefined for empty mcpServers object', () => {
      const manifest: PluginManifest = { name: 'test', mcpServers: {} };
      assert.strictEqual(extractMcpServers(manifest), undefined);
    });

    test('returns undefined when mcpServers is a string path reference (I/O required by adapter)', () => {
      const manifest: PluginManifest = { name: 'test', mcpServers: '.mcp.json' };
      assert.strictEqual(extractMcpServers(manifest), undefined,
        'string path refs must not be resolved by extractMcpServers — adapters handle I/O');
    });

    test('falls back to mcp.items when mcpServers is a string (not inline)', () => {
      const manifest: PluginManifest = {
        name: 'test',
        mcpServers: '.mcp.json',
        mcp: { items: { 'fallback-server': { command: 'python3' } } }
      };
      const result = extractMcpServers(manifest);
      assert.deepStrictEqual(result, { 'fallback-server': { command: 'python3' } });
    });
  });

  suite('calculateBreakdown()', () => {
    test('counts items by kind', () => {
      const items = [
        { kind: 'agent', path: './agents/a.md' },
        { kind: 'skill', path: './skills/s' },
        { kind: 'skill', path: './skills/s2' },
        { kind: 'prompt', path: './p.prompt.md' },
        { kind: 'instruction', path: './i.instructions.md' },
        { kind: 'chat-mode', path: './c.chatmode.md' }
      ];
      const result = calculateBreakdown(items);
      assert.deepStrictEqual(result, { prompts: 1, instructions: 1, chatmodes: 1, agents: 1, skills: 2, mcpServers: 0 });
    });

    test('counts mcp servers when provided', () => {
      const items: PluginItem[] = [{ kind: 'agent', path: './a' }];
      const mcp = { 'server-a': {}, 'server-b': {} };
      const result = calculateBreakdown(items, mcp);
      assert.strictEqual(result.mcpServers, 2);
      assert.strictEqual(result.agents, 1);
    });

    test('mcpServers is 0 when not provided', () => {
      const result = calculateBreakdown([]);
      assert.strictEqual(result.mcpServers, 0);
    });
  });

  suite('derivePluginItems()', () => {
    test('returns items array when present', () => {
      const manifest: PluginManifest = {
        name: 'test',
        items: [{ kind: 'agent', path: './a' }, { kind: 'skill', path: './s' }]
      };
      const result = derivePluginItems(manifest);
      assert.strictEqual(result.length, 2);
      assert.strictEqual(result[0].kind, 'agent');
    });

    test('derives from agents/skills arrays (upstream format)', () => {
      const manifest: PluginManifest = {
        name: 'test',
        agents: ['./agents/code-review.md'],
        skills: ['./skills/java-docs', './skills/java-junit']
      };
      const result = derivePluginItems(manifest);
      assert.strictEqual(result.length, 3);
      assert.strictEqual(result.filter((i) => i.kind === 'agent').length, 1);
      assert.strictEqual(result.filter((i) => i.kind === 'skill').length, 2);
    });

    test('returns empty array when no items and no agents/skills', () => {
      const manifest: PluginManifest = { name: 'test' };
      assert.deepStrictEqual(derivePluginItems(manifest), []);
    });

    test('prefers items over agents/skills when items is non-empty', () => {
      const manifest: PluginManifest = {
        name: 'test',
        items: [{ kind: 'agent', path: './a' }],
        agents: ['./other-agent']
      };
      const result = derivePluginItems(manifest);
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].path, './a');
    });
  });

  suite('createDeploymentManifest()', () => {
    test('includes standard bundle fields', () => {
      const bundle = makeBundle();
      const result = createDeploymentManifest(bundle, []);
      assert.strictEqual(result.id, 'test-plugin');
      assert.strictEqual(result.name, 'Test Plugin');
      assert.strictEqual(result.version, '1.0.0');
      assert.deepStrictEqual(result.prompts, []);
    });

    test('includes mcpServers when provided', () => {
      const bundle = makeBundle();
      const mcp = { 'my-server': { type: 'stdio', command: 'node', args: ['server.js'] } };
      const result = createDeploymentManifest(bundle, [], mcp);
      assert.deepStrictEqual(result.mcpServers, mcp);
    });

    test('omits mcpServers key when not provided', () => {
      const bundle = makeBundle();
      const result = createDeploymentManifest(bundle, []);
      assert.ok(!Object.prototype.hasOwnProperty.call(result, 'mcpServers'), 'mcpServers key must be absent');
    });

    test('omits mcpServers key when empty object provided', () => {
      const bundle = makeBundle();
      const result = createDeploymentManifest(bundle, [], {});
      assert.ok(!Object.prototype.hasOwnProperty.call(result, 'mcpServers'), 'mcpServers key must be absent for empty servers');
    });

    test('maps resolved files to prompts with correct types', () => {
      const bundle = makeBundle();
      const resolved = [
        {
          kind: 'agent' as const,
          id: 'code-reviewer',
          entryFile: 'agents/code-reviewer.md',
          files: [{ sourcePath: '/fake/path', archivePath: 'agents/code-reviewer.md' }]
        },
        {
          kind: 'skill' as const,
          id: 'java-docs',
          entryFile: 'skills/java-docs/SKILL.md',
          files: [{ sourcePath: '/fake/skill', archivePath: 'skills/java-docs/SKILL.md' }]
        }
      ];
      const result = createDeploymentManifest(bundle, resolved);
      const prompts = result.prompts as any[];
      assert.strictEqual(prompts.length, 2);
      assert.strictEqual(prompts[0].type, 'agent');
      assert.strictEqual(prompts[0].id, 'code-reviewer');
      assert.strictEqual(prompts[0].file, 'agents/code-reviewer.md');
      assert.strictEqual(prompts[1].type, 'skill');
    });
  });

  suite('inferEnvironments()', () => {
    test('maps known tags to environment buckets', () => {
      assert.deepStrictEqual(inferEnvironments(['azure']), ['cloud']);
      assert.deepStrictEqual(inferEnvironments(['frontend']), ['web']);
      assert.deepStrictEqual(inferEnvironments(['database']), ['data']);
    });

    test('returns general for unrecognised tags', () => {
      assert.deepStrictEqual(inferEnvironments(['foobar', 'unknown']), ['general']);
    });

    test('deduplicates environment buckets', () => {
      const result = inferEnvironments(['azure', 'aws', 'gcp']);
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0], 'cloud');
    });
  });

  suite('stripLeadingDotSlash()', () => {
    test('strips ./ prefix', () => {
      assert.strictEqual(stripLeadingDotSlash('./agents/foo.md'), 'agents/foo.md');
    });
    test('leaves path without ./ unchanged', () => {
      assert.strictEqual(stripLeadingDotSlash('agents/foo.md'), 'agents/foo.md');
    });
  });

  suite('toPosixPath()', () => {
    test('replaces backslashes with forward slashes', () => {
      assert.strictEqual(toPosixPath('agents\\foo\\bar.md'), 'agents/foo/bar.md');
    });
    test('leaves POSIX paths unchanged', () => {
      assert.strictEqual(toPosixPath('agents/foo/bar.md'), 'agents/foo/bar.md');
    });
  });

  suite('stripMdExtension()', () => {
    test('strips .agent.md', () => {
      assert.strictEqual(stripMdExtension('my-agent.agent.md'), 'my-agent');
    });
    test('strips .md', () => {
      assert.strictEqual(stripMdExtension('my-skill.md'), 'my-skill');
    });
    test('leaves other extensions unchanged', () => {
      assert.strictEqual(stripMdExtension('SKILL.md'), 'SKILL');
    });
  });

  suite('titleCase()', () => {
    test('converts kebab words to Title Case', () => {
      assert.strictEqual(titleCase('code review agent'), 'Code Review Agent');
    });
    test('handles single word', () => {
      assert.strictEqual(titleCase('azure'), 'Azure');
    });
  });
});

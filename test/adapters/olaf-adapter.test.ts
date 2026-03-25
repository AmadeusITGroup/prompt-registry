/**
 * OlafAdapter Integration Tests
 * Tests bundle packaging and installation functionality
 */

import * as assert from 'node:assert';
import nock from 'nock';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import {
  OlafAdapter,
} from '../../src/adapters/olaf-adapter';
import {
  OlafRuntimeManager,
} from '../../src/services/olaf-runtime-manager';
import {
  RegistrySource,
} from '../../src/types/registry';

suite('OlafAdapter Integration Tests', () => {
  const mockSource: RegistrySource = {
    id: 'test-olaf-source',
    name: 'Test OLAF Source',
    type: 'olaf',
    url: 'https://github.com/test-owner/test-olaf-repo',
    enabled: true,
    priority: 1,
    token: 'test-token'
  };

  let runtimeManagerStub: sinon.SinonStubbedInstance<OlafRuntimeManager>;
  let workspaceStub: sinon.SinonStub;

  /**
   * Helper to set up mock GitHub API responses for bundle structure
   * @param options
   * @param options.bundleDefinitions
   * @param options.skillManifests
   * @param options.skillFiles
   */
  function setupBundleStructureMocks(options: {
    bundleDefinitions?: {
      fileName: string;
      metadata: { name: string; description: string; version?: string; author?: string; tags?: string[] };
      skills: { name: string; description: string; path: string; manifest: string }[];
    }[];
    skillManifests?: Record<string, { name: string; version?: string; entry_points: { protocol: string; path: string; patterns: string[] }[] }>;
    skillFiles?: Record<string, { name: string; type: 'file' | 'dir'; download_url?: string }[]>;
  }) {
    const { bundleDefinitions = [], skillManifests = {}, skillFiles = {} } = options;

    // Mock bundles/ directory listing
    const bundleFiles = bundleDefinitions.map((bd) => ({
      name: `${bd.fileName}.json`,
      path: `bundles/${bd.fileName}.json`,
      type: 'file' as const,
      download_url: `https://raw.githubusercontent.com/test-owner/test-olaf-repo/main/bundles/${bd.fileName}.json`
    }));

    nock('https://api.github.com')
      .get('/repos/test-owner/test-olaf-repo/contents/bundles')
      .reply(200, bundleFiles);

    // Mock bundle definition downloads
    for (const bd of bundleDefinitions) {
      nock('https://raw.githubusercontent.com')
        .get(`/test-owner/test-olaf-repo/main/bundles/${bd.fileName}.json`)
        .reply(200, JSON.stringify({
          metadata: bd.metadata,
          skills: bd.skills
        }));
    }

    // Mock skill directory contents
    for (const [skillPath, files] of Object.entries(skillFiles)) {
      nock('https://api.github.com')
        .get(`/repos/test-owner/test-olaf-repo/contents/${skillPath}`)
        .reply(200, files);
    }

    // Mock skill manifest API access (for validation)
    for (const [manifestPath, manifest] of Object.entries(skillManifests)) {
      nock('https://api.github.com')
        .get(`/repos/test-owner/test-olaf-repo/contents/${manifestPath}`)
        .reply(200, {
          name: manifestPath.split('/').pop(),
          type: 'file',
          download_url: `https://raw.githubusercontent.com/test-owner/test-olaf-repo/main/${manifestPath}`
        });

      // Mock manifest download
      nock('https://raw.githubusercontent.com')
        .get(`/test-owner/test-olaf-repo/main/${manifestPath}`)
        .reply(200, JSON.stringify(manifest));
    }
  }

  setup(() => {
    // Mock OlafRuntimeManager
    runtimeManagerStub = sinon.createStubInstance(OlafRuntimeManager);
    sinon.stub(OlafRuntimeManager, 'getInstance').returns(runtimeManagerStub as any);

    // Mock VSCode workspace
    workspaceStub = sinon.stub(vscode.workspace, 'workspaceFolders').value([
      { uri: { fsPath: '/test/workspace' } }
    ]);
  });

  teardown(() => {
    nock.cleanAll();
    sinon.restore();
  });

  suite('Bundle Discovery', () => {
    test('should discover bundles from bundles/ directory', async () => {
      setupBundleStructureMocks({
        bundleDefinitions: [{
          fileName: 'developer',
          metadata: {
            name: 'Developer Bundle',
            description: 'Developer skills bundle',
            version: '1.0.0',
            author: 'Test Author',
            tags: ['development', 'coding']
          },
          skills: [{
            name: 'Code Review',
            description: 'Review code',
            path: 'skills/code-review',
            manifest: 'skills/code-review/manifest.json'
          }]
        }],
        skillManifests: {
          'skills/code-review/manifest.json': {
            name: 'Code Review',
            version: '1.0.0',
            entry_points: [{ protocol: 'Act', path: '/prompts/review.md', patterns: ['review code'] }]
          }
        },
        skillFiles: {
          'skills/code-review': [
            { name: 'manifest.json', type: 'file', download_url: 'https://raw.githubusercontent.com/test-owner/test-olaf-repo/main/skills/code-review/manifest.json' },
            { name: 'prompts', type: 'dir' }
          ]
        }
      });

      const adapter = new OlafAdapter(mockSource);
      const bundles = await adapter.fetchBundles();

      assert.strictEqual(bundles.length, 1);
      assert.strictEqual(bundles[0].name, 'Developer Bundle');
      assert.strictEqual(bundles[0].version, '1.0.0');
      assert.ok(bundles[0].description.includes('Developer skills bundle'));
      assert.ok(bundles[0].description.includes('1 skill'));
      assert.strictEqual(bundles[0].id, 'olaf-test-owner-test-olaf-repo-developer');
      assert.deepStrictEqual(bundles[0].tags, ['olaf', 'skill', 'development', 'coding']);
    });

    test('should discover multiple bundles with multiple skills', async () => {
      setupBundleStructureMocks({
        bundleDefinitions: [
          {
            fileName: 'developer',
            metadata: {
              name: 'Developer Bundle',
              description: 'Developer skills',
              version: '1.0.0'
            },
            skills: [
              { name: 'Code Review', description: 'Review code', path: 'skills/code-review', manifest: 'skills/code-review/manifest.json' },
              { name: 'Refactor', description: 'Refactor code', path: 'skills/refactor', manifest: 'skills/refactor/manifest.json' }
            ]
          },
          {
            fileName: 'analyst',
            metadata: {
              name: 'Analyst Bundle',
              description: 'Analyst skills',
              version: '2.0.0'
            },
            skills: [
              { name: 'Data Analysis', description: 'Analyze data', path: 'skills/data-analysis', manifest: 'skills/data-analysis/manifest.json' }
            ]
          }
        ],
        skillManifests: {
          'skills/code-review/manifest.json': { name: 'Code Review', entry_points: [{ protocol: 'Act', path: '/prompts/review.md', patterns: ['review'] }] },
          'skills/refactor/manifest.json': { name: 'Refactor', entry_points: [{ protocol: 'Act', path: '/prompts/refactor.md', patterns: ['refactor'] }] },
          'skills/data-analysis/manifest.json': { name: 'Data Analysis', entry_points: [{ protocol: 'Act', path: '/prompts/analyze.md', patterns: ['analyze'] }] }
        },
        skillFiles: {
          'skills/code-review': [{ name: 'manifest.json', type: 'file', download_url: 'https://raw.githubusercontent.com/test-owner/test-olaf-repo/main/skills/code-review/manifest.json' }],
          'skills/refactor': [{ name: 'manifest.json', type: 'file', download_url: 'https://raw.githubusercontent.com/test-owner/test-olaf-repo/main/skills/refactor/manifest.json' }],
          'skills/data-analysis': [{ name: 'manifest.json', type: 'file', download_url: 'https://raw.githubusercontent.com/test-owner/test-olaf-repo/main/skills/data-analysis/manifest.json' }]
        }
      });

      const adapter = new OlafAdapter(mockSource);
      const bundles = await adapter.fetchBundles();

      assert.strictEqual(bundles.length, 2);

      const developerBundle = bundles.find((b) => b.name === 'Developer Bundle');
      const analystBundle = bundles.find((b) => b.name === 'Analyst Bundle');

      assert.ok(developerBundle);
      assert.ok(analystBundle);
      assert.ok(developerBundle.description.includes('2 skills'));
      assert.ok(analystBundle.description.includes('1 skill'));
      assert.strictEqual(developerBundle.version, '1.0.0');
      assert.strictEqual(analystBundle.version, '2.0.0');
    });
  });

  suite('Bundle Packaging', () => {
    test('should generate deployment manifest for bundle', async () => {
      setupBundleStructureMocks({
        bundleDefinitions: [{
          fileName: 'data-analysis',
          metadata: {
            name: 'Data Analysis Bundle',
            description: 'Advanced data analysis capabilities',
            version: '1.0.0',
            author: 'Test Author',
            tags: ['data', 'analysis', 'python']
          },
          skills: [{
            name: 'Data Analysis',
            description: 'Analyze data',
            path: 'skills/data-analysis',
            manifest: 'skills/data-analysis/manifest.json'
          }]
        }],
        skillManifests: {
          'skills/data-analysis/manifest.json': {
            name: 'Data Analysis',
            version: '1.0.0',
            entry_points: [{ protocol: 'Act', path: '/prompts/analyze.md', patterns: ['analyze data'] }]
          }
        },
        skillFiles: {
          'skills/data-analysis': [
            { name: 'manifest.json', type: 'file', download_url: 'https://raw.githubusercontent.com/test-owner/test-olaf-repo/main/skills/data-analysis/manifest.json' },
            { name: 'main.py', type: 'file', download_url: 'https://raw.githubusercontent.com/test-owner/test-olaf-repo/main/skills/data-analysis/main.py' }
          ]
        }
      });

      const adapter = new OlafAdapter(mockSource);
      const bundles = await adapter.fetchBundles();

      assert.strictEqual(bundles.length, 1);
      assert.strictEqual(bundles[0].name, 'Data Analysis Bundle');
      assert.strictEqual(bundles[0].version, '1.0.0');
      assert.ok(bundles[0].description.includes('Advanced data analysis capabilities'));
      assert.deepStrictEqual(bundles[0].tags, ['olaf', 'skill', 'data', 'analysis', 'python']);
    });
  });

  suite('Bundle Validation', () => {
    test('should validate OLAF repository structure', async () => {
      // Mock repository validation with bundles/ and skills/ directories
      nock('https://api.github.com')
        .get('/repos/test-owner/test-olaf-repo')
        .reply(200, { name: 'test-olaf-repo' })
        .get('/repos/test-owner/test-olaf-repo/releases')
        .reply(200, [])
      // Check for bundles/ directory
        .get('/repos/test-owner/test-olaf-repo/contents/bundles')
        .times(2) // Called once for validate, once for scanBundleDefinitions
        .reply(200, [
          {
            name: 'developer.json',
            path: 'bundles/developer.json',
            type: 'file',
            download_url: 'https://raw.githubusercontent.com/test-owner/test-olaf-repo/main/bundles/developer.json'
          },
          {
            name: 'analyst.json',
            path: 'bundles/analyst.json',
            type: 'file',
            download_url: 'https://raw.githubusercontent.com/test-owner/test-olaf-repo/main/bundles/analyst.json'
          }
        ])
      // Check for skills/ directory
        .get('/repos/test-owner/test-olaf-repo/contents/skills')
        .reply(200, [
          {
            name: 'code-review',
            path: 'skills/code-review',
            type: 'dir'
          },
          {
            name: 'data-analysis',
            path: 'skills/data-analysis',
            type: 'dir'
          }
        ])
      // Skill directory contents
        .get('/repos/test-owner/test-olaf-repo/contents/skills/code-review')
        .reply(200, [
          {
            name: 'manifest.json',
            type: 'file',
            download_url: 'https://raw.githubusercontent.com/test-owner/test-olaf-repo/main/skills/code-review/manifest.json'
          }
        ])
        .get('/repos/test-owner/test-olaf-repo/contents/skills/data-analysis')
        .reply(200, [
          {
            name: 'manifest.json',
            type: 'file',
            download_url: 'https://raw.githubusercontent.com/test-owner/test-olaf-repo/main/skills/data-analysis/manifest.json'
          }
        ])
      // Manifest file access
        .get('/repos/test-owner/test-olaf-repo/contents/skills/code-review/manifest.json')
        .reply(200, {
          name: 'manifest.json',
          type: 'file',
          download_url: 'https://raw.githubusercontent.com/test-owner/test-olaf-repo/main/skills/code-review/manifest.json'
        })
        .get('/repos/test-owner/test-olaf-repo/contents/skills/data-analysis/manifest.json')
        .reply(200, {
          name: 'manifest.json',
          type: 'file',
          download_url: 'https://raw.githubusercontent.com/test-owner/test-olaf-repo/main/skills/data-analysis/manifest.json'
        });

      // Mock bundle definition downloads
      nock('https://raw.githubusercontent.com')
        .get('/test-owner/test-olaf-repo/main/bundles/developer.json')
        .reply(200, JSON.stringify({
          metadata: {
            name: 'Developer Bundle',
            description: 'Developer skills bundle',
            version: '1.0.0'
          },
          skills: [
            {
              name: 'Code Review',
              description: 'Review code',
              path: 'skills/code-review',
              manifest: 'skills/code-review/manifest.json'
            }
          ]
        }))
        .get('/test-owner/test-olaf-repo/main/bundles/analyst.json')
        .reply(200, JSON.stringify({
          metadata: {
            name: 'Analyst Bundle',
            description: 'Analyst skills bundle',
            version: '1.0.0'
          },
          skills: [
            {
              name: 'Data Analysis',
              description: 'Analyze data',
              path: 'skills/data-analysis',
              manifest: 'skills/data-analysis/manifest.json'
            }
          ]
        }))
      // Mock skill manifest downloads
        .get('/test-owner/test-olaf-repo/main/skills/code-review/manifest.json')
        .reply(200, JSON.stringify({
          name: 'Code Review',
          version: '1.0.0',
          entry_points: [
            { protocol: 'Act', path: '/prompts/review.md', patterns: ['review code'] }
          ]
        }))
        .get('/test-owner/test-olaf-repo/main/skills/data-analysis/manifest.json')
        .reply(200, JSON.stringify({
          name: 'Data Analysis',
          version: '1.0.0',
          entry_points: [
            { protocol: 'Act', path: '/prompts/analyze.md', patterns: ['analyze data'] }
          ]
        }));

      const adapter = new OlafAdapter(mockSource);
      const result = await adapter.validate();

      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.errors.length, 0);
      assert.strictEqual(result.bundlesFound, 2);
    });

    test('should report validation failure for missing OLAF structure', async () => {
      // Mock repository validation - missing bundles/ and skills/ directories
      nock('https://api.github.com')
        .get('/repos/test-owner/test-olaf-repo')
        .reply(200, { name: 'test-olaf-repo' })
        .get('/repos/test-owner/test-olaf-repo/releases')
        .reply(200, [])
        .get('/repos/test-owner/test-olaf-repo/contents/bundles')
        .reply(404, { message: 'Not Found' })
        .get('/repos/test-owner/test-olaf-repo/contents/skills')
        .reply(404, { message: 'Not Found' });

      const adapter = new OlafAdapter(mockSource);
      const result = await adapter.validate();

      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.length > 0);
      assert.ok(result.errors.some((e) => e.includes('bundles')));
      assert.ok(result.errors.some((e) => e.includes('skills')));
    });
  });

  suite('Post-Installation', () => {
    test('should register skill in competency index after installation', async () => {
      const fs = require('node:fs');
      const path = require('node:path');

      // Mock workspace path
      const workspacePath = '/test/workspace';
      // Install path is now: .olaf/external-skills/<source-name>/ (without bundle/skill name)
      const installPath = path.join(workspacePath, '.olaf', 'external-skills', 'test-source');
      const competencyIndexPath = path.join(workspacePath, '.olaf', 'olaf-core', 'reference', 'competency-index.json');

      // Mock bundle definition with skill entry points
      const bundleDefinition = {
        metadata: {
          name: 'Test Bundle',
          description: 'A test bundle',
          version: '1.0.0'
        },
        skills: [
          {
            name: 'Test Skill',
            description: 'A test skill',
            path: 'skills/test-skill',
            manifest: 'skills/test-skill/manifest.json'
          }
        ]
      };

      // Mock skill manifest with entry points
      const skillManifest = {
        name: 'Test Skill',
        version: '1.0.0',
        description: 'A test skill',
        entry_points: [
          {
            protocol: 'Propose-Confirm-Act',
            path: '/prompts/test-skill.md',
            patterns: ['test-pattern', 'test skill']
          }
        ]
      };

      // Mock GitHub API calls for bundle definition scanning
      nock('https://api.github.com')
        .get('/repos/test-owner/test-olaf-repo/contents/bundles')
        .reply(200, [
          { name: 'test-skill.json', path: 'bundles/test-skill.json', type: 'file', download_url: 'https://raw.githubusercontent.com/test-owner/test-olaf-repo/main/bundles/test-skill.json' }
        ])
        .get('/repos/test-owner/test-olaf-repo/contents/skills/test-skill')
        .reply(200, [
          {
            name: 'manifest.json', path: 'skills/test-skill/manifest.json', type: 'file',
            download_url: 'https://raw.githubusercontent.com/test-owner/test-olaf-repo/main/skills/test-skill/manifest.json'
          }
        ])
        .get('/repos/test-owner/test-olaf-repo/contents/skills/test-skill/manifest.json')
        .reply(200, { download_url: 'https://raw.githubusercontent.com/test-owner/test-olaf-repo/main/skills/test-skill/manifest.json' });

      // Mock raw file downloads
      nock('https://raw.githubusercontent.com')
        .get('/test-owner/test-olaf-repo/main/bundles/test-skill.json')
        .reply(200, JSON.stringify(bundleDefinition))
        .get('/test-owner/test-olaf-repo/main/skills/test-skill/manifest.json')
        .reply(200, JSON.stringify(skillManifest));

      // Mock file system operations
      const existsSyncStub = sinon.stub(fs, 'existsSync');
      const mkdirSyncStub = sinon.stub(fs, 'mkdirSync');
      const readFileSyncStub = sinon.stub(fs, 'readFileSync');
      const writeFileSyncStub = sinon.stub(fs, 'writeFileSync');

      // Setup: competency index doesn't exist yet
      existsSyncStub.withArgs(sinon.match(/competency-index\.json$/)).returns(false);
      existsSyncStub.withArgs(sinon.match(/reference$/)).returns(false);

      const adapter = new OlafAdapter(mockSource);
      await adapter.postInstall('olaf-test-owner-test-olaf-repo-test-skill', installPath);

      // Verify competency index was created
      assert.ok(mkdirSyncStub.calledWith(sinon.match(/reference$/), { recursive: true }));

      // Verify skill was written to competency index
      assert.ok(writeFileSyncStub.calledOnce);
      const writtenData = JSON.parse(writeFileSyncStub.firstCall.args[1]);

      assert.ok(Array.isArray(writtenData), 'Competency index should be an array');
      assert.strictEqual(writtenData.length, 1);
      assert.deepStrictEqual(writtenData[0].patterns, ['test-pattern', 'test skill']);
      assert.strictEqual(writtenData[0].file, 'external-skills/Test OLAF Source/test-skill/prompts/test-skill.md');
      assert.strictEqual(writtenData[0].protocol, 'Propose-Confirm-Act');
    });

    test('should update existing skill entry in competency index', async () => {
      const fs = require('node:fs');
      const path = require('node:path');

      const workspacePath = '/test/workspace';
      // Install path is now: .olaf/external-skills/<source-name>/ (without bundle/skill name)
      const installPath = path.join(workspacePath, '.olaf', 'external-skills', 'test-source');

      // Existing competency index with the skill already registered (flat array format)
      const existingIndex = [
        {
          patterns: ['old-pattern'],
          file: 'external-skills/Test OLAF Source/test-skill/prompts/test-skill.md',
          protocol: 'Act'
        }
      ];

      // Mock bundle definition with updated skill entry points
      const bundleDefinition = {
        metadata: {
          name: 'Updated Bundle',
          description: 'An updated bundle',
          version: '2.0.0'
        },
        skills: [
          {
            name: 'Updated Skill',
            description: 'Updated description',
            path: 'skills/test-skill',
            manifest: 'skills/test-skill/manifest.json'
          }
        ]
      };

      // Mock skill manifest with updated entry points
      const skillManifest = {
        name: 'Updated Skill',
        version: '2.0.0',
        description: 'Updated description',
        entry_points: [
          {
            protocol: 'Propose-Confirm-Act',
            path: '/prompts/test-skill.md',
            patterns: ['new-pattern', 'updated skill']
          }
        ]
      };

      // Mock GitHub API calls for bundle definition scanning
      nock('https://api.github.com')
        .get('/repos/test-owner/test-olaf-repo/contents/bundles')
        .reply(200, [
          { name: 'test-skill.json', path: 'bundles/test-skill.json', type: 'file', download_url: 'https://raw.githubusercontent.com/test-owner/test-olaf-repo/main/bundles/test-skill.json' }
        ])
        .get('/repos/test-owner/test-olaf-repo/contents/skills/test-skill')
        .reply(200, [
          {
            name: 'manifest.json', path: 'skills/test-skill/manifest.json', type: 'file',
            download_url: 'https://raw.githubusercontent.com/test-owner/test-olaf-repo/main/skills/test-skill/manifest.json'
          }
        ])
        .get('/repos/test-owner/test-olaf-repo/contents/skills/test-skill/manifest.json')
        .reply(200, { download_url: 'https://raw.githubusercontent.com/test-owner/test-olaf-repo/main/skills/test-skill/manifest.json' });

      // Mock raw file downloads
      nock('https://raw.githubusercontent.com')
        .get('/test-owner/test-olaf-repo/main/bundles/test-skill.json')
        .reply(200, JSON.stringify(bundleDefinition))
        .get('/test-owner/test-olaf-repo/main/skills/test-skill/manifest.json')
        .reply(200, JSON.stringify(skillManifest));

      const existsSyncStub = sinon.stub(fs, 'existsSync');
      const mkdirSyncStub = sinon.stub(fs, 'mkdirSync');
      const readFileSyncStub = sinon.stub(fs, 'readFileSync');
      const writeFileSyncStub = sinon.stub(fs, 'writeFileSync');

      existsSyncStub.withArgs(sinon.match(/competency-index\.json$/)).returns(true);
      existsSyncStub.withArgs(sinon.match(/reference$/)).returns(true);

      readFileSyncStub.withArgs(sinon.match(/competency-index\.json$/), 'utf8')
        .returns(JSON.stringify(existingIndex));

      const adapter = new OlafAdapter(mockSource);
      await adapter.postInstall('olaf-test-owner-test-olaf-repo-test-skill', installPath);

      // Verify the existing entry was updated
      assert.ok(writeFileSyncStub.calledOnce);
      const writtenData = JSON.parse(writeFileSyncStub.firstCall.args[1]);

      assert.ok(Array.isArray(writtenData), 'Competency index should be an array');
      assert.strictEqual(writtenData.length, 1);
      assert.deepStrictEqual(writtenData[0].patterns, ['new-pattern', 'updated skill']);
      assert.strictEqual(writtenData[0].file, 'external-skills/Test OLAF Source/test-skill/prompts/test-skill.md');
      assert.strictEqual(writtenData[0].protocol, 'Propose-Confirm-Act');
    });
  });

  suite('Post-Uninstallation', () => {
    test('should remove skill from competency index after uninstallation', async () => {
      const fs = require('node:fs');
      const path = require('node:path');

      const workspacePath = '/test/workspace';
      // Install path is now: .olaf/external-skills/<source-name>/ (without bundle/skill name)
      const installPath = path.join(workspacePath, '.olaf', 'external-skills', 'test-source');

      // Existing competency index with multiple skills including the one to remove
      const existingIndex = [
        {
          patterns: ['test-pattern'],
          file: 'external-skills/Test OLAF Source/test-skill/prompts/test-skill.md',
          protocol: 'Act'
        },
        {
          patterns: ['other-pattern'],
          file: 'external-skills/other-source/other-skill/prompts/other-skill.md',
          protocol: 'Propose-Confirm-Act'
        }
      ];

      const existsSyncStub = sinon.stub(fs, 'existsSync');
      const readFileSyncStub = sinon.stub(fs, 'readFileSync');
      const writeFileSyncStub = sinon.stub(fs, 'writeFileSync');

      existsSyncStub.withArgs(sinon.match(/competency-index\.json$/)).returns(true);

      readFileSyncStub.withArgs(sinon.match(/competency-index\.json$/), 'utf8')
        .returns(JSON.stringify(existingIndex));

      const adapter = new OlafAdapter(mockSource);
      await adapter.postUninstall('olaf-test-owner-test-repo-test-skill', installPath);

      // Verify the skill was removed from competency index
      assert.ok(writeFileSyncStub.calledOnce);
      const writtenData = JSON.parse(writeFileSyncStub.firstCall.args[1]);

      assert.ok(Array.isArray(writtenData), 'Competency index should be an array');
      assert.strictEqual(writtenData.length, 1, 'Should have one skill remaining');
      assert.strictEqual(writtenData[0].file, 'external-skills/other-source/other-skill/prompts/other-skill.md');
      assert.deepStrictEqual(writtenData[0].patterns, ['other-pattern']);
    });

    test('should handle empty competency index after removing last skill', async () => {
      const fs = require('node:fs');
      const path = require('node:path');

      const workspacePath = '/test/workspace';
      // Install path is now: .olaf/external-skills/<source-name>/ (without bundle/skill name)
      const installPath = path.join(workspacePath, '.olaf', 'external-skills', 'test-source');

      // Existing competency index with only the skill to remove
      const existingIndex = [
        {
          patterns: ['test-pattern'],
          file: 'external-skills/Test OLAF Source/test-skill/prompts/test-skill.md',
          protocol: 'Act'
        }
      ];

      const existsSyncStub = sinon.stub(fs, 'existsSync');
      const readFileSyncStub = sinon.stub(fs, 'readFileSync');
      const writeFileSyncStub = sinon.stub(fs, 'writeFileSync');

      existsSyncStub.withArgs(sinon.match(/competency-index\.json$/)).returns(true);

      readFileSyncStub.withArgs(sinon.match(/competency-index\.json$/), 'utf8')
        .returns(JSON.stringify(existingIndex));

      const adapter = new OlafAdapter(mockSource);
      await adapter.postUninstall('olaf-test-owner-test-repo-test-skill', installPath);

      // Verify the competency index is now empty
      assert.ok(writeFileSyncStub.calledOnce);
      const writtenData = JSON.parse(writeFileSyncStub.firstCall.args[1]);

      assert.ok(Array.isArray(writtenData), 'Competency index should be an array');
      assert.strictEqual(writtenData.length, 0, 'Should be empty after removing the only skill');
    });

    test('should handle non-existent competency index gracefully', async () => {
      const fs = require('node:fs');
      const path = require('node:path');

      const workspacePath = '/test/workspace';
      // Install path is now: .olaf/external-skills/<source-name>/ (without bundle/skill name)
      const installPath = path.join(workspacePath, '.olaf', 'external-skills', 'test-source');

      const existsSyncStub = sinon.stub(fs, 'existsSync');
      const writeFileSyncStub = sinon.stub(fs, 'writeFileSync');

      existsSyncStub.withArgs(sinon.match(/competency-index\.json$/)).returns(false);

      const adapter = new OlafAdapter(mockSource);
      await adapter.postUninstall('olaf-test-owner-test-repo-test-skill', installPath);

      // Verify no write operation was attempted
      assert.ok(writeFileSyncStub.notCalled, 'Should not attempt to write when file does not exist');
    });

    test('should handle skill not found in competency index', async () => {
      const fs = require('node:fs');
      const path = require('node:path');

      const workspacePath = '/test/workspace';
      // Install path is now: .olaf/external-skills/<source-name>/ (without bundle/skill name)
      const installPath = path.join(workspacePath, '.olaf', 'external-skills', 'test-source');

      // Existing competency index without the skill to remove
      const existingIndex = [
        {
          patterns: ['other-pattern'],
          file: 'external-skills/other-source/other-skill/prompts/other-skill.md',
          protocol: 'Propose-Confirm-Act'
        }
      ];

      const existsSyncStub = sinon.stub(fs, 'existsSync');
      const readFileSyncStub = sinon.stub(fs, 'readFileSync');
      const writeFileSyncStub = sinon.stub(fs, 'writeFileSync');

      existsSyncStub.withArgs(sinon.match(/competency-index\.json$/)).returns(true);

      readFileSyncStub.withArgs(sinon.match(/competency-index\.json$/), 'utf8')
        .returns(JSON.stringify(existingIndex));

      const adapter = new OlafAdapter(mockSource);
      await adapter.postUninstall('olaf-test-owner-test-repo-test-skill', installPath);

      // Verify no write operation was attempted since skill was not found
      assert.ok(writeFileSyncStub.notCalled, 'Should not write when skill is not found');
    });
  });
});

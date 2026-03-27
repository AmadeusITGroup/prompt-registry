/**
 * Hub Release Analyzer Tests
 *
 * Unit tests for the hub-release-analyzer.js CLI script.
 * Tests cover input detection, config loading, data extraction, aggregation,
 * and report generation.
 */
/* eslint-disable import/order -- require() as import conflicts with import/newline-after-import */
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const analyzer = require('../../bin/hub-release-analyzer.js');
/* eslint-enable import/order */

function createTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cleanup(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

describe('Hub Release Analyzer', () => {
  describe('parseArgs()', () => {
    const { parseArgs } = analyzer;

    it('should parse hub source as positional argument', () => {
      const argv = ['./hub-config.yml'];
      const result = parseArgs(argv);
      assert.strictEqual(result.hubSource, './hub-config.yml');
    });

    it('should parse all options correctly', () => {
      const argv = [
        '-o', './reports',
        '-f', 'csv',
        '-c', '10',
        '--min-downloads', '5',
        '--source-filter', 'github-.*',
        '--bundle-filter', 'my-.*',
        '--dry-run',
        '-v',
        './hub.yml'
      ];
      const result = parseArgs(argv);

      assert.strictEqual(result.hubSource, './hub.yml');
      assert.strictEqual(result.outputDir, './reports');
      assert.strictEqual(result.format, 'csv');
      assert.strictEqual(result.concurrency, 10);
      assert.strictEqual(result.minDownloads, 5);
      assert.strictEqual(result.sourceFilter.source, 'github-.*');
      assert.strictEqual(result.bundleFilter.source, 'my-.*');
      assert.strictEqual(result.dryRun, true);
      assert.strictEqual(result.verbose, true);
    });

    it('should use default values when options not provided', () => {
      const argv = ['./hub.yml'];
      const result = parseArgs(argv);

      assert.strictEqual(result.outputDir, './analytics-output');
      assert.strictEqual(result.format, 'all');
      assert.strictEqual(result.concurrency, 5);
      assert.strictEqual(result.minDownloads, 0);
      assert.strictEqual(result.dryRun, false);
      assert.strictEqual(result.verbose, false);
    });

    it('should set help flag', () => {
      const argv = ['--help'];
      const result = parseArgs(argv);
      assert.strictEqual(result.help, true);
    });
  });

  describe('detectInputType()', () => {
    const { detectInputType } = analyzer;

    it('should detect local file path', () => {
      const result = detectInputType('./hub-config.yml');
      assert.strictEqual(result.type, 'local');
      assert.ok(result.path.includes('hub-config.yml'));
    });

    it('should detect direct YAML URL', () => {
      const result = detectInputType('https://github.com/owner/repo/raw/main/hub-config.yml');
      assert.strictEqual(result.type, 'yaml-url');
      assert.strictEqual(result.url, 'https://github.com/owner/repo/raw/main/hub-config.yml');
    });

    it('should detect GitHub repo URL with default path', () => {
      const result = detectInputType('https://github.com/Amadeus-xDLC/genai.prompt-registry-config');
      assert.strictEqual(result.type, 'github-repo');
      assert.strictEqual(result.owner, 'Amadeus-xDLC');
      assert.strictEqual(result.repo, 'genai.prompt-registry-config');
      assert.strictEqual(result.filePath, 'hub-config.yml');
      assert.strictEqual(result.ref, 'main');
    });

    it('should detect GitHub repo URL with tree path and branch (as yaml-url due to .yml extension)', () => {
      const result = detectInputType('https://github.com/owner/repo/tree/develop/config/hub.yml');
      // URLs ending in .yml are detected as direct YAML URLs
      assert.strictEqual(result.type, 'yaml-url');
      assert.strictEqual(result.url, 'https://github.com/owner/repo/tree/develop/config/hub.yml');
    });

    it('should detect GitHub repo URL with blob path (as yaml-url due to .yml extension)', () => {
      const result = detectInputType('https://github.com/owner/repo/blob/feature/test/hub.yaml');
      // URLs ending in .yaml are detected as direct YAML URLs
      assert.strictEqual(result.type, 'yaml-url');
      assert.strictEqual(result.url, 'https://github.com/owner/repo/blob/feature/test/hub.yaml');
    });
  });

  describe('extractRepoInfo()', () => {
    const { extractRepoInfo } = analyzer;

    it('should extract from repository field', () => {
      const result = extractRepoInfo({ repository: 'owner/repo' });
      assert.strictEqual(result, 'owner/repo');
    });

    it('should extract from GitHub URL', () => {
      const result = extractRepoInfo({ url: 'https://github.com/owner/repo' });
      assert.strictEqual(result, 'owner/repo');
    });

    it('should extract from GitHub URL with trailing slash', () => {
      const result = extractRepoInfo({ url: 'https://github.com/owner/repo/' });
      assert.strictEqual(result, 'owner/repo');
    });

    it('should return null for non-GitHub URL', () => {
      const result = extractRepoInfo({ url: 'https://gitlab.com/owner/repo' });
      assert.strictEqual(result, null);
    });

    it('should return null when no repo info available', () => {
      const result = extractRepoInfo({ type: 'local' });
      assert.strictEqual(result, null);
    });
  });

  describe('getGitHubSources()', () => {
    const { getGitHubSources } = analyzer;

    const mockHubConfig = {
      sources: [
        { id: 'src1', type: 'github', enabled: true, repository: 'owner/repo1' },
        { id: 'src2', type: 'github', enabled: false, repository: 'owner/repo2' },
        { id: 'src3', type: 'apm', enabled: true, repository: 'owner/repo3' },
        { id: 'src4', type: 'awesome-copilot', enabled: true, url: 'https://github.com/owner/repo4' },
        { id: 'src5', type: 'github', enabled: true, url: 'https://github.com/owner/repo5' },
        { id: 'src6', type: 'github', enabled: true } // no repo info
      ]
    };

    it('should filter enabled GitHub and APM sources only', () => {
      const result = getGitHubSources(mockHubConfig);

      assert.strictEqual(result.length, 3);
      assert.ok(result.some((s: any) => s.id === 'src1'));
      assert.ok(result.some((s: any) => s.id === 'src3'));
      assert.ok(result.some((s: any) => s.id === 'src5'));
    });

    it('should apply source filter regex', () => {
      const result = getGitHubSources(mockHubConfig, { sourceFilter: /src[13]/ });

      assert.strictEqual(result.length, 2);
      assert.ok(result.some((s: any) => s.id === 'src1'));
      assert.ok(result.some((s: any) => s.id === 'src3'));
    });

    it('should return empty array when no matching sources', () => {
      const result = getGitHubSources(mockHubConfig, { sourceFilter: /nonexistent/ });
      assert.strictEqual(result.length, 0);
    });
  });

  describe('loadHubConfig() - local file', () => {
    const { loadHubConfig } = analyzer;
    let tempDir: string;

    beforeEach(() => {
      tempDir = createTempDir('hub-test-');
    });

    afterEach(() => {
      cleanup(tempDir);
    });

    it('should load and parse local YAML file', () => {
      const hubPath = path.join(tempDir, 'hub-config.yml');
      fs.writeFileSync(
        hubPath,
        `
version: '1.0.0'
metadata:
  name: Test Hub
  description: A test hub
  maintainer: test@example.com
  updatedAt: '2024-01-01T00:00:00Z'
sources:
  - id: test-src
    type: github
    enabled: true
    priority: 1
    repository: owner/repo
`
      );

      const result = loadHubConfig(hubPath);

      assert.strictEqual(result.version, '1.0.0');
      assert.strictEqual(result.metadata.name, 'Test Hub');
      assert.strictEqual(result.sources.length, 1);
      assert.strictEqual(result.sources[0].id, 'test-src');
    });

    it('should throw error for non-existent file', () => {
      assert.throws(() => {
        loadHubConfig(path.join(tempDir, 'nonexistent.yml'));
      }, /File not found/);
    });
  });

  describe('loadHubConfig() - GitHub repo', () => {
    const { loadHubConfig } = analyzer;

    it('should fetch and parse hub config from GitHub repo', () => {
      const mockSpawnSync = (cmd: string, args: string[]) => {
        if (cmd === 'gh' && args[0] === 'api') {
          // Return mock API response with base64 content
          const hubYaml = `
version: '1.0.0'
metadata:
  name: GitHub Hub
  description: From GitHub
  maintainer: gh@example.com
  updatedAt: '2024-01-01T00:00:00Z'
sources: []
`;
          return {
            status: 0,
            stdout: JSON.stringify({
              content: Buffer.from(hubYaml).toString('base64')
            })
          };
        }
        return { status: 1 };
      };

      const result = loadHubConfig('https://github.com/owner/repo', {
        spawnSync: mockSpawnSync
      });

      assert.strictEqual(result.version, '1.0.0');
      assert.strictEqual(result.metadata.name, 'GitHub Hub');
    });
  });

  describe('extractBundleInfo()', () => {
    const { extractBundleInfo } = analyzer;

    it('should extract bundle info from versioned zip', () => {
      const result = extractBundleInfo('my-bundle-1.2.3.zip');
      assert.strictEqual(result.bundleId, 'my-bundle');
      assert.strictEqual(result.version, '1.2.3');
    });

    it('should extract bundle info from v-prefixed version', () => {
      const result = extractBundleInfo('my-bundle-v2.0.0.zip');
      assert.strictEqual(result.bundleId, 'my-bundle');
      assert.strictEqual(result.version, '2.0.0');
    });

    it('should extract from json manifest files', () => {
      const result = extractBundleInfo('other-bundle-1.0.0.json');
      assert.strictEqual(result.bundleId, 'other-bundle');
      assert.strictEqual(result.version, '1.0.0');
    });

    it('should handle unknown version format', () => {
      const result = extractBundleInfo('some-asset-latest.zip');
      assert.strictEqual(result.bundleId, 'some-asset-latest');
      assert.strictEqual(result.version, 'unknown');
    });

    it('should return null for non-zip/json files', () => {
      const result = extractBundleInfo('readme.md');
      assert.strictEqual(result, null);
    });

    it('should handle prerelease versions', () => {
      const result = extractBundleInfo('bundle-1.0.0-beta.1.zip');
      assert.strictEqual(result.bundleId, 'bundle');
      assert.strictEqual(result.version, '1.0.0-beta.1');
    });
  });

  describe('processReleases()', () => {
    const { processReleases } = analyzer;

    const mockSource = {
      id: 'test-src',
      name: 'Test Source',
      repo: 'owner/repo',
      type: 'github' as const
    };

    const mockReleases = [
      {
        tag_name: 'v1.0.0',
        published_at: '2024-01-01T00:00:00Z',
        assets: [
          { name: 'bundle-a-1.0.0.zip', size: 1024, download_count: 100 },
          { name: 'bundle-b-1.0.0.zip', size: 2048, download_count: 200 },
          { name: 'readme.md', size: 100, download_count: 50 }
        ]
      },
      {
        tag_name: 'v2.0.0',
        published_at: '2024-02-01T00:00:00Z',
        assets: [
          { name: 'bundle-a-2.0.0.zip', size: 1536, download_count: 150 },
          { name: 'bundle-c-2.0.0.zip', size: 3072, download_count: 300 }
        ]
      }
    ];

    it('should extract all download records from releases', () => {
      const result = processReleases(mockSource, mockReleases);

      assert.strictEqual(result.length, 4);
      assert.ok(result.some((r: any) => r.bundleId === 'bundle-a' && r.version === '1.0.0'));
      assert.ok(result.some((r: any) => r.bundleId === 'bundle-a' && r.version === '2.0.0'));
      assert.ok(result.some((r: any) => r.bundleId === 'bundle-b' && r.version === '1.0.0'));
      assert.ok(result.some((r: any) => r.bundleId === 'bundle-c' && r.version === '2.0.0'));
    });

    it('should filter by minDownloads', () => {
      const result = processReleases(mockSource, mockReleases, { minDownloads: 150 });

      assert.strictEqual(result.length, 3);
      assert.ok(!result.some((r: any) => r.bundleId === 'bundle-a' && r.version === '1.0.0')); // 100 downloads
    });

    it('should filter by bundle regex', () => {
      const result = processReleases(mockSource, mockReleases, {
        bundleFilter: /bundle-a/
      });

      assert.strictEqual(result.length, 2);
      assert.ok(result.every((r: any) => r.bundleId === 'bundle-a'));
    });

    it('should include correct metadata in records', () => {
      const result = processReleases(mockSource, mockReleases);

      const record = result.find((r: any) => r.bundleId === 'bundle-a' && r.version === '1.0.0');
      assert.ok(record);
      assert.strictEqual(record.sourceId, 'test-src');
      assert.strictEqual(record.sourceName, 'Test Source');
      assert.strictEqual(record.sourceRepo, 'owner/repo');
      assert.strictEqual(record.downloadCount, 100);
      assert.strictEqual(record.assetSize, 1024);
      assert.strictEqual(record.releaseTag, 'v1.0.0');
      assert.strictEqual(record.releaseDate, '2024-01-01T00:00:00Z');
    });
  });

  describe('aggregateData()', () => {
    const { aggregateData } = analyzer;

    const mockRecords = [
      {
        sourceId: 'src1', sourceName: 'Source 1', sourceRepo: 'owner/repo1', bundleId: 'bundle-a',
        version: '1.0.0', assetName: 'a-1.0.0.zip', assetSize: 1000, downloadCount: 100,
        releaseTag: 'v1.0.0', releaseDate: '2024-01-01'
      },
      {
        sourceId: 'src1', sourceName: 'Source 1', sourceRepo: 'owner/repo1', bundleId: 'bundle-a',
        version: '2.0.0', assetName: 'a-2.0.0.zip', assetSize: 1000, downloadCount: 200,
        releaseTag: 'v2.0.0', releaseDate: '2024-02-01'
      },
      {
        sourceId: 'src1', sourceName: 'Source 1', sourceRepo: 'owner/repo1', bundleId: 'bundle-b',
        version: '1.0.0', assetName: 'b-1.0.0.zip', assetSize: 1000, downloadCount: 50,
        releaseTag: 'v1.0.0', releaseDate: '2024-01-01'
      },
      {
        sourceId: 'src2', sourceName: 'Source 2', sourceRepo: 'owner/repo2', bundleId: 'bundle-a',
        version: '1.0.0', assetName: 'a-1.0.0.zip', assetSize: 1000, downloadCount: 150,
        releaseTag: 'v1.0.0', releaseDate: '2024-01-15'
      }
    ];

    it('should aggregate by source', () => {
      const result = aggregateData(mockRecords);

      assert.strictEqual(result.bySource.length, 2);

      const src1 = result.bySource.find((s: any) => s.sourceId === 'src1');
      assert.ok(src1);
      assert.strictEqual(src1.totalDownloads, 350); // 100 + 200 + 50
      assert.strictEqual(src1.bundleCount, 2); // bundle-a, bundle-b
      assert.strictEqual(src1.versionCount, 3); // a@1.0.0, a@2.0.0, b@1.0.0
      assert.strictEqual(src1.latestRelease, '2024-02-01');

      const src2 = result.bySource.find((s: any) => s.sourceId === 'src2');
      assert.ok(src2);
      assert.strictEqual(src2.totalDownloads, 150);
    });

    it('should aggregate by bundle', () => {
      const result = aggregateData(mockRecords);

      assert.strictEqual(result.byBundle.length, 2);

      const bundleA = result.byBundle.find((b: any) => b.bundleId === 'bundle-a');
      assert.ok(bundleA);
      assert.strictEqual(bundleA.totalDownloads, 450); // 100 + 200 + 150
      assert.strictEqual(bundleA.versionCount, 2); // 1.0.0, 2.0.0
      assert.strictEqual(bundleA.sourceCount, 2); // src1, src2
      assert.strictEqual(bundleA.topVersion.version, '2.0.0');
      assert.strictEqual(bundleA.topVersion.downloads, 200);

      const bundleB = result.byBundle.find((b: any) => b.bundleId === 'bundle-b');
      assert.ok(bundleB);
      assert.strictEqual(bundleB.totalDownloads, 50);
      assert.strictEqual(bundleB.versionCount, 1);
      assert.strictEqual(bundleB.sourceCount, 1);
    });

    it('should include all detailed records', () => {
      const result = aggregateData(mockRecords);
      assert.strictEqual(result.detailed.length, 4);
    });
  });

  describe('generateCsvReports()', () => {
    const { generateCsvReports } = analyzer;
    let tempDir: string;

    const mockAggregated = {
      bySource: [
        { sourceId: 'src1', sourceName: 'Source 1', sourceRepo: 'owner/repo1', totalDownloads: 1000, bundleCount: 5, versionCount: 10, latestRelease: '2024-01-01' },
        { sourceId: 'src2', sourceName: 'Source 2', sourceRepo: 'owner/repo2', totalDownloads: 500, bundleCount: 3, versionCount: 6, latestRelease: '2024-02-01' }
      ],
      byBundle: [
        { bundleId: 'bundle-a', totalDownloads: 800, versionCount: 3, sourceCount: 2, topVersion: { version: '2.0.0', downloads: 400 } },
        { bundleId: 'bundle-b', totalDownloads: 700, versionCount: 2, sourceCount: 1, topVersion: { version: '1.5.0', downloads: 500 } }
      ],
      detailed: [
        {
          sourceId: 'src1', sourceName: 'Source 1', bundleId: 'bundle-a', version: '1.0.0',
          assetName: 'a-1.0.0.zip', assetSize: 1024, downloadCount: 100,
          releaseTag: 'v1.0.0', releaseDate: '2024-01-01'
        }
      ]
    };

    beforeEach(() => {
      tempDir = createTempDir('csv-test-');
    });

    afterEach(() => {
      cleanup(tempDir);
    });

    it('should generate all three CSV files', () => {
      const reports = generateCsvReports(mockAggregated, tempDir, '2024-01-01');

      assert.strictEqual(reports.length, 3);
      assert.ok(reports.some((r: any) => r.name === 'By Source'));
      assert.ok(reports.some((r: any) => r.name === 'By Bundle'));
      assert.ok(reports.some((r: any) => r.name === 'Detailed'));

      // Verify files exist
      for (const report of reports) {
        assert.ok(fs.existsSync(report.path), `File should exist: ${report.path}`);
      }
    });

    it('should include correct headers in source CSV', () => {
      generateCsvReports(mockAggregated, tempDir, '2024-01-01');

      const sourcePath = path.join(tempDir, 'hub-analytics-2024-01-01-by-source.csv');
      const content = fs.readFileSync(sourcePath, 'utf8');

      assert.ok(content.includes('Source ID,Source Name,Repository'));
      assert.ok(content.includes('src1,Source 1,owner/repo1'));
      assert.ok(content.includes('src2,Source 2,owner/repo2'));
    });

    it('should properly escape CSV fields with commas', () => {
      const aggregatedWithComma = {
        ...mockAggregated,
        bySource: [
          { sourceId: 'src1', sourceName: 'Source, with comma', sourceRepo: 'owner/repo1', totalDownloads: 1000, bundleCount: 5, versionCount: 10, latestRelease: '2024-01-01' }
        ],
        byBundle: [],
        detailed: []
      };

      generateCsvReports(aggregatedWithComma, tempDir, '2024-01-01');

      const sourcePath = path.join(tempDir, 'hub-analytics-2024-01-01-by-source.csv');
      const content = fs.readFileSync(sourcePath, 'utf8');

      assert.ok(content.includes('"Source, with comma"'));
    });
  });

  describe('generateMarkdownReport()', () => {
    const { generateMarkdownReport } = analyzer;
    let tempDir: string;

    const mockAggregated = {
      bySource: [
        { sourceId: 'src1', sourceName: 'Source 1', sourceRepo: 'owner/repo1', totalDownloads: 1000, bundleCount: 5, versionCount: 10, latestRelease: '2024-01-01' }
      ],
      byBundle: [
        { bundleId: 'bundle-a', totalDownloads: 800, versionCount: 3, sourceCount: 2, topVersion: { version: '2.0.0', downloads: 400 } }
      ],
      detailed: [
        {
          sourceId: 'src1', sourceName: 'Source 1', bundleId: 'bundle-a', version: '1.0.0',
          assetName: 'a-1.0.0.zip', assetSize: 1024, downloadCount: 100,
          releaseTag: 'v1.0.0', releaseDate: '2024-01-01'
        },
        {
          sourceId: 'src1', sourceName: 'Source 1', bundleId: 'bundle-b', version: '2.0.0',
          assetName: 'b-2.0.0.zip', assetSize: 2048, downloadCount: 200,
          releaseTag: 'v2.0.0', releaseDate: '2024-02-01'
        }
      ]
    };

    const mockArgs = {
      hubSource: 'https://github.com/owner/repo',
      minDownloads: 10,
      sourceFilter: null,
      bundleFilter: null
    };

    beforeEach(() => {
      tempDir = createTempDir('md-test-');
    });

    afterEach(() => {
      cleanup(tempDir);
    });

    it('should generate markdown report', () => {
      const report = generateMarkdownReport(mockAggregated, tempDir, '2024-01-01', mockArgs);

      assert.strictEqual(report.name, 'Markdown Summary');
      assert.ok(fs.existsSync(report.path));
    });

    it('should include summary section', () => {
      generateMarkdownReport(mockAggregated, tempDir, '2024-01-01', mockArgs);

      const content = fs.readFileSync(path.join(tempDir, 'hub-analytics-2024-01-01.md'), 'utf8');

      assert.ok(content.includes('# Hub Release Analytics Report'));
      assert.ok(content.includes('Total Sources'));
      assert.ok(content.includes('Total Bundles'));
    });

    it('should include by-source table', () => {
      generateMarkdownReport(mockAggregated, tempDir, '2024-01-01', mockArgs);

      const content = fs.readFileSync(path.join(tempDir, 'hub-analytics-2024-01-01.md'), 'utf8');

      assert.ok(content.includes('## Downloads by Source'));
      assert.ok(content.includes('| Source ID | Source Name |'));
      assert.ok(content.includes('src1'));
      assert.ok(content.includes('1,000')); // formatted number
    });

    it('should include by-bundle table', () => {
      generateMarkdownReport(mockAggregated, tempDir, '2024-01-01', mockArgs);

      const content = fs.readFileSync(path.join(tempDir, 'hub-analytics-2024-01-01.md'), 'utf8');

      assert.ok(content.includes('## Downloads by Bundle'));
      assert.ok(content.includes('| Bundle ID | Downloads |'));
      assert.ok(content.includes('bundle-a'));
    });
  });

  describe('fetchReleases()', () => {
    const { fetchReleases } = analyzer;

    it('should fetch releases via gh api', () => {
      const mockSpawnSync = (cmd: string, args: string[]) => {
        if (cmd === 'gh' && args[0] === 'api') {
          return {
            status: 0,
            stdout: JSON.stringify([
              { tag_name: 'v1.0.0', assets: [] },
              { tag_name: 'v2.0.0', assets: [] }
            ])
          };
        }
        return { status: 1 };
      };

      const result = fetchReleases('owner/repo', { spawnSync: mockSpawnSync });

      assert.strictEqual(result.length, 2);
      assert.strictEqual(result[0].tag_name, 'v1.0.0');
    });

    it('should return empty array on error', () => {
      const mockSpawnSync = () => ({ status: 1, stderr: 'API error' });

      const result = fetchReleases('owner/repo', { spawnSync: mockSpawnSync, verbose: false });

      assert.strictEqual(result.length, 0);
    });
  });

  describe('Integration - main() dry run', () => {
    const { main } = analyzer;
    let tempDir: string;

    beforeEach(() => {
      tempDir = createTempDir('integration-');
    });

    afterEach(() => {
      cleanup(tempDir);
    });

    it('should complete dry run successfully', async () => {
      const hubPath = path.join(tempDir, 'hub.yml');
      fs.writeFileSync(
        hubPath,
        `
version: '1.0.0'
metadata:
  name: Test Hub
  description: Test
  maintainer: test@example.com
  updatedAt: '2024-01-01T00:00:00Z'
sources:
  - id: test-src
    type: github
    enabled: true
    priority: 1
    repository: owner/repo
`
      );

      let output = '';
      const mockLogger = {
        log: (msg: string) => {
          output += msg + '\n';
        },
        error: () => {}
      };

      await main({
        argv: ['--dry-run', hubPath],
        env: {},
        spawnSync: () => ({ status: 0 }),
        logger: mockLogger
      });

      assert.ok(output.includes('DRY RUN') || !output.includes('Error'));
    });
  });
});

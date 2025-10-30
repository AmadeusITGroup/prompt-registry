/**
 * GitHubAdapter Unit Tests
 */

import * as assert from 'assert';
import nock from 'nock';
import { GitHubAdapter } from '../../src/adapters/GitHubAdapter';
import { RegistrySource } from '../../src/types/registry';

suite('GitHubAdapter', () => {
    const mockSource: RegistrySource = {
        id: 'test-source',
        name: 'Test Source',
        type: 'github',
        url: 'https://github.com/test-owner/test-repo',
        enabled: true,
        priority: 1,
        token: 'test-token',
    };

    teardown(() => {
        nock.cleanAll();
    });

    suite('Constructor and Validation', () => {
        test('should accept valid GitHub URL', () => {
            const adapter = new GitHubAdapter(mockSource);
            assert.strictEqual(adapter.type, 'github');
        });

        test('should accept GitHub SSH URL', () => {
            const source = { ...mockSource, url: 'git@github.com:test-owner/test-repo.git' };
            const adapter = new GitHubAdapter(source);
            assert.ok(adapter);
        });

        test('should throw error for invalid URL', () => {
            const source = { ...mockSource, url: 'https://invalid.com/repo', token: undefined };
            assert.throws(() => new GitHubAdapter(source), /Invalid GitHub URL/);
        });

        test('should validate URL correctly', () => {
            // isValidGitHubUrl is private, so we test it indirectly through constructor
            assert.doesNotThrow(() => new GitHubAdapter(mockSource));
            assert.doesNotThrow(() => new GitHubAdapter({ ...mockSource, url: 'git@github.com:owner/repo.git', token: undefined }));
            assert.throws(() => new GitHubAdapter({ ...mockSource, url: 'https://gitlab.com/owner/repo', token: undefined }));
        });
    });

    suite('fetchMetadata', () => {
        test('should fetch repository metadata successfully', async () => {
            nock('https://api.github.com')
                .get('/repos/test-owner/test-repo')
                .reply(200, {
                    name: 'test-repo',
                    description: 'Test repository',
                })
                .get('/repos/test-owner/test-repo/releases')
                .reply(200, [{ tag_name: 'v1.0.0' }, { tag_name: 'v1.1.0' }]);

            const adapter = new GitHubAdapter(mockSource);
            const metadata = await adapter.fetchMetadata();

            assert.strictEqual(metadata.name, 'test-repo');
            assert.strictEqual(metadata.description, 'Test repository');
            assert.strictEqual(metadata.bundleCount, 2);
        });

        test('should handle API errors gracefully', async () => {
            nock('https://api.github.com')
                .get('/repos/test-owner/test-repo')
                .reply(404, { message: 'Not Found' });

            const adapter = new GitHubAdapter(mockSource);
            await assert.rejects(
                () => adapter.fetchMetadata(),
                /Failed to fetch GitHub metadata/
            );
        });

        test.skip('should include auth token in request', async () => {
            let authHeaderReceived = '';
            
            nock('https://api.github.com')
                .get('/repos/test-owner/test-repo')
                .reply(function(this: any) {
                    authHeaderReceived = this.req.headers.authorization as string;
                    return [200, { name: 'test-repo', description: 'Test' }];
                })
                .get('/repos/test-owner/test-repo/releases')
                .reply(200, []);

            const adapter = new GitHubAdapter(mockSource);
            await adapter.fetchMetadata();

            assert.strictEqual(authHeaderReceived, 'token test-token');
        });
    });

    suite('fetchBundles', () => {
        test('should fetch bundles from releases', async () => {
            nock('https://api.github.com')
                .get('/repos/test-owner/test-repo/releases')
                .reply(200, [
                    {
                        tag_name: 'v1.0.0',
                        name: 'Release 1.0.0',
                        body: 'Release notes',
                        published_at: '2025-01-01T00:00:00Z',
                        assets: [
                            {
                                name: 'deployment-manifest.json',
                                browser_download_url: 'https://github.com/.../deployment-manifest.json',
                                size: 1024,
                            },
                            {
                                name: 'bundle.zip',
                                browser_download_url: 'https://github.com/.../bundle.zip',
                                size: 2048,
                            },
                        ],
                    },
                ]);

            const adapter = new GitHubAdapter(mockSource);
            const bundles = await adapter.fetchBundles();

            assert.strictEqual(bundles.length, 1);
            assert.strictEqual(bundles[0].id, 'test-owner-test-repo-v1.0.0');
            assert.strictEqual(bundles[0].version, '1.0.0');
            assert.strictEqual(bundles[0].sourceId, 'test-source');
        });

        test('should skip releases without manifest', async () => {
            nock('https://api.github.com')
                .get('/repos/test-owner/test-repo/releases')
                .reply(200, [
                    {
                        tag_name: 'v1.0.0',
                        name: 'Release without manifest',
                        assets: [
                            {
                                name: 'bundle.zip',
                                browser_download_url: 'https://github.com/.../bundle.zip',
                                size: 2048,
                            },
                        ],
                    },
                ]);

            const adapter = new GitHubAdapter(mockSource);
            const bundles = await adapter.fetchBundles();

            assert.strictEqual(bundles.length, 0);
        });

        test('should handle empty releases', async () => {
            nock('https://api.github.com')
                .get('/repos/test-owner/test-repo/releases')
                .reply(200, []);

            const adapter = new GitHubAdapter(mockSource);
            const bundles = await adapter.fetchBundles();

            assert.strictEqual(bundles.length, 0);
        });
    });

    suite('validate', () => {
        test('should validate accessible repository', async () => {
            nock('https://api.github.com')
                .get('/repos/test-owner/test-repo')
                .reply(200, { name: 'test-repo' })
                .get('/repos/test-owner/test-repo/releases')
                .reply(200, []);

            const adapter = new GitHubAdapter(mockSource);
            const result = await adapter.validate();

            assert.strictEqual(result.valid, true);
            assert.strictEqual(result.errors.length, 0);
        });

        test('should report validation failure for inaccessible repository', async () => {
            nock('https://api.github.com')
                .get('/repos/test-owner/test-repo')
                .reply(404);

            const adapter = new GitHubAdapter(mockSource);
            const result = await adapter.validate();

            assert.strictEqual(result.valid, false);
            assert.ok(result.errors.length > 0);
        });

        test('should handle authentication errors', async () => {
            nock('https://api.github.com')
                .get('/repos/test-owner/test-repo')
                .reply(401, { message: 'Bad credentials' });

            const adapter = new GitHubAdapter(mockSource);
            const result = await adapter.validate();

            assert.strictEqual(result.valid, false);
            assert.ok(result.errors[0].includes('401'));
        });
    });

    suite('URL Generation', () => {
        test('should generate correct manifest URL', () => {
            const adapter = new GitHubAdapter(mockSource);
            const url = adapter.getManifestUrl('bundle-id', '1.0.0');

            assert.ok(url.includes('test-owner/test-repo'));
            assert.ok(url.includes('v1.0.0'));
            assert.ok(url.includes('deployment-manifest.json'));
        });

        test('should generate correct download URL', () => {
            const adapter = new GitHubAdapter(mockSource);
            const url = adapter.getDownloadUrl('bundle-id', '1.0.0');

            assert.ok(url.includes('test-owner/test-repo'));
            assert.ok(url.includes('v1.0.0'));
            assert.ok(url.includes('bundle.zip'));
        });

        test('should use latest tag when version not specified', () => {
            const adapter = new GitHubAdapter(mockSource);
            const url = adapter.getManifestUrl('bundle-id');

            assert.ok(url.includes('latest'));
        });
    });

    suite('downloadBundle', () => {
        test.skip('should download bundle successfully', async () => {
            const bundleContent = Buffer.from('test bundle content');
            
            nock('https://github.com')
                .get('/test-owner/test-repo/releases/download/v1.0.0/bundle.zip')
                .reply(200, bundleContent);

            const adapter = new GitHubAdapter(mockSource);
            const result = await adapter.downloadBundle({
                id: 'test-bundle',
                name: 'Test Bundle',
                version: '1.0.0',
                description: 'Test',
                author: 'Test Author',
                sourceId: 'test-source',
                environments: [],
                tags: [],
                lastUpdated: '2025-01-01T00:00:00Z',
                size: '1KB',
                dependencies: [],
                license: 'MIT',
                downloadUrl: 'https://github.com/test-owner/test-repo/releases/download/v1.0.0/bundle.zip',
                manifestUrl: 'https://github.com/test-owner/test-repo/releases/download/v1.0.0/deployment-manifest.json',
            });

            assert.ok(Buffer.isBuffer(result));
            assert.strictEqual(result.toString(), 'test bundle content');
        });

        test('should handle download failures', async () => {
            nock('https://github.com')
                .get('/test-owner/test-repo/releases/download/v1.0.0/bundle.zip')
                .reply(404);

            const adapter = new GitHubAdapter(mockSource);
            await assert.rejects(
                () => adapter.downloadBundle({
                    id: 'test-bundle',
                    name: 'Test Bundle',
                    version: '1.0.0',
                    description: 'Test',
                    author: 'Test Author',
                    sourceId: 'test-source',
                    environments: [],
                    tags: [],
                    lastUpdated: '2025-01-01T00:00:00Z',
                    size: '1KB',
                    dependencies: [],
                    license: 'MIT',
                    downloadUrl: 'https://github.com/test-owner/test-repo/releases/download/v1.0.0/bundle.zip',
                    manifestUrl: 'https://github.com/test-owner/test-repo/releases/download/v1.0.0/deployment-manifest.json',
                }),
                /Failed to download bundle/
            );
        });
    });
});

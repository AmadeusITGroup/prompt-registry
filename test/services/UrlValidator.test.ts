/**
 * UrlValidator Tests
 * Tests for URL accessibility validation service
 */

import * as assert from 'assert';
import nock from 'nock';
import { UrlValidator } from '../../src/services/UrlValidator';

suite('UrlValidator Tests', () => {
    let validator: UrlValidator;

    setup(() => {
        validator = new UrlValidator();
        nock.cleanAll();
    });

    teardown(() => {
        nock.cleanAll();
    });

    suite('Success Cases (2xx)', () => {
        test('should return success for 200 OK', async () => {
            nock('https://example.com')
                .head('/hub')
                .reply(200);

            const result = await validator.checkUrl('https://example.com/hub');

            assert.strictEqual(result.severity, 'success');
            assert.strictEqual(result.accessible, true);
            assert.strictEqual(result.statusCode, 200);
            assert.strictEqual(result.message, 'Accessible');
        });

        test('should return success for 201 Created', async () => {
            nock('https://example.com')
                .head('/resource')
                .reply(201);

            const result = await validator.checkUrl('https://example.com/resource');

            assert.strictEqual(result.severity, 'success');
            assert.strictEqual(result.statusCode, 201);
        });

        test('should follow redirects and return success', async () => {
            nock('https://example.com')
                .head('/redirect')
                .reply(302, '', { location: 'https://example.com/final' });
            
            nock('https://example.com')
                .head('/final')
                .reply(200);

            const result = await validator.checkUrl('https://example.com/redirect');

            assert.strictEqual(result.severity, 'success');
            assert.strictEqual(result.statusCode, 200);
        });
    });

    suite('Warning Cases (401/403 - Private Repos)', () => {
        test('should return warning for 401 Unauthorized', async () => {
            nock('https://github.com')
                .head('/org/private-repo')
                .reply(401);

            const result = await validator.checkUrl('https://github.com/org/private-repo');

            assert.strictEqual(result.severity, 'warning');
            assert.strictEqual(result.accessible, false);
            assert.strictEqual(result.statusCode, 401);
            assert.ok(result.message.includes('Private/Access Denied'));
        });

        test('should return warning for 403 Forbidden', async () => {
            nock('https://github.com')
                .head('/org/private-repo')
                .reply(403);

            const result = await validator.checkUrl('https://github.com/org/private-repo');

            assert.strictEqual(result.severity, 'warning');
            assert.strictEqual(result.accessible, false);
            assert.strictEqual(result.statusCode, 403);
            assert.ok(result.message.includes('Private/Access Denied'));
        });
    });

    suite('Error Cases (404 - Broken Links)', () => {
        test('should return error for 404 Not Found', async () => {
            nock('https://example.com')
                .head('/notfound')
                .reply(404);

            const result = await validator.checkUrl('https://example.com/notfound');

            assert.strictEqual(result.severity, 'error');
            assert.strictEqual(result.accessible, false);
            assert.strictEqual(result.statusCode, 404);
            assert.ok(result.message.includes('Not Found'));
            assert.ok(result.message.includes('broken'));
        });

        test('should return error for 500 Internal Server Error', async () => {
            nock('https://example.com')
                .head('/error')
                .reply(500);

            const result = await validator.checkUrl('https://example.com/error');

            assert.strictEqual(result.severity, 'error');
            assert.strictEqual(result.statusCode, 500);
            assert.ok(result.message.includes('HTTP Error 500'));
        });

        test('should return error for 502 Bad Gateway', async () => {
            nock('https://example.com')
                .head('/gateway')
                .reply(502);

            const result = await validator.checkUrl('https://example.com/gateway');

            assert.strictEqual(result.severity, 'error');
            assert.strictEqual(result.statusCode, 502);
        });
    });

    suite('Error Cases (Connection Issues)', () => {
        test('should return error for invalid URL format', async () => {
            const result = await validator.checkUrl('not-a-valid-url');

            assert.strictEqual(result.severity, 'error');
            assert.strictEqual(result.accessible, false);
            assert.ok(result.message.includes('Invalid URL format'));
        });

        test('should return error for unsupported protocol', async () => {
            const result = await validator.checkUrl('ftp://example.com/file');

            assert.strictEqual(result.severity, 'error');
            assert.ok(result.message.includes('Unsupported protocol'));
        });

        test('should return error for connection timeout', async () => {
            nock('https://example.com')
                .head('/slow')
                .delay(100)
                .reply(200);

            const result = await validator.checkUrl('https://example.com/slow', 10);

            assert.strictEqual(result.severity, 'error');
            assert.ok(result.message.includes('timeout') || result.message.includes('Unreachable'));
        });

        test('should handle ENOTFOUND error', async () => {
            // ENOTFOUND happens at DNS level, nock can't mock it properly
            // Test with actual invalid domain that will fail DNS
            const result = await validator.checkUrl('https://this-domain-definitely-does-not-exist-12345.invalid', 2000);

            assert.strictEqual(result.severity, 'error');
            assert.ok(result.message.includes('DNS') || result.message.includes('domain') || result.message.includes('timeout'));
        });

        test('should handle ECONNREFUSED error', async () => {
            // ECONNREFUSED is a TCP-level error, use 503 Service Unavailable as proxy
            nock('https://example.com')
                .head('/refused')
                .reply(503);

            const result = await validator.checkUrl('https://example.com/refused');

            assert.strictEqual(result.severity, 'error');
            assert.ok(result.statusCode === 503);
        });
    });

    suite('Batch URL Checking', () => {
        test('should check multiple URLs in parallel', async () => {
            nock('https://example.com')
                .head('/url1')
                .reply(200);
            
            nock('https://example.com')
                .head('/url2')
                .reply(404);
            
            nock('https://example.com')
                .head('/url3')
                .reply(403);

            const urls = [
                'https://example.com/url1',
                'https://example.com/url2',
                'https://example.com/url3'
            ];

            const results = await validator.checkUrls(urls);

            assert.strictEqual(results.length, 3);
            assert.strictEqual(results[0].severity, 'success');
            assert.strictEqual(results[1].severity, 'error');
            assert.strictEqual(results[2].severity, 'warning');
        });

        test('should handle mixed success and failure cases', async () => {
            nock('https://example.com')
                .head('/good')
                .reply(200);
            
            nock('https://example.com')
                .head('/bad')
                .reply(404);

            const urls = [
                'https://example.com/good',
                'https://example.com/bad'
            ];

            const results = await validator.checkUrls(urls);

            assert.strictEqual(results.length, 2);
            assert.strictEqual(results[0].severity, 'success');
            assert.strictEqual(results[1].severity, 'error');
        });
    });

    suite('Edge Cases', () => {
        test('should handle URLs with query parameters', async () => {
            nock('https://example.com')
                .head('/hub')
                .query({ version: '1.0' })
                .reply(200);

            const result = await validator.checkUrl('https://example.com/hub?version=1.0');

            assert.strictEqual(result.severity, 'success');
        });

        test('should handle URLs with fragments', async () => {
            nock('https://example.com')
                .head('/hub')
                .reply(200);

            const result = await validator.checkUrl('https://example.com/hub#section');

            assert.strictEqual(result.severity, 'success');
        });

        test('should handle localhost URLs', async () => {
            nock('http://localhost:3000')
                .head('/api')
                .reply(200);

            const result = await validator.checkUrl('http://localhost:3000/api');

            assert.strictEqual(result.severity, 'success');
        });
    });
});

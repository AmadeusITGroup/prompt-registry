/**
 * Source ID Utilities Tests
 * 
 * Tests for the sourceIdUtils module which provides stable, portable
 * source identifiers for lockfile entries.
 */

import * as assert from 'assert';
import {
    generateHubSourceId,
    isLegacyHubSourceId,
    generateHubKey
} from '../../src/utils/sourceIdUtils';

suite('sourceIdUtils', () => {
    suite('generateHubSourceId()', () => {
        test('should produce correct format: {sourceType}-{8-char-hash}', () => {
            const result = generateHubSourceId('github', 'https://github.com/owner/repo');
            
            // Should match format: type-8hexchars
            assert.match(result, /^github-[a-f0-9]{8}$/);
        });

        test('should be deterministic - same input produces same output', () => {
            const url = 'https://github.com/owner/repo';
            const sourceType = 'github';
            
            const result1 = generateHubSourceId(sourceType, url);
            const result2 = generateHubSourceId(sourceType, url);
            const result3 = generateHubSourceId(sourceType, url);
            
            assert.strictEqual(result1, result2);
            assert.strictEqual(result2, result3);
        });

        test('should normalize URL case', () => {
            const result1 = generateHubSourceId('github', 'https://GitHub.com/Owner/Repo');
            const result2 = generateHubSourceId('github', 'https://github.com/owner/repo');
            
            assert.strictEqual(result1, result2);
        });

        test('should normalize URL protocol', () => {
            const result1 = generateHubSourceId('github', 'https://github.com/owner/repo');
            const result2 = generateHubSourceId('github', 'http://github.com/owner/repo');
            
            assert.strictEqual(result1, result2);
        });

        test('should normalize trailing slashes', () => {
            const result1 = generateHubSourceId('github', 'https://github.com/owner/repo');
            const result2 = generateHubSourceId('github', 'https://github.com/owner/repo/');
            const result3 = generateHubSourceId('github', 'https://github.com/owner/repo///');
            
            assert.strictEqual(result1, result2);
            assert.strictEqual(result2, result3);
        });

        test('should produce different IDs for different source types', () => {
            const url = 'https://example.com/repo';
            
            const githubId = generateHubSourceId('github', url);
            const gitlabId = generateHubSourceId('gitlab', url);
            const httpId = generateHubSourceId('http', url);
            
            assert.notStrictEqual(githubId, gitlabId);
            assert.notStrictEqual(gitlabId, httpId);
            assert.notStrictEqual(githubId, httpId);
        });

        test('should produce different IDs for different URLs', () => {
            const sourceType = 'github';
            
            const id1 = generateHubSourceId(sourceType, 'https://github.com/owner1/repo');
            const id2 = generateHubSourceId(sourceType, 'https://github.com/owner2/repo');
            
            assert.notStrictEqual(id1, id2);
        });

        test('should handle various source types', () => {
            const url = 'https://example.com/repo';
            
            assert.match(generateHubSourceId('github', url), /^github-[a-f0-9]{8}$/);
            assert.match(generateHubSourceId('gitlab', url), /^gitlab-[a-f0-9]{8}$/);
            assert.match(generateHubSourceId('http', url), /^http-[a-f0-9]{8}$/);
            assert.match(generateHubSourceId('local', url), /^local-[a-f0-9]{8}$/);
        });
    });

    suite('isLegacyHubSourceId()', () => {
        test('should return true for legacy format with 3 segments', () => {
            assert.strictEqual(isLegacyHubSourceId('hub-my-hub-source1'), true);
        });

        test('should return true for legacy format with more than 3 segments', () => {
            assert.strictEqual(isLegacyHubSourceId('hub-test-hub-github-source'), true);
            assert.strictEqual(isLegacyHubSourceId('hub-a-b-c-d-e'), true);
        });

        test('should return false for new format', () => {
            assert.strictEqual(isLegacyHubSourceId('github-a1b2c3d4'), false);
            assert.strictEqual(isLegacyHubSourceId('gitlab-12345678'), false);
            assert.strictEqual(isLegacyHubSourceId('http-abcdef12'), false);
        });

        test('should return false for hub- prefix with only 2 segments', () => {
            assert.strictEqual(isLegacyHubSourceId('hub-only'), false);
        });

        test('should return false for non-hub prefixed IDs', () => {
            assert.strictEqual(isLegacyHubSourceId('github-source'), false);
            assert.strictEqual(isLegacyHubSourceId('my-custom-source'), false);
            assert.strictEqual(isLegacyHubSourceId('source-id'), false);
        });

        test('should return false for empty string', () => {
            assert.strictEqual(isLegacyHubSourceId(''), false);
        });

        test('should return false for hub prefix without hyphen', () => {
            assert.strictEqual(isLegacyHubSourceId('hubsource'), false);
        });
    });

    suite('generateHubKey()', () => {
        test('should produce correct format: 8-char hash', () => {
            const result = generateHubKey('https://example.com/hub.json');
            
            assert.match(result, /^[a-f0-9]{8}$/);
        });

        test('should be deterministic - same input produces same output', () => {
            const url = 'https://example.com/hub.json';
            
            const result1 = generateHubKey(url);
            const result2 = generateHubKey(url);
            const result3 = generateHubKey(url);
            
            assert.strictEqual(result1, result2);
            assert.strictEqual(result2, result3);
        });

        test('should not append branch for main', () => {
            const url = 'https://example.com/hub.json';
            
            const result = generateHubKey(url, 'main');
            
            // Should be just the hash, no branch suffix
            assert.match(result, /^[a-f0-9]{8}$/);
        });

        test('should not append branch for master', () => {
            const url = 'https://example.com/hub.json';
            
            const result = generateHubKey(url, 'master');
            
            // Should be just the hash, no branch suffix
            assert.match(result, /^[a-f0-9]{8}$/);
        });

        test('should append branch for non-main/master branches', () => {
            const url = 'https://example.com/hub.json';
            
            const result = generateHubKey(url, 'develop');
            
            // Should be hash-branch format
            assert.match(result, /^[a-f0-9]{8}-develop$/);
        });

        test('should handle various branch names', () => {
            const url = 'https://example.com/hub.json';
            
            assert.match(generateHubKey(url, 'feature/test'), /^[a-f0-9]{8}-feature\/test$/);
            assert.match(generateHubKey(url, 'release-1.0'), /^[a-f0-9]{8}-release-1\.0$/);
            assert.match(generateHubKey(url, 'v2'), /^[a-f0-9]{8}-v2$/);
        });

        test('should produce same hash for same URL regardless of branch', () => {
            const url = 'https://example.com/hub.json';
            
            const keyMain = generateHubKey(url, 'main');
            const keyDevelop = generateHubKey(url, 'develop');
            
            // Extract hash portion (first 8 chars)
            const hashMain = keyMain.substring(0, 8);
            const hashDevelop = keyDevelop.substring(0, 8);
            
            assert.strictEqual(hashMain, hashDevelop);
        });

        test('should normalize URL case', () => {
            const result1 = generateHubKey('https://Example.COM/Hub.json');
            const result2 = generateHubKey('https://example.com/hub.json');
            
            assert.strictEqual(result1, result2);
        });

        test('should normalize URL protocol', () => {
            const result1 = generateHubKey('https://example.com/hub.json');
            const result2 = generateHubKey('http://example.com/hub.json');
            
            assert.strictEqual(result1, result2);
        });

        test('should normalize trailing slashes', () => {
            const result1 = generateHubKey('https://example.com/hub.json');
            const result2 = generateHubKey('https://example.com/hub.json/');
            
            assert.strictEqual(result1, result2);
        });

        test('should produce different keys for different URLs', () => {
            const key1 = generateHubKey('https://example.com/hub1.json');
            const key2 = generateHubKey('https://example.com/hub2.json');
            
            assert.notStrictEqual(key1, key2);
        });

        test('should handle undefined branch', () => {
            const result = generateHubKey('https://example.com/hub.json', undefined);
            
            // Should be just the hash, no branch suffix
            assert.match(result, /^[a-f0-9]{8}$/);
        });

        test('should handle empty string branch', () => {
            const result = generateHubKey('https://example.com/hub.json', '');
            
            // Empty string is falsy, should be just the hash
            assert.match(result, /^[a-f0-9]{8}$/);
        });
    });
});

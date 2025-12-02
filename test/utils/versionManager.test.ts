/**
 * Unit tests for VersionManager
 * Requirements: 2.1, 2.2, 4.2
 */
import * as assert from 'assert';
import { VersionManager } from '../../src/utils/versionManager';

suite('VersionManager Unit Tests', () => {
    suite('compareVersions', () => {
        test('should compare standard semver versions correctly', () => {
            assert.strictEqual(VersionManager.compareVersions('1.0.0', '2.0.0'), -1);
            assert.strictEqual(VersionManager.compareVersions('2.0.0', '1.0.0'), 1);
            assert.strictEqual(VersionManager.compareVersions('1.0.0', '1.0.0'), 0);
        });

        test('should handle versions with v prefix', () => {
            assert.strictEqual(VersionManager.compareVersions('v1.0.0', 'v2.0.0'), -1);
            assert.strictEqual(VersionManager.compareVersions('v2.0.0', 'v1.0.0'), 1);
            assert.strictEqual(VersionManager.compareVersions('v1.0.0', 'v1.0.0'), 0);
        });

        test('should handle mixed format versions', () => {
            assert.strictEqual(VersionManager.compareVersions('v1.0.0', '2.0.0'), -1);
            assert.strictEqual(VersionManager.compareVersions('1.0.0', 'v2.0.0'), -1);
        });

        test('should compare patch versions correctly', () => {
            assert.strictEqual(VersionManager.compareVersions('1.0.0', '1.0.1'), -1);
            assert.strictEqual(VersionManager.compareVersions('1.0.1', '1.0.0'), 1);
        });

        test('should compare minor versions correctly', () => {
            assert.strictEqual(VersionManager.compareVersions('1.0.0', '1.1.0'), -1);
            assert.strictEqual(VersionManager.compareVersions('1.1.0', '1.0.0'), 1);
        });

        test('should handle pre-release versions', () => {
            assert.strictEqual(VersionManager.compareVersions('1.0.0-alpha', '1.0.0'), -1);
            assert.strictEqual(VersionManager.compareVersions('1.0.0', '1.0.0-alpha'), 1);
            assert.strictEqual(VersionManager.compareVersions('1.0.0-alpha', '1.0.0-beta'), -1);
        });

        test('should coerce malformed versions', () => {
            // These should be coerced to valid semver
            assert.strictEqual(VersionManager.compareVersions('1', '2'), -1);
            assert.strictEqual(VersionManager.compareVersions('1.0', '1.1'), -1);
        });

        test('should fall back to string comparison for non-semver', () => {
            // When coercion fails, use string comparison
            const result = VersionManager.compareVersions('abc', 'def');
            assert.strictEqual(result, 'abc'.localeCompare('def'));
        });

        test('should throw error for empty strings', () => {
            // Empty strings should throw validation error
            assert.throws(() => VersionManager.compareVersions('', '1.0.0'), /cannot be empty/);
            assert.throws(() => VersionManager.compareVersions('1.0.0', ''), /cannot be empty/);
            assert.throws(() => VersionManager.compareVersions('', ''), /cannot be empty/);
        });

        test('should throw error for very long version strings', () => {
            const longVersion = '1.0.0-' + 'a'.repeat(200);
            assert.throws(() => VersionManager.compareVersions(longVersion, '1.0.0'), /exceeds maximum length/);
            assert.throws(() => VersionManager.compareVersions('1.0.0', longVersion), /exceeds maximum length/);
        });

        test('should handle build metadata correctly', () => {
            // Build metadata should be ignored per semver spec
            assert.strictEqual(VersionManager.compareVersions('1.0.0+build.123', '1.0.0+build.456'), 0);
            assert.strictEqual(VersionManager.compareVersions('1.0.0+build', '1.0.0'), 0);
        });
    });

    suite('isUpdateAvailable', () => {
        test('should return true when latest version is higher', () => {
            assert.strictEqual(VersionManager.isUpdateAvailable('1.0.0', '2.0.0'), true);
            assert.strictEqual(VersionManager.isUpdateAvailable('1.0.0', '1.1.0'), true);
            assert.strictEqual(VersionManager.isUpdateAvailable('1.0.0', '1.0.1'), true);
        });

        test('should return false when versions are equal', () => {
            assert.strictEqual(VersionManager.isUpdateAvailable('1.0.0', '1.0.0'), false);
            assert.strictEqual(VersionManager.isUpdateAvailable('v1.0.0', 'v1.0.0'), false);
        });

        test('should return false when installed version is higher', () => {
            assert.strictEqual(VersionManager.isUpdateAvailable('2.0.0', '1.0.0'), false);
            assert.strictEqual(VersionManager.isUpdateAvailable('1.1.0', '1.0.0'), false);
        });

        test('should handle versions with v prefix', () => {
            assert.strictEqual(VersionManager.isUpdateAvailable('v1.0.0', 'v2.0.0'), true);
            assert.strictEqual(VersionManager.isUpdateAvailable('v2.0.0', 'v1.0.0'), false);
        });

        test('should handle mixed format versions', () => {
            assert.strictEqual(VersionManager.isUpdateAvailable('v1.0.0', '2.0.0'), true);
            assert.strictEqual(VersionManager.isUpdateAvailable('1.0.0', 'v2.0.0'), true);
        });

        test('should throw error for empty versions', () => {
            assert.throws(() => VersionManager.isUpdateAvailable('', '1.0.0'), /cannot be empty/);
            assert.throws(() => VersionManager.isUpdateAvailable('1.0.0', ''), /cannot be empty/);
        });
    });

    suite('isValidSemver', () => {
        test('should validate standard semver versions', () => {
            assert.strictEqual(VersionManager.isValidSemver('1.0.0'), true);
            assert.strictEqual(VersionManager.isValidSemver('2.1.3'), true);
            assert.strictEqual(VersionManager.isValidSemver('0.0.1'), true);
        });

        test('should validate versions with v prefix', () => {
            assert.strictEqual(VersionManager.isValidSemver('v1.0.0'), true);
            assert.strictEqual(VersionManager.isValidSemver('v2.1.3'), true);
        });

        test('should validate pre-release versions', () => {
            assert.strictEqual(VersionManager.isValidSemver('1.0.0-alpha'), true);
            assert.strictEqual(VersionManager.isValidSemver('1.0.0-beta.1'), true);
        });

        test('should validate coercible versions', () => {
            assert.strictEqual(VersionManager.isValidSemver('1'), true);
            assert.strictEqual(VersionManager.isValidSemver('1.0'), true);
        });

        test('should reject invalid versions', () => {
            assert.strictEqual(VersionManager.isValidSemver(''), false);
            assert.strictEqual(VersionManager.isValidSemver('not-a-version'), false);
        });
    });

    suite('sortVersionsDescending', () => {
        test('should sort versions in descending order', () => {
            const versions = ['1.0.0', '2.0.0', '1.5.0', '3.0.0'];
            const sorted = VersionManager.sortVersionsDescending(versions);
            assert.deepStrictEqual(sorted, ['3.0.0', '2.0.0', '1.5.0', '1.0.0']);
        });

        test('should handle versions with v prefix', () => {
            const versions = ['v1.0.0', 'v2.0.0', 'v1.5.0'];
            const sorted = VersionManager.sortVersionsDescending(versions);
            assert.deepStrictEqual(sorted, ['v2.0.0', 'v1.5.0', 'v1.0.0']);
        });

        test('should handle mixed format versions', () => {
            const versions = ['v1.0.0', '2.0.0', 'v1.5.0'];
            const sorted = VersionManager.sortVersionsDescending(versions);
            assert.deepStrictEqual(sorted, ['2.0.0', 'v1.5.0', 'v1.0.0']);
        });

        test('should handle pre-release versions', () => {
            const versions = ['1.0.0', '1.0.0-alpha', '1.0.0-beta'];
            const sorted = VersionManager.sortVersionsDescending(versions);
            assert.deepStrictEqual(sorted, ['1.0.0', '1.0.0-beta', '1.0.0-alpha']);
        });

        test('should filter out invalid versions', () => {
            const versions = ['1.0.0', 'invalid', '2.0.0'];
            const sorted = VersionManager.sortVersionsDescending(versions);
            assert.deepStrictEqual(sorted, ['2.0.0', '1.0.0']);
        });
    });

    suite('extractBundleIdentity', () => {
        test('should extract identity from GitHub bundle IDs with version', () => {
            assert.strictEqual(
                VersionManager.extractBundleIdentity('owner-repo-v1.0.0', 'github'),
                'owner-repo'
            );
            assert.strictEqual(
                VersionManager.extractBundleIdentity('microsoft-vscode-1.0.0', 'github'),
                'microsoft-vscode'
            );
        });

        test('should handle GitHub bundle IDs with complex versions', () => {
            assert.strictEqual(
                VersionManager.extractBundleIdentity('owner-repo-v1.0.0-alpha', 'github'),
                'owner-repo'
            );
            assert.strictEqual(
                VersionManager.extractBundleIdentity('owner-repo-2.1.3', 'github'),
                'owner-repo'
            );
        });

        test('should handle GitHub bundle IDs with hyphens in name', () => {
            assert.strictEqual(
                VersionManager.extractBundleIdentity('my-org-my-repo-v1.0.0', 'github'),
                'my-org-my-repo'
            );
        });

        test('should return as-is for GitHub bundles without version', () => {
            assert.strictEqual(
                VersionManager.extractBundleIdentity('owner-repo', 'github'),
                'owner-repo'
            );
        });

        test('should handle bundle IDs with multiple version-like patterns', () => {
            assert.strictEqual(
                VersionManager.extractBundleIdentity('v1-repo-v2.0.0', 'github'),
                'v1-repo'
            );
        });

        test('should handle single-part bundle IDs', () => {
            assert.strictEqual(
                VersionManager.extractBundleIdentity('repo', 'github'),
                'repo'
            );
        });

        test('should handle numeric repo names', () => {
            assert.strictEqual(
                VersionManager.extractBundleIdentity('owner-123-v1.0.0', 'github'),
                'owner-123'
            );
        });

        test('should throw error for excessively long bundle IDs', () => {
            const longId = 'a'.repeat(201) + '-v1.0.0';
            assert.throws(() => VersionManager.extractBundleIdentity(longId, 'github'), /exceeds maximum length/);
        });

        test('should return as-is for non-GitHub sources', () => {
            assert.strictEqual(
                VersionManager.extractBundleIdentity('bundle-id-v1.0.0', 'gitlab'),
                'bundle-id-v1.0.0'
            );
            assert.strictEqual(
                VersionManager.extractBundleIdentity('bundle-id-v1.0.0', 'http'),
                'bundle-id-v1.0.0'
            );
            assert.strictEqual(
                VersionManager.extractBundleIdentity('bundle-id-v1.0.0', 'local'),
                'bundle-id-v1.0.0'
            );
        });
    });

    suite('parseVersion', () => {
        test('should clean standard semver versions', () => {
            assert.strictEqual(VersionManager.parseVersion('1.0.0'), '1.0.0');
            assert.strictEqual(VersionManager.parseVersion('2.1.3'), '2.1.3');
        });

        test('should clean versions with v prefix', () => {
            assert.strictEqual(VersionManager.parseVersion('v1.0.0'), '1.0.0');
            assert.strictEqual(VersionManager.parseVersion('v2.1.3'), '2.1.3');
        });

        test('should coerce partial versions', () => {
            assert.strictEqual(VersionManager.parseVersion('1'), '1.0.0');
            assert.strictEqual(VersionManager.parseVersion('1.0'), '1.0.0');
        });

        test('should handle pre-release versions', () => {
            assert.strictEqual(VersionManager.parseVersion('1.0.0-alpha'), '1.0.0-alpha');
            assert.strictEqual(VersionManager.parseVersion('v1.0.0-beta'), '1.0.0-beta');
        });

        test('should return null for invalid versions', () => {
            assert.strictEqual(VersionManager.parseVersion('not-a-version'), null);
            assert.strictEqual(VersionManager.parseVersion(''), null);
        });

        test('should handle build metadata', () => {
            // Note: semver.clean() strips build metadata per semver spec
            // Build metadata should be ignored for version comparison
            assert.strictEqual(VersionManager.parseVersion('1.0.0+build.123'), '1.0.0');
        });
    });
});

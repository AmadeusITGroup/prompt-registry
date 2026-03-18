import * as assert from 'assert';
import { resolveRunnerPattern } from '../../src/utils/scaffoldUtils';

suite('scaffoldUtils', () => {
    suite('resolveRunnerPattern()', () => {
        test('should resolve {githubOrg} placeholder with org value', () => {
            const result = resolveRunnerPattern('gmsshr-core-{githubOrg}', 'myorg');
            assert.strictEqual(result, 'gmsshr-core-myorg');
        });

        test('should return literal value unchanged when no placeholder', () => {
            const result = resolveRunnerPattern('ubuntu-latest', 'myorg');
            assert.strictEqual(result, 'ubuntu-latest');
        });

        test('should resolve multiple occurrences of {githubOrg}', () => {
            const result = resolveRunnerPattern('{githubOrg}-runner-{githubOrg}', 'acme');
            assert.strictEqual(result, 'acme-runner-acme');
        });

        test('should handle empty org string', () => {
            const result = resolveRunnerPattern('prefix-{githubOrg}', '');
            assert.strictEqual(result, 'prefix-');
        });
    });
});

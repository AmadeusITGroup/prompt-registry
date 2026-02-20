import * as assert from 'assert';
import * as path from 'path';
import { SchemaValidator } from '../../src/services/SchemaValidator';

const HUB_SCHEMA_PATH = path.join(process.cwd(), 'schemas', 'hub-config.schema.json');

function createMinimalValidHub(overrides?: Record<string, any>) {
    return {
        version: '1.0.0',
        metadata: {
            name: 'Test Hub',
            description: 'A test hub',
            maintainer: 'Test',
            updatedAt: '2025-01-01T00:00:00Z'
        },
        sources: [{
            id: 'src-1',
            type: 'github',
            repository: 'org/repo',
            enabled: true,
            priority: 50
        }],
        ...overrides
    };
}

suite('Hub Config Schema — scaffoldDefaults', () => {
    let validator: SchemaValidator;

    setup(() => {
        validator = new SchemaValidator(process.cwd());
    });

    teardown(() => {
        validator.clearCache();
    });

    test('should accept hub config with scaffoldDefaults', async () => {
        const hub = createMinimalValidHub({
            scaffoldDefaults: {
                githubOrg: 'myorg',
                githubRunner: 'gmsshr-core-{githubOrg}',
                organizationName: 'My Org Inc.',
                internalContact: 'security@myorg.com',
                legalContact: 'legal@myorg.com',
                organizationPolicyLink: 'https://myorg.com/policies'
            }
        });

        const result = await validator.validate(hub, HUB_SCHEMA_PATH);
        assert.strictEqual(result.valid, true, `Validation errors: ${result.errors.join(', ')}`);
    });

    test('should accept hub config without scaffoldDefaults (backward compat)', async () => {
        const hub = createMinimalValidHub();

        const result = await validator.validate(hub, HUB_SCHEMA_PATH);
        assert.strictEqual(result.valid, true, `Validation errors: ${result.errors.join(', ')}`);
    });

    test('should accept scaffoldDefaults with only some fields', async () => {
        const hub = createMinimalValidHub({
            scaffoldDefaults: {
                githubOrg: 'myorg'
            }
        });

        const result = await validator.validate(hub, HUB_SCHEMA_PATH);
        assert.strictEqual(result.valid, true, `Validation errors: ${result.errors.join(', ')}`);
    });

    test('should accept empty scaffoldDefaults object', async () => {
        const hub = createMinimalValidHub({
            scaffoldDefaults: {}
        });

        const result = await validator.validate(hub, HUB_SCHEMA_PATH);
        assert.strictEqual(result.valid, true, `Validation errors: ${result.errors.join(', ')}`);
    });

    test('should reject scaffoldDefaults with unknown properties', async () => {
        const hub = createMinimalValidHub({
            scaffoldDefaults: {
                unknownField: 'value'
            }
        });

        const result = await validator.validate(hub, HUB_SCHEMA_PATH);
        assert.strictEqual(result.valid, false);
    });
});

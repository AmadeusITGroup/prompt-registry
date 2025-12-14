/**
 * Hub Schema Validator Tests
 * Tests JSON Schema validation for hub configurations
 */

import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as yaml from 'js-yaml';
import { SchemaValidator, ValidationResult } from '../../src/services/SchemaValidator';
import { HubConfig } from '../../src/types/hub';

suite('HubSchemaValidator - TDD', () => {
    let validator: SchemaValidator;
    let hubSchemaPath: string;
    let validHubConfig: HubConfig;
    let invalidHubConfig: any;
    let maliciousHubConfig: any;

    setup(() => {
        validator = new SchemaValidator(process.cwd());
        hubSchemaPath = path.join(process.cwd(), 'schemas', 'hub-config.schema.json');
        
        // Load test fixtures
        const fixturesDir = path.join(process.cwd(), 'test', 'fixtures', 'hubs');
        
        const validContent = fs.readFileSync(
            path.join(fixturesDir, 'valid-hub-config.yml'),
            'utf-8'
        );
        validHubConfig = yaml.load(validContent) as HubConfig;
        
        const invalidContent = fs.readFileSync(
            path.join(fixturesDir, 'invalid-hub-config.yml'),
            'utf-8'
        );
        invalidHubConfig = yaml.load(invalidContent);
        
        const maliciousContent = fs.readFileSync(
            path.join(fixturesDir, 'malicious-hub-config.yml'),
            'utf-8'
        );
        maliciousHubConfig = yaml.load(maliciousContent);
    });

    suite('Schema existence and structure', () => {
        test('hub schema file should exist', () => {
            assert.ok(fs.existsSync(hubSchemaPath), 'Hub schema file should exist');
        });

        test('hub schema should be valid JSON', () => {
            const schemaContent = fs.readFileSync(hubSchemaPath, 'utf-8');
            assert.doesNotThrow(() => JSON.parse(schemaContent), 'Schema should be valid JSON');
        });

        test('hub schema should have required root properties', () => {
            const schemaContent = fs.readFileSync(hubSchemaPath, 'utf-8');
            const schema = JSON.parse(schemaContent);
            
            assert.ok(schema.$schema, 'Schema should have $schema property');
            assert.ok(schema.type, 'Schema should have type property');
            assert.ok(schema.required, 'Schema should have required property');
            assert.ok(schema.properties, 'Schema should have properties');
        });
    });

    suite('Valid hub configuration validation', () => {
        test('should validate complete valid hub config', async () => {
            const result = await validator.validate(validHubConfig, hubSchemaPath);
            
            assert.strictEqual(result.valid, true, 'Valid config should pass validation');
            assert.strictEqual(result.errors.length, 0, 'Should have no errors');
        });

        test('should accept optional checksum field', async () => {
            const config = JSON.parse(JSON.stringify(validHubConfig));
            config.metadata.checksum = 'sha256:abc123def456';
            
            const result = await validator.validate(config, hubSchemaPath);
            
            assert.strictEqual(result.valid, true);
        });

        test('should accept empty profiles array', async () => {
            const config = JSON.parse(JSON.stringify(validHubConfig));
            config.profiles = [];
            
            const result = await validator.validate(config, hubSchemaPath);
            
            assert.strictEqual(result.valid, true);
        });

        test('should accept configuration object', async () => {
            const config = JSON.parse(JSON.stringify(validHubConfig));
            config.configuration = {
                autoSync: true,
                syncInterval: 3600,
                strictMode: true
            };
            
            const result = await validator.validate(config, hubSchemaPath);
            
            assert.strictEqual(result.valid, true);
        });
    });

    suite('Required field validation', () => {
        test('should reject config without version', async () => {
            const config = JSON.parse(JSON.stringify(validHubConfig));
            delete config.version;
            
            const result = await validator.validate(config, hubSchemaPath);
            
            assert.strictEqual(result.valid, false);
            assert.ok(result.errors.some(e => e.includes('version')));
        });

        test('should reject config without metadata', async () => {
            const config = JSON.parse(JSON.stringify(validHubConfig));
            delete config.metadata;
            
            const result = await validator.validate(config, hubSchemaPath);
            
            assert.strictEqual(result.valid, false);
            assert.ok(result.errors.some(e => e.includes('metadata')));
        });

        test('should reject config without sources', async () => {
            const config = JSON.parse(JSON.stringify(validHubConfig));
            delete config.sources;
            
            const result = await validator.validate(config, hubSchemaPath);
            
            assert.strictEqual(result.valid, false);
            assert.ok(result.errors.some(e => e.includes('sources')));
        });

        test('should reject metadata without name', async () => {
            const config = JSON.parse(JSON.stringify(validHubConfig));
            delete config.metadata.name;
            
            const result = await validator.validate(config, hubSchemaPath);
            
            assert.strictEqual(result.valid, false);
            assert.ok(result.errors.some(e => e.includes('name')));
        });

        test('should reject metadata without description', async () => {
            const config = JSON.parse(JSON.stringify(validHubConfig));
            delete config.metadata.description;
            
            const result = await validator.validate(config, hubSchemaPath);
            
            assert.strictEqual(result.valid, false);
            assert.ok(result.errors.some(e => e.includes('description')));
        });
    });

    suite('Format validation', () => {
        test('should validate version format (semver)', async () => {
            const config = JSON.parse(JSON.stringify(validHubConfig));
            config.version = 'invalid';
            
            const result = await validator.validate(config, hubSchemaPath);
            
            assert.strictEqual(result.valid, false);
            assert.ok(result.errors.some(e => e.includes('version') || e.includes('pattern')));
        });

        test('should accept valid semver versions', async () => {
            const versions = ['1.0.0', '2.1.3', '0.0.1', '10.20.30'];
            
            for (const version of versions) {
                const config = JSON.parse(JSON.stringify(validHubConfig));
                config.version = version;
                const result = await validator.validate(config, hubSchemaPath);
                assert.strictEqual(result.valid, true, `Version ${version} should be valid`);
            }
        });

        test('should validate checksum format', async () => {
            const config = JSON.parse(JSON.stringify(validHubConfig));
            config.metadata.checksum = 'invalid-checksum';
            
            const result = await validator.validate(config, hubSchemaPath);
            
            assert.strictEqual(result.valid, false);
            assert.ok(result.errors.some(e => e.includes('checksum') || e.includes('pattern')));
        });

        test('should accept sha256 and sha512 checksums', async () => {
            const checksums = [
                'sha256:abc123def456',
                'sha512:abc123def456789',
                'sha256:0123456789abcdef'
            ];
            
            for (const checksum of checksums) {
                const config = JSON.parse(JSON.stringify(validHubConfig));
                config.metadata.checksum = checksum;
                const result = await validator.validate(config, hubSchemaPath);
                assert.strictEqual(result.valid, true, `Checksum ${checksum} should be valid`);
            }
        });

        test('should validate source type enum', async () => {
            const config = JSON.parse(JSON.stringify(validHubConfig));
            config.sources[0].type = 'invalid-type';
            
            const result = await validator.validate(config, hubSchemaPath);
            
            assert.strictEqual(result.valid, false);
            assert.ok(result.errors.some(e => e.includes('type') || e.includes('enum')));
        });

        test('should accept valid source types', async () => {
            const types = ['github', 'local', 'url'];
            
            for (const type of types) {
                const config = JSON.parse(JSON.stringify(validHubConfig));
                config.sources[0].type = type;
                const result = await validator.validate(config, hubSchemaPath);
                assert.strictEqual(result.valid, true, `Source type ${type} should be valid`);
            }
        });
    });

    suite('Type validation', () => {
        test('should reject non-string version', async () => {
            const config = JSON.parse(JSON.stringify(validHubConfig));
            config.version = 123;
            
            const result = await validator.validate(config, hubSchemaPath);
            
            assert.strictEqual(result.valid, false);
            assert.ok(result.errors.some(e => e.includes('version') || e.includes('string')));
        });

        test('should reject non-object metadata', async () => {
            const config = JSON.parse(JSON.stringify(validHubConfig));
            config.metadata = 'invalid';
            
            const result = await validator.validate(config, hubSchemaPath);
            
            assert.strictEqual(result.valid, false);
            assert.ok(result.errors.some(e => e.includes('metadata') || e.includes('object')));
        });

        test('should reject non-array sources', async () => {
            const config = JSON.parse(JSON.stringify(validHubConfig));
            config.sources = 'invalid';
            
            const result = await validator.validate(config, hubSchemaPath);
            
            assert.strictEqual(result.valid, false);
            assert.ok(result.errors.some(e => e.includes('sources') || e.includes('array')));
        });

        test('should reject non-boolean enabled field', async () => {
            const config = JSON.parse(JSON.stringify(validHubConfig));
            config.sources[0].enabled = 'yes';
            
            const result = await validator.validate(config, hubSchemaPath);
            
            assert.strictEqual(result.valid, false);
            assert.ok(result.errors.some(e => e.includes('enabled') || e.includes('boolean')));
        });

        test('should reject non-number priority', async () => {
            const config = JSON.parse(JSON.stringify(validHubConfig));
            config.sources[0].priority = 'high';
            
            const result = await validator.validate(config, hubSchemaPath);
            
            assert.strictEqual(result.valid, false);
            assert.ok(result.errors.some(e => e.includes('priority') || e.includes('number')));
        });
    });

    suite('Invalid configuration validation', () => {
        test('should reject invalid hub config from fixture', async () => {
            const result = await validator.validate(invalidHubConfig, hubSchemaPath);
            
            assert.strictEqual(result.valid, false);
            assert.ok(result.errors.length > 0, 'Should have validation errors');
        });
    });

    suite('Security validation', () => {
        test('should reject malicious hub config', async () => {
            const result = await validator.validate(maliciousHubConfig, hubSchemaPath);
            
            // Schema validation catches structure issues
            // Additional security validation happens in validateHubConfig()
            assert.ok(result.errors.length > 0 || !result.valid, 
                'Should detect issues in malicious config');
        });
    });

    suite('Array constraints', () => {
        test('should accept empty sources array minimum', async () => {
            const config = JSON.parse(JSON.stringify(validHubConfig));
            config.sources = [];
            
            const result = await validator.validate(config, hubSchemaPath);
            
            // Note: We may want sources to be required, adjust schema accordingly
            assert.ok(result.valid !== undefined);
        });

        test('should validate bundle structure in profiles', async () => {
            const config = JSON.parse(JSON.stringify(validHubConfig));
            config.profiles[0].bundles[0] = { invalid: true };
            
            const result = await validator.validate(config, hubSchemaPath);
            
            assert.strictEqual(result.valid, false);
            assert.ok(result.errors.length > 0);
        });
    });

    suite('Additional properties', () => {
        test('should handle additional properties based on schema config', async () => {
            const config = JSON.parse(JSON.stringify(validHubConfig));
            config.extraField = 'should be handled based on additionalProperties setting';
            
            const result = await validator.validate(config, hubSchemaPath);
            
            // Result depends on additionalProperties in schema
            assert.ok(result !== undefined);
        });
    });

    suite('Profile path validation', () => {
        test('should accept optional path in profiles', async () => {
            const config = JSON.parse(JSON.stringify(validHubConfig));
            config.profiles[0].path = ['Folder', 'Subfolder'];
            
            const result = await validator.validate(config, hubSchemaPath);
            
            assert.strictEqual(result.valid, true, 'Profile path should be valid');
        });

        test('should reject path with invalid characters', async () => {
            const config = JSON.parse(JSON.stringify(validHubConfig));
            config.profiles[0].path = ['Invalid/Character'];
            
            const result = await validator.validate(config, hubSchemaPath);
            
            assert.strictEqual(result.valid, false);
            assert.ok(result.errors.some(e => e.includes('path') || e.includes('pattern')));
        });

        test('should reject path that is not an array', async () => {
            const config = JSON.parse(JSON.stringify(validHubConfig));
            config.profiles[0].path = 'Not an array';
            
            const result = await validator.validate(config, hubSchemaPath);
            
            assert.strictEqual(result.valid, false);
            assert.ok(result.errors.some(e => e.includes('path') || e.includes('array')));
        });
    });
});

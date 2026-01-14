/**
 * SchemaValidator Unit Tests
 */

import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import { SchemaValidator, ValidationResult } from '../../src/services/SchemaValidator';

suite('SchemaValidator', () => {
    let validator: SchemaValidator;
    let tempDir: string;
    let testSchemaPath: string;
    let testCollectionSchemaPath: string;

    // Test data
    const validCollection = {
        id: 'test-collection',
        name: 'Test Collection',
        description: 'A test collection for validation',
        version: '1.0.0',
        author: 'Test Author',
        items: [
            { path: 'prompts/test.txt', kind: 'prompt' },
            { path: 'instructions/guide.md', kind: 'instruction' }
        ]
    };

    const minimalCollection = {
        id: 'minimal',
        name: 'Minimal',
        description: 'Minimal collection',
        items: []
    };

    setup(() => {
        validator = new SchemaValidator(process.cwd());
        tempDir = path.join(__dirname, '..', '..', 'test-temp-schema');
        
        // Create temp directory
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }

        // Create a test schema
        testSchemaPath = path.join(tempDir, 'test.schema.json');
        const testSchema = {
            "$schema": "http://json-schema.org/draft-07/schema#",
            "type": "object",
            "required": ["name"],
            "properties": {
                "name": { "type": "string", "minLength": 1 },
                "age": { "type": "number", "minimum": 0 }
            }
        };
        fs.writeFileSync(testSchemaPath, JSON.stringify(testSchema, null, 2));

        // Path to actual collection schema (should exist after previous implementation)
        testCollectionSchemaPath = path.join(process.cwd(), 'schemas', 'collection.schema.json');
    });

    teardown(() => {
        // Cleanup temp directory
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
        
        // Clear schema cache
        validator.clearCache();
    });

    suite('Schema Loading', () => {
        test('should load and compile a valid schema', async () => {
            const result = await validator.validate({ name: 'Test' }, testSchemaPath);
            assert.ok(result);
            assert.strictEqual(result.valid, true);
        });

        test('should cache loaded schemas', async () => {
            // First load
            await validator.validate({ name: 'Test1' }, testSchemaPath);
            
            // Second load (should use cache)
            const result = await validator.validate({ name: 'Test2' }, testSchemaPath);
            assert.strictEqual(result.valid, true);
        });

        test('should throw error for non-existent schema', async () => {
            const badPath = path.join(tempDir, 'nonexistent.schema.json');
            const result = await validator.validate({ name: 'Test' }, badPath);
            
            assert.strictEqual(result.valid, false);
            assert.ok(result.errors.length > 0);
            assert.ok(result.errors[0].includes('Validation error'));
        });

        test('should throw error for invalid JSON schema', async () => {
            const invalidSchemaPath = path.join(tempDir, 'invalid.schema.json');
            fs.writeFileSync(invalidSchemaPath, 'not valid json');
            
            const result = await validator.validate({ name: 'Test' }, invalidSchemaPath);
            
            assert.strictEqual(result.valid, false);
            assert.ok(result.errors.length > 0);
        });
    });

    suite('Basic Validation', () => {
        test('should validate valid data', async () => {
            const validData = { name: 'John', age: 30 };
            const result = await validator.validate(validData, testSchemaPath);
            
            assert.strictEqual(result.valid, true);
            assert.strictEqual(result.errors.length, 0);
        });

        test('should detect missing required field', async () => {
            const invalidData = { age: 30 };
            const result = await validator.validate(invalidData, testSchemaPath);
            
            assert.strictEqual(result.valid, false);
            assert.ok(result.errors.length > 0);
            assert.ok(result.errors[0].includes('Missing required field'));
            assert.ok(result.errors[0].includes('name'));
        });

        test('should detect wrong type', async () => {
            const invalidData = { name: 'John', age: 'thirty' };
            const result = await validator.validate(invalidData, testSchemaPath);
            
            assert.strictEqual(result.valid, false);
            assert.ok(result.errors.some(e => e.includes('must be number')));
        });

        test('should detect value below minimum', async () => {
            const invalidData = { name: 'John', age: -5 };
            const result = await validator.validate(invalidData, testSchemaPath);
            
            assert.strictEqual(result.valid, false);
            assert.ok(result.errors.length > 0);
        });
    });

    suite('Collection Validation', () => {
        test('should validate valid collection', async function() {
            // Skip if schema doesn't exist yet
            if (!fs.existsSync(testCollectionSchemaPath)) {
                this.skip();
                return;
            }

            const result = await validator.validateCollection(validCollection);
            
            assert.strictEqual(result.valid, true);
            assert.strictEqual(result.errors.length, 0);
        });

        test('should validate minimal valid collection', async function() {
            if (!fs.existsSync(testCollectionSchemaPath)) {
                this.skip();
                return;
            }

            const result = await validator.validateCollection(minimalCollection);
            
            assert.strictEqual(result.valid, true);
            assert.strictEqual(result.errors.length, 0);
        });

        test('should detect missing required fields in collection', async function() {
            if (!fs.existsSync(testCollectionSchemaPath)) {
                this.skip();
                return;
            }

            const invalidCollection = {
                id: 'test',
                name: 'Test'
                // missing description and items
            };

            const result = await validator.validateCollection(invalidCollection);
            
            assert.strictEqual(result.valid, false);
            assert.ok(result.errors.some(e => e.includes('description')));
        });

        test('should detect invalid id format', async function() {
            if (!fs.existsSync(testCollectionSchemaPath)) {
                this.skip();
                return;
            }

            const invalidCollection = {
                id: 'Invalid_ID_With_Caps',
                name: 'Test',
                description: 'Test description',
                items: []
            };

            const result = await validator.validateCollection(invalidCollection);
            
            assert.strictEqual(result.valid, false);
            assert.ok(result.errors.some(e => e.includes('pattern') || e.includes('id')));
        });

        test('should detect invalid item kind', async function() {
            if (!fs.existsSync(testCollectionSchemaPath)) {
                this.skip();
                return;
            }

            const invalidCollection = {
                id: 'test-collection',
                name: 'Test',
                description: 'Test description',
                items: [
                    { path: 'test.txt', kind: 'invalid-kind' }
                ]
            };

            const result = await validator.validateCollection(invalidCollection);
            
            assert.strictEqual(result.valid, false);
            assert.ok(result.errors.some(e => e.includes('allowed values') || e.includes('enum')));
        });

        test('should detect description too long', async function() {
            if (!fs.existsSync(testCollectionSchemaPath)) {
                this.skip();
                return;
            }

            const invalidCollection = {
                id: 'test-collection',
                name: 'Test',
                description: 'x'.repeat(600), // Over 500 limit
                items: []
            };

            const result = await validator.validateCollection(invalidCollection);
            
            assert.strictEqual(result.valid, false);
            assert.ok(result.errors.some(e => e.includes('maximum') || e.includes('500')));
        });
    });

        test('should validate collection with valid MCP configuration', async function() {
            if (!fs.existsSync(testCollectionSchemaPath)) {
                this.skip();
                return;
            }

            const collectionWithMcp = {
                id: 'test-mcp-collection',
                name: 'Test MCP Collection',
                description: 'Collection with MCP servers',
                items: [
                    { path: 'prompts/test.md', kind: 'prompt' }
                ],
                mcp: {
                    items: {
                        'time-server': {
                            command: 'npx',
                            args: ['-y', '@modelcontextprotocol/server-sequential-thinking']
                        },
                        'custom-server': {
                            command: 'node',
                            args: ['${bundlePath}/server.js'],
                            env: {
                                LOG_LEVEL: 'debug'
                            },
                            disabled: false
                        }
                    }
                }
            };

            const result = await validator.validateCollection(collectionWithMcp);
            
            assert.strictEqual(result.valid, true, `Validation failed: ${result.errors.join(', ')}`);
            assert.strictEqual(result.errors.length, 0);
        });

        test('should detect MCP server missing required command', async function() {
            if (!fs.existsSync(testCollectionSchemaPath)) {
                this.skip();
                return;
            }

            const invalidMcpCollection = {
                id: 'test-invalid-mcp',
                name: 'Invalid MCP Collection',
                description: 'Collection with invalid MCP config',
                items: [],
                mcp: {
                    items: {
                        'invalid-server': {
                            // Missing required 'command' field
                            args: ['some-arg']
                        }
                    }
                }
            };

            const result = await validator.validateCollection(invalidMcpCollection);
            
            assert.strictEqual(result.valid, false);
            assert.ok(result.errors.some(e => e.includes('command')));
        });

        test('should validate MCP with environment variables', async function() {
            if (!fs.existsSync(testCollectionSchemaPath)) {
                this.skip();
                return;
            }

            const mcpWithEnv = {
                id: 'test-mcp-env',
                name: 'MCP with Environment',
                description: 'Collection with MCP env variables',
                items: [],
                mcp: {
                    items: {
                        'github-server': {
                            command: 'npx',
                            args: ['-y', '@modelcontextprotocol/server-github'],
                            env: {
                                GITHUB_TOKEN: '${env:GITHUB_TOKEN}',
                                LOG_LEVEL: 'info'
                            }
                        }
                    }
                }
            };

            const result = await validator.validateCollection(mcpWithEnv);
            
            assert.strictEqual(result.valid, true, `Validation failed: ${result.errors.join(', ')}`);
        });

        test('should validate MCP with variable substitution in args', async function() {
            if (!fs.existsSync(testCollectionSchemaPath)) {
                this.skip();
                return;
            }

            const mcpWithVariables = {
                id: 'test-mcp-vars',
                name: 'MCP with Variables',
                description: 'Collection with variable substitution',
                items: [],
                mcp: {
                    items: {
                        'custom': {
                            command: 'node',
                            args: [
                                '${bundlePath}/server.js',
                                '--id',
                                '${bundleId}',
                                '--version',
                                '${bundleVersion}'
                            ]
                        }
                    }
                }
            };

            const result = await validator.validateCollection(mcpWithVariables);
            
            assert.strictEqual(result.valid, true, `Validation failed: ${result.errors.join(', ')}`);
        });

        test('should allow collection without MCP (optional)', async function() {
            if (!fs.existsSync(testCollectionSchemaPath)) {
                this.skip();
                return;
            }

            const collectionWithoutMcp = {
                id: 'test-no-mcp',
                name: 'No MCP Collection',
                description: 'Collection without MCP servers',
                items: [
                    { path: 'prompts/test.md', kind: 'prompt' }
                ]
            };

            const result = await validator.validateCollection(collectionWithoutMcp);
            
            assert.strictEqual(result.valid, true, `Validation failed: ${result.errors.join(', ')}`);
        });

        test('should validate collection with valid MCP configuration', async function() {
            if (!fs.existsSync(testCollectionSchemaPath)) {
                this.skip();
                return;
            }

            const collectionWithMcp = {
                id: 'test-mcp-collection',
                name: 'Test MCP Collection',
                description: 'Collection with MCP servers',
                items: [
                    { path: 'prompts/test.md', kind: 'prompt' }
                ],
                mcp: {
                    items: {
                        'time-server': {
                            command: 'npx',
                            args: ['-y', '@modelcontextprotocol/server-sequential-thinking']
                        },
                        'custom-server': {
                            command: 'node',
                            args: ['${bundlePath}/server.js'],
                            env: {
                                LOG_LEVEL: 'debug'
                            },
                            disabled: false
                        }
                    }
                }
            };

            const result = await validator.validateCollection(collectionWithMcp);
            
            assert.strictEqual(result.valid, true, `Validation failed: ${result.errors.join(', ')}`);
            assert.strictEqual(result.errors.length, 0);
        });

        test('should detect MCP server missing required command', async function() {
            if (!fs.existsSync(testCollectionSchemaPath)) {
                this.skip();
                return;
            }

            const invalidMcpCollection = {
                id: 'test-invalid-mcp',
                name: 'Invalid MCP Collection',
                description: 'Collection with invalid MCP config',
                items: [],
                mcp: {
                    items: {
                        'invalid-server': {
                            // Missing required 'command' field
                            args: ['some-arg']
                        }
                    }
                }
            };

            const result = await validator.validateCollection(invalidMcpCollection);
            
            assert.strictEqual(result.valid, false);
            assert.ok(result.errors.some(e => e.includes('command')));
        });

        test('should validate MCP with environment variables', async function() {
            if (!fs.existsSync(testCollectionSchemaPath)) {
                this.skip();
                return;
            }

            const mcpWithEnv = {
                id: 'test-mcp-env',
                name: 'MCP with Environment',
                description: 'Collection with MCP env variables',
                items: [],
                mcp: {
                    items: {
                        'github-server': {
                            command: 'npx',
                            args: ['-y', '@modelcontextprotocol/server-github'],
                            env: {
                                GITHUB_TOKEN: '${env:GITHUB_TOKEN}',
                                LOG_LEVEL: 'info'
                            }
                        }
                    }
                }
            };

            const result = await validator.validateCollection(mcpWithEnv);
            
            assert.strictEqual(result.valid, true, `Validation failed: ${result.errors.join(', ')}`);
        });

        test('should validate MCP with variable substitution in args', async function() {
            if (!fs.existsSync(testCollectionSchemaPath)) {
                this.skip();
                return;
            }

            const mcpWithVariables = {
                id: 'test-mcp-vars',
                name: 'MCP with Variables',
                description: 'Collection with variable substitution',
                items: [],
                mcp: {
                    items: {
                        'custom': {
                            command: 'node',
                            args: [
                                '${bundlePath}/server.js',
                                '--id',
                                '${bundleId}',
                                '--version',
                                '${bundleVersion}'
                            ]
                        }
                    }
                }
            };

            const result = await validator.validateCollection(mcpWithVariables);
            
            assert.strictEqual(result.valid, true, `Validation failed: ${result.errors.join(', ')}`);
        });

        test('should allow collection without MCP (optional)', async function() {
            if (!fs.existsSync(testCollectionSchemaPath)) {
                this.skip();
                return;
            }

            const collectionWithoutMcp = {
                id: 'test-no-mcp',
                name: 'No MCP Collection',
                description: 'Collection without MCP servers',
                items: [
                    { path: 'prompts/test.md', kind: 'prompt' }
                ]
            };

            const result = await validator.validateCollection(collectionWithoutMcp);
            
            assert.strictEqual(result.valid, true, `Validation failed: ${result.errors.join(', ')}`);
        });

        test('should validate collection with valid MCP configuration', async function() {
            if (!fs.existsSync(testCollectionSchemaPath)) {
                this.skip();
                return;
            }

            const collectionWithMcp = {
                id: 'test-mcp-collection',
                name: 'Test MCP Collection',
                description: 'Collection with MCP servers',
                items: [
                    { path: 'prompts/test.md', kind: 'prompt' }
                ],
                mcp: {
                    items: {
                        'time-server': {
                            command: 'npx',
                            args: ['-y', '@modelcontextprotocol/server-sequential-thinking']
                        },
                        'custom-server': {
                            command: 'node',
                            args: ['${bundlePath}/server.js'],
                            env: {
                                LOG_LEVEL: 'debug'
                            },
                            disabled: false
                        }
                    }
                }
            };

            const result = await validator.validateCollection(collectionWithMcp);
            
            assert.strictEqual(result.valid, true, `Validation failed: ${result.errors.join(', ')}`);
            assert.strictEqual(result.errors.length, 0);
        });

        test('should detect MCP server missing required command', async function() {
            if (!fs.existsSync(testCollectionSchemaPath)) {
                this.skip();
                return;
            }

            const invalidMcpCollection = {
                id: 'test-invalid-mcp',
                name: 'Invalid MCP Collection',
                description: 'Collection with invalid MCP config',
                items: [],
                mcp: {
                    items: {
                        'invalid-server': {
                            // Missing required 'command' field
                            args: ['some-arg']
                        }
                    }
                }
            };

            const result = await validator.validateCollection(invalidMcpCollection);
            
            assert.strictEqual(result.valid, false);
            assert.ok(result.errors.some(e => e.includes('command')));
        });

        test('should validate MCP with environment variables', async function() {
            if (!fs.existsSync(testCollectionSchemaPath)) {
                this.skip();
                return;
            }

            const mcpWithEnv = {
                id: 'test-mcp-env',
                name: 'MCP with Environment',
                description: 'Collection with MCP env variables',
                items: [],
                mcp: {
                    items: {
                        'github-server': {
                            command: 'npx',
                            args: ['-y', '@modelcontextprotocol/server-github'],
                            env: {
                                GITHUB_TOKEN: '${env:GITHUB_TOKEN}',
                                LOG_LEVEL: 'info'
                            }
                        }
                    }
                }
            };

            const result = await validator.validateCollection(mcpWithEnv);
            
            assert.strictEqual(result.valid, true, `Validation failed: ${result.errors.join(', ')}`);
        });

        test('should validate MCP with variable substitution in args', async function() {
            if (!fs.existsSync(testCollectionSchemaPath)) {
                this.skip();
                return;
            }

            const mcpWithVariables = {
                id: 'test-mcp-vars',
                name: 'MCP with Variables',
                description: 'Collection with variable substitution',
                items: [],
                mcp: {
                    items: {
                        'custom': {
                            command: 'node',
                            args: [
                                '${bundlePath}/server.js',
                                '--id',
                                '${bundleId}',
                                '--version',
                                '${bundleVersion}'
                            ]
                        }
                    }
                }
            };

            const result = await validator.validateCollection(mcpWithVariables);
            
            assert.strictEqual(result.valid, true, `Validation failed: ${result.errors.join(', ')}`);
        });

        test('should allow collection without MCP (optional)', async function() {
            if (!fs.existsSync(testCollectionSchemaPath)) {
                this.skip();
                return;
            }

            const collectionWithoutMcp = {
                id: 'test-no-mcp',
                name: 'No MCP Collection',
                description: 'Collection without MCP servers',
                items: [
                    { path: 'prompts/test.md', kind: 'prompt' }
                ]
            };

            const result = await validator.validateCollection(collectionWithoutMcp);
            
            assert.strictEqual(result.valid, true, `Validation failed: ${result.errors.join(', ')}`);
        });

    suite('Error Formatting', () => {
        test('should format required field errors', async () => {
            const result = await validator.validate({}, testSchemaPath);
            
            assert.ok(result.errors.some(e => e.includes('Missing required field: name')));
        });

        test('should format type errors', async () => {
            const result = await validator.validate({ name: 123 }, testSchemaPath);
            
            assert.ok(result.errors.some(e => e.includes('must be string')));
        });

        test('should format minLength errors', async () => {
            const result = await validator.validate({ name: '' }, testSchemaPath);
            
            assert.ok(result.errors.some(e => e.includes('minimum 1 characters')));
        });
    });

    suite('File Reference Validation', () => {
        test('should not check file references by default', async function() {
            if (!fs.existsSync(testCollectionSchemaPath)) {
                this.skip();
                return;
            }

            const collectionWithRefs = {
                id: 'test',
                name: 'Test',
                description: 'Test',
                items: [
                    { path: 'nonexistent.txt', kind: 'prompt' }
                ]
            };

            const result = await validator.validateCollection(collectionWithRefs);
            
            // Should be valid (schema-wise) even if files don't exist
            assert.strictEqual(result.valid, true);
            // Should not have file reference errors
            assert.ok(!result.errors.some(e => e.includes('not found')));
        });

        test('should check file references when option enabled', async function() {
            if (!fs.existsSync(testCollectionSchemaPath)) {
                this.skip();
                return;
            }

            const collectionWithRefs = {
                id: 'test',
                name: 'Test',
                description: 'Test',
                items: [
                    { path: 'nonexistent.txt', kind: 'prompt' }
                ]
            };

            const result = await validator.validateCollection(collectionWithRefs, {
                checkFileReferences: true,
                workspaceRoot: tempDir
            });
            
            // Should have file reference errors
            assert.ok(result.errors.some(e => e.includes('not found')));
        });

        test('should pass when referenced files exist', async function() {
            if (!fs.existsSync(testCollectionSchemaPath)) {
                this.skip();
                return;
            }

            // Create test file
            const testFilePath = path.join(tempDir, 'exists.txt');
            fs.writeFileSync(testFilePath, 'test content');

            const collectionWithRefs = {
                id: 'test',
                name: 'Test',
                description: 'Test',
                items: [
                    { path: 'exists.txt', kind: 'prompt' }
                ]
            };

            const result = await validator.validateCollection(collectionWithRefs, {
                checkFileReferences: true,
                workspaceRoot: tempDir
            });
            
            // Should not have file reference errors
            assert.ok(!result.errors.some(e => e.includes('not found')));
        });
    });

    suite('Warning Generation', () => {
        test('should warn about long descriptions', async function() {
            if (!fs.existsSync(testCollectionSchemaPath)) {
                this.skip();
                return;
            }

            const collection = {
                id: 'test',
                name: 'Test',
                description: 'x'.repeat(350), // Over 300 but under 500
                items: []
            };

            const result = await validator.validateCollection(collection);
            
            assert.ok(result.warnings.some(w => w.includes('quite long')));
        });

        test('should warn about empty collections', async function() {
            if (!fs.existsSync(testCollectionSchemaPath)) {
                this.skip();
                return;
            }

            const result = await validator.validateCollection(minimalCollection);
            
            assert.ok(result.warnings.some(w => w.includes('no items')));
        });

        test('should warn about too many items', async function() {
            if (!fs.existsSync(testCollectionSchemaPath)) {
                this.skip();
                return;
            }

            const manyItems = Array.from({ length: 35 }, (_, i) => ({
                path: `item${i}.txt`,
                kind: 'prompt' as const
            }));

            const collection = {
                id: 'test',
                name: 'Test',
                description: 'Test',
                items: manyItems
            };

            const result = await validator.validateCollection(collection);
            
            assert.ok(result.warnings.some(w => w.includes('many items')));
        });

        test('should warn about missing version', async function() {
            if (!fs.existsSync(testCollectionSchemaPath)) {
                this.skip();
                return;
            }

            const result = await validator.validateCollection(minimalCollection);
            
            assert.ok(result.warnings.some(w => w.includes('version')));
        });

        test('should warn about missing author', async function() {
            if (!fs.existsSync(testCollectionSchemaPath)) {
                this.skip();
                return;
            }

            const result = await validator.validateCollection(minimalCollection);
            
            assert.ok(result.warnings.some(w => w.includes('author')));
        });

        test('should not warn when metadata is complete', async function() {
            if (!fs.existsSync(testCollectionSchemaPath)) {
                this.skip();
                return;
            }

            const result = await validator.validateCollection(validCollection);
            
            // Should have minimal warnings (only about empty items if any)
            const metadataWarnings = result.warnings.filter(w => 
                w.includes('version') || w.includes('author')
            );
            assert.strictEqual(metadataWarnings.length, 0);
        });
    });

    suite('Cache Management', () => {
        test('should clear cache', async () => {
            // Load schema
            await validator.validate({ name: 'Test' }, testSchemaPath);
            
            // Clear cache
            validator.clearCache();
            
            // Should still work after clearing
            const result = await validator.validate({ name: 'Test' }, testSchemaPath);
            assert.strictEqual(result.valid, true);
        });

        test('should reload schema after cache clear', async () => {
            // Load schema
            await validator.validate({ name: 'Test' }, testSchemaPath);
            
            // Modify schema file
            const modifiedSchema = {
                "$schema": "http://json-schema.org/draft-07/schema#",
                "type": "object",
                "required": ["name", "email"],
                "properties": {
                    "name": { "type": "string" },
                    "email": { "type": "string" }
                }
            };
            fs.writeFileSync(testSchemaPath, JSON.stringify(modifiedSchema, null, 2));
            
            // Clear cache to force reload
            validator.clearCache();
            
            // Validate with new schema
            const result = await validator.validate({ name: 'Test' }, testSchemaPath);
            
            // Should fail because email is now required
            assert.strictEqual(result.valid, false);
            assert.ok(result.errors.some(e => e.includes('email')));
        });
    });

    suite('Hub Validation', () => {
        const validHubConfig = {
            version: '1.0.0',
            metadata: {
                name: 'Test Hub',
                description: 'A test hub configuration',
                maintainer: 'Test Maintainer',
                updatedAt: '2025-12-16T00:00:00Z'
            },
            sources: [
                {
                    id: 'github-source',
                    type: 'github',
                    repository: 'test/repo',
                    branch: 'main',
                    enabled: true,
                    priority: 100
                }
            ],
            profiles: [
                {
                    id: 'default',
                    name: 'Default Profile',
                    description: 'Test profile description',
                    active: true,
                    bundles: [
                        {
                            id: 'test-bundle',
                            version: '1.0.0',
                            source: 'github-source',
                            required: true
                        }
                    ]
                }
            ]
        };

        test('should validate valid hub configuration', async function() {
            const hubSchemaPath = path.join(process.cwd(), 'schemas', 'hub-config.schema.json');
            
            if (!fs.existsSync(hubSchemaPath)) {
                this.skip();
                return;
            }

            const result = await validator.validateHub(validHubConfig);
            
            if (!result.valid) {
                console.log('Validation errors:', result.errors);
                console.log('Validation warnings:', result.warnings);
            }
            
            assert.strictEqual(result.valid, true, 'Valid hub should pass validation');
            assert.strictEqual(result.errors.length, 0, 'Should have no errors');
        });

        test('should warn about disabled high-priority sources', async function() {
            const hubSchemaPath = path.join(process.cwd(), 'schemas', 'hub-config.schema.json');
            
            if (!fs.existsSync(hubSchemaPath)) {
                this.skip();
                return;
            }

            const hubWithDisabledHighPriority = {
                ...validHubConfig,
                sources: [
                    {
                        id: 'disabled-source',
                        type: 'github',
                        enabled: false,
                        priority: 90
                    }
                ]
            };

            const result = await validator.validateHub(hubWithDisabledHighPriority);
            
            assert.ok(result.warnings.some(w => w.includes('High priority sources are disabled')), 
                'Should warn about disabled high-priority sources');
            assert.ok(result.warnings.some(w => w.includes('disabled-source')), 
                'Warning should mention the source ID');
        });

        test('should warn about very long hub description', async function() {
            const hubSchemaPath = path.join(process.cwd(), 'schemas', 'hub-config.schema.json');
            
            if (!fs.existsSync(hubSchemaPath)) {
                this.skip();
                return;
            }

            const hubWithLongDescription = {
                ...validHubConfig,
                metadata: {
                    name: 'Test Hub',
                    description: 'A'.repeat(600)
                }
            };

            const result = await validator.validateHub(hubWithLongDescription);
            
            assert.ok(result.warnings.some(w => w.includes('description is very long')), 
                'Should warn about very long description');
        });

        test('should warn about multiple active profiles', async function() {
            const hubSchemaPath = path.join(process.cwd(), 'schemas', 'hub-config.schema.json');
            
            if (!fs.existsSync(hubSchemaPath)) {
                this.skip();
                return;
            }

            const hubWithMultipleActive = {
                ...validHubConfig,
                profiles: [
                    {
                        id: 'profile1',
                        name: 'Profile 1',
                        active: true,
                        bundles: []
                    },
                    {
                        id: 'profile2',
                        name: 'Profile 2',
                        active: true,
                        bundles: []
                    }
                ]
            };

            const result = await validator.validateHub(hubWithMultipleActive);
            
            assert.ok(result.warnings.some(w => w.includes('Multiple profiles are marked as active')), 
                'Should warn about multiple active profiles');
            assert.ok(result.warnings.some(w => w.includes('profile1') && w.includes('profile2')), 
                'Warning should list the active profile IDs');
        });

        test('should warn about very long hub name', async function() {
            const hubSchemaPath = path.join(process.cwd(), 'schemas', 'hub-config.schema.json');
            
            if (!fs.existsSync(hubSchemaPath)) {
                this.skip();
                return;
            }

            const hubWithLongName = {
                ...validHubConfig,
                metadata: {
                    name: 'A'.repeat(101),
                    description: 'Test description'
                }
            };

            const result = await validator.validateHub(hubWithLongName);
            
            assert.ok(result.warnings.some(w => w.includes('Hub name is at maximum length')), 
                'Should warn about very long hub name');
        });

        test('should not warn for hub with enabled low-priority sources', async function() {
            const hubSchemaPath = path.join(process.cwd(), 'schemas', 'hub-config.schema.json');
            
            if (!fs.existsSync(hubSchemaPath)) {
                this.skip();
                return;
            }

            const hubWithEnabledLowPriority = {
                ...validHubConfig,
                sources: [
                    {
                        id: 'low-priority-source',
                        type: 'github',
                        enabled: true,
                        priority: 50
                    }
                ]
            };

            const result = await validator.validateHub(hubWithEnabledLowPriority);
            
            const priorityWarnings = result.warnings.filter(w => w.includes('priority'));
            assert.strictEqual(priorityWarnings.length, 0, 
                'Should not warn about enabled low-priority sources');
        });

        test('should not warn about disabled low-priority sources', async function() {
            const hubSchemaPath = path.join(process.cwd(), 'schemas', 'hub-config.schema.json');
            
            if (!fs.existsSync(hubSchemaPath)) {
                this.skip();
                return;
            }

            const hubWithDisabledLowPriority = {
                ...validHubConfig,
                sources: [
                    {
                        id: 'low-priority-source',
                        type: 'github',
                        enabled: false,
                        priority: 50
                    }
                ]
            };

            const result = await validator.validateHub(hubWithDisabledLowPriority);
            
            const priorityWarnings = result.warnings.filter(w => w.includes('High priority'));
            assert.strictEqual(priorityWarnings.length, 0, 
                'Should not warn about disabled low-priority sources');
        });

        test('should handle hub with no sources', async function() {
            const hubSchemaPath = path.join(process.cwd(), 'schemas', 'hub-config.schema.json');
            
            if (!fs.existsSync(hubSchemaPath)) {
                this.skip();
                return;
            }

            const hubWithNoSources = {
                ...validHubConfig,
                sources: []
            };

            const result = await validator.validateHub(hubWithNoSources);
            
            // Should not crash, may have schema errors
            assert.ok(result, 'Should return a result');
        });

        test('should handle hub with no profiles', async function() {
            const hubSchemaPath = path.join(process.cwd(), 'schemas', 'hub-config.schema.json');
            
            if (!fs.existsSync(hubSchemaPath)) {
                this.skip();
                return;
            }

            const hubWithNoProfiles = {
                ...validHubConfig,
                profiles: []
            };

            const result = await validator.validateHub(hubWithNoProfiles);
            
            // Should not crash, may have schema errors
            assert.ok(result, 'Should return a result');
        });

        test('should handle hub with single active profile', async function() {
            const hubSchemaPath = path.join(process.cwd(), 'schemas', 'hub-config.schema.json');
            
            if (!fs.existsSync(hubSchemaPath)) {
                this.skip();
                return;
            }

            const result = await validator.validateHub(validHubConfig);
            
            const multipleActiveWarnings = result.warnings.filter(w => w.includes('Multiple profiles'));
            assert.strictEqual(multipleActiveWarnings.length, 0, 
                'Should not warn about single active profile');
        });
    });
});

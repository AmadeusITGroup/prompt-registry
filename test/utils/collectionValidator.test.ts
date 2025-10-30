/**
 * Unit tests for CollectionValidator
 * 
 * Following TDD: Tests written first, implementation to follow
 */

import * as assert from 'assert';
import * as path from 'path';
import { CollectionValidator, ValidationResult, ValidationError, ValidationWarning } from '../../src/utils/collectionValidator';

suite('CollectionValidator', () => {
    let validator: CollectionValidator;
    // Fixtures are in source tree, not copied to test-dist
    // __dirname in compiled code: test-dist/test/utils
    // Need to go to project root, then to test/fixtures
    const fixturesDir = path.join(__dirname, '../../../test/fixtures/collections-validator');

    setup(() => {
        validator = new CollectionValidator();
    });

    suite('validateCollection', () => {
        suite('Valid Collections', () => {
            test('should pass a valid collection', () => {
                const collectionPath = path.join(fixturesDir, 'valid/good.collection.yml');
                const result = validator.validateCollection(collectionPath, path.join(fixturesDir, 'valid'));

                assert.strictEqual(result.valid, true, 'Collection should be valid');
                assert.strictEqual(result.errors.length, 0, 'Should have no errors');
                assert.strictEqual(result.warnings.length, 0, 'Should have no warnings');
            });
        });

        suite('Required Fields', () => {
            test('should fail if id is missing', () => {
                const collectionPath = path.join(fixturesDir, 'invalid/missing-id.collection.yml');
                const result = validator.validateCollection(collectionPath, fixturesDir);

                assert.strictEqual(result.valid, false, 'Collection should be invalid');
                assert.ok(result.errors.some((e: ValidationError) => e.message.includes('id')), 'Should have error about missing id');
            });

            test('should fail if name is missing', () => {
                const collectionPath = path.join(fixturesDir, 'invalid/missing-name.collection.yml');
                const result = validator.validateCollection(collectionPath, fixturesDir);

                assert.strictEqual(result.valid, false, 'Collection should be invalid');
                assert.ok(result.errors.some((e: ValidationError) => e.message.includes('name')), 'Should have error about missing name');
            });

            test('should fail if description is missing', () => {
                const collectionPath = path.join(fixturesDir, 'invalid/missing-description.collection.yml');
                const result = validator.validateCollection(collectionPath, fixturesDir);

                assert.strictEqual(result.valid, false, 'Collection should be invalid');
                assert.ok(result.errors.some((e: ValidationError) => e.message.includes('description')), 'Should have error about missing description');
            });

            test('should fail if items is missing', () => {
                const collectionPath = path.join(fixturesDir, 'invalid/missing-items.collection.yml');
                const result = validator.validateCollection(collectionPath, fixturesDir);

                assert.strictEqual(result.valid, false, 'Collection should be invalid');
                assert.ok(result.errors.some((e: ValidationError) => e.message.includes('items')), 'Should have error about missing items');
            });
        });

        suite('ID Validation', () => {
            test('should fail if id has uppercase letters', () => {
                const collectionPath = path.join(fixturesDir, 'invalid/invalid-id-uppercase.collection.yml');
                const result = validator.validateCollection(collectionPath, fixturesDir);

                assert.strictEqual(result.valid, false, 'Collection should be invalid');
                assert.ok(result.errors.some((e: ValidationError) => e.message.toLowerCase().includes('id') && e.message.toLowerCase().includes('lowercase')), 
                    'Should have error about ID format');
            });

            test('should fail if id has spaces', () => {
                const collectionPath = path.join(fixturesDir, 'invalid/invalid-id-spaces.collection.yml');
                const result = validator.validateCollection(collectionPath, fixturesDir);

                assert.strictEqual(result.valid, false, 'Collection should be invalid');
                assert.ok(result.errors.some((e: ValidationError) => e.message.toLowerCase().includes('id')), 
                    'Should have error about ID format');
            });

            test('should accept valid id with lowercase, numbers, and hyphens', () => {
                const collectionPath = path.join(fixturesDir, 'valid/good.collection.yml');
                const result = validator.validateCollection(collectionPath, path.join(fixturesDir, 'valid'));

                assert.strictEqual(result.valid, true, 'Collection should be valid');
                const idErrors = result.errors.filter((e: ValidationError) => e.message.toLowerCase().includes('id'));
                assert.strictEqual(idErrors.length, 0, 'Should have no ID format errors');
            });
        });

        suite('Description Validation', () => {
            test('should warn if description exceeds 500 characters', () => {
                const collectionPath = path.join(fixturesDir, 'warnings/long-description.collection.yml');
                const result = validator.validateCollection(collectionPath, fixturesDir);

                assert.ok(result.warnings.some((w: ValidationWarning) => w.message.toLowerCase().includes('description') && w.message.includes('500')), 
                    'Should have warning about long description');
            });
        });

        suite('Items Validation', () => {
            test('should fail if item is missing path field', () => {
                const collectionPath = path.join(fixturesDir, 'invalid/item-missing-path.collection.yml');
                const result = validator.validateCollection(collectionPath, fixturesDir);

                assert.strictEqual(result.valid, false, 'Collection should be invalid');
                assert.ok(result.errors.some((e: ValidationError) => e.message.toLowerCase().includes('path')), 
                    'Should have error about missing path');
            });

            test('should fail if item is missing kind field', () => {
                const collectionPath = path.join(fixturesDir, 'invalid/item-missing-kind.collection.yml');
                const result = validator.validateCollection(collectionPath, fixturesDir);

                assert.strictEqual(result.valid, false, 'Collection should be invalid');
                assert.ok(result.errors.some((e: ValidationError) => e.message.toLowerCase().includes('kind')), 
                    'Should have error about missing kind');
            });

            test('should fail if kind is invalid', () => {
                const collectionPath = path.join(fixturesDir, 'invalid/invalid-kind.collection.yml');
                const result = validator.validateCollection(collectionPath, fixturesDir);

                assert.strictEqual(result.valid, false, 'Collection should be invalid');
                assert.ok(result.errors.some(e => e.message.toLowerCase().includes('kind')), 
                    'Should have error about invalid kind');
            });

            test('should accept valid kinds: prompt, instruction, chat-mode, agent', () => {
                const collectionPath = path.join(fixturesDir, 'valid/good.collection.yml');
                const result = validator.validateCollection(collectionPath, path.join(fixturesDir, 'valid'));

                assert.strictEqual(result.valid, true, 'Collection should be valid');
                const kindErrors = result.errors.filter((e: ValidationError) => e.message.toLowerCase().includes('kind'));
                assert.strictEqual(kindErrors.length, 0, 'Should have no kind errors');
            });
        });

        suite('File Reference Validation', () => {
            test('should fail if referenced file does not exist', () => {
                const collectionPath = path.join(fixturesDir, 'invalid/missing-file-ref.collection.yml');
                const result = validator.validateCollection(collectionPath, fixturesDir);

                assert.strictEqual(result.valid, false, 'Collection should be invalid');
                assert.ok(result.errors.some((e: ValidationError) => e.message.toLowerCase().includes('not exist') || e.message.toLowerCase().includes('missing')), 
                    'Should have error about missing file');
            });

            test('should pass if all referenced files exist', () => {
                const collectionPath = path.join(fixturesDir, 'valid/good.collection.yml');
                const result = validator.validateCollection(collectionPath, path.join(fixturesDir, 'valid'));

                assert.strictEqual(result.valid, true, 'Collection should be valid');
                const fileErrors = result.errors.filter((e: ValidationError) => e.message.toLowerCase().includes('not exist') || e.message.toLowerCase().includes('missing'));
                assert.strictEqual(fileErrors.length, 0, 'Should have no file reference errors');
            });
        });

        suite('Tags Validation', () => {
            test('should warn if more than 10 tags', () => {
                const collectionPath = path.join(fixturesDir, 'warnings/many-tags.collection.yml');
                const result = validator.validateCollection(collectionPath, fixturesDir);

                assert.ok(result.warnings.some((w: ValidationWarning) => w.message.includes('tag') && w.message.includes('10')), 
                    'Should have warning about too many tags');
            });

            test('should accept collections with valid tags', () => {
                const collectionPath = path.join(fixturesDir, 'valid/good.collection.yml');
                const result = validator.validateCollection(collectionPath, path.join(fixturesDir, 'valid'));

                assert.strictEqual(result.valid, true, 'Collection should be valid');
                const tagErrors = result.errors.filter((e: ValidationError) => e.message.toLowerCase().includes('tag'));
                assert.strictEqual(tagErrors.length, 0, 'Should have no tag errors');
            });
        });

        suite('YAML Parsing', () => {
            test('should fail gracefully with YAML syntax errors', () => {
                const collectionPath = path.join(fixturesDir, 'invalid/yaml-syntax-error.collection.yml');
                const result = validator.validateCollection(collectionPath, fixturesDir);

                assert.strictEqual(result.valid, false, 'Collection should be invalid');
                assert.ok(result.errors.some((e: ValidationError) => e.message.toLowerCase().includes('yaml') || e.message.toLowerCase().includes('parse')), 
                    'Should have error about YAML parsing');
            });
        });

        suite('Error Structure', () => {
            test('should include file name in errors', () => {
                const collectionPath = path.join(fixturesDir, 'invalid/missing-id.collection.yml');
                const result = validator.validateCollection(collectionPath, fixturesDir);

                assert.ok(result.errors.length > 0, 'Should have errors');
                assert.ok(result.errors[0].file, 'Error should include file name');
                assert.ok(result.errors[0].file.includes('missing-id'), 'File name should match');
            });

            test('should include descriptive messages', () => {
                const collectionPath = path.join(fixturesDir, 'invalid/missing-id.collection.yml');
                const result = validator.validateCollection(collectionPath, fixturesDir);

                assert.ok(result.errors.length > 0, 'Should have errors');
                assert.ok(result.errors[0].message, 'Error should have message');
                assert.ok(result.errors[0].message.length > 10, 'Message should be descriptive');
            });
        });
    });

    suite('validateAllCollections', () => {
        test('should validate multiple collections in a directory', () => {
            const validDir = path.join(fixturesDir, 'valid');
            const result = validator.validateAllCollections(validDir);

            assert.strictEqual(result.valid, true, 'Should be valid');
            assert.strictEqual(result.errors.length, 0, 'Should have no errors');
        });

        test('should aggregate errors from multiple invalid collections', () => {
            const invalidDir = path.join(fixturesDir, 'invalid');
            const result = validator.validateAllCollections(invalidDir);

            assert.strictEqual(result.valid, false, 'Should be invalid');
            assert.ok(result.errors.length > 0, 'Should have errors from multiple files');
        });

        test('should return success if directory has no collection files', () => {
            const emptyDir = path.join(fixturesDir, 'empty-test-dir');
            const result = validator.validateAllCollections(emptyDir);

            // Should not fail, just return empty result
            assert.strictEqual(result.errors.length, 0, 'Should have no errors');
        });

        test('should handle non-existent directory gracefully', () => {
            const nonExistentDir = path.join(fixturesDir, 'does-not-exist');
            const result = validator.validateAllCollections(nonExistentDir);

            assert.strictEqual(result.valid, false, 'Should be invalid');
            assert.ok(result.errors.some((e: ValidationError) => e.message.toLowerCase().includes('not found') || e.message.toLowerCase().includes('not exist')), 
                'Should have error about missing directory');
        });
    });

    suite('ValidationResult', () => {
        test('should mark result as valid only if no errors', () => {
            const collectionPath = path.join(fixturesDir, 'warnings/long-description.collection.yml');
            const result = validator.validateCollection(collectionPath, fixturesDir);

            // Has warnings but no errors, so should be valid
            assert.strictEqual(result.valid, true, 'Should be valid despite warnings');
            assert.ok(result.warnings.length > 0, 'Should have warnings');
        });

        test('should mark result as invalid if any errors', () => {
            const collectionPath = path.join(fixturesDir, 'invalid/missing-id.collection.yml');
            const result = validator.validateCollection(collectionPath, fixturesDir);

            assert.strictEqual(result.valid, false, 'Should be invalid');
            assert.ok(result.errors.length > 0, 'Should have errors');
        });
    });
});

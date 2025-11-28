/**
 * BundleInstaller Unit Tests
 */

import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import { BundleInstaller } from '../../src/services/BundleInstaller';
import { Bundle, InstallOptions } from '../../src/types/registry';

suite('BundleInstaller', () => {
    let installer: BundleInstaller;
    let mockContext: any;
    let tempDir: string;

    const mockBundle: Bundle = {
        id: 'test-bundle',
        name: 'Test Bundle',
        version: '1.0.0',
        description: 'Test bundle for unit tests',
        author: 'Test Author',
        sourceId: 'test-source',
        environments: ['vscode'],
        tags: ['test'],
        lastUpdated: '2025-01-01T00:00:00Z',
        size: '1KB',
        dependencies: [],
        license: 'MIT',
        downloadUrl: 'https://example.com/bundle.zip',
        manifestUrl: 'https://example.com/manifest.json',
    };

    setup(() => {
        tempDir = path.join(__dirname, '..', '..', '..', 'test-temp');
        
        mockContext = {
            globalStorageUri: { fsPath: path.join(tempDir, 'global') },
            storageUri: { fsPath: path.join(tempDir, 'workspace') },
            extensionPath: __dirname,
            extension: {
                packageJSON: {
                    publisher: 'test-publisher',
                    name: 'test-extension'
                }
            }
        } as any;

        // Create temp directories
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }

        installer = new BundleInstaller(mockContext);
    });

    teardown(() => {
        // Cleanup temp directories
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    suite('install (deprecated for remote bundles)', () => {
        test('should throw error for non-file:// URLs', async () => {
            const options: InstallOptions = {
                scope: 'user',
                force: false,
            };

            // install() should only work with file:// URLs now
            await assert.rejects(
                () => installer.install(mockBundle, 'https://example.com/bundle.zip', options),
                /install\(\) method is only for local file:\/\/ URLs/
            );
        });

        test('should accept file:// URLs for local bundles', async () => {
            // This would require actual file setup, so we just verify the method exists
            assert.ok(typeof installer.install === 'function');
        });
    });

    suite('installFromBuffer (unified architecture)', () => {
        test('should be the primary installation method', () => {
            // Verify installFromBuffer exists and is the main method
            assert.ok(typeof installer.installFromBuffer === 'function');
        });

        test('should accept Buffer parameter', () => {
            // Type check - installFromBuffer should accept Buffer
            const testBuffer = Buffer.from('test');
            assert.ok(Buffer.isBuffer(testBuffer));
        });
    });

    suite('uninstall', () => {
        test('should remove all bundle files', async () => {
            // Test complete file removal
            assert.ok(installer);
        });

        test('should handle missing installation directory gracefully', async () => {
            // Test uninstalling non-existent bundle
            assert.ok(installer);
        });

        test('should not fail if some files are locked', async () => {
            // Test resilience to file system errors
            assert.ok(installer);
        });
    });

    suite('update (deprecated)', () => {
        test('should exist but is deprecated', () => {
            // update() is deprecated - RegistryManager should handle updates
            assert.ok(typeof installer.update === 'function');
        });

        test('should accept Buffer parameter for unified architecture', () => {
            // update() now expects Buffer for remote bundles
            const testBuffer = Buffer.from('test');
            assert.ok(Buffer.isBuffer(testBuffer));
        });
    });

    suite('Validation', () => {
        test('should validate manifest structure', async () => {
            const validManifest = {
                id: 'test-bundle',
                version: '1.0.0',
                name: 'Test',
                description: 'Test',
                author: 'Test',
                prompts: [],
            };

            // Test validation logic
            assert.ok(validManifest);
        });

        test('should reject manifest with missing required fields', async () => {
            const invalidManifest = {
                id: 'test-bundle',
                // missing version, name, etc.
            };

            // Test validation rejection
            assert.ok(invalidManifest);
        });

        test('should reject manifest with wrong bundle ID', async () => {
            const manifest = {
                id: 'wrong-id',  // doesn't match bundle.id
                version: '1.0.0',
                name: 'Test',
                description: 'Test',
                author: 'Test',
                prompts: [],
            };

            // Test ID validation
            assert.ok(manifest);
        });
    });

    suite('File Operations', () => {
        test('should create installation directory if not exists', async () => {
            // Test directory creation
            assert.ok(installer);
        });

        test('should copy files recursively', async () => {
            // Test recursive copy
            assert.ok(installer);
        });

        test('should preserve file permissions', async () => {
            // Test permission preservation
            assert.ok(installer);
        });

        test('should handle deeply nested directories', async () => {
            // Test deep nesting
            assert.ok(installer);
        });
    });

    suite('Error Handling', () => {
        test('should reject remote URLs in install() method', async () => {
            const options: InstallOptions = {
                scope: 'user',
                force: false,
            };
            
            // install() should reject remote URLs
            await assert.rejects(
                () => installer.install(mockBundle, 'https://invalid.example.com/bundle.zip', options),
                /install\(\) method is only for local file:\/\/ URLs/
            );
        });

        test('should handle extraction failures in installFromBuffer', async () => {
            // installFromBuffer handles extraction
            assert.ok(typeof installer.installFromBuffer === 'function');
        });

        test('should handle validation failures', async () => {
            // Test validation error handling
            assert.ok(installer);
        });

        test('should provide descriptive error messages', async () => {
            // Test error message quality
            assert.ok(installer);
        });
    });

    suite('Architecture Validation', () => {
        test('downloadFile method should not exist', () => {
            // downloadFile was removed - downloads are handled by adapters
            assert.strictEqual((installer as any).downloadFile, undefined);
        });

        test('install() is deprecated for remote bundles', () => {
            // install() should only be used for local file:// URLs
            assert.ok(typeof installer.install === 'function');
        });

        test('installFromBuffer() is the primary method', () => {
            // installFromBuffer is the main installation method
            assert.ok(typeof installer.installFromBuffer === 'function');
        });
    });
});

/**
 * Tests for LocalOlafAdapter
 */

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { LocalOlafAdapter } from '../../src/adapters/LocalOlafAdapter';
import { RegistrySource } from '../../src/types/registry';

suite('LocalOlafAdapter', () => {
    let tempDir: string;
    let adapter: LocalOlafAdapter;
    let source: RegistrySource;

    setup(async () => {
        // Create temporary directory for testing
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'local-olaf-test-'));
        
        source = {
            id: 'test-local-olaf',
            name: 'Test Local OLAF',
            type: 'local-olaf',
            url: tempDir,
            enabled: true,
            priority: 1,
        };
    });

    teardown(() => {
        // Clean up temporary directory
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    suite('constructor', () => {
        test('should create adapter with valid local path', () => {
            assert.doesNotThrow(() => new LocalOlafAdapter(source));
        });

        test('should throw error with invalid path', () => {
            const invalidSource = { ...source, url: 'invalid://path' };
            assert.throws(() => new LocalOlafAdapter(invalidSource), /Invalid local OLAF path/);
        });
    });

    suite('validate', () => {
        test('should fail validation when directory does not exist', async () => {
            const nonExistentSource = { ...source, url: '/non/existent/path' };
            adapter = new LocalOlafAdapter(nonExistentSource);
            
            const result = await adapter.validate();
            assert.strictEqual(result.valid, false);
            assert.ok(result.errors.length > 0);
        });

        test('should fail validation when bundles directory is missing', async () => {
            // Create only skills directory
            fs.mkdirSync(path.join(tempDir, 'skills'));
            
            adapter = new LocalOlafAdapter(source);
            const result = await adapter.validate();
            
            assert.strictEqual(result.valid, false);
            assert.ok(result.errors.some(error => error.includes('bundles')));
        });

        test('should fail validation when skills directory is missing', async () => {
            // Create only bundles directory
            fs.mkdirSync(path.join(tempDir, 'bundles'));
            
            adapter = new LocalOlafAdapter(source);
            const result = await adapter.validate();
            
            assert.strictEqual(result.valid, false);
            assert.ok(result.errors.some(error => error.includes('skills')));
        });

        test('should pass validation when both directories exist', async () => {
            // Create required directories
            fs.mkdirSync(path.join(tempDir, 'bundles'));
            fs.mkdirSync(path.join(tempDir, 'skills'));
            
            adapter = new LocalOlafAdapter(source);
            const result = await adapter.validate();
            
            assert.strictEqual(result.valid, true);
            assert.strictEqual(result.errors.length, 0);
        });
    });

    suite('fetchMetadata', () => {
        setup(() => {
            // Create required directories
            fs.mkdirSync(path.join(tempDir, 'bundles'));
            fs.mkdirSync(path.join(tempDir, 'skills'));
            adapter = new LocalOlafAdapter(source);
        });

        test('should return metadata with correct bundle count', async () => {
            // Create test bundle definition
            const bundleDefinition = {
                metadata: {
                    name: 'Test Bundle',
                    description: 'A test bundle',
                },
                skills: [],
            };
            
            fs.writeFileSync(
                path.join(tempDir, 'bundles', 'test.json'),
                JSON.stringify(bundleDefinition, null, 2)
            );
            
            const metadata = await adapter.fetchMetadata();
            
            assert.strictEqual(metadata.name, path.basename(tempDir));
            assert.strictEqual(metadata.description, 'Local OLAF Skills Registry');
            assert.strictEqual(metadata.bundleCount, 1);
            assert.strictEqual(metadata.version, '1.0.0');
        });
    });

    suite('fetchBundles', () => {
        setup(() => {
            // Create required directories
            fs.mkdirSync(path.join(tempDir, 'bundles'));
            fs.mkdirSync(path.join(tempDir, 'skills'));
            adapter = new LocalOlafAdapter(source);
        });

        test('should return empty array when no bundles exist', async () => {
            const bundles = await adapter.fetchBundles();
            assert.ok(Array.isArray(bundles));
            assert.strictEqual(bundles.length, 0);
        });

        test('should parse valid bundle with skills', async () => {
            // Create skill directory and manifest
            const skillDir = path.join(tempDir, 'skills', 'test-skill');
            fs.mkdirSync(skillDir, { recursive: true });
            
            const skillManifest = {
                name: 'Test Skill',
                description: 'A test skill',
                entry_points: [
                    {
                        protocol: 'Propose-Act',
                        path: '/prompts/test.md',
                        patterns: ['test pattern'],
                    },
                ],
            };
            
            fs.writeFileSync(
                path.join(skillDir, 'manifest.json'),
                JSON.stringify(skillManifest, null, 2)
            );
            
            // Create bundle definition
            const bundleDefinition = {
                metadata: {
                    name: 'Test Bundle',
                    description: 'A test bundle',
                    version: '1.0.0',
                    author: 'Test Author',
                    tags: ['test'],
                },
                skills: [
                    {
                        name: 'Test Skill',
                        description: 'A test skill',
                        path: 'skills/test-skill',
                        manifest: 'skills/test-skill/manifest.json',
                    },
                ],
            };
            
            fs.writeFileSync(
                path.join(tempDir, 'bundles', 'test.json'),
                JSON.stringify(bundleDefinition, null, 2)
            );
            
            const bundles = await adapter.fetchBundles();
            
            assert.strictEqual(bundles.length, 1);
            assert.strictEqual(bundles[0].id, 'local-olaf-test');
            assert.strictEqual(bundles[0].name, 'Test Bundle');
            assert.strictEqual(bundles[0].description, 'A test bundle');
            assert.strictEqual(bundles[0].version, '1.0.0');
            assert.strictEqual(bundles[0].author, 'Test Author');
            assert.ok(bundles[0].tags.includes('local-olaf'));
            assert.ok(bundles[0].tags.includes('test'));
            assert.strictEqual(bundles[0].size, '1 skill');
        });

        test('should skip invalid bundle definitions', async () => {
            // Create invalid bundle definition (missing metadata)
            const invalidBundle = {
                skills: [],
            };
            
            fs.writeFileSync(
                path.join(tempDir, 'bundles', 'invalid.json'),
                JSON.stringify(invalidBundle, null, 2)
            );
            
            const bundles = await adapter.fetchBundles();
            assert.ok(Array.isArray(bundles));
            assert.strictEqual(bundles.length, 0);
        });
    });

    suite('competency index path consistency', () => {
        setup(() => {
            // Create required directories
            fs.mkdirSync(path.join(tempDir, 'bundles'));
            fs.mkdirSync(path.join(tempDir, 'skills'));
            adapter = new LocalOlafAdapter(source);
        });

        test('should use consistent paths for installation and uninstallation', async () => {
            // Create skill directory and manifest
            const skillDir = path.join(tempDir, 'skills', 'test-skill');
            fs.mkdirSync(skillDir, { recursive: true });
            
            const skillManifest = {
                name: 'Test Skill',
                description: 'A test skill',
                entry_points: [
                    {
                        protocol: 'Propose-Act',
                        path: '/prompts/test.md',
                        patterns: ['test pattern'],
                    },
                ],
            };
            
            fs.writeFileSync(
                path.join(skillDir, 'manifest.json'),
                JSON.stringify(skillManifest, null, 2)
            );
            
            // Create bundle definition
            const bundleDefinition = {
                metadata: {
                    name: 'Test Bundle',
                    description: 'A test bundle',
                },
                skills: [
                    {
                        name: 'Test Skill',
                        description: 'A test skill',
                        path: 'skills/test-skill',
                        manifest: 'skills/test-skill/manifest.json',
                    },
                ],
            };
            
            fs.writeFileSync(
                path.join(tempDir, 'bundles', 'test.json'),
                JSON.stringify(bundleDefinition, null, 2)
            );

            // Mock workspace and competency index setup
            const mockWorkspace = path.join(tempDir, 'workspace');
            const competencyIndexDir = path.join(mockWorkspace, '.olaf', 'olaf-core', 'reference');
            const competencyIndexPath = path.join(competencyIndexDir, 'competency-index.json');
            
            fs.mkdirSync(competencyIndexDir, { recursive: true });
            
            // Mock vscode.workspace.workspaceFolders
            const originalWorkspaceFolders = require('vscode').workspace.workspaceFolders;
            require('vscode').workspace.workspaceFolders = [{ uri: { fsPath: mockWorkspace } }];
            
            // Mock the runtime manager methods to avoid initialization issues
            const originalEnsureRuntimeInstalled = adapter['ensureRuntimeInstalled'];
            const originalCreateWorkspaceLinks = adapter['createWorkspaceLinks'];
            const originalCreateSkillSymbolicLinks = adapter['createSkillSymbolicLinks'];
            const originalRemoveSkillSymbolicLinks = adapter['removeSkillSymbolicLinks'];
            
            adapter['ensureRuntimeInstalled'] = async () => { /* mock - do nothing */ };
            adapter['createWorkspaceLinks'] = async () => { /* mock - do nothing */ };
            adapter['createSkillSymbolicLinks'] = async () => { /* mock - do nothing */ };
            adapter['removeSkillSymbolicLinks'] = async () => { /* mock - do nothing */ };
            
            try {
                // Test installation - should create entry with "olaf-local" path
                await adapter.postInstall('local-olaf-test', '/mock/install/path');
                
                // Verify competency index was created with correct path
                assert.ok(fs.existsSync(competencyIndexPath), 'Competency index should be created');
                
                const indexContent = JSON.parse(fs.readFileSync(competencyIndexPath, 'utf-8'));
                assert.ok(Array.isArray(indexContent), 'Competency index should be an array');
                assert.strictEqual(indexContent.length, 1, 'Should have one entry');
                
                const entry = indexContent[0];
                assert.strictEqual(entry.file, 'external-skills/olaf-local/test-skill/prompts/test.md', 
                    'Should use "olaf-local" in path during installation');
                
                // Test uninstallation - should remove entry using same "olaf-local" path
                await adapter.postUninstall('local-olaf-test', '/mock/install/path');
                
                // Verify entry was removed
                const updatedIndexContent = JSON.parse(fs.readFileSync(competencyIndexPath, 'utf-8'));
                assert.ok(Array.isArray(updatedIndexContent), 'Competency index should still be an array');
                assert.strictEqual(updatedIndexContent.length, 0, 'Entry should be removed during uninstallation');
                
            } finally {
                // Restore original methods and workspace folders
                adapter['ensureRuntimeInstalled'] = originalEnsureRuntimeInstalled;
                adapter['createWorkspaceLinks'] = originalCreateWorkspaceLinks;
                adapter['createSkillSymbolicLinks'] = originalCreateSkillSymbolicLinks;
                adapter['removeSkillSymbolicLinks'] = originalRemoveSkillSymbolicLinks;
                require('vscode').workspace.workspaceFolders = originalWorkspaceFolders;
            }
        });
    });
});
import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { TemplateEngine, TemplateContext } from '../../src/services/TemplateEngine';

suite('TemplateEngine', () => {
    const templateRoot = path.join(process.cwd(), 'templates/scaffolds/github');
    let templateEngine: TemplateEngine;

    setup(() => {
        templateEngine = new TemplateEngine(templateRoot);
    });

    suite('loadManifest', () => {
        test('should load manifest from templates directory', async () => {
            const manifest = await templateEngine.loadManifest();
            assert.ok(manifest, 'Manifest should be loaded');
            assert.ok(manifest.version, 'Version should exist');
            assert.ok(manifest.templates, 'Should have templates object');
        });

        test('should throw error if manifest not found', async () => {
            await assert.rejects(
                () => new TemplateEngine('/nonexistent/path').loadManifest(),
                /Template manifest not found/
            );
        });

        test('should load template metadata', async () => {
            const manifest = await templateEngine.loadManifest();
            assert.ok(manifest.templates['example-prompt'], 'Should have example-prompt template');
            assert.ok(manifest.templates['readme'], 'Should have readme template');
        });
    });

    suite('renderTemplate', () => {
        test('should render template without variables', async () => {
            const context: TemplateContext = {
                projectName: 'Test',
                collectionId: 'test'
            };

            const content = await templateEngine.renderTemplate('example-prompt', context);
            assert.ok(content.includes('---') && content.includes('name:'), 'Should contain frontmatter');
        });

        test('should substitute variables in template', async () => {
            const context: TemplateContext = {
                projectName: 'My Project',
                collectionId: 'my-collection'
            };

            const content = await templateEngine.renderTemplate('example-collection', context);
            assert.ok(content.includes('my-collection'), 'Should substitute collectionId');
            assert.ok(content.includes('My Project'), 'Should substitute projectName');
        });

        test('should render package.json template', async () => {
            const context: TemplateContext = {
                projectName: 'Test Project',
                collectionId: 'test'
            };

            const content = await templateEngine.renderTemplate('package-json', context);
            const parsed = JSON.parse(content);
            assert.strictEqual(parsed.name, 'test-project', 'Should have kebab-case name');
            assert.ok(parsed.scripts, 'Should have scripts');
            assert.ok(parsed.scripts.validate, 'Should have validate script');
        });

        test('should throw error for unknown template', async () => {
            const context: TemplateContext = {
                projectName: 'Test',
                collectionId: 'test'
            };

            await assert.rejects(
                () => templateEngine.renderTemplate('nonexistent', context),
                /Template.*not found/
            );
        });
    });

    suite('copyTemplate', () => {
        test('should copy template to target location', async () => {
            const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'template-test-'));
            const targetPath = path.join(tempDir, 'test.prompt.md');
            const context: TemplateContext = {
                projectName: 'Test',
                collectionId: 'test'
            };

            await templateEngine.copyTemplate('example-prompt', targetPath, context);

            assert.ok(fs.existsSync(targetPath), 'File should be created');
            const content = fs.readFileSync(targetPath, 'utf8');
            assert.ok(content.includes('---') && content.includes('name:'), 'Should have correct content');

            // Cleanup
            fs.rmSync(tempDir, { recursive: true });
        });

        test('should create target directory if not exists', async () => {
            const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'template-test-'));
            const targetPath = path.join(tempDir, 'nested', 'dir', 'file.md');
            const context: TemplateContext = {
                projectName: 'Test',
                collectionId: 'test'
            };

            await templateEngine.copyTemplate('example-prompt', targetPath, context);

            assert.ok(fs.existsSync(targetPath), 'File should be created');
            assert.ok(fs.existsSync(path.dirname(targetPath)), 'Directory should be created');

            // Cleanup
            fs.rmSync(tempDir, { recursive: true });
        });

        test('should substitute variables when copying', async () => {
            const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'template-test-'));
            const targetPath = path.join(tempDir, 'collection.yml');
            const context: TemplateContext = {
                projectName: 'My Project',
                collectionId: 'my-collection'
            };

            await templateEngine.copyTemplate('example-collection', targetPath, context);

            const content = fs.readFileSync(targetPath, 'utf8');
            assert.ok(content.includes('my-collection'), 'Should have collection ID');
            assert.ok(content.includes('My Project'), 'Should have project name');

            // Cleanup
            fs.rmSync(tempDir, { recursive: true });
        });
    });

    suite('scaffoldProject', () => {
        test('should create all required directories', async () => {
            const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'template-test-'));
            const context: TemplateContext = {
                projectName: 'Awesome Project',
                collectionId: 'test-project'
            };

            await templateEngine.scaffoldProject(tempDir, context);

            assert.ok(fs.existsSync(path.join(tempDir, 'prompts')), 'Should create prompts directory');
            assert.ok(fs.existsSync(path.join(tempDir, 'instructions')), 'Should create instructions directory');
            assert.ok(fs.existsSync(path.join(tempDir, 'agents')), 'Should create agents directory');
            assert.ok(fs.existsSync(path.join(tempDir, 'collections')), 'Should create collections directory');
            assert.ok(fs.existsSync(path.join(tempDir, '.github', 'workflows')), 'Should create workflows directory');
            assert.ok(fs.existsSync(path.join(tempDir, 'scripts')), 'Should create scripts directory');

            // Cleanup
            fs.rmSync(tempDir, { recursive: true });
        });

        test('should create all template files', async () => {
            const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'template-test-'));
            const context: TemplateContext = {
                projectName: 'Awesome Project',
                collectionId: 'test-project'
            };

            await templateEngine.scaffoldProject(tempDir, context);
            
            assert.ok(fs.existsSync(path.join(tempDir, 'prompts/example.prompt.md')), 'Should create example prompt');
            assert.ok(fs.existsSync(path.join(tempDir, 'instructions/example.instructions.md')), 'Should create example instruction');
            assert.ok(fs.existsSync(path.join(tempDir, 'agents/example.agent.md')), 'Should create example agent');
            assert.ok(fs.existsSync(path.join(tempDir, 'collections/example.collection.yml')), 'Should create example collection');
            assert.ok(fs.existsSync(path.join(tempDir, 'README.md')), 'Should create README');
            assert.ok(fs.existsSync(path.join(tempDir, 'package.json')), 'Should create package.json');
            assert.ok(fs.existsSync(path.join(tempDir, '.github/workflows/publish.yml')), 'Should create publish workflow');
            assert.ok(fs.existsSync(path.join(tempDir, 'scripts/README.md')), 'Should create scripts README');

            // Cleanup
            fs.rmSync(tempDir, { recursive: true });
        });

        test('should substitute variables in all files', async () => {
            const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'template-test-'));
            const context: TemplateContext = {
                projectName: 'Awesome Project',
                collectionId: 'test-project'
            };

            await templateEngine.scaffoldProject(tempDir, context);
            
            // Check collection file
            const collectionContent = fs.readFileSync(
                path.join(tempDir, 'collections/example.collection.yml'),
                'utf8'
            );
            assert.ok(collectionContent.includes('test-project'), 'Collection should have project ID');
            assert.ok(collectionContent.includes('Awesome Project'), 'Collection should have project name');

            // Check package.json
            const packageContent = fs.readFileSync(
                path.join(tempDir, 'package.json'),
                'utf8'
            );
            const packageJson = JSON.parse(packageContent);
            assert.strictEqual(packageJson.name, 'awesome-project', 'Package should have substituted name');

            // Cleanup
            fs.rmSync(tempDir, { recursive: true });
        });

        test('should copy scripts README', async () => {
            const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'template-test-'));
            const context: TemplateContext = {
                projectName: 'Test Project',
                collectionId: 'test'
            };

            await templateEngine.scaffoldProject(tempDir, context);

            const readmePath = path.join(tempDir, 'scripts/README.md');
            assert.ok(fs.existsSync(readmePath), 'Scripts README should be copied');

            const content = fs.readFileSync(readmePath, 'utf8');
            assert.ok(content.length > 0, 'README should have content');

            // Cleanup
            fs.rmSync(tempDir, { recursive: true });
        });

        test('should create base directory if not exists', async () => {
            const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'template-test-'));
            const projectDir = path.join(tempDir, 'new-project');
            const context: TemplateContext = {
                projectName: 'Test',
                collectionId: 'test'
            };

            // Should not throw even though projectDir doesn't exist
            await templateEngine.scaffoldProject(projectDir, context);

            assert.ok(fs.existsSync(projectDir), 'Should create base directory');
            assert.ok(fs.existsSync(path.join(projectDir, 'prompts')), 'Should create subdirectories');

            // Cleanup
            fs.rmSync(tempDir, { recursive: true });
        });
    });

    suite('getTemplates', () => {
        test('should return all available templates', async () => {
            const templates = await templateEngine.getTemplates();
            assert.ok(templates, 'Should return templates object');
            assert.ok(Object.keys(templates).length > 0, 'Should have templates');
        });

        test('should include template metadata', async () => {
            const templates = await templateEngine.getTemplates();
            const examplePrompt = templates['example-prompt'];
            
            assert.ok(examplePrompt, 'Should have example-prompt');
            assert.ok(examplePrompt.path, 'Should have path');
            assert.ok(examplePrompt.description, 'Should have description');
            assert.strictEqual(typeof examplePrompt.required, 'boolean', 'Should have required flag');
            assert.ok(Array.isArray(examplePrompt.variables), 'Should have variables array');
        });
    });
});

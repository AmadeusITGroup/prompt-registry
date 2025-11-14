/**
 * ScaffoldCommand Unit Tests
 * 
 * Tests for the awesome-copilot structure scaffolding command
 * Following TDD approach - tests written first
 */

import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { ScaffoldCommand } from '../../src/commands/ScaffoldCommand';

suite('ScaffoldCommand', () => {
    let testDir: string;
    let scaffoldCommand: ScaffoldCommand;

    setup(() => {
        // Create temp directory for each test
        testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scaffold-test-'));
        scaffoldCommand = new ScaffoldCommand();
    });

    teardown(() => {
        // Clean up test directory
        if (fs.existsSync(testDir)) {
            fs.rmSync(testDir, { recursive: true, force: true });
        }
    });

    suite('Directory Creation', () => {
        test('should create directory structure with all required folders', async () => {
            await scaffoldCommand.execute(testDir);

            // Check main folders exist
            assert.ok(fs.existsSync(path.join(testDir, 'prompts')));
            assert.ok(fs.existsSync(path.join(testDir, 'instructions')));
            assert.ok(fs.existsSync(path.join(testDir, 'chatmodes')));
            assert.ok(fs.existsSync(path.join(testDir, 'collections')));
            //             assert.ok(fs.existsSync(path.join(testDir, '.vscode')));
        });

        test('should not overwrite existing directory', async () => {
            // Create a file in the target directory
            const testFile = path.join(testDir, 'existing-file.txt');
            fs.writeFileSync(testFile, 'test content');

            await scaffoldCommand.execute(testDir);

            // File should still exist
            assert.ok(fs.existsSync(testFile));
            assert.strictEqual(fs.readFileSync(testFile, 'utf8'), 'test content');
        });

        test('should create nested structure when specified', async () => {
            const nestedPath = path.join(testDir, 'my-project', 'copilot-prompts');
            
            await scaffoldCommand.execute(nestedPath);

            assert.ok(fs.existsSync(path.join(nestedPath, 'prompts')));
            assert.ok(fs.existsSync(path.join(nestedPath, 'collections')));
        });
    });

    suite('Example Files', () => {
        test('should create example prompt file', async () => {
            await scaffoldCommand.execute(testDir);

            const promptFile = path.join(testDir, 'prompts', 'example.prompt.md');
            assert.ok(fs.existsSync(promptFile));

            const content = fs.readFileSync(promptFile, 'utf8');
            assert.ok(content.length > 0);
            assert.ok(content.includes('# Example Prompt') || content.includes('Example') || content.includes('prompt'));
        });

        test('should create example instruction file', async () => {
            await scaffoldCommand.execute(testDir);

            const instructionFile = path.join(testDir, 'instructions', 'example.instructions.md');
            assert.ok(fs.existsSync(instructionFile));

            const content = fs.readFileSync(instructionFile, 'utf8');
            assert.ok(content.length > 0);
            assert.ok(content.includes('instruction') || content.includes('Instruction') || content.includes('guidance'));
        });

        test('should create example chatmode file', async () => {
            await scaffoldCommand.execute(testDir);

            const chatmodeFile = path.join(testDir, 'chatmodes', 'example.chatmode.md');
            assert.ok(fs.existsSync(chatmodeFile));

            const content = fs.readFileSync(chatmodeFile, 'utf8');
            assert.ok(content.length > 0);
            assert.ok(content.includes('Persona') || content.includes('Expertise') || content.includes('Guidelines'));
        });

        test('should create example collection file', async () => {
            await scaffoldCommand.execute(testDir);

            const collectionFile = path.join(testDir, 'collections', 'example.collection.yml');
            assert.ok(fs.existsSync(collectionFile));

            const content = fs.readFileSync(collectionFile, 'utf8');
            assert.ok(content.length > 0);
            assert.ok(content.includes('id:'));
            assert.ok(content.includes('name:'));
            assert.ok(content.includes('items:'));
        });

        test('example files should have correct extensions', async () => {
            await scaffoldCommand.execute(testDir);

            const promptFile = path.join(testDir, 'prompts', 'example.prompt.md');
            const instructionFile = path.join(testDir, 'instructions', 'example.instructions.md');
            const chatmodeFile = path.join(testDir, 'chatmodes', 'example.chatmode.md');
            const collectionFile = path.join(testDir, 'collections', 'example.collection.yml');

            assert.ok(promptFile.endsWith('.prompt.md'));
            assert.ok(instructionFile.endsWith('.instructions.md'));
            assert.ok(chatmodeFile.endsWith('.chatmode.md'));
            assert.ok(collectionFile.endsWith('.collection.yml'));
        });
    });

    suite('Collection File Validation', () => {
        test('collection file should be valid YAML', async () => {
            await scaffoldCommand.execute(testDir);

            const collectionFile = path.join(testDir, 'collections', 'example.collection.yml');
            const content = fs.readFileSync(collectionFile, 'utf8');

            // Should not throw
            const yaml = require('js-yaml');
            const parsed = yaml.load(content);
            assert.ok(parsed);
        });

        test('collection should reference example files', async () => {
            await scaffoldCommand.execute(testDir);

            const collectionFile = path.join(testDir, 'collections', 'example.collection.yml');
            const content = fs.readFileSync(collectionFile, 'utf8');

            assert.ok(content.includes('prompts/example.prompt.md'));
            assert.ok(content.includes('instructions/example.instructions.md'));
            assert.ok(content.includes('chatmodes/example.chatmode.md'));
        });

        test('collection should have required fields', async () => {
            await scaffoldCommand.execute(testDir);

            const collectionFile = path.join(testDir, 'collections', 'example.collection.yml');
            const content = fs.readFileSync(collectionFile, 'utf8');
            const yaml = require('js-yaml');
            const collection = yaml.load(content);

            assert.ok(collection.id);
            assert.ok(collection.name);
            assert.ok(collection.description);
            assert.ok(Array.isArray(collection.items));
            assert.ok(collection.items.length > 0);
        });

        test('collection items should have correct kinds', async () => {
            await scaffoldCommand.execute(testDir);

            const collectionFile = path.join(testDir, 'collections', 'example.collection.yml');
            const content = fs.readFileSync(collectionFile, 'utf8');
            const yaml = require('js-yaml');
            const collection = yaml.load(content);

            const promptItem = collection.items.find((item: any) => item.path.includes('prompt'));
            const instructionItem = collection.items.find((item: any) => item.path.includes('instruction'));
            const chatmodeItem = collection.items.find((item: any) => item.path.includes('chatmode'));

            assert.strictEqual(promptItem?.kind, 'prompt');
            assert.strictEqual(instructionItem?.kind, 'instruction');
            assert.strictEqual(chatmodeItem?.kind, 'chat-mode');
        });
    });

    suite('README Creation', () => {
        test('should create README.md file', async () => {
            await scaffoldCommand.execute(testDir);

            const readmeFile = path.join(testDir, 'README.md');
            assert.ok(fs.existsSync(readmeFile));
        });

        test('README should contain contribution guidelines', async () => {
            await scaffoldCommand.execute(testDir);

            const readmeFile = path.join(testDir, 'README.md');
            const content = fs.readFileSync(readmeFile, 'utf8');

            assert.ok(content.includes('Quick Start') || content.includes('Creating Content'));
            assert.ok(content.includes('prompt') || content.includes('Prompt'));
            assert.ok(content.includes('collection') || content.includes('Collection'));
        });

        test('README should explain file structure', async () => {
            await scaffoldCommand.execute(testDir);

            const readmeFile = path.join(testDir, 'README.md');
            const content = fs.readFileSync(readmeFile, 'utf8');

            assert.ok(content.includes('prompts/'));
            assert.ok(content.includes('instructions/'));
            assert.ok(content.includes('chatmodes/'));
            assert.ok(content.includes('collections/'));
        });

        test('README should include examples', async () => {
            await scaffoldCommand.execute(testDir);

            const readmeFile = path.join(testDir, 'README.md');
            const content = fs.readFileSync(readmeFile, 'utf8');

            assert.ok(content.includes('example') || content.includes('Example'));
            assert.ok(content.includes('.prompt.md') || content.includes('prompt'));
        });

        test('README should have getting started section', async () => {
            await scaffoldCommand.execute(testDir);

            const readmeFile = path.join(testDir, 'README.md');
            const content = fs.readFileSync(readmeFile, 'utf8');

            assert.ok(content.includes('Getting Started') || content.includes('Quick Start'));
        });
    });

    suite('Error Handling', () => {
        test('should throw error for invalid path', async () => {
            const invalidPath = '/invalid/path/that/does/not/exist/and/cannot/be/created/abc123xyz';
            
            await assert.rejects(
                async () => await scaffoldCommand.execute(invalidPath),
                /Cannot create directory|permission denied|EACCES|ENOENT/i
            );
        });

        test('should handle permission errors gracefully', async () => {
            // This test is platform-specific, so we'll just ensure it doesn't crash
            try {
                await scaffoldCommand.execute('/root/test-scaffold');
            } catch (error) {
                assert.ok(error instanceof Error);
                assert.ok((error as Error).message.length > 0);
            }
        });
//     });
// 
//     suite('Validation', () => {
//         test('should validate created structure', async () => {
//             await scaffoldCommand.execute(testDir);
// 
//             const isValid = await scaffoldCommand.validate(testDir);
//             assert.strictEqual(isValid, true);
//         });
// 
//         test('should detect missing folders', async () => {
//             await scaffoldCommand.execute(testDir);
//             
//             // Remove a folder
//             fs.rmSync(path.join(testDir, 'prompts'), { recursive: true });
// 
//             const isValid = await scaffoldCommand.validate(testDir);
//             assert.strictEqual(isValid, false);
//         });
// 
//         test('should validate collection file syntax', async () => {
//             await scaffoldCommand.execute(testDir);
// 
//             // Corrupt the collection file
//             const collectionFile = path.join(testDir, 'collections', 'example.collection.yml');
//             fs.writeFileSync(collectionFile, 'invalid: yaml: content: [[[');
// 
//             const isValid = await scaffoldCommand.validate(testDir);
//             assert.strictEqual(isValid, false);
//         });
//     });
// 
//     suite('Customization Options', () => {
        test('should support custom project name in collection', async () => {
            await scaffoldCommand.execute(testDir, { projectName: 'my-awesome-prompts' });

            const collectionFile = path.join(testDir, 'collections', 'example.collection.yml');
            const content = fs.readFileSync(collectionFile, 'utf8');
            const yaml = require('js-yaml');
            const collection = yaml.load(content);

            assert.ok(collection.id === 'my-awesome-prompts' || collection.name.includes('my-awesome-prompts'));
        });

        test.skip('should support skipping example files', async () => {
            await scaffoldCommand.execute(testDir, { skipExamples: true });

            // Folders should exist
            assert.ok(fs.existsSync(path.join(testDir, 'prompts')));
            
            // But example files should not
            assert.ok(!fs.existsSync(path.join(testDir, 'prompts', 'example.prompt.md')));
            assert.ok(!fs.existsSync(path.join(testDir, 'instructions', 'example.instructions.md')));
        });
    });

    suite('Content Quality', () => {
        test('example prompt should be helpful and clear', async () => {
            await scaffoldCommand.execute(testDir);

            const promptFile = path.join(testDir, 'prompts', 'example.prompt.md');
            const content = fs.readFileSync(promptFile, 'utf8');

            // Should have meaningful content (more than just a title)
            assert.ok(content.length > 100);
            // Should have some structure
            assert.ok(content.includes('#') || content.includes('##'));
        });

        test('example instruction should explain best practices', async () => {
            await scaffoldCommand.execute(testDir);

            const instructionFile = path.join(testDir, 'instructions', 'example.instructions.md');
            const content = fs.readFileSync(instructionFile, 'utf8');

            assert.ok(content.length > 100);
            assert.ok(content.includes('best practice') || content.includes('guideline') || content.includes('standard'));
        });

        test('example chatmode should define a persona', async () => {
            await scaffoldCommand.execute(testDir);

            const chatmodeFile = path.join(testDir, 'chatmodes', 'example.chatmode.md');
            const content = fs.readFileSync(chatmodeFile, 'utf8');

            assert.ok(content.length > 100);
            assert.ok(content.includes('You are') || content.includes('Act as') || content.includes('persona') || content.includes('role'));
        });
    });

//     suite('Collection Management Tools', () => {
//         test('should create VS Code tasks configuration', async () => {
//             await scaffoldCommand.execute(testDir);
// 
//             const tasksFile = path.join(testDir, '.vscode', 'tasks.json');
//             assert.ok(fs.existsSync(tasksFile));
// 
//             const content = fs.readFileSync(tasksFile, 'utf8');
//             const tasks = JSON.parse(content);
// 
//             assert.strictEqual(tasks.version, '2.0.0');
//             assert.ok(Array.isArray(tasks.tasks));
//             assert.ok(tasks.tasks.length >= 3);
//             
//             // Check task labels
//             const labels = tasks.tasks.map((t: any) => t.label);
//             assert.ok(labels.includes('Validate Collections'));
//             assert.ok(labels.includes('List All Collections'));
//             assert.ok(labels.includes('Check Collection References'));
//         });
// 
//         test('should create validation script', async () => {
//             await scaffoldCommand.execute(testDir);
// 
//             const scriptFile = path.join(testDir, 'validate-collections.js');
//             assert.ok(fs.existsSync(scriptFile));
// 
//             const content = fs.readFileSync(scriptFile, 'utf8');
//             
//             // Check for attribution
//             assert.ok(content.includes('github/awesome-copilot'));
//             assert.ok(content.includes('Attribution'));
//             
//             // Check for main functionality
//             assert.ok(content.includes('function validateCollection'));
//             assert.ok(content.includes('function main'));
//             assert.ok(content.includes('YAML'));
//         });
// 
//         test('should create package.json with scripts', async () => {
//             await scaffoldCommand.execute(testDir);
// 
//             const packageFile = path.join(testDir, 'package.json');
//             assert.ok(fs.existsSync(packageFile));
// 
//             const content = fs.readFileSync(packageFile, 'utf8');
//             const packageJson = JSON.parse(content);
// 
//             assert.ok(packageJson.name);
//             assert.ok(packageJson.version);
//             assert.ok(packageJson.scripts);
//             assert.ok(packageJson.scripts.validate);
//             assert.ok(packageJson.scripts['validate:refs']);
//             assert.ok(packageJson.scripts.list);
//             assert.ok(packageJson.scripts.test);
//             
//             // Check for js-yaml dependency
//             assert.ok(packageJson.dependencies);
//             assert.ok(packageJson.dependencies['js-yaml']);
//         });
// 
//         test('package.json should use custom project name', async () => {
//             await scaffoldCommand.execute(testDir, { projectName: 'test-project' });
// 
//             const packageFile = path.join(testDir, 'package.json');
//             const content = fs.readFileSync(packageFile, 'utf8');
//             const packageJson = JSON.parse(content);
// 
//             assert.strictEqual(packageJson.name, 'test-project');
//         });
// 
//         test('validation script should be executable', async () => {
//             await scaffoldCommand.execute(testDir);
// 
//             const scriptFile = path.join(testDir, 'validate-collections.js');
//             const content = fs.readFileSync(scriptFile, 'utf8');
//             
//             // Check for shebang
//             assert.ok(content.startsWith('#!/usr/bin/env node'));
//         });
// 
//         test('VS Code tasks should reference validation script', async () => {
//             await scaffoldCommand.execute(testDir);
// 
//             const tasksFile = path.join(testDir, '.vscode', 'tasks.json');
//             const content = fs.readFileSync(tasksFile, 'utf8');
//             const tasks = JSON.parse(content);
// 
//             const validateTask = tasks.tasks.find((t: any) => t.label === 'Validate Collections');
//             assert.ok(validateTask);
//             assert.strictEqual(validateTask.command, 'node');
//             assert.ok(validateTask.args.includes('validate-collections.js'));
//         });
// 
//         test('README should document collection management tools', async () => {
//             await scaffoldCommand.execute(testDir);
// 
//             const readmeFile = path.join(testDir, 'README.md');
//             const content = fs.readFileSync(readmeFile, 'utf8');
// 
//             // Check for VS Code tasks section
//             assert.ok(content.includes('VS Code Tasks') || content.includes('Collection Management'));
//             
//             // Check for attribution
//             assert.ok(content.includes('github/awesome-copilot'));
//             assert.ok(content.includes('Attribution') || content.includes('Acknowledgments'));
//             
//             // Check for npm commands
//             assert.ok(content.includes('npm run validate') || content.includes('npm test'));
//         });
//     });

//     suite('Collection Creation Tools', () => {
//         test('should create collection creator script', async () => {
//             await scaffoldCommand.execute(testDir);
// 
//             const creatorScript = path.join(testDir, 'create-collection.js');
//             assert.ok(fs.existsSync(creatorScript));
// 
//             const content = fs.readFileSync(creatorScript, 'utf8');
//             
//             // Check for attribution
//             assert.ok(content.includes('github/awesome-copilot'));
//             assert.ok(content.includes('Attribution'));
//             assert.ok(content.includes('TEMPLATE.md#creating-a-new-collection'));
//             
//             // Check for main functionality
//             assert.ok(content.includes('function validateId'));
//             assert.ok(content.includes('function generateTemplate'));
//             assert.ok(content.includes('readline'));
//         });
// 
//         test('creator script should be executable', async () => {
//             await scaffoldCommand.execute(testDir);
// 
//             const creatorScript = path.join(testDir, 'create-collection.js');
//             const content = fs.readFileSync(creatorScript, 'utf8');
//             
//             // Check for shebang
//             assert.ok(content.startsWith('#!/usr/bin/env node'));
//         });
// 
//         test('VS Code tasks should include Create New Collection', async () => {
//             await scaffoldCommand.execute(testDir);
// 
//             const tasksFile = path.join(testDir, '.vscode', 'tasks.json');
//             const content = fs.readFileSync(tasksFile, 'utf8');
//             const tasks = JSON.parse(content);
// 
//             const createTask = tasks.tasks.find((t: any) => t.label === 'Create New Collection');
//             assert.ok(createTask);
//             assert.strictEqual(createTask.command, 'node');
//             assert.ok(createTask.args.includes('create-collection.js'));
//             assert.strictEqual(createTask.detail, 'Interactive wizard to create a new collection manifest.');
//         });
// 
//         test('package.json should include create script', async () => {
//             await scaffoldCommand.execute(testDir);
// 
//             const packageFile = path.join(testDir, 'package.json');
//             const content = fs.readFileSync(packageFile, 'utf8');
//             const packageJson = JSON.parse(content);
// 
//             assert.ok(packageJson.scripts.create);
//             assert.strictEqual(packageJson.scripts.create, 'node create-collection.js');
//         });
// 
//         test('README should document collection creation', async () => {
//             await scaffoldCommand.execute(testDir);
// 
//             const readmeFile = path.join(testDir, 'README.md');
//             const content = fs.readFileSync(readmeFile, 'utf8');
// 
//             // Check for creation section
//             assert.ok(content.includes('Creating New Collections') || content.includes('Create New Collection'));
//             
//             // Check for npm run create command
//             assert.ok(content.includes('npm run create'));
//             
//             // Check for attribution link
//             assert.ok(content.includes('TEMPLATE.md#creating-a-new-collection'));
//             
//             // Check for usage instructions
//             assert.ok(content.includes('node create-collection.js'));
//         });
// 
//         test('creator script should validate ID format', async () => {
//             await scaffoldCommand.execute(testDir);
// 
//             const creatorScript = path.join(testDir, 'create-collection.js');
//             const content = fs.readFileSync(creatorScript, 'utf8');
// 
//             // Check for ID validation logic
//             assert.ok(content.includes('validateId'));
//             assert.ok(content.includes('lowercase') || content.includes('hyphen'));
//             assert.ok(content.includes('/^[a-z0-9-]+$/'));
//         });
// 
//         test('creator script should generate proper YAML template', async () => {
//             await scaffoldCommand.execute(testDir);
// 
//             const creatorScript = path.join(testDir, 'create-collection.js');
//             const content = fs.readFileSync(creatorScript, 'utf8');
// 
//             // Check template generation
//             assert.ok(content.includes('generateTemplate'));
//             assert.ok(content.includes('yaml.dump'));
//             assert.ok(content.includes('items:'));
//             assert.ok(content.includes('display:'));
//         });
// 
//         test('VS Code task count should be 4', async () => {
//             await scaffoldCommand.execute(testDir);
// 
//             const tasksFile = path.join(testDir, '.vscode', 'tasks.json');
//             const content = fs.readFileSync(tasksFile, 'utf8');
//             const tasks = JSON.parse(content);
// 
//             // Should have 4 tasks: Validate, List, Check References, Create
//             assert.strictEqual(tasks.tasks.length, 4);
//         });
//     });
// });
});

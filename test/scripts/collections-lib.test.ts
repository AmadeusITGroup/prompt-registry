/**
 * Collections Library Tests
 * 
 * Transposed from workflow-bundle/test/collections-lib.test.js
 * Tests the collections library functions.
 * 
 * Feature: workflow-bundle-scaffolding
 * Requirements: 15.6
 */

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import {
    createTestProject,
    writeFile,
    TestProject
} from '../helpers/scriptTestHelpers';

// Import the collections library from templates
const collectionsLib = require('../../templates/scaffolds/github/scripts/lib/collections.js');

suite('Collections Library Tests', () => {
    let project: TestProject;

    teardown(() => {
        if (project) {
            project.cleanup();
        }
    });

    suite('listCollectionFiles()', () => {
        test('finds .collection.yml files', function() {
            project = createTestProject('wf-collections-', { copyScripts: false, initGit: false });
            const { root } = project;

            // Create collection files
            writeFile(root, 'collections/first.collection.yml', 'id: first\nname: First\nitems: []');
            writeFile(root, 'collections/second.collection.yml', 'id: second\nname: Second\nitems: []');
            
            // Create a non-collection file that should be ignored
            writeFile(root, 'collections/readme.md', '# Collections');

            const files = collectionsLib.listCollectionFiles(root);
            
            assert.ok(files.length >= 2, 'Should find at least 2 collection files');
            assert.ok(
                files.every((f: string) => f.endsWith('.collection.yml')),
                'All files should end with .collection.yml'
            );
            assert.ok(
                files.some((f: string) => f.includes('first.collection.yml')),
                'Should find first.collection.yml'
            );
            assert.ok(
                files.some((f: string) => f.includes('second.collection.yml')),
                'Should find second.collection.yml'
            );
        });

        test('returns empty array when no collections exist', function() {
            project = createTestProject('wf-collections-', { copyScripts: false, initGit: false });
            const { root } = project;

            // Create collections directory but no collection files
            fs.mkdirSync(path.join(root, 'collections'), { recursive: true });
            writeFile(root, 'collections/readme.md', '# Collections');

            const files = collectionsLib.listCollectionFiles(root);
            
            assert.strictEqual(files.length, 0, 'Should return empty array when no collections');
        });
    });

    suite('readCollection()', () => {
        test('parses required fields', function() {
            project = createTestProject('wf-collections-', { copyScripts: false, initGit: false });
            const { root } = project;

            writeFile(root, 'collections/test.collection.yml', `
id: test-collection
name: Test Collection
description: A test collection
version: "1.0.0"
items:
  - path: prompts/test.md
    kind: prompt
`);

            const collection = collectionsLib.readCollection(root, 'collections/test.collection.yml');
            
            assert.strictEqual(typeof collection.id, 'string', 'id should be a string');
            assert.strictEqual(collection.id, 'test-collection');
            assert.strictEqual(typeof collection.name, 'string', 'name should be a string');
            assert.strictEqual(collection.name, 'Test Collection');
            assert.ok(Array.isArray(collection.items), 'items should be an array');
            assert.strictEqual(collection.items.length, 1);
        });

        test('handles optional fields', function() {
            project = createTestProject('wf-collections-', { copyScripts: false, initGit: false });
            const { root } = project;

            writeFile(root, 'collections/minimal.collection.yml', `
id: minimal
name: Minimal
items: []
`);

            const collection = collectionsLib.readCollection(root, 'collections/minimal.collection.yml');
            
            assert.strictEqual(collection.id, 'minimal');
            assert.strictEqual(collection.name, 'Minimal');
            assert.deepStrictEqual(collection.items, []);
            assert.strictEqual(collection.version, undefined, 'version should be undefined when not specified');
        });

        test('throws for invalid YAML', function() {
            project = createTestProject('wf-collections-', { copyScripts: false, initGit: false });
            const { root } = project;

            writeFile(root, 'collections/invalid.collection.yml', `
id: test
name: Test
items: [unclosed bracket
`);

            assert.throws(
                () => collectionsLib.readCollection(root, 'collections/invalid.collection.yml'),
                /yaml|parse/i,
                'Should throw for invalid YAML'
            );
        });
    });

    suite('resolveCollectionItemPaths()', () => {
        test('returns repo-root relative paths', function() {
            project = createTestProject('wf-collections-', { copyScripts: false, initGit: false });
            const { root } = project;

            const collection = {
                id: 'test',
                name: 'Test',
                items: [
                    { path: 'prompts/first.md', kind: 'prompt' },
                    { path: 'prompts/second.md', kind: 'prompt' },
                    { path: 'instructions/inst.md', kind: 'instruction' },
                ]
            };

            const paths = collectionsLib.resolveCollectionItemPaths(root, collection);
            
            assert.strictEqual(paths.length, 3, 'Should return 3 paths');
            assert.ok(
                paths.every((p: string) => !p.startsWith('..')),
                'Paths should not start with ..'
            );
            assert.ok(
                paths.every((p: string) => !p.startsWith('/')),
                'Paths should not be absolute'
            );
            assert.deepStrictEqual(paths, [
                'prompts/first.md',
                'prompts/second.md',
                'instructions/inst.md'
            ]);
        });

        test('handles empty items array', function() {
            project = createTestProject('wf-collections-', { copyScripts: false, initGit: false });
            const { root } = project;

            const collection = {
                id: 'empty',
                name: 'Empty',
                items: []
            };

            const paths = collectionsLib.resolveCollectionItemPaths(root, collection);
            
            assert.deepStrictEqual(paths, [], 'Should return empty array for empty items');
        });

        test('normalizes Windows-style paths', function() {
            project = createTestProject('wf-collections-', { copyScripts: false, initGit: false });
            const { root } = project;

            const collection = {
                id: 'test',
                name: 'Test',
                items: [
                    { path: 'prompts\\windows\\style.md', kind: 'prompt' },
                ]
            };

            const paths = collectionsLib.resolveCollectionItemPaths(root, collection);
            
            assert.strictEqual(paths.length, 1);
            assert.ok(
                !paths[0].includes('\\'),
                'Paths should use forward slashes'
            );
        });

        test('filters out items without path', function() {
            project = createTestProject('wf-collections-', { copyScripts: false, initGit: false });
            const { root } = project;

            const collection = {
                id: 'test',
                name: 'Test',
                items: [
                    { path: 'prompts/valid.md', kind: 'prompt' },
                    { kind: 'prompt' }, // Missing path
                    { path: '', kind: 'prompt' }, // Empty path
                    { path: 'prompts/another.md', kind: 'prompt' },
                ]
            };

            const paths = collectionsLib.resolveCollectionItemPaths(root, collection);
            
            assert.strictEqual(paths.length, 2, 'Should only return items with valid paths');
            assert.deepStrictEqual(paths, [
                'prompts/valid.md',
                'prompts/another.md'
            ]);
        });

        test('includes all files in skill directory when kind is skill', function() {
            project = createTestProject('wf-collections-', { copyScripts: false, initGit: false });
            const { root } = project;

            // Create a skill directory structure like the real ospo.skills-collection
            writeFile(root, 'skills/my-skill/SKILL.md', '# My Skill\nDescription here');
            writeFile(root, 'skills/my-skill/assets/diagram.png', 'fake-png-content');
            writeFile(root, 'skills/my-skill/references/doc.md', '# Reference Doc');
            writeFile(root, 'skills/my-skill/scripts/helper.js', 'console.log("helper")');

            const collection = {
                id: 'test',
                name: 'Test',
                items: [
                    { path: 'skills/my-skill/SKILL.md', kind: 'skill' },
                ]
            };

            const paths = collectionsLib.resolveCollectionItemPaths(root, collection);
            
            // Should include all files in the skill directory, not just SKILL.md
            assert.ok(paths.length >= 4, `Should include all skill files, got ${paths.length}: ${JSON.stringify(paths)}`);
            assert.ok(paths.includes('skills/my-skill/SKILL.md'), 'Should include SKILL.md');
            assert.ok(paths.includes('skills/my-skill/assets/diagram.png'), 'Should include assets');
            assert.ok(paths.includes('skills/my-skill/references/doc.md'), 'Should include references');
            assert.ok(paths.includes('skills/my-skill/scripts/helper.js'), 'Should include scripts');
        });

        test('includes skill directory files alongside regular prompts', function() {
            project = createTestProject('wf-collections-', { copyScripts: false, initGit: false });
            const { root } = project;

            // Create skill directory
            writeFile(root, 'skills/my-skill/SKILL.md', '# My Skill');
            writeFile(root, 'skills/my-skill/assets/image.png', 'fake-png');
            
            // Create regular prompt
            writeFile(root, 'prompts/simple.prompt.md', '# Simple Prompt');

            const collection = {
                id: 'test',
                name: 'Test',
                items: [
                    { path: 'skills/my-skill/SKILL.md', kind: 'skill' },
                    { path: 'prompts/simple.prompt.md', kind: 'prompt' },
                ]
            };

            const paths = collectionsLib.resolveCollectionItemPaths(root, collection);
            
            // Should include all skill files plus the prompt
            assert.ok(paths.includes('skills/my-skill/SKILL.md'), 'Should include SKILL.md');
            assert.ok(paths.includes('skills/my-skill/assets/image.png'), 'Should include skill assets');
            assert.ok(paths.includes('prompts/simple.prompt.md'), 'Should include regular prompt');
        });

        test('enables detection of changes to skill subdirectory files', function() {
            // This test verifies that detect-affected-collections.js can find
            // collections affected by changes to files in skill subdirectories
            // (e.g., skills/my-skill/scripts/helper.py)
            project = createTestProject('wf-collections-', { copyScripts: false, initGit: false });
            const { root } = project;

            // Create skill directory structure matching ospo.skills-collection
            writeFile(root, 'skills/github-issues-triage/SKILL.md', '# GitHub Issues Triage');
            writeFile(root, 'skills/github-issues-triage/scripts/triage_issues.py', 'print("triage")');
            writeFile(root, 'skills/github-issues-triage/assets/report.template.md', '# Report');
            writeFile(root, 'skills/github-issues-triage/references/EXAMPLES.md', '# Examples');

            const collection = {
                id: 'amadeus-ospo',
                name: 'Amadeus OSPO',
                items: [
                    { path: 'skills/github-issues-triage/SKILL.md', kind: 'skill' },
                ]
            };

            const resolvedPaths = collectionsLib.resolveCollectionItemPaths(root, collection);
            const itemPathsSet = new Set(resolvedPaths);

            // Simulate detect-affected-collections.js logic:
            // Check if a changed file in a skill subdirectory is detected
            const changedFile = 'skills/github-issues-triage/scripts/triage_issues.py';
            const isDetected = itemPathsSet.has(changedFile);

            assert.ok(isDetected, 
                `Change to ${changedFile} should be detected as affecting the collection. ` +
                `Resolved paths: ${JSON.stringify(resolvedPaths)}`
            );

            // Also verify other subdirectory files are included
            assert.ok(itemPathsSet.has('skills/github-issues-triage/assets/report.template.md'),
                'Should include assets files');
            assert.ok(itemPathsSet.has('skills/github-issues-triage/references/EXAMPLES.md'),
                'Should include references files');
        });
    });
});

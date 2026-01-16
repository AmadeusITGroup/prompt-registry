/**
 * Script Test Helpers
 * 
 * Common utilities for testing the GitHub scaffold scripts.
 * These helpers provide isolated test environments with git repos,
 * stub executables, and file management utilities.
 * 
 * Feature: workflow-bundle-scaffolding
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawnSync, SpawnSyncReturns } from 'child_process';

/**
 * Result of running a command
 */
export interface RunResult {
    code: number | null;
    stdout: string;
    stderr: string;
}

/**
 * Result of creating a gh stub
 */
export interface GhStubResult {
    binDir: string;
    logPath: string;
}

/**
 * Options for creating a test project
 */
export interface TestProjectOptions {
    initGit?: boolean;
    withPackageJson?: boolean;
    copyScripts?: boolean;
}

/**
 * A test project environment with cleanup
 */
export interface TestProject {
    root: string;
    scriptsDir: string;
    cleanup: () => void;
}

// Path to the scaffolded scripts in templates
const TEMPLATE_SCRIPTS_DIR = path.resolve(__dirname, '../../templates/scaffolds/github/scripts');

/**
 * Run a command synchronously
 */
export function run(cmd: string, args: string[], cwd: string, env?: NodeJS.ProcessEnv): RunResult {
    const res = spawnSync(cmd, args, { cwd, env, encoding: 'utf8' });
    return { code: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
}

/**
 * Write a file, creating directories as needed
 */
export function writeFile(root: string, rel: string, content: string): string {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
    return abs;
}

/**
 * Copy a directory recursively
 */
export function copyDir(src: string, dest: string): void {
    fs.mkdirSync(dest, { recursive: true });
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        if (entry.isDirectory()) {
            copyDir(srcPath, destPath);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

/**
 * Initialize a git repository
 */
export function initGitRepo(root: string): void {
    const init = run('git', ['init', '-q'], root);
    if (init.code !== 0) throw new Error(`git init failed: ${init.stderr}`);
    
    const email = run('git', ['config', 'user.email', 'test@example.com'], root);
    if (email.code !== 0) throw new Error(`git config email failed: ${email.stderr}`);
    
    const name = run('git', ['config', 'user.name', 'Test'], root);
    if (name.code !== 0) throw new Error(`git config name failed: ${name.stderr}`);
}

/**
 * Stage and commit all files
 */
export function gitCommitAll(root: string, message: string): void {
    const add = run('git', ['add', '.'], root);
    if (add.code !== 0) throw new Error(`git add failed: ${add.stderr}`);
    
    const commit = run('git', ['commit', '-q', '-m', message], root);
    if (commit.code !== 0) throw new Error(`git commit failed: ${commit.stderr || commit.stdout}`);
}

/**
 * Create a git tag
 */
export function gitTag(root: string, tag: string): void {
    const res = run('git', ['tag', tag], root);
    if (res.code !== 0) throw new Error(`git tag failed: ${res.stderr}`);
}

/**
 * Create a stub gh CLI that logs calls
 */
export function createGhStub(root: string): GhStubResult {
    const binDir = path.join(root, 'bin');
    fs.mkdirSync(binDir, { recursive: true });

    const logPath = path.join(root, 'gh.log');
    fs.writeFileSync(logPath, '');

    const ghPath = path.join(binDir, 'gh');
    writeFile(
        root,
        path.relative(root, ghPath),
        [
            '#!/usr/bin/env node',
            "const fs = require('node:fs');",
            "const log = process.env.GH_STUB_LOG;",
            'const args = process.argv.slice(2);',
            'fs.appendFileSync(log, JSON.stringify(args) + "\\n");',
            "if (args[0] === 'release' && args[1] === 'view') process.exit(1);",
            "if (args[0] === 'release' && args[1] === 'create') process.exit(0);",
            'process.exit(0);',
            '',
        ].join('\n'),
    );
    fs.chmodSync(ghPath, 0o755);

    return { binDir, logPath };
}

/**
 * Read gh stub call log
 */
export function readGhCalls(logPath: string): string[][] {
    return fs
        .readFileSync(logPath, 'utf8')
        .split(/\r?\n/)
        .map(l => l.trim())
        .filter(Boolean)
        .map(l => JSON.parse(l));
}

/**
 * List contents of a zip file
 */
export function unzipList(zipAbsPath: string, cwd: string): string {
    const res = run('unzip', ['-l', zipAbsPath], cwd);
    if (res.code !== 0) throw new Error(`unzip failed: ${res.stderr || res.stdout}`);
    return res.stdout;
}

/**
 * Extract a file from a zip
 */
export function unzipFile(zipAbsPath: string, fileName: string, cwd: string): string {
    const res = run('unzip', ['-p', zipAbsPath, fileName], cwd);
    if (res.code !== 0) throw new Error(`unzip failed: ${res.stderr || res.stdout}`);
    return res.stdout;
}

/**
 * Create a minimal package.json
 */
export function makeMinimalPackageJson(root: string): void {
    writeFile(
        root,
        'package.json',
        JSON.stringify({
            name: 'x',
            description: 'x',
            license: 'MIT',
            repository: { url: 'https://example.com/x' },
            keywords: [],
        }),
    );
}

/**
 * Copy scaffold scripts to a project directory
 * Also symlinks node_modules so scripts can find their dependencies
 */
export function copyScriptsToProject(root: string): string {
    const scriptsDir = path.join(root, 'scripts');
    copyDir(TEMPLATE_SCRIPTS_DIR, scriptsDir);
    
    // Symlink node_modules from prompt-registry so scripts can find dependencies
    // (archiver, semver, js-yaml, yauzl, etc.)
    const promptRegistryRoot = path.resolve(__dirname, '../..');
    const sourceNodeModules = path.join(promptRegistryRoot, 'node_modules');
    const targetNodeModules = path.join(root, 'node_modules');
    
    if (fs.existsSync(sourceNodeModules) && !fs.existsSync(targetNodeModules)) {
        try {
            fs.symlinkSync(sourceNodeModules, targetNodeModules, 'dir');
        } catch (e) {
            // Fallback: copy if symlink fails (e.g., on some Windows configs)
            // This is slower but more reliable
        }
    }
    
    return scriptsDir;
}

/**
 * Get the prompt-registry node_modules path for NODE_PATH
 */
export function getNodeModulesPath(): string {
    // When running from test-dist, we need to go up to the project root
    // __dirname in compiled code is test-dist/test/helpers
    // We need to get to prompt-registry/node_modules
    const testDistHelpers = __dirname;
    const projectRoot = path.resolve(testDistHelpers, '../../..');
    return path.join(projectRoot, 'node_modules');
}

/**
 * Create a test project with optional setup
 */
export function createTestProject(prefix: string, options: TestProjectOptions = {}): TestProject {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    
    if (options.withPackageJson !== false) {
        makeMinimalPackageJson(root);
    }
    
    let scriptsDir = '';
    if (options.copyScripts !== false) {
        scriptsDir = copyScriptsToProject(root);
    }
    
    if (options.initGit) {
        initGitRepo(root);
    }
    
    return {
        root,
        scriptsDir,
        cleanup: () => {
            if (fs.existsSync(root)) {
                fs.rmSync(root, { recursive: true, force: true });
            }
        }
    };
}

/**
 * Create a collection YAML file
 */
export function createCollection(root: string, id: string, options: {
    name?: string;
    description?: string;
    version?: string;
    items?: Array<{ path: string; kind: string }>;
} = {}): string {
    const name = options.name || id.toUpperCase();
    const description = options.description || name;
    const items = options.items || [];
    
    const lines = [
        `id: ${id}`,
        `name: ${name}`,
        `description: ${description}`,
    ];
    
    if (options.version) {
        lines.push(`version: "${options.version}"`);
    }
    
    lines.push('items:');
    for (const item of items) {
        lines.push(`  - path: ${item.path}`);
        lines.push(`    kind: ${item.kind}`);
    }
    
    return writeFile(root, `collections/${id}.collection.yml`, lines.join('\n') + '\n');
}

/**
 * Create a prompt file
 */
export function createPrompt(root: string, relativePath: string, title: string): string {
    return writeFile(root, relativePath, `# ${title}\n`);
}

/**
 * Get environment for running scripts with gh stub
 */
export function getScriptEnv(ghStub: GhStubResult): NodeJS.ProcessEnv {
    return {
        ...process.env,
        PATH: `${ghStub.binDir}:${process.env.PATH || ''}`,
        GH_STUB_LOG: ghStub.logPath,
        GH_TOKEN: 'x',
        GITHUB_TOKEN: 'x',
        GITHUB_REPOSITORY: 'owner/repo',
        NODE_PATH: getNodeModulesPath(),
    };
}

/**
 * Get environment for running scripts (without gh stub)
 */
export function getBasicScriptEnv(): NodeJS.ProcessEnv {
    return {
        ...process.env,
        NODE_PATH: getNodeModulesPath(),
    };
}

/**
 * Assert that a gh release create was called with expected assets
 */
export function assertReleaseCreateCalledWithAssets(options: {
    calls: string[][];
    tag: string;
    mustInclude: RegExp[];
}): { zipArg: string; manifestArg: string; listing: string } {
    const { calls, tag, mustInclude } = options;
    const creates = calls.filter(c => c[0] === 'release' && c[1] === 'create' && c[2] === tag);
    
    if (creates.length !== 1) {
        throw new Error(`Expected one gh release create for ${tag}, got ${creates.length}`);
    }

    const args = creates[0];
    const zipArg = args[args.length - 2];
    const manifestArg = args[args.length - 1];

    if (!fs.existsSync(zipArg)) {
        throw new Error(`Missing zip asset at ${zipArg}`);
    }
    if (!fs.existsSync(manifestArg)) {
        throw new Error(`Missing manifest asset at ${manifestArg}`);
    }

    const listing = unzipList(zipArg, path.dirname(zipArg));
    
    if (!/deployment-manifest\.yml/.test(listing)) {
        throw new Error('Zip does not contain deployment-manifest.yml');
    }
    
    for (const re of mustInclude) {
        if (!re.test(listing)) {
            throw new Error(`Zip listing does not match ${re}: ${listing}`);
        }
    }

    return { zipArg, manifestArg, listing };
}

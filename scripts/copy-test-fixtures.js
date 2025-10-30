#!/usr/bin/env node
/**
 * Copy test fixtures and non-TypeScript test files to test-dist directory
 * TypeScript compiler only compiles .ts files, so we need to copy .js files manually
 */
const fs = require('fs');
const path = require('path');

const TEST_DIR = path.join(__dirname, '..', 'test');
const TEST_DIST_DIR = path.join(__dirname, '..', 'test-dist', 'test');

// Files and directories to copy (relative to test directory)
const ITEMS_TO_COPY = [
    'fixtures',           // Test fixture data
    'suite/index.js',     // Integration test entry point
    'mocks/loggerMockSetup.js',
    'mocks/loggerMocks.js',
    'mocks/githubMocks.js',
    'mocks/testSetup.js',
    'helpers/mockData.js',
    'vscode-mock.js',
    'mocha.setup.js',
    'unit.setup.js'
];

try {
    let copiedCount = 0;
    
    for (const item of ITEMS_TO_COPY) {
        const sourcePath = path.join(TEST_DIR, item);
        const destPath = path.join(TEST_DIST_DIR, item);
        
        if (!fs.existsSync(sourcePath)) {
            console.log(`⚠️  Skipping ${item} (not found)`);
            continue;
        }
        
        // Ensure destination directory exists
        fs.mkdirSync(path.dirname(destPath), { recursive: true });
        
        // Copy file or directory
        const stats = fs.statSync(sourcePath);
        if (stats.isDirectory()) {
            fs.cpSync(sourcePath, destPath, { 
                recursive: true,
                errorOnExist: false,
                force: true 
            });
            console.log(`✅ Copied directory: ${item}`);
        } else {
            fs.copyFileSync(sourcePath, destPath);
            console.log(`✅ Copied file: ${item}`);
        }
        copiedCount++;
    }
    
    console.log(`\n🎉 Successfully copied ${copiedCount} items to test-dist`);
    
} catch (error) {
    console.error(`❌ Error copying test files: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
}

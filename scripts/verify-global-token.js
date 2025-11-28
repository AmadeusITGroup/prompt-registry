#!/usr/bin/env node

/**
 * Verification script for global token enrichment
 * This script helps verify that the global token fix is working correctly
 */

const vscode = require('vscode');

console.log('\n=== Global Token Fix Verification ===\n');

// Check if global token is configured
const config = vscode.workspace.getConfiguration('promptregistry');
const globalToken = config.get('githubToken', '');

if (!globalToken || globalToken.trim().length === 0) {
    console.log('❌ No global GitHub token configured');
    console.log('\nTo configure:');
    console.log('1. Open VS Code Settings (Cmd+, or Ctrl+,)');
    console.log('2. Search for "promptregistry.githubToken"');
    console.log('3. Paste your GitHub Personal Access Token');
    console.log('\nToken requirements:');
    console.log('- Must have "repo" scope');
    console.log('- Must be authorized for SSO if accessing organization repos');
    process.exit(1);
}

console.log('✅ Global GitHub token is configured');
console.log(`   Token preview: ${globalToken.substring(0, 8)}...`);
console.log(`   Token length: ${globalToken.length} characters`);

// Verify token format
if (globalToken.startsWith('ghp_') || globalToken.startsWith('github_pat_')) {
    console.log('✅ Token format looks correct');
} else {
    console.log('⚠️  Token format may be incorrect (should start with ghp_ or github_pat_)');
}

console.log('\n=== Next Steps ===\n');
console.log('1. Try adding your private repository:');
console.log('   - Run: "Prompt Registry: Add Source"');
console.log('   - Select: "GitHub Repository"');
console.log('   - Enter URL: https://github.com/your-org/your-repo');
console.log('   - Select: "Private"');
console.log('   - Leave token field empty (will use global token)');
console.log('\n2. Check the Output panel:');
console.log('   - View → Output');
console.log('   - Select "Prompt Registry" from dropdown');
console.log('   - Look for: "[RegistryManager] Applying global GitHub token"');
console.log('\n3. If validation succeeds, the fix is working! ✨\n');

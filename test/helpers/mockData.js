'use strict';
/**
 * Mock data and utilities for testing Prompt Registry bundle functionality
 */
Object.defineProperty(exports, '__esModule', { value: true });
exports.cleanupTestWorkspace = exports.createTestWorkspace = exports.validateBundleContent = exports.loadBundleContentFromFixtures = exports.createMockReleaseResponse = void 0;
/**
 * Mock GitHub release response simulating Prompt Registry bundle releases
 * @param version
 */
const createMockReleaseResponse = (version = 'v1.2.3') => ({
  id: 123_456,
  tag_name: version,
  name: `Prompt Registry Bundle Release ${version}`,
  published_at: '2025-09-16T08:00:00Z',
  assets: [
    {
      id: 1,
      name: 'vscode-bundle.zip',
      browser_download_url: `https://github.com/test-owner/test-repo/releases/download/${version}/vscode-bundle.zip`,
      size: 4096,
      content_type: 'application/zip'
    },
    {
      id: 2,
      name: 'windsurf-bundle.zip',
      browser_download_url: `https://github.com/test-owner/test-repo/releases/download/${version}/windsurf-bundle.zip`,
      size: 3072,
      content_type: 'application/zip'
    },
    {
      id: 3,
      name: 'cursor-bundle.zip',
      browser_download_url: `https://github.com/test-owner/test-repo/releases/download/${version}/cursor-bundle.zip`,
      size: 2048,
      content_type: 'application/zip'
    },
    {
      id: 4,
      name: 'kiro-bundle.zip',
      browser_download_url: `https://github.com/test-owner/test-repo/releases/download/${version}/kiro-bundle.zip`,
      size: 2560,
      content_type: 'application/zip'
    }
  ]
});
exports.createMockReleaseResponse = createMockReleaseResponse;
/**
 * Load actual file content from test fixtures
 */
const loadBundleContentFromFixtures = () => {
  const path = require('node:path');
  const fs = require('node:fs');
  const fixturesPath = path.join(__dirname, '..', '..', '..', 'test', 'fixtures', 'platform-bundles');
  const bundles = {};
  const platforms = ['vscode', 'windsurf', 'cursor', 'kiro'];
  for (const platform of platforms) {
    const platformPath = path.join(fixturesPath, `${platform}-bundle`);
    bundles[platform] = {};
    if (fs.existsSync(platformPath)) {
      const loadFilesRecursively = (dir, relativePath = '') => {
        const items = fs.readdirSync(dir);
        for (const item of items) {
          const fullPath = path.join(dir, item);
          const relativeFilePath = relativePath ? path.join(relativePath, item) : item;
          if (fs.statSync(fullPath).isDirectory()) {
            loadFilesRecursively(fullPath, relativeFilePath);
          } else {
            const content = fs.readFileSync(fullPath, 'utf8');
            bundles[platform][relativeFilePath] = content;
          }
        }
      };
      loadFilesRecursively(platformPath);
    }
  }
  return bundles;
};
exports.loadBundleContentFromFixtures = loadBundleContentFromFixtures;
/**
 * Validate that a bundle contains expected platform-specific content
 * @param platform
 * @param files
 */
const validateBundleContent = (platform, files) => {
  const validationRules = {
    vscode: {
      requiredFiles: ['copilot-instructions.md'],
      requiredKeywords: ['VSCode', 'extension', 'TypeScript'],
      optionalFiles: ['prompts/development-assistant.md', 'prompts/debugging-expert.md']
    },
    windsurf: {
      requiredFiles: ['core-principles.md'],
      requiredKeywords: ['Windsurf', 'collaborative', 'cascade'],
      optionalFiles: ['workflows/full-stack-development.md']
    },
    cursor: {
      requiredFiles: ['ai-development-guide.md'],
      requiredKeywords: ['Cursor', 'AI', 'prediction'],
      optionalFiles: ['prompt-engineering.md']
    },
    kiro: {
      requiredFiles: ['development-methodology.md'],
      requiredKeywords: ['Kiro', 'rapid', 'iteration'],
      optionalFiles: ['testing-strategy.md']
    }
  };
  const rules = validationRules[platform];
  if (!rules) {
    return false;
  }
  // Check required files
  for (const requiredFile of rules.requiredFiles) {
    if (!files.hasOwnProperty(requiredFile)) {
      return false;
    }
  }
  // Check for required keywords in content
  const allContent = Object.values(files).join(' ').toLowerCase();
  for (const keyword of rules.requiredKeywords) {
    if (!allContent.includes(keyword.toLowerCase())) {
      return false;
    }
  }
  return true;
};
exports.validateBundleContent = validateBundleContent;
/**
 * Create a temporary workspace directory for testing
 */
const createTestWorkspace = () => {
  const path = require('node:path');
  const fs = require('node:fs');
  const os = require('node:os');
  const testDir = path.join(os.tmpdir(), `olaf-test-${Date.now()}`);
  fs.mkdirSync(testDir, { recursive: true });
  return testDir;
};
exports.createTestWorkspace = createTestWorkspace;
/**
 * Clean up test workspace
 * @param workspacePath
 */
const cleanupTestWorkspace = (workspacePath) => {
  const fs = require('node:fs');
  if (fs.existsSync(workspacePath)) {
    fs.rmSync(workspacePath, { recursive: true, force: true });
  }
};
exports.cleanupTestWorkspace = cleanupTestWorkspace;
// # sourceMappingURL=mockData.js.map

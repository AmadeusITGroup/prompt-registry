/**
 * Test Setup Helper
 * Provides utilities for configuring mocks and test environment
 */

const { MockGitHubService } = require('./githubMocks');
const { MockLogger } = require('./loggerMocks');

/**
 * Test environment configuration
 */
class TestSetup {
  constructor() {
    this.mocks = {};
    this.originalModules = {};
  }

  /**
   * Setup GitHub API mocking
   * Replaces GitHubService with MockGitHubService
   */
  setupGitHubMocks() {
    this.mocks.githubService = new MockGitHubService();
    return this.mocks.githubService;
  }

  /**
   * Setup Logger mocking
   * Replaces logger with MockLogger
   */
  setupLoggerMocks() {
    this.mocks.logger = new MockLogger();
    return this.mocks.logger;
  }

  /**
   * Check if GitHub API is available
   * Returns true if GITHUB_TOKEN is available or should use mocks
   */
  shouldUseGitHubMocks() {
    // Use mocks if no token available or if explicitly requested
    return !process.env.GITHUB_TOKEN || process.env.USE_GITHUB_MOCKS === 'true';
  }

  /**
   * Check if tests should skip GitHub API calls entirely
   */
  shouldSkipGitHubTests() {
    return process.env.SKIP_GITHUB_TESTS === 'true';
  }

  /**
   * Get mock instances
   */
  getMocks() {
    return this.mocks;
  }

  /**
   * Reset all mocks to initial state
   */
  resetMocks() {
    Object.values(this.mocks).forEach((mock) => {
      if (mock.resetCallCounts) {
        mock.resetCallCounts();
      }
      if (mock.clearLogs) {
        mock.clearLogs();
      }
    });
  }

  /**
   * Cleanup - restore original modules
   */
  cleanup() {
    this.resetMocks();
    this.mocks = {};
  }
}

/**
 * Global test setup instance
 */
const testSetup = new TestSetup();

/**
 * Helper function to conditionally run tests based on environment
 * @param title
 * @param testFn
 */
function describeWithGitHub(title, testFn) {
  const shouldSkip = testSetup.shouldSkipGitHubTests();
  return (shouldSkip ? describe.skip : describe)(title, testFn);
}

/**
 * Helper function to get GitHub service (real or mock)
 */
function getGitHubService() {
  if (testSetup.shouldUseGitHubMocks()) {
    return testSetup.setupGitHubMocks();
  }
  // Return real GitHub service if available
  const { GitHubService } = require('../../src/services/githubService');
  return new GitHubService();
}

/**
 * Helper function to get logger (real or mock)
 */
function getLogger() {
  // Always use mock logger in tests to avoid channel disposal issues
  return testSetup.setupLoggerMocks();
}

module.exports = {
  TestSetup,
  testSetup,
  describeWithGitHub,
  getGitHubService,
  getLogger
};

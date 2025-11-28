// Mock vscode module for unit tests
const path = require('path');
const Module = require('module');

// Ensure this is running in Mocha context
if (typeof global.suite === 'undefined' && typeof global.describe === 'undefined') {
  console.warn('[mocha.setup.js] Warning: Mocha test functions not available yet. This file should be loaded via --require flag.');
}

// Clear module cache to ensure fresh mocks
Object.keys(require.cache).forEach(key => {
  if (key.includes('vscode') || key.includes('logger')) {
    delete require.cache[key];
  }
});

// Intercept vscode module loading
const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain) {
  if (request === 'vscode') {
    return path.resolve(__dirname, 'mocha.setup.js');
  }
  return originalResolveFilename.call(this, request, parent, isMain);
};

// Mock vscode API
const vscode = {
  workspace: {
    getConfiguration: (section) => ({
      get: (key, defaultValue) => {
        // Return mock configuration values for testing
        if (section === 'olaf') {
          const config = {
            'repositoryOwner': 'test-owner',
            'repositoryName': 'test-repo',
            'githubToken': 'test-token',
            'usePrivateRepository': false
          };
          return config[key] || defaultValue;
        }
        return defaultValue;
      },
      update: async (key, value, target) => undefined
    })
  },
  window: {
    showInformationMessage: () => Promise.resolve(),
    showWarningMessage: () => Promise.resolve(),
    showErrorMessage: () => Promise.resolve(),
    showInputBox: (options) => Promise.resolve(undefined),
    showQuickPick: (items, options) => Promise.resolve(undefined),
    showSaveDialog: (options) => Promise.resolve(undefined),
    showOpenDialog: (options) => Promise.resolve(undefined),
    createOutputChannel: (name) => {
      const channel = {
        appendLine: function() { return undefined; },
        clear: function() { return undefined; },
        show: function() { return undefined; },
        dispose: function() { return undefined; }
      };
      return channel;
    }
  },
  authentication: {
    // Mock authentication API for GitHub tests
    getSession: async () => undefined,
    onDidChangeSessions: () => ({ dispose: () => {} })
  },
  Uri: {
    file: (path) => ({
      fsPath: path,
      scheme: 'file',
      authority: '',
      path: path,
      query: '',
      fragment: ''
    })
  },
  EventEmitter: class EventEmitter {
    constructor() {
      this.listeners = [];
    }
    get event() {
      return (listener) => {
        this.listeners.push(listener);
        return { dispose: () => {} };
      };
    }
    fire(data) {
      this.listeners.forEach(listener => listener(data));
    }
    dispose() {
      this.listeners = [];
    }
  },
  env: {
    appName: 'Visual Studio Code',
    appRoot: '/mock/app/root',
    language: 'en',
    machineId: 'mock-machine-id',
    sessionId: 'mock-session-id',
    remoteName: undefined,
    shell: '/bin/bash'
  },
  ConfigurationTarget: {
    Global: 1,
    Workspace: 2,
    WorkspaceFolder: 3
  }
};

module.exports = vscode;

// Also set it globally
global.vscode = vscode;

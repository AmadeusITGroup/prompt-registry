// Mock vscode module for unit tests
const path = require('path');
const fs = require('fs');
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
  FileType: {
    Unknown: 0,
    File: 1,
    Directory: 2,
    SymbolicLink: 64
  },
  workspace: {
    fs: {
      createDirectory: (uri) => {
          if (uri.scheme === 'file') {
              return fs.promises.mkdir(uri.fsPath, { recursive: true });
          }
          return Promise.resolve();
      },
      writeFile: (uri, content) => {
          if (uri.scheme === 'file') {
              return fs.promises.writeFile(uri.fsPath, content);
          }
          return Promise.resolve();
      },
      readFile: (uri) => {
          if (uri.scheme === 'file') {
              return fs.promises.readFile(uri.fsPath);
          }
          return Promise.resolve(new Uint8Array());
      },
      stat: (uri) => {
          if (uri.scheme === 'file') {
              return fs.promises.stat(uri.fsPath).then(stats => {
                  return {
                      type: stats.isDirectory() ? 2 : (stats.isFile() ? 1 : 0),
                      ctime: stats.ctimeMs,
                      mtime: stats.mtimeMs,
                      size: stats.size
                  };
              });
          }
          return Promise.resolve({ type: 1, ctime: 0, mtime: 0, size: 0 });
      },
      readDirectory: (uri) => {
          if (uri.scheme === 'file') {
              return fs.promises.readdir(uri.fsPath, { withFileTypes: true }).then(entries => {
                  return entries.map(e => [e.name, e.isDirectory() ? 2 : 1]);
              });
          }
          return Promise.resolve([]);
      }
    },
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
    }),
    workspaceFolders: [
        {
            uri: { fsPath: '/mock/workspace' },
            name: 'workspace',
            index: 0
        }
    ]
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
    },
    withProgress: (options, task) => task({ report: () => {} })
  },
  commands: {
    registerCommand: (command, callback) => ({ dispose: () => {} }),
    executeCommand: (command, ...args) => Promise.resolve(undefined),
    getCommands: () => Promise.resolve([])
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
      fragment: '',
      toString: () => `file://${path}`
    }),
    joinPath: (base, ...segments) => {
        const pathModule = require('path');
        const joined = pathModule.join(base.path, ...segments);
        return {
            fsPath: joined,
            scheme: base.scheme,
            authority: base.authority,
            path: joined,
            query: '',
            fragment: '',
            toString: () => `${base.scheme}://${joined}`
        };
    },
    parse: (value) => ({
        fsPath: value,
        scheme: 'file',
        path: value
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
  },
  ProgressLocation: {
    SourceControl: 1,
    Window: 10,
    Notification: 15
  }
};

module.exports = vscode;

// Also set it globally
global.vscode = vscode;

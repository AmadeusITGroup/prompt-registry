// Mock vscode API for unit tests
module.exports = {
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
    showQuickPick: () => Promise.resolve(),
    createOutputChannel: (name) => ({
      appendLine: () => undefined,
      show: () => undefined,
      dispose: () => undefined
    }),
    withProgress: async (options, task) => {
      const progress = { report: () => undefined };
      return await task(progress);
    }
  },
  // Add missing TreeView related mocks
  TreeItem: class {
    constructor(label, collapsibleState) {
      this.label = label;
      this.collapsibleState = collapsibleState;
    }
  },
  TreeItemCollapsibleState: {
    None: 0,
    Collapsed: 1,
    Expanded: 2
  },
  EventEmitter: class {
    constructor() {
      this.event = (listener) => ({ dispose: () => {} });
    }
    fire(data) {}
    dispose() {}
  },
  ThemeIcon: class {
    constructor(id) {
      this.id = id;
    }
  },
  Uri: {
    file: (path) => ({ fsPath: path, scheme: 'file' }),
    parse: (path) => ({ fsPath: path, scheme: 'file' }),
    joinPath: (base, ...segments) => ({ fsPath: base.fsPath + '/' + segments.join('/'), scheme: 'file' })
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
  authentication: {
    getSession: () => Promise.resolve(undefined)
  },
  ConfigurationTarget: {
    Global: 1,
    Workspace: 2,
    WorkspaceFolder: 3
  },
  commands: {
    executeCommand: () => Promise.resolve()
  },
  ProgressLocation: {
    Notification: 15,
    Window: 10,
    SourceControl: 1
  }
};

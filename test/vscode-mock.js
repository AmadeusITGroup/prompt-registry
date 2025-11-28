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
    createOutputChannel: (name) => ({
      appendLine: () => undefined,
      show: () => undefined,
      dispose: () => undefined
    })
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

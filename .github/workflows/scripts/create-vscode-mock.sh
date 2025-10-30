#!/bin/bash
echo "Creating VS Code mock..."

# Create vscode-mock.js if it doesn't exist
if [ ! -f "test-dist/test/vscode-mock.js" ]; then
    mkdir -p test-dist/test
    cat > test-dist/test/vscode-mock.js << 'MOCK_EOF'
// VS Code API mock for testing
module.exports = {
  window: {
    createOutputChannel: () => ({
      appendLine: () => {},
      show: () => {},
      clear: () => {},
      dispose: () => {}
    }),
    showInformationMessage: () => Promise.resolve(),
    showWarningMessage: () => Promise.resolve(),
    showErrorMessage: () => Promise.resolve()
  },
  workspace: {
    getConfiguration: () => ({
      get: () => undefined,
      update: () => Promise.resolve()
    })
  },
  commands: {
    registerCommand: () => ({ dispose: () => {} }),
    executeCommand: () => Promise.resolve()
  }
};
MOCK_EOF
fi

echo "VS Code mock created"

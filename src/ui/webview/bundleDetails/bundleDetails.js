// Bundle Details View JavaScript
// Initialized with data from TypeScript via window.bundleDetailsData

(function() {
    'use strict';

    var vscode = acquireVsCodeApi();
    
    // Get initial data from window object (set by TypeScript)
    var autoUpdateEnabled = window.bundleDetailsData ? window.bundleDetailsData.autoUpdateEnabled : false;
    var bundleId = window.bundleDetailsData ? window.bundleDetailsData.bundleId : '';

    /**
     * Open a prompt file in the editor
     */
    function openPromptFile(installPath, filePath) {
        vscode.postMessage({
            type: 'openPromptFile',
            installPath: installPath,
            filePath: filePath
        });
    }

    /**
     * Toggle auto-update setting
     */
    function toggleAutoUpdate() {
        autoUpdateEnabled = !autoUpdateEnabled;
        updateToggleUI();
        vscode.postMessage({
            type: 'toggleAutoUpdate',
            bundleId: bundleId,
            enabled: autoUpdateEnabled
        });
    }

    /**
     * Update the toggle UI to reflect current state
     */
    function updateToggleUI() {
        var toggle = document.getElementById('autoUpdateToggle');
        if (toggle) {
            if (autoUpdateEnabled) {
                toggle.classList.add('enabled');
            } else {
                toggle.classList.remove('enabled');
            }
        }
    }

    // Listen for status updates from extension
    window.addEventListener('message', function(event) {
        var message = event.data;
        if (message.type === 'autoUpdateStatusChanged') {
            autoUpdateEnabled = message.enabled;
            updateToggleUI();
        }
    });

    // Event delegation for all click handlers (CSP compliant)
    document.addEventListener('click', function(e) {
        var target = e.target;
        var actionElement = target.closest('[data-action]');
        
        if (actionElement) {
            var action = actionElement.dataset.action;
            var installPath = actionElement.dataset.installPath;
            var filePath = actionElement.dataset.filePath;
            
            switch (action) {
                case 'openPromptFile':
                    if (installPath && filePath) { openPromptFile(installPath, filePath); }
                    break;
                case 'toggleAutoUpdate':
                    toggleAutoUpdate();
                    break;
            }
        }
    });
})();

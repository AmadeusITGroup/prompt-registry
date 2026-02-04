// Bundle Details View JavaScript
// Initialized with data from TypeScript via window.bundleDetailsData

(function() {
    'use strict';

    const vscode = acquireVsCodeApi();
    
    // Get initial data from window object (set by TypeScript)
    let autoUpdateEnabled = window.bundleDetailsData?.autoUpdateEnabled || false;
    const bundleId = window.bundleDetailsData?.bundleId || '';

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
        const toggle = document.getElementById('autoUpdateToggle');
        if (toggle) {
            if (autoUpdateEnabled) {
                toggle.classList.add('enabled');
            } else {
                toggle.classList.remove('enabled');
            }
        }
    }

    /**
     * Open unified feedback dialog (star rating + binary feedback + optional issue redirect)
     */
    function feedback() {
        vscode.postMessage({
            type: 'feedback',
            bundleId: bundleId
        });
    }

    // Listen for status updates from extension
    window.addEventListener('message', function(event) {
        const message = event.data;
        if (message.type === 'autoUpdateStatusChanged') {
            autoUpdateEnabled = message.enabled;
            updateToggleUI();
        }
    });

    // Event delegation for all click handlers (CSP compliant)
    document.addEventListener('click', function(e) {
        const target = e.target;
        const actionElement = target.closest('[data-action]');
        
        if (actionElement) {
            const action = actionElement.dataset.action;
            const installPath = actionElement.dataset.installPath;
            const filePath = actionElement.dataset.filePath;
            
            switch (action) {
                case 'openPromptFile':
                    if (installPath && filePath) openPromptFile(installPath, filePath);
                    break;
                case 'toggleAutoUpdate':
                    toggleAutoUpdate();
                    break;
                case 'feedback':
                    feedback();
                    break;
            }
        }
    });
})();

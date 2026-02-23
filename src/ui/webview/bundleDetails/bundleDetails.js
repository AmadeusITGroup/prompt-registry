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

    // ========================================================================
    // Interactive Star Rating
    // ========================================================================

    let selectedRating = 0;
    const starsContainer = document.getElementById('detailStars');
    const feedbackForm = document.getElementById('detailFeedbackForm');
    const submitBtn = document.getElementById('submitFeedbackBtn');
    const cancelBtn = document.getElementById('cancelFeedbackBtn');

    if (starsContainer) {
        const stars = starsContainer.querySelectorAll('.star');

        // Hover preview
        stars.forEach(star => {
            star.addEventListener('mouseover', () => {
                const val = parseInt(star.dataset.star);
                stars.forEach(s => {
                    const sv = parseInt(s.dataset.star);
                    s.classList.toggle('hovered', sv <= val);
                });
            });

            star.addEventListener('mouseout', () => {
                stars.forEach(s => {
                    s.classList.remove('hovered');
                    const sv = parseInt(s.dataset.star);
                    s.classList.toggle('filled', sv <= selectedRating);
                });
            });

            // Click to select rating
            star.addEventListener('click', () => {
                selectedRating = parseInt(star.dataset.star);
                stars.forEach(s => {
                    const sv = parseInt(s.dataset.star);
                    s.classList.toggle('filled', sv <= selectedRating);
                    s.classList.remove('hovered');
                });

                // Show inline feedback form
                if (feedbackForm) {
                    feedbackForm.classList.add('visible');
                    feedbackForm.querySelector('textarea')?.focus();
                }

                // Update label
                const label = starsContainer.querySelector('.star-label');
                if (label) {
                    label.textContent = selectedRating + ' star' + (selectedRating > 1 ? 's' : '') + ' selected';
                }
            });
        });
    }

    // Submit feedback
    if (submitBtn) {
        submitBtn.addEventListener('click', () => {
            if (selectedRating === 0) return;
            const textarea = feedbackForm.querySelector('textarea');
            const comment = textarea ? textarea.value.trim() : '';

            vscode.postMessage({
                type: 'submitFeedback',
                bundleId: bundleId,
                rating: selectedRating,
                comment: comment || undefined,
            });

            // Disable submit while pending
            submitBtn.disabled = true;
            submitBtn.textContent = 'Submitting...';
        });
    }

    // Cancel feedback
    if (cancelBtn) {
        cancelBtn.addEventListener('click', () => {
            if (feedbackForm) {
                feedbackForm.classList.remove('visible');
            }
        });
    }

    // Listen for messages from extension
    window.addEventListener('message', function(event) {
        const message = event.data;
        if (message.type === 'autoUpdateStatusChanged') {
            autoUpdateEnabled = message.enabled;
            updateToggleUI();
        } else if (message.type === 'feedbackSubmitted') {
            if (feedbackForm) {
                feedbackForm.classList.remove('visible');
                const textarea = feedbackForm.querySelector('textarea');
                if (textarea) textarea.value = '';
            }
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Submit';
            }

            // Show success message
            const section = document.querySelector('.rating-section');
            if (section && message.success) {
                const existing = section.querySelector('.feedback-success');
                if (existing) existing.remove();
                const msg = document.createElement('div');
                msg.className = 'feedback-success';
                msg.textContent = message.synced ? 'Thank you for your feedback!' : 'Feedback saved locally.';
                section.appendChild(msg);
                setTimeout(() => msg.remove(), 4000);
            }
        }
    });

    // Event delegation for remaining click handlers (CSP compliant)
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
            }
        }
    });
})();

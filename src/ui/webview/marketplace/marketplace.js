// Marketplace View JavaScript
// Uses IIFE pattern for encapsulation

(function() {
    'use strict';

    const vscode = acquireVsCodeApi();
    let allBundles = [];
    let filterOptions = { tags: [], sources: [] };
    let selectedSource = 'all';
    let selectedTags = [];
    let showInstalledOnly = false;
    let selectedSort = 'name-asc';

    // Handle messages from extension
    window.addEventListener('message', event => {
    const message = event.data;
    
    if (message.type === 'bundlesLoaded') {
        allBundles = message.bundles;
        filterOptions = message.filterOptions || { tags: [], sources: [] };
        updateFilterUI();
        renderBundles();
    } else if (message.type === 'feedbacksLoaded') {
        renderFeedbackModal(message.bundleId, message.feedbacks, message.rating);
    }
});

// Request initial data when webview is ready
// This ensures we get data even if the extension sent it before we were listening
vscode.postMessage({ type: 'refresh' });

// Update filter dropdowns with dynamic data
function updateFilterUI() {
    const sourceList = document.getElementById('sourceList');
    const tagList = document.getElementById('tagList');

    // Populate source dropdown with radio buttons
    sourceList.innerHTML = '';
    
    // Add "All Sources" option
    const allItem = document.createElement('div');
    allItem.className = 'source-item' + (selectedSource === 'all' ? ' active' : '');
    allItem.dataset.source = 'all';
    allItem.innerHTML = `
        <input type="radio" name="source" id="source-all" value="all" ${selectedSource === 'all' ? 'checked' : ''}>
        <label for="source-all">All Sources</label>
    `;
    sourceList.appendChild(allItem);
    
    // Add source options
    filterOptions.sources.forEach(source => {
        const sourceItem = document.createElement('div');
        sourceItem.className = 'source-item' + (selectedSource === source.id ? ' active' : '');
        sourceItem.dataset.source = source.id;
        sourceItem.innerHTML = `
            <input type="radio" name="source" id="source-${source.id}" value="${source.id}" ${selectedSource === source.id ? 'checked' : ''}>
            <label for="source-${source.id}">${source.name} (${source.bundleCount})</label>
        `;
        sourceList.appendChild(sourceItem);
        
        // Add click handler
        sourceItem.addEventListener('click', () => {
            document.querySelectorAll('.source-item').forEach(i => i.classList.remove('active'));
            sourceItem.classList.add('active');
            selectedSource = source.id;
            document.getElementById('sourceSelectorText').textContent = `${source.name} (${source.bundleCount})`;
            sourceItem.querySelector('input[type="radio"]').checked = true;
            document.getElementById('sourceDropdown').style.display = 'none';
            renderBundles();
        });
    });
    
    // Add click handler for "All Sources"
    allItem.addEventListener('click', () => {
        document.querySelectorAll('.source-item').forEach(i => i.classList.remove('active'));
        allItem.classList.add('active');
        selectedSource = 'all';
        document.getElementById('sourceSelectorText').textContent = 'All Sources';
        allItem.querySelector('input[type="radio"]').checked = true;
        document.getElementById('sourceDropdown').style.display = 'none';
        renderBundles();
    });

    // Populate tag list with checkboxes
    tagList.innerHTML = '';
    filterOptions.tags.forEach(tag => {
        const tagItem = document.createElement('div');
        tagItem.className = 'tag-item';
        tagItem.dataset.tag = tag;
        
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = 'tag-' + tag;
        checkbox.value = tag;
        
        const label = document.createElement('label');
        label.htmlFor = 'tag-' + tag;
        label.textContent = tag;
        label.style.cursor = 'pointer';
        label.style.flex = '1';
        
        tagItem.appendChild(checkbox);
        tagItem.appendChild(label);
        
        // Toggle checkbox on item click
        tagItem.addEventListener('click', (e) => {
            if (e.target !== checkbox) {
                checkbox.checked = !checkbox.checked;
            }
            updateSelectedTags();
        });
        
        tagList.appendChild(tagItem);
    });
}

// Update selected tags from checkboxes
function updateSelectedTags() {
    const checkboxes = document.querySelectorAll('#tagList input[type="checkbox"]:checked');
    selectedTags = Array.from(checkboxes).map(cb => cb.value);
    updateTagButtonText();
    renderBundles();
}

// Update the tag button text based on selection
function updateTagButtonText() {
    const tagSelectorText = document.getElementById('tagSelectorText');
    if (selectedTags.length === 0) {
        tagSelectorText.textContent = 'All Tags';
    } else if (selectedTags.length === 1) {
        tagSelectorText.textContent = selectedTags[0];
    } else {
        tagSelectorText.textContent = `${selectedTags.length} tags`;
    }
}

// Toggle tag dropdown
document.getElementById('tagSelectorBtn').addEventListener('click', () => {
    const dropdown = document.getElementById('tagDropdown');
    dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
    
    if (dropdown.style.display === 'block') {
        document.getElementById('tagSearch').focus();
    }
});

// Close dropdown when clicking outside
document.addEventListener('click', (e) => {
    const tagSelector = document.querySelector('.tag-selector');
    const dropdown = document.getElementById('tagDropdown');
    
    if (!tagSelector.contains(e.target) && dropdown.style.display === 'block') {
        dropdown.style.display = 'none';
    }
});

// Tag search functionality
document.getElementById('tagSearch').addEventListener('input', (e) => {
    const searchTerm = e.target.value.toLowerCase();
    const tagItems = document.querySelectorAll('.tag-item');
    
    tagItems.forEach(item => {
        const tagName = item.dataset.tag.toLowerCase();
        if (tagName.includes(searchTerm)) {
            item.classList.remove('hidden');
        } else {
            item.classList.add('hidden');
        }
    });
});

// Search functionality
document.getElementById('searchBox').addEventListener('input', (e) => {
    renderBundles();
});

// Source selector button click
document.getElementById('sourceSelectorBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    const dropdown = document.getElementById('sourceDropdown');
    dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
    
    if (dropdown.style.display === 'block') {
        document.getElementById('sourceSearch').focus();
    }
});

// Close source dropdown when clicking outside
document.addEventListener('click', (e) => {
    const sourceSelector = document.querySelector('.source-selector');
    const dropdown = document.getElementById('sourceDropdown');
    
    if (sourceSelector && !sourceSelector.contains(e.target) && dropdown && dropdown.style.display === 'block') {
        dropdown.style.display = 'none';
    }
});

// Source search functionality
document.getElementById('sourceSearch').addEventListener('input', (e) => {
    const searchTerm = e.target.value.toLowerCase();
    const sourceItems = document.querySelectorAll('.source-item');
    
    sourceItems.forEach(item => {
        const sourceName = item.dataset.source.toLowerCase();
        if (sourceName.includes(searchTerm)) {
            item.classList.remove('hidden');
        } else {
            item.classList.add('hidden');
        }
    });
});

// Source item selection
document.querySelectorAll('.source-item').forEach(item => {
    item.addEventListener('click', () => {
        // Update selection
        document.querySelectorAll('.source-item').forEach(i => i.classList.remove('active'));
        item.classList.add('active');
        
        // Update selected source
        selectedSource = item.dataset.source;
        
        // Update button text
        const label = item.querySelector('label').textContent;
        document.getElementById('sourceSelectorText').textContent = label;
        
        // Check radio button
        item.querySelector('input[type="radio"]').checked = true;
        
        // Close dropdown
        document.getElementById('sourceDropdown').style.display = 'none';
        
        // Re-render bundles
        renderBundles();
    });
});

// Installed filter checkbox
document.getElementById('installedCheckbox').addEventListener('change', (e) => {
    showInstalledOnly = e.target.checked;
    renderBundles();
});

// Make the filter div clickable to toggle checkbox
document.getElementById('installedFilter').addEventListener('click', (e) => {
    if (e.target.id !== 'installedCheckbox') {
        const checkbox = document.getElementById('installedCheckbox');
        checkbox.checked = !checkbox.checked;
        showInstalledOnly = checkbox.checked;
        renderBundles();
    }
});

// Sort dropdown
document.getElementById('sortSelect').addEventListener('change', (e) => {
    selectedSort = e.target.value;
    renderBundles();
});

// Clear filters button
document.getElementById('clearFiltersBtn').addEventListener('click', () => {
    document.getElementById('searchBox').value = '';
    document.getElementById('sourceSearch').value = '';
    document.getElementById('tagSearch').value = '';
    document.getElementById('installedCheckbox').checked = false;
    document.getElementById('sortSelect').value = 'name-asc';
    
    // Reset source selector
    selectedSource = 'all';
    document.getElementById('sourceSelectorText').textContent = 'All Sources';
    document.querySelectorAll('.source-item').forEach(item => {
        item.classList.remove('active');
        if (item.dataset.source === 'all') {
            item.classList.add('active');
            item.querySelector('input[type="radio"]').checked = true;
        }
    });
    
    // Uncheck all tag checkboxes
    const checkboxes = document.querySelectorAll('#tagList input[type="checkbox"]');
    checkboxes.forEach(cb => cb.checked = false);
    
    // Show all tags
    const tagItems = document.querySelectorAll('.tag-item');
    tagItems.forEach(item => item.classList.remove('hidden'));
    
    selectedSource = 'all';
    selectedTags = [];
    showInstalledOnly = false;
    selectedSort = 'name-asc';
    updateTagButtonText();
    renderBundles();
});

// Refresh button
document.getElementById('refreshBtn').addEventListener('click', () => {
    vscode.postMessage({ type: 'refresh' });
});

function renderBundles() {
    const marketplace = document.getElementById('marketplace');
    const searchTerm = document.getElementById('searchBox').value;
    
    let filteredBundles = allBundles;

    // Apply source filter
    if (selectedSource && selectedSource !== 'all') {
        filteredBundles = filteredBundles.filter(bundle => bundle.sourceId === selectedSource);
    }

    // Apply installed filter
    if (showInstalledOnly) {
        filteredBundles = filteredBundles.filter(bundle => bundle.installed === true);
    }

    // Apply tag filter (OR logic - bundle matches if it has ANY of the selected tags)
    if (selectedTags.length > 0) {
        filteredBundles = filteredBundles.filter(bundle => {
            if (!bundle.tags || bundle.tags.length === 0) return false;
            return bundle.tags.some(bundleTag => 
                selectedTags.some(selectedTag => 
                    bundleTag.toLowerCase() === selectedTag.toLowerCase()
                )
            );
        });
    }

    // Apply search filter
    if (searchTerm && searchTerm.trim() !== '') {
        const term = searchTerm.toLowerCase();
        filteredBundles = filteredBundles.filter(bundle => 
            bundle.name.toLowerCase().includes(term) ||
            bundle.description.toLowerCase().includes(term) ||
            (bundle.tags && bundle.tags.some(tag => tag.toLowerCase().includes(term))) ||
            (bundle.author && bundle.author.toLowerCase().includes(term))
        );
    }

    // Apply sorting
    switch (selectedSort) {
        case 'rating-desc':
            filteredBundles.sort((a, b) => {
                const ratingA = a.rating?.wilsonScore ?? 0;
                const ratingB = b.rating?.wilsonScore ?? 0;
                return ratingB - ratingA;
            });
            break;
        case 'rating-asc':
            filteredBundles.sort((a, b) => {
                const ratingA = a.rating?.wilsonScore ?? 0;
                const ratingB = b.rating?.wilsonScore ?? 0;
                return ratingA - ratingB;
            });
            break;
        case 'name-asc':
            filteredBundles.sort((a, b) => a.name.localeCompare(b.name));
            break;
        case 'name-desc':
            filteredBundles.sort((a, b) => b.name.localeCompare(a.name));
            break;
    }

    if (filteredBundles.length === 0) {
        // Check if we have any bundles at all (before filtering)
        const hasFiltersApplied = searchTerm || selectedSource !== 'all' || selectedTags.length > 0 || showInstalledOnly;
        
        if (allBundles.length === 0) {
            // No bundles at all - likely still syncing
            marketplace.innerHTML = `
                <div class="empty-state">
                    <div class="spinner"></div>
                    <div class="empty-state-title">Syncing sources...</div>
                    <p>Bundles will appear as sources are synced</p>
                </div>
            `;
        } else if (hasFiltersApplied) {
            // Has bundles but filters hide them all
            marketplace.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">🔍</div>
                    <div class="empty-state-title">No bundles match your filters</div>
                    <p>Try adjusting your search or filters</p>
                </div>
            `;
        } else {
            marketplace.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">📦</div>
                    <div class="empty-state-title">No bundles found</div>
                    <p>Try adjusting your search or filters</p>
                </div>
            `;
        }
        return;
    }

    marketplace.innerHTML = filteredBundles.map(bundle => `
        <div class="bundle-card ${bundle.installed ? 'installed' : ''}" data-bundle-id="${bundle.id}" data-action="openDetails">
            ${bundle.installed && bundle.autoUpdateEnabled ? '<div class="installed-badge">🔄 Auto-Update</div>' : bundle.installed ? '<div class="installed-badge">✓ Installed</div>' : ''}
            
            <div class="bundle-header">
                <div class="bundle-title-row">
                    <div class="bundle-title">${bundle.name}</div>
                    ${bundle.rating ? `
                        <button class="rating-badge clickable" 
                                data-action="showFeedbacks" data-bundle-id="${bundle.id}"
                                title="${bundle.rating.voteCount} votes (${bundle.rating.confidence} confidence)">
                            <span class="rating-stars">${renderStars(bundle.rating.starRating)}</span>
                            <span class="rating-score">${bundle.rating.starRating?.toFixed(1) || '0.0'}</span>
                            <span class="rating-votes">(${bundle.rating.voteCount})</span>
                        </button>
                    ` : ''}
                </div>
                <div class="bundle-author-row">
                    <span class="bundle-author">by ${bundle.author || 'Unknown'} • v${bundle.version}</span>
                    ${bundle.isCurated ? '<span class="curated-badge" title="From curated hub: ' + (bundle.hubName || 'Unknown') + '">' + (bundle.hubName || 'Curated') + '</span>' : ''}
                </div>
            </div>

            <div class="bundle-description">
                ${bundle.description || 'No description available'}
            </div>

            <div class="content-breakdown">
                ${renderContentItem('💬', 'Prompts', bundle.contentBreakdown?.prompts || 0)}
                ${renderContentItem('📋', 'Instructions', bundle.contentBreakdown?.instructions || 0)}
                ${renderContentItem('🤖', 'Agents', bundle.contentBreakdown?.agents || 0)}
                ${renderContentItem('🛠️', 'Skills', bundle.contentBreakdown?.skills || 0)}
                ${renderContentItem('🔌', 'MCP Servers', bundle.contentBreakdown?.mcpServers || 0)}
            </div>

            <div class="bundle-tags">
                ${(bundle.tags || []).slice(0, 4).map(tag => `
                    <span class="tag">${tag}</span>
                `).join('')}
            </div>

            <div class="bundle-actions" data-stop-propagation="true">
                ${bundle.buttonState === 'update' 
                    ? bundle.availableVersions && bundle.availableVersions.length > 1
                        ? `<div class="version-selector-group">
                                <button class="btn btn-primary" data-action="updateBundle" data-bundle-id="${bundle.id}">Update${bundle.installedVersion ? ' (v' + bundle.installedVersion + ' → v' + bundle.version + ')' : ''}</button>
                                <button class="version-selector-arrow" data-action="toggleVersionDropdown" data-dropdown-id="${bundle.id}-update">▾</button>
                                <div class="version-dropdown" id="version-dropdown-${bundle.id}-update">
                                    <div class="version-item uninstall" data-action="uninstallBundle" data-bundle-id="${bundle.id}">
                                        <span>Uninstall</span>
                                    </div>
                                    <div class="version-dropdown-header">Switch Version</div>
                                    ${(bundle.availableVersions || []).map((versionObj, index) => `
                                        <div class="version-item ${versionObj.version === bundle.installedVersion ? 'current' : ''}" data-action="installBundleVersion" data-bundle-id="${bundle.id}" data-version="${versionObj.version}">
                                            <span>v${versionObj.version}</span>
                                            ${versionObj.version === bundle.installedVersion ? '<span class="version-badge">Current</span>' : index === 0 ? '<span class="version-badge latest">Latest</span>' : ''}
                                        </div>
                                    `).join('')}
                                </div>
                            </div>`
                        : `<button class="btn btn-primary" data-action="updateBundle" data-bundle-id="${bundle.id}">Update${bundle.installedVersion ? ' (v' + bundle.installedVersion + ' → v' + bundle.version + ')' : ''}</button>`
                    : bundle.buttonState === 'uninstall'
                    ? bundle.availableVersions && bundle.availableVersions.length > 1
                        ? `<div class="version-selector-group">
                                <button class="btn btn-danger" data-action="uninstallBundle" data-bundle-id="${bundle.id}">Uninstall</button>
                                <button class="version-selector-arrow danger" data-action="toggleVersionDropdown" data-dropdown-id="${bundle.id}-installed">▾</button>
                                <div class="version-dropdown" id="version-dropdown-${bundle.id}-installed">
                                    <div class="version-item uninstall" data-action="uninstallBundle" data-bundle-id="${bundle.id}">
                                        <span>Uninstall</span>
                                    </div>
                                    <div class="version-dropdown-header">Switch Version</div>
                                    ${(bundle.availableVersions || []).map((versionObj, index) => `
                                        <div class="version-item ${versionObj.version === bundle.installedVersion ? 'current' : ''}" data-action="installBundleVersion" data-bundle-id="${bundle.id}" data-version="${versionObj.version}">
                                            <span>v${versionObj.version}</span>
                                            ${versionObj.version === bundle.installedVersion ? '<span class="version-badge">Current</span>' : index === 0 ? '<span class="version-badge latest">Latest</span>' : ''}
                                        </div>
                                    `).join('')}
                                </div>
                            </div>`
                        : `<button class="btn btn-danger" data-action="uninstallBundle" data-bundle-id="${bundle.id}">Uninstall</button>`
                    : bundle.availableVersions && bundle.availableVersions.length > 1
                    ? `<div class="version-selector-group">
                            <button class="btn btn-primary" data-action="installBundle" data-bundle-id="${bundle.id}">Install</button>
                            <button class="version-selector-arrow" data-action="toggleVersionDropdown" data-dropdown-id="${bundle.id}">▾</button>
                            <div class="version-dropdown" id="version-dropdown-${bundle.id}">
                                <div class="version-dropdown-header">Select Version</div>
                                ${(bundle.availableVersions || []).map((versionObj, index) => `
                                    <div class="version-item" data-action="installBundleVersion" data-bundle-id="${bundle.id}" data-version="${versionObj.version}">
                                        <span>v${versionObj.version}</span>
                                        ${index === 0 ? '<span class="version-badge latest">Latest</span>' : ''}
                                    </div>
                                `).join('')}
                            </div>
                        </div>`
                    : `<button class="btn btn-primary" data-action="installBundle" data-bundle-id="${bundle.id}">Install</button>`
                }
                <button class="btn btn-secondary" data-action="openDetails" data-bundle-id="${bundle.id}">Details</button>
                <button class="btn btn-link" data-action="openSourceRepo" data-bundle-id="${bundle.id}" title="Open Source Repository">
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M4.5 3A1.5 1.5 0 0 0 3 4.5v7A1.5 1.5 0 0 0 4.5 13h7a1.5 1.5 0 0 0 1.5-1.5v-2a.5.5 0 0 1 1 0v2a2.5 2.5 0 0 1-2.5 2.5h-7A2.5 2.5 0 0 1 2 11.5v-7A2.5 2.5 0 0 1 4.5 2h2a.5.5 0 0 1 0 1h-2zM9 2.5a.5.5 0 0 1 .5-.5h4a.5.5 0 0 1 .5.5v4a.5.5 0 0 1-1 0V3.707l-5.146 5.147a.5.5 0 0 1-.708-.708L12.293 3H9.5a.5.5 0 0 1-.5-.5z"/></svg>
                </button>
            </div>
        </div>
    `).join('');
}

function renderContentItem(icon, label, count) {
    if (count === 0) return '';
    return `
        <div class="content-item">
            <span class="content-icon">${icon}</span>
            <span class="content-count">${count}</span>
            <span>${label}</span>
        </div>
    `;
}

function installBundle(bundleId) {
    vscode.postMessage({ type: 'install', bundleId });
}

function updateBundle(bundleId) {
    vscode.postMessage({ type: 'update', bundleId });
}

function uninstallBundle(bundleId) {
    vscode.postMessage({ type: 'uninstall', bundleId });
}

function openDetails(bundleId) {
    vscode.postMessage({ type: 'openDetails', bundleId });
}

function openSourceRepo(bundleId) {
    vscode.postMessage({ type: 'openSourceRepository', bundleId });
}

function toggleVersionDropdown(dropdownId, event) {
    event.stopPropagation();
    const dropdown = document.getElementById('version-dropdown-' + dropdownId);
    if (!dropdown) return;
    
    // Close all other dropdowns
    document.querySelectorAll('.version-dropdown').forEach(d => {
        if (d.id !== 'version-dropdown-' + dropdownId) {
            d.classList.remove('show');
        }
    });
    
    // Toggle this dropdown
    dropdown.classList.toggle('show');
}

function renderStars(rating) {
    if (rating === undefined || rating === null) rating = 0;
    const fullStars = Math.floor(rating);
    const hasHalfStar = rating % 1 >= 0.5;
    const emptyStars = 5 - fullStars - (hasHalfStar ? 1 : 0);
    
    return '★'.repeat(fullStars) + 
           (hasHalfStar ? '⯨' : '') + 
           '☆'.repeat(emptyStars);
}

function showFeedbacks(bundleId, event) {
    event.stopPropagation();
    
    // Request feedback data from extension
    vscode.postMessage({ 
        type: 'getFeedbacks', 
        bundleId: bundleId 
    });
    
    // Show modal with loading state
    const modal = document.getElementById('feedbackModal');
    const feedbackList = document.getElementById('feedbackList');
    const feedbackSummary = document.getElementById('feedbackSummary');
    const modalTitle = document.getElementById('feedbackModalTitle');
    
    // Find bundle name for title
    const bundle = allBundles.find(b => b.id === bundleId);
    modalTitle.textContent = bundle ? `Feedbacks for ${bundle.name}` : 'User Feedbacks';
    
    feedbackSummary.innerHTML = '';
    feedbackList.innerHTML = '<div class="loading"><div class="spinner"></div><p>Loading feedbacks...</p></div>';
    modal.style.display = 'flex';
}

function closeFeedbackModal() {
    const modal = document.getElementById('feedbackModal');
    modal.style.display = 'none';
}

function renderFeedbackModal(bundleId, feedbacks, rating) {
    const feedbackSummary = document.getElementById('feedbackSummary');
    const feedbackList = document.getElementById('feedbackList');
    
    // Render rating summary if available
    if (rating && rating.voteCount > 0) {
        const distribution = calculateRatingDistribution(feedbacks);
        feedbackSummary.innerHTML = `
            <div class="rating-overview">
                <div>
                    <div class="rating-large">${rating.starRating?.toFixed(1) || '0.0'}</div>
                    <div class="rating-stars-large">${renderStars(rating.starRating)}</div>
                    <div class="rating-count">${rating.voteCount} ratings</div>
                </div>
                <div class="rating-bars">
                    ${renderRatingBars(distribution, rating.voteCount)}
                </div>
            </div>
        `;
    }
    
    // Render feedback items
    if (!feedbacks || feedbacks.length === 0) {
        feedbackList.innerHTML = `
            <div class="feedback-empty">
                <div class="feedback-empty-icon">💬</div>
                <p>No feedbacks yet</p>
                <p style="font-size: 12px; margin-top: 8px;">Be the first to share your experience!</p>
            </div>
        `;
        return;
    }
    
    feedbackList.innerHTML = feedbacks.map(feedback => `
        <div class="feedback-item">
            <div class="feedback-header">
                <div class="feedback-rating">${feedback.rating ? renderStars(feedback.rating) : ''}</div>
                <div class="feedback-meta">
                    <span class="feedback-date">${formatDate(feedback.timestamp)}</span>
                    ${feedback.version ? `<span class="feedback-version">v${feedback.version}</span>` : ''}
                </div>
            </div>
            <div class="feedback-comment">${escapeHtml(feedback.comment)}</div>
        </div>
    `).join('');
}

function calculateRatingDistribution(feedbacks) {
    const dist = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
    if (!feedbacks) return dist;
    
    feedbacks.forEach(f => {
        if (f.rating && f.rating >= 1 && f.rating <= 5) {
            dist[f.rating]++;
        }
    });
    return dist;
}

function renderRatingBars(distribution, total) {
    const stars = [5, 4, 3, 2, 1];
    return stars.map(star => {
        const count = distribution[star] || 0;
        const percentage = total > 0 ? (count / total * 100) : 0;
        return `
            <div class="rating-bar-row">
                <div class="rating-bar-label">${star} stars</div>
                <div class="rating-bar-track">
                    <div class="rating-bar-fill" style="width: ${percentage}%"></div>
                </div>
                <div class="rating-bar-count">${count}</div>
            </div>
        `;
    }).join('');
}

function formatDate(isoString) {
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now - date;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
    if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
    return `${Math.floor(diffDays / 365)} years ago`;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function installBundleVersion(bundleId, version, event) {
    event.stopPropagation();
    
    // Close dropdown
    document.querySelectorAll('.version-dropdown').forEach(d => {
        d.classList.remove('show');
    });
    
    vscode.postMessage({ 
        type: 'installVersion', 
        bundleId: bundleId,
        version: version
    });
}

// Close dropdowns when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.version-selector-group')) {
            document.querySelectorAll('.version-dropdown').forEach(d => {
                d.classList.remove('show');
            });
        }
    });

    // Event delegation for all click handlers (CSP compliant)
    document.addEventListener('click', (e) => {
        const target = e.target;
        
        // Handle bundle-actions stop propagation
        if (target.closest('[data-stop-propagation]')) {
            e.stopPropagation();
        }
        
        // Handle data-action attributes
        const actionElement = target.closest('[data-action]');
        if (actionElement) {
            const action = actionElement.dataset.action;
            const bundleId = actionElement.dataset.bundleId || actionElement.closest('[data-bundle-id]')?.dataset.bundleId;
            const version = actionElement.dataset.version;
            const dropdownId = actionElement.dataset.dropdownId;
            
            switch (action) {
                case 'openDetails':
                    if (bundleId) openDetails(bundleId);
                    break;
                case 'showFeedbacks':
                    if (bundleId) { e.stopPropagation(); showFeedbacks(bundleId, e); }
                    break;
                case 'installBundle':
                    if (bundleId) installBundle(bundleId);
                    break;
                case 'installBundleVersion':
                    if (bundleId && version) installBundleVersion(bundleId, version, e);
                    break;
                case 'updateBundle':
                    if (bundleId) updateBundle(bundleId);
                    break;
                case 'uninstallBundle':
                    if (bundleId) uninstallBundle(bundleId, e);
                    break;
                case 'openSourceRepo':
                    if (bundleId) openSourceRepo(bundleId);
                    break;
                case 'toggleVersionDropdown':
                    if (dropdownId) toggleVersionDropdown(dropdownId, e);
                    break;
                case 'selectSource':
                    selectSource(actionElement.dataset.sourceId);
                    break;
                case 'toggleTag':
                    toggleTag(actionElement.dataset.tag);
                    break;
                case 'toggleInstalledFilter':
                    toggleInstalledFilter();
                    break;
                case 'clearFilters':
                    clearFilters();
                    break;
                case 'refreshBundles':
                    refreshBundles();
                    break;
                case 'setSort':
                    setSort(actionElement.dataset.sort);
                    break;
                case 'closeFeedbackModal':
                    closeFeedbackModal();
                    break;
                case 'submitFeedback':
                    if (bundleId) submitFeedback(bundleId);
                    break;
                case 'quickFeedback':
                    if (bundleId) quickFeedback(bundleId);
                    break;
            }
        }
    });
})();

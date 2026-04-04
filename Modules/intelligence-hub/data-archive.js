document.addEventListener('DOMContentLoaded', async () => {
    const ok = await Auth.requireAuth();
    if (!ok) return;

    const searchInput = document.getElementById('searchInput');
    const clientFilter = document.getElementById('clientFilter');
    const sourceFilter = document.getElementById('sourceFilter');
    const clearFiltersBtn = document.getElementById('clearFilters');
    const treeContainer = document.getElementById('treeContainer');
    const folderTree = document.getElementById('folderTree');
    const emptyState = document.getElementById('emptyState');
    const totalCount = document.getElementById('totalCount');
    const visibleCount = document.getElementById('visibleCount');
    const filteredCount = document.getElementById('filteredCount');

    let allEntries = [];
    let filteredEntries = [];
    let clients = [];
    let expandedFolders = new Set();

    // Initialize — also retry on sidebarReady in case sidebar wasn't rendered yet
    loadEntries();
    loadClientsDropdown();
    window.addEventListener('sidebarReady', () => updateStats(), { once: true });

    // Event listeners
    searchInput.addEventListener('input', debounce(applyFilters, 300));
    clientFilter.addEventListener('change', applyFilters);
    sourceFilter.addEventListener('change', applyFilters);
    clearFiltersBtn.addEventListener('click', clearFilters);

    // ── Load entries ────────────────────────────────────────────────────────

    async function loadEntries() {
        try {
            const res = await Auth.fetch('/api/intelligence-hub/entries');
            allEntries = await res.json();

            // Sort by date (newest first)
            allEntries.sort((a, b) => new Date(b.date) - new Date(a.date));

            // Expose for solution mode context lookup
            window._daEntries = allEntries;
            
            updateStats();
            applyFilters();
        } catch (err) {
            console.error('Error loading entries:', err);
            showError('Failed to load entries');
        }
    }

    // ── Load clients dropdown ─────────────────────────────────────────────────

    async function loadClientsDropdown() {
        try {
            const res = await Auth.fetch('/api/settings');
            const data = await res.json();
            
            clients = data.clients || [];
            
            // Populate client filter
            const currentValue = clientFilter.value;
            clientFilter.innerHTML = '<option value="">All Clients</option>';
            
            if (clients.length > 0) {
                clients.forEach(client => {
                    const opt = document.createElement('option');
                    opt.value = client;
                    opt.textContent = client;
                    clientFilter.appendChild(opt);
                });
                
                const optOther = document.createElement('option');
                optOther.value = 'Unknown / Prospect';
                optOther.textContent = '👤 Other / Prospect';
                clientFilter.appendChild(optOther);
            }
            
            clientFilter.value = currentValue;
        } catch (err) {
            console.error('Error loading clients:', err);
        }
    }

    // ── Filtering logic ───────────────────────────────────────────────────────

    function applyFilters() {
        const searchTerm = searchInput.value.toLowerCase().trim();
        const selectedClient = clientFilter.value;
        const selectedSource = sourceFilter.value;

        filteredEntries = allEntries.filter(entry => {
            // Search filter
            if (searchTerm) {
                const matchesSearch = 
                    (entry.body && entry.body.toLowerCase().includes(searchTerm)) ||
                    (entry.person && entry.person.toLowerCase().includes(searchTerm)) ||
                    (entry.sourceType && entry.sourceType.toLowerCase().includes(searchTerm));
                if (!matchesSearch) return false;
            }

            // Client filter
            if (selectedClient && entry.person !== selectedClient) {
                return false;
            }

            // Source filter
            if (selectedSource && entry.sourceType !== selectedSource) {
                return false;
            }

            return true;
        });

        updateDisplay();
        updateFilterButton();
    }

    function clearFilters() {
        searchInput.value = '';
        clientFilter.value = '';
        sourceFilter.value = '';
        applyFilters();
    }

    function updateFilterButton() {
        const hasFilters = searchInput.value || clientFilter.value || sourceFilter.value;
        clearFiltersBtn.style.display = hasFilters ? 'block' : 'none';
    }

    // ── Display functions ─────────────────────────────────────────────────────

    function updateDisplay() {
        if (filteredEntries.length === 0) {
            treeContainer.style.display = 'none';
            emptyState.style.display = 'block';
            updateCounts(0, 0);
            return;
        }

        treeContainer.style.display = 'block';
        emptyState.style.display = 'none';
        
        renderTree();
        updateCounts(filteredEntries.length, filteredEntries.length);
    }

    function renderTree() {
        // Group entries by client
        const entriesByClient = {};
        
        filteredEntries.forEach(entry => {
            const client = entry.person || 'Unknown / Prospect';
            if (!entriesByClient[client]) {
                entriesByClient[client] = [];
            }
            entriesByClient[client].push(entry);
        });

        // Sort clients alphabetically
        const sortedClients = Object.keys(entriesByClient).sort();

        folderTree.innerHTML = '';

        sortedClients.forEach(client => {
            const entries = entriesByClient[client];
            const folderNode = createFolderNode(client, entries);
            folderTree.appendChild(folderNode);
        });
    }

    function createFolderNode(clientName, entries) {
        const folderNode = document.createElement('div');
        folderNode.className = 'folder-node';

        const isExpanded = expandedFolders.has(clientName);
        
        // Create folder header
        const folderHeader = document.createElement('div');
        folderHeader.className = `folder-header ${isExpanded ? 'expanded' : ''}`;
        folderHeader.innerHTML = `
            <span class="folder-icon">▶</span>
            <span class="folder-name">📁 ${Auth.esc(clientName)}</span>
            <span class="folder-count">${entries.length}</span>
        `;
        
        folderHeader.addEventListener('click', () => {
            toggleFolder(clientName);
        });

        // Create folder content
        const folderContent = document.createElement('div');
        folderContent.className = `folder-content ${isExpanded ? 'expanded' : ''}`;
        folderContent.id = `folder-${clientName.replace(/[^a-zA-Z0-9]/g, '-')}`;

        // Add files (entries) sorted by date (newest first)
        entries.forEach(entry => {
            const fileItem = createFileItem(entry);
            folderContent.appendChild(fileItem);
        });

        folderNode.appendChild(folderHeader);
        folderNode.appendChild(folderContent);

        return folderNode;
    }

    function createFileItem(entry) {
        const fileItem = document.createElement('div');
        fileItem.className = 'file-item';
        fileItem.dataset.entryId = entry.id;

        const formattedDate = formatDate(entry.date);
        const sourceIcon = getSourceIcon(entry.sourceType);
        const truncatedContent = truncateText(entry.body, 120);

        fileItem.innerHTML = `
            <div class="file-icon">${sourceIcon}</div>
            <div class="file-content">
                <div class="file-header">
                    <div class="file-title">Feedback Entry</div>
                    <div class="file-date">${formattedDate}</div>
                </div>
                <div class="file-meta">
                    <span class="meta-tag meta-source">${Auth.esc(entry.sourceType || 'Unknown')}</span>
                </div>
                <div class="file-preview">${Auth.esc(truncatedContent)}</div>
                <div class="file-actions">
                    <button class="action-btn btn-edit" onclick="editEntry('${entry.id}')">Edit</button>
                    <button class="action-btn btn-delete" onclick="deleteEntry('${entry.id}')">Delete</button>
                </div>
            </div>
        `;

        return fileItem;
    }

    function toggleFolder(clientName) {
        const folderHeader = event.currentTarget;
        const folderContent = document.getElementById(`folder-${clientName.replace(/[^a-zA-Z0-9]/g, '-')}`);
        
        if (expandedFolders.has(clientName)) {
            expandedFolders.delete(clientName);
            folderHeader.classList.remove('expanded');
            folderContent.classList.remove('expanded');
        } else {
            expandedFolders.add(clientName);
            folderHeader.classList.add('expanded');
            folderContent.classList.add('expanded');
        }
    }

    // ── Entry actions ─────────────────────────────────────────────────────────

    window.editEntry = async (entryId) => {
        try {
            // Redirect to data-entry page with edit mode
            window.location.href = `/Modules/intelligence-hub/data-entry.html?edit=${entryId}`;
        } catch (err) {
            console.error('Error navigating to edit:', err);
            showError('Failed to open entry for editing');
        }
    };

    window.deleteEntry = async (entryId) => {
        if (!confirm('Are you sure you want to delete this entry? This action cannot be undone.')) {
            return;
        }

        try {
            const res = await Auth.fetch(`/api/intelligence-hub/entry/${entryId}`, {
                method: 'DELETE'
            });

            if (!res.ok) {
                throw new Error('Failed to delete entry');
            }

            // Remove from local arrays
            allEntries = allEntries.filter(e => e.id !== entryId);
            filteredEntries = filteredEntries.filter(e => e.id !== entryId);

            // Update display
            updateStats();
            updateDisplay();
            
            showSuccess('Entry deleted successfully');
        } catch (err) {
            console.error('Error deleting entry:', err);
            showError('Failed to delete entry');
        }
    };

    // ── Utility functions ─────────────────────────────────────────────────────

    function updateStats() {
        const el = document.getElementById('totalCount') || totalCount;
        if (el) el.textContent = allEntries.length;
    }

    function updateCounts(visible, filtered) {
        visibleCount.textContent = visible;
        filteredCount.textContent = filtered;
    }

    function formatDate(dateString) {
        if (!dateString) return 'No date';
        
        const date = new Date(dateString);
        const now = new Date();
        const diffTime = Math.abs(now - date);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        if (diffDays === 0) return 'Today';
        if (diffDays === 1) return 'Yesterday';
        if (diffDays < 7) return `${diffDays} days ago`;
        if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
        if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
        return `${Math.floor(diffDays / 365)} years ago`;
    }

    function getSourceIcon(sourceType) {
        const icons = {
            'Meeting': '🤝',
            'Email': '📧',
            'Intercom': '💬',
            'Support Ticket': '🎫',
            'Sales': '💰',
            'Insight': '💡',
            'Sprint Question': '🏃',
            'Autre': '📋'
        };
        return icons[sourceType] || '📋';
    }

    function truncateText(text, maxLength) {
        if (!text) return '';
        if (text.length <= maxLength) return text;
        return text.substring(0, maxLength) + '...';
    }


    function debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    function showSuccess(message) {
        // Create a temporary success message
        const toast = document.createElement('div');
        toast.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: var(--color-success);
            color: var(--color-text-inverse);
            padding: 12px 20px;
            border-radius: var(--radius-md);
            font-size: var(--font-size-sm);
            font-weight: var(--font-weight-bold);
            z-index: 1000;
            box-shadow: var(--shadow-hover);
        `;
        toast.textContent = message;
        document.body.appendChild(toast);

        setTimeout(() => {
            toast.remove();
        }, 3000);
    }

    function showError(message) {
        // Create a temporary error message
        const toast = document.createElement('div');
        toast.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: var(--color-danger);
            color: var(--color-text-inverse);
            padding: 12px 20px;
            border-radius: var(--radius-md);
            font-size: var(--font-size-sm);
            font-weight: var(--font-weight-bold);
            z-index: 1000;
            box-shadow: var(--shadow-hover);
        `;
        toast.textContent = message;
        document.body.appendChild(toast);

        setTimeout(() => {
            toast.remove();
        }, 3000);
    }
});

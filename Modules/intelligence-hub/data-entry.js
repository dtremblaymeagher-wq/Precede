document.addEventListener('DOMContentLoaded', async () => {
    const ok = await Auth.requireAuth();
    if (!ok) return;

    const status       = document.getElementById('status');
    const dateInput    = document.getElementById('date');
    const personSelect = document.getElementById('person');
    const saveBtn      = document.getElementById('saveEntry');
    const cancelBtn    = document.getElementById('cancelEdit');

    let editingId   = null;
    let _allEntries = [];
    let _filterText = '';

    dateInput.valueAsDate = new Date();
    loadClientsDropdown();
    refreshHistory();

    // Check for edit mode from URL parameters
    const urlParams = new URLSearchParams(window.location.search);
    const editId = urlParams.get('edit');
    if (editId) loadEntryForEdit(editId);

    // ── Clients dropdown ──────────────────────────────────────────────────────

    async function loadClientsDropdown() {
        if (!personSelect) return;
        try {
            const res  = await Auth.fetch('/api/settings');
            const data = await res.json();

            personSelect.innerHTML = '';

            if (data.clients && Array.isArray(data.clients) && data.clients.length > 0) {
                const placeholder = document.createElement('option');
                placeholder.value = '';
                placeholder.textContent = '-- Select Client --';
                personSelect.appendChild(placeholder);

                data.clients.forEach(client => {
                    const opt = document.createElement('option');
                    opt.value = client;
                    opt.textContent = client;
                    personSelect.appendChild(opt);
                });

                const optOther = document.createElement('option');
                optOther.value = 'Unknown / Prospect';
                optOther.textContent = '👤 Other / Prospect';
                personSelect.appendChild(optOther);
            } else {
                personSelect.innerHTML = '<option value="General">No clients (see Settings)</option>';
            }
        } catch (err) {
            console.error('Error loading clients:', err);
            personSelect.innerHTML = '<option value="">API Error</option>';
        }
    }

    // ── Load entry for edit ───────────────────────────────────────────────────

    async function loadEntryForEdit(entryId) {
        try {
            const res     = await Auth.fetch('/api/intelligence-hub/entries');
            const entries = await res.json();
            const entry   = entries.find(e => e.id === entryId);
            if (entry) {
                setTimeout(() => enterEditMode(entry), 100);
            } else {
                showStatus('❌ Entry not found', 'error');
            }
        } catch (err) {
            showStatus('❌ Failed to load entry', 'error');
        }
    }

    // ── Edit mode ─────────────────────────────────────────────────────────────

    function enterEditMode(entry) {
        editingId = entry.id;
        document.getElementById('body').value            = entry.body || '';
        personSelect.value                               = entry.person || '';
        document.getElementById('sourceType').value      = entry.sourceType || 'Meeting';
        dateInput.value                                  = entry.date || '';
        saveBtn.textContent                              = 'Update Entry';
        saveBtn.style.background                         = '#4f46e5';
        cancelBtn.style.display                          = 'block';
        document.getElementById('body').focus();
        showStatus('✏️ Editing — make your changes and click Update', 'info');
        renderEntries(); // highlight active card
    }

    function exitEditMode() {
        editingId                                        = null;
        document.getElementById('body').value           = '';
        personSelect.selectedIndex                       = 0;
        document.getElementById('sourceType').selectedIndex = 0;
        dateInput.valueAsDate                            = new Date();
        saveBtn.textContent                              = 'Log Feedback';
        saveBtn.style.background                        = '';
        cancelBtn.style.display                         = 'none';
        status.innerText                                = '';
        renderEntries();
    }

    cancelBtn.addEventListener('click', exitEditMode);

    // ── Save / Update ─────────────────────────────────────────────────────────

    saveBtn.addEventListener('click', async () => {
        const body       = document.getElementById('body').value.trim();
        const person     = personSelect.value;
        const sourceType = document.getElementById('sourceType').value;
        const date       = dateInput.value;

        if (!body || !person || !date) {
            showStatus('⚠️ All fields are required', 'warn');
            return;
        }

        if (editingId) {
            const updated = { id: editingId, body, person, sourceType, date, updatedAt: new Date().toISOString() };
            try {
                const res = await Auth.fetch(`/api/intelligence-hub/entry/${editingId}`, {
                    method:  'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body:    JSON.stringify(updated),
                });
                if (res.ok) {
                    showStatus('✅ Entry updated', 'success');
                    exitEditMode();
                    refreshHistory();
                } else throw new Error();
            } catch {
                showStatus('❌ Error updating', 'error');
            }
        } else {
            const newEntry = {
                id:        crypto.randomUUID(),
                body,
                person,
                sourceType,
                date,
                createdAt: new Date().toISOString(),
            };
            try {
                const res = await Auth.fetch('/api/intelligence-hub/entry', {
                    method:  'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body:    JSON.stringify(newEntry),
                });
                if (res.ok) {
                    showStatus('✅ Feedback logged', 'success');
                    document.getElementById('body').value = '';
                    personSelect.selectedIndex = 0;
                    refreshHistory();
                } else throw new Error();
            } catch {
                showStatus('❌ Error saving', 'error');
            }
        }
    });

    // ── History ───────────────────────────────────────────────────────────────

    async function refreshHistory() {
        const list = document.getElementById('entryHistoryList');
        if (!list) return;
        try {
            const res   = await Auth.fetch('/api/intelligence-hub/entries');
            _allEntries = await res.json();
            renderEntries();
        } catch (err) {
            console.error('History error:', err);
            list.innerHTML = '<div class="entries-empty">Failed to load entries.</div>';
        }
    }

    function renderEntries() {
        const list = document.getElementById('entryHistoryList');
        if (!list) return;

        const countEl = document.getElementById('entriesCount');

        // Filter
        const q = _filterText.toLowerCase().trim();
        const filtered = q
            ? _allEntries.filter(e =>
                (e.body || '').toLowerCase().includes(q) ||
                (e.person || '').toLowerCase().includes(q) ||
                (e.sourceType || '').toLowerCase().includes(q))
            : _allEntries;

        if (countEl) {
            countEl.textContent = filtered.length === _allEntries.length
                ? `${_allEntries.length} total`
                : `${filtered.length} / ${_allEntries.length}`;
        }

        if (!filtered || filtered.length === 0) {
            list.innerHTML = `<div class="entries-empty">${q ? 'No matches.' : 'No entries yet.'}</div>`;
            return;
        }

        // Most recent first
        const recent = [...filtered].reverse().slice(0, 50);

        list.innerHTML = recent.map(e => {
            const dateStr = e.date
                ? new Date(e.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                : '';
            const snippet = (e.body || '').slice(0, 120) + ((e.body || '').length > 120 ? '…' : '');
            const isEditing = e.id === editingId;
            return `
            <div class="entry-card${isEditing ? ' editing' : ''}" id="card-${Auth.esc(e.id)}">
                <div class="entry-card-top">
                    <div class="entry-meta">
                        <span class="entry-date">${Auth.esc(dateStr)}</span>
                        <span class="entry-person">${Auth.esc(e.person || '—')}</span>
                        <span class="entry-source">${Auth.esc(e.sourceType || 'Feedback')}</span>
                    </div>
                    <div class="entry-actions">
                        <button class="entry-btn entry-btn-edit" onclick="window._editEntry('${Auth.esc(e.id)}')">✏️ Edit</button>
                        <button class="entry-btn entry-btn-delete" onclick="window._deleteEntry('${Auth.esc(e.id)}')">🗑</button>
                    </div>
                </div>
                <div class="entry-body">${Auth.esc(snippet)}</div>
            </div>`;
        }).join('');
    }

    // ── Filter (called from HTML oninput) ─────────────────────────────────────

    window.filterEntries = function(val) {
        _filterText = val;
        renderEntries();
    };

    // ── Edit / Delete (global) ────────────────────────────────────────────────

    window._editEntry = function(id) {
        const entry = _allEntries.find(e => e.id === id);
        if (entry) enterEditMode(entry);
    };

    window._deleteEntry = async function(id) {
        if (!confirm('Delete this entry? This cannot be undone.')) return;
        try {
            const res = await Auth.fetch(`/api/intelligence-hub/entry/${id}`, { method: 'DELETE' });
            if (res.ok) {
                if (editingId === id) exitEditMode();
                _allEntries = _allEntries.filter(e => e.id !== id);
                renderEntries();
                showStatus('🗑 Entry deleted', 'info');
            } else {
                showStatus('❌ Delete failed', 'error');
            }
        } catch {
            showStatus('❌ Delete failed', 'error');
        }
    };

    // ── Utils ─────────────────────────────────────────────────────────────────

    function showStatus(msg, type) {
        const colors = { success: '#4f46e5', error: '#dc2626', warn: '#d97706', info: '#6b7280' };
        status.innerText = msg;
        status.style.color = colors[type] || colors.info;
        setTimeout(() => { if (status.innerText === msg) status.innerText = ''; }, 3000);
    }

});

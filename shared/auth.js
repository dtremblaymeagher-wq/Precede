// shared/auth.js
// Clerk authentication helpers for all PM AI Toolkit modules.
//
// Usage in every HTML module:
//   1. Load Clerk CDN in <head> (before this file)
//   2. Load this file: <script src="/shared/auth.js"></script>
//   3. In your module JS:
//        const ok = await Auth.requireAuth();
//        if (!ok) return;
//        const res = await Auth.fetch('/api/something', { method: 'POST', ... });
//
// Instance management is automatic:
//   - Active instance ID is persisted in localStorage (key: precede_active_instance_id)
//   - Auth.fetch() injects X-Instance-Id on every request automatically
//   - Top bar is injected into every page (active instance centered, user avatar right)
//   - Sidebar switcher is also injected when user has 2+ instances

(function () {
    const LOGIN_URL    = '/login.html';
    const INSTANCE_KEY = 'precede_active_instance_id';
    const PLAN_KEY     = 'precede_plan';

    const PLANS = [
        { id: 'free', label: 'Freemium', price: 'Free',    color: '#8c7d6a' },
        { id: 'pro',  label: 'Pro',      price: 'TBD',     color: '#b05a38' },
        { id: 'team', label: 'Team',     price: 'TBD',     color: '#a07830' },
    ];

    const WORKSPACE_COLORS = ['#b05a38', '#a07830', '#4a8c54', '#9c3c3c', '#4a6a8c', '#7a5c8c'];

    // ─── Clerk ───────────────────────────────────────────────────────────────

    let _clerkPromise = null;
    let _clerk        = null;

    function _getClerk() {
        if (!_clerkPromise) {
            _clerkPromise = (async () => {
                const clerk = window.Clerk;
                await clerk.load();
                return clerk;
            })();
        }
        return _clerkPromise;
    }

    async function getToken() {
        const clerk = await _getClerk();
        return clerk.session?.getToken() ?? null;
    }

    // ─── Instance management ─────────────────────────────────────────────────

    let _instanceCache = null;

    // Fetch instances without X-Instance-Id (it's a free route on the server).
    async function _fetchInstances() {
        const token = await getToken();
        const res = await window.fetch('/api/instances', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) return [];
        const data = await res.json();
        _instanceCache = data;
        return data;
    }

    // Ensure localStorage has a valid instance ID.
    async function _ensureInstance() {
        const stored = localStorage.getItem(INSTANCE_KEY);
        if (stored) return;
        try {
            const instances = await _fetchInstances();
            if (instances.length > 0) {
                localStorage.setItem(INSTANCE_KEY, instances[0].id);
            }
        } catch (e) {
            console.warn('[Auth] Could not initialise instance:', e.message);
        }
    }

    // Escape HTML to prevent XSS — exported as Auth.esc for use across all pages
    function _esc(str) {
        return String(str ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    // Switch to a different instance and redirect to the correct dashboard.
    function switchInstance(id) {
        if (!id || id === localStorage.getItem(INSTANCE_KEY)) return;
        localStorage.setItem(INSTANCE_KEY, id);
        const instance = _instanceCache?.find(i => i.id === id);
        const type     = instance?.instance_type || 'pm';
        window.location.href = type === 'executive' ? '/dashboard-exec.html' : '/dashboard.html';
    }

    // ─── Sidebar switcher ────────────────────────────────────────────────────

    function _renderSwitcher(instances, activeId) {
        const signoutBtn =
            document.querySelector('.sidebar-signout') ||
            document.querySelector('button[onclick*="signOut"]');
        if (!signoutBtn) return;

        document.getElementById('instance-switcher')?.remove();

        const active = instances.find(i => i.id === activeId) || instances[0];
        if (!active) return;

        const el = document.createElement('div');
        el.id = 'instance-switcher';

        if (instances.length < 2) {
            el.style.cssText = 'margin:0 0 4px;padding:6px 10px;';
            el.innerHTML = `
                <div style="font-size:0.62rem;text-transform:uppercase;letter-spacing:0.1em;color:rgba(255,255,255,0.25);font-weight:700;margin-bottom:5px;">Workspace</div>
                <div style="display:flex;align-items:center;gap:6px;overflow:hidden;">
                    <span style="width:7px;height:7px;border-radius:50%;background:${active.color || '#6366f1'};flex-shrink:0;"></span>
                    <span style="font-size:0.8rem;font-weight:600;color:rgba(255,255,255,0.55);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${_esc(active.name)}</span>
                </div>`;
        } else {
            const options = instances.map(i =>
                `<option value="${_esc(i.id)}" ${i.id === activeId ? 'selected' : ''} style="background:#1e293b;color:white;">${_esc(i.name)}</option>`
            ).join('');

            el.style.cssText = 'margin:0 0 6px;padding:8px 10px;background:rgba(255,255,255,0.06);border-radius:8px;border:1px solid rgba(255,255,255,0.1);';
            el.innerHTML = `
                <div style="font-size:0.62rem;text-transform:uppercase;letter-spacing:0.1em;color:rgba(255,255,255,0.25);font-weight:700;margin-bottom:6px;">Workspace</div>
                <div style="display:flex;align-items:center;gap:5px;overflow:hidden;">
                    <span id="instance-dot" style="width:7px;height:7px;border-radius:50%;background:${active.color || '#6366f1'};flex-shrink:0;"></span>
                    <select id="instance-select"
                        style="flex:1;min-width:0;background:transparent;border:none;color:white;font-size:0.8rem;font-weight:600;cursor:pointer;outline:none;appearance:none;-webkit-appearance:none;padding:1px 0;">
                        ${options}
                    </select>
                    <span style="color:rgba(255,255,255,0.3);font-size:9px;pointer-events:none;flex-shrink:0;">▾</span>
                </div>`;
        }

        signoutBtn.parentElement.insertBefore(el, signoutBtn);

        const select = el.querySelector('#instance-select');
        if (select) {
            select.addEventListener('change', () => switchInstance(select.value));
        }
    }

    // Fetch + validate + render sidebar switcher AND top bar center.
    // Also redirects if the current page doesn't match the active instance type.
    async function _initSwitcher() {
        try {
            const instances = await _fetchInstances();
            const storedId  = localStorage.getItem(INSTANCE_KEY);

            // If stored instance no longer exists, reset to first available
            if (storedId && instances.length && !instances.find(i => i.id === storedId)) {
                localStorage.setItem(INSTANCE_KEY, instances[0].id);
                window.location.reload();
                return;
            }

            const activeId = localStorage.getItem(INSTANCE_KEY);
            const active   = instances.find(i => i.id === activeId);

            // Redirect if page doesn't match instance type (e.g. exec instance on PM dashboard)
            // Neutral pages (settings, vision-board, etc.) are accessible from any instance type.
            const NEUTRAL_PATHS = ['/settings', '/vision-board', '/onboarding', '/data-entry', '/data-archive', '/roadmap', '/analyzer', '/decision-log', '/solution-brainstorm', '/meeting-center', '/meeting-strategist'];
            const isNeutralPage = NEUTRAL_PATHS.some(p => window.location.pathname.includes(p));
            if (active && !isNeutralPage) {
                const isExecPage     = window.location.pathname.includes('dashboard-exec');
                const isExecInstance = active.instance_type === 'executive';
                if (isExecInstance && !isExecPage) {
                    window.location.href = '/dashboard-exec.html';
                    return;
                }
                if (!isExecInstance && isExecPage) {
                    window.location.href = '/dashboard.html';
                    return;
                }
            }

            _renderSwitcher(instances, activeId);
            _updateTopBarInstance(instances, activeId);
        } catch (e) {
            // Non-fatal
        }
    }

    // ─── Top bar ──────────────────────────────────────────────────────────────

    function _renderTopBar() {
        if (document.getElementById('precede-topbar') || !_clerk?.user) return;

        const user     = _clerk.user;
        const initials = ((user.firstName?.[0] || '') + (user.lastName?.[0] || '')).toUpperCase() || '?';

        const bar = document.createElement('div');
        bar.id = 'precede-topbar';
        // Three-column flex: left spacer | center instance | right user btn
        bar.innerHTML = `
            <div style="flex:1;"></div>
            <div id="topbar-instance-center" style="display:flex;align-items:center;"></div>
            <div style="flex:1;display:flex;justify-content:flex-end;">
                <button class="topbar-user-btn" id="topbar-user-btn"
                        title="${_esc(user.fullName || user.firstName || '')}">
                    ${user.imageUrl
                        ? `<img src="${_esc(user.imageUrl)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`
                        : initials}
                </button>
            </div>`;

        document.body.insertBefore(bar, document.body.firstChild);

        document.getElementById('topbar-user-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            _closeInstanceDropdown();
            document.getElementById('topbar-panel') ? _closeUserPanel() : _openUserPanel();
        });
    }

    // Populate the center instance button (called after instances are fetched).
    function _updateTopBarInstance(instances, activeId) {
        const center = document.getElementById('topbar-instance-center');
        if (!center) return;

        const active = instances.find(i => i.id === activeId) || instances[0];
        if (!active) return;

        center.innerHTML = `
            <button class="topbar-instance-btn" id="topbar-instance-btn">
                <span style="width:8px;height:8px;border-radius:50%;background:${_esc(active.color || '#b05a38')};flex-shrink:0;display:inline-block;"></span>
                <span style="font-size:0.85rem;font-weight:600;color:#2c2318;">${_esc(active.name)}</span>
                ${instances.length > 1 ? '<span style="font-size:10px;color:#8c7d6a;margin-left:1px;">▾</span>' : ''}
            </button>`;

        center.querySelector('#topbar-instance-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            document.getElementById('instance-dropdown')
                ? _closeInstanceDropdown()
                : _openInstanceDropdown(instances, activeId);
        });
    }

    // ─── Instance dropdown (center button → switch) ───────────────────────────

    function _openInstanceDropdown(instances, activeId) {
        _closeInstanceDropdown();

        const btn = document.getElementById('topbar-instance-btn');
        if (!btn) return;
        const rect = btn.getBoundingClientRect();

        const backdrop = document.createElement('div');
        backdrop.id = 'instance-dd-backdrop';
        backdrop.addEventListener('click', _closeInstanceDropdown);
        document.body.appendChild(backdrop);

        const dd = document.createElement('div');
        dd.id = 'instance-dropdown';
        dd.style.cssText = `top:${Math.round(rect.bottom + 6)}px;left:${Math.round(rect.left + rect.width / 2)}px;transform:translateX(-50%);`;

        const items = instances.map(i => `
            <button data-switch="${_esc(i.id)}" style="display:flex;align-items:center;gap:8px;width:100%;
                    padding:8px 12px;border-radius:7px;border:none;
                    background:${i.id === activeId ? 'rgba(176,90,56,0.08)' : 'transparent'};
                    cursor:pointer;text-align:left;transition:background 0.12s;"
                    onmouseover="if(this.dataset.switch!=='${_esc(activeId)}')this.style.background='#ede7dc'"
                    onmouseout="if(this.dataset.switch!=='${_esc(activeId)}')this.style.background='transparent'">
                <span style="width:8px;height:8px;border-radius:50%;background:${_esc(i.color || '#b05a38')};flex-shrink:0;"></span>
                <span style="flex:1;font-size:0.83rem;font-weight:600;
                             color:${i.id === activeId ? '#b05a38' : '#2c2318'};">${_esc(i.name)}</span>
                ${i.id === activeId ? '<span style="font-size:0.7rem;color:#b05a38;">✓</span>' : ''}
            </button>`).join('');

        dd.innerHTML = `
            <div style="padding:6px;">${items}</div>
            <div style="border-top:1px solid #e0d8cc;padding:6px;">
                <button id="btn-dd-new-ws" style="display:flex;align-items:center;gap:6px;width:100%;
                        padding:7px 12px;border-radius:7px;border:none;background:transparent;
                        cursor:pointer;color:#8c7d6a;font-size:0.78rem;"
                        onmouseover="this.style.background='#ede7dc'" onmouseout="this.style.background='transparent'">
                    + New workspace
                </button>
            </div>`;

        document.body.appendChild(dd);

        dd.querySelectorAll('[data-switch]').forEach(b =>
            b.addEventListener('click', () => { _closeInstanceDropdown(); switchInstance(b.dataset.switch); })
        );
        dd.querySelector('#btn-dd-new-ws').addEventListener('click', () => {
            _closeInstanceDropdown();
            _openUserPanel();
        });
    }

    function _closeInstanceDropdown() {
        document.getElementById('instance-dropdown')?.remove();
        document.getElementById('instance-dd-backdrop')?.remove();
    }

    // ─── User panel (avatar → full account panel) ─────────────────────────────

    async function _openUserPanel() {
        _closeInstanceDropdown();
        _closeUserPanel();

        const user      = _clerk.user;
        const instances = _instanceCache || await _fetchInstances();
        const activeId  = localStorage.getItem(INSTANCE_KEY);
        const plan      = localStorage.getItem(PLAN_KEY) || 'free';

        const backdrop = document.createElement('div');
        backdrop.id = 'topbar-backdrop';
        backdrop.addEventListener('click', _closeUserPanel);
        document.body.appendChild(backdrop);

        const panel = document.createElement('div');
        panel.id = 'topbar-panel';

        const initials = ((user.firstName?.[0] || '') + (user.lastName?.[0] || '')).toUpperCase() || '?';
        const email    = user.primaryEmailAddress?.emailAddress || '';

        // Plan cards
        const planCards = PLANS.map(p => `
            <button data-plan="${p.id}" style="flex:1;padding:8px 4px;border-radius:8px;
                    border:2px solid ${plan === p.id ? p.color : '#e0d8cc'};
                    background:${plan === p.id ? p.color + '18' : 'transparent'};
                    cursor:pointer;transition:all 0.15s;text-align:center;">
                <div style="font-size:0.72rem;font-weight:700;color:${plan === p.id ? p.color : '#8c7d6a'};">${p.label}</div>
                <div style="font-size:0.65rem;color:${plan === p.id ? p.color : '#b0a090'};">${p.price}</div>
            </button>`).join('');

        // Instance list with edit button per row
        const instanceItems = instances.map(i => `
            <div id="instance-row-${_esc(i.id)}" style="display:flex;align-items:center;gap:2px;">
                <button data-switch="${_esc(i.id)}" style="display:flex;align-items:center;gap:8px;flex:1;
                        padding:7px 10px;border-radius:7px;border:none;
                        background:${i.id === activeId ? 'rgba(176,90,56,0.08)' : 'transparent'};
                        cursor:pointer;text-align:left;transition:background 0.1s;"
                        onmouseover="if(this.dataset.switch!=='${_esc(activeId)}')this.style.background='#ede7dc'"
                        onmouseout="if(this.dataset.switch!=='${_esc(activeId)}')this.style.background='transparent'">
                    <span style="width:8px;height:8px;border-radius:50%;background:${_esc(i.color || '#b05a38')};flex-shrink:0;"></span>
                    <span style="flex:1;font-size:0.82rem;font-weight:600;
                                 color:${i.id === activeId ? '#b05a38' : '#2c2318'};">${_esc(i.name)}</span>
                    ${i.id === activeId ? '<span style="font-size:0.7rem;color:#b05a38;">✓</span>' : ''}
                </button>
                <button data-edit="${_esc(i.id)}" data-name="${_esc(i.name)}" data-color="${_esc(i.color || '#b05a38')}"
                        style="padding:5px 7px;border-radius:6px;border:none;background:transparent;
                               cursor:pointer;color:#b0a090;font-size:0.78rem;flex-shrink:0;
                               transition:color 0.1s,background 0.1s;" title="Rename / recolor"
                        onmouseover="this.style.color='#2c2318';this.style.background='#ede7dc'"
                        onmouseout="this.style.color='#b0a090';this.style.background='transparent'">
                    ✎
                </button>
            </div>`).join('');

        panel.innerHTML = `
            <div style="padding:16px;border-bottom:1px solid #e0d8cc;">
                <div style="display:flex;align-items:center;gap:10px;">
                    <div style="width:38px;height:38px;border-radius:50%;background:#b05a38;display:flex;
                                align-items:center;justify-content:center;font-size:0.82rem;font-weight:700;
                                color:#ffffff;flex-shrink:0;overflow:hidden;">
                        ${user.imageUrl ? `<img src="${_esc(user.imageUrl)}" alt="" style="width:100%;height:100%;object-fit:cover;">` : initials}
                    </div>
                    <div style="overflow:hidden;">
                        <div style="font-size:0.88rem;font-weight:700;color:#2c2318;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                            ${_esc(user.fullName || user.firstName || '')}
                        </div>
                        <div style="font-size:0.72rem;color:#b0a090;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                            ${_esc(email)}
                        </div>
                    </div>
                </div>
            </div>

            <div style="padding:12px 16px;border-bottom:1px solid #e0d8cc;">
                <div style="font-size:0.6rem;text-transform:uppercase;letter-spacing:0.1em;color:#b0a090;font-weight:700;margin-bottom:8px;">Plan</div>
                <div style="display:flex;gap:6px;">${planCards}</div>
            </div>

            <div style="padding:12px 16px;border-bottom:1px solid #e0d8cc;">
                <div style="font-size:0.6rem;text-transform:uppercase;letter-spacing:0.1em;color:#b0a090;font-weight:700;margin-bottom:6px;">Workspaces</div>
                <div id="instance-list">${instanceItems}</div>
                <div id="new-workspace-area" style="margin-top:4px;">
                    <button id="btn-new-workspace" style="display:flex;align-items:center;gap:6px;width:100%;
                            padding:7px 10px;border-radius:7px;border:1px dashed #e0d8cc;
                            background:transparent;cursor:pointer;color:#8c7d6a;font-size:0.8rem;transition:background 0.12s;"
                            onmouseover="this.style.background='#ede7dc'" onmouseout="this.style.background='transparent'">
                        + New workspace
                    </button>
                </div>
            </div>

            <div style="padding:10px 16px;">
                <button id="btn-signout" style="display:flex;align-items:center;gap:6px;width:100%;
                        padding:7px 10px;border-radius:7px;border:none;background:transparent;
                        cursor:pointer;color:#8c7d6a;font-size:0.8rem;transition:background 0.12s;"
                        onmouseover="this.style.color='#9c3c3c';this.style.background='rgba(156,60,60,0.08)'"
                        onmouseout="this.style.color='#8c7d6a';this.style.background='transparent'">
                    Sign out
                </button>
            </div>`;

        document.body.appendChild(panel);

        // Event listeners
        panel.querySelectorAll('[data-plan]').forEach(btn =>
            btn.addEventListener('click', () => setPlan(btn.dataset.plan))
        );
        panel.querySelectorAll('[data-switch]').forEach(btn =>
            btn.addEventListener('click', () => switchInstance(btn.dataset.switch))
        );
        panel.querySelectorAll('[data-edit]').forEach(btn =>
            btn.addEventListener('click', () =>
                _showEditInstanceForm(btn.dataset.edit, btn.dataset.name, btn.dataset.color)
            )
        );
        panel.querySelector('#btn-new-workspace').addEventListener('click', _showNewWorkspaceForm);
        panel.querySelector('#btn-signout').addEventListener('click', signOut);
    }

    function _closeUserPanel() {
        document.getElementById('topbar-panel')?.remove();
        document.getElementById('topbar-backdrop')?.remove();
    }

    // ─── New workspace form (inline in panel) ────────────────────────────────

    function _showNewWorkspaceForm() {
        const area = document.getElementById('new-workspace-area');
        if (!area) return;

        const swatches = WORKSPACE_COLORS.map((c, i) =>
            `<span data-color="${c}" style="width:15px;height:15px;border-radius:50%;background:${c};cursor:pointer;display:inline-block;flex-shrink:0;${i === 0 ? 'outline:2px solid #2c2318;outline-offset:2px;' : ''}"></span>`
        ).join('');

        area.innerHTML = `
            <div id="color-swatches" style="display:flex;gap:6px;margin-bottom:8px;padding:2px;">${swatches}</div>
            <div style="display:flex;gap:6px;">
                <input id="ws-name-input" type="text" placeholder="Workspace name" maxlength="40"
                       style="flex:1;padding:7px 10px;border-radius:7px;border:1px solid #e0d8cc;
                              background:#f5f0e8;color:#2c2318;font-size:0.82rem;outline:none;width:auto;margin:0;">
                <button id="btn-create-ws" style="padding:7px 12px;border-radius:7px;background:#b05a38;color:#ffffff;
                        font-size:0.8rem;font-weight:600;border:none;cursor:pointer;white-space:nowrap;">
                    Create
                </button>
            </div>`;

        let selectedColor = WORKSPACE_COLORS[0];

        area.querySelectorAll('#color-swatches span').forEach(s => {
            s.addEventListener('click', () => {
                area.querySelectorAll('#color-swatches span').forEach(x => x.style.outline = 'none');
                s.style.outline = '2px solid #2c2318';
                s.style.outlineOffset = '2px';
                selectedColor = s.dataset.color;
            });
        });

        const nameInput = area.querySelector('#ws-name-input');
        const createBtn = area.querySelector('#btn-create-ws');
        nameInput.focus();

        const submit = async () => {
            const name = nameInput.value.trim();
            if (!name) { nameInput.style.borderColor = '#9c3c3c'; nameInput.focus(); return; }
            createBtn.textContent = '…';
            createBtn.disabled = true;
            try {
                const res = await authedFetch('/api/instances', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name, color: selectedColor }),
                });
                if (!res.ok) throw new Error('Failed');
                const newInstance = await res.json();
                _instanceCache = null;
                _closeUserPanel();
                switchInstance(newInstance.id);
            } catch {
                createBtn.textContent = 'Create';
                createBtn.disabled = false;
                nameInput.style.borderColor = '#9c3c3c';
            }
        };

        nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
        createBtn.addEventListener('click', submit);
    }

    // ─── Edit instance form (inline in panel, per row) ────────────────────────

    function _showEditInstanceForm(instanceId, currentName, currentColor) {
        const row = document.getElementById(`instance-row-${instanceId}`);
        if (!row) return;

        const swatches = WORKSPACE_COLORS.map(c =>
            `<span data-color="${c}" style="width:14px;height:14px;border-radius:50%;background:${c};cursor:pointer;display:inline-block;flex-shrink:0;${c === currentColor ? 'outline:2px solid #2c2318;outline-offset:2px;' : ''}"></span>`
        ).join('');

        row.innerHTML = `
            <div style="width:100%;padding:4px 2px;">
                <div id="edit-swatches" style="display:flex;gap:5px;margin-bottom:7px;padding:1px;">${swatches}</div>
                <div style="display:flex;gap:5px;">
                    <input id="edit-name-input" type="text" value="${_esc(currentName)}" maxlength="40"
                           style="flex:1;padding:6px 9px;border-radius:6px;border:1px solid #e0d8cc;
                                  background:#f5f0e8;color:#2c2318;font-size:0.8rem;outline:none;width:auto;margin:0;">
                    <button id="btn-save-edit" style="padding:6px 11px;border-radius:6px;background:#b05a38;color:#ffffff;
                            font-size:0.75rem;font-weight:600;border:none;cursor:pointer;white-space:nowrap;">Save</button>
                    <button id="btn-cancel-edit" style="padding:6px 8px;border-radius:6px;background:transparent;
                            color:#8c7d6a;font-size:0.75rem;border:none;cursor:pointer;">✕</button>
                </div>
            </div>`;

        let selectedColor = currentColor;

        row.querySelectorAll('#edit-swatches span').forEach(s => {
            s.addEventListener('click', () => {
                row.querySelectorAll('#edit-swatches span').forEach(x => x.style.outline = 'none');
                s.style.outline = '2px solid #2c2318';
                s.style.outlineOffset = '2px';
                selectedColor = s.dataset.color;
            });
        });

        const nameInput = row.querySelector('#edit-name-input');
        const saveBtn   = row.querySelector('#btn-save-edit');
        const cancelBtn = row.querySelector('#btn-cancel-edit');

        nameInput.focus();
        nameInput.select();

        cancelBtn.addEventListener('click', () => { _closeUserPanel(); _openUserPanel(); });

        const submit = async () => {
            const name = nameInput.value.trim();
            if (!name) { nameInput.style.borderColor = '#9c3c3c'; nameInput.focus(); return; }
            saveBtn.textContent = '…';
            saveBtn.disabled = true;
            try {
                const res = await authedFetch(`/api/instances/${instanceId}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name, color: selectedColor }),
                });
                if (!res.ok) throw new Error('Failed');
                _instanceCache = null;
                // Refresh top bar center if we renamed the active instance
                const freshInstances = await _fetchInstances();
                _updateTopBarInstance(freshInstances, localStorage.getItem(INSTANCE_KEY));
                _closeUserPanel();
                _openUserPanel();
            } catch {
                saveBtn.textContent = 'Save';
                saveBtn.disabled = false;
                nameInput.style.borderColor = '#9c3c3c';
            }
        };

        nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
        saveBtn.addEventListener('click', submit);
    }

    // ─── Plan selection ───────────────────────────────────────────────────────

    function setPlan(planId) {
        localStorage.setItem(PLAN_KEY, planId);
        _closeUserPanel();
        _openUserPanel();
    }

    // ─── Auth ─────────────────────────────────────────────────────────────────

    async function requireAuth() {
        const clerk = await _getClerk();
        if (!clerk.user) {
            const redirect = encodeURIComponent(window.location.pathname + window.location.search);
            window.location.href = `${LOGIN_URL}?redirect=${redirect}`;
            return false;
        }
        _clerk = clerk;
        await _ensureInstance();
        _renderTopBar();
        _initSwitcher(); // non-blocking — fetches instances then populates sidebar + top bar center
        return true;
    }

    async function authedFetch(url, options = {}) {
        const token      = await getToken();
        const instanceId = localStorage.getItem(INSTANCE_KEY);
        const headers    = { ...options.headers };
        if (token)      headers['Authorization'] = `Bearer ${token}`;
        if (instanceId) headers['X-Instance-Id'] = instanceId;
        return window.fetch(url, { ...options, headers });
    }

    async function signOut() {
        const clerk = await _getClerk();
        await clerk.signOut();
        window.location.href = '/login.html';
    }

    function getActiveInstanceType() {
        const activeId = localStorage.getItem(INSTANCE_KEY);
        const instance = _instanceCache?.find(i => i.id === activeId);
        return instance?.instance_type || 'pm';
    }

    window.Auth = { requireAuth, getToken, fetch: authedFetch, signOut, switchInstance, setPlan, getActiveInstanceType, esc: _esc };
})();

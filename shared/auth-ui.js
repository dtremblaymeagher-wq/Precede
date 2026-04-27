// shared/auth-ui.js
// UI layer for auth — top bar, sidebar switcher, user panel, workspace forms.
// Auto-loaded by shared/auth.js — do not add a <script> tag manually.
// Reads internals via window._AuthCore (set by auth.js before this file loads).

(function () {
    const core = () => window._AuthCore; // lazy ref — always available when called

    const PLANS = [
        { id: 'free', label: 'Freemium', price: 'Free',    color: '#8c7d6a' },
        { id: 'pro',  label: 'Pro',      price: 'TBD',     color: '#b05a38' },
        { id: 'team', label: 'Team',     price: 'TBD',     color: '#a07830' },
    ];

    const WORKSPACE_COLORS = ['#b05a38', '#a07830', '#4a8c54', '#9c3c3c', '#4a6a8c', '#7a5c8c'];

    // ─── Styles ───────────────────────────────────────────────────────────────

    function _injectStyles() {
        if (document.getElementById('precede-auth-ui-styles')) return;
        const style = document.createElement('style');
        style.id = 'precede-auth-ui-styles';
        style.textContent = `
/* ── Sidebar instance switcher ───────────────────────────────────────────── */
#instance-switcher          { margin: 0 0 4px; padding: 6px 10px; }
#instance-switcher.is-multi { margin-bottom: 6px; padding: 8px 10px;
                              background: rgba(255,255,255,0.06); border-radius: 8px;
                              border: 1px solid rgba(255,255,255,0.1); }
.is-label     { font-size: .62rem; text-transform: uppercase; letter-spacing: .1em;
                color: rgba(255,255,255,.25); font-weight: 700; margin-bottom: 5px; }
.is-multi .is-label { margin-bottom: 6px; }
.is-row       { display: flex; align-items: center; gap: 6px; overflow: hidden; }
.is-dot       { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
.is-ws-name   { font-size: .8rem; font-weight: 600; color: rgba(255,255,255,.55);
                overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.is-select    { flex: 1; min-width: 0; background: transparent; border: none; color: white;
                font-size: .8rem; font-weight: 600; cursor: pointer; outline: none;
                appearance: none; -webkit-appearance: none; padding: 1px 0; }
.is-caret     { color: rgba(255,255,255,.3); font-size: 9px; pointer-events: none; flex-shrink: 0; }

/* ── Top bar ─────────────────────────────────────────────────────────────── */
.tb-spacer          { flex: 1; }
.tb-right           { flex: 1; display: flex; justify-content: flex-end; }
.tb-instance-dot    { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; display: inline-block; }
.tb-instance-name   { font-size: .85rem; font-weight: 600; color: #2c2318; }
.tb-instance-caret  { font-size: 10px; color: #8c7d6a; margin-left: 1px; }
.tb-avatar-img      { width: 100%; height: 100%; object-fit: cover; border-radius: 50%; }

/* ── Instance dropdown ───────────────────────────────────────────────────── */
.idd-section  { padding: 6px; }
.idd-footer   { border-top: 1px solid #e0d8cc; padding: 6px; }
.idd-item     { display: flex; align-items: center; gap: 8px; width: 100%;
                padding: 8px 12px; border-radius: 7px; border: none;
                background: transparent; cursor: pointer; text-align: left; transition: background .12s; }
.idd-item:not(.is-active):hover { background: #ede7dc; }
.idd-item.is-active             { background: rgba(176,90,56,.08); }
.idd-item-dot   { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.idd-item-name  { flex: 1; font-size: .83rem; font-weight: 600; color: #2c2318; }
.idd-item.is-active .idd-item-name { color: #b05a38; }
.idd-item-check { font-size: .7rem; color: #b05a38; }
.idd-new-btn    { display: flex; align-items: center; gap: 6px; width: 100%;
                  padding: 7px 12px; border-radius: 7px; border: none;
                  background: transparent; cursor: pointer; color: #8c7d6a; font-size: .78rem; }
.idd-new-btn:hover { background: #ede7dc; }

/* ── User panel ──────────────────────────────────────────────────────────── */
.up-header        { padding: 16px; border-bottom: 1px solid #e0d8cc; }
.up-user-row      { display: flex; align-items: center; gap: 10px; }
.up-avatar        { width: 38px; height: 38px; border-radius: 50%; background: #b05a38;
                    display: flex; align-items: center; justify-content: center;
                    font-size: .82rem; font-weight: 700; color: #fff; flex-shrink: 0; overflow: hidden; }
.up-avatar img    { width: 100%; height: 100%; object-fit: cover; }
.up-user-info     { overflow: hidden; }
.up-user-name     { font-size: .88rem; font-weight: 700; color: #2c2318;
                    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.up-user-email    { font-size: .72rem; color: #b0a090;
                    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.up-section       { padding: 12px 16px; border-bottom: 1px solid #e0d8cc; }
.up-section-label { font-size: .6rem; text-transform: uppercase; letter-spacing: .1em;
                    color: #b0a090; font-weight: 700; margin-bottom: 8px; }
.up-plan-row      { display: flex; gap: 6px; }
.up-plan-card     { flex: 1; padding: 8px 4px; border-radius: 8px; cursor: pointer;
                    transition: all .15s; text-align: center; }
.up-plan-label    { font-size: .72rem; font-weight: 700; }
.up-plan-price    { font-size: .65rem; }
.up-instance-row  { display: flex; align-items: center; gap: 2px; }
.up-instance-btn  { display: flex; align-items: center; gap: 8px; flex: 1;
                    padding: 7px 10px; border-radius: 7px; border: none;
                    background: transparent; cursor: pointer; text-align: left; transition: background .1s; }
.up-instance-btn:not(.is-active):hover   { background: #ede7dc; }
.up-instance-btn.is-active               { background: rgba(176,90,56,.08); }
.up-instance-dot  { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.up-instance-name { flex: 1; font-size: .82rem; font-weight: 600; color: #2c2318; }
.up-instance-btn.is-active .up-instance-name { color: #b05a38; }
.up-instance-check { font-size: .7rem; color: #b05a38; }
.up-edit-btn      { padding: 5px 7px; border-radius: 6px; border: none; background: transparent;
                    cursor: pointer; color: #b0a090; font-size: .78rem; flex-shrink: 0;
                    transition: color .1s, background .1s; }
.up-edit-btn:hover { color: #2c2318; background: #ede7dc; }
.up-new-ws-area   { margin-top: 4px; }
.up-new-ws-btn    { display: flex; align-items: center; gap: 6px; width: 100%;
                    padding: 7px 10px; border-radius: 7px; border: 1px dashed #e0d8cc;
                    background: transparent; cursor: pointer; color: #8c7d6a; font-size: .8rem;
                    transition: background .12s; }
.up-new-ws-btn:hover   { background: #ede7dc; }
.up-signout-section    { padding: 10px 16px; }
.up-signout-btn        { display: flex; align-items: center; gap: 6px; width: 100%;
                         padding: 7px 10px; border-radius: 7px; border: none;
                         background: transparent; cursor: pointer; color: #8c7d6a;
                         font-size: .8rem; transition: background .12s, color .12s; }
.up-signout-btn:hover  { color: #9c3c3c; background: rgba(156,60,60,.08); }

/* ── Workspace / edit forms ──────────────────────────────────────────────── */
.ws-swatch-row      { display: flex; gap: 6px; margin-bottom: 8px; padding: 2px; }
.ws-swatch          { width: 15px; height: 15px; border-radius: 50%; cursor: pointer;
                      display: inline-block; flex-shrink: 0; }
.ws-edit-swatch     { width: 14px; height: 14px; border-radius: 50%; cursor: pointer;
                      display: inline-block; flex-shrink: 0; }
.ws-form-row        { display: flex; gap: 6px; }
.ws-name-input      { flex: 1; padding: 7px 10px; border-radius: 7px;
                      border: 1px solid #e0d8cc; background: #f5f0e8; color: #2c2318;
                      font-size: .82rem; outline: none; width: auto; margin: 0; }
.ws-name-input.is-error { border-color: #9c3c3c; }
.ws-create-btn      { padding: 7px 12px; border-radius: 7px; background: #b05a38; color: #fff;
                      font-size: .8rem; font-weight: 600; border: none; cursor: pointer; white-space: nowrap; }
.ws-edit-wrap       { width: 100%; padding: 4px 2px; }
.ws-edit-swatch-row { display: flex; gap: 5px; margin-bottom: 7px; padding: 1px; }
.ws-edit-form-row   { display: flex; gap: 5px; }
.ws-edit-name-input { flex: 1; padding: 6px 9px; border-radius: 6px;
                      border: 1px solid #e0d8cc; background: #f5f0e8; color: #2c2318;
                      font-size: .8rem; outline: none; width: auto; margin: 0; }
.ws-edit-name-input.is-error { border-color: #9c3c3c; }
.ws-save-btn        { padding: 6px 11px; border-radius: 6px; background: #b05a38; color: #fff;
                      font-size: .75rem; font-weight: 600; border: none; cursor: pointer; white-space: nowrap; }
.ws-cancel-btn      { padding: 6px 8px; border-radius: 6px; background: transparent;
                      color: #8c7d6a; font-size: .75rem; border: none; cursor: pointer; }
        `;
        document.head.appendChild(style);
    }

    // ─── Sidebar switcher ─────────────────────────────────────────────────────

    function _renderSwitcher(instances, activeId) {
        const { esc, INSTANCE_KEY } = core();
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
            el.innerHTML = `
                <div class="is-label">Workspace</div>
                <div class="is-row">
                    <span class="is-dot" style="background:${active.color || '#6366f1'};"></span>
                    <span class="is-ws-name">${esc(active.name)}</span>
                </div>`;
        } else {
            el.classList.add('is-multi');
            const options = instances.map(i =>
                `<option value="${esc(i.id)}" ${i.id === activeId ? 'selected' : ''} style="background:#1e293b;color:white;">${esc(i.name)}</option>`
            ).join('');

            el.innerHTML = `
                <div class="is-label">Workspace</div>
                <div class="is-row">
                    <span id="instance-dot" class="is-dot" style="background:${active.color || '#6366f1'};"></span>
                    <select id="instance-select" class="is-select">${options}</select>
                    <span class="is-caret">▾</span>
                </div>`;
        }

        signoutBtn.parentElement.insertBefore(el, signoutBtn);

        const select = el.querySelector('#instance-select');
        if (select) {
            select.addEventListener('change', () => core().switchInstance(select.value));
        }
    }

    // Fetch + validate + render sidebar switcher AND top bar center.
    // Also redirects if the current page doesn't match the active instance type.
    function initSwitcher() {
        _initSwitcherAsync().catch(() => {/* non-fatal */});
    }

    async function _initSwitcherAsync() {
        const { INSTANCE_KEY, fetchInstances } = core();
        const instances = await fetchInstances();
        const storedId  = localStorage.getItem(INSTANCE_KEY);

        // If stored instance no longer exists, reset to first available
        if (storedId && instances.length && !instances.find(i => i.id === storedId)) {
            localStorage.setItem(INSTANCE_KEY, instances[0].id);
            window.location.reload();
            return;
        }

        const activeId = localStorage.getItem(INSTANCE_KEY);
        const active   = instances.find(i => i.id === activeId);

        // Redirect if page doesn't match instance type.
        // Neutral pages are accessible from any instance type.
        const NEUTRAL_PATHS = ['/settings', '/vision-board', '/onboarding', '/data-entry', '/data-archive', '/roadmap', '/analyzer', '/decision-log', '/solution-brainstorm', '/meeting-center', '/meeting-strategist', '/learning-vault'];
        const isNeutralPage = NEUTRAL_PATHS.some(p => window.location.pathname.includes(p));
        if (active && !isNeutralPage) {
            const isExecPage     = window.location.pathname.includes('dashboard-exec') || window.location.pathname.includes('milestones-exec') || window.location.pathname.includes('roadmap-exec');
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
    }

    // ─── Top bar ──────────────────────────────────────────────────────────────

    function renderTopBar() {
        const { esc, getClerk } = core();
        const clerk = getClerk();
        if (document.getElementById('precede-topbar') || !clerk?.user) return;

        const user     = clerk.user;
        const initials = ((user.firstName?.[0] || '') + (user.lastName?.[0] || '')).toUpperCase() || '?';

        const bar = document.createElement('div');
        bar.id = 'precede-topbar';
        bar.innerHTML = `
            <div class="tb-spacer"></div>
            <div id="topbar-instance-center"></div>
            <div class="tb-right">
                <button class="topbar-user-btn" id="topbar-user-btn"
                        title="${esc(user.fullName || user.firstName || '')}">
                    ${user.imageUrl
                        ? `<img src="${esc(user.imageUrl)}" alt="" class="tb-avatar-img">`
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

    function _updateTopBarInstance(instances, activeId) {
        const { esc } = core();
        const center = document.getElementById('topbar-instance-center');
        if (!center) return;

        const active = instances.find(i => i.id === activeId) || instances[0];
        if (!active) return;

        center.innerHTML = `
            <button class="topbar-instance-btn" id="topbar-instance-btn">
                <span class="tb-instance-dot" style="background:${esc(active.color || '#b05a38')};"></span>
                <span class="tb-instance-name">${esc(active.name)}</span>
                ${instances.length > 1 ? '<span class="tb-instance-caret">▾</span>' : ''}
            </button>`;

        center.querySelector('#topbar-instance-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            document.getElementById('instance-dropdown')
                ? _closeInstanceDropdown()
                : _openInstanceDropdown(instances, activeId);
        });
    }

    // ─── Instance dropdown ────────────────────────────────────────────────────

    function _openInstanceDropdown(instances, activeId) {
        const { esc, switchInstance } = core();
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
            <button data-switch="${esc(i.id)}" class="idd-item${i.id === activeId ? ' is-active' : ''}">
                <span class="idd-item-dot" style="background:${esc(i.color || '#b05a38')};"></span>
                <span class="idd-item-name">${esc(i.name)}</span>
                ${i.id === activeId ? '<span class="idd-item-check">✓</span>' : ''}
            </button>`).join('');

        dd.innerHTML = `
            <div class="idd-section">${items}</div>
            <div class="idd-footer">
                <button id="btn-dd-new-ws" class="idd-new-btn">+ New workspace</button>
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

    // ─── User panel ───────────────────────────────────────────────────────────

    async function _openUserPanel() {
        const { esc, getClerk, fetchInstances, getCache, INSTANCE_KEY, PLAN_KEY, signOut, switchInstance } = core();
        _closeInstanceDropdown();
        _closeUserPanel();

        const user      = getClerk().user;
        const instances = getCache() || await fetchInstances();
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

        const planCards = PLANS.map(p => `
            <button data-plan="${p.id}" class="up-plan-card"
                    style="border: 2px solid ${plan === p.id ? p.color : '#e0d8cc'};
                           background: ${plan === p.id ? p.color + '18' : 'transparent'};">
                <div class="up-plan-label" style="color:${plan === p.id ? p.color : '#8c7d6a'};">${p.label}</div>
                <div class="up-plan-price"  style="color:${plan === p.id ? p.color : '#b0a090'};">${p.price}</div>
            </button>`).join('');

        const instanceItems = instances.map(i => `
            <div id="instance-row-${esc(i.id)}" class="up-instance-row">
                <button data-switch="${esc(i.id)}" class="up-instance-btn${i.id === activeId ? ' is-active' : ''}">
                    <span class="up-instance-dot" style="background:${esc(i.color || '#b05a38')};"></span>
                    <span class="up-instance-name">${esc(i.name)}</span>
                    ${i.id === activeId ? '<span class="up-instance-check">✓</span>' : ''}
                </button>
                <button data-edit="${esc(i.id)}" data-name="${esc(i.name)}" data-color="${esc(i.color || '#b05a38')}"
                        class="up-edit-btn" title="Rename / recolor">✎</button>
            </div>`).join('');

        panel.innerHTML = `
            <div class="up-header">
                <div class="up-user-row">
                    <div class="up-avatar">
                        ${user.imageUrl ? `<img src="${esc(user.imageUrl)}" alt="">` : initials}
                    </div>
                    <div class="up-user-info">
                        <div class="up-user-name">${esc(user.fullName || user.firstName || '')}</div>
                        <div class="up-user-email">${esc(email)}</div>
                    </div>
                </div>
            </div>

            <div class="up-section">
                <div class="up-section-label">Plan</div>
                <div class="up-plan-row">${planCards}</div>
            </div>

            <div class="up-section">
                <div class="up-section-label">Workspaces</div>
                <div id="instance-list">${instanceItems}</div>
                <div id="new-workspace-area" class="up-new-ws-area">
                    <button id="btn-new-workspace" class="up-new-ws-btn">+ New workspace</button>
                </div>
            </div>

            <div class="up-signout-section">
                <button id="btn-signout" class="up-signout-btn">Sign out</button>
            </div>`;

        document.body.appendChild(panel);

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

    // ─── New workspace form ───────────────────────────────────────────────────

    function _showNewWorkspaceForm() {
        const { fetch: authedFetch, switchInstance } = core();
        const area = document.getElementById('new-workspace-area');
        if (!area) return;

        const swatches = WORKSPACE_COLORS.map((c, i) =>
            `<span data-color="${c}" class="ws-swatch" style="background:${c};${i === 0 ? 'outline:2px solid #2c2318;outline-offset:2px;' : ''}"></span>`
        ).join('');

        area.innerHTML = `
            <div class="ws-swatch-row" id="color-swatches">${swatches}</div>
            <div class="ws-form-row">
                <input id="ws-name-input" type="text" placeholder="Workspace name" maxlength="40" class="ws-name-input">
                <button id="btn-create-ws" class="ws-create-btn">Create</button>
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
            if (!name) { nameInput.classList.add('is-error'); nameInput.focus(); return; }
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
                core().setCache(null);
                _closeUserPanel();
                switchInstance(newInstance.id);
            } catch {
                createBtn.textContent = 'Create';
                createBtn.disabled = false;
                nameInput.classList.add('is-error');
            }
        };

        nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
        createBtn.addEventListener('click', submit);
    }

    // ─── Edit instance form ───────────────────────────────────────────────────

    function _showEditInstanceForm(instanceId, currentName, currentColor) {
        const { esc, fetch: authedFetch, fetchInstances, INSTANCE_KEY } = core();
        const row = document.getElementById(`instance-row-${instanceId}`);
        if (!row) return;

        const swatches = WORKSPACE_COLORS.map(c =>
            `<span data-color="${c}" class="ws-edit-swatch" style="background:${c};${c === currentColor ? 'outline:2px solid #2c2318;outline-offset:2px;' : ''}"></span>`
        ).join('');

        row.innerHTML = `
            <div class="ws-edit-wrap">
                <div class="ws-edit-swatch-row" id="edit-swatches">${swatches}</div>
                <div class="ws-edit-form-row">
                    <input id="edit-name-input" type="text" value="${esc(currentName)}" maxlength="40" class="ws-edit-name-input">
                    <button id="btn-save-edit" class="ws-save-btn">Save</button>
                    <button id="btn-cancel-edit" class="ws-cancel-btn">✕</button>
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
            if (!name) { nameInput.classList.add('is-error'); nameInput.focus(); return; }
            saveBtn.textContent = '…';
            saveBtn.disabled = true;
            try {
                const res = await authedFetch(`/api/instances/${instanceId}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name, color: selectedColor }),
                });
                if (!res.ok) throw new Error('Failed');
                core().setCache(null);
                const freshInstances = await fetchInstances();
                _updateTopBarInstance(freshInstances, localStorage.getItem(INSTANCE_KEY));
                _closeUserPanel();
                _openUserPanel();
            } catch {
                saveBtn.textContent = 'Save';
                saveBtn.disabled = false;
                nameInput.classList.add('is-error');
            }
        };

        nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
        saveBtn.addEventListener('click', submit);
    }

    // ─── Plan selection ───────────────────────────────────────────────────────

    function setPlan(planId) {
        localStorage.setItem(core().PLAN_KEY, planId);
        _closeUserPanel();
        _openUserPanel();
    }

    // ─── Init ─────────────────────────────────────────────────────────────────

    _injectStyles();

    // ─── Public API ───────────────────────────────────────────────────────────

    window._AuthUI = { renderTopBar, initSwitcher, setPlan };
})();

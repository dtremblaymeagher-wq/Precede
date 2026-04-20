// shared/auth.js
// Define PRECEDE constants immediately (synchronous, before any other script runs).
// client-constants.js is the canonical source — this keeps auth.js self-sufficient
// so no extra <script> tag is needed on pages that only load auth.js.
window.PRECEDE = window.PRECEDE || {
    INSTANCE_KEY:            'precede_active_instance_id',
    PLAN_KEY:                'precede_plan',
    VISIT_KEY:               'precede_last_seen_analysis',
    SOLUTION_MODE_KEY:       'solutionMode',
    PENDING_STORY_KEY:       'pendingStoryIdea',
    PENDING_SIGNAL_IDS_KEY:  'pendingStorySignalIds',
    PENDING_DECISION_KEY:    'pendingDecision',
    BRAINSTORM_ITEMS_KEY:    'selectedBrainstormItems',
    BRAINSTORM_CHAT_KEY:     'brainstormChatHistory',
    BRAINSTORM_SESSIONS_KEY: 'brainstormSessions',
    VISION_RETURN_KEY:       'visionBoardReturnToSettings',
    VISION_CURRENT_KEY:      'visionBoardCurrentVision',
    EXEC_FIRST_VIEW_KEY:     'execDashboardFirstViewAt',
    CLERK_TEST_KEY:          'pk_test_dmFzdC1wZWdhc3VzLTQzLmNsZXJrLmFjY291bnRzLmRldiQ',
};


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
//
// UI layer lives in shared/auth-ui.js (auto-loaded below — do not add a <script> tag).

(function () {
    const LOGIN_URL    = '/login.html';
    const INSTANCE_KEY = window.PRECEDE.INSTANCE_KEY;
    const PLAN_KEY     = window.PRECEDE.PLAN_KEY;

    // ─── Clerk session ────────────────────────────────────────────────────────

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

    // ─── Instance management ──────────────────────────────────────────────────

    let _instanceCache = null;

    // Fetch instances without X-Instance-Id (free route on the server).
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

    // Switch to a different instance and redirect to the correct dashboard.
    function switchInstance(id) {
        if (!id || id === localStorage.getItem(INSTANCE_KEY)) return;
        localStorage.setItem(INSTANCE_KEY, id);
        const instance = _instanceCache?.find(i => i.id === id);
        const type     = instance?.instance_type || 'pm';
        window.location.href = type === 'executive' ? '/dashboard-exec.html' : '/dashboard.html';
    }

    function getActiveInstanceType() {
        const activeId = localStorage.getItem(INSTANCE_KEY);
        const instance = _instanceCache?.find(i => i.id === activeId);
        return instance?.instance_type || 'pm';
    }

    // ─── Utils ────────────────────────────────────────────────────────────────

    // Escape HTML to prevent XSS — exposed as Auth.esc for use across all pages.
    function _esc(str) {
        return String(str ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
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
        window._AuthUI?.renderTopBar?.();
        window._AuthUI?.initSwitcher?.();
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

    // ─── Internal API for auth-ui.js ─────────────────────────────────────────

    window._AuthCore = {
        INSTANCE_KEY,
        PLAN_KEY,
        esc:            _esc,
        getToken,
        fetch:          authedFetch,
        signOut,
        switchInstance,
        fetchInstances: _fetchInstances,
        getClerk:       () => _clerk,
        getCache:       () => _instanceCache,
        setCache:       (v) => { _instanceCache = v; },
    };

    // ─── Public API ───────────────────────────────────────────────────────────

    window.Auth = {
        requireAuth,
        getToken,
        fetch:                authedFetch,
        signOut,
        switchInstance,
        setPlan:              (id) => window._AuthUI?.setPlan(id),
        getActiveInstanceType,
        esc:                  _esc,
    };
})();

// Auto-load the UI layer (top bar, sidebar switcher, user panel).
// Injected here so pages don't need a second <script> tag.
// auth-ui.js is small and local — loads before DOMContentLoaded fires.
(function () {
    const s = document.createElement('script');
    s.src = '/shared/auth-ui.js';
    document.head.appendChild(s);
})();

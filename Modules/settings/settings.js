// Modules/Settings/settings.js

function launchVisionBoard() {
    const currentVision = document.getElementById('vision')?.value || '';
    localStorage.setItem(PRECEDE.VISION_RETURN_KEY, 'true');
    localStorage.setItem(PRECEDE.VISION_CURRENT_KEY, currentVision);
    window.location.href = '/Modules/Vision-board/vision-board.html';
}

document.addEventListener('DOMContentLoaded', async () => {
    const ok = await Auth.requireAuth();
    if (!ok) return;

    // Rich text editor for User Story Template
    let _editorUSTemplate = null;
    const _ustEl = document.getElementById('userStoryTemplate');
    if (_ustEl && typeof RichTextEditor !== 'undefined') {
        _editorUSTemplate = new RichTextEditor(_ustEl, {
            placeholder: 'En tant que... Je veux... Afin de...',
            minHeight: '80px',
        });
    }

    const personasContainer = document.getElementById('personasContainer');
    const clientsContainer = document.getElementById('clientsContainer');
    const addPersonaBtn = document.getElementById('addPersona');
    const addClientBtn = document.getElementById('addClient');
    const saveBtn = document.getElementById('save');
    const status = document.getElementById('status');

    // --- 1. FONCTION : CRÉER LE HTML D'UN PERSONA ---
    function createPersonaUI(name = '', role = '') {
        const div = document.createElement('div');
        div.className = 'persona-entry flex gap-2 mb-2 p-3 bg-slate-50 rounded-lg border border-slate-200';
        div.innerHTML = `
            <input type="text" placeholder="Name (e.g., Lead Dev)" class="p-name p-2 border rounded w-1/3" value="${name}">
            <input type="text" placeholder="Role/Main need" class="p-role p-2 border rounded w-full" value="${role}">
            <button class="remove-persona text-red-500 font-bold px-2">✕</button>
        `;
        
        // Supprimer un persona
        div.querySelector('.remove-persona').addEventListener('click', () => div.remove());
        personasContainer.appendChild(div);
    }

    // --- 2. FONCTION : CRÉER LE HTML D'UN CLIENT ---
    function createClientUI(name = '') {
        const div = document.createElement('div');
        div.className = 'client-entry flex gap-2 mb-2 p-3 bg-blue-50 rounded-lg border border-blue-200';
        div.innerHTML = `
            <input type="text" placeholder="Client name (e.g., TELUS Health)" class="c-name p-2 border rounded w-full" value="${name}">
            <button class="remove-client text-red-500 font-bold px-2">✕</button>
        `;
        
        // Supprimer un client
        div.querySelector('.remove-client').addEventListener('click', () => div.remove());
        clientsContainer.appendChild(div);
    }

    // --- 3. FONCTION : CHARGER LES SETTINGS ---
    async function loadSettings() {
        try {
            const res = await Auth.fetch('/api/settings');
            const settings = await res.json();

            // Mapping des champs simples
            if (document.getElementById('vision')) document.getElementById('vision').value = settings.vision || "";
            if (document.getElementById('objectives')) document.getElementById('objectives').value = (settings.objectives || []).join('\n');
            if (document.getElementById('priorities')) document.getElementById('priorities').value = (settings.priorities || []).join(', ');
            
            // Champs pour le Grooming & Story
            if (_editorUSTemplate) {
                _editorUSTemplate.setContent(settings.userStoryTemplate || '');
            } else if (document.getElementById('userStoryTemplate')) {
                document.getElementById('userStoryTemplate').value = settings.userStoryTemplate || '';
            }
            
            // Definition of Ready
            if (document.getElementById('definitionOfReady')) {
                document.getElementById('definitionOfReady').value = settings.definitionOfReady || "";
            }

            // Chargement des personas
            personasContainer.innerHTML = ''; // Nettoyage
            if (settings.personas && settings.personas.length > 0) {
                settings.personas.forEach(p => createPersonaUI(p.name, p.role));
            } else {
                createPersonaUI(); // Un champ vide par défaut
            }

            // Chargement des clients
            clientsContainer.innerHTML = ''; // Nettoyage
            if (settings.clients && settings.clients.length > 0) {
                settings.clients.forEach(c => createClientUI(c));
            } else {
                createClientUI(); // Un champ vide par défaut
            }
        } catch (e) {
            console.error("Error loading settings:", e);
        }
    }

    // --- 4. FONCTION : SAUVEGARDER LES SETTINGS ---
    saveBtn.addEventListener('click', async () => {
        // Préparation des données
        const updatedSettings = {
            vision: document.getElementById('vision')?.value || "",
            objectives: document.getElementById('objectives')?.value
                .split('\n')
                .flatMap(o => o.split('|').map(s => s.trim()))
                .filter(o => o) || [],
            priorities: document.getElementById('priorities')?.value.split(',').map(p => p.trim()).filter(p => p) || [],
            userStoryTemplate: _editorUSTemplate ? _editorUSTemplate.getHTML() : (document.getElementById('userStoryTemplate')?.value || ''),
            definitionOfReady: document.getElementById('definitionOfReady')?.value || "",
            
            // Personas
            personas: Array.from(document.querySelectorAll('.persona-entry')).map(div => ({
                name: div.querySelector('.p-name').value,
                role: div.querySelector('.p-role').value
            })),

            // Clients
            clients: Array.from(document.querySelectorAll('.client-entry'))
                .map(div => div.querySelector('.c-name').value)
                .filter(name => name.trim() !== '') // Filtrer les noms vides
        };

        try {
            status.textContent = "⏳ Saving...";
            const res = await Auth.fetch('/api/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updatedSettings)
            });

            if (res.ok) {
                status.textContent = "✅ Settings saved!";
                status.style.color = "#10b981"; // Emerald
                setTimeout(() => { status.textContent = ""; }, 3000);
            } else {
                throw new Error("Server error");
            }
        } catch (e) {
            status.textContent = "❌ Error saving";
            status.style.color = "#ef4444"; // Red
        }
    });

    // --- 5. ÉVÉNEMENTS ---
    addPersonaBtn.addEventListener('click', () => createPersonaUI());
    addClientBtn.addEventListener('click', () => createClientUI());

    // Initialisation
    loadSettings();

    // ── 6. INTEGRATIONS ────────────────────────────────────────────────────────

    const integStatus   = document.getElementById('integStatus');
    const integLastSync = document.getElementById('integLastSync');

    function setIntegStatus(msg, color = '#64748b') {
        integStatus.textContent = msg;
        integStatus.style.color = color;
        if (msg) setTimeout(() => { if (integStatus.textContent === msg) integStatus.textContent = ''; }, 4000);
    }

    // Load existing config (apiKey intentionally omitted by server)
    async function loadIntegrationConfig() {
        try {
            const res  = await Auth.fetch('/api/integration/config');
            const data = await res.json();
            if (!data) return;
            if (data.type)       document.getElementById('integType').value       = data.type;
            if (data.baseUrl)    document.getElementById('integBaseUrl').value    = data.baseUrl;
            if (data.email)      document.getElementById('integEmail').value      = data.email;
            if (data.projectKey) document.getElementById('integProjectKey').value = data.projectKey;
            if (data.boardId)    document.getElementById('integBoardId').value    = data.boardId;
            // Show a masked placeholder when a key is already stored
            if (data.baseUrl || data.email) {
                document.getElementById('integApiKey').placeholder = '••••••••';
            }
            if (data.updatedAt) {
                integLastSync.textContent = `Last saved: ${new Date(data.updatedAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}`;
            }
        } catch (e) {
            console.error('Error loading integration config:', e);
        }
    }

    loadIntegrationConfig();

    // Save integration config
    document.getElementById('saveIntegBtn').addEventListener('click', async () => {
        const type       = document.getElementById('integType').value;
        const baseUrl    = document.getElementById('integBaseUrl').value.trim();
        const email      = document.getElementById('integEmail').value.trim();
        const apiKeyRaw  = document.getElementById('integApiKey').value.trim();
        // Empty or the masked placeholder both mean "keep existing key"
        const apiKey     = (apiKeyRaw === '' || apiKeyRaw === '••••••••') ? '' : apiKeyRaw;
        const projectKey = document.getElementById('integProjectKey').value.trim();
        const boardId    = document.getElementById('integBoardId').value.trim();

        if (!baseUrl || !email) {
            setIntegStatus('⚠️ Base URL and email are required', '#f59e0b');
            return;
        }

        try {
            setIntegStatus('⏳ Saving...');
            const res = await Auth.fetch('/api/integration/save-config', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ type, baseUrl, email, apiKey, projectKey, boardId: boardId ? parseInt(boardId) : null }),
            });
            if (res.ok) {
                setIntegStatus('✅ Integration saved!', '#10b981');
                document.getElementById('integApiKey').value = '';
                loadIntegrationConfig();
            } else {
                const err = await res.json();
                setIntegStatus(`❌ ${err.error || 'Save failed'}`, '#ef4444');
            }
        } catch (e) {
            setIntegStatus('❌ Connection error', '#ef4444');
        }
    });

    // Test connection
    document.getElementById('testIntegBtn').addEventListener('click', async () => {
        try {
            setIntegStatus('⏳ Testing connection...');
            const res  = await Auth.fetch('/api/integration/test', { method: 'POST' });
            const data = await res.json();
            if (data.success) {
                setIntegStatus(`✅ ${data.message}`, '#10b981');
            } else {
                setIntegStatus(`❌ ${data.message}`, '#ef4444');
            }
        } catch (e) {
            setIntegStatus('❌ Test failed — is integration configured?', '#ef4444');
        }
    });

    // Sync signals from Jira → Intelligence Hub
    document.getElementById('syncSignalsBtn').addEventListener('click', async () => {
        try {
            setIntegStatus('⏳ Syncing signals from Jira...');
            const res  = await Auth.fetch('/api/integration/sync-signals', { method: 'POST' });
            const data = await res.json();
            if (res.ok) {
                setIntegStatus(`✅ ${data.count} signal(s) imported into the Hub`, '#10b981');
            } else {
                setIntegStatus(`❌ ${data.error || 'Sync failed'}`, '#ef4444');
            }
        } catch (e) {
            setIntegStatus('❌ Sync error', '#ef4444');
        }
    });

    // Sync sprints from Jira (initial: last 5 closed + active, with completion stats)
    document.getElementById('syncSprintsBtn').addEventListener('click', async () => {
        try {
            setIntegStatus('⏳ Syncing sprints from Jira...');
            const res  = await Auth.fetch('/api/import/sprints/initial', { method: 'POST' });
            const data = await res.json();
            if (res.ok) {
                setIntegStatus(`✅ ${data.total} sprint(s) synced`, '#10b981');
            } else {
                setIntegStatus(`❌ ${data.error || 'Sprint sync failed'}`, '#ef4444');
            }
        } catch (e) {
            setIntegStatus('❌ Sprint sync error', '#ef4444');
        }
    });

    // ── 7. SPRINT CONFIGURATION ────────────────────────────────────────────────

    function setSprintStatus(msg, color = '#64748b') {
        const el = document.getElementById('sprintConfigStatus');
        el.textContent = msg;
        el.style.color = color;
        if (msg) setTimeout(() => { if (el.textContent === msg) el.textContent = ''; }, 3000);
    }

    function setExStatus(msg, color = '#64748b') {
        const el = document.getElementById('exceptionStatus');
        el.textContent = msg;
        el.style.color = color;
        if (msg) setTimeout(() => { if (el.textContent === msg) el.textContent = ''; }, 3000);
    }

    // Load sprint config fields from settings
    async function loadSprintConfig() {
        try {
            const res = await Auth.fetch('/api/settings');
            const s   = await res.json();
            if (s.sprint_duration_days)
                document.getElementById('sprintDuration').value = String(s.sprint_duration_days);
            if (s.sprint_start_date)
                document.getElementById('sprintStartDate').value = s.sprint_start_date;
            await loadSprintPreview();
        } catch (e) { console.error('Error loading sprint config:', e); }
    }

    // Show calculated current sprint below the save button
    async function loadSprintPreview() {
        const el = document.getElementById('sprintPreview');
        try {
            const res = await Auth.fetch('/api/sprints/current');
            if (!res.ok) { el.textContent = ''; return; }
            const s = await res.json();
            if (!s) { el.textContent = 'Set a start date to see the current sprint.'; return; }
            const fmt = d => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            el.textContent = `Current sprint: Sprint ${s.sprint_number} · ${fmt(s.start_date)} → ${fmt(s.end_date)} · Day ${s.days_elapsed} of ${s.duration_days}`;
        } catch (e) { el.textContent = ''; }
    }

    // Save sprint config
    document.getElementById('saveSprintConfigBtn').addEventListener('click', async () => {
        const dur   = document.getElementById('sprintDuration').value;
        const start = document.getElementById('sprintStartDate').value;
        if (!start) {
            setSprintStatus('⚠️ Set a first sprint start date', '#f59e0b');
            return;
        }
        try {
            setSprintStatus('⏳ Saving...');
            const res = await Auth.fetch('/api/settings', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ sprint_duration_days: parseInt(dur), sprint_start_date: start }),
            });
            if (res.ok) {
                setSprintStatus('✅ Sprint config saved!', '#10b981');
                await loadSprintPreview();
            } else throw new Error();
        } catch (e) {
            setSprintStatus('❌ Error saving', '#ef4444');
        }
    });

    // Load and render sprint exceptions
    async function loadExceptions() {
        const container = document.getElementById('exceptionListContainer');
        try {
            const res  = await Auth.fetch('/api/sprint-exceptions');
            const list = await res.json();
            if (!list.length) {
                container.innerHTML = '<p class="helper-text">No exceptions — sprints are calculated automatically.</p>';
                return;
            }
            const fmt = d => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
            container.innerHTML = list.map(ex => `
                <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid #f1f5f9;font-size:13px;">
                    <div>
                        <span style="font-weight:700;color:#0f172a;">${ex.label || '—'}</span>
                        <span style="color:#94a3b8;margin-left:10px;font-family:monospace;font-size:11px;">${fmt(ex.start_date)} → ${fmt(ex.end_date)}</span>
                    </div>
                    <button onclick="window._deleteException('${ex.id}')"
                        style="font-size:11px;font-weight:700;color:#ef4444;background:#fef2f2;border:none;padding:4px 10px;border-radius:6px;cursor:pointer;">
                        Delete
                    </button>
                </div>`).join('');
        } catch (e) {
            container.innerHTML = '<p style="font-size:12px;color:#ef4444;">Error loading exceptions</p>';
        }
    }

    window._deleteException = async function(id) {
        try {
            const res = await Auth.fetch(`/api/sprint-exceptions/${id}`, { method: 'DELETE' });
            if (res.ok) { setExStatus('✅ Exception deleted', '#10b981'); loadExceptions(); }
            else throw new Error();
        } catch (e) { setExStatus('❌ Error deleting', '#ef4444'); }
    };

    // Add exception form
    document.getElementById('addExceptionBtn').addEventListener('click', () => {
        document.getElementById('addExceptionForm').style.display = 'block';
    });
    document.getElementById('cancelExceptionBtn').addEventListener('click', () => {
        document.getElementById('addExceptionForm').style.display = 'none';
    });
    document.getElementById('saveExceptionBtn').addEventListener('click', async () => {
        const start = document.getElementById('newExStart').value;
        const end   = document.getElementById('newExEnd').value;
        const label = document.getElementById('newExLabel').value.trim() || null;
        if (!start || !end) {
            setExStatus('⚠️ Start and end dates are required', '#f59e0b');
            return;
        }
        try {
            const res = await Auth.fetch('/api/sprint-exceptions', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ start_date: start, end_date: end, label }),
            });
            if (res.ok) {
                setExStatus('✅ Exception saved', '#10b981');
                document.getElementById('addExceptionForm').style.display = 'none';
                document.getElementById('newExStart').value = '';
                document.getElementById('newExEnd').value   = '';
                document.getElementById('newExLabel').value = '';
                loadExceptions();
            } else throw new Error();
        } catch (e) { setExStatus('❌ Error saving exception', '#ef4444'); }
    });

    loadSprintConfig();
    loadExceptions();

});

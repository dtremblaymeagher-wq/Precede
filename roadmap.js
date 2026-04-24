'use strict';
// roadmap.js — Predictive Roadmap visual layer
// Phase 2, Step 1: TOP cards + BOTTOM Gantt skeleton (no cursor yet)

const Roadmap = (() => {

    const EPIC_COLORS = ['#6366f1', '#10b981', '#ef4444', '#8b5cf6', '#f59e0b', '#06b6d4'];

    // Design tokens — single source of truth for all inline colors in this module
    const RM = Object.freeze({
        indigo:      '#6366f1',  // primary / default epic
        emerald:     '#10b981',  // on-track, success, precise-match confidence
        red:         '#ef4444',  // critical
        amber:       '#f59e0b',  // at-risk, size-only confidence
        cyan:        '#06b6d4',  // type-expanded confidence
        greenLight:  '#4ade80',  // complete / earlier milestone
        yellow:      '#fbbf24',  // late / missed milestone
        indigoLight: '#a5b4fc',  // in-progress
        slate:       '#64748b',  // not-started / default
        slateDark:   '#334155',  // not started (background)
        gray:        '#6b7280',  // insufficient confidence / muted
        grayFaint:   '#888888',  // tooltip fallback
    });
    const LABEL_W         = 200;
    const IMPACT_COL_W    = 160;
    const PRIORITY_SHARES = [0.48, 0.29, 0.16, 0.07]; // velocity % by epic rank

    let _projection          = null;
    let _epics               = null;
    let _sprints             = [];
    let _timeline            = null;
    let _predictions         = null; // Map<epicKey, predictionRow>
    let _cursorDate          = new Date();
    let _activeTab           = 'current';
    let _scenarioName        = 'New Scenario';
    let _scenarioOrder       = [];   // epic IDs in scenario order
    let _scenarioProjections = [];   // recalculated projections for scenario
    let _dragEpicId           = null;
    let _savedScenarios       = [];   // fetched from DB
    let _currentScenarioId    = null; // DB id of the loaded/saved scenario
    let _toastTimer           = null;
    let _milestones           = [];   // fetched from DB
    let _editingMilestoneId   = null;
    let _timelineClickHandler = null;
    let _engineData           = null; // /api/engine/analysis response

    // ── Entry points ──────────────────────────────────────────────────────────

    async function load() {
        _resetUI();
        try {
            await Auth.requireAuth();
            const [projRes, epicsRes, sprintsRes, scenRes, msRes, predRes, engineRes] = await Promise.all([
                Auth.fetch('/api/roadmap/projection'),
                Auth.fetch('/api/roadmap/epics'),
                Auth.fetch('/api/sprints/list?count=30'),
                Auth.fetch('/api/roadmap/scenarios'),
                Auth.fetch('/api/roadmap/milestones'),
                Auth.fetch('/api/epic-prediction/epics').catch(() => null),
                Auth.fetch('/api/engine/analysis').catch(() => null),
            ]);

            if (!projRes.ok)  throw new Error(`Projection: ${projRes.status}`);
            if (!epicsRes.ok) throw new Error(`Epics: ${epicsRes.status}`);

            _projection      = await projRes.json();
            _epics           = await epicsRes.json();
            _sprints         = sprintsRes.ok ? (await sprintsRes.json()) : [];
            _savedScenarios  = scenRes.ok    ? (await scenRes.json())    : [];
            _milestones      = msRes.ok      ? (await msRes.json())      : [];

            if (predRes?.ok) {
                const preds = await predRes.json().catch(() => []);
                _predictions = new Map((preds ?? []).map(p => [p.epicKey, p]));
            }

            if (engineRes?.ok) {
                _engineData = await engineRes.json().catch(() => null);
            }

            _render();
        } catch (e) {
            console.error('Roadmap error:', e);
            _showError(e.message);
        }
    }

    function refresh() {
        _projection = null;
        _epics      = null;
        _sprints    = [];
        _engineData = null;
        load();
    }

    function switchTab(tab) {
        _activeTab = tab;

        // Update tab button active state
        document.querySelectorAll('#rm-tabs [data-tab]').forEach(el => {
            el.classList.toggle('active', el.dataset.tab === tab);
        });

        // Show/hide scenario mode bar
        document.getElementById('scenario-mode-bar')
            ?.classList.toggle('visible', tab === 'scenario');

        // Seed scenario order from current projection on first switch
        if (tab === 'scenario' && _scenarioOrder.length === 0) {
            _scenarioOrder = _engineToProjections().map(ep => ep.epicId);
        }

        // Toggle scenario-active class on rm-bottom (shows impact columns)
        document.getElementById('rm-bottom')
            ?.classList.toggle('scenario-active', tab === 'scenario');

        // Recalculate scenario projections then re-render
        if (tab === 'scenario') _recalculateScenario();
        if (_projection) {
            _buildTimeline(_activeProjections());
            _renderGanttHeader();
            _renderGanttRows();
            _renderTop(_cursorDate);
            _initDragDrop();
            _initGanttBodyHover();
            _initTimelineClick();
        }
    }

    function renameScenario(e) {
        e.stopPropagation(); // don't trigger switchTab
        const nameEl = document.getElementById('rm-scenario-name');
        if (!nameEl) return;
        const current = _scenarioName;
        const next = prompt('Scenario name:', current);
        if (next && next.trim()) {
            _scenarioName = next.trim();
            nameEl.textContent = _scenarioName;
        }
    }

    // No longer used — kept as fallback stub
    function comingSoon() { _showToast('Coming soon', 'success'); }

    async function saveScenario() {
        if (!_projection) return;

        // Seed order if not yet modified
        if (!_scenarioOrder.length) {
            _scenarioOrder = _engineToProjections().map(ep => ep.epicId);
        }

        const name = prompt('Scenario name:', _scenarioName)?.trim();
        if (!name) return;
        _scenarioName = name;

        const nameEl = document.getElementById('rm-scenario-name');
        if (nameEl) nameEl.textContent = name;

        try {
            const res = await Auth.fetch('/api/roadmap/scenarios', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id:          _currentScenarioId ?? undefined,
                    name,
                    epic_order:  _scenarioOrder,
                    visibility: 'private',
                }),
            });

            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error ?? `HTTP ${res.status}`);
            }

            const saved = await res.json();
            _currentScenarioId = saved.id;

            // Refresh local list
            const existing = _savedScenarios.findIndex(s => s.id === saved.id);
            if (existing >= 0) _savedScenarios[existing] = saved;
            else _savedScenarios.unshift(saved);

            _showToast(`"${name}" saved`, 'success');
        } catch (e) {
            console.error('Save scenario error:', e);
            _showToast('Save failed — ' + e.message, 'error');
        }
    }

    function openScenarios(e) {
        const dd  = document.getElementById('rm-scenarios-dd');
        const bkd = document.getElementById('rm-scenarios-backdrop');
        if (!dd || !bkd) return;

        // Build list HTML
        const items = _savedScenarios.length
            ? _savedScenarios.map(s => {
                const date = new Date(s.updated_at ?? s.created_at)
                    .toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                const active = s.id === _currentScenarioId
                    ? ' style="background:rgba(99,102,241,0.1);"' : '';
                return `<div class="rm-scenario-item"${active}
                             onclick="Roadmap.loadScenario('${Auth.esc(s.id)}')">
                            <div class="rm-scenario-item-name">${Auth.esc(s.name)}</div>
                            <div class="rm-scenario-item-date">${Auth.esc(date)}</div>
                            <button class="rm-scenario-del" title="Delete"
                                    onclick="event.stopPropagation();Roadmap.deleteScenario('${Auth.esc(s.id)}')">✕</button>
                        </div>`;
            }).join('')
            : '<div class="rm-scenarios-empty">No saved scenarios yet</div>';

        dd.innerHTML = `<div class="rm-scenarios-hdr">Saved scenarios</div>${items}`;

        // Position below the trigger button
        const btn  = document.getElementById('rm-scenarios-btn');
        const rect = btn?.getBoundingClientRect() ?? { bottom: 100, left: 0 };
        dd.style.top     = (rect.bottom + 6) + 'px';
        dd.style.right   = (window.innerWidth - rect.right) + 'px';
        dd.style.display = 'block';
        bkd.style.display = 'block';
    }

    function closeScenarios() {
        const dd  = document.getElementById('rm-scenarios-dd');
        const bkd = document.getElementById('rm-scenarios-backdrop');
        if (dd)  dd.style.display  = 'none';
        if (bkd) bkd.style.display = 'none';
    }

    function loadScenario(id) {
        closeScenarios();
        const s = _savedScenarios.find(sc => sc.id === id);
        if (!s || !_projection) return;

        _currentScenarioId = s.id;
        _scenarioName      = s.name;
        _scenarioOrder     = s.epic_order.slice();

        const nameEl = document.getElementById('rm-scenario-name');
        if (nameEl) nameEl.textContent = _scenarioName;

        // Switch to scenario tab if not already
        if (_activeTab !== 'scenario') {
            switchTab('scenario');
        } else {
            _recalculateScenario();
            _buildTimeline(_activeProjections());
            _renderGanttHeader();
            _renderGanttRows();
            _renderTop(_cursorDate);
            _initDragDrop();
            _initGanttBodyHover();
        }

        _showToast(`Loaded "${s.name}"`, 'success');
    }

    async function deleteScenario(id) {
        const s = _savedScenarios.find(sc => sc.id === id);
        if (!s) return;
        if (!confirm(`Delete scenario "${s.name}"?`)) return;

        try {
            const res = await Auth.fetch(`/api/roadmap/scenarios/${encodeURIComponent(id)}`, {
                method: 'DELETE',
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);

            _savedScenarios = _savedScenarios.filter(sc => sc.id !== id);
            if (_currentScenarioId === id) _currentScenarioId = null;

            // Refresh dropdown if still open
            if (document.getElementById('rm-scenarios-dd')?.style.display !== 'none') {
                openScenarios();
            }
            _showToast(`"${s.name}" deleted`, 'success');
        } catch (e) {
            _showToast('Delete failed — ' + e.message, 'error');
        }
    }

    function resetScenario() {
        _scenarioOrder = _engineToProjections().map(ep => ep.epicId);
        _recalculateScenario();
        _buildTimeline(_activeProjections());
        _renderGanttHeader();
        _renderGanttRows();
        _renderTop(_cursorDate);
        _initDragDrop();
        _initGanttBodyHover();
    }

    // ── Milestone panel ───────────────────────────────────────────────────────

    function openMilestonePanel(dateStr, milestone) {
        const panel = document.getElementById('rm-milestone-panel');
        if (!panel) return;

        _editingMilestoneId = milestone?.id ?? null;
        const isEdit = !!_editingMilestoneId;

        document.getElementById('rm-ms-title').textContent  = isEdit ? '🏁 Edit Milestone' : '🏁 New Milestone';
        document.getElementById('rm-ms-save-btn').textContent = isEdit ? 'Save →' : 'Create →';
        document.getElementById('rm-ms-id').value   = milestone?.id   ?? '';
        document.getElementById('rm-ms-name').value = milestone?.name ?? '';
        document.getElementById('rm-ms-date').value =
            milestone?.date ?? dateStr ?? new Date().toISOString().slice(0, 10);
        document.getElementById('rm-ms-note').value = milestone?.note ?? '';

        const type = milestone?.type ?? 'external';
        document.querySelectorAll('input[name="rm-ms-type"]').forEach(r => {
            r.checked = r.value === type;
        });

        // Epic checkboxes
        const projs  = _projection?.projections ?? [];
        const linked = new Set(milestone?.linked_epic_ids ?? []);
        document.getElementById('rm-ms-epics').innerHTML = projs.length
            ? projs.map((ep, idx) => {
                const color = EPIC_COLORS[idx % EPIC_COLORS.length];
                return `<label class="rm-ms-epic-check">
                    <input type="checkbox" value="${Auth.esc(ep.epicId)}"${linked.has(ep.epicId) ? ' checked' : ''}>
                    <span class="rm-ms-epic-dot" style="background:${color};"></span>
                    <span class="rm-ms-epic-name" title="${Auth.esc(ep.epicName)}">${Auth.esc(ep.epicName)}</span>
                </label>`;
            }).join('')
            : '<div style="color:#334155;font-size:0.65rem;">No epics found</div>';

        panel.classList.add('open');
        setTimeout(() => document.getElementById('rm-ms-name')?.focus(), 260);
    }

    function closeMilestonePanel() {
        document.getElementById('rm-milestone-panel')?.classList.remove('open');
        _editingMilestoneId = null;
    }

    async function saveMilestone() {
        const name = document.getElementById('rm-ms-name')?.value.trim();
        const date = document.getElementById('rm-ms-date')?.value;
        if (!name) { document.getElementById('rm-ms-name')?.focus(); return; }
        if (!date) { document.getElementById('rm-ms-date')?.focus(); return; }

        const type          = document.querySelector('input[name="rm-ms-type"]:checked')?.value ?? 'external';
        const linkedEpicIds = [...document.querySelectorAll('#rm-ms-epics input:checked')].map(i => i.value);
        const note          = document.getElementById('rm-ms-note')?.value.trim() || null;

        const isEdit = !!_editingMilestoneId;
        const url    = isEdit
            ? `/api/roadmap/milestones/${encodeURIComponent(_editingMilestoneId)}`
            : '/api/roadmap/milestones';

        try {
            const res = await Auth.fetch(url, {
                method:  isEdit ? 'PUT' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ name, date, type, linkedEpicIds, note }),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error ?? `HTTP ${res.status}`);
            }
            const saved = await res.json();

            if (isEdit) {
                const idx = _milestones.findIndex(m => m.id === saved.id);
                if (idx >= 0) _milestones[idx] = saved;
            } else {
                _milestones.push(saved);
                _milestones.sort((a, b) => a.date.localeCompare(b.date));
            }

            closeMilestonePanel();
            _showToast(isEdit ? 'Milestone updated' : 'Milestone created', 'success');
            _renderMilestoneLines();
            _renderMilestoneListPanel();
        } catch (e) {
            console.error('saveMilestone error:', e);
            _showToast('Save failed — ' + e.message, 'error');
        }
    }

    async function deleteMilestone(id) {
        const m = _milestones.find(ms => ms.id === id);
        if (!m || !confirm(`Delete milestone "${m.name}"?`)) return;
        try {
            const res = await Auth.fetch(
                `/api/roadmap/milestones/${encodeURIComponent(id)}`, { method: 'DELETE' }
            );
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            _milestones = _milestones.filter(ms => ms.id !== id);
            _renderMilestoneLines();
            _renderMilestoneListPanel();
            _showToast('Milestone deleted', 'success');
        } catch (e) {
            _showToast('Delete failed — ' + e.message, 'error');
        }
    }

    // ── Milestone list panel ──────────────────────────────────────────────────

    function editMilestone(id) {
        const ms = (_milestones ?? []).find(m => m.id === id);
        if (ms) openMilestonePanel(null, ms);
    }

    function toggleMilestoneList() {
        const body  = document.getElementById('rm-ms-list-body');
        const arrow = document.getElementById('rm-ms-list-arrow');
        if (!body) return;
        const isOpen = body.style.display !== 'none';
        body.style.display = isOpen ? 'none' : 'flex';
        if (arrow) arrow.textContent = isOpen ? '▶' : '▼';
    }

    function _renderMilestoneListPanel() {
        const countEl = document.getElementById('rm-ms-list-count');
        const bodyEl  = document.getElementById('rm-ms-list-body');
        if (!countEl || !bodyEl) return;

        const n = _milestones?.length ?? 0;
        countEl.textContent = `🏁 Milestones (${n})`;

        if (!n) {
            bodyEl.innerHTML = '<div class="rm-ms-list-empty">No milestones — click [+ Milestone] or click on the timeline</div>';
            return;
        }

        const projs = _activeProjections();

        bodyEl.innerHTML = (_milestones ?? []).map(ms => {
            const msDate  = new Date(ms.date);
            const dateStr = msDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            const linked  = ms.linked_epic_ids ?? [];

            let borderColor = RM.indigo;
            let statusIcon  = '';
            let epicLines   = '';

            if (linked.length) {
                let isCritical = false;
                let isAtRisk   = false;
                const epicHtmlParts = [];

                for (const epicId of linked) {
                    const ep = projs.find(p => p.epicId === epicId);
                    if (!ep) continue;
                    const worstDate  = ep.projection.worstCase.completionDate
                        ? new Date(ep.projection.worstCase.completionDate) : null;
                    const likelyDate = ep.projection.mostLikely.completionDate
                        ? new Date(ep.projection.mostLikely.completionDate) : null;
                    const conf       = ep.projection.mostLikely.confidence ?? 0;

                    if (worstDate && worstDate > msDate) {
                        isCritical = true;
                        epicHtmlParts.push(
                            `<div class="rm-ms-list-epic">🚨 ${Auth.esc(ep.epicName)} · Confidence ${conf}%</div>`
                        );
                    } else if (likelyDate && likelyDate > msDate) {
                        isAtRisk = true;
                        epicHtmlParts.push(
                            `<div class="rm-ms-list-epic">⚠️ ${Auth.esc(ep.epicName)} · Confidence ${conf}%</div>`
                        );
                    } else {
                        epicHtmlParts.push(
                            `<div class="rm-ms-list-epic">✅ ${Auth.esc(ep.epicName)} · Confidence ${conf}%</div>`
                        );
                    }
                }

                if (isCritical) { borderColor = RM.red; statusIcon = '🚨'; }
                else if (isAtRisk) { borderColor = RM.amber; statusIcon = '⚠️'; }
                else { borderColor = RM.emerald; statusIcon = '✅'; }

                epicLines = `<div class="rm-ms-list-epics">${epicHtmlParts.join('')}</div>`;
            }

            const safeId = Auth.esc(ms.id);
            return `
                <div class="rm-ms-list-item" style="border-left-color:${borderColor};">
                    <div class="rm-ms-list-item-header">
                        <span class="rm-ms-list-item-name">🏁 ${dateStr} · ${Auth.esc(ms.name)}</span>
                        <span class="rm-ms-list-item-badge">${ms.type === 'external' ? 'Ext' : 'Int'}</span>
                        ${statusIcon ? `<span>${statusIcon}</span>` : ''}
                        <button class="rm-ms-list-edit"   onclick="Roadmap.editMilestone('${safeId}')">Edit</button>
                        <button class="rm-ms-list-delete" onclick="Roadmap.deleteMilestone('${safeId}')">Delete</button>
                    </div>
                    ${epicLines}
                </div>`;
        }).join('');
    }

    // ── Main render ───────────────────────────────────────────────────────────

    function _render() {
        const projs = _engineToProjections();
        if (!projs.length) {
            _showError('No epics found. Make sure your backlog stories have Jira epic links, then run the epic backfill.');
            return;
        }

        _buildTimeline(_applyTshirtOverrides(projs));
        _renderHeader();
        _renderTop(_cursorDate);
        _renderGanttHeader();
        _renderGanttRows();
        _renderMilestoneListPanel();
        _initCursor();
        _initDragDrop();
        _initGanttBodyHover();
        _initTimelineClick();
    }

    // ── Header ────────────────────────────────────────────────────────────────

    function _renderHeader() {
        const sprint = _projection?.activeSprint ?? '';
        const el = document.getElementById('rm-sprint-label');
        if (sprint) el.textContent = `Active: ${sprint}`;

        const badge = document.getElementById('rm-conf-badge');
        if (_projection?.lowConfidence) {
            badge.innerHTML = `<span class="low-conf-badge">⚠ Low confidence — add more sprint history</span>`;
        }
    }

    // ── TOP section — epic state cards ────────────────────────────────────────

    function _renderTop(cursorDate) {
        const projs   = _activeProjections();
        const epicMap = new Map((_epics ?? []).map(e => [e.id, e]));
        const dateLabel = cursorDate.toLocaleDateString('en-US', {
            month: 'short', day: 'numeric', year: 'numeric',
        });

        document.getElementById('rm-cursor-date').textContent = dateLabel;

        // Find active milestone — cursor within 2 days (milestone snap lands close)
        const TWO_DAYS = 2 * 24 * 60 * 60 * 1000;
        const activeMilestone = (_milestones ?? []).find(
            ms => Math.abs(cursorDate - new Date(ms.date)) <= TWO_DAYS
        ) ?? null;

        const html = projs.map((ep, idx) => {
            const color    = EPIC_COLORS[idx % EPIC_COLORS.length];
            const epicData = epicMap.get(ep.epicId);
            const total    = epicData?.stories?.total ?? 0;
            const done     = epicData?.stories?.completed ?? 0;
            const pct      = total > 0 ? Math.round(done / total * 100) : 0;

            // If cursor is past worst case → complete
            const worstDate = ep.projection.worstCase.completionDate
                ? new Date(ep.projection.worstCase.completionDate) : null;
            const dispPct = (worstDate && cursorDate >= worstDate) ? 100 : pct;

            let statusLabel, statusColor;
            const isLinkedToMilestone = activeMilestone &&
                (activeMilestone.linked_epic_ids ?? []).includes(ep.epicId);

            if (isLinkedToMilestone) {
                const msDate     = new Date(activeMilestone.date);
                const likelyDate = ep.projection.mostLikely.completionDate
                    ? new Date(ep.projection.mostLikely.completionDate) : null;
                if (dispPct >= 100 || (worstDate && worstDate <= msDate)) {
                    statusLabel = `✅ Complete before ${activeMilestone.name}`;
                    statusColor = RM.greenLight;
                } else if (likelyDate && likelyDate > msDate) {
                    statusLabel = `⚠️ Will miss ${activeMilestone.name}`;
                    statusColor = RM.yellow;
                } else {
                    statusLabel = `✅ On track for ${activeMilestone.name}`;
                    statusColor = RM.greenLight;
                }
            } else {
                ({ label: statusLabel, color: statusColor } = _epicStatus(dispPct, ep, cursorDate));
            }

            // AI prediction badge + scope stats
            const pred          = _predictions?.get(ep.epicId);
            const effTshirt     = pred?.tshirtSize ?? null;
            const effType       = pred?.epicType   ?? null;
            const confLevel     = pred?.confidenceLevel ?? null;
            const isOverride    = pred?.hasOverride ?? false;
            const confDotClass  = confLevel ? `conf-${confLevel}` : '';

            const predHtml = effTshirt ? `
                <div class="epic-card-pred">
                    <span class="pred-badge${isOverride ? ' pred-override' : ''}"
                          onclick="event.stopPropagation();Roadmap.openOverridePanel('${Auth.esc(ep.epicId)}')"
                          title="${isOverride ? 'PM override' : 'AI estimate'} — click to change">${Auth.esc(effTshirt)}</span>
                    ${effType ? `<span class="pred-type-tag">${Auth.esc(effType)}</span>` : ''}
                    ${confDotClass ? `<span class="pred-conf-dot ${confDotClass}" title="${Auth.esc((confLevel ?? '').replace(/_/g,' '))}"></span>` : ''}
                </div>` : '';

            // Scope stats row — T-shirt adjusted (pred) takes priority, engine as fallback
            const engineEp      = _engineData?.projections?.find(e => e.epicKey === ep.epicId);
            const currentStories = engineEp?.totalStories ?? total;
            const predAddl       = pred?.scopeProjection?.additionalStories;
            const engineAddl     = engineEp != null ? (engineEp.estimatedStories - engineEp.totalStories) : null;
            const additionalStories = predAddl ?? engineAddl;
            const expectedStories   = additionalStories != null ? currentStories + additionalStories : null;

            const currentPts     = engineEp?.currentStoryPoints ?? (epicData?.importedEffort?.total ?? 0);
            const avgPtsPerStory = currentStories > 0 ? currentPts / currentStories : 0;
            const expectedPts    = additionalStories != null && currentPts > 0
                ? Math.round(currentPts + additionalStories * avgPtsPerStory)
                : (engineEp?.estimatedStoryPoints ?? null);

            const statsHtml = `
                <div class="epic-card-stats">
                    <div class="epic-card-stat">
                        <div class="stat-val">${currentStories}</div>
                        <div class="stat-unit">Current stories</div>
                    </div>
                    <div class="epic-card-stat estimated">
                        <div class="stat-val accent">${expectedStories !== null ? '~' + expectedStories : '–'}</div>
                        <div class="stat-unit">Est. stories</div>
                    </div>
                    <div class="epic-card-stat">
                        <div class="stat-val">${currentPts > 0 ? currentPts : '–'}</div>
                        <div class="stat-unit">Current pts</div>
                    </div>
                    <div class="epic-card-stat estimated">
                        <div class="stat-val accent">${currentPts > 0 && expectedPts !== null ? '~' + expectedPts : '–'}</div>
                        <div class="stat-unit">Est. pts</div>
                    </div>
                </div>`;

            return `
                <div class="epic-card" data-epic-id="${Auth.esc(ep.epicId)}"
                     style="border-top-color:${color};"
                     onmouseenter="Roadmap._epicHover(event,'${Auth.esc(ep.epicId)}')"
                     onmouseleave="Roadmap._epicUnhover()">
                    <div class="epic-card-name" style="color:${color};">${Auth.esc(ep.epicName)}</div>
                    <div class="epic-card-pct">${dispPct}%</div>
                    <div class="epic-card-bar-track">
                        <div class="epic-card-bar-fill"
                             style="width:${dispPct}%;background:${color};"></div>
                    </div>
                    <div class="epic-card-status" style="color:${statusColor};">${statusLabel}</div>
                    ${statsHtml}
                    ${predHtml}
                </div>`;
        }).join('');

        document.getElementById('rm-cards').innerHTML = html;

        // Re-apply highlight if an epic was active before the re-render
        if (_activeEpicId) _applyHighlightStyles(_activeEpicId);
    }

    // ── BOTTOM — Gantt header (sprint ticks) ──────────────────────────────────

    function _renderGanttHeader() {
        const trackEl = document.getElementById('gantt-header-track');
        const tl      = _timeline;
        if (!tl || !trackEl) return;

        const ticks = _buildSprintTicks();

        // Today marker label in header
        const todayPct = _dateToPercent(new Date());
        const todayEl  = todayPct >= 0 && todayPct <= 100
            ? `<div class="sprint-tick" style="left:${todayPct}%;">
                   <div class="sprint-tick-label" style="color:#6366f1;">today</div>
               </div>`
            : '';

        const ticksHtml = ticks
            .filter(t => {
                const p = _dateToPercent(t.date);
                return p >= 0 && p <= 100;
            })
            .map(t => {
                const p = _dateToPercent(t.date);
                return `<div class="sprint-tick" style="left:${p.toFixed(2)}%;">
                            <div class="sprint-tick-label">${Auth.esc(t.label)}</div>
                        </div>`;
            }).join('');

        trackEl.innerHTML = ticksHtml + todayEl;
    }

    // ── BOTTOM — Gantt epic rows ───────────────────────────────────────────────

    function _renderGanttRows() {
        const el   = document.getElementById('gantt-rows');
        const projs = _activeProjections(); // ordered + recalculated if scenario

        const isScenario = _activeTab === 'scenario';

        const rows = projs.map((ep, idx) => {
            const color    = EPIC_COLORS[idx % EPIC_COLORS.length];
            const phaseCls = `phase-${ep.phase}`;
            const barHtml  = _buildEpicBar(ep, color);
            const draggable = isScenario ? 'draggable="true" class="gantt-row draggable"'
                                         : 'class="gantt-row"';

            return `
                <div ${draggable} data-epic-id="${Auth.esc(ep.epicId)}">
                    <div class="gantt-row-label">
                        <div class="drag-handle" title="Drag to reorder"></div>
                        <div class="gantt-epic-dot" style="background:${color};"></div>
                        <div style="overflow:hidden;">
                            <div class="gantt-epic-name">${Auth.esc(ep.epicName)}</div>
                            <span class="phase-badge ${phaseCls}">${ep.phase}</span>
                        </div>
                    </div>
                    <div class="gantt-row-track" data-epic-id="${Auth.esc(ep.epicId)}">
                        ${barHtml}
                    </div>
                    ${_buildImpactCol(ep)}
                </div>`;
        }).join('');

        el.innerHTML = rows;
        _renderTodayLine();
        _renderMilestoneLines();
    }

    // ── Milestone lines on Gantt ───────────────────────────────────────────────

    function _milestoneColor(ms) {
        if (!ms.linked_epic_ids?.length) return RM.indigo; // no linked epics → indigo
        const msDate = new Date(ms.date);
        const projs  = _activeProjections();
        let isCritical = false;
        let isAtRisk   = false;
        for (const epicId of ms.linked_epic_ids) {
            const ep = projs.find(p => p.epicId === epicId);
            if (!ep) continue;
            const worstDate  = ep.projection.worstCase.completionDate
                ? new Date(ep.projection.worstCase.completionDate) : null;
            const likelyDate = ep.projection.mostLikely.completionDate
                ? new Date(ep.projection.mostLikely.completionDate) : null;
            if (worstDate  && worstDate  > msDate) { isCritical = true; break; }
            if (likelyDate && likelyDate > msDate)   isAtRisk   = true;
        }
        if (isCritical) return RM.red; // red
        if (isAtRisk)   return RM.amber; // orange
        return RM.emerald;                 // green
    }

    function _renderMilestoneLines() {
        document.querySelectorAll('.gantt-milestone-line').forEach(el => el.remove());
        if (!_milestones?.length || !_timeline) return;

        const bottomEl = document.getElementById('rm-bottom');
        if (!bottomEl) return;

        const impactW = _activeTab === 'scenario' ? IMPACT_COL_W : 0;

        _milestones.forEach(ms => {
            const pct = _dateToPercent(new Date(ms.date));
            if (pct < 0 || pct > 100) return;

            const color = _milestoneColor(ms);
            const line  = document.createElement('div');
            line.className = 'gantt-milestone-line';
            line.dataset.milestoneId = ms.id;
            line.style.cssText =
                `left:calc(${LABEL_W}px + ${(pct / 100).toFixed(5)} * (100% - ${LABEL_W}px - ${impactW}px));` +
                `--ms-color:${color};`;

            const dateStr = new Date(ms.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            const label   = document.createElement('div');
            label.className = 'gantt-ms-label';
            label.textContent = `🏁 ${dateStr} · ${ms.name}`;
            line.appendChild(label);
            bottomEl.appendChild(line);
        });
    }

    function _renderTodayLine() {
        const old = document.getElementById('gantt-today-line');
        if (old) old.remove();

        const todayPct = _dateToPercent(new Date());
        if (todayPct < 0 || todayPct > 100) return;

        const bottomEl = document.getElementById('rm-bottom');
        if (!bottomEl) return;

        const line = document.createElement('div');
        line.id = 'gantt-today-line';
        line.className = 'gantt-today-line';
        // Position in the track area: label col + todayPct% of track width
        const impactW = _activeTab === 'scenario' ? IMPACT_COL_W : 0;
        line.style.left = `calc(${LABEL_W}px + ${(todayPct / 100).toFixed(5)} * (100% - ${LABEL_W}px - ${impactW}px))`;
        bottomEl.appendChild(line);
    }

    // ── Gradient confidence bar ────────────────────────────────────────────────

    function _buildEpicBar(ep, color) {
        const bestDate   = ep.projection.bestCase.completionDate;
        const likelyDate = ep.projection.mostLikely.completionDate;
        const worstDate  = ep.projection.worstCase.completionDate;

        if (!worstDate) return '';

        // Map dates to % positions on timeline
        const bestPct   = bestDate   ? _dateToPercent(new Date(bestDate))   : _dateToPercent(new Date());
        const likelyPct = likelyDate ? _dateToPercent(new Date(likelyDate)) : null;
        const worstPct  = _dateToPercent(new Date(worstDate));

        // Clamp bar to visible range
        const left  = Math.max(0, Math.min(100, bestPct));
        const right = Math.max(0, Math.min(100, worstPct));
        if (right < 0 || left > 100) return '';

        // Enforce minimum 20px pill so short epics are always visible.
        // Use a CSS min() trick: width is max(widthPct%, 20px).
        const widthPct = Math.max(0, right - left);
        const widthStyle = widthPct < 0.01
            ? '20px'
            : `max(${widthPct.toFixed(2)}%, 20px)`;

        // Gradient midpoint (most likely position relative to bar, clamped 20–80%)
        let mid = 60;
        if (likelyPct !== null && worstPct > bestPct) {
            mid = Math.round((likelyPct - bestPct) / (worstPct - bestPct) * 100);
            mid = Math.max(20, Math.min(80, mid));
        }

        // Opacity: fully transparent → 55% mid → 100% certain (strong visual contrast)
        const gradient = `linear-gradient(to right, transparent 0%, ${color}55 ${Math.round(mid * 0.6)}%, ${color}BB ${mid}%, ${color} 100%)`;

        return `<div class="epic-bar" style="left:${left.toFixed(2)}%;width:${widthStyle};background:${gradient};"></div>`;
    }

    // ── Inline impact column (per Gantt row) ──────────────────────────────────

    function _buildImpactCol(ep) {
        if (_activeTab !== 'scenario') {
            return '<div class="gantt-impact-col"></div>';
        }

        const base    = _applyTshirtOverrides(_engineToProjections());
        const origIdx = base.findIndex(e => e.epicId === ep.epicId);
        const newIdx  = _scenarioOrder.indexOf(ep.epicId);
        const origEp  = base[origIdx];

        if (!origEp || origIdx === newIdx) {
            return `<div class="gantt-impact-col">
                        <div class="gantt-impact-inner" style="color:#2d3748;font-size:0.65rem;font-weight:600;">—</div>
                    </div>`;
        }

        const origDate  = origEp.projection.mostLikely.completionDate;
        const newDate   = ep.projection.mostLikely.completionDate;
        const deltaDays = (origDate && newDate)
            ? Math.round((new Date(origDate) - new Date(newDate)) / 86400000)
            : 0;

        const earlier  = deltaDays > 0;
        const color    = earlier ? RM.greenLight : RM.yellow;
        const arrow    = newIdx < origIdx ? '↑' : '↓';
        const line1    = arrow + ' ' + (deltaDays === 0 ? 'Reordered'
            : earlier ? `${deltaDays}d earlier`
            : `${Math.abs(deltaDays)}d later`);

        const fmt = d => d
            ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
            : '—';
        const line2 = `${fmt(origDate)} → ${fmt(newDate)}`;

        return `<div class="gantt-impact-col">
                    <div class="gantt-impact-inner">
                        <div style="font-size:0.68rem;font-weight:900;color:${color};line-height:1.3;">${Auth.esc(line1)}</div>
                        <div style="font-size:0.57rem;color:#475569;margin-top:2px;">${Auth.esc(line2)}</div>
                    </div>
                </div>`;
    }

    // ── Engine projection helpers ─────────────────────────────────────────────

    /** Convert N sprints remaining → calendar end date using the known sprint schedule. */
    function _sprintsToDate(n) {
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const future = (_sprints ?? [])
            .filter(s => s.end_date && new Date(s.end_date) > today)
            .sort((a, b) => new Date(a.end_date) - new Date(b.end_date));
        const idx = Math.max(0, Math.ceil(n) - 1);
        if (idx < future.length) return future[idx].end_date;
        // Extrapolate beyond known sprints
        const sprintDays = _sprintDuration();
        const base = future.length > 0
            ? new Date(future[future.length - 1].end_date)
            : today;
        const extra = idx - future.length + 1;
        return new Date(base.getTime() + extra * sprintDays * 86400000).toISOString().slice(0, 10);
    }

    /**
     * Build projection array from engine data (same shape as roadmap projection rows).
     * Falls back to _projection.projections if engine data is unavailable.
     */
    function _engineToProjections() {
        const engProjs = _engineData?.projections;
        if (!engProjs?.length) return _projection?.projections ?? [];
        const roadmapProjs = _projection?.projections ?? [];
        return engProjs.map(ep => {
            const roadmapEp = roadmapProjs.find(r => r.epicId === ep.epicKey);
            return {
                epicId:   ep.epicKey,
                epicName: ep.epicName ?? roadmapEp?.epicName ?? ep.epicKey,
                phase:    roadmapEp?.phase ?? '',
                priority: roadmapEp?.priority ?? 0,
                projection: {
                    bestCase:   {
                        sprintsNeeded:  ep.optimistic.sprintsRemaining,
                        completionDate: _sprintsToDate(ep.optimistic.sprintsRemaining),
                        confidence:     Math.round(ep.confidence * 100),
                    },
                    mostLikely: {
                        sprintsNeeded:  ep.realistic.sprintsRemaining,
                        completionDate: _sprintsToDate(ep.realistic.sprintsRemaining),
                        confidence:     Math.round(ep.confidence * 100),
                    },
                    worstCase:  {
                        sprintsNeeded:  ep.pessimistic.sprintsRemaining,
                        completionDate: _sprintsToDate(ep.pessimistic.sprintsRemaining),
                        confidence:     90,
                    },
                },
            };
        });
    }

    // ── T-shirt size overrides (cross-page sync with Epic Lifecycle) ────────────

    // Sprint midpoints per size — midpoint of each range in utils/story-constants.js TSHIRT_RANGES.
    // If size ranges change server-side, update this object and TSHIRT_SPRINT_RANGES in epic-lifecycle.html.
    const TSHIRT_MIDPOINTS = { XS: 1, S: 3, M: 6, L: 11.5, XL: 20, XXL: 37.5 };

    // Apply Epic Lifecycle T-shirt overrides to a projection array.
    // Scales remaining time by ratio of (size midpoint) / (current projected sprints).
    function _applyTshirtOverrides(projs) {
        const today   = new Date(); today.setHours(0, 0, 0, 0);
        const todayMs = today.getTime();

        return projs.map(ep => {
            const size = _predictions?.get(ep.epicId)?.tshirtSize ?? null;
            if (!size || !(size in TSHIRT_MIDPOINTS)) return ep;

            const targetSprints  = TSHIRT_MIDPOINTS[size];
            const currentSprints = ep.projection.mostLikely.sprintsNeeded;
            if (!currentSprints || currentSprints <= 0) return ep;

            const ratio = targetSprints / currentSprints;
            if (Math.abs(ratio - 1) < 0.02) return ep; // <2% change — skip

            const scaleDate = d => {
                if (!d) return null;
                const rem = new Date(d).getTime() - todayMs;
                if (rem <= 0) return d;
                return new Date(todayMs + Math.round(rem * ratio)).toISOString().slice(0, 10);
            };

            return {
                ...ep,
                projection: {
                    bestCase:   { ...ep.projection.bestCase,   completionDate: scaleDate(ep.projection.bestCase.completionDate)   },
                    mostLikely: { ...ep.projection.mostLikely, completionDate: scaleDate(ep.projection.mostLikely.completionDate) },
                    worstCase:  { ...ep.projection.worstCase,  completionDate: scaleDate(ep.projection.worstCase.completionDate)  },
                },
            };
        });
    }

    // ── Scenario projections ──────────────────────────────────────────────────

    // Returns projections in the right order + with recalculated dates for scenario mode
    function _activeProjections() {
        if (_activeTab === 'scenario' && _scenarioProjections.length) {
            return _scenarioOrder
                .map(id => _scenarioProjections.find(ep => ep.epicId === id))
                .filter(Boolean);
        }
        return _applyTshirtOverrides(_engineToProjections());
    }

    function _priorityShare(idx) {
        return PRIORITY_SHARES[Math.min(idx, PRIORITY_SHARES.length - 1)];
    }

    // Recalculate completion dates based on new epic priority order.
    // Logic: if an epic moves from priority 1 (48% velocity) to priority 3 (16% velocity),
    // its remaining time scales by 48/16 = 3×. Faster if it moves up, slower if it moves down.
    function _recalculateScenario() {
        const base = _applyTshirtOverrides(_engineToProjections());
        if (!base.length) { _scenarioProjections = []; return; }

        const today   = new Date(); today.setHours(0, 0, 0, 0);
        const todayMs = today.getTime();

        // Share each epic had in the original order
        const origShare = new Map(base.map((ep, i) => [ep.epicId, _priorityShare(i)]));

        // Share each epic gets in the scenario order
        const order = _scenarioOrder.length ? _scenarioOrder : base.map(ep => ep.epicId);
        const newShare = new Map(order.map((id, i) => [id, _priorityShare(i)]));

        _scenarioProjections = base.map(ep => {
            const from = origShare.get(ep.epicId) ?? 0.07;
            const to   = newShare.get(ep.epicId)  ?? 0.07;
            const ratio = from / to; // >1 slower (lower priority), <1 faster (higher priority)

            const scaleDate = d => {
                if (!d) return null;
                const rem = new Date(d).getTime() - todayMs;
                if (rem <= 0) return d;
                return new Date(todayMs + Math.round(rem * ratio)).toISOString().slice(0, 10);
            };

            return {
                ...ep,
                projection: {
                    bestCase:   { completionDate: scaleDate(ep.projection.bestCase.completionDate)   },
                    mostLikely: { completionDate: scaleDate(ep.projection.mostLikely.completionDate) },
                    worstCase:  { completionDate: scaleDate(ep.projection.worstCase.completionDate)  },
                },
            };
        });
    }

    // ── Drag & drop (scenario mode only) ──────────────────────────────────────

    function _initDragDrop() {
        const container = document.getElementById('gantt-rows');
        if (!container || _activeTab !== 'scenario') return;
        container.addEventListener('dragstart', _onDragStart);
        container.addEventListener('dragover',  _onDragOver);
        container.addEventListener('dragleave', _onDragLeave);
        container.addEventListener('drop',      _onDrop);
        container.addEventListener('dragend',   _onDragEnd);
    }

    function _onDragStart(e) {
        const row = e.target.closest('.gantt-row');
        if (!row) return;
        _dragEpicId = row.dataset.epicId;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', _dragEpicId);
        requestAnimationFrame(() => row.classList.add('dragging'));
    }

    function _onDragOver(e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const row = e.target.closest('.gantt-row');
        if (!row || row.dataset.epicId === _dragEpicId) return;
        document.querySelectorAll('.drag-over').forEach(r => r.classList.remove('drag-over'));
        row.classList.add('drag-over');
    }

    function _onDragLeave(e) {
        const row = e.target.closest('.gantt-row');
        if (row && !row.contains(e.relatedTarget)) row.classList.remove('drag-over');
    }

    function _onDrop(e) {
        e.preventDefault();
        const targetRow = e.target.closest('.gantt-row');
        if (!targetRow || !_dragEpicId) return;

        const targetId = targetRow.dataset.epicId;
        if (targetId === _dragEpicId) return;

        const fromIdx = _scenarioOrder.indexOf(_dragEpicId);
        const toIdx   = _scenarioOrder.indexOf(targetId);
        if (fromIdx < 0 || toIdx < 0) return;

        _scenarioOrder.splice(fromIdx, 1);
        _scenarioOrder.splice(toIdx, 0, _dragEpicId);

        _recalculateScenario();
        _buildTimeline(_activeProjections());
        _renderGanttHeader();
        _renderGanttRows();
        _renderTop(_cursorDate);
        _initDragDrop();
        _initGanttBodyHover();
    }

    function _onDragEnd() {
        _dragEpicId = null;
        document.querySelectorAll('.gantt-row').forEach(r =>
            r.classList.remove('dragging', 'drag-over')
        );
    }

    // ── Timeline helpers ──────────────────────────────────────────────────────

    function _buildTimeline(projs) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const durationDays = _sprintDuration();

        // Start with the latest worst-case + 3-sprint buffer across all epics
        let dataEnd = null;
        for (const ep of projs) {
            const d = ep.projection.worstCase.completionDate;
            if (d) {
                const worstEnd = new Date(new Date(d).getTime() + durationDays * 3 * 86400000);
                if (!dataEnd || worstEnd > dataEnd) dataEnd = worstEnd;
            }
        }

        // Use data-driven end if available; fall back to 90-day minimum
        const minEnd = new Date(today.getTime() + 90 * 86400000);
        const end = dataEnd && dataEnd > minEnd ? dataEnd : minEnd;

        _timeline = { start: today, end, totalMs: end.getTime() - today.getTime() };
    }

    function _dateToPercent(date) {
        if (!date || !_timeline) return -1;
        const d  = typeof date === 'string' ? new Date(date) : date;
        const ms = d.getTime() - _timeline.start.getTime();
        return ms / _timeline.totalMs * 100;
    }

    function _sprintDuration() {
        if (_sprints.length >= 2 && _sprints[0].start_date && _sprints[1].start_date) {
            const a = new Date(_sprints[0].start_date);
            const b = new Date(_sprints[1].start_date);
            const diff = Math.round((b - a) / 86400000);
            if (diff > 0) return diff;
        }
        return 14;
    }

    function _buildSprintTicks() {
        if (!_timeline) return [];
        const tl           = _timeline;
        const durationDays = _sprintDuration();

        // Use Jira sprints if available, extend with calculated future ones
        const knownSprints = _sprints
            .filter(s => s.start_date)
            .map(s => ({ date: new Date(s.start_date), label: _sprintDateLabel(s.start_date) }));

        // Find the latest known sprint start to project from
        const lastKnown = knownSprints.length
            ? knownSprints[knownSprints.length - 1].date
            : new Date();

        // Calculate future ticks from lastKnown forward
        const futureTicks = [];
        let cursor = new Date(lastKnown.getTime() + durationDays * 86400000);
        while (cursor <= tl.end) {
            futureTicks.push({ date: new Date(cursor), label: _sprintDateLabel(cursor) });
            cursor = new Date(cursor.getTime() + durationDays * 86400000);
        }

        // Deduplicate by date string, skip ticks too close together
        const all = [...knownSprints, ...futureTicks];
        const seen = new Set();
        return all.filter(t => {
            const key = t.date.toISOString().slice(0, 10);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    function _sprintDateLabel(date) {
        const d = typeof date === 'string' ? new Date(date) : date;
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }

    // ── Epic status ───────────────────────────────────────────────────────────

    function _epicStatus(pct, ep, cursorDate) {
        const likelyDate = ep.projection.mostLikely.completionDate
            ? new Date(ep.projection.mostLikely.completionDate) : null;

        if (pct >= 100) return { label: '✓ Complete',     color: RM.greenLight };
        if (likelyDate && cursorDate > likelyDate && pct < 80) {
            return              { label: '⚠ At risk',      color: RM.yellow };
        }
        if (pct >= 50)  return { label: '● In progress',  color: RM.indigoLight };
        if (pct > 0)    return { label: '● Started',       color: RM.slate };
        return                 { label: '○ Not started',   color: RM.slateDark };
    }

    // ── Cursor / scrubbing ────────────────────────────────────────────────────

    function _initCursor() {
        const bottomEl = document.getElementById('rm-bottom');
        if (!bottomEl) return;
        bottomEl.addEventListener('mousemove', _onGanttMouseMove);
        bottomEl.addEventListener('mouseleave', _onGanttMouseLeave);
    }

    function _onGanttMouseMove(e) {
        const bottomEl = document.getElementById('rm-bottom');
        if (!bottomEl || !_timeline) return;

        const rect    = bottomEl.getBoundingClientRect();
        const trackX  = e.clientX - rect.left - LABEL_W;
        const impactW = _activeTab === 'scenario' ? IMPACT_COL_W : 0;
        const trackW  = rect.width - LABEL_W - impactW;

        if (trackX < 0 || trackX > trackW) {
            _hideCursor();
            return;
        }

        // Raw percentage on timeline
        const rawPct = trackX / trackW * 100;

        // Snap to nearest sprint tick if within 10px
        const snappedPct = _snapToTick(rawPct, trackW);
        const date = _percentToDate(snappedPct);
        if (!date) return;

        // Move cursor line
        const cursorEl = document.getElementById('gantt-cursor');
        if (cursorEl) {
            cursorEl.style.display = 'block';
            cursorEl.style.left = (LABEL_W + snappedPct / 100 * trackW).toFixed(1) + 'px';
        }

        // Re-render TOP cards only when day changes
        if (date.toDateString() !== _cursorDate.toDateString()) {
            _cursorDate = date;
            _renderTop(_cursorDate);
        }
    }

    function _onGanttMouseLeave() {
        _hideCursor();
        _cursorDate = new Date();
        _renderTop(_cursorDate);
    }

    function _hideCursor() {
        const el = document.getElementById('gantt-cursor');
        if (el) el.style.display = 'none';
    }

    function _percentToDate(pct) {
        if (!_timeline) return null;
        return new Date(_timeline.start.getTime() + pct / 100 * _timeline.totalMs);
    }

    function _snapToTick(pct, trackW) {
        const SNAP_PX = 10;
        // Snap to sprint ticks
        for (const t of _buildSprintTicks()) {
            const tickPct = _dateToPercent(t.date);
            if (tickPct < 0 || tickPct > 100) continue;
            if (Math.abs((pct - tickPct) / 100 * trackW) <= SNAP_PX) return tickPct;
        }
        // Snap to milestone dates (within 20px)
        for (const ms of (_milestones ?? [])) {
            const msPct = _dateToPercent(new Date(ms.date));
            if (msPct < 0 || msPct > 100) continue;
            if (Math.abs((pct - msPct) / 100 * trackW) <= 20) return msPct;
        }
        return pct;
    }

    // ── Hover highlight + tooltip ──────────────────────────────────────────────

    let _ttMoveHandler  = null;
    let _unhoverTimer   = null;
    let _activeEpicId   = null;

    function _epicHover(e, epicId) {
        // Cancel any pending unhover so fast inter-element transitions don't flash
        if (_unhoverTimer) { clearTimeout(_unhoverTimer); _unhoverTimer = null; }

        // Already highlighting this epic — just reposition tooltip
        if (_activeEpicId === epicId) {
            _positionTooltip(document.getElementById('rm-tooltip'), e.clientX, e.clientY);
            return;
        }

        // Clear previous highlight without delay
        _clearHighlight();
        _activeEpicId = epicId;

        // Resolve epic data (use scenario projections when in scenario mode)
        const projs   = _activeProjections();
        const epicMap = new Map((_epics ?? []).map(ep => [ep.id, ep]));
        const ep      = projs.find(p => p.epicId === epicId);
        if (!ep) return;

        const idx      = projs.indexOf(ep);
        const color    = EPIC_COLORS[idx % EPIC_COLORS.length];
        const epicData = epicMap.get(epicId);
        const total    = epicData?.stories?.total ?? (ep.currentStories + (epicData?.stories?.completed ?? 0));
        const done     = epicData?.stories?.completed ?? 0;
        const pct      = total > 0 ? Math.round(done / total * 100) : 0;

        // Apply highlight + per-epic color glow to all matching elements
        _applyHighlightStyles(epicId);

        // Build tooltip
        const fmt = d => d
            ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
            : '—';

        const ttEl = document.getElementById('rm-tooltip');
        if (!ttEl) return;

        const predSection = _buildPredTooltipSection(_predictions?.get(epicId));

        ttEl.innerHTML = `
            <div class="rm-tt-name" style="color:${color};">${Auth.esc(ep.epicName)}</div>
            <div class="rm-tt-progress">
                <span class="rm-tt-pct">${pct}%</span>
                <div class="rm-tt-bar-track">
                    <div class="rm-tt-bar-fill" style="width:${pct}%;background:${color};"></div>
                </div>
                <span class="rm-tt-stories">${done}/${total}</span>
            </div>
            <div class="rm-tt-divider"></div>
            <div class="rm-tt-row">
                <div class="rm-tt-dot" style="background:${color};opacity:0.35;"></div>
                <span class="rm-tt-label">Best case</span>
                <span class="rm-tt-date">${fmt(ep.projection.bestCase.completionDate)}</span>
            </div>
            <div class="rm-tt-row">
                <div class="rm-tt-dot" style="background:${color};opacity:0.65;"></div>
                <span class="rm-tt-label">Most likely</span>
                <span class="rm-tt-date">${fmt(ep.projection.mostLikely.completionDate)}</span>
            </div>
            <div class="rm-tt-row">
                <div class="rm-tt-dot" style="background:${color};"></div>
                <span class="rm-tt-label">Worst case</span>
                <span class="rm-tt-date">${fmt(ep.projection.worstCase.completionDate)}</span>
            </div>
            ${predSection}`;

        _positionTooltip(ttEl, e.clientX, e.clientY);
        ttEl.style.display = 'block';

        _ttMoveHandler = ev => _positionTooltip(ttEl, ev.clientX, ev.clientY);
        document.addEventListener('mousemove', _ttMoveHandler);
    }

    function _epicUnhover() {
        // 80 ms grace window: if another element fires _epicHover first, cancel this
        _unhoverTimer = setTimeout(() => {
            _unhoverTimer = null;
            _clearHighlight();
            const ttEl = document.getElementById('rm-tooltip');
            if (ttEl) ttEl.style.display = 'none';
            if (_ttMoveHandler) {
                document.removeEventListener('mousemove', _ttMoveHandler);
                _ttMoveHandler = null;
            }
        }, 80);
    }

    function _initGanttBodyHover() {
        // Re-attach cleanly on each render (refresh replaces DOM)
        const bodyEl = document.querySelector('.gantt-body');
        if (!bodyEl) return;
        // Clone to drop previous listeners before re-attaching
        const fresh = bodyEl.cloneNode(false);
        while (bodyEl.firstChild) fresh.appendChild(bodyEl.firstChild);
        bodyEl.parentNode.replaceChild(fresh, bodyEl);

        fresh.addEventListener('mousemove', _onGanttBodyMove);
        fresh.addEventListener('mouseleave', _epicUnhover);
    }

    // ── Timeline click → open milestone panel ─────────────────────────────────

    function _initTimelineClick() {
        const bottomEl = document.getElementById('rm-bottom');
        if (!bottomEl) return;
        if (_timelineClickHandler) bottomEl.removeEventListener('click', _timelineClickHandler);
        _timelineClickHandler = _onGanttClick;
        bottomEl.addEventListener('click', _timelineClickHandler);
    }

    function _onGanttClick(e) {
        if (!e.target.closest('.gantt-row-track')) return;
        if (!_timeline) return;
        const bottomEl = document.getElementById('rm-bottom');
        if (!bottomEl) return;
        const rect    = bottomEl.getBoundingClientRect();
        const trackX  = e.clientX - rect.left - LABEL_W;
        const impactW = _activeTab === 'scenario' ? IMPACT_COL_W : 0;
        const trackW  = rect.width - LABEL_W - impactW;
        if (trackX < 0 || trackX > trackW) return;
        const date = _percentToDate(trackX / trackW * 100);
        if (!date) return;
        openMilestonePanel(date.toISOString().slice(0, 10));
    }

    function _onGanttBodyMove(e) {
        // 1. Exact element under cursor
        let row = document.elementFromPoint(e.clientX, e.clientY)?.closest('.gantt-row');

        // 2. Fallback: nearest row by vertical midpoint (fills the gaps between rows)
        if (!row) {
            let best = null, bestDist = Infinity;
            document.querySelectorAll('.gantt-row').forEach(r => {
                const rect = r.getBoundingClientRect();
                const d    = Math.abs(e.clientY - (rect.top + rect.height / 2));
                if (d < bestDist) { bestDist = d; best = r; }
            });
            row = best;
        }

        if (!row) return;
        const epicId = row.dataset.epicId;
        if (!epicId) return;

        if (epicId === _activeEpicId) {
            // Same epic — only update tooltip position
            const ttEl = document.getElementById('rm-tooltip');
            if (ttEl && ttEl.style.display !== 'none') _positionTooltip(ttEl, e.clientX, e.clientY);
        } else {
            _epicHover(e, epicId);
        }
    }

    function _applyHighlightStyles(epicId) {
        const projs = _activeProjections();
        const ep    = projs.find(p => p.epicId === epicId);
        if (!ep) return;
        const color = EPIC_COLORS[projs.indexOf(ep) % EPIC_COLORS.length];

        document.querySelectorAll(`[data-epic-id="${epicId}"]`).forEach(el => {
            el.classList.add('highlighted');
            if (el.classList.contains('epic-card')) {
                el.style.borderColor = color;
                el.style.background  = `${color}18`;
                el.style.boxShadow   = `0 0 0 1px ${color}66, 0 8px 24px ${color}33`;
            }
            if (el.classList.contains('gantt-row')) {
                el.style.background = `${color}12`;
                // Highlight impact col inner text within this row
                el.querySelectorAll('.gantt-impact-inner div').forEach(d => {
                    d.style.filter = 'brightness(1.3)';
                });
            }
        });
    }

    function _clearHighlight() {
        _activeEpicId = null;
        document.querySelectorAll('.highlighted').forEach(el => {
            el.classList.remove('highlighted');
            el.style.borderColor = '';
            el.style.background  = '';
            el.style.boxShadow   = '';
            el.querySelectorAll?.('.gantt-impact-inner div').forEach(d => {
                d.style.filter = '';
            });
        });
    }

    function _buildPredTooltipSection(pred) {
        if (!pred) return '';
        const tshirt = pred.tshirtSize;
        const type   = pred.epicType;
        const conf   = pred.confidenceLevel;
        const rat    = pred.rationale;
        if (!tshirt && !conf) return '';

        const confColors = {
            precise_match: RM.emerald, type_expanded: RM.cyan,
            size_only: RM.amber, insufficient: RM.gray,
        };
        const matched = (pred.matchedEpicKeys ?? []).slice(0, 3);

        return `
            <div class="rm-tt-divider"></div>
            <div class="rm-tt-pred-row">
                ${tshirt ? `<span class="rm-tt-tshirt">${Auth.esc(tshirt)}</span>` : ''}
                ${type   ? `<span class="rm-tt-type">${Auth.esc(type)}</span>` : ''}
                ${conf   ? `<span class="rm-tt-conf" style="color:${confColors[conf] ?? RM.grayFaint};">● ${Auth.esc(conf.replace(/_/g, ' '))}</span>` : ''}
            </div>
            ${rat     ? `<div class="rm-tt-rationale">${Auth.esc(rat)}</div>` : ''}
            ${matched.length ? `<div class="rm-tt-matched">Based on: ${matched.map(Auth.esc).join(', ')}</div>` : ''}`;
    }

    // ── Override panel ─────────────────────────────────────────────────────────

    function openOverridePanel(epicKey) {
        const pred     = _predictions?.get(epicKey);
        const epicData = (_epics ?? []).find(e => e.id === epicKey);
        const panelEl  = document.getElementById('rm-override-panel');
        const backdropEl = document.getElementById('rm-override-backdrop');
        if (!panelEl) return;

        // Populate
        document.getElementById('rm-ov-epic-key').value = epicKey;
        document.getElementById('rm-ov-epic-name').textContent = epicData?.name ?? pred?.epicName ?? epicKey;

        const aiHint = document.getElementById('rm-ov-ai-hint');
        if (aiHint) {
            if (!pred?.tshirtSize) {
                aiHint.textContent = 'No AI estimate yet — run analysis in Settings';
            } else if (pred.hasOverride) {
                aiHint.textContent = 'PM override active';
            } else {
                aiHint.textContent = `AI estimate: ${pred.tshirtSize}${pred.epicType ? ' · ' + pred.epicType : ''}`;
            }
        }

        // T-shirt pills
        const effTshirt = pred?.tshirtSize ?? null;
        document.querySelectorAll('#rm-ov-tshirt-pills .rm-ov-pill').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.val === effTshirt);
            btn.onclick = () => {
                document.querySelectorAll('#rm-ov-tshirt-pills .rm-ov-pill').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            };
        });

        // Type pills
        const effType = pred?.epicType ?? null;
        document.querySelectorAll('#rm-ov-type-pills .rm-ov-pill').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.val === effType);
            btn.onclick = () => {
                document.querySelectorAll('#rm-ov-type-pills .rm-ov-pill').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            };
        });

        document.getElementById('rm-ov-note').value = pred?.overrideNote ?? '';

        // Open
        if (backdropEl) backdropEl.style.display = 'block';
        panelEl.classList.add('open');
    }

    function closeOverridePanel() {
        const panelEl    = document.getElementById('rm-override-panel');
        const backdropEl = document.getElementById('rm-override-backdrop');
        if (panelEl)    panelEl.classList.remove('open');
        if (backdropEl) backdropEl.style.display = 'none';
    }

    async function saveOverride() {
        const epicKey = document.getElementById('rm-ov-epic-key')?.value;
        if (!epicKey) return;

        const tshirt = document.querySelector('#rm-ov-tshirt-pills .rm-ov-pill.active')?.dataset.val ?? null;
        const type   = document.querySelector('#rm-ov-type-pills .rm-ov-pill.active')?.dataset.val ?? null;
        const note   = document.getElementById('rm-ov-note')?.value?.trim() ?? '';

        try {
            const res = await Auth.fetch(`/api/epic-prediction/override/${encodeURIComponent(epicKey)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tshirt_size: tshirt, epic_type: type, note }),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);

            // Update local predictions map immediately (keep camelCase to match GET response)
            if (_predictions) {
                const existing = _predictions.get(epicKey) ?? { epicKey };
                _predictions.set(epicKey, {
                    ...existing,
                    tshirtSize:  tshirt ?? existing.tshirtSize,
                    epicType:    type   ?? existing.epicType,
                    hasOverride: !!(tshirt || type),
                    overrideNote: note,
                });
            }

            // Broadcast for live cross-page update (DB is source of truth)
            _bc.postMessage({ source: 'roadmap', epicKey, tshirt });

            closeOverridePanel();
            _renderTop(_cursorDate);
            _showToast('Override saved', 'success');
        } catch (e) {
            _showToast('Failed to save override', 'error');
        }
    }

    function _positionTooltip(ttEl, x, y) {
        const PAD = 14;
        const tw  = ttEl.offsetWidth  || 220;
        const th  = ttEl.offsetHeight || 160;
        let left  = x + PAD;
        let top   = y + PAD;
        if (left + tw > window.innerWidth  - 8) left = x - tw - PAD;
        if (top  + th > window.innerHeight - 8) top  = y - th - PAD;
        ttEl.style.left = left + 'px';
        ttEl.style.top  = top  + 'px';
    }

    function _highlight(epicId)  { document.querySelectorAll(`[data-epic-id="${epicId}"]`).forEach(el => el.classList.add('highlighted')); }
    function _unhighlight()      { _clearHighlight(); }

    // ── UI helpers ────────────────────────────────────────────────────────────

    function _resetUI() {
        const cardsEl = document.getElementById('rm-cards');
        const rowsEl  = document.getElementById('gantt-rows');
        const hdrEl   = document.getElementById('gantt-header-track');
        if (cardsEl) cardsEl.innerHTML = '<div class="rm-loading"><div class="rm-spinner"></div></div>';
        if (rowsEl)  rowsEl.innerHTML  = '';
        if (hdrEl)   hdrEl.innerHTML   = '';
        const dateEl = document.getElementById('rm-cursor-date');
        if (dateEl) dateEl.textContent = '—';
    }

    function _showError(msg) {
        const el = document.getElementById('rm-cards');
        if (el) el.innerHTML = `
            <div class="rm-empty">
                <div style="font-size:1.8rem;opacity:0.25;">🗺️</div>
                <p style="max-width:280px;line-height:1.6;">${Auth.esc(msg)}</p>
                <a href="/Modules/Backlog/backlog-view.html">View Backlog →</a>
            </div>`;
        const rowsEl = document.getElementById('gantt-rows');
        if (rowsEl) rowsEl.innerHTML = '';
    }


    function _showToast(msg, type = 'success') {
        const el = document.getElementById('rm-toast');
        if (!el) return;
        if (_toastTimer) { clearTimeout(_toastTimer); _toastTimer = null; }
        el.textContent = msg;
        el.className   = type === 'error' ? 'error' : type === 'success' ? 'success' : '';
        el.classList.add('visible');
        _toastTimer = setTimeout(() => {
            el.classList.remove('visible');
            _toastTimer = null;
        }, 2500);
    }

    // Cross-page sync via BroadcastChannel (works same-tab + cross-tab)
    const _bc = new BroadcastChannel('el_tshirt_sync');
    _bc.onmessage = ({ data }) => {
        if (data.source === 'roadmap') return; // ignore our own messages
        // Update local predictions map (DB already updated by EL)
        if (data.epicKey && _predictions) {
            const existing = _predictions.get(data.epicKey) ?? { epicKey: data.epicKey };
            const updatedScopeProjection = data.additionalStories !== undefined
                ? { ...(existing.scopeProjection ?? {}), additionalStories: data.additionalStories }
                : existing.scopeProjection;
            _predictions.set(data.epicKey, {
                ...existing,
                tshirtSize:      data.tshirt ?? null,
                hasOverride:     !!data.tshirt,
                scopeProjection: updatedScopeProjection,
            });
        }
        if (!_projection) return;
        if (_activeTab === 'scenario') _recalculateScenario();
        _buildTimeline(_activeProjections());
        _renderGanttHeader();
        _renderGanttRows();
        _renderTop(_cursorDate);
    };

    return { load, refresh, comingSoon, switchTab, renameScenario, resetScenario,
             saveScenario, openScenarios, closeScenarios, loadScenario, deleteScenario,
             openMilestonePanel, closeMilestonePanel, saveMilestone, deleteMilestone, editMilestone, toggleMilestoneList,
             openOverridePanel, closeOverridePanel, saveOverride,
             _highlight, _unhighlight, _epicHover, _epicUnhover };
})();

window.addEventListener('DOMContentLoaded', () => Roadmap.load());

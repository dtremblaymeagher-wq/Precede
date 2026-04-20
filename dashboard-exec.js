// dashboard-exec.js
// Executive Dashboard — data fetching + widget rendering.
// All exec logic is isolated here (never imported by PM pages).
//
// Architecture note (V2 migration path):
//   All data comes from /api/exec/* routes which aggregate PM instances.
//   To support multi-account exec in V2, only the server routes need updating.

const ExecDashboard = (() => {

    // Stores latest API data for drill-down access
    let _data = { strategic: null, pulse: null, forward: null, currentSprint: null, synthesis: null };

    // ── Bootstrap ────────────────────────────────────────────────────────────

    async function init() {
        const ok = await Auth.requireAuth();
        if (!ok) return;

        _checkFreePreview();
        await _loadAll();
        // Synthesis is cached per sprint — fetch once on init, never on refresh
        await _loadSynthesis();
    }

    function _checkFreePreview() {
        const plan   = localStorage.getItem(window.PRECEDE?.PLAN_KEY || 'precede_plan') || 'free';
        const banner = document.getElementById('preview-banner');
        if (banner) banner.style.display = plan === 'team' ? 'none' : 'flex';
    }

    async function refresh() {
        // Reset data widgets only — W9 synthesis is NOT reset (cached per sprint)
        const resetMap = { 0: 80, '1a': 120, '1b': 120, 4: 100, 5: 160, 6: 120, 7: 120, 8: 140, 10: 100 };
        for (const [key, h] of Object.entries(resetMap)) {
            const body = document.getElementById(`w${key}-body`);
            if (body) body.innerHTML = `<div class="skeleton" style="height:${h}px;"></div>`;
        }
        await _loadAll();
    }

    async function _loadSynthesis() {
        try {
            const res = await Auth.fetch('/api/exec/synthesis');
            const synthesis = res.ok ? await res.json() : null;
            if (synthesis) { _data.synthesis = synthesis; _renderW9(synthesis); }
        } catch (e) {
            console.error('[exec] synthesis load error:', e);
        }
    }

    async function _loadAll() {
        try {
            // Fetch PM instance list first (for header)
            const pmRes       = await Auth.fetch('/api/exec/instances');
            const pmInstances = pmRes.ok ? await pmRes.json() : [];
            _renderHeader(pmInstances);

            // Fetch data widgets in parallel (synthesis handled separately)
            const [strategic, pulse, forward, currentSprint] = await Promise.all([
                Auth.fetch('/api/exec/strategic').then(r => r.ok ? r.json() : null),
                Auth.fetch('/api/exec/pulse').then(r => r.ok ? r.json() : null),
                Auth.fetch('/api/exec/forward').then(r => r.ok ? r.json() : null),
                Auth.fetch('/api/exec/current-sprint').then(r => r.ok ? r.json() : null),
            ]);

            if (strategic)    { _data.strategic    = strategic;    _renderStrategic(strategic);       }
            if (pulse)        { _data.pulse        = pulse;        _renderPulse(pulse);               }
            if (forward)      { _data.forward      = forward;      _renderForward(forward);           }
            if (currentSprint){ _data.currentSprint= currentSprint;_renderW0(currentSprint);          }

            _attachDrillDownHandlers();

            document.getElementById('exec-last-updated').textContent =
                'Updated ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        } catch (e) {
            console.error('[ExecDashboard] Load failed:', e);
        }
    }

    // ── Header ────────────────────────────────────────────────────────────────

    function _renderHeader(pmInstances) {
        const subtitle = document.getElementById('exec-subtitle');
        if (!subtitle) return;
        const n = pmInstances.length;
        subtitle.textContent = n === 0
            ? 'No PM workspaces found — create one in Settings'
            : `Consolidated across ${n} PM workspace${n > 1 ? 's' : ''}: ${pmInstances.map(i => i.name).join(', ')}`;
    }

    // ── Section 0: Current Sprint (live) ─────────────────────────────────────

    function _renderW0(data) {
        const el = document.getElementById('w0-body');
        if (!el) return;
        if (!data.sprint) {
            el.innerHTML = _emptyState('📋', 'No active sprint detected', 'Sprint data will appear once an active sprint is synced from Jira.');
            return;
        }
        const end      = new Date(data.sprint.end_date);
        const today    = new Date();
        const daysLeft = Math.max(0, Math.round((end - today) / 86400000));

        const rows = (data.instances ?? []).map(inst => {
            const pct          = inst.total > 0 ? Math.round(inst.done / inst.total * 100) : 0;
            const committedPct = inst.total > 0 ? Math.round((inst.committed ?? inst.total) / inst.total * 100) : 100;
            const addedPct     = 100 - committedPct;
            const row = _enc({ w: 'w0', id: inst.instance_id, name: inst.instance_name });
            const track = addedPct > 0
                ? `<div style="flex:1;height:8px;border-radius:4px;overflow:hidden;display:flex;position:relative;">
                    <div style="width:${committedPct}%;background:var(--color-accent-subtle);"></div>
                    <div style="width:${addedPct}%;background:rgba(245,158,11,0.18);border-left:2px solid rgba(245,158,11,0.5);"></div>
                    <div style="position:absolute;left:0;top:0;height:100%;width:${pct}%;background:var(--color-accent);border-radius:4px;transition:width 0.3s;"></div>
                   </div>`
                : `<div class="progress-track" style="flex:1;"><div class="progress-fill" style="width:${pct}%;background:var(--color-accent);"></div></div>`;
            return `<div data-dd-row="${row}" style="display:flex;align-items:center;gap:16px;padding:8px 0;border-bottom:1px solid var(--color-accent-subtle);cursor:pointer;">
                <div style="font-size:0.87rem;font-weight:700;color:var(--color-text-primary);min-width:90px;flex-shrink:0;">${Auth.esc(inst.instance_name)}</div>
                <div style="flex:1;display:flex;align-items:center;gap:8px;">
                    ${track}
                    <div style="font-size:0.8rem;font-weight:700;color:var(--color-accent);min-width:34px;text-align:right;">${pct}%</div>
                </div>
                <div style="font-size:0.85rem;color:var(--color-text-secondary);min-width:110px;text-align:right;flex-shrink:0;">
                    ${inst.done}/${inst.total} stories
                </div>
                <div style="font-size:0.83rem;color:var(--color-text-muted);min-width:140px;text-align:right;flex-shrink:0;">
                    ${inst.signals_this_sprint} signal${inst.signals_this_sprint !== 1 ? 's' : ''} captured${inst.epics_moving > 0 ? ` · ${inst.epics_moving} epic${inst.epics_moving !== 1 ? 's' : ''} moving` : ''}${inst.added > 0 ? ` · <span style="color:var(--color-warning);">+${inst.added} added</span>` : ''}${inst.removed > 0 ? ` · <span style="color:var(--color-danger);">−${inst.removed} removed</span>` : ''}
                </div>
            </div>`;
        }).join('');

        el.innerHTML = rows || _emptyState('📋', 'No stories in active sprint', 'Sync Jira to populate sprint data.');
    }

    // ── Section 1: Strategic Alignment ───────────────────────────────────────

    function _renderStrategic(data) {
        _renderW1A(data.okr_trend ?? []);
        _renderW1B(data.okr_objectives ?? []);
        _renderW4(data.focus_guard ?? []);
    }

    // Widget 1A — OKR Horizontal Alignment Trend
    function _renderW1A(okrTrend) {
        const el = document.getElementById('w1a-body');
        if (!el) return;
        if (!okrTrend.length) {
            el.innerHTML = _emptyState('📈', 'No radar analyses yet', 'Run your first Radar analysis to see OKR alignment trends over time.');
            return;
        }
        // Group by instance, take last 6 entries each
        const byInstance = {};
        for (const r of okrTrend) {
            if (!byInstance[r.instance_id]) byInstance[r.instance_id] = { name: r.instance_name, points: [] };
            if (byInstance[r.instance_id].points.length < 6) byInstance[r.instance_id].points.push(r);
        }
        const rows = Object.values(byInstance).map(inst => {
            const bars = inst.points.map((p, i) => {
                const color = p.score >= 70 ? 'var(--color-accent)' : p.score >= 50 ? 'var(--color-warning)' : 'var(--color-danger)';
                const row   = _enc({ w: 'w1a', instance_id: p.instance_id, instance_name: p.instance_name, sprint_idx: i });
                return `<div data-dd-row="${row}" style="display:flex;flex-direction:column;align-items:center;gap:4px;flex:1;cursor:pointer;">
                    <div style="font-size:0.8rem;font-weight:700;color:${color};">${p.score}%</div>
                    <div style="width:100%;background:var(--color-accent-subtle);border-radius:4px;height:40px;position:relative;overflow:hidden;">
                        <div style="position:absolute;bottom:0;width:100%;height:${p.score}%;background:${color};border-radius:4px;transition:height 0.5s;"></div>
                    </div>
                    <div style="font-size:0.87rem;color:var(--color-text-muted);text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:52px;">${p.sprint}</div>
                </div>`;
            }).join('');
            return `<div style="margin-bottom:16px;">
                <div style="font-size:0.85rem;font-weight:700;color:var(--color-accent);margin-bottom:8px;">${Auth.esc(inst.name)}</div>
                <div style="display:flex;gap:6px;align-items:flex-end;">${bars}</div>
            </div>`;
        }).join('');
        el.innerHTML = rows;
    }

    // Widget 1B — Strategic Convergence matrix
    function _renderW1B(objectives) {
        const el = document.getElementById('w1b-body');
        if (!el) return;
        if (!objectives.length || objectives.every(o => !o.objectives || (Array.isArray(o.objectives) && !o.objectives.length))) {
            el.innerHTML = _emptyState('🎯', 'No OKRs defined', 'Add quarterly objectives in Settings to see PM alignment.');
            return;
        }
        // Pull latest score per PM from okr_trend (already ordered newest-first per instance)
        const trend = _data.strategic?.okr_trend ?? [];
        const latestScoreByName = {};
        for (const r of trend) {
            if (!(r.instance_name in latestScoreByName)) latestScoreByName[r.instance_name] = r.score;
        }
        el.innerHTML = objectives.map(o => {
            const score = latestScoreByName[o.instance_name] ?? null;
            const color = score === null ? 'var(--color-text-muted)'
                : score >= 70 ? 'var(--color-accent)'
                : score >= 50 ? 'var(--color-warning)'
                : 'var(--color-danger)';
            const objLines = (Array.isArray(o.objectives) ? o.objectives : (o.objectives ?? '').split('\n')).filter(Boolean).slice(0, 3);
            return `<div style="margin-bottom:12px;padding:10px;border-radius:8px;border:1px solid var(--color-border);background:var(--color-bg-surface);">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:5px;">
                    <div style="font-size:0.83rem;font-weight:800;color:var(--color-accent);text-transform:uppercase;letter-spacing:0.08em;">${Auth.esc(o.instance_name)}</div>
                    <div style="font-size:0.9rem;font-weight:900;color:${color};">${score !== null ? score + '%' : '—'}</div>
                </div>
                <div class="progress-track" style="margin-bottom:6px;"><div class="progress-fill" style="width:${score ?? 0}%;background:${color};"></div></div>
                ${objLines.length ? `<div style="font-size:0.83rem;color:var(--color-text-secondary);line-height:1.5;">${objLines.map(l => `· ${Auth.esc(l)}`).join('<br>')}</div>` : ''}
            </div>`;
        }).join('');
    }


    // Widget 4 — Resource Allocation (per squad, last 3 sprints)
    function _renderW4(focusGuard) {
        const el = document.getElementById('w4-body');
        if (!el) return;
        const squads = focusGuard.filter(f => f.sprints?.length > 0);
        if (!squads.length) {
            el.innerHTML = _emptyState('🛡', 'No backlog data', 'Add stories to your backlog to see focus distribution.');
            return;
        }
        el.innerHTML = squads.map(sq => {
            const sprintRows = sq.sprints.map(sp => {
                const label = sp.name
                    ? `${Auth.esc(sp.name)}${sp.is_current ? ' <span style="color:var(--color-accent);font-weight:700;">·</span>' : ''}`
                    : 'All stories';
                const row = _enc({ w: 'w4', id: sq.instance_id, name: sq.instance_name, sprint: sp.name, is_current: sp.is_current });
                return `<div data-dd-row="${row}" style="margin-bottom:6px;cursor:pointer;">
                    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:2px;">
                        <span style="font-size:0.78rem;color:var(--color-text-muted);">${label}</span>
                        <span style="font-size:0.75rem;color:var(--color-text-muted);">${sp.new_value_pct}% · ${sp.maintenance_pct}% · ${sp.tech_debt_pct}%</span>
                    </div>
                    <div style="display:flex;gap:1px;height:7px;border-radius:4px;overflow:hidden;background:var(--color-accent-subtle);">
                        <div style="flex:${sp.new_value_pct};background:var(--color-accent);"></div>
                        <div style="flex:${sp.maintenance_pct};background:var(--color-warning);"></div>
                        <div style="flex:${sp.tech_debt_pct};background:var(--color-text-muted);"></div>
                    </div>
                </div>`;
            }).join('');
            return `<div style="margin-bottom:14px;padding-bottom:10px;border-bottom:1px solid var(--color-accent-subtle);">
                <div style="font-size:0.87rem;font-weight:700;color:var(--color-text-primary);margin-bottom:6px;">${Auth.esc(sq.instance_name)}</div>
                ${sprintRows}
            </div>`;
        }).join('') + `<div style="display:flex;gap:12px;font-size:0.78rem;color:var(--color-text-muted);margin-top:2px;">
            <span style="color:var(--color-accent);">■ New</span>
            <span style="color:var(--color-warning);">■ Maint</span>
            <span style="color:var(--color-text-muted);">■ Debt</span>
        </div>`;
    }

    // ── Section 2: Team Pulse ─────────────────────────────────────────────────

    function _renderPulse(data) {
        _renderW5(data.scope_drift ?? []);
        _renderW6(data.signal_velocity);
        _renderW7(data.epic_health ?? []);
    }

    // Widget 5 — Sprint Predictability line chart (SVG, no dependencies)
    function _renderW5(scopeDrift) {
        const el = document.getElementById('w5-body');
        if (!el) return;
        const squads = scopeDrift.filter(sq => sq.sprints && sq.sprints.length > 0);
        if (!squads.length) {
            el.innerHTML = _emptyState('📊', 'No sprint data', 'Sprint completion data will appear after your next sprint sync from Jira.');
            return;
        }

        // Collect all start_dates across squads to build a shared time axis.
        // Falls back to index-based alignment if dates are missing.
        const fmtDate = d => {
            if (!d) return null;
            const dt = new Date(d + 'T00:00:00');
            return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        };
        const allDates = [...new Set(
            squads.flatMap(sq => sq.sprints.map(s => s.start_date).filter(Boolean))
        )].sort();
        const useDates = allDates.length > 0;

        // X axis: use real dates if available, else ordinal positions
        const maxSprints = Math.max(...squads.map(sq => sq.sprints.length));
        const n = useDates ? allDates.length : maxSprints;

        // SVG layout constants
        const W = 300, H = 110;
        const PAD = { top: 8, right: 10, bottom: 26, left: 26 };
        const cW = W - PAD.left - PAD.right;
        const cH = H - PAD.top - PAD.bottom;
        const xForDate = d => {
            const idx = allDates.indexOf(d);
            return PAD.left + (n <= 1 ? cW / 2 : (idx / (n - 1)) * cW);
        };
        const xPos = i => PAD.left + (n <= 1 ? cW / 2 : (i / (n - 1)) * cW);
        const yPos = pct => PAD.top + cH - (pct / 100) * cH;

        // Reference lines at 60% (warning) and 80% (healthy)
        const refLines = [
            { v: 80, color: '#10b981' },
            { v: 60, color: '#f59e0b' },
        ].map(({ v, color }) =>
            `<line x1="${PAD.left}" x2="${W - PAD.right}" y1="${yPos(v)}" y2="${yPos(v)}"
                stroke="${color}" stroke-width="1" stroke-dasharray="3,3" opacity="0.45"/>
            <text x="${PAD.left - 2}" y="${yPos(v) + 3.5}" font-size="6.5" fill="${color}" text-anchor="end" opacity="0.8">${v}</text>`
        ).join('');

        // X-axis labels: real dates or ordinal fallback
        const xLabels = useDates
            ? allDates.map(d => `<text x="${xForDate(d)}" y="${H - 5}" font-size="6.5" fill="var(--color-text-muted)" text-anchor="middle">${fmtDate(d)}</text>`).join('')
            : Array.from({ length: n }, (_, i) => `<text x="${xPos(i)}" y="${H - 5}" font-size="6.5" fill="var(--color-text-muted)" text-anchor="middle">S${i + 1}</text>`).join('');

        // One polyline + dots per squad positioned by start_date (or index fallback)
        const lines = squads.map(sq => {
            const color    = sq.color || '#6366f1';
            const squadRow = _enc({ w: 'w5', id: sq.instance_id, name: sq.instance_name });
            const offset   = useDates ? 0 : (maxSprints - sq.sprints.length);
            const pts = sq.sprints.map((sp, idx) => {
                const pct = sp.planned > 0 ? Math.round(sp.delivered / sp.planned * 100) : null;
                if (pct === null) return null;
                const x = useDates && sp.start_date ? xForDate(sp.start_date) : xPos(offset + idx);
                return { x, y: yPos(pct), pct, label: sp.period, sp };
            }).filter(Boolean);
            if (!pts.length) return '';
            const polyPoints = pts.map(p => `${p.x},${p.y}`).join(' ');
            const dots = pts.map(p => {
                const sprintRow = _enc({ w: 'w5', id: sq.instance_id, name: sq.instance_name, jira_id: p.sp.jira_id });
                return `<circle cx="${p.x}" cy="${p.y}" r="3.5" fill="${color}" stroke="var(--color-bg-card)" stroke-width="1.2" data-dd-row="${sprintRow}" style="cursor:pointer;"/>`;
            }).join('');
            return `<polyline points="${polyPoints}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" data-dd-row="${squadRow}" style="cursor:pointer;"/>
                ${dots}`;
        }).join('');

        // Legend row per squad
        const legend = squads.map(sq => {
            const color      = sq.color || '#6366f1';
            const score      = sq.predictability;
            const scoreColor = score === null ? 'var(--color-text-muted)' : score >= 80 ? 'var(--color-success)' : score >= 60 ? 'var(--color-warning)' : 'var(--color-danger)';
            const row        = _enc({ w: 'w5', id: sq.instance_id, name: sq.instance_name });
            return `<div data-dd-row="${row}" style="display:flex;align-items:center;gap:6px;cursor:pointer;">
                <span style="width:14px;height:2.5px;background:${color};display:inline-block;border-radius:2px;flex-shrink:0;"></span>
                <span style="font-size:0.78rem;color:var(--color-text-secondary);flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${Auth.esc(sq.instance_name)}</span>
                <span style="font-size:0.78rem;font-weight:700;color:${scoreColor};">${score !== null ? score + '%' : '—'}</span>
            </div>`;
        }).join('');

        el.innerHTML = `
            <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block;" xmlns="http://www.w3.org/2000/svg">
                ${refLines}
                ${xLabels}
                ${lines}
            </svg>
            <div style="display:flex;flex-direction:column;gap:5px;margin-top:8px;">${legend}</div>`;
    }

    // Widget 6 — Response Lead Time (per squad)
    function _renderW6(velocity) {
        const el = document.getElementById('w6-body');
        if (!el) return;
        const squads = Array.isArray(velocity) ? velocity.filter(v => v.signal_count > 0) : [];
        if (!squads.length) {
            el.innerHTML = _emptyState('⚡', 'No signals yet', 'Add signals to the Intelligence Hub to track delivery velocity.');
            return;
        }
        el.innerHTML = squads.map(v => {
            const lt    = v.avg_traced_lead_time;
            const color = lt === null ? 'var(--color-text-muted)' : lt > 30 ? 'var(--color-danger)' : 'var(--color-success)';
            const row   = _enc({ w: 'w6', id: v.instance_id, name: v.instance_name });
            return `<div data-dd-row="${row}" style="margin-bottom:12px;padding-bottom:10px;border-bottom:1px solid var(--color-accent-subtle);cursor:pointer;">
                <div style="font-size:0.87rem;font-weight:700;color:var(--color-text-primary);margin-bottom:6px;">${Auth.esc(v.instance_name)}</div>
                <div style="display:flex;align-items:center;gap:12px;">
                    <div style="text-align:center;padding:8px 16px;background:var(--color-accent-subtle);border-radius:8px;flex:1;">
                        <div style="font-size:1.3rem;font-weight:900;color:${color};">${lt != null ? lt : '—'}</div>
                        <div style="font-size:0.75rem;color:var(--color-text-muted);margin-top:1px;">avg lead time (days)</div>
                    </div>
                    <div style="text-align:center;padding:8px 16px;background:var(--color-bg-secondary);border-radius:8px;">
                        <div style="font-size:1.3rem;font-weight:900;color:var(--color-text-secondary);">${v.traced_count ?? 0}</div>
                        <div style="font-size:0.75rem;color:var(--color-text-muted);margin-top:1px;">traced stories</div>
                    </div>
                </div>
            </div>`;
        }).join('');
    }

    // Widget 7 — Portfolio Risk Monitor (per squad)
    function _renderW7(epics) {
        const el = document.getElementById('w7-body');
        if (!el) return;
        if (!epics.length) {
            el.innerHTML = _emptyState('🗂', 'No epics found', 'Stories with epic labels will appear here once added to your backlog.');
            return;
        }
        // Group epics by instance
        const byInst = {};
        for (const e of epics) {
            if (!byInst[e.instance_name]) byInst[e.instance_name] = [];
            byInst[e.instance_name].push(e);
        }
        el.innerHTML = Object.entries(byInst).map(([instName, instEpics]) => {
            const atRisk = instEpics.filter(e => e.health === 'at_risk').length;
            const watch  = instEpics.filter(e => e.health === 'watch').length;
            const good   = instEpics.filter(e => e.health === 'good').length;
            const squadBadge = atRisk > 0 ? 'badge-critical' : watch > 0 ? 'badge-warning' : 'badge-good';
            const squadLabel = atRisk > 0 ? 'At risk' : watch > 0 ? 'Watch' : 'Good';
            const epicRows = instEpics.map(e => {
                const badge = e.health === 'good' ? 'badge-good' : e.health === 'watch' ? 'badge-warning' : 'badge-critical';
                const label = e.health === 'good' ? 'Good' : e.health === 'watch' ? 'Watch' : 'At risk';
                return `<div style="display:flex;align-items:center;gap:8px;padding:4px 0 4px 10px;border-left:2px solid var(--color-accent-subtle);">
                    <div style="flex:1;min-width:0;font-size:0.83rem;color:var(--color-text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${Auth.esc(e.epic)}</div>
                    <span style="font-size:0.75rem;color:var(--color-text-muted);">${e.done}/${e.total}</span>
                    <span class="${badge}" style="font-size:0.75rem;">${label}</span>
                </div>`;
            }).join('');
            const row = _enc({ w: 'w7', name: instName });
            return `<div data-dd-row="${row}" style="margin-bottom:12px;cursor:pointer;">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
                    <div style="font-size:0.87rem;font-weight:700;color:var(--color-text-primary);">${Auth.esc(instName)}</div>
                    <div style="display:flex;align-items:center;gap:6px;">
                        <span style="font-size:0.8rem;color:var(--color-text-muted);">${instEpics.length} epic${instEpics.length > 1 ? 's' : ''}</span>
                        <span class="${squadBadge}">${squadLabel}</span>
                    </div>
                </div>
                ${epicRows}
            </div>`;
        }).join('');
    }

    // ── Section 3: Forward Look ───────────────────────────────────────────────

    function _renderForward(data) {
        _renderW8(data.predictive_timeline ?? []);
        _renderW10(data.decisions_required ?? [], data.risks ?? []);
    }

    // Widget 8 — Predictive Timeline
    function _renderW8(timeline) {
        const el = document.getElementById('w8-body');
        if (!el) return;
        if (!timeline.length) {
            el.innerHTML = _emptyState('🗺', 'No epic data', 'Stories grouped by epic will generate a predictive timeline.');
            return;
        }
        el.innerHTML = timeline.map(e => {
            const pct      = e.total ? Math.round((e.total - e.remaining) / e.total * 100) : 0;
            const sprLabel = e.sprints_remaining === 1 ? '1 sprint' : `${e.sprints_remaining} sprints`;
            return `<div style="margin-bottom:14px;">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:5px;">
                    <div>
                        <span style="font-size:0.93rem;font-weight:700;color:var(--color-text-primary);">${Auth.esc(e.epic)}</span>
                        <span style="font-size:0.8rem;color:var(--color-text-muted);margin-left:6px;">${Auth.esc(e.instance_name)}</span>
                    </div>
                    <span style="font-size:0.85rem;font-weight:700;color:var(--color-accent);">${e.target_sprint_label ?? `~${sprLabel}`}</span>
                </div>
                <div class="progress-track">
                    <div class="progress-fill" style="width:${pct}%;background:linear-gradient(90deg,var(--color-accent),var(--color-accent-subtle));"></div>
                </div>
                <div style="display:flex;justify-content:space-between;font-size:0.9rem;color:var(--color-text-muted);margin-top:3px;">
                    <span>${pct}% complete</span>
                    <span>${e.remaining} stories · ${e.points} pts remaining</span>
                </div>
            </div>`;
        }).join('');
    }

    // Widget 10 — Decisions Required (+ absorbed risks)
    function _renderW10(decisions, risks = []) {
        const el = document.getElementById('w10-body');
        if (!el) return;
        // Elevate high-priority risks into decisions
        const riskKeywords = ['okr', 'churn', 'retention', 'revenue', 'client', 'critical'];
        const elevatedRisks = risks
            .filter(r => r.severity === 'critical' || riskKeywords.some(k => (r.description || '').toLowerCase().includes(k)))
            .map(r => ({
                instance_name:    r.instance_name,
                severity:         r.severity === 'critical' ? 'critical' : 'warning',
                description:      r.description,
                suggested_action: `Risk escalation — ${r.type || 'business impact'}: monitor trend and address before next sprint.`,
            }));
        const allItems = [...elevatedRisks, ...decisions];
        if (!allItems.length) {
            el.innerHTML = _emptyState('✅', 'No decisions required', 'Precede will flag decisions here when OKR alignment drops, risks escalate, or signal coverage falls below threshold.');
            return;
        }
        const severityStyle = {
            critical: { border: 'var(--color-danger-subtle)', bg: 'var(--color-danger-subtle)', badge: 'badge-critical', label: 'Critical' },
            warning:  { border: 'var(--color-warning-subtle)', bg: 'var(--color-warning-subtle)', badge: 'badge-warning',  label: 'Warning'  },
            watch:    { border: 'var(--color-info-subtle)', bg: 'var(--color-info-subtle)', badge: 'badge-watch',    label: 'Watch'    },
        };
        el.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px;">` +
            allItems.map(d => {
                const s = severityStyle[d.severity] ?? severityStyle.watch;
                return `<div style="padding:14px;border-radius:12px;border:1px solid ${s.border};background:${s.bg};">
                    <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
                        <span class="${s.badge}">${s.label}</span>
                        <span style="font-size:0.8rem;color:var(--color-text-muted);">${Auth.esc(d.instance_name)}</span>
                    </div>
                    <p style="font-size:0.9rem;font-weight:600;color:var(--color-text-primary);margin:0 0 6px;line-height:1.4;">${Auth.esc(d.description)}</p>
                    <p style="font-size:0.87rem;color:var(--color-text-secondary);margin:0;line-height:1.4;">→ ${Auth.esc(d.suggested_action)}</p>
                </div>`;
            }).join('') + '</div>';
    }

    // Widget 9 — Strategic Synthesis (AI cached per sprint)
    function _renderW9(data) {
        const el = document.getElementById('w9-body');
        if (!el) return;

        if (!data || data.insufficient_data) {
            el.innerHTML = _emptyState('🧠', 'Briefing unavailable', 'At least one closed sprint is required. Complete your first sprint to unlock the strategic briefing.');
            return;
        }

        const { synthesis, sprint_name: sprintName, generated_at: generatedAt, cached } = data;

        if (!synthesis || synthesis.generation_error) {
            el.innerHTML = _emptyState('🧠', 'Briefing generation failed', 'Will retry when the next sprint closes. Ensure Claude API is configured.');
            return;
        }

        // Timestamp: "Sprint 2 · Strategic briefing · Apr 14"
        const dateLabel = generatedAt
            ? new Date(generatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
            : '';
        const timestamp = [sprintName, 'Strategic briefing', dateLabel].filter(Boolean).join(' · ');

        // ── Section 1: Executive Pulse ──────────────────────────────────────
        const pulseSection = synthesis.executive_pulse ? `
            <div style="padding:14px 16px;background:var(--color-accent-subtle);border-radius:8px;margin-bottom:18px;">
                <div style="font-size:0.75rem;font-weight:800;text-transform:uppercase;letter-spacing:0.08em;color:var(--color-accent);margin-bottom:8px;">Executive Pulse</div>
                <p style="font-size:0.93rem;line-height:1.65;color:var(--color-text-primary);margin:0;">${Auth.esc(synthesis.executive_pulse)}</p>
            </div>` : '';

        // ── Section 2: Squad Reads ──────────────────────────────────────────
        const squadStatusMap = {
            on_track: { color: 'var(--color-success)', bg: 'var(--color-success-subtle)', label: 'On track' },
            watch:    { color: 'var(--color-warning)', bg: 'var(--color-warning-subtle)', label: 'Watch'    },
            at_risk:  { color: 'var(--color-danger)',  bg: 'var(--color-danger-subtle)',  label: 'At risk'  },
        };
        const squadReads = synthesis.squad_reads ?? [];
        const squadSection = squadReads.length ? `
            <div style="margin-bottom:18px;">
                <div style="font-size:0.75rem;font-weight:800;text-transform:uppercase;letter-spacing:0.08em;color:var(--color-text-secondary);margin-bottom:10px;">Squad Read</div>
                <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px;">
                    ${squadReads.map((sq, i) => {
                        const st  = squadStatusMap[sq.status] ?? squadStatusMap.watch;
                        const row = _enc({ w: 'w9', type: 'squad', idx: i });
                        return `<div data-dd-row="${row}" style="padding:12px 14px;background:var(--color-bg-surface);border:1px solid var(--color-border);border-top:3px solid ${st.color};border-radius:8px;cursor:pointer;">
                            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:7px;gap:6px;">
                                <div style="font-size:0.87rem;font-weight:700;color:var(--color-text-primary);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${Auth.esc(sq.instance_name ?? sq.squad ?? '')}</div>
                                <span style="font-size:0.72rem;font-weight:700;color:${st.color};background:${st.bg};padding:2px 7px;border-radius:8px;flex-shrink:0;">${st.label}</span>
                            </div>
                            <p style="font-size:0.84rem;color:var(--color-text-secondary);margin:0;line-height:1.5;">${Auth.esc(sq.read ?? '')}</p>
                        </div>`;
                    }).join('')}
                </div>
            </div>` : '';

        // ── Section 3: Where to Intervene ───────────────────────────────────
        const urgencyMap = {
            this_sprint:  { label: 'This Sprint',  color: 'var(--color-danger)',  bg: 'var(--color-danger-subtle)',  border: 'var(--color-danger)'  },
            next_sprint:  { label: 'Next Sprint',  color: 'var(--color-warning)', bg: 'var(--color-warning-subtle)', border: 'var(--color-warning)' },
            this_quarter: { label: 'This Quarter', color: 'var(--color-info)',    bg: 'var(--color-info-subtle)',    border: 'var(--color-accent)'  },
        };
        const interventions = synthesis.where_to_intervene ?? [];
        const interventionSection = interventions.length ? `
            <div style="margin-bottom:18px;">
                <div style="font-size:0.75rem;font-weight:800;text-transform:uppercase;letter-spacing:0.08em;color:var(--color-text-secondary);margin-bottom:10px;">Where to Intervene</div>
                <div style="display:flex;flex-direction:column;gap:10px;">
                    ${interventions.slice(0, 3).map((item, i) => {
                        const u   = urgencyMap[item.urgency] ?? urgencyMap.this_quarter;
                        const row = _enc({ w: 'w9', type: 'intervention', idx: i });
                        return `<div data-dd-row="${row}" style="padding:12px 14px;background:var(--color-bg-surface);border:1px solid var(--color-border);border-left:3px solid ${u.border};border-radius:8px;cursor:pointer;">
                            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:7px;gap:8px;">
                                <div style="font-size:0.9rem;font-weight:700;color:var(--color-text-primary);">${Auth.esc(item.title ?? '')}</div>
                                <span style="font-size:0.75rem;font-weight:700;color:${u.color};background:${u.bg};padding:2px 9px;border-radius:10px;flex-shrink:0;">${u.label}</span>
                            </div>
                            <p style="font-size:0.87rem;color:var(--color-text-secondary);margin:0 0 7px;line-height:1.5;">${Auth.esc(item.why_exec ?? '')}</p>
                            <p style="font-size:0.85rem;color:var(--color-text-muted);margin:0;font-style:italic;">→ ${Auth.esc(item.suggested_action ?? '')}</p>
                        </div>`;
                    }).join('')}
                </div>
            </div>` : '';

        // ── Section 3: Quarter Outlook ──────────────────────────────────────
        const statusMap = {
            on_track:  { label: 'On Track',  color: 'var(--color-success)', bg: 'var(--color-success-subtle)' },
            at_risk:   { label: 'At Risk',   color: 'var(--color-warning)', bg: 'var(--color-warning-subtle)' },
            off_track: { label: 'Off Track', color: 'var(--color-danger)',  bg: 'var(--color-danger-subtle)'  },
        };
        const outlook = synthesis.quarter_outlook;
        const outlookSection = outlook ? (() => {
            const st  = statusMap[outlook.assessment] ?? statusMap.at_risk;
            const row = _enc({ w: 'w9', type: 'outlook' });
            return `<div data-dd-row="${row}" style="padding:14px 16px;background:var(--color-bg-surface);border:1px solid var(--color-border);border-radius:8px;cursor:pointer;">
                <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
                    <div style="font-size:0.75rem;font-weight:800;text-transform:uppercase;letter-spacing:0.08em;color:var(--color-text-secondary);">Quarter Outlook</div>
                    <span style="font-size:0.8rem;font-weight:800;color:${st.color};background:${st.bg};padding:3px 10px;border-radius:10px;">${st.label}</span>
                </div>
                ${outlook.rationale ? `<p style="font-size:0.87rem;color:var(--color-text-secondary);margin:0 0 10px;line-height:1.5;">${Auth.esc(outlook.rationale)}</p>` : ''}
                ${outlook.key_dependency ? `<div style="padding:8px 12px;background:var(--color-accent-subtle);border-radius:6px;font-size:0.85rem;color:var(--color-text-primary);"><strong>Key dependency:</strong> ${Auth.esc(outlook.key_dependency)}</div>` : ''}
            </div>`;
        })() : '';

        el.innerHTML = `<div style="font-size:0.78rem;color:var(--color-text-muted);margin-bottom:16px;">${Auth.esc(timestamp)}</div>${pulseSection}${squadSection}${interventionSection}${outlookSection}`;
    }

    // ── Drill-down panel ──────────────────────────────────────────────────────

    // Encode an object for a data-dd-row HTML attribute
    const _enc = obj => JSON.stringify(obj).replace(/"/g, '&quot;');

    function _attachDrillDownHandlers() {
        ['w0','w1a','w1b','w4','w5','w6','w7','w8','w9','w10'].forEach(id => {
            const el = document.getElementById(id);
            if (!el || el.dataset.ddBound) return;
            el.dataset.ddBound = '1';
            el.style.cursor = 'pointer';
            el.addEventListener('click', e => {
                if (e.target.closest('.tip-icon')) return;
                const rowEl = e.target.closest('[data-dd-row]');
                if (rowEl) {
                    try {
                        const rowData = JSON.parse(rowEl.dataset.ddRow);
                        const cfg = _rowDrillDownConfig(rowData);
                        if (cfg) { DrillDown.open(cfg); return; }
                    } catch (_) {}
                }
                _openDrillDown(id);
            });
        });
    }

    function _openDrillDown(widgetId) {
        if (typeof DrillDown === 'undefined') return;
        const cfg = _drillDownConfig(widgetId);
        if (!cfg) return;
        DrillDown.open(cfg);
    }

    function _rowDrillDownConfig(row) {
        const s = _data.strategic;
        const p = _data.pulse;
        const storyBody = list => list?.length ? list.map(s => s.jiraKey ? `[${s.jiraKey}] ${s.title}` : s.title).join('\n') : null;

        switch (row.w) {

            case 'w1a': {
                const trend = _data.strategic?.okr_trend ?? [];
                const instPoints = trend.filter(p => p.instance_id === row.instance_id);
                const point = instPoints[row.sprint_idx];
                if (!point) return null;

                // Use focus_guard story categories for this sprint — more reliable than keyword matching.
                // new_value = OKR-aligned (value creation), maintenance + tech_debt = not aligned.
                const focusGuard  = _data.strategic?.focus_guard ?? [];
                const squadGuard  = focusGuard.find(f => f.instance_id === row.instance_id);
                const sprintGuard = squadGuard?.sprints?.find(sp => sp.name === point.sprint);
                const cats        = sprintGuard?.stories_by_category ?? {};
                const stmtFmt     = s => s.jiraKey ? `[${s.jiraKey}] ${s.title}` : s.title;

                const isDone = s => ['done', 'closed', 'complete', 'completed', 'resolved', 'accepted'].includes(s.status ?? '');
                const aligned   = (cats.new_value   ?? []).filter(isDone);
                const unaligned = [...(cats.maintenance ?? []), ...(cats.tech_debt ?? [])].filter(isDone);

                const objData  = (s?.okr_objectives ?? []).find(o => o.instance_id === row.instance_id);
                const objLines = objData?.objectives
                    ? (Array.isArray(objData.objectives)
                        ? objData.objectives
                        : String(objData.objectives).split('\n')
                      ).filter(Boolean)
                    : [];

                const sources = [
                    ...(objLines.length ? [{
                        label: 'Quarterly Objectives',
                        body:  objLines.join('\n'),
                        tag:   'From Settings',
                        tagVariant: 'info',
                    }] : []),
                    ...(aligned.length ? [{
                        label: `Aligned with OKRs — New Value (${aligned.length})`,
                        body:  aligned.map(stmtFmt).join('\n'),
                        tag:   'Aligned',
                        tagVariant: 'success',
                    }] : []),
                    ...(unaligned.length ? [{
                        label: `Not OKR-aligned — Maintenance & Tech Debt (${unaligned.length})`,
                        body:  unaligned.map(stmtFmt).join('\n'),
                        tag:   'Not aligned',
                        tagVariant: 'danger',
                    }] : []),
                ];

                return {
                    label: `${row.instance_name} · ${point.sprint}`,
                    title: `OKR Alignment — ${point.sprint}`,
                    description: `<p>Completed stories for <strong>${Auth.esc(row.instance_name)}</strong> during <strong>${Auth.esc(point.sprint)}</strong>. New Value = aligned with OKRs. Maintenance & Tech Debt = not aligned.</p>`,
                    details: [
                        { label: 'OKR score',    value: `${point.score}%` },
                        { label: 'Aligned',      value: String(aligned.length) },
                        { label: 'Not aligned',  value: String(unaligned.length) },
                    ],
                    sources: sources.length ? sources : [{ label: 'No completed stories found for this sprint', tag: 'Empty', tagVariant: 'neutral' }],
                };
            }

            case 'w9': {
                const syn = _data.synthesis?.synthesis;
                if (!syn) return null;
                const urgencyLabels = { this_sprint: 'This Sprint', next_sprint: 'Next Sprint', this_quarter: 'This Quarter' };
                const outcomeLabels = { on_track: 'On Track', at_risk: 'At Risk', off_track: 'Off Track' };

                if (row.type === 'squad') {
                    const sq = (syn.squad_reads ?? [])[row.idx];
                    if (!sq) return null;
                    const statusLabels = { on_track: 'On track', watch: 'Watch', at_risk: 'At risk' };
                    return {
                        label: `Squad Read · ${sq.instance_name ?? sq.squad ?? ''}`,
                        title: sq.instance_name ?? sq.squad ?? 'Squad Read',
                        description: sq.reasoning ? `<p><strong>AI reasoning:</strong> ${Auth.esc(sq.reasoning)}</p>` : undefined,
                        details: [{ label: 'Status', value: statusLabels[sq.status] ?? sq.status }],
                        sources: [{ label: sq.read ?? '', tag: statusLabels[sq.status] ?? sq.status, tagVariant: sq.status === 'on_track' ? 'success' : sq.status === 'at_risk' ? 'danger' : 'warning' }],
                    };
                }

                if (row.type === 'intervention') {
                    const item = (syn.where_to_intervene ?? [])[row.idx];
                    if (!item) return null;
                    return {
                        label: `Intervention · ${item.title ?? ''}`,
                        title: item.title ?? 'Where to Intervene',
                        description: item.reasoning ? `<p><strong>AI reasoning:</strong> ${Auth.esc(item.reasoning)}</p>` : undefined,
                        details: [{ label: 'Urgency', value: urgencyLabels[item.urgency] ?? item.urgency }],
                        sources: [
                            { label: 'Why exec', body: item.why_exec ?? '' },
                            { label: 'Suggested action', body: item.suggested_action ?? '' },
                        ],
                    };
                }

                if (row.type === 'outlook') {
                    const o = syn.quarter_outlook;
                    if (!o) return null;
                    return {
                        label: 'Quarter Outlook',
                        title: `Quarter Outlook — ${outcomeLabels[o.assessment] ?? o.assessment}`,
                        description: o.reasoning ? `<p><strong>AI reasoning:</strong> ${Auth.esc(o.reasoning)}</p>` : undefined,
                        details: [{ label: 'Assessment', value: outcomeLabels[o.assessment] ?? o.assessment }],
                        sources: [
                            { label: 'Projection', body: o.rationale ?? '' },
                            { label: 'Key dependency', body: o.key_dependency ?? '' },
                        ],
                    };
                }

                return null;
            }

            case 'w0': {
                const cs = _data.currentSprint;
                const inst = (cs?.instances ?? []).find(i => i.instance_id === row.id);
                if (!inst) return null;
                const pct = inst.total > 0 ? Math.round(inst.done / inst.total * 100) : 0;
                const pctColor = pct >= 80 ? 'var(--color-success)' : pct >= 50 ? 'var(--color-warning)' : 'var(--color-danger)';
                return {
                    label: `${row.name} · Sprint in Progress`,
                    title: `${Auth.esc(row.name)} — ${Auth.esc(cs.sprint?.name ?? 'Active Sprint')}`,
                    description: `<p>Live sprint progress for <strong>${Auth.esc(row.name)}</strong>. Data updates on every Refresh — the sprint is still in progress.</p>`,
                    details: [
                        { label: 'Stories done',     value: `${inst.done} / ${inst.total}` },
                        { label: 'Completion',        value: `${pct}%` },
                        { label: 'Committed',         value: String(inst.committed ?? inst.total) },
                        { label: 'Added mid-sprint',  value: String(inst.added   ?? 0) },
                        { label: 'Removed mid-sprint',value: String(inst.removed ?? 0) },
                        { label: 'Signals captured',  value: String(inst.signals_this_sprint) },
                        ...(inst.epics_moving > 0 ? [{ label: 'Epics moving', value: String(inst.epics_moving) }] : []),
                    ],
                    sources: [
                        {
                            label: 'Progress',
                            value: `${inst.done} / ${inst.total} stories`,
                            tag: pct >= 80 ? 'On track' : pct >= 50 ? 'Watch' : 'Behind',
                            tagVariant: pct >= 80 ? 'success' : pct >= 50 ? 'warning' : 'danger',
                        },
                    ],
                };
            }

            case 'w4': {
                const squad = (s?.focus_guard ?? []).find(f => f.instance_id === row.id);
                const sp = squad?.sprints?.find(sp => sp.name === row.sprint) ?? squad?.sprints?.[0];
                if (!sp) return null;
                const sprintTitle = row.sprint ? `${row.sprint}${row.is_current ? ' (current)' : ''}` : 'All stories';
                const CATS = [
                    { key: 'new_value',   label: 'New Value',   pct: sp.new_value_pct   },
                    { key: 'maintenance', label: 'Maintenance', pct: sp.maintenance_pct },
                    { key: 'tech_debt',   label: 'Tech Debt',   pct: sp.tech_debt_pct   },
                ];
                return {
                    label: `${row.name} · Resource Allocation`,
                    title: `${row.name} — ${sprintTitle}`,
                    description: `<p>Effort breakdown for <strong>${Auth.esc(row.name)}</strong> during <strong>${Auth.esc(sprintTitle)}</strong>. ${sp.total} stories total. Click a category to expand its story list.</p>`,
                    details: [
                        { label: 'New Value',   value: `${sp.new_value_pct}%` },
                        { label: 'Maintenance', value: `${sp.maintenance_pct}%` },
                        { label: 'Tech Debt',   value: `${sp.tech_debt_pct}%` },
                    ],
                    sources: CATS.map(c => {
                        const list = sp.stories_by_category?.[c.key] ?? [];
                        return {
                            label: c.label,
                            value: `${list.length} stor${list.length === 1 ? 'y' : 'ies'} · ${c.pct}%`,
                            tag:   c.pct + '%',
                            tagVariant: c.key === 'new_value'
                                ? (c.pct >= 60 ? 'success' : c.pct >= 40 ? 'warning' : 'danger')
                                : (c.pct <= 20 ? 'success' : c.pct <= 35 ? 'warning' : 'danger'),
                            body: storyBody(list) ?? undefined,
                        };
                    }),
                };
            }

            case 'w5': {
                const sq = (p?.scope_drift ?? []).find(sq => sq.instance_id === row.id);
                if (!sq) return null;

                // Per-sprint drilldown (dot click)
                if (row.jira_id) {
                    const sp   = sq.sprints.find(s => s.jira_id === row.jira_id);
                    if (!sp) return null;
                    const rate = sp.planned > 0 ? Math.round(sp.delivered / sp.planned * 100) : 0;
                    const tag  = rate >= 80 ? 'On track' : rate >= 60 ? 'Watch' : 'Behind';
                    const tagVariant = rate >= 80 ? 'success' : rate >= 60 ? 'warning' : 'danger';
                    return {
                        label: `${row.name} · ${Auth.esc(sp.period)}`,
                        title: `${Auth.esc(sp.period)} — ${Auth.esc(row.name)}`,
                        details: [
                            { label: 'Delivered',         value: String(sp.delivered) },
                            { label: 'Committed',         value: String(sp.planned) },
                            { label: 'Score',             value: `${rate}%` },
                            { label: 'Added mid-sprint',  value: String(sp.added   ?? 0) },
                            { label: 'Removed mid-sprint',value: String(sp.removed ?? 0) },
                            { label: 'Rollover',          value: String(sp.rollover ?? 0) },
                        ],
                        sources: [{ label: row.sprint, value: `${rate}%`, tag, tagVariant }],
                    };
                }

                // Squad-level drilldown (line or legend click)
                return {
                    label: `${row.name} · Sprint Predictability`,
                    title: `Sprint Predictability — ${row.name}`,
                    description: `<p>Sprint delivery consistency for <strong>${Auth.esc(row.name)}</strong>. Score = avg delivered / committed across recent closed sprints. 80%+ is healthy.</p>`,
                    details: [{ label: 'Avg predictability', value: sq.predictability !== null ? `${sq.predictability}%` : '—' }],
                    sources: (sq.sprints ?? []).map(sp => {
                        const rate = sp.planned > 0 ? Math.round(sp.delivered / sp.planned * 100) : null;
                        return {
                            label: sp.period,
                            value: `${sp.delivered} / ${sp.planned} stories`,
                            tag:   rate !== null ? `${rate}%` : '—',
                            tagVariant: rate === null ? 'neutral' : rate >= 80 ? 'success' : rate >= 60 ? 'warning' : 'danger',
                        };
                    }),
                };
            }

            case 'w6': {
                const v = (p?.signal_velocity ?? []).find(v => v.instance_id === row.id);
                if (!v) return null;
                const gap = v.avg_traced_lead_time;
                const sources = [];
                (v.signal_pairs ?? []).filter(pair => pair.lead_time_days != null).forEach(pair => {
                    const jiraKey   = pair.externalId ?? 'Precede';
                    const ltVariant = pair.lead_time_days <= 30 ? 'success' : 'warning';
                    const bodyLines = [
                        pair.externalId ? `Jira: ${pair.externalId}` : '',
                        `Lead time: ${pair.lead_time_days} days`,
                        pair.resolved_at ? `Completed: ${pair.resolved_at.slice(0, 10)}` : '',
                    ];
                    pair.signals.forEach(sig => {
                        bodyLines.push('');
                        bodyLines.push(`Signal date: ${sig.date ?? '—'}`);
                        bodyLines.push(sig.body || '(no content)');
                    });
                    sources.push({
                        label:      `${jiraKey} · ${pair.title || '(untitled)'}`,
                        value:      `${pair.lead_time_days}d lead time`,
                        tag:        'Story',
                        tagVariant: ltVariant,
                        body:       bodyLines.filter(Boolean).join('\n'),
                    });
                });
                return {
                    label: `${row.name} · Response Lead Time`,
                    title: `Response Lead Time — ${row.name}`,
                    description: `<p>Precede-created stories and the Hub signals that triggered them.</p>`,
                    details: [
                        { label: 'Avg lead time',    value: gap != null ? `${gap} days` : '—' },
                        { label: 'Traced stories',   value: String(v.traced_count ?? 0) },
                        { label: 'Signals captured', value: String(v.signal_count) },
                    ],
                    sources,
                };
            }

            case 'w7': {
                const epics = (p?.epic_health ?? []).filter(e => e.instance_name === row.name);
                if (!epics.length) return null;
                return {
                    label: `${row.name} · Portfolio Risk`,
                    title: `Epic Health — ${row.name}`,
                    description: `<p>All active epics for <strong>${Auth.esc(row.name)}</strong>. At risk = below 40% complete. Watch = 40–80%. Good = above 80%.</p>`,
                    details: [],
                    sources: epics.map(e => ({
                        label: e.epic,
                        value: `${e.done}/${e.total} stories`,
                        tag:   e.health === 'good' ? 'Good' : e.health === 'watch' ? 'Watch' : 'At risk',
                        tagVariant: e.health === 'good' ? 'success' : e.health === 'watch' ? 'warning' : 'danger',
                    })),
                };
            }

            default: return null;
        }
    }

    function _drillDownConfig(id) {
        const s = _data.strategic;
        const p = _data.pulse;
        const f = _data.forward;

        switch (id) {

            case 'w0': {
                const cs = _data.currentSprint;
                if (!cs?.sprint) return null;
                const instances = cs.instances ?? [];
                const totalDone  = instances.reduce((a, i) => a + i.done,  0);
                const totalStory = instances.reduce((a, i) => a + i.total, 0);
                const overallPct = totalStory > 0 ? Math.round(totalDone / totalStory * 100) : 0;
                return {
                    label: 'Widget 0 · Sprint in Progress',
                    title: `Current Sprint — ${Auth.esc(cs.sprint.name)}`,
                    description: `<p>Live snapshot of the active sprint across all squads. Stories done vs committed, signals captured, and epics with movement. No scores — the sprint isn't done yet.</p>`,
                    details: [
                        { label: 'Overall completion', value: `${overallPct}%` },
                        { label: 'Total stories done',  value: `${totalDone} / ${totalStory}` },
                        { label: 'Squads tracked',      value: String(instances.length) },
                    ],
                    sources: instances.map(inst => {
                        const pct = inst.total > 0 ? Math.round(inst.done / inst.total * 100) : 0;
                        return {
                            label: inst.instance_name,
                            value: `${inst.done}/${inst.total} stories`,
                            tag:   `${pct}%`,
                            tagVariant: pct >= 80 ? 'success' : pct >= 50 ? 'warning' : 'danger',
                        };
                    }),
                };
            }

            case 'w1a': {
                const trend = s?.okr_trend ?? [];
                const byInst = {};
                for (const r of trend) {
                    if (!byInst[r.instance_id]) byInst[r.instance_id] = { name: r.instance_name, points: [] };
                    byInst[r.instance_id].points.push(r);
                }
                const avg = trend.length
                    ? Math.round(trend.reduce((a, r) => a + r.score, 0) / trend.length)
                    : null;
                return {
                    label: 'Widget 1A · Strategic Alignment',
                    title: 'OKR Alignment Trend',
                    description: `<p>Tracks the average OKR alignment score across all PM workspaces over the last 6 sprints. A <strong>rising trend</strong> means teams are staying strategically focused — scores above 70% indicate strong alignment. Scores below 50% are an early warning of drift.</p>
                        <p>Each bar represents one sprint snapshot from a Radar analysis. The height reflects what percentage of backlog signals and stories were traceable back to a defined OKR.</p>`,
                    details: avg !== null ? [{ label: 'Overall average', value: `${avg}%` }] : [],
                    sources: Object.values(byInst).flatMap(inst =>
                        inst.points.slice(-3).map(p => ({
                            label: `${inst.name} · ${p.sprint}`,
                            value: `${p.score}%`,
                            tag:   p.score >= 70 ? 'Aligned' : p.score >= 50 ? 'Watch' : 'At risk',
                            tagVariant: p.score >= 70 ? 'success' : p.score >= 50 ? 'warning' : 'danger',
                        }))
                    ),
                };
            }

            case 'w1b': {
                const objectives = s?.okr_objectives ?? [];
                return {
                    label: 'Widget 1B · Strategic Alignment',
                    title: 'OKR Objectives by Workspace',
                    description: `<p>Shows each PM's active quarterly objectives. Divergences between PM OKRs and executive goals are strategic signals — they don't mean a PM is misaligned, but they often warrant a conversation about priority sequencing.</p>
                        <p>Objectives are defined in each PM's Settings and linked during Radar analysis to assess backlog alignment.</p>`,
                    sources: objectives.map(o => ({
                        label: o.instance_name,
                        tag:   o.objectives ? 'Defined' : 'Missing',
                        tagVariant: o.objectives ? 'success' : 'danger',
                    })),
                };
            }


            case 'w4': {
                const focusGuard = s?.focus_guard ?? [];
                const storyBody = (stories) => {
                    if (!stories?.length) return null;
                    return stories.map(s => s.jiraKey ? `[${s.jiraKey}] ${s.title}` : s.title).join('\n');
                };
                const CATS = [
                    { key: 'new_value',   label: 'New Value'  },
                    { key: 'maintenance', label: 'Maintenance' },
                    { key: 'tech_debt',   label: 'Tech Debt'   },
                ];
                const catTagVariant = (key, pct) => {
                    if (key === 'new_value')   return pct >= 60 ? 'success' : pct >= 40 ? 'warning' : 'danger';
                    return pct <= 20 ? 'success' : pct <= 35 ? 'warning' : 'danger';
                };
                const sources = [];
                for (const f of focusGuard.filter(f => f.sprints?.length > 0)) {
                    for (const sp of f.sprints) {
                        const sprintLabel = sp.name ? `${f.instance_name} · ${sp.name}${sp.is_current ? ' (current)' : ''}` : f.instance_name;
                        const cats = sp.stories_by_category ?? {};
                        for (const c of CATS) {
                            const list = cats[c.key] ?? [];
                            const pct  = sp[`${c.key}_pct`] ?? 0;
                            sources.push({
                                label: `${sprintLabel} · ${c.label}`,
                                value: `${list.length} stor${list.length === 1 ? 'y' : 'ies'} · ${pct}%`,
                                tag:   pct + '%',
                                tagVariant: catTagVariant(c.key, pct),
                                body:  storyBody(list) ?? undefined,
                            });
                        }
                    }
                }
                return {
                    label: 'Widget 4 · Strategic Alignment',
                    title: 'Resource Allocation',
                    description: `<p>Shows how each squad distributed effort across new-value features, maintenance, and tech debt for the <strong>last 3 completed sprints</strong>. The active sprint is excluded — partial data biases the view. A squad spending less than 40% on new value is being pulled away from roadmap goals.</p>
                        <p>Target: 60%+ new value. Click any row to expand the list of stories in that category.</p>`,
                    details: [],
                    sources,
                };
            }

            case 'w6': {
                const squads = p?.signal_velocity ?? [];
                const sources = [];
                squads.filter(v => v.signal_count > 0).forEach(v => {
                    (v.signal_pairs ?? []).filter(pair => pair.lead_time_days != null).forEach(pair => {
                        const jiraKey   = pair.externalId ?? 'Precede';
                        const ltVariant = pair.lead_time_days <= 30 ? 'success' : 'warning';
                        const bodyLines = [
                            pair.externalId ? `Jira: ${pair.externalId}` : '',
                            `Lead time: ${pair.lead_time_days} days`,
                            pair.resolved_at ? `Completed: ${pair.resolved_at.slice(0, 10)}` : '',
                        ];
                        pair.signals.forEach(sig => {
                            bodyLines.push('');
                            bodyLines.push(`Signal date: ${sig.date ?? '—'}`);
                            bodyLines.push(sig.body || '(no content)');
                        });
                        sources.push({
                            label:      `[${v.instance_name}] ${jiraKey} · ${pair.title || '(untitled)'}`,
                            value:      `${pair.lead_time_days}d lead time`,
                            tag:        'Story',
                            tagVariant: ltVariant,
                            body:       bodyLines.filter(Boolean).join('\n'),
                        });
                    });
                });
                return {
                    label: 'Widget 6 · Team Pulse',
                    title: 'Response Lead Time',
                    description: `<p>Tracks how long it takes each squad to act on captured signals. Delivered Precede stories show the traced lead time from signal capture to resolution. Recent Hub entries are shown as signal sources.</p>
                        <p>A gap over 30 days per squad means feedback is being captured but not actioned in the backlog.</p>`,
                    details: squads.filter(v => v.signal_count > 0).map(v => ({
                        label: v.instance_name,
                        value: v.avg_traced_lead_time != null ? `${v.avg_traced_lead_time}d avg` : '—',
                    })),
                    sources: sources.length > 0 ? sources : squads.filter(v => v.signal_count > 0).map(v => ({
                        label:      v.instance_name,
                        value:      v.avg_traced_lead_time != null ? `${v.avg_traced_lead_time}d avg` : '—',
                        tag:        v.avg_traced_lead_time === null ? 'No data' : v.avg_traced_lead_time <= 30 ? 'Healthy' : 'Slow',
                        tagVariant: v.avg_traced_lead_time === null ? 'neutral' : v.avg_traced_lead_time <= 30 ? 'success' : 'warning',
                    })),
                };
            }

            case 'w7': {
                const epics = p?.epic_health ?? [];
                return {
                    label: 'Widget 7 · Team Pulse',
                    title: 'Portfolio Risk Monitor',
                    description: `<p>Shows the health of active epics <strong>per squad</strong>. At risk epics have stalled story completion (below 40% done). Watch epics are progressing but need monitoring. Good epics are above 80% complete.</p>
                        <p>Health is scored from the ratio of completed to total stories. A squad with multiple at-risk epics may need scope reduction or re-prioritisation.</p>`,
                    details: [],
                    sources: epics.map(e => ({
                        label: `${e.epic} · ${e.instance_name}`,
                        value: `${e.done}/${e.total}`,
                        tag: e.health === 'good' ? 'Good' : e.health === 'watch' ? 'Watch' : 'At risk',
                        tagVariant: e.health === 'good' ? 'success' : e.health === 'watch' ? 'warning' : 'danger',
                    })),
                };
            }

            case 'w8': {
                const timeline = f?.predictive_timeline ?? [];
                return {
                    label: 'Widget 8 · Forward Look',
                    title: 'Predictive Timeline',
                    description: `<p>Projects when active epics will complete based on each team's <strong>historical delivery velocity</strong> — not just story count. Projections account for carry-over rate, scope creep patterns, and priority share of the team's capacity.</p>
                        <p>The range shown reflects a confidence interval: the faded portion is the best case, the solid end is the worst case. Wider bars mean lower confidence due to inconsistent velocity history.</p>`,
                    sources: timeline.map(e => ({
                        label: `${e.epic} · ${e.instance_name}`,
                        value: e.target_sprint_label ?? `~${e.sprints_remaining} sprints`,
                        tag:   e.sprints_remaining <= 3 ? 'Soon' : e.sprints_remaining <= 8 ? 'Mid-term' : 'Long-term',
                        tagVariant: e.sprints_remaining <= 3 ? 'success' : e.sprints_remaining <= 8 ? 'info' : 'neutral',
                    })),
                };
            }

            case 'w9': {
                const syn = _data.synthesis;
                if (!syn?.synthesis || syn.synthesis.generation_error) return null;
                const s = syn.synthesis;
                const urgencyLabels = { this_sprint: 'This Sprint', next_sprint: 'Next Sprint', this_quarter: 'This Quarter' };
                const outcomeLabels = { on_track: 'On Track', at_risk: 'At Risk', off_track: 'Off Track' };
                const sources = [];
                (s.where_to_intervene ?? []).forEach(item => {
                    sources.push({
                        label: item.title ?? 'Intervention',
                        tag:   urgencyLabels[item.urgency] ?? item.urgency,
                        tagVariant: item.urgency === 'this_sprint' ? 'danger' : item.urgency === 'next_sprint' ? 'warning' : 'info',
                        body:  `${item.why_exec ?? ''}\n→ ${item.suggested_action ?? ''}`,
                    });
                });
                if (s.quarter_outlook) {
                    sources.push({
                        label: 'Quarter Outlook',
                        tag:   outcomeLabels[s.quarter_outlook.assessment] ?? s.quarter_outlook.assessment,
                        tagVariant: s.quarter_outlook.assessment === 'on_track' ? 'success' : s.quarter_outlook.assessment === 'off_track' ? 'danger' : 'warning',
                        body:  `${s.quarter_outlook.rationale ?? ''}\nKey dependency: ${s.quarter_outlook.key_dependency ?? ''}`,
                    });
                }
                return {
                    label: `Strategic Briefing · ${syn.sprint_name ?? ''}`,
                    title: `Strategic Briefing — ${syn.sprint_name ?? ''}`,
                    description: s.executive_pulse ? `<p>${Auth.esc(s.executive_pulse)}</p>` : undefined,
                    details: syn.generated_at ? [{ label: 'Generated', value: new Date(syn.generated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }] : [],
                    sources,
                };
            }

            case 'w10': {
                const decisions = f?.decisions_required ?? [];
                const risks     = f?.risks ?? [];
                return {
                    label: 'Widget 10 · Forward Look',
                    title: 'Operational Signals & Decisions',
                    description: `<p>Decisions that require executive input or PM action — <strong>auto-detected</strong> from threshold breaches, PM-escalated blockers, or milestones at risk. High-priority risks (OKR threats, churn, revenue impact) are elevated here automatically.</p>
                        <p>Each item includes a suggested action. Ignored decisions escalate in severity after 2 sprints.</p>`,
                    sources: [
                        ...risks.filter(r => r.severity === 'critical').map(r => ({
                            label: r.description.slice(0, 70) + (r.description.length > 70 ? '…' : ''),
                            tag: 'Risk · Critical',
                            tagVariant: 'danger',
                        })),
                        ...decisions.map(d => ({
                            label: d.description.slice(0, 70) + (d.description.length > 70 ? '…' : ''),
                            tag:   d.severity === 'critical' ? 'Critical' : d.severity === 'warning' ? 'Warning' : 'Watch',
                            tagVariant: d.severity === 'critical' ? 'danger' : d.severity === 'warning' ? 'warning' : 'info',
                        })),
                    ],
                };
            }

            default: return null;
        }
    }

    // ── Utilities ─────────────────────────────────────────────────────────────

    function _emptyState(icon, title, message) {
        return `<div class="empty-state">
            <span class="empty-icon">${icon}</span>
            <strong style="font-size:0.8rem;color:var(--color-text-primary);font-weight:700;">${title}</strong>
            <p>${message}</p>
        </div>`;
    }

    // ── Public API ────────────────────────────────────────────────────────────

    async function testSynthesis(btn) {
        const w9body = document.getElementById('w9-body');
        if (w9body) w9body.innerHTML = '<div class="skeleton" style="height:90px;"></div>';
        if (btn) { btn.disabled = true; btn.textContent = '⏳ Generating…'; }
        try {
            const res = await Auth.fetch('/api/exec/synthesis?force=1');
            const synthesis = res.ok ? await res.json() : null;
            if (synthesis) { _data.synthesis = synthesis; _renderW9(synthesis); }
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = '🧠 Test AI'; }
        }
    }

    return { init, refresh, testSynthesis, drillDown: _openDrillDown };

})();

// Auto-start
ExecDashboard.init();

// ── Exec widget tooltips ──────────────────────────────────────────────────────

const EXEC_TIPS = {
    'w0':  'Live snapshot of the current sprint in progress. Shows stories delivered vs committed, signals captured, and epics with movement — per squad. No scores here: the sprint isn\'t done yet. This widget updates on every Refresh.',
    'w9':  'Generated by Claude once per sprint from completed sprint data across all PM workspaces. Cached — does not regenerate on Refresh. Updates automatically when the next sprint closes.',
    'w1a': 'Tracks the average OKR alignment score across all your PM workspaces over the last 6 sprints. A rising trend means your teams are staying strategically focused; a decline is an early warning of drift.',
    'w1b': 'Compares each PM\'s OKRs against the executive OKRs to surface divergences. Gaps here are strategic signals — they don\'t mean a PM is wrong, but they may warrant a conversation about priorities.',
    'w4':  'Shows how each squad distributed effort across new features, maintenance, and tech debt over the last 3 completed sprints. The current sprint is excluded — partial data has no strategic value. Squads below 40% new value may be over-rotated on reactive work.',
    'w5':  'Measures each squad\'s sprint predictability across completed sprints — the ratio of stories delivered vs committed. The current active sprint is excluded to prevent partial data from skewing scores. Below 60% signals planning instability or scope creep.',
    'w6':  'Shows the lead time between a signal entering the Hub and related stories being delivered, per squad. A gap over 30 days means feedback is aging faster than delivery.',
    'w7':  'Shows epic health per squad — how many epics are on track, need watching, or are at risk. Squads with multiple at-risk epics may need scope or capacity decisions.',
    'w8':  'Projects when active epics will complete based on each team\'s historical delivery patterns. Confidence intervals are shown — solid bar = worst case, faded = best case.',
    'w10': 'Decisions and high-priority risks that require executive input or PM action — auto-detected from threshold breaches, PM-escalated blockers, milestones at risk, or OKR/churn signals.',
};

const _execTipEl = document.getElementById('exec-tooltip');

function _execShowTip(e, text) {
    _execTipEl.textContent = text;
    _execTipEl.style.display = 'block';
    _execMoveTip(e);
}
function _execMoveTip(e) {
    const x = Math.min(e.clientX + 14, window.innerWidth - _execTipEl.offsetWidth - 12);
    const y = Math.max(e.clientY - _execTipEl.offsetHeight - 10, 8);
    _execTipEl.style.left = x + 'px';
    _execTipEl.style.top  = y + 'px';
}
function _execHideTip() { _execTipEl.style.display = 'none'; }

function _execAddTipIcon(label, widgetId) {
    if (!label || label.querySelector('.tip-icon')) return;
    const tip  = EXEC_TIPS[widgetId] || '';
    if (!tip) return;
    const icon = document.createElement('span');
    icon.className   = 'tip-icon';
    icon.textContent = 'ⓘ';
    icon.addEventListener('mouseenter', e => _execShowTip(e, tip));
    icon.addEventListener('mousemove',  _execMoveTip);
    icon.addEventListener('mouseleave', _execHideTip);
    label.appendChild(icon);
}

// All exec widgets have dynamic content — watch with MutationObserver
['w0','w1a','w1b','w4','w5','w6','w7','w8','w9','w10'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    new MutationObserver(() => {
        _execAddTipIcon(el.querySelector('.widget-label'), id);
    }).observe(el, { childList: true, subtree: true });
    _execAddTipIcon(el.querySelector('.widget-label'), id);
});

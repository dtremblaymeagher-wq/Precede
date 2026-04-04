// dashboard-exec.js
// Executive Dashboard — data fetching + widget rendering.
// All exec logic is isolated here (never imported by PM pages).
//
// Architecture note (V2 migration path):
//   All data comes from /api/exec/* routes which aggregate PM instances.
//   To support multi-account exec in V2, only the server routes need updating.

const ExecDashboard = (() => {

    const FIRST_VIEW_KEY = 'execDashboardFirstViewAt';

    // Stores latest API data for drill-down access
    let _data = { strategic: null, pulse: null, forward: null };

    // ── Bootstrap ────────────────────────────────────────────────────────────

    async function init() {
        const ok = await Auth.requireAuth();
        if (!ok) return;

        _checkFreePreview();
        await _loadAll();
    }

    async function refresh() {
        // Reset all widgets to loading state
        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].forEach(n => {
            const body = document.getElementById(`w${n}-body`);
            if (body) body.innerHTML = `<div class="skeleton" style="height:${n >= 8 ? 140 : 110}px;"></div>`;
        });
        await _loadAll();
    }

    async function _loadAll() {
        try {
            // Fetch PM instance list first (for header)
            const pmRes       = await Auth.fetch('/api/exec/instances');
            const pmInstances = pmRes.ok ? await pmRes.json() : [];
            _renderHeader(pmInstances);

            // Fetch all three sections in parallel
            const [strategic, pulse, forward] = await Promise.all([
                Auth.fetch('/api/exec/strategic').then(r => r.ok ? r.json() : null),
                Auth.fetch('/api/exec/pulse').then(r => r.ok ? r.json() : null),
                Auth.fetch('/api/exec/forward').then(r => r.ok ? r.json() : null),
            ]);

            if (strategic) { _data.strategic = strategic; _renderStrategic(strategic); }
            if (pulse)     { _data.pulse     = pulse;     _renderPulse(pulse);         }
            if (forward)   { _data.forward   = forward;   _renderForward(forward);     }

            _attachDrillDownHandlers();

            document.getElementById('exec-last-updated').textContent =
                'Updated ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        } catch (e) {
            console.error('[ExecDashboard] Load failed:', e);
        }
    }

    // ── Free preview rule ─────────────────────────────────────────────────────

    function _checkFreePreview() {
        // Team plan has unlimited access — no preview restriction
        if ((localStorage.getItem('precede_plan') || 'free') === 'team') return;

        const stored = localStorage.getItem(FIRST_VIEW_KEY);
        if (!stored) {
            // First view — record timestamp
            localStorage.setItem(FIRST_VIEW_KEY, new Date().toISOString());
            return;
        }
        // Subsequent views on Free/Pro — show outdated banner
        const date    = new Date(stored).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
        const banner  = document.getElementById('preview-banner');
        const dateEl  = document.getElementById('preview-date');
        if (banner) banner.style.display = 'flex';
        if (dateEl) dateEl.textContent   = date;
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

    // ── Section 1: Strategic Alignment ───────────────────────────────────────

    function _renderStrategic(data) {
        _renderW1A(data.okr_trend ?? []);
        _renderW1B(data.okr_objectives ?? []);
        _renderW2(data.signal_coverage ?? []);
        _renderW3(data.vision_drift);
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
            const bars = inst.points.map(p => {
                const color = p.score >= 70 ? 'var(--color-accent)' : p.score >= 50 ? 'var(--color-warning)' : 'var(--color-danger)';
                return `<div style="display:flex;flex-direction:column;align-items:center;gap:4px;flex:1;">
                    <div style="font-size:0.65rem;font-weight:700;color:${color};">${p.score}%</div>
                    <div style="width:100%;background:var(--color-accent-subtle);border-radius:4px;height:40px;position:relative;overflow:hidden;">
                        <div style="position:absolute;bottom:0;width:100%;height:${p.score}%;background:${color};border-radius:4px;transition:height 0.5s;"></div>
                    </div>
                    <div style="font-size:0.55rem;color:var(--color-text-muted);text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:52px;">${p.sprint}</div>
                </div>`;
            }).join('');
            return `<div style="margin-bottom:16px;">
                <div style="font-size:0.7rem;font-weight:700;color:var(--color-accent);margin-bottom:8px;">${Auth.esc(inst.name)}</div>
                <div style="display:flex;gap:6px;align-items:flex-end;">${bars}</div>
            </div>`;
        }).join('');
        el.innerHTML = rows;
    }

    // Widget 1B — OKR Vertical Alignment
    function _renderW1B(objectives) {
        const el = document.getElementById('w1b-body');
        if (!el) return;
        if (!objectives.length || objectives.every(o => !o.objectives)) {
            el.innerHTML = _emptyState('🎯', 'No OKRs defined', 'Add quarterly objectives in Settings to see PM alignment.');
            return;
        }
        el.innerHTML = objectives.map(o => `
            <div style="margin-bottom:14px;">
                <div style="font-size:0.68rem;font-weight:800;color:var(--color-accent);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:4px;">${Auth.esc(o.instance_name)}</div>
                <div style="font-size:0.78rem;color:var(--color-text-primary);line-height:1.5;white-space:pre-wrap;">${Auth.esc(o.objectives ?? '—')}</div>
            </div>`).join('');
    }

    // Widget 2 — Signal Coverage Rate
    function _renderW2(coverage) {
        const el = document.getElementById('w2-body');
        if (!el) return;
        if (!coverage.length) {
            el.innerHTML = _emptyState('📡', 'No coverage data', 'Run a Radar analysis to calculate signal coverage.');
            return;
        }
        const latest = coverage[0];
        const score  = latest.score ?? 0;
        const color  = score >= 70 ? 'var(--color-accent)' : score >= 50 ? 'var(--color-warning)' : 'var(--color-danger)';
        el.innerHTML = `
            <div style="display:flex;align-items:center;gap:16px;margin-bottom:14px;">
                <div class="score-ring" style="background:${color}18;color:${color};border:2px solid ${color}40;">
                    ${score}%
                </div>
                <div>
                    <div style="font-size:0.78rem;font-weight:700;color:var(--color-text-primary);">${latest.instance_name}</div>
                    <div style="font-size:0.7rem;color:var(--color-text-muted);">${latest.sprint}</div>
                </div>
            </div>
            <div class="progress-track"><div class="progress-fill" style="width:${score}%;background:${color};"></div></div>`;
    }

    // Widget 3 — Vision Drift Indicator
    function _renderW3(drift) {
        const el = document.getElementById('w3-body');
        if (!el) return;
        if (!drift || drift.score === null) {
            el.innerHTML = _emptyState('🧭', 'No drift data', 'Vision drift is calculated from radar OKR scores over time.');
            return;
        }
        const trendIcon  = drift.trend === 'improving' ? '↗' : drift.trend === 'declining' ? '↘' : '→';
        const trendColor = drift.trend === 'improving' ? 'var(--color-success)' : drift.trend === 'declining' ? 'var(--color-danger)' : 'var(--color-warning)';
        el.innerHTML = `
            <div style="display:flex;align-items:center;gap:14px;">
                <div class="score-ring" style="background:var(--color-accent-subtle);color:var(--color-accent);border:2px solid var(--color-accent-border);">
                    ${drift.score}%
                </div>
                <div>
                    <div style="font-size:1.1rem;font-weight:900;color:${trendColor};">${trendIcon} ${drift.trend}</div>
                    <div style="font-size:0.7rem;color:var(--color-text-muted);margin-top:2px;">Based on last ${drift.history?.length ?? 0} analyses</div>
                </div>
            </div>`;
    }

    // Widget 4 — Focus Guard Trend
    function _renderW4(focusGuard) {
        const el = document.getElementById('w4-body');
        if (!el) return;
        if (!focusGuard.length) {
            el.innerHTML = _emptyState('🛡', 'No backlog data', 'Add stories to your backlog to see focus distribution.');
            return;
        }
        const latest = focusGuard[focusGuard.length - 1];
        
        // Check if team data is available
        if (latest.teams && Object.keys(latest.teams).length > 0) {
            const teamRows = Object.entries(latest.teams).map(([teamName, teamData]) => `
                <div style="margin-bottom:12px;padding:8px;background:var(--color-bg-surface);border-radius:6px;border:1px solid var(--color-border);">
                    <div style="display:flex;justify-content:space-between;font-size:0.7rem;margin-bottom:8px;font-weight:600;color:var(--color-text-primary);">
                        <span>${teamName}</span>
                        <span style="color:var(--color-text-muted);">${teamData.total || 0} items</span>
                    </div>
                    <div style="margin-bottom:6px;">
                        <div style="display:flex;justify-content:space-between;font-size:0.65rem;margin-bottom:2px;">
                            <span style="color:var(--color-accent);">New</span><span style="color:var(--color-accent);">${teamData.new_pct || 0}%</span>
                        </div>
                        <div class="progress-track"><div class="progress-fill" style="width:${teamData.new_pct || 0}%;background:var(--color-accent);"></div></div>
                    </div>
                    <div style="margin-bottom:6px;">
                        <div style="display:flex;justify-content:space-between;font-size:0.65rem;margin-bottom:2px;">
                            <span style="color:var(--color-warning);">Maintenance</span><span style="color:var(--color-warning);">${teamData.maintenance_pct || 0}%</span>
                        </div>
                        <div class="progress-track"><div class="progress-fill" style="width:${teamData.maintenance_pct || 0}%;background:var(--color-warning);"></div></div>
                    </div>
                    <div>
                        <div style="display:flex;justify-content:space-between;font-size:0.65rem;margin-bottom:2px;">
                            <span style="color:var(--color-text-muted);">Tech debt</span><span style="color:var(--color-text-muted);">${teamData.tech_debt_pct || 0}%</span>
                        </div>
                        <div class="progress-track"><div class="progress-fill" style="width:${teamData.tech_debt_pct || 0}%;background:var(--color-text-muted);"></div></div>
                    </div>
                </div>
            `).join('');
            
            el.innerHTML = `
                <div style="margin-bottom:10px;">
                    <div style="display:flex;justify-content:space-between;font-size:0.7rem;margin-bottom:3px;">
                        <span style="color:var(--color-accent);font-weight:600;">Overall Distribution</span>
                    </div>
                </div>
                ${teamRows}`;
        } else {
            // Fallback to original display if no team data
            el.innerHTML = `
                <div style="margin-bottom:10px;">
                    <div style="display:flex;justify-content:space-between;font-size:0.7rem;margin-bottom:3px;">
                        <span style="color:var(--color-accent);font-weight:600;">New value</span><span style="color:var(--color-accent);">${latest.new_value_pct}%</span>
                    </div>
                    <div class="progress-track"><div class="progress-fill" style="width:${latest.new_value_pct}%;background:var(--color-accent);"></div></div>
                </div>
                <div style="margin-bottom:10px;">
                    <div style="display:flex;justify-content:space-between;font-size:0.7rem;margin-bottom:3px;">
                        <span style="color:var(--color-warning);font-weight:600;">Maintenance</span><span style="color:var(--color-warning);">${latest.maintenance_pct}%</span>
                    </div>
                    <div class="progress-track"><div class="progress-fill" style="width:${latest.maintenance_pct}%;background:var(--color-warning);"></div></div>
                </div>
                <div>
                    <div style="display:flex;justify-content:space-between;font-size:0.7rem;margin-bottom:3px;">
                        <span style="color:var(--color-text-muted);font-weight:600;">Tech debt</span><span style="color:var(--color-text-muted);">${latest.tech_debt_pct}%</span>
                    </div>
                    <div class="progress-track"><div class="progress-fill" style="width:${latest.tech_debt_pct}%;background:var(--color-text-muted);"></div></div>
                </div>`;
        }
    }

    // ── Section 2: Team Pulse ─────────────────────────────────────────────────

    function _renderPulse(data) {
        _renderW5(data.scope_drift ?? []);
        _renderW6(data.signal_velocity);
        _renderW7(data.epic_health ?? []);
    }

    // Widget 5 — Sprint Scope Drift
    function _renderW5(scopeDrift) {
        const el = document.getElementById('w5-body');
        if (!el) return;
        if (!scopeDrift.length) {
            el.innerHTML = _emptyState('📊', 'No sprint data', 'Sprint scope data will appear once stories are added to your backlog.');
            return;
        }
        const rows = scopeDrift.slice(-4).map(b => {
            const total = Math.max(b.planned + b.added + b.delivered, 1);
            return `<div style="margin-bottom:10px;">
                <div style="display:flex;justify-content:space-between;font-size:0.65rem;color:var(--color-text-muted);margin-bottom:3px;">
                    <span>${b.period}</span>
                    <span>${b.delivered} delivered · ${b.added} added mid-sprint</span>
                </div>
                <div style="display:flex;gap:2px;height:6px;border-radius:9999px;overflow:hidden;">
                    <div style="flex:${b.delivered};background:var(--color-accent);"></div>
                    <div style="flex:${b.planned};background:var(--color-accent-subtle);"></div>
                    <div style="flex:${b.added};background:var(--color-warning);"></div>
                </div>
            </div>`;
        }).join('');
        el.innerHTML = rows + `<div style="display:flex;gap:12px;margin-top:4px;font-size:0.62rem;color:var(--color-text-muted);">
            <span style="color:var(--color-accent);">● Delivered</span><span style="color:var(--color-accent-subtle);">▬ Planned</span><span style="color:var(--color-warning);">● Added</span>
        </div>`;
    }

    // Widget 6 — Signal to Delivery Velocity
    function _renderW6(velocity) {
        const el = document.getElementById('w6-body');
        if (!el) return;
        if (!velocity || velocity.signal_count === 0) {
            el.innerHTML = _emptyState('⚡', 'No signals yet', 'Add signals to the Intelligence Hub to track delivery velocity.');
            return;
        }
        const gap = velocity.velocity_gap_days;
        el.innerHTML = `
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
                <div style="text-align:center;padding:12px;background:var(--color-accent-subtle);border-radius:10px;">
                    <div style="font-size:1.4rem;font-weight:900;color:var(--color-accent);">${velocity.avg_signal_age_days ?? '—'}</div>
                    <div style="font-size:0.65rem;color:var(--color-text-muted);margin-top:2px;">avg signal age (days)</div>
                </div>
                <div style="text-align:center;padding:12px;background:var(--color-success-subtle);border-radius:10px;">
                    <div style="font-size:1.4rem;font-weight:900;color:var(--color-success);">${velocity.avg_delivery_age_days ?? '—'}</div>
                    <div style="font-size:0.65rem;color:var(--color-text-muted);margin-top:2px;">avg delivery age (days)</div>
                </div>
            </div>
            ${gap !== null ? `<div style="margin-top:12px;font-size:0.75rem;color:${gap > 30 ? 'var(--color-danger)' : 'var(--color-success)'};font-weight:600;text-align:center;">
                Gap: ${gap} days ${gap > 30 ? '⚠️ Signals aging faster than delivery' : '✓ Healthy velocity'}
            </div>` : ''}`;
    }

    // Widget 7 — Epic Health
    function _renderW7(epics) {
        const el = document.getElementById('w7-body');
        if (!el) return;
        if (!epics.length) {
            el.innerHTML = _emptyState('🗂', 'No epics found', 'Stories with epic labels will appear here once added to your backlog.');
            return;
        }
        el.innerHTML = epics.slice(0, 5).map(e => {
            const badge = e.health === 'good' ? 'badge-good' : e.health === 'watch' ? 'badge-warning' : 'badge-critical';
            const label = e.health === 'good' ? 'Good' : e.health === 'watch' ? 'Watch' : 'At risk';
            return `<div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid var(--color-accent-subtle);">
                <div style="flex:1;min-width:0;">
                    <div style="font-size:0.78rem;font-weight:600;color:var(--color-text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${Auth.esc(e.epic)}</div>
                    <div style="font-size:0.65rem;color:var(--color-text-muted);">${Auth.esc(e.instance_name)} · ${e.done}/${e.total} done</div>
                </div>
                <div style="flex-shrink:0;">
                    <span class="${badge}">${label}</span>
                </div>
            </div>`;
        }).join('');
    }

    // ── Section 3: Forward Look ───────────────────────────────────────────────

    function _renderForward(data) {
        _renderW8(data.predictive_timeline ?? []);
        _renderW9(data.risks ?? []);
        _renderW10(data.decisions_required ?? []);
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
                        <span style="font-size:0.82rem;font-weight:700;color:var(--color-text-primary);">${Auth.esc(e.epic)}</span>
                        <span style="font-size:0.65rem;color:var(--color-text-muted);margin-left:6px;">${Auth.esc(e.instance_name)}</span>
                    </div>
                    <span style="font-size:0.7rem;font-weight:700;color:var(--color-accent);">${e.target_sprint_label ?? `~${sprLabel}`}</span>
                </div>
                <div class="progress-track">
                    <div class="progress-fill" style="width:${pct}%;background:linear-gradient(90deg,var(--color-accent),var(--color-accent-subtle));"></div>
                </div>
                <div style="display:flex;justify-content:space-between;font-size:0.62rem;color:var(--color-text-muted);margin-top:3px;">
                    <span>${pct}% complete</span>
                    <span>${e.remaining} stories · ${e.points} pts remaining</span>
                </div>
            </div>`;
        }).join('');
    }

    // Widget 9 — Risk Trajectory
    function _renderW9(risks) {
        const el = document.getElementById('w9-body');
        if (!el) return;
        if (!risks.length) {
            el.innerHTML = _emptyState('🛡', 'No risks detected', 'Risks are extracted from your latest Radar analyses.');
            return;
        }
        el.innerHTML = risks.slice(0, 5).map(r => {
            const badge = r.severity === 'critical' ? 'badge-critical' : r.severity === 'high' ? 'badge-warning' : 'badge-good';
            const label = r.severity === 'critical' ? 'Critical' : r.severity === 'high' ? 'High' : 'Medium';
            return `<div style="padding:8px 0;border-bottom:1px solid var(--color-accent-subtle);">
                <div style="display:flex;align-items:flex-start;gap:8px;">
                    <span class="${badge}" style="flex-shrink:0;margin-top:1px;">${label}</span>
                    <div>
                        <div style="font-size:0.78rem;color:var(--color-text-primary);line-height:1.4;">${Auth.esc(r.description)}</div>
                        <div style="font-size:0.65rem;color:var(--color-text-muted);margin-top:2px;">${Auth.esc(r.instance_name)}</div>
                    </div>
                </div>
            </div>`;
        }).join('');
    }

    // Widget 10 — Decisions Required
    function _renderW10(decisions) {
        const el = document.getElementById('w10-body');
        if (!el) return;
        if (!decisions.length) {
            el.innerHTML = _emptyState('✅', 'No decisions required', 'Precede will flag decisions here when OKR alignment drops, risks escalate, or signal coverage falls below threshold.');
            return;
        }
        const severityStyle = {
            critical: { border: 'var(--color-danger-subtle)', bg: 'var(--color-danger-subtle)', badge: 'badge-critical', label: 'Critical' },
            warning:  { border: 'var(--color-warning-subtle)', bg: 'var(--color-warning-subtle)', badge: 'badge-warning',  label: 'Warning'  },
            watch:    { border: 'var(--color-info-subtle)', bg: 'var(--color-info-subtle)', badge: 'badge-watch',    label: 'Watch'    },
        };
        el.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px;">` +
            decisions.map(d => {
                const s = severityStyle[d.severity] ?? severityStyle.watch;
                return `<div style="padding:14px;border-radius:12px;border:1px solid ${s.border};background:${s.bg};">
                    <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
                        <span class="${s.badge}">${s.label}</span>
                        <span style="font-size:0.65rem;color:var(--color-text-muted);">${Auth.esc(d.instance_name)}</span>
                    </div>
                    <p style="font-size:0.78rem;font-weight:600;color:var(--color-text-primary);margin:0 0 6px;line-height:1.4;">${Auth.esc(d.description)}</p>
                    <p style="font-size:0.72rem;color:var(--color-text-secondary);margin:0;line-height:1.4;">→ ${Auth.esc(d.suggested_action)}</p>
                </div>`;
            }).join('') + '</div>';
    }

    // ── Drill-down panel ──────────────────────────────────────────────────────

    function _attachDrillDownHandlers() {
        ['w1a','w1b','w2','w3','w4','w5','w6','w7','w8','w9','w10'].forEach(id => {
            const el = document.getElementById(id);
            if (!el || el.dataset.ddBound) return;
            el.dataset.ddBound = '1';
            el.style.cursor = 'pointer';
            el.addEventListener('click', e => {
                // Don't open panel when clicking the tooltip ⓘ icon
                if (e.target.closest('.tip-icon')) return;
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

    function _drillDownConfig(id) {
        const s = _data.strategic;
        const p = _data.pulse;
        const f = _data.forward;

        switch (id) {

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

            case 'w2': {
                const coverage = s?.signal_coverage ?? [];
                const latest   = coverage[0];
                return {
                    label: 'Widget 2 · Strategic Alignment',
                    title: 'Signal Coverage Rate',
                    description: `<p>Measures what percentage of PM workspaces have <strong>enough Hub signals</strong> to support a meaningful Radar analysis. Low coverage means blind spots — strategic decisions are being made without sufficient user or market context.</p>
                        <p>Coverage is calculated from the ratio of categorized signals to backlog stories in the last active sprint window. A workspace needs at least 5 signals to reach reliable coverage.</p>`,
                    details: latest ? [{ label: 'Latest score', value: `${latest.score}% — ${latest.instance_name} (${latest.sprint})` }] : [],
                    sources: coverage.slice(0, 6).map(c => ({
                        label: `${c.instance_name} · ${c.sprint}`,
                        value: `${c.score}%`,
                        tag:   c.score >= 70 ? 'Good' : c.score >= 50 ? 'Watch' : 'Low',
                        tagVariant: c.score >= 70 ? 'success' : c.score >= 50 ? 'warning' : 'danger',
                    })),
                };
            }

            case 'w3': {
                const drift = s?.vision_drift;
                return {
                    label: 'Widget 3 · Strategic Alignment',
                    title: 'Vision Drift Indicator',
                    description: `<p>Detects how much the product vision has shifted over time relative to OKR alignment scores. A <strong>high drift score</strong> means direction has changed significantly without a recorded strategic decision — which erodes team alignment and makes backlog prioritisation inconsistent.</p>
                        <p>Drift is computed from the standard deviation of OKR alignment scores across the last 6 analyses. Stable teams show low variance; teams under strategic pressure show high variance.</p>`,
                    details: drift ? [
                        { label: 'Current score', value: `${drift.score}%` },
                        { label: 'Trend', value: drift.trend },
                    ] : [],
                    sources: (drift?.history ?? []).map((h, i) => ({
                        label: `Analysis ${i + 1}`,
                        value: `${h}%`,
                        tag:   h >= 70 ? 'Stable' : h >= 50 ? 'Watch' : 'Drifting',
                        tagVariant: h >= 70 ? 'success' : h >= 50 ? 'warning' : 'danger',
                    })),
                };
            }

            case 'w4': {
                const focusGuard = s?.focus_guard ?? [];
                const latest = focusGuard[focusGuard.length - 1];
                return {
                    label: 'Widget 4 · Strategic Alignment',
                    title: 'Focus Guard',
                    description: `<p>Shows the ratio of <strong>strategic new-value work</strong> vs reactive maintenance and tech debt across sprints. A declining Focus Guard means teams are spending more time firefighting and less time on planned objectives.</p>
                        <p>Target: 60%+ new value. Below 40% new value is a signal that the team is being pulled away from roadmap goals by operational pressure or unplanned requests.</p>`,
                    details: latest ? [
                        { label: 'New value', value: `${latest.new_value_pct ?? '—'}%` },
                        { label: 'Maintenance', value: `${latest.maintenance_pct ?? '—'}%` },
                        { label: 'Tech debt', value: `${latest.tech_debt_pct ?? '—'}%` },
                    ] : [],
                    sources: focusGuard.map(b => ({
                        label: b.period ?? 'Sprint',
                        value: `${b.new_value_pct ?? '—'}% new`,
                        tag:   (b.new_value_pct ?? 0) >= 60 ? 'Healthy' : (b.new_value_pct ?? 0) >= 40 ? 'Watch' : 'Low',
                        tagVariant: (b.new_value_pct ?? 0) >= 60 ? 'success' : (b.new_value_pct ?? 0) >= 40 ? 'warning' : 'danger',
                    })),
                };
            }

            case 'w5': {
                const drift = p?.scope_drift ?? [];
                return {
                    label: 'Widget 5 · Team Pulse',
                    title: 'Sprint Scope Drift',
                    description: `<p>Measures how much the sprint scope changed between commitment and delivery — stories added mid-sprint, removed, or carried over. <strong>High drift signals planning instability</strong> or external pressure overriding PM priorities.</p>
                        <p>A healthy sprint has less than 15% of its scope added mid-sprint. Consistently high drift often indicates stakeholder pressure bypassing backlog grooming, or stories that weren't Ready at sprint start.</p>`,
                    sources: drift.slice(-6).map(b => ({
                        label: b.period,
                        value: `${b.added} added`,
                        tag:   b.added <= 2 ? 'Stable' : b.added <= 5 ? 'Watch' : 'High drift',
                        tagVariant: b.added <= 2 ? 'success' : b.added <= 5 ? 'warning' : 'danger',
                    })),
                };
            }

            case 'w6': {
                const v = p?.signal_velocity;
                return {
                    label: 'Widget 6 · Team Pulse',
                    title: 'Signal → Delivery Velocity',
                    description: `<p>Tracks the time between a signal appearing in the Intelligence Hub and a related story being delivered. A <strong>growing delay</strong> suggests the feedback loop is slowing — user needs are being captured but not acted on.</p>
                        <p>Signal age is the average days between signal creation and today. Delivery age is the average days between a story's linked signal and its completion. A healthy gap is under 30 days.</p>`,
                    details: v ? [
                        { label: 'Avg signal age', value: `${v.avg_signal_age_days ?? '—'} days` },
                        { label: 'Avg delivery age', value: `${v.avg_delivery_age_days ?? '—'} days` },
                        { label: 'Gap', value: v.velocity_gap_days != null ? `${v.velocity_gap_days} days` : '—' },
                    ] : [],
                    sources: v ? [{
                        label: 'Signal count',
                        value: String(v.signal_count ?? '—'),
                        tag: (v.velocity_gap_days ?? 0) <= 30 ? 'Healthy' : 'Slow',
                        tagVariant: (v.velocity_gap_days ?? 0) <= 30 ? 'success' : 'warning',
                    }] : [],
                };
            }

            case 'w7': {
                const epics = p?.epic_health ?? [];
                return {
                    label: 'Widget 7 · Team Pulse',
                    title: 'Epic Health',
                    description: `<p>Summarises the health of active epics across all PM workspaces. <strong>At risk</strong> epics have high scope growth or stalled story completion. <strong>Watch</strong> epics are progressing but show early warning signs.</p>
                        <p>Health is scored from three signals: % stories completed, scope inflation rate (stories added vs planned), and sprint age (how long the epic has been active without closure).</p>`,
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
                const risks = f?.risks ?? [];
                return {
                    label: 'Widget 9 · Forward Look',
                    title: 'Risk Trajectory',
                    description: `<p>Extrapolates current risk trends <strong>3 sprints into the future</strong>. Shows what is likely to become critical if nothing changes — scope creep acceleration, OKR misses, or churn signals crossing the warning threshold.</p>
                        <p>Risks are extracted from Radar analyses and weighted by their trajectory: a risk that's been flagged 3 sprints in a row is escalated to Critical regardless of its initial severity.</p>`,
                    sources: risks.map(r => ({
                        label: `${r.description.slice(0, 60)}${r.description.length > 60 ? '…' : ''}`,
                        tag:   r.severity === 'critical' ? 'Critical' : r.severity === 'high' ? 'High' : 'Medium',
                        tagVariant: r.severity === 'critical' ? 'danger' : r.severity === 'high' ? 'warning' : 'info',
                    })),
                };
            }

            case 'w10': {
                const decisions = f?.decisions_required ?? [];
                return {
                    label: 'Widget 10 · Forward Look',
                    title: 'Decisions Required',
                    description: `<p>Decisions that require executive input or PM action — <strong>auto-detected</strong> from threshold breaches, PM-escalated blockers, or milestones at risk. These are not status updates; they are points where inaction has a measurable cost.</p>
                        <p>Each decision includes a suggested action. Resolving a decision closes it from the list. Ignored decisions escalate in severity after 2 sprints.</p>`,
                    sources: decisions.map(d => ({
                        label: d.description.slice(0, 70) + (d.description.length > 70 ? '…' : ''),
                        tag:   d.severity === 'critical' ? 'Critical' : d.severity === 'warning' ? 'Warning' : 'Watch',
                        tagVariant: d.severity === 'critical' ? 'danger' : d.severity === 'warning' ? 'warning' : 'info',
                    })),
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
    return { init, refresh, drillDown: _openDrillDown };

})();

// Auto-start
ExecDashboard.init();

// ── Exec widget tooltips ──────────────────────────────────────────────────────

const EXEC_TIPS = {
    'w1a': 'Tracks the average OKR alignment score across all your PM workspaces over the last 6 sprints. A rising trend means your teams are staying strategically focused; a decline is an early warning of drift.',
    'w1b': 'Compares each PM\'s OKRs against the executive OKRs to surface divergences. Gaps here are strategic signals — they don\'t mean a PM is wrong, but they may warrant a conversation about priorities.',
    'w2':  'Measures what percentage of your PM workspaces have enough Hub signals to support a meaningful Radar analysis. Low coverage means blind spots — decisions being made without sufficient user or market context.',
    'w3':  'Detects how much the product vision has shifted over time. A high drift score means the product direction has changed significantly without a recorded decision — which can erode team alignment.',
    'w4':  'Shows the ratio of strategic work vs reactive work across sprints. A declining Focus Guard means your teams are spending more time firefighting and less time on planned objectives.',
    'w5':  'Measures how much the sprint scope changed between commitment and delivery — stories added, removed, or carried over. High drift signals planning instability or external pressure.',
    'w6':  'Tracks the time between a signal appearing in the Hub and a related story being delivered. A growing delay suggests your feedback loop is slowing down.',
    'w7':  'Summarises the health of active epics across all PM workspaces — scope growth, stalled progress, or epics at risk of missing milestones.',
    'w8':  'Projects when active epics will complete based on each team\'s historical delivery patterns. Confidence intervals are shown — solid bar = worst case, faded = best case.',
    'w9':  'Extrapolates current risk trends 3 sprints into the future. Shows what is likely to become critical if nothing changes — scope creep, churn signals, OKR misses.',
    'w10': 'Decisions that require executive input or PM action — auto-detected from threshold breaches, PM-escalated blockers, or milestones at risk.',
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
['w1a','w1b','w2','w3','w4','w5','w6','w7','w8','w9','w10'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    new MutationObserver(() => {
        _execAddTipIcon(el.querySelector('.widget-label'), id);
    }).observe(el, { childList: true, subtree: true });
    _execAddTipIcon(el.querySelector('.widget-label'), id);
});

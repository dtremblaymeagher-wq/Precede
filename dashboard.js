// Module-level caches used by history re-render
let _cachedSettings     = null;
let _cachedHistoryFiles = [];

document.addEventListener('DOMContentLoaded', async () => {
    const ok = await Auth.requireAuth();
    if (!ok) return;

    // ── Greeting ─────────────────────────────────────────────────────────────

    const user      = window.Clerk?.user;
    const firstName = user?.firstName || user?.emailAddresses?.[0]?.emailAddress?.split('@')[0] || '';
    const hour      = new Date().getHours();
    const timeLabel = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

    document.getElementById('greeting').textContent =
        firstName ? `${timeLabel}, ${firstName}` : timeLabel;
    document.getElementById('dateLabel').textContent =
        new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

    // ── Parallel data load ────────────────────────────────────────────────────

    const [settings, historyFiles] = await Promise.all([
        Auth.fetch('/api/settings').then(r => r.json()).catch(() => ({})),
        Auth.fetch('/api/history').then(r => r.json()).catch(() => []),
    ]);

    // Load latest radar analysis (first file = most recent, server orders DESC)
    let radar = null;
    if (historyFiles.length > 0) {
        radar = await Auth.fetch(`/api/history/${historyFiles[0]}`)
            .then(r => r.json())
            .catch(() => null);
    }

    const analysis = radar?.analysis ?? null;

    // Cache for history re-render
    _cachedSettings     = settings;
    _cachedHistoryFiles = historyFiles;

    // ── Vision in header ──────────────────────────────────────────────────────

    const visionEl = document.getElementById('headerVision');
    if (visionEl && settings.vision?.trim()) {
        visionEl.textContent = settings.vision.trim();
    }

    // ── Render all widgets ────────────────────────────────────────────────────

    renderStatusBar(analysis, settings);
    renderAttention(analysis, settings);
    renderStrategicFocus(analysis);
    renderStakeholderPosture(analysis);
    renderDelta(analysis);
    renderOKR(settings, analysis, historyFiles);
    renderSignals(analysis, historyFiles);

    renderSilentSignals(analysis);
    renderLongitudinalInsights(analysis);

    // ── Longitudinal fallback ─────────────────────────────────────────────────
    // If the latest radar has no longitudinal data, find the most recent one
    // that does and re-render those widgets with a "last analyzed" label.
    if (!hasLongitudinalData(analysis)) {
        const currentLongitudinal = analysis?.longitudinal || null;
        findBestLongitudinalAnalysis(historyFiles).then(best => {
            if (!best) return;
            renderSilentSignals(best.analysis, best.date, currentLongitudinal);
            renderLongitudinalInsights(best.analysis);
        });
    }
});


// ── Widget — Stakeholder Posture ──────────────────────────────────────────────

function _postureConfig(status) {
    const s = (status || '').toLowerCase();
    const isTense = s.includes('tendu') || s.includes('tense') || s.includes('tension');
    const isPositive = s.includes('positif') || s.includes('positive') || s.includes('calm') || s.includes('calme');
    if (isTense)    return { dot: 'var(--color-danger)',  bg: 'var(--color-danger-subtle)',  label: 'Tense'    };
    if (isPositive) return { dot: 'var(--color-success)', bg: 'var(--color-success-subtle)', label: 'Positive' };
    return              { dot: 'var(--color-text-muted)', bg: 'var(--color-bg-hover)',       label: status || 'Neutral' };
}

// ── Visit Banner ──────────────────────────────────────────────────────────────

const VISIT_KEY = window.PRECEDE.VISIT_KEY;

function renderVisitBanner(analysis, historyFiles) {
    const el = document.getElementById('w-visit-banner');
    if (!el) return;

    const latest = historyFiles[0] || null;
    if (!latest || !analysis) { el.innerHTML = ''; return; }

    const lastDismissed = localStorage.getItem(VISIT_KEY);

    if (lastDismissed === latest || !lastDismissed) {
        // First ever visit, or user already dismissed this analysis
        if (!lastDismissed) localStorage.setItem(VISIT_KEY, latest);
        el.innerHTML = '';
        return;
    }

    // Build one-line delta summary
    const delta     = analysis?.delta || {};
    const newCount  = (delta.new_signals    || []).length;
    const resCount  = (delta.resolved       || []).length;
    const revCount  = (delta.contradictions || []).length;

    const parts = [];
    if (newCount)  parts.push(`${newCount} new signal${newCount  !== 1 ? 's' : ''}`);
    if (resCount)  parts.push(`${resCount} resolved`);
    if (revCount)  parts.push(`${revCount} reversed`);
    const summary = parts.length ? parts.join(' · ') : 'Analysis updated';

    // Extract approximate age of new analysis from filename timestamp
    const tsMatch = latest.match(/\d{10,}/);
    const ageLabel = tsMatch ? (() => {
        const days = Math.floor((Date.now() - parseInt(tsMatch[0])) / 86400000);
        return days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
    })() : '';

    el.innerHTML = `
        <div style="display:flex;align-items:center;gap:12px;padding:11px 16px;
                    background:var(--color-accent-subtle);border:1px solid var(--color-accent-border);
                    border-radius:var(--radius-xl);box-shadow:var(--shadow-card);">
            <span style="font-size:13px;flex-shrink:0;">◈</span>
            <div style="flex:1;min-width:0;">
                <span style="font-size:var(--font-size-xs);font-weight:var(--font-weight-bold);
                             text-transform:uppercase;letter-spacing:var(--letter-spacing-wider);
                             color:var(--color-accent);">New since your last visit${ageLabel ? ' · ' + ageLabel : ''}</span>
                <span style="font-size:var(--font-size-xs);color:var(--color-text-secondary);
                             margin-left:8px;">${escHtml(summary)}</span>
            </div>
            <button onclick="localStorage.setItem('${VISIT_KEY}','${latest}');openDeltaDrillDown(window._lastAnalysis?.delta||{})"
                    style="font-size:11px;font-weight:700;color:var(--color-accent);
                           background:var(--color-bg-surface);border:1px solid var(--color-accent-border);
                           border-radius:var(--radius-md);padding:5px 12px;cursor:pointer;
                           white-space:nowrap;font-family:var(--font-family);flex-shrink:0;">
                See what changed →
            </button>
            <button onclick="localStorage.setItem('${VISIT_KEY}','${latest}');document.getElementById('w-visit-banner').innerHTML=''"
                    style="font-size:13px;color:var(--color-text-muted);background:none;border:none;
                           cursor:pointer;padding:2px 4px;flex-shrink:0;line-height:1;"
                    title="Dismiss">✕</button>
        </div>`;
}

// ── Status Bar ────────────────────────────────────────────────────────────────

function renderStatusBar(analysis, settings) {
    const el = document.getElementById('w-status-bar');
    if (!el) return;

    if (!analysis) {
        el.innerHTML = `
            <div style="display:flex;align-items:center;gap:8px;padding:12px 16px;
                        background:var(--color-bg-surface);border:1px solid var(--color-border);
                        border-radius:var(--radius-xl);box-shadow:var(--shadow-card);">
                <span style="font-size:var(--font-size-xs);color:var(--color-text-muted);font-style:italic;">
                    Run your first Radar analysis to see health status.
                </span>
            </div>`;
        return;
    }

    // ── Compute pill values ───────────────────────────────────────────────────

    // OKR Alignment — avg score across all OKRs
    const rawOKRs    = analysis.okr_alignment || [];
    const okrScores  = rawOKRs.map(o => o.score || 0);
    const avgOKR     = okrScores.length ? Math.round(okrScores.reduce((a, b) => a + b, 0) / okrScores.length) : null;

    // Signals — total trends + delta breakdown
    const trends    = analysis.trends || [];
    const newSigs   = (analysis.delta?.new_signals    || []).length;
    const resSigs   = (analysis.delta?.resolved       || []).length;
    const revSigs   = (analysis.delta?.contradictions || []).length;

    // Risks
    const risks      = analysis.risks || [];

    // Opportunities
    const opps       = analysis.opportunities || [];

    // ── Color helpers ─────────────────────────────────────────────────────────

    function okrColor(score) {
        if (score >= 70) return { bg: 'var(--color-success-subtle)', fg: 'var(--color-success)', border: 'rgba(74,140,84,0.2)' };
        if (score >= 40) return { bg: 'var(--color-warning-subtle)', fg: 'var(--color-warning)', border: 'rgba(160,120,48,0.2)' };
        return { bg: 'var(--color-danger-subtle)', fg: 'var(--color-danger)', border: 'rgba(156,60,60,0.2)' };
    }

    function pill(icon, label, value, color, tooltip, onclick) {
        const { bg, fg, border } = color;
        return `
            <button onclick="${onclick}" title="${escHtml(tooltip)}"
                style="display:inline-flex;align-items:center;gap:7px;
                       background:${bg};border:1px solid ${border};
                       border-radius:var(--radius-lg);padding:8px 14px;
                       cursor:pointer;font-family:var(--font-family);
                       transition:filter 0.15s;flex-shrink:0;"
                onmouseover="this.style.filter='brightness(0.95)'"
                onmouseout="this.style.filter='brightness(1)'">
                <span style="font-size:13px;">${icon}</span>
                <span style="font-size:var(--font-size-xs);font-weight:var(--font-weight-bold);
                             text-transform:uppercase;letter-spacing:var(--letter-spacing-wider);
                             color:var(--color-text-muted);">${escHtml(label)}</span>
                <span style="font-size:var(--font-size-sm);font-weight:900;color:${fg};">${escHtml(String(value))}</span>
            </button>`;
    }

    const neutral = { bg: 'var(--color-bg-hover)', fg: 'var(--color-text-primary)', border: 'var(--color-border)' };
    const accent  = { bg: 'var(--color-accent-subtle)', fg: 'var(--color-accent)', border: 'var(--color-accent-border)' };
    const danger  = { bg: 'var(--color-danger-subtle)', fg: 'var(--color-danger)', border: 'rgba(156,60,60,0.2)' };

    // Build pill HTML
    const okrPill = avgOKR !== null
        ? pill('◎', 'OKR Alignment', `${avgOKR}%`, okrColor(avgOKR),
               'Average OKR alignment score across all objectives', 'openOKRDetailModal()')
        : '';

    const hasDelta  = newSigs || resSigs || revSigs;
    const deltaParts = [
        newSigs ? `+${newSigs}` : '',
        resSigs ? `${resSigs}✓` : '',
        revSigs ? `${revSigs}↕` : '',
    ].filter(Boolean).join(' ');
    const sigLabel  = hasDelta ? `${trends.length} (${deltaParts})` : String(trends.length);
    const sigPill   = pill('◉', 'Signals', sigLabel,
        hasDelta ? accent : neutral,
        'Total active signals · +new  ✓resolved  ↕reversed — click to see details',
        'openDeltaDrillDown(window._lastAnalysis?.delta || {})');

    const riskPill = pill('▲', 'Risks', risks.length,
        risks.length > 0 ? danger : neutral,
        'Strategic or delivery risks detected by Radar',
        'openOppsActionsDrillDown(window._lastAnalysis?.opportunities||[], window._lastAnalysis?.next_actions||[], window._lastAnalysis?.risks||[])');

    const oppPill  = pill('◆', 'Opportunities', opps.length,
        opps.length > 0 ? accent : neutral,
        'Actionable opportunities detected by Radar',
        'openOppsActionsDrillDown(window._lastAnalysis?.opportunities||[], window._lastAnalysis?.next_actions||[], window._lastAnalysis?.risks||[])');

    el.innerHTML = `
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;
                    padding:12px 16px;
                    background:var(--color-bg-surface);border:1px solid var(--color-border);
                    border-radius:var(--radius-xl);box-shadow:var(--shadow-card);">
            <span style="font-size:var(--font-size-xs);font-weight:var(--font-weight-bold);
                         text-transform:uppercase;letter-spacing:var(--letter-spacing-wider);
                         color:var(--color-text-muted);margin-right:4px;white-space:nowrap;">
                Health
            </span>
            <div style="width:1px;height:20px;background:var(--color-border);flex-shrink:0;"></div>
            ${okrPill}${sigPill}${riskPill}${oppPill}
        </div>`;

    // Store analysis reference for pill onclick handlers
    window._lastAnalysis = analysis;
}

// ── Attention Required ────────────────────────────────────────────────────────

function renderAttention(analysis, settings) {
    const el = document.getElementById('w-attention');
    if (!el) return;

    if (!analysis) { el.innerHTML = ''; return; }

    const items = []; // { severity: 'critical'|'warning', icon, text, onclick }

    // 1. OKRs with low alignment
    const configuredOKRs = settings?.okrs || [];
    const rawOKRs = analysis.okr_alignment || [];
    configuredOKRs.forEach(obj => {
        const found = rawOKRs.find(r =>
            r.okr === obj.objective ||
            (r.okr && obj.objective && (
                r.okr.includes(obj.objective.slice(0, 30)) ||
                obj.objective.includes(r.okr.slice(0, 30))
            ))
        );
        const score = found?.score ?? 0;
        if (score < 40) {
            const label = obj.objective?.length > 55
                ? obj.objective.slice(0, 55) + '…'
                : obj.objective || 'OKR';
            items.push({
                severity: score < 20 ? 'critical' : 'warning',
                icon: '◎',
                text: `OKR alignment critical: "${label}" — ${score}%`,
                onclick: 'openOKRDetailModal()'
            });
        }
    });

    // 2. Active risks
    (analysis.risks || []).slice(0, 3).forEach(r => {
        const text = typeof r === 'string' ? r : (r.risk || r.title || r.description || JSON.stringify(r));
        items.push({
            severity: 'warning',
            icon: '▲',
            text: text.length > 90 ? text.slice(0, 90) + '…' : text,
            onclick: `openOppsActionsDrillDown(window._lastAnalysis?.opportunities||[],window._lastAnalysis?.next_actions||[],window._lastAnalysis?.risks||[])`
        });
    });

    // 3. Reversed / contradicting signals
    const flipped = analysis.delta?.contradictions || [];
    flipped.slice(0, 2).forEach(s => {
        const title = typeof s === 'string' ? s : (s.title || s.signal || '');
        items.push({
            severity: 'warning',
            icon: '↕',
            text: `Signal reversed direction: "${title.length > 60 ? title.slice(0, 60) + '…' : title}"`,
            onclick: `openDeltaDrillDown(window._lastAnalysis?.delta||{})`
        });
    });

    // 4. Tense stakeholders
    const actors = analysis.sentiment?.actors || analysis.sentiment || [];
    (Array.isArray(actors) ? actors : []).forEach(a => {
        const status = (a.status || '').toLowerCase();
        if (['tense', 'tendu', 'at risk', 'negative'].includes(status)) {
            items.push({
                severity: 'warning',
                icon: '●',
                text: `${a.name || 'Stakeholder'} posture is tense — monitor closely`,
                onclick: `DrillDown.open(window._lastPosturePayload||{label:'Stakeholder Posture',title:'Posture Details',description:''})`
            });
        }
    });

    // Cap at 5 items — critical first
    const sorted = [
        ...items.filter(i => i.severity === 'critical'),
        ...items.filter(i => i.severity === 'warning')
    ].slice(0, 5);

    if (sorted.length === 0) {
        el.innerHTML = `
            <div style="display:flex;align-items:center;gap:8px;padding:10px 16px;
                        background:var(--color-success-subtle);border:1px solid rgba(74,140,84,0.2);
                        border-radius:var(--radius-xl);">
                <span style="font-size:13px;">✓</span>
                <span style="font-size:var(--font-size-xs);font-weight:var(--font-weight-bold);
                             text-transform:uppercase;letter-spacing:var(--letter-spacing-wider);
                             color:var(--color-success);">All clear</span>
                <span style="font-size:var(--font-size-xs);color:var(--color-text-muted);margin-left:2px;">
                    No critical issues detected in this analysis.
                </span>
            </div>`;
        return;
    }

    const rows = sorted.map(item => {
        const isCrit = item.severity === 'critical';
        const fg     = isCrit ? 'var(--color-danger)'  : 'var(--color-warning)';
        const bg     = isCrit ? 'var(--color-danger-subtle)' : 'var(--color-warning-subtle)';
        const border = isCrit ? 'rgba(156,60,60,0.15)' : 'rgba(160,120,48,0.15)';
        return `
            <button onclick="${item.onclick}"
                style="display:flex;align-items:center;gap:10px;width:100%;text-align:left;
                       padding:9px 14px;background:${bg};border:1px solid ${border};
                       border-radius:var(--radius-md);cursor:pointer;font-family:var(--font-family);
                       transition:filter 0.15s;"
                onmouseover="this.style.filter='brightness(0.95)'"
                onmouseout="this.style.filter='brightness(1)'">
                <span style="font-size:12px;color:${fg};flex-shrink:0;">${item.icon}</span>
                <span style="font-size:var(--font-size-sm);color:var(--color-text-primary);
                             font-weight:var(--font-weight-medium);min-width:0;">
                    ${escHtml(item.text)}
                </span>
                <span style="font-size:10px;color:var(--color-text-muted);margin-left:auto;
                             flex-shrink:0;">↗</span>
            </button>`;
    }).join('');

    el.innerHTML = `
        <div style="background:var(--color-bg-surface);border:1px solid var(--color-border);
                    border-radius:var(--radius-xl);box-shadow:var(--shadow-card);overflow:hidden;">
            <div style="display:flex;align-items:center;gap:8px;padding:10px 16px;
                        border-bottom:1px solid var(--color-border);">
                <span style="font-size:var(--font-size-xs);font-weight:var(--font-weight-bold);
                             text-transform:uppercase;letter-spacing:var(--letter-spacing-wider);
                             color:var(--color-danger);">⚑ Attention Required</span>
                <span style="font-size:var(--font-size-xs);color:var(--color-text-muted);">
                    ${sorted.length} item${sorted.length !== 1 ? 's' : ''} need your review
                </span>
            </div>
            <div style="display:flex;flex-direction:column;gap:6px;padding:10px 12px 12px;">
                ${rows}
            </div>
        </div>`;
}

function renderStakeholderPosture(analysis) {
    const el = document.getElementById('ph-posture');
    if (!el) return;

    const actors = analysis?.sentiment || [];

    el.innerHTML = '<div class="widget-label">Stakeholder Posture</div><p class="widget-desc">Sentiment and tension levels across key actors based on recent signals.</p>';

    if (!analysis) {
        el.innerHTML += `<p style="font-size:12px;color:var(--color-text-muted);margin-top:8px;">Run a Radar analysis to see stakeholder posture.</p>`;
        return;
    }

    if (!actors.length) {
        el.innerHTML += `<p style="font-size:13px;color:var(--color-success);font-weight:700;margin-top:8px;">No tension signals detected</p>`;
        return;
    }

    const tenseCount = actors.filter(a => _postureConfig(a.status).label === 'Tense').length;
    if (tenseCount > 0) {
        el.innerHTML += `<div style="font-size:11px;font-weight:700;color:var(--color-danger);
                                     background:var(--color-danger-subtle);padding:3px 10px;
                                     border-radius:9999px;display:inline-block;margin-bottom:10px;">
            ${tenseCount} tense actor${tenseCount !== 1 ? 's' : ''}
        </div>`;
    }

    el.innerHTML += actors.slice(0, 4).map(a => {
        const cfg = _postureConfig(a.status);
        return `
        <div class="widget-item" style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid var(--color-border);">
            <div style="width:7px;height:7px;border-radius:50%;background:${cfg.dot};flex-shrink:0;"></div>
            <span style="font-size:13px;font-weight:600;color:var(--color-text-primary);flex:1;
                         white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escHtml(a.actor || 'Unknown')}</span>
            <span style="font-size:10px;font-weight:700;color:${cfg.dot};background:${cfg.bg};
                         padding:2px 7px;border-radius:9999px;flex-shrink:0;">${escHtml(cfg.label)}</span>
        </div>`;
    }).join('');

    if (actors.length > 4) {
        el.innerHTML += `<p style="font-size:11px;color:var(--color-text-muted);margin-top:8px;">+${actors.length - 4} more</p>`;
    }

    window._lastPosturePayload = {
        label:       'Stakeholder Posture',
        title:       'Sentiment Across Key Actors',
        description: `<p>Based on signals captured in the Hub this sprint.</p>`,
        sources: actors.map(a => {
            const cfg    = _postureConfig(a.status);
            const detail = a.feedback || a.description || null;
            return {
                label:      a.actor || 'Unknown',
                tag:        cfg.label,
                tagVariant: cfg.label === 'Tense' ? 'danger' : cfg.label === 'Positive' ? 'success' : 'neutral',
                body:       detail || undefined,
            };
        }),
    };

    el.style.cursor = 'pointer';
    el.onclick = () => DrillDown.open(window._lastPosturePayload);
}

// ── Widget — Strategic Focus ──────────────────────────────────────────────────

function renderStrategicFocus(analysis) {
    const el = document.getElementById('w-strategic-focus');
    if (!el) return;

    const text = analysis?.strategic_alignment_summary;
    if (!text) { el.innerHTML = ''; return; }

    const gap = analysis?.strategic_gap_deep_dive || analysis?.strategic_gap || '';

    el.innerHTML = `
        <div style="background:var(--color-text-primary);border-radius:var(--radius-xl);
                    padding:28px 36px;box-shadow:var(--shadow-hover);
                    position:relative;overflow:hidden;">
            <div style="position:absolute;top:-20px;right:-10px;font-size:10rem;font-weight:900;
                        opacity:0.05;pointer-events:none;user-select:none;color:white;line-height:1;">!</div>
            <div style="font-size:var(--font-size-xs);font-weight:var(--font-weight-bold);
                        text-transform:uppercase;letter-spacing:var(--letter-spacing-wider);
                        color:var(--color-accent);margin-bottom:14px;position:relative;z-index:1;">
                Strategic Alignment
            </div>
            <p style="font-size:var(--font-size-lg);font-weight:var(--font-weight-bold);
                      font-style:italic;color:rgba(255,255,255,0.9);
                      line-height:var(--line-height-relaxed);margin:0;position:relative;z-index:1;">
                "${escHtml(text)}"
            </p>
        </div>
        ${gap ? `
        <div style="background:var(--color-bg-surface);border:1px solid var(--color-border);
                    border-radius:var(--radius-xl);padding:22px 28px;margin-top:12px;
                    box-shadow:var(--shadow-card);">
            <div style="font-size:var(--font-size-xs);font-weight:var(--font-weight-bold);
                        text-transform:uppercase;letter-spacing:var(--letter-spacing-wider);
                        color:var(--color-text-muted);margin-bottom:12px;">
                Strategic Gap
            </div>
            <p style="font-size:var(--font-size-sm);color:var(--color-text-secondary);
                      line-height:var(--line-height-relaxed);margin:0;">
                ${escHtml(gap)}
            </p>
        </div>` : ''}`;
}

// ── Widget — Sprint Delta ─────────────────────────────────────────────────────

function renderDelta(analysis) {
    const el = document.getElementById('w-delta');
    if (!el) return;

    const delta = analysis?.delta || {};
    const newSigs  = delta.new_signals       || [];
    const stronger = delta.strengthened      || [];
    const resolved = delta.resolved          || [];
    const flipped  = delta.contradictions    || [];

    const hasDelta = newSigs.length || stronger.length || resolved.length || flipped.length;

    if (!analysis) {
        el.innerHTML = `
            <div class="widget-label">Sprint Delta</div>
            <p class="widget-desc">Signal changes since the previous analysis.</p>
            <p style="font-size:13px;color:var(--color-text-muted);font-weight:500;margin-top:4px;">
                Run your first Radar analysis to see what's changing.
            </p>`;
        return;
    }

    if (!hasDelta) {
        el.innerHTML = `
            <div class="widget-label">Sprint Delta</div>
            <p class="widget-desc">Signal changes since the previous analysis.</p>
            <p style="font-size:13px;color:var(--color-text-secondary);font-weight:600;margin-top:4px;">
                First sprint analyzed — delta will appear from the next analysis onwards.
            </p>`;
        return;
    }

    const pills = [
        newSigs.length  ? { label: `${newSigs.length} new`,        color: 'var(--color-success)',        bg: 'var(--color-success-subtle)'  } : null,
        stronger.length ? { label: `${stronger.length} reinforced`, color: 'var(--color-info)',           bg: 'var(--color-info-subtle)'     } : null,
        resolved.length ? { label: `${resolved.length} resolved`,   color: 'var(--color-text-secondary)', bg: 'var(--color-bg-hover)'        } : null,
        flipped.length  ? { label: `${flipped.length} reversed`,    color: 'var(--color-warning)',        bg: 'var(--color-warning-subtle)'  } : null,
    ].filter(Boolean);

    const pillsHtml = pills.map(p =>
        `<span style="font-size:11px;font-weight:700;color:${p.color};background:${p.bg};
                      padding:3px 10px;border-radius:9999px;border:1px solid ${p.color}22;">
            ${p.label}
        </span>`
    ).join('');

    el.style.cursor = 'pointer';
    el.onclick = () => openDeltaDrillDown(delta);

    el.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">
            <div>
                <div class="widget-label" style="margin-bottom:4px;">Sprint Delta</div>
                <p class="widget-desc" style="margin:0;">Signal changes detected since the previous Radar analysis.</p>
            </div>
            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;flex-shrink:0;">
                ${pillsHtml}
                <span style="font-size:13px;color:var(--color-text-muted);">›</span>
            </div>
        </div>`;
}

function openOppsActionsDrillDown(opportunities, nextActions, risks) {
    const opps    = opportunities || [];
    const actions = nextActions   || [];
    const riskList = risks        || [];

    const itemHtml = (items, heading, dotColor) => {
        if (!items.length) return '';
        const rows = items.map(item => {
            const title = typeof item === 'string' ? item : (item.title || '');
            const desc  = typeof item === 'object' ? (item.description || '') : '';
            return `
            <div style="padding:10px 0;border-bottom:1px solid var(--color-border);">
                <div style="display:flex;align-items:flex-start;gap:8px;">
                    <div style="width:7px;height:7px;border-radius:50%;background:${dotColor};flex-shrink:0;margin-top:4px;"></div>
                    <div>
                        <p style="font-size:13px;font-weight:600;color:var(--color-text-primary);margin:0 0 3px;">${escHtml(title)}</p>
                        ${desc ? `<p style="font-size:12px;color:var(--color-text-secondary);margin:0;line-height:1.5;">${escHtml(desc)}</p>` : ''}
                    </div>
                </div>
            </div>`;
        }).join('');
        return `
        <div style="margin-bottom:16px;">
            <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.07em;
                        color:var(--color-text-muted);margin-bottom:4px;">${heading}</div>
            ${rows}
        </div>`;
    };

    const descNode = document.createElement('div');
    descNode.innerHTML =
        itemHtml(riskList, 'Risks',        COLORS.danger) +
        itemHtml(opps,     'Opportunities', COLORS.success) +
        itemHtml(actions,  'Next Actions',  COLORS.warning);

    DrillDown.open({
        label:       'Health · Risks & Opportunities',
        title:       'Risks, Opportunities & Next Actions',
        description: descNode,
        sources:     [],
    });
}

function openDeltaDrillDown(delta) {
    const newSigs  = delta.new_signals    || [];
    const stronger = delta.strengthened   || [];
    const resolved = delta.resolved       || [];
    const flipped  = delta.contradictions || [];

    const section = (items, label, tagVariant) =>
        items.map(s => ({
            label: typeof s === 'string' ? s : (s.topic || s.name || String(s)),
            tag:   label,
            tagVariant,
            body:  typeof s === 'object' ? (s.description || s.signal || s.rationale || undefined) : undefined,
        }));

    const sources = [
        ...section(newSigs,  'New',        'success'),
        ...section(stronger, 'Reinforced', 'info'),
        ...section(resolved, 'Resolved',   'neutral'),
        ...section(flipped,  'Reversed',   'warning'),
    ];

    const parts = [
        newSigs.length  ? `<strong>${newSigs.length}</strong> new signal${newSigs.length  !== 1 ? 's' : ''} detected` : null,
        stronger.length ? `<strong>${stronger.length}</strong> reinforced`                                            : null,
        resolved.length ? `<strong>${resolved.length}</strong> resolved or disappeared`                               : null,
        flipped.length  ? `<strong>${flipped.length}</strong> reversed since last sprint`                             : null,
    ].filter(Boolean);

    DrillDown.open({
        label:       'Sprint Delta',
        title:       'What Changed Since Last Sprint',
        description: `<p>${parts.join(' · ')}</p>`,
        sources,
        related: [_rel.okr, _rel.posture],
    });
}

// ── DrillDown related-link helpers ───────────────────────────────────────────

const _rel = {
    delta:    { label: 'Sprint Delta',           onclick: "openDeltaDrillDown(window._lastAnalysis?.delta||{})" },
    okr:      { label: 'OKR Alignment',          onclick: "openOKRAlignmentDrillDown()" },
    posture:  { label: 'Stakeholder Posture',    onclick: "DrillDown.open(window._lastPosturePayload||{label:'Stakeholder Posture',title:'Posture',description:''})" },
};

function groomFromAnalysis(text) {
    localStorage.setItem('pendingStoryIdea', text);
    window.location.href = '/Modules/story-grooming/story-grooming.html';
}

// ── Sync Jira Comments ────────────────────────────────────────────────────────

async function syncJiraFromDashboard() {
    const btn = document.getElementById('dashSyncJiraBtn');
    if (!btn) return;
    const orig = btn.textContent;
    btn.disabled = true;
    btn.textContent = '⏳ Syncing…';
    try {
        const res  = await Auth.fetch('/api/integration/sync-signals', { method: 'POST' });
        const data = await res.json();
        _showSyncToast(res.ok
            ? `✅ ${data.count} Jira comment(s) imported`
            : `❌ ${data.error || 'Sync failed — configure Jira in Settings'}`
        , res.ok ? 'success' : 'error');
    } catch (e) {
        _showSyncToast('❌ Connection error', 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = orig;
    }
}

function _showSyncToast(msg, variant) {
    let toast = document.getElementById('dashSyncToast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'dashSyncToast';
        toast.style.cssText = [
            'position:fixed', 'bottom:24px', 'left:50%', 'transform:translateX(-50%)',
            'z-index:9999', 'padding:10px 20px', 'border-radius:var(--radius-md)',
            'font-size:var(--font-size-sm)', 'font-weight:var(--font-weight-medium)',
            'box-shadow:0 4px 20px rgba(44,35,24,0.18)', 'pointer-events:none',
            'transition:opacity 0.3s'
        ].join(';');
        document.body.appendChild(toast);
    }
    toast.textContent = msg;
    if (variant === 'success') {
        toast.style.background = 'var(--color-success-subtle)';
        toast.style.color      = 'var(--color-success)';
        toast.style.border     = '1px solid rgba(74,140,84,0.25)';
    } else {
        toast.style.background = 'var(--color-danger-subtle)';
        toast.style.color      = 'var(--color-danger)';
        toast.style.border     = '1px solid rgba(156,60,60,0.25)';
    }
    toast.style.opacity = '1';
    clearTimeout(toast._hideTimer);
    toast._hideTimer = setTimeout(() => { toast.style.opacity = '0'; }, 4000);
}

// ── Widget 2 — OKR Alignment Score ───────────────────────────────────────────

function renderOKR(settings, analysis, historyFiles) {
    const el         = document.getElementById('w-okr');
    const objectives = (settings.objectives || [])
        .flatMap(o => o.split('|').map(s => s.trim()))
        .filter(Boolean);
    window._okrObjectives = objectives;

    if (!objectives.length) {
        el.innerHTML = `
            <div class="widget-label">OKR Alignment Score</div>
               <p class="widget-desc">How well your backlog stories map to your quarterly objectives.</p>
            <div class="empty-state">
                <p style="font-weight:600;color:${COLORS.textSecondary};">No OKRs configured</p>
                <a href="/Modules/settings/settings.html"
                   style="font-size:12px;font-weight:700;color:${COLORS.accent};text-decoration:none;">
                   Add in Settings →
                </a>
            </div>`;
        return;
    }

    if (!analysis) {
        el.innerHTML = `
            <div class="widget-label">OKR Alignment Score</div>
               <p class="widget-desc">How well your backlog stories map to your quarterly objectives.</p>
            <div style="padding:16px 0 8px;">
                <p style="font-size:13px;color:${COLORS.textSecondary};font-weight:500;margin-bottom:16px;">
                    Run your first Radar analysis to see alignment scores.
                </p>
                <button onclick="document.getElementById('dashRunAnalysisBtn')?.click()"
                        style="font-size:11px;font-weight:700;color:${COLORS.accent};background:rgba(176,90,56,0.08);
                               padding:6px 14px;border-radius:9999px;border:none;cursor:pointer;font-family:var(--font-family);">
                    Run Radar Analysis →
                </button>
            </div>`;
        return;
    }

    const rawAlignment = analysis.okr_alignment || [];

    // Always show all configured OKRs — fill missing ones with score 0.
    // Use partial matching to handle stale Radar data that stored pipe-combined OKR text.
    const okrAlignment = objectives.map(obj => {
        const norm = s => (s || '').toLowerCase().trim();
        const found = rawAlignment.find(o =>
            norm(o.okr) === norm(obj) ||
            norm(o.okr).includes(norm(obj)) ||
            norm(obj).includes(norm(o.okr))
        );
        return found ? { ...found, okr: obj } : { okr: obj, score: 0, trend: '', rationale: '' };
    });

    const barColor  = s => s >= 70 ? COLORS.success : s >= 40 ? COLORS.warning : COLORS.danger;
    const riskLabel = s => s >= 70 ? 'Strong' : s >= 40 ? 'Mixed' : 'At Risk';

    // Summary stats
    const strong  = okrAlignment.filter(o => (o.score || 0) >= 70).length;
    const mixed   = okrAlignment.filter(o => (o.score || 0) >= 40 && (o.score || 0) < 70).length;
    const atRisk  = okrAlignment.filter(o => (o.score || 0) < 40).length;
    const avgScore = okrAlignment.length
        ? Math.round(okrAlignment.reduce((s, o) => s + (o.score || 0), 0) / okrAlignment.length)
        : 0;
    const worst = [...okrAlignment].sort((a, b) => (a.score || 0) - (b.score || 0))[0];
    const avgColor = barColor(avgScore);

    // Store for drill-down
    window._okrAlignmentData = okrAlignment;

    const trendArrow = trend => {
        const t = (trend || '').toLowerCase();
        if (t.includes('rising'))    return `<span style="color:${COLORS.success};font-weight:800;font-size:10px;">↑</span>`;
        if (t.includes('declining')) return `<span style="color:${COLORS.danger};font-weight:800;font-size:10px;">↓</span>`;
        return '';
    };

    const okrRowsHtml = okrAlignment.map((o, idx) => {
        const c = barColor(o.score || 0);
        const r = riskLabel(o.score || 0);
        const label = o.okr?.length > 62 ? o.okr.slice(0, 62) + '…' : o.okr || '';
        return `
        <div class="widget-item" onclick="openOKRItemDrillDown(${idx})"
             data-okr-idx="${idx}"
             style="display:flex;flex-direction:column;gap:5px;padding:8px 10px;margin-bottom:4px;
                    border:1px solid var(--color-border);border-radius:var(--radius-md);
                    cursor:pointer;transition:background 0.15s;">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
                <span style="font-size:12px;color:var(--color-text-primary);font-weight:500;
                             flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"
                      title="${escHtml(o.okr || '')}">${escHtml(label)}</span>
                <span style="display:flex;align-items:center;gap:4px;flex-shrink:0;">
                    ${trendArrow(o.trend)}
                    <span style="font-size:10px;font-weight:800;color:${c};background:${c}18;
                                 padding:2px 7px;border-radius:9999px;">${r}</span>
                </span>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;align-items:start;">
                <div>
                    <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;
                                color:var(--color-text-muted);margin-bottom:4px;">Alignment</div>
                    <div style="display:flex;align-items:center;gap:5px;">
                        <div style="flex:1;height:4px;background:var(--color-border);border-radius:9999px;overflow:hidden;">
                            <div style="height:4px;border-radius:9999px;background:${c};width:${o.score || 0}%;transition:width 0.5s ease;"></div>
                        </div>
                        <span style="font-size:10px;font-weight:800;color:${c};">${o.score || 0}%</span>
                    </div>
                </div>
                <div data-sprint-bar="${idx}">
                    ${_okrSprintBarHtml(idx, window._okrCoverage)}
                </div>
            </div>
        </div>`;
    }).join('');

    el.innerHTML = `
        <div class="widget-label">OKR Alignment Score</div>
        <p class="widget-desc">How well your backlog stories map to your quarterly objectives.</p>
        <div style="display:flex;align-items:center;gap:14px;margin-bottom:10px;">
            <div style="font-size:2rem;font-weight:900;color:${avgColor};line-height:1;">${avgScore}%</div>
            <span style="font-size:10px;font-weight:800;color:${avgColor};background:${avgColor}18;
                         padding:3px 10px;border-radius:9999px;">${riskLabel(avgScore)}</span>
        </div>
        <div style="display:flex;gap:12px;margin-bottom:10px;">
            <span style="font-size:11px;font-weight:700;color:${COLORS.success};">${strong} Strong</span>
            <span style="font-size:11px;color:var(--color-border);">·</span>
            <span style="font-size:11px;font-weight:700;color:${COLORS.warning};">${mixed} Mixed</span>
            <span style="font-size:11px;color:var(--color-border);">·</span>
            <span style="font-size:11px;font-weight:700;color:${COLORS.danger};">${atRisk} At Risk</span>
        </div>
        <div>${okrRowsHtml}</div>`;

    // Re-inject coverage immediately if already loaded
    if (window._okrCoverage) renderOKRCoverage(window._okrCoverage);
}

function openOKRAlignmentDrillDown() {
    const okrAlignment = window._okrAlignmentData || [];
    if (!okrAlignment.length) return;

    const barColor  = s => s >= 70 ? COLORS.success : s >= 40 ? COLORS.warning : COLORS.danger;
    const riskLabel = s => s >= 70 ? 'Strong'  : s >= 40 ? 'Mixed'   : 'At Risk';
    const trendArrow = trend => {
        const t = (trend || '').toLowerCase();
        if (t.includes('rising'))    return `<span style="color:${COLORS.success};font-weight:800;">↑</span>`;
        if (t.includes('declining')) return `<span style="color:${COLORS.danger};font-weight:800;">↓</span>`;
        return `<span style="color:${COLORS.textMuted};font-weight:800;">→</span>`;
    };

    const barsHtml = okrAlignment.map(o => {
        const c = barColor(o.score || 0);
        const r = riskLabel(o.score || 0);
        return `
        <div style="margin-bottom:14px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;gap:8px;">
                <span style="font-size:12px;color:var(--color-text-primary);font-weight:500;
                             flex:1;min-width:0;">${escHtml(o.okr || '')}</span>
                <span style="display:flex;align-items:center;gap:5px;flex-shrink:0;">
                    ${trendArrow(o.trend)}
                    <span style="font-size:10px;font-weight:800;color:${c};background:${c}18;
                                 padding:2px 8px;border-radius:9999px;">${r}</span>
                </span>
            </div>
            <div style="background:var(--color-border);border-radius:9999px;height:6px;overflow:hidden;">
                <div style="height:6px;border-radius:9999px;background:${c};width:${o.score||0}%;
                            transition:width 0.5s ease;"></div>
            </div>
            ${o.rationale ? `<p style="font-size:11px;color:var(--color-text-muted);margin:4px 0 0;
                                        line-height:1.5;">${escHtml(o.rationale)}</p>` : ''}
        </div>`;
    }).join('');

    const descNode = document.createElement('div');
    descNode.innerHTML = barsHtml;

    DrillDown.open({
        label:       'OKR Alignment · All Objectives',
        title:       'Alignment Score per OKR',
        description: descNode,
        sources:     okrAlignment.map(o => ({
            label:      o.okr || '',
            value:      o.score != null ? `${o.score}%` : undefined,
            tag:        riskLabel(o.score || 0),
            tagVariant: (o.score || 0) >= 70 ? 'success' : (o.score || 0) >= 40 ? 'warning' : 'danger',
            body:       o.rationale || undefined,
        })),
        related:     [_rel.delta],
    });
}

// ── OKR Item Drilldown (per-OKR) ─────────────────────────────────────────────

function openOKRItemDrillDown(idx) {
    const okrAlignment = window._okrAlignmentData || [];
    const o = okrAlignment[idx];
    if (!o) return;

    const barColor  = s => s >= 70 ? COLORS.success : s >= 40 ? COLORS.warning : COLORS.danger;
    const riskLabel = s => s >= 70 ? 'Strong'  : s >= 40 ? 'Mixed'   : 'At Risk';
    const c = barColor(o.score || 0);
    const r = riskLabel(o.score || 0);

    const trendText = (o.trend || '').toLowerCase();
    const trendHtml = trendText.includes('rising')
        ? `<span style="color:${COLORS.success};font-weight:700;">↑ Rising</span>`
        : trendText.includes('declining')
        ? `<span style="color:${COLORS.danger};font-weight:700;">↓ Declining</span>`
        : trendText
        ? `<span style="color:${COLORS.textMuted};">→ ${escHtml(o.trend)}</span>`
        : '';

    // Score bar + rationale
    let descHtml = `
        <div style="margin-bottom:14px;">
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
                <span style="font-size:2rem;font-weight:900;color:${c};line-height:1;">${o.score || 0}%</span>
                <div>
                    <span style="font-size:11px;font-weight:800;color:${c};background:${c}18;
                                 padding:3px 10px;border-radius:9999px;display:block;margin-bottom:4px;">${r}</span>
                    ${trendHtml ? `<div style="font-size:11px;">${trendHtml}</div>` : ''}
                </div>
            </div>
            <div style="background:var(--color-border);border-radius:9999px;height:7px;overflow:hidden;margin-bottom:12px;">
                <div style="height:7px;border-radius:9999px;background:${c};width:${o.score || 0}%;transition:width 0.5s ease;"></div>
            </div>
            ${o.rationale ? `
            <div style="padding:10px 12px;background:var(--color-bg-hover);border:1px solid var(--color-border);
                        border-radius:var(--radius-md);">
                <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.07em;
                            color:var(--color-text-muted);margin-bottom:5px;">Why this score</div>
                <p style="font-size:12px;color:var(--color-text-secondary);line-height:1.6;margin:0;">${escHtml(o.rationale)}</p>
            </div>` : ''}
        </div>`;

    // Linked sprint stories — find stories that score >= 6 for this OKR index
    const coverage = window._okrCoverage;
    const storyScores = coverage?.storyScores || [];
    const linkedStories = storyScores.filter(s => (s.okrScores || [])[idx] >= 6);

    // Sprint coverage row for this OKR
    const storyCovRow = (coverage?.storyCoverage || []).find(row =>
        (row.okr || '').toLowerCase().includes((o.okr || '').slice(0, 20).toLowerCase()) ||
        (o.okr || '').toLowerCase().includes((row.okr || '').slice(0, 20).toLowerCase())
    );

    const sprintGoal = coverage?.sprintGoal || null;

    if (storyCovRow) {
        const gc = storyCovRow.sprintGoalAlignmentScore >= 70 ? COLORS.success
                 : storyCovRow.sprintGoalAlignmentScore >= 40 ? COLORS.warning : COLORS.danger;
        const cc = storyCovRow.coverageLevel === 'strong' ? COLORS.success
                 : storyCovRow.coverageLevel === 'partial' ? COLORS.warning : COLORS.danger;
        descHtml += `
        <div style="margin-bottom:14px;">
            <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.07em;
                        color:var(--color-text-muted);margin-bottom:6px;">Current Sprint</div>
            ${sprintGoal ? `
            <div style="padding:8px 12px;background:var(--color-bg-hover);border:1px solid var(--color-border);
                        border-radius:var(--radius-md);margin-bottom:8px;">
                <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.07em;
                            color:${COLORS.textMuted};margin-bottom:4px;">Sprint Goal</div>
                <p style="font-size:12px;color:var(--color-text-secondary);line-height:1.5;margin:0;">${escHtml(sprintGoal)}</p>
            </div>` : ''}
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                <div style="padding:8px 10px;background:var(--color-bg-hover);border:1px solid var(--color-border);border-radius:var(--radius-md);">
                    <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.07em;color:${COLORS.textMuted};margin-bottom:4px;">Story Points</div>
                    <span style="font-size:12px;font-weight:800;color:${cc};">${storyCovRow.executionScore ?? 0}%</span>
                    <span style="font-size:9px;font-weight:700;color:${cc};background:${cc}18;
                                 padding:1px 6px;border-radius:9999px;margin-left:4px;">${storyCovRow.coverageLevel || ''}</span>
                </div>
                <div style="padding:8px 10px;background:var(--color-bg-hover);border:1px solid var(--color-border);border-radius:var(--radius-md);">
                    <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.07em;color:${COLORS.textMuted};margin-bottom:4px;">Goal Alignment</div>
                    <span style="font-size:12px;font-weight:800;color:${gc};">${storyCovRow.sprintGoalAlignmentScore ?? 0}%</span>
                </div>
            </div>
            ${storyCovRow.note ? `<p style="font-size:11px;color:var(--color-text-muted);margin:6px 0 0;line-height:1.5;">${escHtml(storyCovRow.note)}</p>` : ''}
        </div>`;
    }

    const sources = linkedStories.map(s => ({
        label:      s.title + (s.points != null ? ` · ${s.points} SP` : ''),
        value:      `OKR score: ${(s.okrScores || [])[idx] || 0}/10`,
        tag:        s.status || 'Story',
        tagVariant: s.status === 'In Progress' ? 'success' : s.status === 'Done' ? 'neutral' : 'info',
    }));

    DrillDown.open({
        label:       `OKR Alignment · ${r}`,
        title:       o.okr || 'OKR',
        description: descHtml,
        sources,
        related:     [_rel.delta],
    });
}

// ── OKR Sprint bar helpers ───────────────────────────────────────────────────────────

// Match storyCoverage row by OKR text (used in drilldown)
function _findCovRow(okrText, coverage) {
    const a = (okrText || '').toLowerCase();
    return (coverage?.storyCoverage || []).find(row => {
        const b = (row.okr || '').toLowerCase();
        return b.includes(a.slice(0, 20)) || a.includes(b.slice(0, 20));
    });
}

// Compute sprint SP% for one OKR from storyScores (avoids the shared-denominator problem
// where all OKRs get the same executionScore when Claude assigns stories liberally).
// Stories with okrScore >= 6 count toward this OKR's share of total sprint SP.
function _okrSprintBarHtml(okrIdx, coverage) {
    const lbl = 'font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:var(--color-text-muted);margin-bottom:4px;';
    const emptyBar = '<div style="flex:1;height:4px;background:var(--color-border);border-radius:9999px;overflow:hidden;"></div>';
    if (!coverage) {
        return '<div style="' + lbl + '">Sprint SP</div>' +
               '<div style="display:flex;align-items:center;gap:5px;">' + emptyBar +
               '<span style="font-size:10px;color:var(--color-text-muted);">—</span></div>';
    }
    const stories = coverage.storyScores || [];
    if (!stories.length) {
        return '<div style="' + lbl + '">Sprint SP</div>' +
               '<div style="display:flex;align-items:center;gap:5px;">' + emptyBar +
               '<span style="font-size:10px;color:var(--color-text-muted);">—</span></div>';
    }
    const relevant = stories.filter(s => ((s.okrScores || [])[okrIdx] || 0) >= 6);
    const hasSP    = stories.some(s => s.points != null && s.points > 0);
    let pct;
    if (hasSP) {
        const total = stories.reduce((s, x) => s + (x.points || 0), 0);
        const rel   = relevant.reduce((s, x) => s + (x.points || 0), 0);
        pct = total > 0 ? Math.min(100, Math.round(rel / total * 100)) : 0;
    } else {
        pct = Math.min(100, Math.round(relevant.length / stories.length * 100));
    }
    const cc = pct >= 30 ? COLORS.success : pct >= 10 ? COLORS.warning : COLORS.danger;
    return '<div style="' + lbl + '">Sprint SP</div>' +
           '<div style="display:flex;align-items:center;gap:5px;">' +
           '<div style="flex:1;height:4px;background:var(--color-border);border-radius:9999px;overflow:hidden;">' +
           '<div style="height:4px;border-radius:9999px;background:' + cc + ';width:' + pct + '%;transition:width 0.5s ease;"></div></div>' +
           '<span style="font-size:10px;font-weight:800;color:' + cc + ';">' + pct + '%</span></div>';
}

function updateOKRSprintBars(coverage) {
    const okrAlignment = window._okrAlignmentData || [];
    okrAlignment.forEach((o, idx) => {
        const slot = document.querySelector('[data-sprint-bar="' + idx + '"]');
        if (slot) slot.innerHTML = _okrSprintBarHtml(idx, coverage);
    });
}

// ── OKR Story Coverage (injected into w-okr-coverage-slot) ───────────────────

window._okrCoverage  = null;
window._okrObjectives = [];

function renderOKRCoverage(coverage) {
    window._okrCoverage = coverage;
    const slot = document.getElementById('w-okr-sprint');
    if (!slot) return;

    if (coverage.error) {
        slot.innerHTML = `
            <div class="widget-label">Current Sprint Coverage</div>
            <p class="widget-desc">Which OKRs are represented by the stories in your current sprint.</p>
            <p style="font-size:13px;color:${COLORS.danger};margin-top:8px;">Unable to load coverage data.</p>`;
        return;
    }

    if (coverage.noObjectives || coverage.noData) {
        slot.innerHTML = `
            <div class="widget-label">Current Sprint Coverage</div>
            <p class="widget-desc">Which OKRs are represented by the stories in your current sprint.</p>
            <div class="empty-state" style="font-size:13px;color:${COLORS.textMuted};">
                ${coverage.noObjectives ? 'No OKRs configured.' : 'Add Hub signals and run a Radar analysis to see coverage.'}
            </div>`;
        return;
    }

    const coverageColor = l => l === 'strong' ? COLORS.success : l === 'partial' ? COLORS.warning : COLORS.danger;
    const coverageLabel = l => l === 'strong' ? 'Strong' : l === 'partial' ? 'Partial' : 'None';
    const goalColor     = s => s >= 70 ? COLORS.success : s >= 40 ? COLORS.warning : s > 0 ? COLORS.danger : COLORS.textMuted;

    const rows = (coverage.storyCoverage || []).map(item => {
        const c         = coverageColor(item.coverageLevel);
        const spPct     = item.executionScore ?? 0;
        const goalScore = item.sprintGoalAlignmentScore ?? 50;
        const gc        = goalColor(goalScore);
        return `
        <div class="widget-item" style="padding:10px 0;border-bottom:1px solid ${COLORS.border};" title="${escHtml(item.note || '')}">
            <div style="font-size:11px;color:${COLORS.textPrimary};font-weight:600;margin-bottom:8px;
                        white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                ${escHtml(item.okr)}
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">
                <div>
                    <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.07em;
                                color:${COLORS.textMuted};margin-bottom:4px;">Sprint SP</div>
                    <div style="display:flex;align-items:center;gap:6px;">
                        <div style="flex:1;height:5px;background:${COLORS.hoverBg};border-radius:9999px;overflow:hidden;">
                            <div style="height:5px;background:${c};border-radius:9999px;width:${spPct}%;"></div>
                        </div>
                        <span style="font-size:10px;font-weight:800;color:${c};flex-shrink:0;">${spPct}%</span>
                        <span style="font-size:9px;font-weight:700;color:${c};background:${c}18;
                                     padding:1px 6px;border-radius:9999px;flex-shrink:0;">${coverageLabel(item.coverageLevel)}</span>
                    </div>
                </div>
                <div>
                    <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.07em;
                                color:${COLORS.textMuted};margin-bottom:4px;">Sprint Goal Alignment</div>
                    <div style="display:flex;align-items:center;gap:6px;">
                        <div style="flex:1;height:5px;background:${COLORS.hoverBg};border-radius:9999px;overflow:hidden;">
                            <div style="height:5px;background:${gc};border-radius:9999px;width:${goalScore}%;"></div>
                        </div>
                        <span style="font-size:10px;font-weight:800;color:${gc};flex-shrink:0;">${goalScore}%</span>
                    </div>
                </div>
            </div>
        </div>`;
    }).join('');

    slot.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
            <div class="widget-label" style="margin-bottom:0;">Current Sprint Coverage</div>
            ${(coverage.storyScores || []).length ? `
            <button onclick="openOKRDetailModal()"
                    style="font-size:10px;font-weight:700;color:${COLORS.accent};background:rgba(176,90,56,0.08);
                           border:none;cursor:pointer;padding:3px 10px;border-radius:9999px;">
                Details →
            </button>` : ''}
        </div>
        <p class="widget-desc">Which OKRs are represented by the stories in your current sprint.</p>
        ${rows || `<p style="font-size:12px;color:${COLORS.textMuted};padding:4px 0;">No active stories found.</p>`}`;
    updateOKRSprintBars(coverage);
}

// ── OKR Detail Modal ──────────────────────────────────────────────────────────

function openOKRDetailModal() {
    const coverage   = window._okrCoverage;
    const objectives = window._okrObjectives || [];
    if (!coverage || !objectives.length) return;

    const stories = coverage.storyScores || [];

    // Legend in description
    const legendHtml = objectives.map((o, i) =>
        `<span style="font-size:11px;color:var(--color-text-secondary);background:var(--color-bg-hover);
                      border:1px solid var(--color-border);padding:3px 10px;border-radius:9999px;
                      white-space:nowrap;display:inline-block;margin:2px;"
              title="${escHtml(o)}">
            <strong style="color:var(--color-accent);">OKR ${i + 1}</strong> — ${escHtml(o.length > 50 ? o.slice(0, 50) + '…' : o)}
        </span>`).join('');

    const desc = `<p style="font-weight:var(--font-weight-bold);color:var(--color-text-primary);margin-bottom:10px;">Objectives</p>
        <div style="display:flex;flex-wrap:wrap;gap:2px;">${legendHtml}</div>`;

    // Sources: one per story — show OKR coverage
    const sources = stories.map(story => {
        const scores  = story.okrScores || [];
        const covered = scores
            .map((s, i) => ({ s, i }))
            .filter(x => x.s >= 6)
            .map(x => `OKR ${x.i + 1}`);
        return {
            label:      story.title + (story.points != null ? ` · ${story.points} SP` : ''),
            value:      covered.length ? covered.join(', ') : '—',
            tag:        story.status || '',
            tagVariant: story.status === 'In Progress' ? 'success' : 'neutral',
        };
    });

    DrillDown.open({
        label:       'Sprint Stories · OKR Relevance',
        title:       'OKR Relevance Breakdown',
        description: desc,
        sources,
    });
}

// ── Widget — Customer Demand vs OKRs ─────────────────────────────────────────

function renderDemandAlignment(coverage) {
    const el = document.getElementById('w-demand-okr');
    if (!el) return;

    if (coverage.error) {
        el.innerHTML = `
            <div class="widget-label">Customer Demand vs OKRs</div>
            <p class="widget-desc">Client requests captured in your Hub, mapped against your current OKRs.</p>
            <p style="font-size:13px;color:${COLORS.danger};margin-top:8px;">Error loading analysis.</p>`;
        return;
    }

    if (coverage.noObjectives) {
        el.innerHTML = `
            <div class="widget-label">Customer Demand vs OKRs</div>
            <p class="widget-desc">Client requests captured in your Hub, mapped against your current OKRs.</p>
            <div class="empty-state">
                <p style="font-weight:600;color:${COLORS.textSecondary};">No OKRs configured</p>
                <a href="/Modules/settings/settings.html"
                   style="font-size:12px;font-weight:700;color:${COLORS.accent};text-decoration:none;">Add in Settings →</a>
            </div>`;
        return;
    }

    if (coverage.noData) {
        el.innerHTML = `
            <div class="widget-label">Customer Demand vs OKRs</div>
            <p class="widget-desc">Client requests captured in your Hub, mapped against your current OKRs.</p>
            <p style="font-size:13px;color:${COLORS.textSecondary};font-weight:500;margin-top:8px;">
                Add Hub signals and run a Radar analysis to see demand alignment.
            </p>`;
        return;
    }

    const demand  = coverage.demandAlignment || [];
    const unalign = coverage.unalignedDemand || {};

    // Store for modal access
    window._demandCoverage = coverage;

    const alignColor = a => a === 'strong' ? COLORS.success : a === 'partial' ? COLORS.warning : COLORS.border;
    const alignLabel = a => a === 'strong' ? 'Strong' : a === 'partial' ? 'Partial' : 'None';
    const maxCount   = Math.max(...demand.map(d => d.signalCount || 0), 1);

    const rows = demand.map((item, idx) => {
        const c      = alignColor(item.alignment);
        const pct    = Math.round(((item.signalCount || 0) / maxCount) * 100);
        const sigList    = item.signals || [];
        const hasSignals = sigList.length > 0;
        const sigCount   = sigList.length;
        return `
        <div class="widget-item" onclick="openDemandSignalsModal('okr',${idx})"
             style="padding:9px 0;border-bottom:1px solid ${COLORS.border};cursor:pointer;transition:background 0.15s;">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:5px;">
                <span style="font-size:13px;color:${COLORS.textPrimary};font-weight:600;flex:1;
                             white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escHtml(item.okr)}</span>
                <span style="display:flex;align-items:center;gap:6px;flex-shrink:0;">
                    <span style="font-size:10px;font-weight:600;color:${c};background:${c}18;
                                 padding:2px 8px;border-radius:9999px;">${alignLabel(item.alignment)}</span>
                    <span style="font-size:10px;font-weight:600;color:${COLORS.accent};background:rgba(176,90,56,0.08);
                                 padding:2px 8px;border-radius:9999px;">${sigCount} signal${sigCount!==1?'s':''}</span>
                </span>
            </div>
            <div class="progress-track">
                <div class="progress-fill" style="width:${pct}%;background:${c};"></div>
            </div>
        </div>`;
    }).join('');

    const unalignSigs = unalign.signals || [];
    const hasUnalignedSignals = unalignSigs.length > 0;
    const unalignedHtml = hasUnalignedSignals ? `
        <div class="widget-item" onclick="openDemandSignalsModal('unaligned')"
             style="margin-top:14px;padding:12px 14px;background:rgba(160,120,48,0.08);border-radius:12px;
                    border:1px solid rgba(160,120,48,0.30);cursor:pointer;transition:background 0.15s;"
             onmouseenter="this.style.background='rgba(160,120,48,0.15)'"
             onmouseleave="this.style.background='rgba(160,120,48,0.08)'">
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
                <span style="font-size:12px;font-weight:700;color:${COLORS.warningAlt};">
                    ${unalignSigs.length} signal${unalignSigs.length !== 1 ? 's' : ''} outside your OKRs
                </span>
            </div>
            ${(unalign.topics || []).length ? `
                <p style="font-size:11px;color:${COLORS.warningAlt};line-height:1.5;">
                    ${escHtml((unalign.topics || []).slice(0, 5).join(' · '))}</p>` : ''}
            ${unalign.note ? `
                <p style="font-size:11px;color:${COLORS.warningAlt};margin-top:4px;font-style:italic;">${escHtml(unalign.note)}</p>` : ''}
        </div>` : '';

    el.innerHTML = `
        <div class="widget-label">Customer Demand vs OKRs</div>
        <p class="widget-desc">Client requests captured in your Hub, mapped against your current OKRs.</p>
        ${rows || `<p style="font-size:13px;color:${COLORS.textMuted};margin-top:8px;">No demand data available.</p>`}
        ${unalignedHtml}`;
}

// ── Demand Signals Modal ──────────────────────────────────────────────────────

window._demandCoverage = null;

function openDemandSignalsModal(type, okrIdx) {
    const coverage = window._demandCoverage;
    if (!coverage) return;

    let title, label, note, signals;

    if (type === 'unaligned') {
        const u = coverage.unalignedDemand || {};
        label   = 'Strategic Blind Spot';
        title   = 'Signals Outside Your OKRs';
        note    = u.note || '';
        signals = u.signals || [];
    } else {
        const item = (coverage.demandAlignment || [])[okrIdx];
        if (!item) return;
        signals = item.signals || [];
        if (!signals.length) return;
        label   = 'Customer Demand';
        title   = item.okr;
        note    = `${signals.length} signal${signals.length !== 1 ? 's' : ''} · ${item.alignment === 'strong' ? 'Strong alignment' : item.alignment === 'partial' ? 'Partial alignment' : 'No demand'}`;
    }

    // Store signals so groom buttons can reference them
    window._dsmSignals = signals;

    const signalsHtml = !signals.length
        ? `<p style="font-size:var(--font-size-sm);color:var(--color-text-muted);font-style:italic;">
               No signal details available — re-run the coverage analysis to load them.</p>`
        : signals.map((sig, i) => {
            const text = sig.text || sig;
            const src  = sig.sourceType || '';
            return `
            <div style="background:var(--color-bg-hover);border:1px solid var(--color-border);
                        border-radius:var(--radius-md);padding:12px 14px;margin-bottom:8px;">
                ${src ? `<div style="font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:0.08em;
                                     color:var(--color-text-muted);margin-bottom:4px;">${escHtml(src)}</div>` : ''}
                <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">
                    <p style="font-size:var(--font-size-sm);color:var(--color-text-primary);line-height:1.6;margin:0;font-style:italic;">
                        "${escHtml(text)}"
                    </p>
                    <button onclick="groomSignal(${i})"
                            style="flex-shrink:0;font-size:10px;font-weight:700;color:var(--color-accent);
                                   background:var(--color-accent-subtle);border:none;cursor:pointer;
                                   padding:5px 12px;border-radius:9999px;white-space:nowrap;font-family:var(--font-family);">
                        Groom →
                    </button>
                </div>
            </div>`;
        }).join('');

    const groomListHtml = signals.length
        ? `<div style="display:flex;flex-direction:column;gap:6px;margin-top:4px;">` +
          signals.map((sig, i) => {
              const src = sig.sourceType || '';
              return `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;
                                  padding:6px 10px;background:var(--color-bg-hover);
                                  border:1px solid var(--color-border);border-radius:var(--radius-md);">
                          ${src ? `<span style="font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:0.07em;
                                               color:var(--color-text-muted);flex-shrink:0;">${escHtml(src)}</span>` : ''}
                          <button onclick="groomSignal(${i})"
                                  style="font-size:10px;font-weight:700;color:var(--color-accent);
                                         background:var(--color-accent-subtle);border:none;cursor:pointer;
                                         padding:4px 12px;border-radius:9999px;white-space:nowrap;
                                         font-family:var(--font-family);flex-shrink:0;margin-left:auto;">
                              Groom →
                          </button>
                      </div>`;
          }).join('') + `</div>`
        : '';

    const sources = signals.map(sig => {
        const text = sig.text || sig;
        return {
            label:      text.length > 80 ? text.slice(0, 80) + '…' : text,
            tag:        sig.sourceType || 'Signal',
            tagVariant: sig.sourceType === 'Bug' ? 'danger'
                      : sig.sourceType === 'Support Ticket' ? 'warning'
                      : 'info',
            body:       text.length > 80 ? text : undefined,
        };
    });

    DrillDown.open({
        label,
        title,
        description: (note ? `<p style="font-style:italic;color:var(--color-text-secondary);margin-bottom:14px;">${escHtml(note)}</p>` : '')
                   + groomListHtml,
        sources,
    });
}

function groomSignal(idx) {
    const sig  = (window._dsmSignals || [])[idx];
    const text = sig?.text || sig || '';
    localStorage.setItem('pendingStoryIdea', text);
    window.location.href = '/Modules/story-grooming/story-grooming.html';
}

// ── Widget 3 — Top Emerging Trends ───────────────────────────────────────────

window._signalTrends = [];

function renderSignals(analysis, historyFiles) {
    const el = document.getElementById('w-signals');

    if (!analysis) {
        el.innerHTML = `
            <div class="widget-label">Top Emerging Trends</div>
            <p class="widget-desc">Signals gaining frequency across clients and stakeholders.</p>
            <div class="empty-state" style="padding:16px 0;">
                <p style="font-weight:600;color:${COLORS.textSecondary};margin-bottom:10px;font-size:13px;">No Radar analysis yet</p>
                <button onclick="document.getElementById('dashRunAnalysisBtn')?.click()"
                        style="font-size:11px;font-weight:700;color:${COLORS.accent};background:rgba(176,90,56,0.08);
                               padding:6px 14px;border-radius:9999px;border:none;cursor:pointer;font-family:var(--font-family);">
                    Run First Analysis →
                </button>
            </div>`;
        return;
    }

    const trends = (analysis.trends || []).slice(0, 3);

    // Resolve source entries: exact ID lookup when AI provides source_ids, keyword fallback otherwise
    const allEntries = window._cachedEntries || [];
    const entryById  = Object.fromEntries(allEntries.map(e => [e.id, e]));
    trends.forEach(t => {
        if (t.source_ids?.length) {
            t._matchedEntries = t.source_ids.map(id => entryById[id]).filter(Boolean);
            return;
        }
        // Fallback for analyses that predate source_ids support
        if (!allEntries.length || typeof _phStopWords === 'undefined') { t._matchedEntries = []; return; }
        const combined = ((t.topic || '') + ' ' + (t.description || '')).toLowerCase()
            .replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
            .filter(w => w.length >= 4 && !_phStopWords.has(w));
        const words = [...new Set(combined)];
        if (!words.length) { t._matchedEntries = []; return; }
        const scored = allEntries
            .map(e => ({ e, hits: words.filter(w => (e.body || '').toLowerCase().includes(w)).length }))
            .filter(({ hits }) => hits > 0)
            .sort((a, b) => b.hits - a.hits);
        const cap = t.evidence_count > 0 ? t.evidence_count : scored.length;
        t._matchedEntries = scored.slice(0, cap).map(({ e }) => e);
    });

    window._signalTrends = trends;

    // Compute "last radar X days ago" from most recent history filename timestamp
    let daysAgoLabel = '';
    if (historyFiles.length > 0) {
        const ts = historyFiles[0].match(/\d+/);
        if (ts) {
            const days = Math.floor((Date.now() - parseInt(ts[0])) / 86400000);
            daysAgoLabel = days === 0 ? 'Today' : days === 1 ? '1 day ago' : `${days} days ago`;
        }
    }

    const signalHtml = trends.map((t, i) => {
        const dot   = signalDotClass(t);
        const count = t.evidence_count != null ? t.evidence_count : null;
        const countBadge = count != null
            ? `<span style="font-size:10px;font-weight:600;color:${COLORS.accent};background:rgba(176,90,56,0.08);
                            padding:2px 8px;border-radius:9999px;flex-shrink:0;">${count} signal${count !== 1 ? 's' : ''}</span>`
            : '';
        return `
        <div class="widget-item" onclick="openSignalModal(${i})"
             style="display:flex;align-items:center;gap:10px;padding:9px 8px;border-bottom:1px solid ${COLORS.border};
                    cursor:pointer;border-radius:8px;transition:background 0.12s;"
             onmouseover="this.style.background=COLORS.hoverBg" onmouseout="this.style.background='transparent'">
            <div class="signal-dot ${dot}" style="flex-shrink:0;"></div>
            <div style="flex:1;min-width:0;">
                <p style="font-size:13px;font-weight:600;color:${COLORS.textPrimary};line-height:1.4;margin:0 0 1px;">
                    ${escHtml(t.topic || '')}
                </p>
                ${t.persona_impacted ? `<p style="font-size:11px;color:${COLORS.textMuted};margin:0;">${escHtml(t.persona_impacted)}</p>` : ''}
            </div>
            ${countBadge}
            <span style="font-size:13px;color:${COLORS.textMuted};flex-shrink:0;">›</span>
        </div>`;
    }).join('');

    el.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
            <div class="widget-label" style="margin-bottom:0;">Top Emerging Trends</div>
            <span style="font-size:10px;color:${COLORS.textMuted};font-weight:600;">${escHtml(daysAgoLabel)}</span>
        </div>
        <p class="widget-desc">Signals gaining frequency across clients and stakeholders.</p>
        ${signalHtml}`;
}

function openSignalModal(idx) {
    const t = (window._signalTrends || [])[idx];
    if (!t) return;

    const evolutionConfig = {
        rising:    { text:'var(--color-success)', label:'↑ Rising'    },
        stable:    { text:'var(--color-text-muted)', label:'→ Stable' },
        declining: { text:'var(--color-danger)',  label:'↓ Declining' },
    };
    const ev        = evolutionConfig[(t.evolution || '').toLowerCase()] || evolutionConfig.stable;
    const alignment = t.strategic_alignment ?? null;
    const count     = t.evidence_count ?? null;
    const ideaText  = t.description
        ? `${t.topic}: ${t.description}`
        : t.topic || '';

    DrillDown.open({
        label:       'Strategic Signal',
        title:       t.topic || '',
        description: `<p>${escHtml(t.description || 'No description available.')}</p>
            ${t.persona_impacted
                ? `<p style="font-size:var(--font-size-xs);color:var(--color-text-muted);margin-top:6px;">Impacted persona: <em>${escHtml(t.persona_impacted)}</em></p>`
                : ''}
            <div style="margin-top:14px;">
                <button onclick="groomFromAnalysis('${escHtml(ideaText).replace(/'/g, '&#39;')}')"
                        style="font-size:10px;font-weight:700;color:var(--color-accent);
                               background:var(--color-accent-subtle);border:none;cursor:pointer;
                               padding:5px 14px;border-radius:9999px;font-family:var(--font-family);">
                    Generate Story →
                </button>
            </div>`,
        details: [
            alignment != null            ? { label: 'Strategic Alignment', value: `${alignment}%`              } : null,
            count     != null            ? { label: 'Signal Count',        value: String(count)                 } : null,
            { label: 'Evolution',          value: ev.label                                                        },
            t.signal_strength            ? { label: 'Strength',            value: escHtml(t.signal_strength)    } : null,
        ].filter(Boolean),
        sources: (t._matchedEntries || [])
            .sort((a, b) => new Date(b.date || b.createdAt || 0) - new Date(a.date || a.createdAt || 0))
            .map(e => ({
                label:      (e.body || '').slice(0, 80) + ((e.body || '').length > 80 ? '…' : ''),
                value:      (e.date || e.createdAt)
                    ? new Date(e.date || e.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                    : undefined,
                tag:        e.sourceType || 'Signal',
                tagVariant: 'info',
                body:       [e.person ? `From: ${e.person}` : null, e.body || ''].filter(Boolean).join('\n'),
            })),
        related:  [_rel.delta, _rel.okr],
    });
}

// ── Widget — Longitudinal Insights ───────────────────────────────────────────

function renderLongitudinalInsights(analysis) {
    const el = document.getElementById('w-longitudinal-insights');
    if (!el) return;

    const long = analysis?.longitudinal || {};
    const acc   = long.accelerating_trends       || [];
    const dec   = long.decelerating_trends       || [];
    const vel   = long.velocity_alerts           || [];
    const cont  = long.persistent_contradictions || [];
    const weak  = long.weak_signal_alert         || '';

    const hasData = acc.length || dec.length || vel.length || cont.length || weak;
    if (!hasData) { el.style.display = 'none'; return; }

    el.style.display = '';

    const velocityColor = v => {
        const s = (v || '').toLowerCase();
        if (s.includes('rapide') || s.includes('fast') || s.includes('rapid'))
            return { dot: COLORS.danger,   bg: 'var(--color-danger-subtle)',  label: v };
        if (s.includes('modér') || s.includes('moderate'))
            return { dot: COLORS.warning,  bg: 'var(--color-warning-subtle)', label: v };
        return { dot: COLORS.success, bg: 'var(--color-success-subtle)', label: v };
    };

    const section = (title, icon, items, renderFn) => {
        if (!items.length) return '';
        return `
        <div>
            <div style="font-size:var(--font-size-xs);font-weight:var(--font-weight-bold);
                        text-transform:uppercase;letter-spacing:var(--letter-spacing-wider);
                        color:var(--color-text-muted);margin-bottom:8px;">${icon} ${title}</div>
            ${items.map(renderFn).join('')}
        </div>`;
    };

    const stringRow = item => `
        <div style="display:flex;align-items:flex-start;gap:8px;padding:6px 0;
                    border-bottom:1px solid var(--color-border);" class="widget-item">
            <div style="width:6px;height:6px;border-radius:50%;background:var(--color-text-muted);
                        flex-shrink:0;margin-top:5px;"></div>
            <p style="font-size:var(--font-size-sm);color:var(--color-text-primary);margin:0;
                      line-height:var(--line-height-relaxed);">${escHtml(typeof item === 'string' ? item : (item.topic || item.signal || JSON.stringify(item)))}</p>
        </div>`;

    const velocityRow = item => {
        const cfg = velocityColor(item.velocity);
        return `
        <div style="display:flex;align-items:flex-start;gap:10px;padding:8px 0;
                    border-bottom:1px solid var(--color-border);" class="widget-item">
            <div style="width:6px;height:6px;border-radius:50%;background:${cfg.dot};
                        flex-shrink:0;margin-top:5px;"></div>
            <div style="flex:1;min-width:0;">
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:3px;">
                    <span style="font-size:var(--font-size-sm);font-weight:var(--font-weight-medium);
                                 color:var(--color-text-primary);">${escHtml(item.topic || '')}</span>
                    <span style="font-size:10px;font-weight:700;color:${cfg.dot};background:${cfg.bg};
                                 padding:1px 8px;border-radius:9999px;flex-shrink:0;">${escHtml(cfg.label)}</span>
                </div>
                ${item.projection ? `<p style="font-size:var(--font-size-xs);color:var(--color-text-secondary);
                                               margin:0;line-height:var(--line-height-relaxed);">${escHtml(item.projection)}</p>` : ''}
            </div>
        </div>`;
    };

    const sections = [
        section('Accelerating Trends',       '🚀', acc,  stringRow),
        section('Fading Trends',              '📉', dec,  stringRow),
        section('Signal Velocity',            '⚡', vel,  velocityRow),
        section('Persistent Contradictions',  '↕',  cont, stringRow),
    ].filter(Boolean);

    const weakHtml = weak ? `
        <div style="padding:12px 16px;background:var(--color-accent-subtle);
                    border:1px solid var(--color-accent-border);border-radius:var(--radius-md);">
            <div style="font-size:var(--font-size-xs);font-weight:var(--font-weight-bold);
                        text-transform:uppercase;letter-spacing:var(--letter-spacing-wider);
                        color:var(--color-accent);margin-bottom:6px;">🔮 Weak Signal Alert</div>
            <p style="font-size:var(--font-size-sm);color:var(--color-text-secondary);
                      margin:0;line-height:var(--line-height-relaxed);">${escHtml(weak)}</p>
        </div>` : '';

    el.innerHTML = `
        <div class="widget-label">Longitudinal Insights</div>
        <p class="widget-desc">Long-term trend acceleration, signal velocity, and persistent contradictions.</p>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:24px;margin-top:4px;">
            ${sections.join('')}
        </div>
        ${weakHtml ? `<div style="margin-top:16px;">${weakHtml}</div>` : ''}`;
}

function signalDotClass(trend) {
    const strength   = (trend.signal_strength || '').toLowerCase();
    const evolution  = (trend.evolution || '').toLowerCase();
    const alignment  = trend.strategic_alignment || 0;

    if (strength.includes('établi') && alignment >= 70) return 'dot-red';
    if (strength.includes('émerge') || evolution.includes('croiss')) return 'dot-yellow';
    return 'dot-green';
}

// ── Widget 5 — Silent Signals Alert ──────────────────────────────────────────

function renderSilentSignals(analysis, staleDate = null, currentLongitudinal = null) {
    const el = document.getElementById('w-silent');

    if (!analysis) {
        el.innerHTML = `
            <div class="widget-label">Silent Signals</div>
            <p class="widget-desc">Themes raised in previous sprints that have since gone quiet.</p>
            <div class="empty-state" style="padding:10px 0;">
                <p style="font-size:12px;color:${COLORS.textMuted};">Run a Radar analysis to detect silent signals.</p>
            </div>`;
        return;
    }

    const longitudinal = analysis.longitudinal || {};

    // Not enough data yet
    if (longitudinal.status === 'insufficient_data' || !longitudinal.silent_signals) {
        el.innerHTML = `
            <div class="widget-label">Silent Signals</div>
            <p class="widget-desc">Themes raised in previous sprints that have since gone quiet.</p>
            <div style="padding:4px 0;">${longitudinalGateHtml(longitudinal)}</div>`;
        return;
    }

    const signals = longitudinal.silent_signals || [];
    window._silentSignals = signals;

    const staleBadge = staleDate
        ? `<span style="font-size:10px;font-weight:700;color:${COLORS.warningAlt};background:rgba(160,120,48,0.08);
                        padding:2px 8px;border-radius:9999px;">Last analyzed: ${staleDate}</span>`
        : '';

    if (!signals.length) {
        el.innerHTML = `
            <div class="widget-label" style="display:flex;align-items:center;gap:8px;">Silent Signals ${staleBadge}</div>
            <p class="widget-desc">Themes raised in previous sprints that have since gone quiet.</p>
            <p style="font-size:13px;color:${COLORS.success};font-weight:700;margin-top:8px;">
                No silent signals detected
            </p>
            ${nextAnalysisFooter(currentLongitudinal)}`;
        return;
    }

    const riskColor = (level) => {
        const l = (level || '').toLowerCase();
        if (l.includes('high') || l.includes('élevé')) return COLORS.danger;
        if (l.includes('med')  || l.includes('moyen')) return COLORS.warning;
        return COLORS.success;
    };

    el.innerHTML = `
        <div class="widget-label" style="display:flex;align-items:center;gap:8px;">Silent Signals ${staleBadge}</div>
        <p class="widget-desc">Themes raised in previous sprints that have since gone quiet.</p>
        <div style="display:flex;flex-direction:column;">
            ${signals.map((s, i) => `
            <div class="widget-item" style="display:flex;align-items:flex-start;gap:10px;padding:9px 8px;border-bottom:1px solid ${COLORS.border};cursor:pointer;border-radius:8px;transition:background 0.12s;"
                 onmouseover="this.style.background=COLORS.hoverBg" onmouseout="this.style.background='transparent'"
                 onclick="openSilentSignalModal(${i})">
                <div style="width:8px;height:8px;border-radius:50%;background:${riskColor(s.risk_level)};flex-shrink:0;margin-top:4px;"></div>
                <div style="flex:1;min-width:0;">
                    <p style="font-size:13px;font-weight:600;color:${COLORS.textPrimary};margin:0 0 2px;line-height:1.4;">${escHtml(s.topic || '')}</p>
                    ${s.hypothesis ? `<p style="font-size:11px;color:${COLORS.textSecondary};margin:0;line-height:1.4;">${escHtml(s.hypothesis)}</p>` : ''}
                </div>
                <span style="font-size:13px;color:${COLORS.textMuted};flex-shrink:0;">›</span>
            </div>`).join('')}
        </div>
        ${nextAnalysisFooter(currentLongitudinal)}`;
}

function openSilentSignalModal(idx) {
    const s = (window._silentSignals || [])[idx];
    if (!s) return;

    const riskColor = (level) => {
        const l = (level || '').toLowerCase();
        if (l.includes('high') || l.includes('élevé')) return 'danger';
        if (l.includes('med')  || l.includes('moyen')) return 'warning';
        return 'success';
    };

    DrillDown.open({
        label:       'Silent Signal',
        title:       s.topic || '',
        description: [
            s.hypothesis ? `<p>${escHtml(s.hypothesis)}</p>` : '',
            s.last_seen   ? `<p style="font-size:11px;color:${COLORS.textSecondary};margin-top:6px;">Last seen: ${escHtml(s.last_seen)}</p>` : '',
        ].filter(Boolean).join('') || '<p>No additional detail available.</p>',
        details: s.risk_level
            ? [{ label: 'Risk level', value: s.risk_level }]
            : [],
        sources: s.risk_level ? [{
            label:      s.topic || s.risk_level,
            tag:        s.risk_level,
            tagVariant: riskColor(s.risk_level),
            body:       s.hypothesis || undefined,
        }] : [],
    });
}

// ── Utils ─────────────────────────────────────────────────────────────────────

function nextAnalysisFooter(currentLongitudinal) {
    if (!currentLongitudinal) return '';
    return `
        <div style="margin-top:14px;padding-top:12px;border-top:1px solid ${COLORS.border};">
            <p style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:0.08em;
                      color:${COLORS.textMuted};margin-bottom:4px;">Next fresh analysis</p>
            ${longitudinalGateHtml(currentLongitudinal)}
        </div>`;
}

function hasLongitudinalData(analysis) {
    const l = analysis?.longitudinal;
    return l && l.status !== 'insufficient_data' &&
           (l.silent_signals?.length || l.churn_signals?.length || l.recurring_signals?.length);
}

async function findBestLongitudinalAnalysis(historyFiles) {
    // historyFiles[0] is already loaded; search the rest (up to 30)
    for (let i = 1; i < Math.min(historyFiles.length, 31); i++) {
        try {
            const hist = await Auth.fetch(`/api/history/${historyFiles[i]}`).then(r => r.json());
            if (hasLongitudinalData(hist?.analysis)) {
                const ts   = historyFiles[i].match(/\d+/)?.[0];
                const date = ts
                    ? new Date(parseInt(ts)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                    : null;
                return { analysis: hist.analysis, date };
            }
        } catch(e) { /* skip corrupt file */ }
    }
    return null;
}

// Shared helper: returns the "not ready yet" HTML for longitudinal widgets.
// The server requires BOTH ≥4 sprints AND ≥60 days — this shows which gate is blocking.
function longitudinalGateHtml(longitudinal) {
    const sprintsDone = longitudinal.sprints_completed || 0;
    const sprintsNeed = longitudinal.sprints_required  || 4;
    const daysDone    = longitudinal.days_accumulated  || 0;
    const daysNeed    = longitudinal.days_required     || 60;

    let label, pct;
    if (sprintsDone >= sprintsNeed) {
        // Sprint gate passed — days-of-history gate is blocking
        label = `Available after ${daysNeed} days of history · ${daysDone}/${daysNeed} days`;
        pct   = Math.min(100, Math.round((daysDone / daysNeed) * 100));
    } else {
        // Sprint count gate is blocking
        label = `Available after ${sprintsNeed} sprints · ${sprintsDone}/${sprintsNeed} completed`;
        pct   = Math.min(100, Math.round((sprintsDone / sprintsNeed) * 100));
    }

    return `
        <p style="font-size:12px;color:${COLORS.textSecondary};font-weight:600;margin-top:6px;margin-bottom:10px;line-height:1.5;">${label}</p>
        <div class="progress-track" style="height:8px;">
            <div class="progress-fill" style="width:${pct}%;background:linear-gradient(90deg,var(--color-accent),${COLORS.accentLight});"></div>
        </div>
        <p style="font-size:10px;color:${COLORS.textMuted};margin-top:5px;font-weight:600;">${pct}% complete</p>`;
}

// ── History Panel ─────────────────────────────────────────────────────────────

function _reRenderRadarWidgets(analysis) {
    renderStatusBar(analysis, _cachedSettings);
    renderAttention(analysis, _cachedSettings);
    renderStrategicFocus(analysis);
    renderStakeholderPosture(analysis);
    renderDelta(analysis);
    renderOKR(_cachedSettings, analysis, _cachedHistoryFiles);
    renderSignals(analysis, _cachedHistoryFiles);

    renderSilentSignals(analysis);
    renderLongitudinalInsights(analysis);
}

// ── Radar Meta Drilldown ──────────────────────────────────────────────────────

function openRadarMetaDrillDown() {
    const analysis      = window._lastAnalysis        || null;
    const meta          = window._lastRadarMeta       || null;   // only set when /api/analyze runs live
    const sprintMemory  = window._lastRadarSprintMemory;         // stored in history file

    if (!analysis) {
        DrillDown.open({
            label:       'Radar Analysis',
            title:       'No Analysis Yet',
            description: '<p>Run your first Radar analysis to see pipeline details.</p>',
            sources:     [],
        });
        return;
    }

    // Derive flags — prefer live meta, fall back to fields available in stored history
    const long        = analysis.longitudinal || {};
    const memoryActive = meta != null ? meta.memory_used
                       : (sprintMemory != null);                 // sprint_memory present → memory was used
    const longActive   = meta != null ? meta.longitudinal_triggered
                       : (long.status === 'available');
    const sprints      = meta?.sprints_available
                      ?? long.sprints_completed
                      ?? long.sprints_analyzed
                      ?? null;
    const sprintsReq   = long.sprints_required ?? 4;
    const daysAcc      = long.days_accumulated ?? 0;
    const daysReq      = long.days_required    ?? 60;

    // ── Pipeline flag row ─────────────────────────────────────────────────────
    const flag = (active, labelOn, labelOff, descOn, descOff) => `
        <div style="display:flex;align-items:flex-start;gap:12px;padding:10px 0;
                    border-bottom:1px solid var(--color-border);">
            <div style="width:8px;height:8px;border-radius:50%;margin-top:4px;flex-shrink:0;
                        background:${active ? COLORS.success : COLORS.border};"></div>
            <div style="flex:1;min-width:0;">
                <div style="font-size:var(--font-size-sm);font-weight:var(--font-weight-medium);
                            color:var(--color-text-primary);">${active ? labelOn : labelOff}</div>
                <div style="font-size:var(--font-size-xs);color:var(--color-text-muted);margin-top:2px;">
                    ${active ? descOn : descOff}</div>
            </div>
            <span style="font-size:10px;font-weight:800;flex-shrink:0;padding:2px 8px;border-radius:9999px;
                         color:${active ? COLORS.success : COLORS.textMuted};
                         background:${active ? 'var(--color-success-subtle)' : 'var(--color-bg-hover)'};">
                ${active ? 'Active' : 'Off'}
            </span>
        </div>`;

    // ── Data breakdown (only available from live meta, not history) ───────────
    const bd = meta?.data_breakdown;
    const breakdownHtml = bd ? `
        <div style="margin-bottom:20px;">
            <div style="font-size:var(--font-size-xs);font-weight:var(--font-weight-bold);
                        text-transform:uppercase;letter-spacing:var(--letter-spacing-wider);
                        color:var(--color-text-muted);margin-bottom:8px;">Signal Breakdown</div>
            ${[
                { dot: COLORS.danger,    label: 'Recent signals',  sub: '≤ 14 days — highest weight',     value: bd.high       },
                { dot: COLORS.warning,   label: 'Current signals', sub: '15–60 days — normal weight',     value: bd.medium     },
                { dot: COLORS.textMuted, label: 'Context signals', sub: '> 60 days — background context', value: bd.background },
            ].map(r => `
                <div style="display:flex;align-items:center;gap:12px;padding:8px 0;
                            border-bottom:1px solid var(--color-border);">
                    <div style="width:7px;height:7px;border-radius:50%;background:${r.dot};flex-shrink:0;"></div>
                    <div style="flex:1;">
                        <div style="font-size:var(--font-size-sm);font-weight:var(--font-weight-medium);
                                    color:var(--color-text-primary);">${r.label}</div>
                        <div style="font-size:var(--font-size-xs);color:var(--color-text-muted);">${r.sub}</div>
                    </div>
                    <span style="font-size:var(--font-size-sm);font-weight:900;
                                 color:var(--color-text-primary);">${r.value ?? '—'}</span>
                </div>`).join('')}
        </div>` : '';

    const descHtml = `
        ${breakdownHtml}
        <div>
            <div style="font-size:var(--font-size-xs);font-weight:var(--font-weight-bold);
                        text-transform:uppercase;letter-spacing:var(--letter-spacing-wider);
                        color:var(--color-text-muted);margin-bottom:4px;">Pipeline Modules</div>
            ${flag(
                memoryActive,
                'Sprint Memory — Delta active',
                'Sprint Memory — No prior snapshot',
                'Previous sprint data was loaded. Sprint Delta (new, resolved, reversed signals) is available.',
                'First analysis or memory cleared. No Sprint Delta available for this run.'
            )}
            ${flag(
                longActive,
                'Longitudinal Analysis — Active',
                'Longitudinal Analysis — Pending',
                `Long-term patterns analyzed across ${sprints ?? '?'} sprint${sprints !== 1 ? 's' : ''}. Silent signals, velocity alerts, and churn risk are live.`,
                `Requires ≥${sprintsReq} sprints and ≥${daysReq} days. Currently ${sprints ?? 0} sprint${(sprints ?? 0) !== 1 ? 's' : ''} · ${daysAcc} days accumulated.`
            )}
        </div>`;

    DrillDown.open({
        label:       'Radar Analysis · Pipeline',
        title:       'How This Analysis Was Built',
        description: descHtml,
        sources:     [],
    });
}

window._loadHistoryEntry = async function(filename, labelEl) {
    // Mark active
    document.querySelectorAll('.dash-history-card').forEach(c => {
        c.style.background   = 'var(--color-bg-hover)';
        c.style.borderColor  = 'var(--color-border)';
        c.style.fontWeight   = '';
    });
    if (labelEl) {
        labelEl.style.background  = 'var(--color-accent-subtle)';
        labelEl.style.borderColor = 'var(--color-accent-border)';
    }

    try {
        const radar    = await Auth.fetch(`/api/history/${filename}`).then(r => r.json());
        const analysis = radar?.analysis ?? null;

        _reRenderRadarWidgets(analysis);
        if (typeof window._reRenderHealthWidgets === 'function') {
            window._reRenderHealthWidgets(analysis);
        }

        // Show "viewing" label in header
        const ts    = filename.match(/\d+/)?.[0];
        const label = ts
            ? new Date(parseInt(ts)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
            : filename;
        const badge = document.getElementById('historyActiveLabel');
        if (badge) {
            badge.textContent = `Viewing: ${label}`;
            badge.style.display = 'block';
        }

        DrillDown.close();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
        console.error('History load error:', e);
    }
};

window.openHistoryPanel = async function() {
    DrillDown.open({
        label:       'Radar History',
        title:       'Past Analyses',
        description: '<p style="color:var(--color-text-muted);">Loading…</p>',
        sources:     [],
    });

    try {
        const [files, currentSprint] = await Promise.all([
            Auth.fetch('/api/history').then(r => r.json()).catch(() => []),
            Auth.fetch('/api/sprints/current').then(r => r.ok ? r.json() : null).catch(() => null),
        ]);

        if (!files || !files.length) {
            DrillDown.open({
                label:       'Radar History',
                title:       'Past Analyses',
                description: '<p style="color:var(--color-text-muted);">No analyses yet. Run your first analysis with the button above.</p>',
                sources:     [],
            });
            return;
        }

        const fmt = d => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

        const cardsHtml = files.map((file, i) => {
            const ts           = file.match(/\d+/)?.[0];
            const analysisDate = ts ? new Date(parseInt(ts)) : null;

            let sprintLabel = `Analysis #${files.length - i}`;
            let dateRange   = analysisDate
                ? analysisDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                : file;
            let isCurrent = false;

            if (currentSprint && analysisDate) {
                const start = new Date(currentSprint.start_date);
                const end   = new Date(currentSprint.end_date);
                if (analysisDate >= start && analysisDate <= end) {
                    sprintLabel = currentSprint.name || `Sprint ${currentSprint.sprint_number}`;
                    dateRange   = `${fmt(currentSprint.start_date)} → ${fmt(currentSprint.end_date)}`;
                    isCurrent   = true;
                }
            }

            return `
            <div class="dash-history-card"
                 style="background:var(--color-bg-hover);border:1px solid var(--color-border);
                        border-radius:var(--radius-md);padding:12px 14px;margin-bottom:8px;
                        display:flex;align-items:center;justify-content:space-between;gap:12px;
                        cursor:pointer;transition:border-color 0.15s;"
                 onclick="window._loadHistoryEntry('${escHtml(file)}', this)"
                 onmouseover="this.style.borderColor='var(--color-accent-border)'"
                 onmouseout="this.style.borderColor='var(--color-border)'">
                <div style="min-width:0;">
                    <div style="display:flex;align-items:center;gap:8px;margin-bottom:2px;">
                        <span style="font-size:var(--font-size-sm);font-weight:var(--font-weight-bold);
                                     color:var(--color-text-primary);">${escHtml(sprintLabel)}</span>
                        ${isCurrent ? `<span style="font-size:9px;font-weight:800;text-transform:uppercase;
                                              letter-spacing:0.08em;color:var(--color-accent);
                                              background:var(--color-accent-subtle);padding:1px 6px;
                                              border-radius:9999px;">Current</span>` : ''}
                    </div>
                    <div style="font-size:var(--font-size-xs);color:var(--color-text-muted);">${escHtml(dateRange)}</div>
                </div>
                <span style="font-size:13px;color:var(--color-text-muted);flex-shrink:0;">›</span>
            </div>`;
        }).join('');

        DrillDown.open({
            label:       'Radar History',
            title:       'Past Analyses',
            description: `<p style="color:var(--color-text-muted);margin-bottom:14px;">
                              Select an analysis to load it into the dashboard.
                          </p>${cardsHtml}`,
            sources:     [],
        });
    } catch (e) {
        console.error('History panel error:', e);
    }
};


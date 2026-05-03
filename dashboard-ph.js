// ── Product Health widgets ────────────────────────────────────────────────────
// Runs independently from dashboard.js; Auth singleton is cached so requireAuth()
// resolves immediately after the first call in dashboard.js.

document.addEventListener('DOMContentLoaded', async () => {
    const ok = await Auth.requireAuth();
    if (!ok) return;

    // Onboarding gate — redirect new users before loading anything
    const onboardingRes = await Auth.fetch('/api/onboarding');
    const onboarding    = await onboardingRes.json();
    if (!onboarding.completed) {
        window.location.href = '/onboarding.html';
        return;
    }

    // Parallel fetch: entries + latest radar + sprints + new-since-last-analysis
    const [entries, historyFiles, sprintList, currentSprint, newSince] = await Promise.all([
        Auth.fetch('/api/intelligence-hub/entries').then(r => r.json()).catch(() => []),
        Auth.fetch('/api/history').then(r => r.json()).catch(() => []),
        Auth.fetch('/api/sprints/list?count=10').then(r => r.ok ? r.json() : []).catch(() => []),
        Auth.fetch('/api/sprints/current').then(r => r.ok ? r.json() : null).catch(() => null),
        Auth.fetch('/api/intelligence-hub/new-since-last-analysis').then(r => r.ok ? r.json() : null).catch(() => null),
    ]);

    // Render radar age badge in header
    const radarAgeEl = document.getElementById('radarAge');
    if (radarAgeEl) {
        if (newSince && newSince.since) {
            const days = Math.floor((Date.now() - new Date(newSince.since).getTime()) / 86400000);
            const color  = days === 0 ? COLORS.successAlt : days <= 7 ? COLORS.successAlt : days <= 14 ? COLORS.warningAlt : COLORS.danger;
            const bgCol  = days === 0 ? 'rgba(74,140,84,0.10)' : days <= 7 ? 'rgba(74,140,84,0.10)' : days <= 14 ? 'rgba(160,120,48,0.10)' : 'rgba(156,60,60,0.08)';
            const label  = days === 0 ? 'today' : days === 1 ? '1 day ago' : `${days} days ago`;
            radarAgeEl.innerHTML = `
                <a href="/Modules/intelligence-hub/analyzer.html" style="text-decoration:none;">
                    <div style="background:${bgCol};border:1px solid ${color}33;border-radius:12px;
                                padding:10px 16px;display:inline-block;">
                        <div style="font-size:10px;font-weight:800;text-transform:uppercase;
                                    letter-spacing:0.08em;color:${color};margin-bottom:3px;">Last Radar Analysis</div>
                        <div style="font-size:1.4rem;font-weight:900;color:${color};line-height:1;">${label}</div>
                    </div>
                </a>`;
        } else {
            radarAgeEl.innerHTML = `
                <a href="/Modules/intelligence-hub/analyzer.html" style="text-decoration:none;">
                    <div style="background:${COLORS.bgLight};border:1px solid ${COLORS.border};border-radius:12px;padding:10px 16px;display:inline-block;">
                        <div style="font-size:10px;font-weight:800;text-transform:uppercase;
                                    letter-spacing:0.08em;color:var(--color-text-muted);margin-bottom:3px;">Last Radar Analysis</div>
                        <div style="font-size:1rem;font-weight:700;color:var(--color-text-muted);">No analysis yet</div>
                    </div>
                </a>`;
        }
    }

    // Render new-since-last-analysis indicator
    const indicatorEl = document.getElementById('newSignalsIndicator');
    if (indicatorEl && newSince && newSince.since !== null) {
        if (newSince.count > 0) {
            const fmt = d => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            indicatorEl.innerHTML = `
                <div style="background:rgba(176,90,56,0.08);border:1px solid rgba(176,90,56,0.25);border-radius:10px;
                            padding:7px 13px;display:inline-flex;align-items:center;gap:8px;">
                    <div style="text-align:right;">
                        <div style="font-size:12px;font-weight:700;color:${COLORS.accent};">
                            ${newSince.count} new entr${newSince.count !== 1 ? 'ies' : 'y'}
                        </div>
                        <div style="font-size:10px;color:${COLORS.textSecondary};">since ${fmt(newSince.since)}</div>
                    </div>
                </div>`;
        } else {
            indicatorEl.innerHTML = `
                <div style="background:rgba(74,140,84,0.10);border:1px solid rgba(74,140,84,0.30);border-radius:10px;
                            padding:7px 13px;display:inline-flex;align-items:center;gap:8px;">
                    <span style="font-size:11px;font-weight:700;color:${COLORS.successAlt};">Up to date</span>
                </div>`;
        }
    }

    // Render sprint context in header
    const sprintCtx = document.getElementById('sprintContext');
    if (sprintCtx && currentSprint) {
        const fmt         = d => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        const sprintLabel = currentSprint.name || `Sprint ${currentSprint.sprint_number}`;
        const goalSuffix  = currentSprint.goal ? ` · ${currentSprint.goal}` : '';
        sprintCtx.textContent = `${sprintLabel} · ${fmt(currentSprint.start_date)} → ${fmt(currentSprint.end_date)} · Day ${currentSprint.days_elapsed} of ${currentSprint.duration_days}${goalSuffix}`;
    }

    let analysis = null;
    if (historyFiles && historyFiles.length > 0) {
        const radar = await Auth.fetch(`/api/history/${historyFiles[0]}`).then(r => r.json()).catch(() => null);
        analysis = radar?.analysis ?? null;
    }

    // Populate Executive Summary widget
    const execEl = document.getElementById('dashExecSummary');
    if (execEl) {
        if (analysis?.summary) {
            execEl.textContent = analysis.summary;
        } else {
            execEl.innerHTML   = `No Radar analysis yet — run one with the button above.`;
            execEl.style.color = 'var(--color-text-muted)';
        }
    }

    // Cache entries for history re-render
    window._cachedEntries  = entries  || [];
    window._cachedSprints  = sprintList || [];

    const bugs = (entries || []).filter(e => {
        const src = (e.sourceType || '').toLowerCase();
        return src === 'bug' || src === 'support ticket';
    });

    renderVisitBanner(analysis, historyFiles || []);

    phBugTrend(bugs, sprintList || []);
    phChurn(analysis);
    phRecurring(analysis, null, null, entries);
    phSignalHealth(entries || [], analysis, sprintList || []);

    // ── Longitudinal fallback for Churn Risk + Recurring Issues ───────────────
    if (typeof hasLongitudinalData === 'function' && !hasLongitudinalData(analysis)) {
        const currentLongitudinal = analysis?.longitudinal || null;
        findBestLongitudinalAnalysis(historyFiles).then(best => {
            if (!best) return;
            phChurn(best.analysis, best.date, currentLongitudinal);
            phRecurring(best.analysis, best.date, currentLongitudinal, entries);
        });
    }

    // ── Expose re-render for history panel ────────────────────────────────────
    window._reRenderHealthWidgets = function(newAnalysis) {
        const execEl = document.getElementById('dashExecSummary');
        if (execEl) execEl.textContent = newAnalysis?.summary || '';
        phChurn(newAnalysis);
        phRecurring(newAnalysis, null, null, window._cachedEntries);
        phSignalHealth(window._cachedEntries, newAnalysis);
    };

// ── Re-render Top Emerging Trends with entry-based signal counts ───────────
    // dashboard.js renders this widget first (no entries yet); once entries are
    // loaded here we augment each trend with a count and re-render.
    if (analysis?.trends?.length && entries?.length) {
        const augmented = {
            ...analysis,
            trends: analysis.trends.map(t => {
                const computed = phCountEntriesForTopic(entries, t.topic, t.description);
                // Prefer AI count when > 0; fall back to computed when AI returned 0 or null
                const evidence_count = (t.evidence_count > 0) ? t.evidence_count : (computed || null);
                return { ...t, evidence_count };
            }),
        };
        if (typeof renderSignals === 'function') renderSignals(augmented, historyFiles);
    }

    // Run New Analysis button
    const dashRunBtn = document.getElementById('dashRunAnalysisBtn');
    if (dashRunBtn) {
        dashRunBtn.addEventListener('click', async () => {
            dashRunBtn.disabled     = true;
            dashRunBtn.textContent  = '⏳ Analyzing...';
            try {
                const entriesRes = await Auth.fetch('/api/intelligence-hub/entries');
                const dataset    = await entriesRes.json();
                if (!dataset || dataset.length === 0) {
                    alert('No data in the Hub to analyze.');
                    return;
                }
                const res  = await Auth.fetch('/api/analyze', {
                    method:  'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body:    JSON.stringify({ dataset }),
                });
                const data = await res.json();
                if (data.analysis) {
                    window.location.reload();
                }
            } catch (e) {
                console.error('Analysis error:', e);
                alert('Error during analysis.');
                dashRunBtn.disabled    = false;
                dashRunBtn.textContent = '↻ Run New Analysis';
            }
        });
    }

    // Auto-analyze on sprint day 1 — runs after widgets load, never blocks UI
    checkAndAutoAnalyze();

    // Product Operations — load untracked demand (non-blocking)
    loadUntrackedDemand(false);

    // OKR Coverage — load story + demand alignment (non-blocking)
    loadOKRCoverage(false);
});

function showSprintStatus(msg) {
    const el = document.getElementById('sprintContext');
    if (el) el.textContent = msg;
}

async function checkAndAutoAnalyze() {
    try {
        const res   = await Auth.fetch('/api/analyze/should-run');
        const check = await res.json();
        if (!check.should_run) return;

        showSprintStatus(
            `${check.sprint_name || ('Sprint ' + check.sprint_number)} started · ${check.new_signals} new signal${check.new_signals !== 1 ? 's' : ''} · Updating Radar...`
        );

        const entriesRes = await Auth.fetch('/api/intelligence-hub/entries');
        const dataset    = await entriesRes.json();

        const analyzeRes = await Auth.fetch('/api/analyze', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ dataset }),
        });
        const data = await analyzeRes.json();

        if (data.analysis) {
            updateAlignmentWidgets(data.analysis);
            updateHealthWidgets(data.analysis);
            showSprintStatus(
                `${check.sprint_name || ('Sprint ' + check.sprint_number)} · Day 1 · Radar updated automatically`
            );
        }
    } catch (e) {
        console.warn('Auto-analyze check failed silently:', e.message);
    }
}

function updateAlignmentWidgets(analysis) {
    try {
        const historyFiles = [];
        renderOKR(null, analysis, historyFiles);
        renderSignals(analysis, historyFiles);
        renderSilentSignals(analysis);
    } catch (e) { /* silent */ }
}

function updateHealthWidgets(analysis) {
    try {
        phChurn(analysis);
        phRecurring(analysis, null, null, null);
    } catch (e) { /* silent */ }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Count intelligence entries that mention keywords from a trend topic + description.
// Using both fields gives a much richer keyword set than the topic alone.
const _phStopWords = new Set(['that','this','with','from','have','been','will','were','they',
    'their','what','when','more','also','than','into','which','about','each','some',
    'such','very','just','like','over','even','back','only','then','time','most']);
function phCountEntriesForTopic(entries, topic, description) {
    const combined = ((topic || '') + ' ' + (description || '')).toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length >= 4 && !_phStopWords.has(w));
    const words = [...new Set(combined)]; // deduplicate
    if (!words.length) return 0;
    return entries.filter(e => {
        const text = (e.body || '').toLowerCase();
        return words.some(w => text.includes(w));
    }).length;
}



function phGroupBySprint(items, sprints) {
    const today = new Date().toISOString().slice(0, 10);

    // Early return if no data
    if (!items || !Array.isArray(items) || items.length === 0) {
        return { counts: [], labels: [], buckets: [] };
    }

    // Use sprints that have already started, take last 4 (3 past + current)
    const started = (sprints || [])
        .filter(s => s.start_date <= today)
        .slice(-4);

    if (started.length >= 1) {
        // Pre-calculate timestamps for performance
        const sprintRanges = started.map(sp => ({
            start: new Date(sp.start_date).getTime(),
            end: new Date(sp.end_date).getTime() + 86400000
        }));

        // Batch process items for better performance
        const buckets = sprintRanges.map(range => {
            return items.filter(e => {
                const d = new Date(e.date || e.createdAt || 0).getTime();
                return d >= range.start && d < range.end;
            });
        });

        // Cache date formatting
        const fmt = d => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

        return {
            counts: buckets.map(b => b.length),
            labels: started.map(sp => fmt(sp.start_date)),
            buckets,
        };
    }

    // Fallback: last 3 calendar months (optimized)
    const now = new Date();
    const months = [];

    // Pre-calculate month keys
    for (let i = 2; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        months.push({
            key: `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`,
            label: d.toLocaleDateString('en-US', { month: 'short' }),
            items: [],
        });
    }

    // Single pass through items
    items.forEach(e => {
        const d = (e.date || e.createdAt || '').slice(0, 7);
        const m = months.find(month => month.key === d);
        if (m) m.items.push(e);
    });

    return {
        counts: months.map(m => m.items.length),
        labels: months.map(m => m.label),
        buckets: months.map(m => m.items),
    };
}

function phBarChart(counts, labels, color) {
    // Early return for empty data
    if (!counts || !labels || counts.length === 0 || labels.length === 0) {
        return '<div style="text-align:center;color:var(--color-text-muted);padding:20px;">No data available</div>';
    }

    const max = Math.max(...counts, 1);

    // Pre-calculate all values to avoid repeated calculations
    const barData = counts.map((c, i) => {
        const pct = Math.round((c / max) * 100);
        const h = Math.max(4, Math.round((pct / 100) * 60));
        return { count: c, height: h };
    });

    // Use array join for better performance than multiple string concatenations
    const bars = barData.map((data, i) =>
        `<div class="bar-col">
            <span style="font-size:11px;font-weight:700;color:${COLORS.textPrimary};">${data.count}</span>
            <div class="bar-fill" style="height:${data.height}px;background:${color};"></div>
        </div>`
    ).join('');

    const lbls = labels.map(l => `<span class="bar-label">${l}</span>`).join('');

    return `<div class="bar-chart">${bars}</div><div class="bar-labels">${lbls}</div>`;
}

function phSprintUnavailable(el) {
    if (!el) return;
    el.innerHTML = `
        <div class="widget-label">Unavailable</div>
        <p style="font-size:12px;color:var(--color-text-muted);margin-top:8px;">Unable to load</p>`;
}

// ── Widget 1 — Bug Trend ──────────────────────────────────────────────────────

window._bugPeriods = [];

function phBugTrend(bugs, sprints) {
    const el = document.getElementById('ph-bug-trend');
    try {
        el.innerHTML = '<div class="widget-label">Bug Trend</div><p class="widget-desc">Volume of bug-related signals captured in your Hub over recent sprints.</p>';

        if (!bugs.length) {
            el.innerHTML += `<p style="font-size:13px;color:var(--color-text-secondary);margin-top:8px;line-height:1.5;">
                No bug signals captured yet — add <strong>Bug</strong> entries in Intelligence Hub.
                <br><a href="/Modules/intelligence-hub/data-entry.html"
                   style="font-size:11px;color:${COLORS.accent};font-weight:700;">Add signals →</a></p>`;
            return;
        }

        const { counts, labels, buckets } = phGroupBySprint(bugs, sprints);
        window._bugPeriods = labels.map((label, i) => ({ label, bugs: buckets[i] || [] }));

        const last  = counts[counts.length - 1];
        const prev  = counts[counts.length - 2];
        const max   = Math.max(...counts, 1);

        // Build clickable bars
        const bars = counts.map((c, i) => {
            const pct    = Math.round((c / max) * 100);
            const h      = Math.max(4, Math.round((pct / 100) * 60));
            const active = (c > 0);
            return `
            <div class="widget-item bar-col" onclick="openBugPeriodModal(${i})"
                 style="cursor:${active ? 'pointer' : 'default'};
                        ${active ? 'transition:opacity 0.12s;' : ''}"
                 ${active ? `onmouseover="this.style.opacity='0.75'" onmouseout="this.style.opacity='1'"` : ''}>
                <span style="font-size:11px;font-weight:700;color:${COLORS.textPrimary};">${c}</span>
                <div class="bar-fill" style="height:${h}px;background:${COLORS.accent};border-radius:4px 4px 0 0;"></div>
            </div>`;
        }).join('');
        const lbls = labels.map((l, i) => `
            <span class="bar-label" style="cursor:${counts[i]>0?'pointer':'default'};${counts[i]>0?`color:${COLORS.accent};font-weight:700;`:''}"
                  ${counts[i]>0 ? `onclick="openBugPeriodModal(${i})"` : ''}>${l}</span>`).join('');

        const chartHtml = `
            <div class="bar-chart">${bars}</div>
            <div class="bar-labels">${lbls}</div>`;

        const hint = `<p style="font-size:11px;color:var(--color-text-muted);margin-top:6px;font-style:italic;">Click a bar to see details</p>`;

        let status;
        if (last > prev) {
            status = `<p style="font-size:12px;color:${COLORS.danger};font-weight:700;margin-top:10px;">
                Bug rate increasing — ${last} bug${last!==1?'s':''} this sprint vs last sprint</p>`;
        } else {
            status = `<p style="font-size:12px;color:${COLORS.successAlt};font-weight:700;margin-top:10px;">
                Bug rate stable</p>`;
        }

        el.innerHTML += chartHtml + hint + status;
    } catch(e) { phSprintUnavailable(el); }
}

function openBugPeriodModal(idx) {
    const period = (window._bugPeriods || [])[idx];
    if (!period) return;

    const sorted = [...period.bugs].sort((a, b) =>
        new Date(b.date || b.createdAt || 0) - new Date(a.date || a.createdAt || 0));

    const sources = sorted.map(e => {
        const d    = (e.date || e.createdAt)
            ? new Date(e.date || e.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
            : '';
        const type = (e.sourceType || '').toLowerCase();
        return {
            label:      (e.body || e.title || '').slice(0, 80) + ((e.body || '').length > 80 ? '…' : ''),
            value:      d || undefined,
            tag:        type === 'bug' ? 'Bug' : 'Support Ticket',
            tagVariant: type === 'bug' ? 'danger' : 'info',
            body:       [e.person ? `From: ${e.person}` : null, e.body || ''].filter(Boolean).join('\n'),
        };
    });

    DrillDown.open({
        label:       'Bug Signals',
        title:       `${period.label} · ${period.bugs.length} bug${period.bugs.length !== 1 ? 's' : ''}`,
        description: period.bugs.length
            ? `<p>${period.bugs.length} bug signal${period.bugs.length !== 1 ? 's' : ''} captured during this period.</p>`
            : `<p style="color:var(--color-text-muted);">No bugs recorded this period.</p>`,
        sources,
    });
}

// ── Widget 3 — Churn Risk ─────────────────────────────────────────────────────

function phChurn(analysis, staleDate = null, currentLongitudinal = null) {
    const el = document.getElementById('ph-churn');
    try {
        const staleBadge = staleDate
            ? `<span style="font-size:10px;font-weight:700;color:${COLORS.warningAlt};background:rgba(160,120,48,0.10);
                            padding:2px 8px;border-radius:9999px;margin-left:8px;">Last analyzed: ${staleDate}</span>`
            : '';
        el.innerHTML = `<div class="widget-label" style="display:flex;align-items:center;">Churn Risk${staleBadge}</div><p class="widget-desc">Clients showing disengagement signals based on recent feedback patterns.</p>`;

        const longitudinal = analysis?.longitudinal || {};

        if (longitudinal.status === 'insufficient_data' || !longitudinal.churn_signals) {
            el.innerHTML += longitudinalGateHtml(longitudinal);
            return;
        }

        const signals = longitudinal.churn_signals || [];
        if (!signals.length) {
            el.innerHTML += `<p style="font-size:13px;color:${COLORS.successAlt};font-weight:700;margin-top:8px;">No disengagement signals detected</p>`;
            el.innerHTML += nextAnalysisFooter(currentLongitudinal);
            return;
        }

        const riskColor = lvl => {
            const l = (lvl || '').toLowerCase();
            if (l.includes('high') || l.includes('élevé')) return { dot:COLORS.danger, bg:'rgba(156,60,60,0.08)', text:'High' };
            if (l.includes('med')  || l.includes('moyen')) return { dot:COLORS.warningAlt, bg:'rgba(160,120,48,0.10)', text:'Medium' };
            return { dot:COLORS.successAlt, bg:'rgba(74,140,84,0.10)', text:'Low' };
        };

        el.innerHTML += signals.map(s => {
            const r = riskColor(s.risk_level);
            const signal = s.signal ? `
                    <p style="font-size:11px;color:var(--color-text-secondary);font-style:italic;margin-top:4px;
                               display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;
                               overflow:hidden;line-height:1.4;">${escHtml(s.signal)}</p>` : '';
            return `
            <div class="widget-item risk-row">
                <div style="width:8px;height:8px;border-radius:50%;background:${r.dot};flex-shrink:0;margin-top:4px;"></div>
                <div style="flex:1;min-width:0;">
                    <div style="display:flex;align-items:center;gap:8px;margin-bottom:2px;">
                        <p style="font-size:13px;font-weight:600;color:${COLORS.textPrimary};margin:0;flex:1;">${escHtml(s.actor || s.topic || '')}</p>
                        <span style="font-size:10px;font-weight:600;color:${r.dot};background:${r.bg};
                                     padding:2px 8px;border-radius:9999px;flex-shrink:0;">${r.text}</span>
                    </div>
                    ${signal}
                </div>
            </div>`;
        }).join('');
        el.innerHTML += nextAnalysisFooter(currentLongitudinal);
    } catch(e) { phSprintUnavailable(el); }
}

// ── Widget 4 — Recurring Issues ───────────────────────────────────────────────

window._recurringSignals = [];

function phRecurring(analysis, staleDate = null, currentLongitudinal = null, entries = null) {
    const el = document.getElementById('ph-recurring');
    try {
        const staleBadge = staleDate
            ? `<span style="font-size:10px;font-weight:700;color:${COLORS.warningAlt};background:rgba(160,120,48,0.10);
                            padding:2px 8px;border-radius:9999px;margin-left:8px;">Last analyzed: ${staleDate}</span>`
            : '';
        el.innerHTML = `<div class="widget-label" style="display:flex;align-items:center;">Recurring Issues${staleBadge}</div><p class="widget-desc">Problems reported more than once across different clients or sessions.</p>`;

        const longitudinal = analysis?.longitudinal || {};

        if (longitudinal.status === 'insufficient_data' || !longitudinal.recurring_signals) {
            el.innerHTML += longitudinalGateHtml(longitudinal);
            return;
        }

        // Normalise: handle both legacy strings and new {topic, description, evidence_count} objects
        const raw = (longitudinal.recurring_signals || []).slice(0, 4);
        const signals = raw.map(s => typeof s === 'string'
            ? { topic: s, description: '', evidence_count: null }
            : s);

        // Compute entry-based counts as fallback when AI count is 0 / missing
        if (entries?.length) {
            signals.forEach(s => {
                if (!(s.evidence_count > 0)) {
                    s.evidence_count = phCountEntriesForTopic(entries, s.topic, s.description) || null;
                }
            });
        }

        // Store for popup access
        window._recurringSignals = signals.map(s => ({
            ...s,
            matchedEntries: entries?.length
                ? entries.filter(e => {
                    const words = ((s.topic || '') + ' ' + (s.description || '')).toLowerCase()
                        .replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
                        .filter(w => w.length >= 4 && !_phStopWords.has(w));
                    const text = (e.body || '').toLowerCase();
                    return words.some(w => text.includes(w));
                })
                : [],
        }));

        if (!signals.length) {
            el.innerHTML += `<p style="font-size:13px;color:${COLORS.successAlt};font-weight:700;margin-top:8px;">No recurring unresolved signals</p>`;
            el.innerHTML += nextAnalysisFooter(currentLongitudinal);
            return;
        }

        el.innerHTML += `<div style="display:flex;flex-direction:column;margin-top:4px;">
            ${signals.map((s, i) => {
                const count = s.evidence_count;
                const badge = count != null
                    ? `<span style="font-size:10px;font-weight:600;color:${COLORS.accent};background:rgba(176,90,56,0.08);
                                    padding:2px 8px;border-radius:9999px;flex-shrink:0;">${count} signal${count!==1?'s':''}</span>`
                    : '';
                return `
                <div style="display:flex;align-items:center;gap:10px;padding:9px 8px;
                            border-bottom:1px solid ${COLORS.border};border-radius:8px;transition:background 0.12s;cursor:pointer;"
                     onmouseover="this.style.background=COLORS.hoverBg" onmouseout="this.style.background='transparent'"
                     onclick="openRecurringModal(${i})">
                    <div style="width:8px;height:8px;border-radius:50%;background:${COLORS.textMuted};flex-shrink:0;min-width:8px;min-height:8px;"></div>
                    <div style="flex:1;min-width:0;">
                        <p style="font-size:13px;font-weight:600;color:${COLORS.textPrimary};line-height:1.4;margin:0;">
                            ${escHtml(s.topic || '')}</p>
                        ${badge}
                    </div>
                    <span style="font-size:13px;color:${COLORS.textMuted};flex-shrink:0;">›</span>
                </div>`;
            }).join('')}
        </div>`;
        el.innerHTML += nextAnalysisFooter(currentLongitudinal);
    } catch(e) { phSprintUnavailable(el); }
}

function openRecurringModal(idx) {
    const item = (window._recurringSignals || [])[idx];
    if (!item) return;

    const sorted = [...(item.matchedEntries || [])].sort((a, b) =>
        new Date(b.date || b.createdAt || 0) - new Date(a.date || a.createdAt || 0));

    const sources = sorted.map(e => {
        const d = (e.date || e.createdAt)
            ? new Date(e.date || e.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
            : '';
        return {
            label: (e.body || '').slice(0, 80) + ((e.body || '').length > 80 ? '…' : ''),
            value: d || undefined,
            tag:   e.sourceType || 'Signal',
            body:  [e.person ? `From: ${e.person}` : null, e.body || ''].filter(Boolean).join('\n'),
        };
    });

    DrillDown.open({
        label:       'Recurring Issue',
        title:       item.topic || '',
        description: item.description
            ? `<p>${escHtml(item.description)}</p>`
            : '<p>No description available.</p>',
        details: item.evidence_count != null
            ? [{ label: 'Evidence count', value: `${item.evidence_count} signal${item.evidence_count !== 1 ? 's' : ''}` }]
            : [],
        sources,
    });
}

// ── OKR Coverage ──────────────────────────────────────────────────────────────

async function loadOKRCoverage(force = false) {
    try {
        const res  = await Auth.fetch('/api/dashboard/okr-coverage', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ force }),
        });
        const data = await res.json();
        if (typeof renderOKRCoverage  === 'function') renderOKRCoverage(data);
        if (typeof renderDemandAlignment === 'function') renderDemandAlignment(data);
    } catch (e) {
        console.warn('OKR coverage load failed:', e.message);
        const sprintEl = document.getElementById('w-okr-sprint');
        if (sprintEl) sprintEl.innerHTML = `
            <div class="widget-label">Current Sprint Coverage</div>
            <p class="widget-desc">Which OKRs are represented by the stories in your current sprint.</p>
            <p style="font-size:13px;color:${COLORS.danger};margin-top:8px;">Unable to load coverage data.</p>`;
        const demandEl = document.getElementById('w-demand-okr');
        if (demandEl) demandEl.innerHTML = `<div class="widget-label">Customer Demand vs OKRs</div>
            <p style="font-size:13px;color:${COLORS.danger};">Error loading analysis.</p>`;
    }
}

// ── Product Operations — Untracked Demand ────────────────────────────────────

async function loadUntrackedDemand(force = false) {
    const body = document.getElementById('po-untracked-body');
    body.innerHTML = '<div class="widget-spinner"></div>';

    try {
        const res  = await Auth.fetch('/api/dashboard/untracked-demand', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ force }),
        });
        const data = await res.json();

        if (data.insufficient) {
            body.innerHTML = `
                <div style="text-align:center;padding:20px 0;color:var(--color-text-muted);">
                    <p style="font-weight:600;color:var(--color-text-secondary);margin-bottom:6px;">Not enough Hub signals yet</p>
                    <p style="font-size:12px;">Add at least 2 signals to enable this analysis.</p>
                    <a href="/Modules/intelligence-hub/data-entry.html"
                       style="font-size:12px;font-weight:700;color:${COLORS.accent};text-decoration:none;margin-top:8px;display:inline-block;">
                       Add signals →</a>
                </div>`;
            return;
        }

        renderUntrackedDemand(data.results || []);
    } catch (e) {
        body.innerHTML = `<p style="font-size:13px;color:${COLORS.danger};">Error loading analysis.</p>`;
    }
}

window._untrackedResults = [];

function renderUntrackedDemand(results) {
    const body = document.getElementById('po-untracked-body');
    window._untrackedResults = results;

    if (!results.length) {
        body.innerHTML = `
            <div style="text-align:center;padding:20px 0;">
                <p style="font-weight:700;color:${COLORS.successAlt};font-size:13px;">All recurring signals are covered</p>
                <p style="font-size:12px;color:var(--color-text-muted);margin-top:4px;">Every topic mentioned 2+ times has a matching story in your backlog.</p>
            </div>`;
        return;
    }

    const urgencyConfig = {
        high:   { dot: COLORS.danger, label: 'High',   badgeBg: 'rgba(156,60,60,0.10)',  badgeText: COLORS.danger },
        medium: { dot: COLORS.warningAlt, label: 'Medium', badgeBg: 'rgba(160,120,48,0.10)', badgeText: COLORS.warningAlt },
        low:    { dot: COLORS.successAlt, label: 'Low',    badgeBg: 'rgba(74,140,84,0.10)',  badgeText: COLORS.successAlt },
    };

    body.innerHTML = `
        <div style="display:flex;flex-direction:column;">
            ${results.map((item, i) => {
                const u = urgencyConfig[item.urgency] || urgencyConfig.low;
                return `
                <div class="widget-item" onclick="openUntrackedModal(${i})"
                     style="display:flex;align-items:center;gap:10px;padding:9px 8px;
                            border-bottom:1px solid ${COLORS.border};cursor:pointer;border-radius:8px;
                            transition:background 0.12s;"
                     onmouseover="this.style.background=COLORS.hoverBg"
                     onmouseout="this.style.background='transparent'">
                    <div style="width:8px;height:8px;border-radius:50%;background:${u.dot};flex-shrink:0;"></div>
                    <span style="font-size:13px;font-weight:600;color:${COLORS.textPrimary};flex:1;
                                 white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escHtml(item.topic)}</span>
                    <span style="font-size:10px;font-weight:600;color:${u.badgeText};background:${u.badgeBg};
                                 padding:2px 8px;border-radius:9999px;flex-shrink:0;">${u.label}</span>
                    <span style="font-size:10px;font-weight:600;color:${COLORS.accent};background:rgba(176,90,56,0.08);
                                 padding:2px 8px;border-radius:9999px;flex-shrink:0;">${item.signalCount} signal${item.signalCount!==1?'s':''}</span>
                    <span style="font-size:13px;color:${COLORS.textMuted};flex-shrink:0;">›</span>
                </div>`;
            }).join('')}
        </div>`;
}

function openUntrackedModal(idx) {
    const item = (window._untrackedResults || [])[idx];
    if (!item) return;

    const urgencyConfig = {
        high:   { label: 'High',   tagVariant: 'danger'  },
        medium: { label: 'Medium', tagVariant: 'warning' },
        low:    { label: 'Low',    tagVariant: 'success' },
    };
    const u = urgencyConfig[item.urgency] || urgencyConfig.low;

    const suggested = item.suggestedTitle || item.topic;
    window._pendingCreateStory = suggested;

    const signalsHtml = (item.signals || []).map(s =>
        `<div style="background:var(--color-bg-hover);border:1px solid var(--color-border);border-radius:var(--radius-md);
                     padding:10px 14px;font-size:var(--font-size-sm);color:var(--color-text-primary);
                     line-height:1.6;font-style:italic;margin-bottom:6px;">
            "${escHtml(s)}"
        </div>`).join('');

    const ctaHtml = `
        <div style="border-top:1px solid var(--color-border);padding-top:14px;margin-top:14px;
                    display:flex;justify-content:space-between;align-items:center;gap:12px;">
            <span style="font-size:var(--font-size-xs);color:var(--color-text-muted);font-style:italic;
                         flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
                ${escHtml(suggested)}
            </span>
            <button onclick="createStoryFromDemand(window._pendingCreateStory)"
                    style="flex-shrink:0;font-size:var(--font-size-xs);font-weight:var(--font-weight-medium);
                           color:var(--color-text-inverse);background:var(--color-accent);border:none;
                           border-radius:9999px;padding:6px 14px;cursor:pointer;white-space:nowrap;
                           font-family:var(--font-family);">
                + Create Story →
            </button>
        </div>`;

    DrillDown.open({
        label:       'Untracked Demand',
        title:       item.topic,
        description: (item.reasoning ? `<p>${escHtml(item.reasoning)}</p>` : '')
                   + (signalsHtml ? `<div style="margin-top:12px;">${signalsHtml}</div>` : ''),
        details: [
            { label: 'Urgency',      value: u.label },
            { label: 'Signal Count', value: `${item.signalCount} signal${item.signalCount !== 1 ? 's' : ''}` },
        ],
        sources: [],
    });
}

function createStoryFromDemand(title) {
    localStorage.setItem(PRECEDE.PENDING_STORY_KEY, title);
    window.location.href = '/Modules/story-grooming/story-grooming.html';
}

// ── SOLUTION MODE ─────────────────────────────────────────────────────

let solutionMode = false;
let selectedItems = new Set();
let _solutionObserver = null;
let _itemCounter = 0;

function initSolutionMode() {
    window.addEventListener('solutionModeChanged', (e) => {
        solutionMode = e.detail.enabled;
        updateSolutionMode();
    });
    solutionMode = localStorage.getItem(PRECEDE.SOLUTION_MODE_KEY) === 'true';
    addSolutionActionsPanel();
    updateSolutionMode();
}

function updateSolutionMode() {
    if (solutionMode) {
        document.body.classList.add('solution-mode');
        document.querySelectorAll('.widget-item').forEach(attachItemCheckbox);
        startSolutionObserver();
    } else {
        document.body.classList.remove('solution-mode');
        stopSolutionObserver();
        document.querySelectorAll('.solution-item-checkbox').forEach(cb => cb.remove());
        document.querySelectorAll('.widget-item.selected').forEach(el => el.classList.remove('selected'));
        selectedItems.clear();
        updateSolutionActions();
    }
}

function startSolutionObserver() {
    if (_solutionObserver) return;
    _solutionObserver = new MutationObserver(mutations => {
        for (const m of mutations) {
            for (const node of m.addedNodes) {
                if (node.nodeType !== 1) continue;
                if (node.classList?.contains('widget-item')) attachItemCheckbox(node);
                node.querySelectorAll?.('.widget-item').forEach(attachItemCheckbox);
            }
        }
    });
    const root = document.querySelector('.main-content') || document.body;
    _solutionObserver.observe(root, { childList: true, subtree: true });
}

function stopSolutionObserver() {
    if (_solutionObserver) { _solutionObserver.disconnect(); _solutionObserver = null; }
}

function attachItemCheckbox(item) {
    if (item.querySelector('.solution-item-checkbox')) return;
    if (!item.dataset.itemId) item.dataset.itemId = 'sm-' + (++_itemCounter);

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'solution-item-checkbox';
    cb.checked = selectedItems.has(item.dataset.itemId);
    cb.addEventListener('click', e => e.stopPropagation());
    cb.addEventListener('change', (e) => {
        e.stopPropagation();
        const id = item.dataset.itemId;
        if (cb.checked) {
            selectedItems.add(id);
            item.classList.add('selected');
        } else {
            selectedItems.delete(id);
            item.classList.remove('selected');
        }
        updateSolutionActions();
    });
    item.insertBefore(cb, item.firstChild);
}

function addSolutionActionsPanel() {
    const existing = document.querySelector('.solution-actions');
    if (existing) existing.remove();

    const panel = document.createElement('div');
    panel.className = 'solution-actions';
    panel.innerHTML = `
        <div class="solution-actions-title">
            Actions
            <span class="selected-count" id="selectedCount">0</span>
        </div>
        <div class="solution-actions-buttons">
            <button class="solution-action-btn" onclick="createPendingDecision()">
                Create Pending Decision
            </button>
            <button class="solution-action-btn" onclick="startBrainstorm()">
                Brainstorm
            </button>
            <button class="solution-action-btn" onclick="openFeedbackForm()">
                💬 Improve AI response
            </button>
        </div>
        <div id="solutionFeedbackForm" style="display:none;margin-top:10px;border-top:1px solid var(--color-border);padding-top:10px;">
            <textarea id="solutionFeedbackTA" placeholder="What was missing, wrong, or could be better?" rows="3" style="width:100%;border:1px solid var(--color-border);border-radius:6px;padding:8px;font-size:12px;font-family:var(--font-family);background:var(--color-bg-page);color:var(--color-text-primary);resize:vertical;outline:none;box-sizing:border-box;"></textarea>
            <div style="display:flex;gap:8px;margin-top:6px;align-items:center;">
                <button class="solution-action-btn" style="padding:5px 12px;font-size:12px;" onclick="submitDashboardFeedback()">Send</button>
                <button class="solution-action-btn" style="padding:5px 12px;font-size:12px;" onclick="closeFeedbackForm()">Cancel</button>
                <span id="solutionFeedbackSaved" style="display:none;font-size:12px;color:var(--color-success);font-weight:600;">✓ Saved</span>
            </div>
        </div>
    `;
    document.body.appendChild(panel);
    updateSolutionActions();
}

function updateSolutionActions() {
    const panel = document.querySelector('.solution-actions');
    const count = document.getElementById('selectedCount');
    if (!panel || !count) return;
    count.textContent = selectedItems.size;
    panel.classList.toggle('show', selectedItems.size > 0 && solutionMode);
}

function getSelectedLabels() {
    return Array.from(document.querySelectorAll('.widget-item.selected'))
        .map(el => el.textContent.trim().replace(/\s+/g, ' ').substring(0, 120));
}

function buildSelectedItemsContext() {
    return Array.from(document.querySelectorAll('.widget-item.selected')).map(el => {
        const widgetContainer = el.closest('[id^="w-"], [id^="ph-"]');
        const widgetId    = widgetContainer?.id || 'unknown';
        const widgetLabel = (widgetContainer?.querySelector('.widget-label')?.textContent || 'Dashboard').trim();
        let content = '';
        if (widgetId === 'w-signals') {
            const title = el.closest('[onclick*="openTrendModal"]')?.querySelector('p[style*="font-weight:600"]')?.textContent || '';
            const desc  = el.closest('[onclick*="openTrendModal"]')?.querySelector('p[style*="font-style:italic"]')?.textContent || '';
            content = title || desc || el.textContent?.trim().substring(0, 200) || '';
        } else if (widgetId === 'ph-stakeholder-radar') {
            const actor    = el.querySelector('span[style*="font-weight:600"]')?.textContent || '';
            const badges   = Array.from(el.querySelectorAll('span[style*="border-radius:9999px"]')).map(b => b.textContent.trim()).join(' · ');
            const feedback = el.querySelector('p[style*="font-style:italic"]')?.textContent || '';
            content = actor ? `${actor}${badges ? ' — ' + badges : ''}${feedback ? ': ' + feedback : ''}` : el.textContent?.trim().substring(0, 200) || '';
        } else if (widgetId === 'ph-churn') {
            const actor     = el.querySelector('p[style*="font-weight:600"]')?.textContent || '';
            const riskLevel = el.querySelector('span[style*="font-weight:600"]')?.textContent || '';
            const signal    = el.querySelector('p[style*="font-style:italic"]')?.textContent || '';
            content = actor ? `${actor} (${riskLevel}): ${signal}` : el.textContent?.trim().substring(0, 200) || '';
        } else if (widgetId === 'ph-recurring') {
            const topic = el.querySelector('p[style*="font-weight:600"]')?.textContent || '';
            const badge = el.querySelector('span[style*="font-weight:600"]')?.textContent || '';
            content = topic ? `${topic} ${badge}` : el.textContent?.trim().substring(0, 200) || '';
        } else if (widgetId === 'ph-signal-health') {
            const score   = el.closest('[onclick*="openSignalHealthModal"]')?.querySelector('div[style*="font-size:28px"]')?.textContent || '';
            const sources = Array.from(el.closest('[onclick*="openSignalHealthModal"]')?.querySelectorAll('span[style*="font-weight:600"]') || [])
                .map(s => s.textContent).join(', ');
            content = score ? `Signal Health: ${score} (${sources})` : el.textContent?.trim().substring(0, 200) || '';
        } else if (widgetId.startsWith('ph-volume')) {
            const count = el.querySelector('span[style*="font-weight:700"]')?.textContent || '';
            const label = el.closest('[onclick*="openVolumeModal"]')?.querySelector('.bar-label')?.textContent || '';
            content = label ? `${label}: ${count} signals` : el.textContent?.trim().substring(0, 200) || '';
        } else if (widgetId.startsWith('ph-bug-trend')) {
            const barValue = el.querySelector('span[style*="font-weight:700"]')?.textContent || '';
            const label    = el.closest('[onclick*="openBugPeriodModal"]')?.querySelector('.bar-label')?.textContent || '';
            content = label ? `${label}: ${barValue} bugs` : el.textContent?.trim().substring(0, 200) || '';
        } else {
            content = el.textContent?.trim().replace(/\s+/g, ' ').substring(0, 200) || '';
        }
        return { widget: widgetLabel, content: content.trim() };
    }).filter(i => i.content);
}

function openFeedbackForm() {
    const form = document.getElementById('solutionFeedbackForm');
    if (!form) return;
    form.style.display = form.style.display === 'none' ? '' : 'none';
    if (form.style.display !== 'none') document.getElementById('solutionFeedbackTA')?.focus();
}

function closeFeedbackForm() {
    const form = document.getElementById('solutionFeedbackForm');
    if (form) form.style.display = 'none';
    const ta = document.getElementById('solutionFeedbackTA');
    if (ta) ta.value = '';
}

async function submitDashboardFeedback() {
    const ta = document.getElementById('solutionFeedbackTA');
    const comment = ta?.value?.trim();
    if (!comment) return;
    const submitBtn = document.querySelector('#solutionFeedbackForm .solution-action-btn');
    if (submitBtn) submitBtn.disabled = true;
    try {
        const items = buildSelectedItemsContext();
        await Auth.fetch('/api/learning/feedback', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                comment,
                context: {
                    selectedItems: items.map(i => `${i.widget}: ${i.content}`).slice(0, 5),
                    aiSnippet: items.map(i => `[${i.widget}] ${i.content}`).join('\n').slice(0, 500),
                },
            }),
        });
        closeFeedbackForm();
        const saved = document.getElementById('solutionFeedbackSaved');
        if (saved) { saved.style.display = ''; setTimeout(() => { saved.style.display = 'none'; }, 3000); }
    } catch (e) {
        console.error('Feedback error', e);
    } finally {
        if (submitBtn) submitBtn.disabled = false;
    }
}

function createPendingDecision() {
    if (selectedItems.size === 0) return;

    // Get detailed information from selected items
    const selectedElements = Array.from(document.querySelectorAll('.widget-item.selected'));
    const detailedItems = selectedElements.map(el => {
        const widgetContainer = el.closest('[id^="w-"], [id^="ph-"]');
        const widgetId = widgetContainer?.id || 'unknown';
        const widgetLabel = widgetContainer?.querySelector('.widget-label')?.textContent || 'Unknown Widget';

        // Extract item content based on widget type
        let itemContent = '';

        if (widgetId === 'w-signals') {
            // For trends widget - get the trend title
            const trendTitle = el.closest('[onclick*="openTrendModal"]')?.querySelector('p[style*="font-weight:600"]')?.textContent || '';
            const trendDesc = el.closest('[onclick*="openTrendModal"]')?.querySelector('p[style*="font-style:italic"]')?.textContent || '';
            itemContent = trendTitle || trendDesc || el.textContent?.trim().substring(0, 120) || '';
        } else if (widgetId.startsWith('ph-bug-trend')) {
            // For bug trend - get sprint period and bug count
            const barValue = el.querySelector('span[style*="font-weight:700"]')?.textContent || '';
            const label = el.closest('[onclick*="openBugPeriodModal"]')?.querySelector('.bar-label')?.textContent || '';
            itemContent = label ? `${label}: ${barValue} bugs` : el.textContent?.trim().substring(0, 120) || '';
        } else if (widgetId === 'ph-churn') {
            // For churn risk - get actor and risk level
            const actor = el.querySelector('p[style*="font-weight:600"]')?.textContent || '';
            const riskLevel = el.querySelector('span[style*="font-weight:600"]')?.textContent || '';
            const signal = el.querySelector('p[style*="font-style:italic"]')?.textContent || '';
            itemContent = actor ? `${actor} (${riskLevel}): ${signal}` : el.textContent?.trim().substring(0, 120) || '';
        } else if (widgetId === 'ph-recurring') {
            // For recurring issues - get topic and evidence count
            const topic = el.querySelector('p[style*="font-weight:600"]')?.textContent || '';
            const badge = el.querySelector('span[style*="font-weight:600"]')?.textContent || '';
            itemContent = topic ? `${topic} ${badge}` : el.textContent?.trim().substring(0, 120) || '';
        } else if (widgetId === 'ph-signal-health') {
            // For signal health - get score and sources
            const score = el.closest('[onclick*="openSignalHealthModal"]')?.querySelector('div[style*="font-size:28px"]')?.textContent || '';
            const sources = Array.from(el.closest('[onclick*="openSignalHealthModal"]')?.querySelectorAll('span[style*="font-weight:600"]') || [])
                .map(span => span.textContent).join(', ');
            itemContent = score ? `Signal Health: ${score} (${sources})` : el.textContent?.trim().substring(0, 120) || '';
        } else if (widgetId.startsWith('ph-volume')) {
            // For volume trend - get period and count
            const count = el.querySelector('span[style*="font-weight:700"]')?.textContent || '';
            const label = el.closest('[onclick*="openVolumeModal"]')?.querySelector('.bar-label')?.textContent || '';
            itemContent = label ? `${label}: ${count} signals` : el.textContent?.trim().substring(0, 120) || '';
        } else {
            // Generic extraction for other widgets
            itemContent = el.textContent?.trim().substring(0, 120) || '';
        }

        return {
            widget: widgetLabel,
            content: itemContent,
            element: el
        };
    });

    const decisionData = {
        name: `Decision for ${selectedItems.size} dashboard item${selectedItems.size > 1 ? 's' : ''}`,
        description: `Items requiring decision:\n${detailedItems.map((item, i) =>
            `${i + 1}. ${item.content} (from ${item.widget})`
        ).join('\n')}\n\nContext: Selected from dashboard on ${new Date().toLocaleDateString()}`,
        date: new Date().toISOString().split('T')[0],
        approver: 'Product Committee'
    };
    localStorage.setItem(PRECEDE.PENDING_DECISION_KEY, JSON.stringify(decisionData));
    window.location.href = '/Modules/decision-log/decision-log.html';
}

function escalateToExecutive() {
    if (selectedItems.size === 0) return;
    const labels = getSelectedLabels();
    const decisionData = {
        name: `Escalated: ${selectedItems.size} dashboard item${selectedItems.size > 1 ? 's' : ''}`,
        description: `Escalated items requiring executive attention:\n${labels.map(l => `• ${l}`).join('\n')}\n\nPriority: High\nRequested action: Executive review and decision`,
        date: new Date().toISOString().split('T')[0],
        approver: 'Executive Committee'
    };
    localStorage.setItem(PRECEDE.PENDING_DECISION_KEY, JSON.stringify(decisionData));
    window.location.href = '/Modules/decision-log/decision-log.html';
}

function startBrainstorm() {
    if (selectedItems.size > 0) {
        const selectedElements = Array.from(document.querySelectorAll('.widget-item.selected'));
        const detailedItems = selectedElements.map(el => {
            const widgetContainer = el.closest('[id^="w-"], [id^="ph-"]');
            const widgetId = widgetContainer?.id || 'unknown';
            const widgetLabel = (widgetContainer?.querySelector('.widget-label')?.textContent || 'Unknown Widget').trim();

            let itemContent = '';
            if (widgetId === 'w-signals') {
                const trendTitle = el.closest('[onclick*="openTrendModal"]')?.querySelector('p[style*="font-weight:600"]')?.textContent || '';
                const trendDesc  = el.closest('[onclick*="openTrendModal"]')?.querySelector('p[style*="font-style:italic"]')?.textContent || '';
                itemContent = trendTitle || trendDesc || el.textContent?.trim().substring(0, 200) || '';
            } else if (widgetId.startsWith('ph-bug-trend')) {
                const barValue = el.querySelector('span[style*="font-weight:700"]')?.textContent || '';
                const label    = el.closest('[onclick*="openBugPeriodModal"]')?.querySelector('.bar-label')?.textContent || '';
                itemContent = label ? `${label}: ${barValue} bugs` : el.textContent?.trim().substring(0, 200) || '';
            } else if (widgetId === 'ph-churn') {
                const actor     = el.querySelector('p[style*="font-weight:600"]')?.textContent || '';
                const riskLevel = el.querySelector('span[style*="font-weight:600"]')?.textContent || '';
                const signal    = el.querySelector('p[style*="font-style:italic"]')?.textContent || '';
                itemContent = actor ? `${actor} (${riskLevel}): ${signal}` : el.textContent?.trim().substring(0, 200) || '';
            } else if (widgetId === 'ph-recurring') {
                const topic = el.querySelector('p[style*="font-weight:600"]')?.textContent || '';
                const badge = el.querySelector('span[style*="font-weight:600"]')?.textContent || '';
                itemContent = topic ? `${topic} ${badge}` : el.textContent?.trim().substring(0, 200) || '';
            } else if (widgetId === 'ph-signal-health') {
                const score   = el.closest('[onclick*="openSignalHealthModal"]')?.querySelector('div[style*="font-size:28px"]')?.textContent || '';
                const sources = Array.from(el.closest('[onclick*="openSignalHealthModal"]')?.querySelectorAll('span[style*="font-weight:600"]') || [])
                    .map(s => s.textContent).join(', ');
                itemContent = score ? `Signal Health: ${score} (${sources})` : el.textContent?.trim().substring(0, 200) || '';
            } else if (widgetId.startsWith('ph-volume')) {
                const count = el.querySelector('span[style*="font-weight:700"]')?.textContent || '';
                const label = el.closest('[onclick*="openVolumeModal"]')?.querySelector('.bar-label')?.textContent || '';
                itemContent = label ? `${label}: ${count} signals` : el.textContent?.trim().substring(0, 200) || '';
            } else {
                itemContent = el.textContent?.trim().replace(/\s+/g, ' ').substring(0, 200) || '';
            }

            return { widget: widgetLabel, content: itemContent.trim() };
        }).filter(item => item.content);

        localStorage.setItem(PRECEDE.BRAINSTORM_ITEMS_KEY, JSON.stringify(detailedItems));
        localStorage.removeItem(PRECEDE.BRAINSTORM_CHAT_KEY);
    }
    window.location.href = '/Modules/solution-brainstorm/solution-brainstorm.html';
}

// Initialize solution mode when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(initSolutionMode, 1000);
});

// ── Widget 5 — Signal Volume Trend ────────────────────────────────────────────

function phSignalHealth(entries, analysis, sprints) {
    const el = document.getElementById('ph-signal-health');
    if (!el) return;

    if (!entries.length) {
        el.innerHTML = `
            <div class="widget-label">Signal Health</div>
            <p class="widget-desc">Volume, source diversity, and client coverage per sprint.</p>
            <p style="font-size:13px;color:${COLORS.textSecondary};margin-top:8px;">No signals captured yet.</p>`;
        return;
    }

    function calcMetrics(label, sprintEntries) {
        const volume = sprintEntries.length;
        const sourceMap = {};
        for (const e of sprintEntries) sourceMap[e.sourceType || 'Other'] = 1;
        const diversity = Object.keys(sourceMap).length;
        const clientMap = {};
        for (const e of sprintEntries) clientMap[e.person || 'Unknown'] = 1;
        const clients    = Object.keys(clientMap).length;
        // Uncapped — chart will scale relative to max across sprints
        const volScore   = Math.round((volume   / 10) * 100);
        const divScore   = Math.round((diversity /  4) * 100);
        const cliScore   = Math.round((clients   /  5) * 100);
        // Displayed score stays 0-100
        const score      = Math.min(100, Math.round(volScore * 0.4 + divScore * 0.3 + cliScore * 0.3));
        return { label, volume, diversity, clients, score, volScore, divScore, cliScore, entries: sprintEntries };
    }

    // Build metrics oldest→newest using real sprint date ranges
    const validSprints = (sprints || []).filter(s => s.start_date && s.end_date);
    let sprintMetrics;
    if (validSprints.length >= 2) {
        sprintMetrics = validSprints.map(s => {
            const start = new Date(s.start_date).getTime();
            const end   = new Date(s.end_date).getTime();
            return calcMetrics(s.name, entries.filter(e => {
                const t = new Date(e.date || e.createdAt || 0).getTime();
                return t >= start && t <= end;
            }));
        });
    } else {
        // Fallback: three 2-week buckets
        const now = Date.now(), twoW = 14 * 86400000;
        sprintMetrics = [
            ['4w ago',   entries.filter(e => { const a = now - new Date(e.date||e.createdAt||0).getTime(); return a >= 2*twoW && a < 4*twoW; })],
            ['2w ago',   entries.filter(e => { const a = now - new Date(e.date||e.createdAt||0).getTime(); return a >= twoW   && a < 2*twoW; })],
            ['Current',  entries.filter(e => (now - new Date(e.date||e.createdAt||0).getTime()) < twoW)],
        ].map(([label, es]) => calcMetrics(label, es));
    }

    // Store for drilldown access
    window._signalHealthSprints = sprintMetrics;

    const cur        = sprintMetrics[sprintMetrics.length - 1];
    const scoreColor = cur.score >= 70 ? COLORS.success : cur.score >= 40 ? COLORS.warning : COLORS.danger;
    const scoreLabel = cur.score >= 70 ? 'Healthy'  : cur.score >= 40 ? 'Moderate' : 'Low';

    // SVG line chart — viewBox scales to widget width automatically
    const n = sprintMetrics.length;
    const W = 280, H = 80, padL = 4, padR = 4, padT = 6, padB = 4;
    const xOf = i => padL + (n > 1 ? i / (n - 1) : 0.5) * (W - padL - padR);
    const maxScore = Math.max(1, ...sprintMetrics.map(m => Math.max(m.volScore, m.divScore, m.cliScore)));
    const yOf = v => padT + (1 - v / maxScore) * (H - padT - padB);

    const line = (key, color, dash = '') =>
        `<polyline points="${sprintMetrics.map((m, i) => `${xOf(i)},${yOf(m[key])}`).join(' ')}"
            fill="none" stroke="${color}" stroke-width="1.8" stroke-linejoin="round"
            ${dash ? `stroke-dasharray="${dash}"` : ''}/>`;

    // Per-sprint clickable column: invisible hit area + dots + label
    const sprintCols = sprintMetrics.map((m, i) => {
        const x = xOf(i);
        return `
        <g onclick="openSignalHealthSprint(${i})" style="cursor:pointer;">
            <rect x="${x - 10}" y="${padT}" width="20" height="${H - padT + 16}" fill="transparent"/>
            <circle cx="${x}" cy="${yOf(m.volScore)}" r="3.5" fill=COLORS.accent stroke="white" stroke-width="1.2"/>
            <circle cx="${x}" cy="${yOf(m.divScore)}" r="3.5" fill=COLORS.successAlt stroke="white" stroke-width="1.2"/>
            <circle cx="${x}" cy="${yOf(m.cliScore)}" r="3.5" fill=COLORS.textSecondary stroke="white" stroke-width="1.2"/>
            <text x="${x}" y="${H + 14}" font-size="9" fill=COLORS.textSecondary text-anchor="middle" font-family="sans-serif"
                  text-decoration="underline">${m.label.replace(/^Sprint\s*/i, 'S').substring(0, 8)}</text>
        </g>`;
    }).join('');

    const svg = `
        <svg viewBox="0 0 ${W} ${H + 20}" style="width:100%;display:block;overflow:visible;margin-top:8px;">
            <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${H}" stroke=COLORS.border stroke-width="1"/>
            <line x1="${padL}" y1="${H}"    x2="${W - padR}" y2="${H}" stroke=COLORS.border stroke-width="1"/>
            ${line('volScore', COLORS.accent)}
            ${line('divScore', COLORS.successAlt)}
            ${line('cliScore', COLORS.textSecondary, '4,2')}
            ${sprintCols}
        </svg>`;

    el.innerHTML = `
        <div class="widget-label">Signal Health</div>
        <div style="display:flex;align-items:baseline;gap:8px;margin:4px 0 2px;">
            <span style="font-size:24px;font-weight:700;color:${scoreColor};">${cur.score}</span>
            <span style="font-size:12px;color:${scoreColor};font-weight:600;">${scoreLabel}</span>
            <span style="font-size:11px;color:${COLORS.textSecondary};margin-left:auto;">${cur.volume} signals · ${cur.clients} client${cur.clients !== 1 ? 's' : ''}</span>
        </div>
        ${n > 1 ? svg : `<p style="font-size:12px;color:${COLORS.textSecondary};margin-top:8px;">Capture signals across more sprints to see trend.</p>`}
        <div style="display:flex;gap:12px;margin-top:6px;">
            <span style="font-size:11px;color:${COLORS.accent};">● Volume</span>
            <span style="font-size:11px;color:${COLORS.successAlt};">● Source diversity</span>
            <span style="font-size:11px;color:${COLORS.textSecondary};">- - Client coverage</span>
        </div>`;
}

function openSignalHealthSprint(idx) {
    const m = (window._signalHealthSprints || [])[idx];
    if (!m) return;

    const sources = [...m.entries]
        .sort((a, b) => new Date(b.date || b.createdAt || 0) - new Date(a.date || a.createdAt || 0))
        .map(e => ({
            label:      (e.body || '').slice(0, 80) + ((e.body || '').length > 80 ? '…' : ''),
            value:      (e.date || e.createdAt)
                ? new Date(e.date || e.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                : undefined,
            tag:        e.sourceType || 'Signal',
            tagVariant: 'info',
            body:       [e.person ? `From: ${e.person}` : null, e.body || ''].filter(Boolean).join('\n'),
        }));

    const scoreColor = m.score >= 70 ? COLORS.success : m.score >= 40 ? COLORS.warning : COLORS.danger;

    DrillDown.open({
        label:       'Signal Health',
        title:       m.label,
        description: m.entries.length
            ? `<p>${m.volume} signal${m.volume !== 1 ? 's' : ''} captured — <span style="color:${scoreColor};font-weight:600;">health score ${m.score}</span></p>`
            : `<p style="color:var(--color-text-muted);">No signals captured this sprint.</p>`,
        details: [
            { label: 'Volume',          value: `${m.volume} signal${m.volume !== 1 ? 's' : ''}` },
            { label: 'Source diversity', value: `${m.diversity} source type${m.diversity !== 1 ? 's' : ''}` },
            { label: 'Client coverage', value: `${m.clients} client${m.clients !== 1 ? 's' : ''}` },
        ],
        sources,
    });
}

// ── Dashboard Tooltips ────────────────────────────────────────────────────────

const WIDGET_TIPS = {
    'w-exec-summary': 'Claude reads all your Hub entries from the last analysis period and writes a plain-language summary of what\'s happening in your product space.',
    'w-okr':          'Claude compares your Hub signals against each OKR to score how much evidence supports progress on that objective.',
    'w-okr-sprint':   'Checks how many sprint story points map to each OKR, and how well the sprint goal aligns with each objective.',
    'w-signals':      'The top 3 trends Claude detected across your Hub entries — ranked by signal strength and strategic alignment. Click any trend to see its full description and stats.',
    'w-silent':       'Topics that appeared in earlier Radar cycles but then stopped showing up — things that were noticed before but may have been quietly dropped without a recorded decision.',
    'ph-bug-trend':   'Counts Hub entries tagged "Bug" or "Support Ticket" per sprint. Click any bar to see the individual bug signals for that period.',
    'ph-churn':       'Claude looks for patterns in Hub signals suggesting users may be disengaging — repeated complaints, mentions of workarounds, or references to looking at alternatives.',
    'ph-recurring':   'Topics that have appeared across multiple Radar analyses without being resolved — things your team keeps noticing but hasn\'t fully addressed.',
    'w-demand-okr':   'Claude reads your Hub signals and maps each one to your OKRs. Each bar shows how much customer evidence supports that objective. Signals that don\'t connect to any OKR are flagged as potential strategic blind spots.',
    'po-untracked':   'Claude groups your Hub signals into recurring themes (minimum 2 signals each), then checks whether each theme already has a matching story in your Jira backlog. Themes with no coverage are surfaced here.',
};

const _tipEl = document.getElementById('dash-tooltip');

function _showTip(e, text) {
    _tipEl.textContent = text;
    _tipEl.style.display = 'block';
    _moveTip(e);
}
function _moveTip(e) {
    const x = Math.min(e.clientX + 14, window.innerWidth - _tipEl.offsetWidth - 12);
    const y = Math.max(e.clientY - _tipEl.offsetHeight - 10, 8);
    _tipEl.style.left = x + 'px';
    _tipEl.style.top  = y + 'px';
}
function _hideTip() { _tipEl.style.display = 'none'; }

function _addTipIcon(label, widgetId) {
    if (!label || label.querySelector('.tip-icon')) return;
    const tip  = WIDGET_TIPS[widgetId] || '';
    const icon = document.createElement('span');
    icon.className   = 'tip-icon';
    icon.textContent = 'ⓘ';
    icon.addEventListener('mouseenter', e => _showTip(e, tip));
    icon.addEventListener('mousemove',  _moveTip);
    icon.addEventListener('mouseleave', _hideTip);
    label.appendChild(icon);
}

// Widgets whose innerHTML is replaced by render functions — watch with MutationObserver
const _dynamicWidgets = ['w-okr','w-okr-sprint','w-signals','w-silent','ph-bug-trend','ph-churn','ph-recurring','ph-signal-health'];

_dynamicWidgets.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    // Re-inject icon whenever widget content is replaced
    new MutationObserver(() => {
        _addTipIcon(el.querySelector('.widget-label'), id);
    }).observe(el, { childList: true });
    // Attempt immediate injection (if already rendered)
    _addTipIcon(el.querySelector('.widget-label'), id);
});

// Static label widgets — inject once after DOM is ready
function _injectStaticTips() {
    // Executive Summary: label is a <b> element, not .widget-label
    const execLabel = document.querySelector('#w-exec-summary b');
    if (execLabel && !execLabel.querySelector('.tip-icon')) {
        const tip  = WIDGET_TIPS['w-exec-summary'];
        const icon = document.createElement('span');
        icon.className   = 'tip-icon';
        icon.textContent = 'ⓘ';
        icon.addEventListener('mouseenter', e => _showTip(e, tip));
        icon.addEventListener('mousemove',  _moveTip);
        icon.addEventListener('mouseleave', _hideTip);
        execLabel.appendChild(icon);
    }
    // Untracked Demand: label is static in the widget header, only body changes
    const poLabel = document.querySelector('#po-untracked .widget-label');
    _addTipIcon(poLabel, 'po-untracked');
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _injectStaticTips);
} else {
    _injectStaticTips();
}

/**
 * INTELLIGENCE RADAR - JS
 * v3 — Silences suspects + Vélocité des signaux + Désengagement pré-churn
 */

// ─── FONCTIONS GLOBALES ───────────────────────────────────────────────────────

window.runNewAnalysis = async function(onComplete) {
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
        if (onComplete) onComplete(data);
        return data;
    } catch (e) {
        console.error('Analysis error:', e);
        throw e;
    }
};

window.sendToGrooming = function(text) {
    console.log("🚀 Sending idea to Grooming Studio...");
    const cleanText = text.trim();
    localStorage.setItem('pendingStoryIdea', cleanText);
    window.location.href = "/Modules/story-grooming/story-grooming.html";
};

window.loadHistory = async (f) => {
    try {
        const res  = await Auth.fetch(`/api/history/${f}`);
        const data = await res.json();
        renderDashboard(data.analysis || data, data.meta || null);

        const dashboard  = document.getElementById('dashboardContainer');
        const emptyState = document.getElementById('reportEmptyState');
        if (emptyState)  emptyState.style.display = 'none';
        if (dashboard)   dashboard.classList.remove('hidden');

        // Highlight active card
        document.querySelectorAll('.history-card').forEach(c => c.classList.remove('active'));
        const card = document.querySelector(`[data-file="${f}"]`);
        if (card) card.classList.add('active');

        window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
        console.error("❌ Error loading history:", e);
    }
};

// ─── INIT ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
    const ok = await Auth.requireAuth();
    if (!ok) return;

    const safeSet = (id, html) => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = html;
    };

    // ─── HISTORIQUE ───────────────────────────────────────────────────────────

    async function refreshHistory() {
        const historyList = document.getElementById('historyList');
        if (!historyList) return;
        try {
            // Load history files + current sprint in parallel
            const [filesRes, sprintRes] = await Promise.all([
                Auth.fetch('/api/history'),
                Auth.fetch('/api/sprints/current').catch(() => null),
            ]);
            const files         = await filesRes.json();
            const currentSprint = sprintRes?.ok ? await sprintRes.json() : null;

            if (!files || files.length === 0) {
                historyList.innerHTML = '<p style="font-size:12px;color:#94a3b8;font-weight:600;padding:8px 4px;">No analyses yet.<br>Analysis runs automatically on sprint day 1.</p>';
                return;
            }

            const fmt = d => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

            historyList.innerHTML = files.map((file, i) => {
                const ts = file.match(/\d+/)?.[0];
                const analysisDate = ts ? new Date(parseInt(ts)) : null;

                // Determine sprint label
                let sprintLabel, dateRange, isCurrent = false;

                if (currentSprint && analysisDate) {
                    const start = new Date(currentSprint.start_date);
                    const end   = new Date(currentSprint.end_date);
                    if (analysisDate >= start && analysisDate <= end) {
                        sprintLabel = `Sprint ${currentSprint.sprint_number}`;
                        dateRange   = `${fmt(currentSprint.start_date)} → ${fmt(currentSprint.end_date)}`;
                        isCurrent   = true;
                    }
                }

                if (!sprintLabel) {
                    sprintLabel = `Analysis #${files.length - i}`;
                    dateRange   = analysisDate
                        ? analysisDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                        : file;
                }

                const badge   = isCurrent ? '<span class="badge-current">Current</span>' : '';
                const action  = isCurrent
                    ? `<a href="/dashboard.html" class="history-card-link">← View on Dashboard</a>`
                    : `<button onclick="loadHistory('${file}')" class="history-card-link" style="background:none;border:none;padding:0;cursor:pointer;margin-top:0;">View Full Report →</button>`;

                return `
                <div class="history-card" data-file="${file}" onclick="loadHistory('${file}')">
                    <div class="history-card-title">${sprintLabel}${badge}</div>
                    <div class="history-card-meta">${dateRange}</div>
                    ${action}
                </div>`;
            }).join('');
        } catch (e) {
            console.error("History error:", e);
            historyList.innerHTML = '<p style="font-size:12px;color:#ef4444;">Error loading history</p>';
        }
    }

    // Run now (sidebar may already be ready) and also on sidebarReady in case it wasn't yet
    await refreshHistory();
    window.addEventListener('sidebarReady', () => refreshHistory(), { once: true });

    // ─── SYNC JIRA COMMENTS BUTTON ───────────────────────────────────────────

    const syncJiraBtn    = document.getElementById('syncJiraBtn');
    const syncJiraStatus = document.getElementById('syncJiraStatus');
    if (syncJiraBtn) {
        syncJiraBtn.addEventListener('click', async () => {
            syncJiraBtn.disabled    = true;
            syncJiraBtn.textContent = '⏳ Syncing…';
            if (syncJiraStatus) { syncJiraStatus.style.display = 'none'; }
            try {
                const res  = await Auth.fetch('/api/integration/sync-signals', { method: 'POST' });
                const data = await res.json();
                if (syncJiraStatus) {
                    syncJiraStatus.style.display = 'block';
                    if (res.ok) {
                        syncJiraStatus.style.background = '#f0fdf4';
                        syncJiraStatus.style.color      = '#166534';
                        syncJiraStatus.style.borderBottomColor = '#bbf7d0';
                        syncJiraStatus.textContent = `✅ ${data.count} Jira comment(s) imported into the Hub`;
                    } else {
                        syncJiraStatus.style.background = '#fef2f2';
                        syncJiraStatus.style.color      = '#991b1b';
                        syncJiraStatus.style.borderBottomColor = '#fecaca';
                        syncJiraStatus.textContent = `❌ ${data.error || 'Sync failed — configure Jira in Settings'}`;
                    }
                    setTimeout(() => { syncJiraStatus.style.display = 'none'; }, 5000);
                }
            } catch (e) {
                console.error('Jira sync error:', e);
                if (syncJiraStatus) {
                    syncJiraStatus.style.display    = 'block';
                    syncJiraStatus.style.background = '#fef2f2';
                    syncJiraStatus.style.color      = '#991b1b';
                    syncJiraStatus.textContent      = '❌ Connection error';
                    setTimeout(() => { syncJiraStatus.style.display = 'none'; }, 5000);
                }
            } finally {
                syncJiraBtn.disabled    = false;
                syncJiraBtn.textContent = '🔗 Sync Jira Comments';
            }
        });
    }

    // ─── RUN NEW ANALYSIS BUTTON ──────────────────────────────────────────────

    const runBtn        = document.getElementById('runAnalysisBtn');
    const analysisOverlay = document.getElementById('analysisOverlay');
    if (runBtn) {
        runBtn.addEventListener('click', async () => {
            runBtn.disabled = true;
            runBtn.textContent = '⏳ Analyzing...';
            if (analysisOverlay) analysisOverlay.classList.add('active');
            try {
                await window.runNewAnalysis(async () => {
                    await refreshHistory();
                    // Auto-load the new analysis (first in list)
                    const res   = await Auth.fetch('/api/history');
                    const files = await res.json();
                    if (files && files.length > 0) loadHistory(files[0]);
                });
            } catch (e) {
                alert('Error during analysis.');
            } finally {
                runBtn.disabled    = false;
                runBtn.textContent = '🔄 Run New Analysis';
                if (analysisOverlay) analysisOverlay.classList.remove('active');
            }
        });
    }

    // Auto-load most recent analysis when coming from dashboard
    if (new URLSearchParams(window.location.search).get('load') === 'latest') {
        try {
            const res   = await Auth.fetch('/api/history');
            const files = await res.json();
            if (files && files.length > 0) loadHistory(files[0]);
        } catch (e) { /* silent */ }
    }

    // ─── RENDU DU DASHBOARD ───────────────────────────────────────────────────

    window.renderDashboard = function(data, meta) {
        if (!data) return;

        // ── 1. Résumé & OKRs ────────────────────────────────────────────────

        safeSet('visionGapText', data.summary || "Summary unavailable");

        safeSet('okrImpactSection', `
            <div class="bg-indigo-50 p-8 rounded-[2rem] border border-indigo-100 h-full flex flex-col justify-center">
                <b class="text-[10px] text-indigo-600 uppercase block mb-3 tracking-widest font-black">Performance OKRs</b>
                <p class="text-xl font-bold text-slate-800 leading-relaxed italic">"${data.strategic_alignment_summary || "Analysis unavailable"}"</p>
            </div>
        `);

        safeSet('strategicGapFull', data.strategic_gap_deep_dive || data.strategic_gap || "No gap identified.");

        // ── 2. META BAR ─────────────────────────────────────────────────────

        if (meta) {
            const metaBar = document.getElementById('metaBar');
            if (metaBar) {
                metaBar.innerHTML = `
                    <div class="flex flex-wrap gap-3 text-[10px] font-black text-slate-500 uppercase tracking-widest">
                        <span class="px-2 py-1 bg-slate-100 rounded-full">🔴 ${meta.data_breakdown?.high || 0} recent</span>
                        <span class="px-2 py-1 bg-slate-100 rounded-full">🟡 ${meta.data_breakdown?.medium || 0} current</span>
                        <span class="px-2 py-1 bg-slate-100 rounded-full">⚪ ${meta.data_breakdown?.background || 0} context</span>
                        ${meta.memory_used           ? '<span class="px-2 py-1 bg-indigo-100 text-indigo-700 rounded-full">🧠 Active memory</span>'      : ''}
                        ${meta.longitudinal_triggered ? '<span class="px-2 py-1 bg-emerald-100 text-emerald-700 rounded-full">📈 Longitudinal active</span>' : ''}
                    </div>`;
                metaBar.classList.remove('hidden');
            }
        }

        // ── 3. DELTA SPRINT ─────────────────────────────────────────────────

        const delta    = data.delta || {};
        const hasDelta = (delta.new_signals?.length > 0)
                      || (delta.strengthened?.length > 0)
                      || (delta.resolved?.length > 0)
                      || (delta.contradictions?.length > 0);

        safeSet('deltaContainer', hasDelta ? `
            <div class="grid grid-cols-2 gap-4">
                ${delta.new_signals?.length > 0 ? `
                <div class="p-5 bg-emerald-50 border border-emerald-100 rounded-2xl">
                    <b class="text-[10px] text-emerald-700 uppercase tracking-widest font-black block mb-3">🆕 New signals</b>
                    ${delta.new_signals.map(s => `<p class="text-sm text-slate-700 mb-1">• ${s}</p>`).join('')}
                </div>` : ''}

                ${delta.strengthened?.length > 0 ? `
                <div class="p-5 bg-blue-50 border border-blue-100 rounded-2xl">
                    <b class="text-[10px] text-blue-700 uppercase tracking-widest font-black block mb-3">📈 Reinforced signals</b>
                    ${delta.strengthened.map(s => `<p class="text-sm text-slate-700 mb-1">• ${s}</p>`).join('')}
                </div>` : ''}

                ${delta.resolved?.length > 0 ? `
                <div class="p-5 bg-slate-50 border border-slate-100 rounded-2xl">
                    <b class="text-[10px] text-slate-500 uppercase tracking-widest font-black block mb-3">✅ Resolved / Disappeared</b>
                    ${delta.resolved.map(s => `<p class="text-sm text-slate-500 mb-1 line-through">• ${s}</p>`).join('')}
                </div>` : ''}

                ${delta.contradictions?.length > 0 ? `
                <div class="p-5 bg-amber-50 border border-amber-100 rounded-2xl">
                    <b class="text-[10px] text-amber-700 uppercase tracking-widest font-black block mb-3">⚡ Reversals</b>
                    ${delta.contradictions.map(s => `<p class="text-sm text-slate-700 mb-1">• ${s}</p>`).join('')}
                </div>` : ''}
            </div>
        ` : `
            <div class="flex flex-col items-center justify-center py-8 text-center">
                <span class="text-3xl mb-3">🧠</span>
                <p class="text-sm font-bold text-slate-500">First sprint analyzed</p>
                <p class="text-xs text-slate-400 mt-1">Delta will appear from the 2nd sprint onwards — changes will be detected automatically.</p>
            </div>
        `);

        // ── 4. SIGNAUX LONGS — Longitudinal ─────────────────────────────────

        const longitudinal = data.longitudinal || {};
        const longStatus   = longitudinal.status || 'insufficient_data';

        let longitudinalHTML = '';

        if (longStatus === 'insufficient_data') {
            const done     = longitudinal.sprints_completed || 0;
            const total    = longitudinal.sprints_required  || 4;
            const pct      = Math.min(100, Math.round((done / total) * 100));
            const daysLeft = Math.max(0, (longitudinal.days_required || 49) - (longitudinal.days_accumulated || 0));

            longitudinalHTML = `
                <div class="flex flex-col gap-4">
                    <div class="flex items-center justify-between">
                        <span class="text-sm font-bold text-slate-500">Completed sprints</span>
                        <span class="text-sm font-black text-indigo-600">${done} / ${total}</span>
                    </div>
                    <div class="w-full bg-slate-100 rounded-full h-2">
                        <div class="bg-indigo-400 h-2 rounded-full transition-all" style="width: ${pct}%"></div>
                    </div>
                    <p class="text-xs text-slate-400 text-center">
                        Long-term patterns unlock after ${total} sprints.
                        ${daysLeft > 0 ? `Also missing ${daysLeft} days of history.` : ''}
                    </p>
                </div>`;

        } else if (longStatus === 'available') {

            // Helper couleur niveau de risque
            const riskBadge = (level) => ({
                'élevé':  'bg-red-100 text-red-700 border-red-200',
                'moyen':  'bg-orange-100 text-orange-700 border-orange-200',
                'faible': 'bg-slate-100 text-slate-500 border-slate-200'
            }[level?.toLowerCase()] || 'bg-slate-100 text-slate-500 border-slate-200');

            // Helper couleur vélocité
            const velocityBadge = (v) => ({
                'rapide':  'bg-red-100 text-red-700 border-red-200',
                'modérée': 'bg-orange-100 text-orange-700 border-orange-200',
                'lente':   'bg-blue-100 text-blue-700 border-blue-200'
            }[v?.toLowerCase()] || 'bg-slate-100 text-slate-500 border-slate-200');

            longitudinalHTML = `
                <div class="flex flex-col gap-4">

                    <!-- En-tête -->
                    <div class="flex items-center gap-2 mb-1">
                        <span class="text-xs font-black text-indigo-600 uppercase tracking-widest">
                            ${longitudinal.sprints_analyzed} sprints · ${longitudinal.period_analyzed}
                        </span>
                        <span class="px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded-full text-[10px] font-black uppercase">✨ Up to date</span>
                    </div>

                    ${longitudinal.recurring_signals?.length > 0 ? `
                    <div class="p-4 bg-orange-50 border border-orange-100 rounded-xl">
                        <b class="text-[10px] text-orange-700 uppercase tracking-widest font-black block mb-2">🔁 Recurring unaddressed signals</b>
                        ${longitudinal.recurring_signals.map(s => `<p class="text-sm text-slate-700 mb-1">• ${s}</p>`).join('')}
                    </div>` : ''}

                    ${longitudinal.accelerating_trends?.length > 0 ? `
                    <div class="p-4 bg-emerald-50 border border-emerald-100 rounded-xl">
                        <b class="text-[10px] text-emerald-700 uppercase tracking-widest font-black block mb-2">🚀 Accelerating trends</b>
                        ${longitudinal.accelerating_trends.map(s => `<p class="text-sm text-slate-700 mb-1">• ${s}</p>`).join('')}
                    </div>` : ''}

                    ${longitudinal.decelerating_trends?.length > 0 ? `
                    <div class="p-4 bg-slate-50 border border-slate-100 rounded-xl">
                        <b class="text-[10px] text-slate-500 uppercase tracking-widest font-black block mb-2">📉 Fading trends</b>
                        ${longitudinal.decelerating_trends.map(s => `<p class="text-sm text-slate-500 mb-1">• ${s}</p>`).join('')}
                    </div>` : ''}

                    ${longitudinal.silent_signals?.length > 0 ? `
                    <div class="p-4 bg-slate-900 border border-slate-800 rounded-xl">
                        <b class="text-[10px] text-slate-300 uppercase tracking-widest font-black block mb-3">🔇 Suspicious silences</b>
                        ${longitudinal.silent_signals.map(s => {
                            const hypothesisIcon = { 'résolu': '✅', 'abandonné': '🚫', 'refoulé': '⚠️' }[s.hypothesis] || '❓';
                            const dotColor = { 'élevé': 'bg-red-500', 'moyen': 'bg-orange-400', 'faible': 'bg-slate-400' }[s.risk_level?.toLowerCase()] || 'bg-slate-400';
                            return `
                            <div class="mb-3 pb-3 border-b border-slate-700 last:border-0 last:mb-0 last:pb-0">
                                <div class="flex items-center justify-between mb-1">
                                    <span class="text-sm font-bold text-white">${s.topic}</span>
                                    <div class="flex items-center gap-2">
                                        <span class="text-xs text-slate-400">${hypothesisIcon} ${s.hypothesis}</span>
                                        <div class="w-2 h-2 rounded-full ${dotColor}"></div>
                                    </div>
                                </div>
                                <p class="text-xs text-slate-400">Last signal: ${s.last_seen}</p>
                            </div>`;
                        }).join('')}
                    </div>` : ''}

                    ${longitudinal.velocity_alerts?.length > 0 ? `
                    <div class="p-4 bg-blue-50 border border-blue-100 rounded-xl">
                        <b class="text-[10px] text-blue-700 uppercase tracking-widest font-black block mb-3">⚡ Signal velocity</b>
                        ${longitudinal.velocity_alerts.map(v => `
                            <div class="mb-3 pb-3 border-b border-blue-100 last:border-0 last:mb-0 last:pb-0">
                                <div class="flex items-center gap-2 mb-1">
                                    <span class="text-sm font-bold text-slate-800">${v.topic}</span>
                                    <span class="text-[10px] font-black px-2 py-0.5 rounded-full border uppercase ${velocityBadge(v.velocity)}">${v.velocity}</span>
                                </div>
                                <p class="text-xs text-slate-500">${v.projection}</p>
                            </div>`
                        ).join('')}
                    </div>` : ''}

                    ${longitudinal.churn_signals?.length > 0 ? `
                    <div class="p-4 bg-red-50 border border-red-100 rounded-xl">
                        <b class="text-[10px] text-red-700 uppercase tracking-widest font-black block mb-3">🚨 Disengagement signals</b>
                        ${longitudinal.churn_signals.map(c => `
                            <div class="mb-3 pb-3 border-b border-red-100 last:border-0 last:mb-0 last:pb-0">
                                <div class="flex items-center justify-between mb-1">
                                    <span class="text-sm font-bold text-slate-800">${c.actor}</span>
                                    <span class="text-[10px] font-black px-2 py-0.5 rounded-full border uppercase ${riskBadge(c.risk_level)}">${c.risk_level}</span>
                                </div>
                                <p class="text-xs text-slate-500">${c.signal}</p>
                            </div>`
                        ).join('')}
                    </div>` : ''}

                    ${longitudinal.persistent_contradictions?.length > 0 ? `
                    <div class="p-4 bg-amber-50 border border-amber-100 rounded-xl">
                        <b class="text-[10px] text-amber-700 uppercase tracking-widest font-black block mb-2">⚡ Persistent contradictions</b>
                        ${longitudinal.persistent_contradictions.map(s => `<p class="text-sm text-slate-700 mb-1">• ${s}</p>`).join('')}
                    </div>` : ''}

                    ${longitudinal.weak_signal_alert ? `
                    <div class="p-4 bg-indigo-50 border border-indigo-100 rounded-xl">
                        <b class="text-[10px] text-indigo-700 uppercase tracking-widest font-black block mb-2">🔮 Weak signal alert</b>
                        <p class="text-sm text-slate-700">${longitudinal.weak_signal_alert}</p>
                    </div>` : ''}

                </div>`;
        }

        safeSet('longitudinalContainer', longitudinalHTML);

        // ── 5. Tendances & Patterns ──────────────────────────────────────────

        if (data.trends) {
            safeSet('patternsGrid', data.trends.map(t => {
                const score      = parseInt(t.strategic_alignment) || 0;
                const scoreColor = score > 75 ? 'bg-emerald-500' : (score > 45 ? 'bg-orange-500' : 'bg-red-500');
                const isUp       = t.evolution?.toLowerCase().includes('hausse');

                const strengthBadge = {
                    'émergent':  'bg-emerald-50 text-emerald-700 border-emerald-100',
                    'établi':    'bg-indigo-50  text-indigo-700  border-indigo-100',
                    'en déclin': 'bg-slate-50   text-slate-500   border-slate-100'
                }[t.signal_strength?.toLowerCase()] || 'bg-slate-50 text-slate-500 border-slate-100';

                return `
                <div class="p-8 border border-slate-200 rounded-[2rem] bg-white shadow-sm hover:shadow-xl transition-all">
                    <div class="flex justify-between items-start mb-4">
                        <div class="flex flex-col gap-1">
                            <b class="text-slate-900 text-xl font-black leading-tight">${t.topic || t.name || "Topic"}</b>
                            <span class="text-[10px] font-bold text-indigo-500 uppercase tracking-widest">👤 ${t.persona_impacted || "General"}</span>
                        </div>
                        <div class="flex flex-col items-end gap-1">
                            <span class="text-[10px] font-black px-3 py-1.5 rounded-full border border-slate-100 uppercase bg-slate-50">
                                ${isUp ? '🔺' : '🔹'} ${t.evolution || 'stable'}
                            </span>
                            ${t.signal_strength ? `
                            <span class="text-[10px] font-black px-2 py-1 rounded-full border uppercase ${strengthBadge}">
                                ${t.signal_strength}
                            </span>` : ''}
                        </div>
                    </div>
                    <div class="flex items-center gap-4 mb-5">
                        <div class="flex items-center gap-1.5 bg-slate-50 px-2 py-1 rounded-md border border-slate-100">
                            <div class="w-2 h-2 rounded-full ${scoreColor}"></div>
                            <span class="text-[10px] font-black text-slate-700">${score}% Alignment</span>
                        </div>
                    </div>
                    <p class="text-base text-slate-600 leading-relaxed font-medium">${t.description || ""}</p>
                </div>`;
            }).join(''));
        }

        // ── 6. Sentiment & Tensions ──────────────────────────────────────────

        if (data.sentiment) {
            safeSet('tensionHeatmap', data.sentiment.map(s => `
                <div class="p-5 bg-white border border-slate-200 rounded-2xl shadow-sm">
                    <div class="flex justify-between items-center mb-2">
                        <span class="text-base font-black text-slate-800">${s.actor || "Group"}</span>
                        <span class="px-2 py-1 rounded text-[10px] font-black uppercase ${s.status?.toLowerCase() === 'tendu' ? 'bg-red-100 text-red-600' : 'bg-emerald-100 text-emerald-600'}">
                            ${s.status || "Neutral"}
                        </span>
                    </div>
                    <p class="text-sm text-slate-500 font-medium">${s.feedback || s.description || ""}</p>
                </div>
            `).join(''));
        }

        // ── 7. Opportunités / Risques / Actions ──────────────────────────────

        const listBuilder = (items, icon) => {
            if (!items || !Array.isArray(items) || items.length === 0)
                return '<p class="text-center py-6 text-sm text-slate-400 italic">Nothing to report.</p>';

            return items.map(i => {
                const title    = i.name || i.title || i.action || i.topic || i.label || i.toString();
                const desc     = i.description || i.rationale || i.details || i.text || "";
                const fullIdea = `${title} : ${desc}`.replace(/'/g, "\\'").replace(/"/g, '&quot;');
                const showGroomingBtn = (icon === '💡' || icon === '🎯');

                return `
                <div class="p-5 bg-white border border-slate-50 rounded-2xl shadow-sm hover:border-indigo-100 transition-all group">
                    <div class="flex items-start gap-3">
                        <span class="text-xl group-hover:scale-125 transition-transform">${icon}</span>
                        <div class="flex-1">
                            <b class="text-base block text-slate-900 font-bold mb-1">${title}</b>
                            ${desc ? `<p class="text-sm text-slate-500 leading-relaxed">${desc}</p>` : ''}
                            ${showGroomingBtn ? `
                            <button onclick="sendToGrooming('${fullIdea}')"
                                    class="mt-4 w-full py-3 px-4 bg-indigo-50 hover:bg-indigo-600 text-indigo-700 hover:text-white border border-indigo-100 hover:border-indigo-600 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all duration-200 flex items-center justify-center gap-2 group/btn">
                                <span class="text-sm">✂️</span>
                                <span>Generate User Story</span>
                            </button>` : ''}
                        </div>
                    </div>
                </div>`;
            }).join('');
        };

        safeSet('opportunitiesList', listBuilder(data.opportunities, '💡'));
        safeSet('risksList',         listBuilder(data.risks,         '⚠️'));
        safeSet('actionsList',       listBuilder(data.next_actions,  '🎯'));
    };
});
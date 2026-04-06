document.addEventListener('DOMContentLoaded', async () => {
    const ok = await Auth.requireAuth();
    if (!ok) return;

    document.getElementById('refreshLabel').textContent =
        'Updated at ' + new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

    const [stories, entriesRaw, settings] = await Promise.all([
        Auth.fetch('/api/backlog').then(r => r.json()).catch(() => []),
        Auth.fetch('/api/intelligence-hub/entries').then(r => r.json()).catch(() => []),
        Auth.fetch('/api/settings').then(r => r.json()).catch(() => ({})),
    ]);

    // intelligence-hub/entries returns array of row.data objects
    const entries = Array.isArray(entriesRaw) ? entriesRaw : [];

    renderSprintHealth(Array.isArray(stories) ? stories : []);
    renderProductHealth(entries);
    renderAlignment(settings);
});

// ── SPRINT HEALTH ────────────────────────────────────────────────────────────

function renderSprintHealth(stories) {
    const container = document.getElementById('sprintContent');

    if (!stories.length) {
        container.innerHTML = `
            <div class="empty-state">No stories in the backlog yet.</div>
            <a href="/Modules/story-grooming/story-grooming.html" class="shortcut-link">✂️ Create a Story →</a>`;
        return;
    }

    // Status counts
    const statusMap = {};
    stories.forEach(s => {
        const key = s.status || 'Unknown';
        statusMap[key] = (statusMap[key] || 0) + 1;
    });

    // RICE stats
    const scored  = stories.filter(s => s.rice?.score > 0);
    const avgRice = scored.length
        ? Math.round(scored.reduce((sum, s) => sum + s.rice.score, 0) / scored.length)
        : 0;
    const highPri = stories.filter(s => (s.rice?.score || 0) > 50).length;

    // Top 3 by RICE
    const top3 = [...stories].sort((a, b) => (b.rice?.score || 0) - (a.rice?.score || 0)).slice(0, 3);

    const statusBadgeClass = (status) => {
        if (/ready for dev/i.test(status))      return 'badge-green';
        if (/ready for groo/i.test(status))     return 'badge-blue';
        if (/in progress/i.test(status))        return 'badge-amber';
        if (/done|shipped/i.test(status))       return 'badge-purple';
        return 'badge-slate';
    };

    container.innerHTML = `
        <div class="kpi-block">
            <div class="kpi-number">${stories.length}</div>
            <div class="kpi-label">stories in backlog</div>
        </div>

        <div>
            ${Object.entries(statusMap).map(([status, count]) => `
                <div class="stat-row">
                    <span><span class="badge ${statusBadgeClass(status)}">${status}</span></span>
                    <span class="stat-val">${count}</span>
                </div>
            `).join('')}
        </div>

        <div class="stat-row">
            <span>Avg RICE score</span>
            <span class="stat-val">${avgRice}</span>
        </div>
        <div class="stat-row" style="border-bottom:none">
            <span>High priority (score &gt; 50)</span>
            <span class="stat-val">${highPri}</span>
        </div>

        <p class="card-title" style="margin-top:8px;">Top Stories</p>
        <div style="display:flex;flex-direction:column;gap:6px;">
            ${top3.map(s => `
                <div class="story-item">
                    <div class="story-item-title">${s.title || 'Untitled'}</div>
                    <div class="story-item-meta">RICE ${s.rice?.score || 0} · ${s.status || '—'}</div>
                </div>
            `).join('')}
        </div>

        <a href="/Modules/Backlog/backlog-view.html" class="shortcut-link">📋 Open Backlog →</a>`;
}

// ── PRODUCT HEALTH ───────────────────────────────────────────────────────────

function renderProductHealth(entries) {
    const container = document.getElementById('healthContent');

    const today    = new Date();
    const msPerDay = 86400000;

    const recent   = entries.filter(e => {
        const d = new Date(e.date || e.createdAt || 0);
        return (today - d) / msPerDay <= 14;
    });
    const medium   = entries.filter(e => {
        const d = new Date(e.date || e.createdAt || 0);
        const age = (today - d) / msPerDay;
        return age > 14 && age <= 60;
    });
    const old      = entries.filter(e => {
        const d = new Date(e.date || e.createdAt || 0);
        return (today - d) / msPerDay > 60;
    });

    // Health score: ratio of recent signals
    const total = entries.length;
    const healthPct = total > 0 ? Math.round((recent.length / total) * 100) : 0;
    let dotClass = 'dot-green', healthLabel = 'Healthy';
    if (healthPct < 30 && total > 0)      { dotClass = 'dot-red';    healthLabel = 'Stale'; }
    else if (healthPct < 60 && total > 0) { dotClass = 'dot-yellow'; healthLabel = 'Moderate'; }

    // Source type breakdown
    const sourceMap = {};
    entries.forEach(e => {
        const src = e.sourceType || 'Unknown';
        sourceMap[src] = (sourceMap[src] || 0) + 1;
    });

    const sourceRows = Object.entries(sourceMap)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([src, count]) => `
            <div class="stat-row">
                <span>${src}</span>
                <span class="stat-val">${count}</span>
            </div>`).join('');

    container.innerHTML = total === 0 ? `
        <div class="empty-state">No signals captured yet.</div>
        <a href="/Modules/intelligence-hub/data-entry.html" class="shortcut-link">🧠 Add Signals →</a>
    ` : `
        <div class="kpi-block">
            <div class="kpi-number">${total}</div>
            <div class="kpi-label">total signals</div>
        </div>

        <div class="stat-row">
            <span><span class="dot ${dotClass}"></span>Signal freshness</span>
            <span class="stat-val">${healthLabel}</span>
        </div>
        <div class="stat-row">
            <span>Recent (&le;14 days)</span>
            <span class="stat-val">${recent.length}</span>
        </div>
        <div class="stat-row">
            <span>Mid-term (15–60 days)</span>
            <span class="stat-val">${medium.length}</span>
        </div>
        <div class="stat-row" style="border-bottom:none">
            <span>Background (&gt;60 days)</span>
            <span class="stat-val">${old.length}</span>
        </div>

        ${sourceRows ? `<p class="card-title" style="margin-top:8px;">By Source</p><div>${sourceRows}</div>` : ''}

        <a href="/Modules/intelligence-hub/analyzer.html" class="shortcut-link">🔍 Run Analysis →</a>`;
}

// ── PRODUCT ALIGNMENT ────────────────────────────────────────────────────────

function renderAlignment(settings) {
    const container = document.getElementById('alignmentContent');

    const vision     = settings.vision || '';
    const objectives = (settings.objectives || []).filter(Boolean);
    const priorities = (settings.priorities || []).filter(Boolean);

    if (!vision && !objectives.length && !priorities.length) {
        container.innerHTML = `
            <p style="text-align:center;color:#94a3b8;font-size:13px;font-style:italic;padding:20px 0;">Vision and objectives not configured.</p>
            <a href="/Modules/settings/settings.html" class="shortcut-link">⚙️ Configure →</a>`;
        return;
    }

    const parts = [];

    if (vision) {
        parts.push(`<div style="font-size:13px;color:#475569;font-style:italic;line-height:1.6;padding:10px 12px;background:#f8fafc;border-radius:8px;border-left:3px solid #4f46e5;margin-bottom:4px;">${Auth.esc(vision)}</div>`);
    }

    if (objectives.length) {
        parts.push(`<p style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#94a3b8;margin:12px 0 6px;">Objectives</p>`);
        objectives.forEach(o => {
            parts.push(`<div style="display:flex;gap:8px;padding:6px 0;border-bottom:1px solid #f1f5f9;font-size:13px;color:#334155;"><span style="flex-shrink:0;color:#4f46e5;font-weight:700;">▸</span><span>${Auth.esc(o)}</span></div>`);
        });
    }

    if (priorities.length) {
        parts.push(`<p style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#94a3b8;margin:12px 0 6px;">Priorities</p>`);
        parts.push(`<div style="display:flex;flex-wrap:wrap;gap:6px;">${priorities.map(p => `<span style="background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe;padding:3px 10px;border-radius:9999px;font-size:12px;font-weight:500;">${Auth.esc(p)}</span>`).join('')}</div>`);
    }

    parts.push(`<a href="/Modules/Vision-board/vision-board.html" class="shortcut-link" style="margin-top:16px;">🎯 Vision Board →</a>`);

    container.innerHTML = parts.join('');
}


// --- INIT ---
document.addEventListener('DOMContentLoaded', async () => {
    const ok = await Auth.requireAuth();
    if (!ok) return;
    await loadHistory();
});

// --- STATE ---
let allRecords = [];

// --- LOAD ---
async function loadHistory() {
    try {
        const res  = await Auth.fetch('/api/meeting-prep/history');
        allRecords = await res.json();
    } catch (e) {
        console.error('Failed to load meeting history:', e);
        allRecords = [];
    }

    document.getElementById('loading-state').style.display = 'none';
    applyFilters();
}

// --- FILTER & SORT ---
function applyFilters() {
    const search   = document.getElementById('filter-search').value.trim().toLowerCase();
    const dateFrom = document.getElementById('filter-date-from').value;  // 'YYYY-MM-DD' or ''
    const dateTo   = document.getElementById('filter-date-to').value;
    const sortBy   = document.getElementById('sort-by').value;

    let filtered = allRecords.filter(r => {
        if (search) {
            const inSubject = (r.subject || '').toLowerCase().includes(search);
            const inActor   = (r.actor   || '').toLowerCase().includes(search);
            if (!inSubject && !inActor) return false;
        }
        if (dateFrom && r.meetingDate < dateFrom) return false;
        if (dateTo   && r.meetingDate > dateTo)   return false;
        return true;
    });

    filtered.sort((a, b) => {
        switch (sortBy) {
            case 'date-asc':   return a.meetingDate.localeCompare(b.meetingDate);
            case 'title-asc':  return (a.subject || '').localeCompare(b.subject || '');
            case 'title-desc': return (b.subject || '').localeCompare(a.subject || '');
            default:           return b.meetingDate.localeCompare(a.meetingDate); // date-desc
        }
    });

    renderList(filtered);
}

function clearFilters() {
    document.getElementById('filter-search').value    = '';
    document.getElementById('filter-date-from').value = '';
    document.getElementById('filter-date-to').value   = '';
    document.getElementById('sort-by').value          = 'date-desc';
    applyFilters();
}

// --- RENDER ---
function renderList(records) {
    const list       = document.getElementById('history-list');
    const emptyState = document.getElementById('empty-state');
    const countEl    = document.getElementById('results-count');
    const btnClear   = document.getElementById('btn-clear');
    const hasFilters = document.getElementById('filter-search').value ||
                       document.getElementById('filter-date-from').value ||
                       document.getElementById('filter-date-to').value;

    list.innerHTML = '';
    btnClear.style.display = hasFilters ? '' : 'none';

    if (records.length === 0) {
        emptyState.style.display = '';
        countEl.textContent = '0';
        return;
    }

    emptyState.style.display = 'none';
    countEl.textContent = records.length;

    records.forEach(r => list.appendChild(buildCard(r)));
}

function buildCard(r) {
    const date       = formatDate(r.meetingDate);
    const radarTotal = (r.radarInsights?.trendsUsed        || 0)
                     + (r.radarInsights?.opportunitiesUsed || 0)
                     + (r.radarInsights?.risksUsed         || 0)
                     + (r.radarInsights?.feedbacksUsed     || 0);
    const detailId   = `detail-${r.id}`;

    const card = document.createElement('div');
    card.className = 'file-item';
    card.style.flexDirection = 'column';
    card.onclick = () => toggleDetail(detailId, card);

    card.innerHTML = `
        <div style="display:flex;align-items:flex-start;gap:12px;width:100%;">
            <span style="font-size:16px;flex-shrink:0;margin-top:2px;">📋</span>
            <div class="file-content">
                <div class="file-meta">
                    ${r.format ? `<span class="meta-tag meta-format">${escHtml(r.format)}</span>` : ''}
                    ${radarTotal > 0 ? `<span class="meta-tag meta-radar">📡 ${radarTotal} radar signal${radarTotal > 1 ? 's' : ''}</span>` : ''}
                </div>
                <div class="file-header">
                    <span class="file-title" title="${escHtml(r.subject)}">${escHtml(r.subject || '(No title)')}</span>
                    <span class="file-date">📅 ${date}</span>
                </div>
                <div class="file-preview">
                    👤 ${escHtml(r.actor || '—')}${r.context ? ` · ${escHtml(r.context)}` : ''}
                </div>
            </div>
            <span class="toggle-icon" id="icon-${r.id}">▸</span>
        </div>

        <div id="${detailId}" class="detail-panel" style="width:100%;">
            <div class="detail-secret">
                <div class="detail-label" style="color:#818cf8;">
                    <span>🤫 Secret Brief</span>
                    <button class="action-btn" onclick="event.stopPropagation();copyText('secret-${r.id}')" style="color:#818cf8;border-color:#374151;background:#1e293b;">Copy</button>
                </div>
                <pre id="secret-${r.id}" style="color:#cbd5e1;font-size:var(--font-size-xs);line-height:1.6;white-space:pre-wrap;font-family:var(--font-family);margin:0;">${escHtml(r.secretBrief || '—')}</pre>
            </div>
            <div class="detail-public">
                <div class="detail-label" style="color:var(--color-text-secondary);">
                    <span>📋 Public Agenda</span>
                    <button class="action-btn" onclick="event.stopPropagation();copyText('public-${r.id}')">Copy</button>
                </div>
                <pre id="public-${r.id}" style="color:var(--color-text-primary);font-size:var(--font-size-xs);line-height:1.6;white-space:pre-wrap;font-family:var(--font-family);font-style:italic;margin:0;">${escHtml(r.publicAgenda || '—')}</pre>
            </div>
            ${radarTotal > 0 ? `
            <div style="background:var(--color-accent-subtle);border:1px solid var(--color-accent-border);border-radius:var(--radius-md);padding:10px 14px;display:flex;flex-wrap:wrap;gap:8px;align-items:center;">
                <span style="font-size:var(--font-size-xs);font-weight:var(--font-weight-bold);color:var(--color-accent);">📡 Radar used:</span>
                ${r.radarInsights?.trendsUsed        ? `<span style="font-size:var(--font-size-xs);color:var(--color-text-secondary);">${r.radarInsights.trendsUsed} trend${r.radarInsights.trendsUsed > 1 ? 's' : ''}</span>` : ''}
                ${r.radarInsights?.opportunitiesUsed ? `<span style="font-size:var(--font-size-xs);color:var(--color-text-secondary);">${r.radarInsights.opportunitiesUsed} opportunit${r.radarInsights.opportunitiesUsed > 1 ? 'ies' : 'y'}</span>` : ''}
                ${r.radarInsights?.risksUsed         ? `<span style="font-size:var(--font-size-xs);color:var(--color-text-secondary);">${r.radarInsights.risksUsed} risk${r.radarInsights.risksUsed > 1 ? 's' : ''}</span>` : ''}
                ${r.radarInsights?.feedbacksUsed     ? `<span style="font-size:var(--font-size-xs);color:var(--color-text-secondary);">${r.radarInsights.feedbacksUsed} feedback${r.radarInsights.feedbacksUsed > 1 ? 's' : ''}</span>` : ''}
            </div>` : ''}
        </div>`;

    return card;
}

// --- TOGGLE DETAIL ---
function toggleDetail(detailId, cardEl) {
    const panel  = document.getElementById(detailId);
    const icon   = cardEl.querySelector('.toggle-icon');
    const isOpen = panel.classList.contains('open');

    panel.classList.toggle('open', !isOpen);
    icon.textContent = isOpen ? '▸' : '▾';
    icon.style.color = isOpen ? '' : 'var(--color-accent)';
}

// --- COPY ---
function copyText(elementId) {
    const text = document.getElementById(elementId)?.innerText || '';
    navigator.clipboard.writeText(text).then(() => {
        const btn = document.querySelector(`button[onclick="copyText('${elementId}')"]`);
        if (btn) {
            const original = btn.textContent;
            btn.textContent = '✅ Copied';
            setTimeout(() => { btn.textContent = original; }, 1500);
        }
    });
}

// --- HELPERS ---
function formatDate(iso) {
    if (!iso) return '—';
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
}

function escHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

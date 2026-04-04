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

    document.getElementById('loading-state').classList.add('hidden');
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

    list.innerHTML = '';

    if (records.length === 0) {
        emptyState.classList.remove('hidden');
        countEl.textContent = '';
        return;
    }

    emptyState.classList.add('hidden');
    countEl.textContent = `${records.length} preparation${records.length > 1 ? 's' : ''}`;

    records.forEach(r => list.appendChild(buildCard(r)));
}

function buildCard(r) {
    const date          = formatDate(r.meetingDate);
    const radarTotal    = (r.radarInsights?.trendsUsed        || 0)
                        + (r.radarInsights?.opportunitiesUsed || 0)
                        + (r.radarInsights?.risksUsed         || 0)
                        + (r.radarInsights?.feedbacksUsed     || 0);
    const radarBadge    = radarTotal > 0
        ? `<span class="radar-badge">📡 ${radarTotal} radar signal${radarTotal > 1 ? 's' : ''}</span>`
        : '';

    const formatLabel   = r.format ? `<span class="radar-badge" style="background:#f0fdf4;color:#166534;">${r.format}</span>` : '';
    const cardId        = `card-${r.id}`;
    const detailId      = `detail-${r.id}`;

    const card = document.createElement('div');
    card.className = 'prep-card bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden';
    card.id = cardId;

    card.innerHTML = `
        <!-- Card header (always visible) -->
        <div class="p-5 cursor-pointer select-none"
             onclick="toggleDetail('${detailId}', this)">
            <div class="flex items-start justify-between gap-4">
                <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2 mb-1 flex-wrap">
                        ${formatLabel}
                        ${radarBadge}
                    </div>
                    <h3 class="font-bold text-slate-900 text-base leading-snug truncate"
                        title="${escHtml(r.subject)}">
                        ${escHtml(r.subject || '(No title)')}
                    </h3>
                    <div class="flex items-center gap-3 mt-1 text-slate-400 text-xs">
                        <span>👤 ${escHtml(r.actor || '—')}</span>
                        <span>·</span>
                        <span>📅 ${date}</span>
                        ${r.context ? `<span>·</span><span class="italic truncate max-w-xs" title="${escHtml(r.context)}">${escHtml(r.context)}</span>` : ''}
                    </div>
                </div>
                <span class="toggle-icon text-slate-400 text-lg flex-shrink-0 mt-1">▸</span>
            </div>
        </div>

        <!-- Detail panel (expandable) -->
        <div id="${detailId}" class="detail-panel border-t border-slate-100">

            <!-- Secret Brief -->
            <div class="p-5 bg-slate-900">
                <div class="flex justify-between items-center mb-3">
                    <span class="text-[10px] font-black text-indigo-400 uppercase tracking-widest">
                        🤫 Secret Brief
                    </span>
                    <button onclick="copyText('secret-${r.id}')"
                            class="text-[10px] text-slate-400 hover:text-white font-bold transition">
                        📋 Copy
                    </button>
                </div>
                <pre id="secret-${r.id}"
                     class="text-slate-300 text-xs leading-relaxed whitespace-pre-wrap font-sans"
                >${escHtml(r.secretBrief || '—')}</pre>
            </div>

            <!-- Public Agenda -->
            <div class="p-5 bg-white border-t border-slate-100">
                <div class="flex justify-between items-center mb-3">
                    <span class="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                        📋 Public Agenda
                    </span>
                    <button onclick="copyText('public-${r.id}')"
                            class="text-[10px] text-indigo-500 hover:text-indigo-700 font-bold transition">
                        📋 Copy
                    </button>
                </div>
                <pre id="public-${r.id}"
                     class="text-slate-600 text-xs leading-relaxed whitespace-pre-wrap font-sans italic"
                >${escHtml(r.publicAgenda || '—')}</pre>
            </div>

            <!-- Radar signals used -->
            ${radarTotal > 0 ? `
            <div class="px-5 py-3 bg-indigo-50 border-t border-indigo-100 flex flex-wrap gap-2 text-[11px] text-indigo-700">
                <span class="font-bold">📡 Radar used:</span>
                ${r.radarInsights?.trendsUsed        ? `<span>${r.radarInsights.trendsUsed} trend${r.radarInsights.trendsUsed > 1 ? 's' : ''}</span>` : ''}
                ${r.radarInsights?.opportunitiesUsed ? `<span>${r.radarInsights.opportunitiesUsed} opportunit${r.radarInsights.opportunitiesUsed > 1 ? 'ies' : 'y'}</span>` : ''}
                ${r.radarInsights?.risksUsed         ? `<span>${r.radarInsights.risksUsed} risk${r.radarInsights.risksUsed > 1 ? 's' : ''}</span>` : ''}
                ${r.radarInsights?.feedbacksUsed     ? `<span>${r.radarInsights.feedbacksUsed} feedback${r.radarInsights.feedbacksUsed > 1 ? 's' : ''}</span>` : ''}
            </div>` : ''}

        </div>`;

    return card;
}

// --- TOGGLE DETAIL ---
function toggleDetail(detailId, headerEl) {
    const panel    = document.getElementById(detailId);
    const icon     = headerEl.querySelector('.toggle-icon');
    const isOpen   = panel.classList.contains('open');

    panel.classList.toggle('open', !isOpen);
    icon.textContent  = isOpen ? '▸' : '▾';
    icon.style.color  = isOpen ? '' : '#6366f1';
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

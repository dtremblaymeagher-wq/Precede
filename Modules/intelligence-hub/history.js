function formatDate(raw) {
    if (!raw) return '—';
    const d = new Date(raw + 'T00:00:00');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

async function loadHistory() {
    const status    = document.getElementById('status');
    const tableCard = document.getElementById('tableCard');
    const tbody     = document.getElementById('archiveBody');

    try {
        const res = await Auth.fetch('/api/intelligence-hub/entries');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const entries = await res.json();

        status.style.display = 'none';

        if (entries.length === 0) {
            status.style.display = 'block';
            status.textContent = 'No entries yet. Log your first signal via Capture Feedback.';
            return;
        }

        tbody.innerHTML = '';

        entries.forEach(entry => {
            const tr = document.createElement('tr');

            const tdDate = document.createElement('td');
            tdDate.style.whiteSpace = 'nowrap';
            tdDate.style.color = 'var(--color-text-muted)';
            tdDate.style.fontSize = 'var(--font-size-xs)';
            tdDate.textContent = formatDate(entry.date);
            tr.appendChild(tdDate);

            const tdPerson = document.createElement('td');
            tdPerson.style.fontWeight = 'var(--font-weight-bold)';
            tdPerson.textContent = entry.person || '—';
            tr.appendChild(tdPerson);

            const tdSource = document.createElement('td');
            if (entry.sourceType) {
                const badge = document.createElement('span');
                badge.className = 'badge-source';
                badge.textContent = entry.sourceType;
                tdSource.appendChild(badge);
            } else {
                tdSource.textContent = '—';
            }
            tr.appendChild(tdSource);

            const tdBody = document.createElement('td');
            tdBody.style.lineHeight = '1.5';
            tdBody.textContent = entry.body || '—';
            tr.appendChild(tdBody);

            const tdEdit = document.createElement('td');
            if (entry.id) {
                const link = document.createElement('a');
                link.className = 'link-edit';
                link.href = `/Modules/intelligence-hub/data-entry.html?edit=${entry.id}`;
                link.textContent = 'Edit';
                tdEdit.appendChild(link);
            }
            tr.appendChild(tdEdit);

            tbody.appendChild(tr);
        });

        tableCard.style.display = 'block';

    } catch (err) {
        console.error('Error loading archive:', err);
        status.style.display = 'block';
        status.textContent = 'Failed to load entries. Please refresh the page.';
        status.style.color = 'var(--color-text-error, #ef4444)';
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    const ok = await Auth.requireAuth();
    if (!ok) return;
    await loadHistory();
});

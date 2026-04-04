document.addEventListener('DOMContentLoaded', async () => {
    const ok = await Auth.requireAuth();
    if (!ok) return;
    const actorSelect = document.getElementById('actor');
    const entriesList = document.getElementById('entriesList');
    const saveBtn = document.getElementById('saveEntry');
    const status = document.getElementById('status');

    // 1. CHARGER LES CLIENTS (SETTINGS)
    async function loadClients() {
        try {
            const res = await Auth.fetch('/api/settings');
            const settings = await res.json();
            if (settings.clients && Array.isArray(settings.clients)) {
                actorSelect.innerHTML = '<option value="">-- Select a Client --</option>';
                settings.clients.forEach(client => {
                    const option = document.createElement('option');
                    option.value = client; option.textContent = client;
                    actorSelect.appendChild(option);
                });
            }
        } catch (err) { console.error('Error loading clients:', err); }
    }

    // 2. CHARGER ET AFFICHER LES ENTRÉES (AVEC PROTECTION SUBSTRING)
    async function loadRawData() {
        if (!entriesList) return;

        try {
            const res = await Auth.fetch('/api/intelligence-hub/entries');
            const entries = await res.json();

            if (!entries || !Array.isArray(entries) || entries.length === 0) {
                entriesList.innerHTML = '<p class="text-slate-400 italic p-4 bg-white rounded-xl border">No data found.</p>';
                return;
            }

            // On affiche du plus récent au plus ancien
            const sortedEntries = [...entries].reverse();

            entriesList.innerHTML = sortedEntries.map(entry => {
                if (!entry) return '';

                // --- UNIFICATION DES DONNÉES (Gère les différents formats) ---
                
                // Texte : cherche 'body' puis 'content', sinon vide
                const rawText = entry.body || entry.content || "";
                
                // Acteur : cherche 'actor' puis 'person', sinon 'Anonyme'
                const displayActor = entry.actor || entry.person || "Unknown Source";
                
                // Type : cherche 'sourceType', 'type' ou 'source'
                const displayType = entry.sourceType || entry.type || entry.source || "NOTE";

                // --- PROTECTION SUBSTRING ---
                // On force la conversion en String et on vérifie l'existence avant de couper
                const safeText = String(rawText);
                const preview = safeText.length > 200 
                    ? safeText.substring(0, 200) + "..." 
                    : safeText;

                return `
                    <div class="bg-white p-5 rounded-xl shadow-sm border border-slate-200 mb-4 hover:border-indigo-300 transition-all">
                        <div class="flex justify-between items-start mb-3">
                            <div class="flex flex-col gap-1">
                                <span class="text-[10px] font-black uppercase tracking-widest text-indigo-600 bg-indigo-50 px-2 py-1 rounded w-fit">
                                    ${displayType}
                                </span>
                                <h4 class="font-bold text-slate-800">${displayActor}</h4>
                            </div>
                            <span class="text-[10px] font-mono text-slate-400">
                                ${entry.date || 'No date'}
                            </span>
                        </div>
                        
                        <p class="text-sm text-slate-600 leading-relaxed whitespace-pre-wrap">${preview || '<i class="text-slate-300">No content</i>'}</p>

                        <div class="mt-4 pt-3 border-t border-slate-50 flex flex-wrap gap-2">
                            ${(entry.tags || []).map(tag => `
                                <span class="text-[9px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">#${tag}</span>
                            `).join('')}
                        </div>
                    </div>
                `;
            }).join('');

        } catch (err) {
            console.error('Error loading data:', err);
            entriesList.innerHTML = `<p class="text-red-500 p-4">Display error: ${err.message}</p>`;
        }
    }

    // 3. SAUVEGARDER UNE NOUVELLE ENTRÉE
    if (saveBtn) {
        saveBtn.addEventListener('click', async () => {
            const sourceType = document.getElementById('sourceType').value;
            const actor = document.getElementById('actor').value;
            const date = document.getElementById('date').value;
            const body = document.getElementById('body').value.trim();

            if (!sourceType || !actor || !date || !body) {
                status.innerText = '❌ All fields are required';
                status.className = "text-red-500 font-bold mt-2 text-sm";
                return;
            }

            const entry = {
                id: crypto.randomUUID(),
                sourceType,
                actor, // Aligné sur le nouveau format
                date,
                body,
                createdAt: new Date().toISOString(),
                tags: [sourceType, actor]
            };

            try {
                const res = await Auth.fetch('/api/intelligence-hub/entry', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(entry)
                });

                if (res.ok) {
                    status.innerText = '✅ Saved!';
                    status.className = "text-emerald-500 font-bold mt-2 text-sm";
                    document.getElementById('body').value = '';
                    await loadRawData();
                }
            } catch (err) { console.error(err); }
        });
    }

    loadClients();
    loadRawData();
});
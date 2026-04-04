// ==========================================
// 1. GESTION DE L'INTERFACE (ONGLETS & UI)
// ==========================================

window.switchTab = function(target) {
    // Hide all tab content
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));

    // Reset secondary sidebar active state
    document.getElementById('btn-prep').classList.remove('active');
    document.getElementById('btn-summary').classList.remove('active');

    // Activate target
    document.getElementById('section-' + target).classList.add('active');
    document.getElementById('btn-' + target).classList.add('active');
};

window.copyToClipboard = function(elementId) {
    const text = document.getElementById(elementId).innerText;
    navigator.clipboard.writeText(text).then(() => {
        alert("Copié dans le presse-papier !");
    });
};

window.shareSummaryByEmail = function() {
    const content = document.getElementById('sum-content').innerText;
    const actor = document.getElementById('prep-actor').value;
    const subject = document.getElementById('sum-decision').value || "Compte-rendu de réunion";
    
    const body = `Bonjour,\n\nVoici le compte-rendu de notre échange (${actor}) :\n\n${content}`;
    window.location.href = `mailto:?subject=${encodeURIComponent("CR : " + subject)}&body=${encodeURIComponent(body)}`;
};

// ==========================================
// 2. INITIALISATION ET CHARGEMENT DES DONNÉES
// ==========================================

document.addEventListener('DOMContentLoaded', async () => {
    const ok = await Auth.requireAuth();
    if (!ok) return;
    const actorSelect = document.getElementById('prep-actor');
    let currentInsight = "";
    let lastSecretBrief = "";
    let lastPublicAgenda = "";
    let lastPrepPayload = {};
    let lastRadarInsights = {};

    async function init() {
        try {
            const res = await Auth.fetch('/api/settings');
            const settings = await res.json();
            
            // On vide et on remplit le sélecteur d'acteurs
            actorSelect.innerHTML = '<option value="Équipe Interne">👥 Équipe Interne</option>';
            if (settings.clients && settings.clients.length > 0) {
                settings.clients.forEach(c => {
                    const opt = document.createElement('option');
                    opt.value = c;
                    opt.textContent = `👤 ${c}`;
                    actorSelect.appendChild(opt);
                });
            }
        } catch (e) {
            console.error("Erreur au chargement des réglages:", e);
        }
    }

    // ==========================================
    // 3. LOGIQUE : STRATEGIST (PREP)
    // ==========================================

    const prepBtn = document.getElementById('prep-generate');
    prepBtn.onclick = async () => {
        const payload = {
            actor: actorSelect.value,
            subject: document.getElementById('prep-subject').value,
            context: document.getElementById('prep-context').value,
            format: document.getElementById('prep-format')?.value || "Réunion"
        };

        if (!payload.subject) return alert("Veuillez saisir l'objectif de la réunion.");

        prepBtn.disabled = true;
        prepBtn.innerText = "STRATÉGIE EN COURS...";

        try {
            const res = await Auth.fetch('/api/meeting-prep', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await res.json();
            
            // Extraction par Regex des balises <SECRET> et <PUBLIC>
            const secret = data.analysis.match(/<SECRET>([\s\S]*?)<\/SECRET>/i)?.[1] || "Pas de brief secret généré.";
            const publicAg = data.analysis.match(/<PUBLIC>([\s\S]*?)<\/PUBLIC>/i)?.[1] || data.analysis;

            lastSecretBrief  = secret;
            lastPublicAgenda = publicAg;
            lastPrepPayload  = payload;
            lastRadarInsights = data.radarInsights || {};

            document.getElementById('prep-result').classList.remove('hidden');
            document.getElementById('prep-content-secret').innerText = secret.trim();
            document.getElementById('prep-content-public').innerText = publicAg.trim();
            
            document.getElementById('prep-result').scrollIntoView({ behavior: 'smooth' });

        } catch (e) {
            alert("Erreur lors de la génération de la stratégie.");
        } finally {
            prepBtn.disabled = false;
            prepBtn.innerText = "GÉNÉRER LA STRATÉGIE ✨";
        }
    };

    window.savePrepToHub = async function() {
        const btn = document.getElementById('btn-save-prep');
        const res = await Auth.fetch('/api/meeting-prep/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                actor:         lastPrepPayload.actor   || actorSelect.value,
                subject:       lastPrepPayload.subject || '',
                context:       lastPrepPayload.context || '',
                format:        lastPrepPayload.format  || 'Réunion',
                meetingDate:   new Date().toISOString().split('T')[0],
                secretBrief:   lastSecretBrief,
                publicAgenda:  lastPublicAgenda,
                radarInsights: lastRadarInsights
            })
        });

        if (res.ok) {
            btn.innerText = "✅ SAUVEGARDÉ";
            btn.disabled = true;
        }
    };

    // ==========================================
    // 4. LOGIQUE : SUMMARY (POST-MEETING)
    // ==========================================

    const sumBtn = document.getElementById('sum-generate');
    sumBtn.onclick = async () => {
        const notes = document.getElementById('sum-notes').value;
        const forcedDecision = document.getElementById('sum-decision').value;
        const rawDate = document.getElementById('sum-next-date').value;
        const attendees = document.getElementById('sum-attendees').value;

        if (!notes) return alert("Veuillez coller vos notes ou la transcription.");

        // Formatage de la date en FR pour l'IA
        const formattedDate = rawDate ? rawDate.split('-').reverse().join('/') : "";

        // CONSTRUCTION DU MESSAGE AVEC HIERARCHIE DE VERITÉ
        const structuredNotes = `
### CONTEXTE PRIORITAIRE (VÉRITÉ ABSOLUE) ###
DÉCISION VALIDÉE : ${forcedDecision || "NON RENSEIGNÉE - À EXTRAIRE DES NOTES"}
DATE DE SUIVI FIXÉE : ${formattedDate || "NON RENSEIGNÉE - À EXTRAIRE DES NOTES"}
PARTICIPANTS : ${attendees || "NON RENSEIGNÉS"}
##########################################

### NOTES BRUTES (POUR ANALYSE) ###
${notes}
        `;

        sumBtn.disabled = true;
        sumBtn.innerText = "SYNTHÈSE EN COURS...";

        try {
            const res = await Auth.fetch('/api/post-meeting', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    notes: structuredNotes, 
                    actor: actorSelect.value 
                })
            });
            const data = await res.json();
            
            const summary = data.analysis.match(/<SUMMARY>([\s\S]*?)<\/SUMMARY>/i)?.[1] || data.analysis;
            currentInsight = data.analysis.match(/<INSIGHT>([\s\S]*?)<\/INSIGHT>/i)?.[1] || "Pas d'insight spécifique détecté.";

            document.getElementById('sum-result').classList.remove('hidden');
            document.getElementById('sum-content').innerText = summary.trim();
            document.getElementById('sum-insight').innerText = currentInsight.trim();
            
            document.getElementById('sum-result').scrollIntoView({ behavior: 'smooth' });

        } catch (e) {
            alert("Erreur lors de la synthèse IA.");
        } finally {
            sumBtn.disabled = false;
            sumBtn.innerText = "SYNTHÉTISER L'IA 🤖";
        }
    };

    document.getElementById('sum-save-hub').onclick = async () => {
        const btn = document.getElementById('sum-save-hub');
        const entry = {
            id: crypto.randomUUID(),
            sourceType: "meeting_summary",
            actor: actorSelect.value,
            date: new Date().toISOString().split('T')[0],
            body: `[INSIGHT MEETING]\n\n${currentInsight}`,
            createdAt: new Date().toISOString(),
            tags: ["Insight", "Meeting"]
        };

        const res = await Auth.fetch('/api/intelligence-hub/entry', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(entry)
        });

        if (res.ok) {
            btn.innerText = "✅ ARCHIVÉ DANS LE HUB";
            btn.disabled = true;
        }
    };

    init();
});
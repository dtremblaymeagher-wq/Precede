// ==========================================
// 1. TAB NAVIGATION & UI
// ==========================================

window.switchTab = function(target) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    document.getElementById('btn-prep').classList.remove('active');
    document.getElementById('btn-summary').classList.remove('active');
    document.getElementById('section-' + target).classList.add('active');
    document.getElementById('btn-' + target).classList.add('active');
};

window.copyToClipboard = function(elementId) {
    const text = document.getElementById(elementId).innerText;
    navigator.clipboard.writeText(text).then(() => {
        alert("Copied to clipboard!");
    });
};

window.shareSummaryByEmail = function() {
    const content = document.getElementById('sum-content').innerText;
    const actor = document.getElementById('prep-actor').value;
    const subject = document.getElementById('sum-decision').value || "Meeting Summary";

    const body = `Hi,\n\nHere is the summary of our meeting (${actor}):\n\n${content}`;
    window.location.href = `mailto:?subject=${encodeURIComponent("Summary: " + subject)}&body=${encodeURIComponent(body)}`;
};

// ==========================================
// 2. INIT & DATA LOADING
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

            actorSelect.innerHTML = '<option value="Internal Team">👥 Internal Team</option>';
            if (settings.clients && settings.clients.length > 0) {
                settings.clients.forEach(c => {
                    const opt = document.createElement('option');
                    opt.value = c;
                    opt.textContent = `👤 ${c}`;
                    actorSelect.appendChild(opt);
                });
            }
        } catch (e) {
            console.error("Error loading settings:", e);
        }
    }

    // ==========================================
    // 3. MEETING PREP
    // ==========================================

    const prepBtn = document.getElementById('prep-generate');
    prepBtn.onclick = async () => {
        const payload = {
            actor: actorSelect.value,
            subject: document.getElementById('prep-subject').value,
            context: document.getElementById('prep-context').value,
            format: document.getElementById('prep-format')?.value || "Meeting"
        };

        if (!payload.subject) return alert("Please enter the meeting objective.");

        prepBtn.disabled = true;
        prepBtn.innerText = "GENERATING STRATEGY...";

        try {
            const res = await Auth.fetch('/api/meeting-prep', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await res.json();

            const secret = data.analysis.match(/<SECRET>([\s\S]*?)<\/SECRET>/i)?.[1] || "No secret brief generated.";
            const publicAg = data.analysis.match(/<PUBLIC>([\s\S]*?)<\/PUBLIC>/i)?.[1] || "No public agenda generated.";

            lastSecretBrief   = secret;
            lastPublicAgenda  = publicAg;
            lastPrepPayload   = payload;
            lastRadarInsights = data.radarInsights || {};

            document.getElementById('prep-result').classList.remove('hidden');
            document.getElementById('prep-content-secret').innerText = secret.trim();
            document.getElementById('prep-content-public').innerText = publicAg.trim();

            document.getElementById('prep-result').scrollIntoView({ behavior: 'smooth' });

        } catch (e) {
            alert("Error generating the strategy.");
        } finally {
            prepBtn.disabled = false;
            prepBtn.innerText = "GENERATE STRATEGY ✨";
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
                format:        lastPrepPayload.format  || 'Meeting',
                meetingDate:   new Date().toISOString().split('T')[0],
                secretBrief:   lastSecretBrief,
                publicAgenda:  lastPublicAgenda,
                radarInsights: lastRadarInsights
            })
        });

        if (res.ok) {
            btn.innerText = "✅ SAVED";
            btn.disabled = true;
        }
    };

    // ==========================================
    // 4. POST-MEETING SUMMARY
    // ==========================================

    const sumBtn = document.getElementById('sum-generate');
    sumBtn.onclick = async () => {
        const notes = document.getElementById('sum-notes').value;
        const forcedDecision = document.getElementById('sum-decision').value;
        const rawDate = document.getElementById('sum-next-date').value;
        const attendees = document.getElementById('sum-attendees').value;

        if (!notes) return alert("Please paste your notes or transcript.");

        const formattedDate = rawDate ? rawDate.split('-').reverse().join('/') : "";

        const structuredNotes = `
### PRIORITY CONTEXT (GROUND TRUTH) ###
VALIDATED DECISION: ${forcedDecision || "NOT PROVIDED - EXTRACT FROM NOTES"}
FOLLOW-UP DATE: ${formattedDate || "NOT PROVIDED - EXTRACT FROM NOTES"}
ATTENDEES: ${attendees || "NOT PROVIDED"}
########################################

### RAW NOTES (FOR ANALYSIS) ###
${notes}
        `;

        sumBtn.disabled = true;
        sumBtn.innerText = "SYNTHESIZING...";

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
            currentInsight = data.analysis.match(/<INSIGHT>([\s\S]*?)<\/INSIGHT>/i)?.[1] || "No specific insight detected.";

            document.getElementById('sum-result').classList.remove('hidden');
            document.getElementById('sum-content').innerText = summary.trim();
            document.getElementById('sum-insight').innerText = currentInsight.trim();

            document.getElementById('sum-result').scrollIntoView({ behavior: 'smooth' });

        } catch (e) {
            alert("Error synthesizing with AI.");
        } finally {
            sumBtn.disabled = false;
            sumBtn.innerText = "SYNTHESIZE WITH AI 🤖";
        }
    };

    document.getElementById('sum-save-hub').onclick = async () => {
        const btn = document.getElementById('sum-save-hub');
        const entry = {
            id: crypto.randomUUID(),
            sourceType: "meeting_summary",
            actor: actorSelect.value,
            date: new Date().toISOString().split('T')[0],
            body: `[MEETING INSIGHT]\n\n${currentInsight}`,
            createdAt: new Date().toISOString(),
            tags: ["Insight", "Meeting"]
        };

        const res = await Auth.fetch('/api/intelligence-hub/entry', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(entry)
        });

        if (res.ok) {
            btn.innerText = "✅ ARCHIVED TO HUB";
            btn.disabled = true;
        }
    };

    init();
});
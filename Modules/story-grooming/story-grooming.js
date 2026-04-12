
// --- RICH TEXT EDITORS ---
let _editorUserStory = null;

// --- UTILITIES ---
function setVisible(id, isVisible) {
    const el = document.getElementById(id);
    if (el) el.style.display = isVisible ? 'block' : 'none';
}
function getUserInput() { return document.getElementById('user-input'); }

// --- INIT & RADAR IMPORT ---
document.addEventListener('DOMContentLoaded', async () => {
    const ok = await Auth.requireAuth();
    if (!ok) return;

    setVisible('storyOutput', false);
    setVisible('loadingOverlay', false);
    initEditors();

    const pendingIdea = localStorage.getItem(PRECEDE.PENDING_STORY_KEY);
    if (pendingIdea) {
        const inputEl = getUserInput();
        if (inputEl) {
            inputEl.value = pendingIdea;
            inputEl.style.border = '2px solid #4f46e5';
            inputEl.style.backgroundColor = '#f5f3ff';
            inputEl.focus();
        }
        localStorage.removeItem(PRECEDE.PENDING_STORY_KEY);
    }
});

// --- PARSE STRUCTURED AI RESPONSE ---
function parseStoryResponse(text) {
    const titleMatch      = text.match(/TITLE:\s*(.+)/i);
    // Capture USER STORY through RICE — ACs are embedded within
    const userStoryMatch  = text.match(/USER STORY:\s*([\s\S]+?)(?=RICE:|$)/i);
    const reachMatch      = text.match(/Reach:\s*(\d+)/i);
    const impactMatch     = text.match(/Impact:\s*([\d.]+)/i);
    const confidenceMatch = text.match(/Confidence:\s*(\d+)/i);
    const effortMatch     = text.match(/Effort:\s*(\d+)/i);

    return {
        title:      titleMatch?.[1]?.trim()      || '',
        userStory:  userStoryMatch?.[1]?.trim()  || '',
        reach:      parseInt(reachMatch?.[1])     || 100,
        impact:     parseFloat(impactMatch?.[1])  || 1,
        confidence: parseInt(confidenceMatch?.[1])|| 80,
        effort:     parseInt(effortMatch?.[1])    || 3,
    };
}

// --- INIT RICH TEXT EDITORS ---
function initEditors() {
    if (typeof RichTextEditor === 'undefined') return;
    const userStoryEl = document.getElementById('storyUserStory');
    if (userStoryEl) {
        _editorUserStory = new RichTextEditor(userStoryEl, {
            placeholder: 'As a [persona], I want to [action] so that [benefit]\n\nAcceptance Criteria:\n- Given / When / Then...',
            minHeight:   '200px',
        });
    }
}

// --- POPULATE EDITABLE FIELDS ---
function populateFields(parsed) {
    document.getElementById('storyTitle').value = parsed.title;
    if (_editorUserStory) {
        _editorUserStory.setContent(parsed.userStory);
    } else {
        document.getElementById('storyUserStory').value = parsed.userStory;
    }
    document.getElementById('riceReach').value       = parsed.reach;
    document.getElementById('riceImpact').value      = parsed.impact;
    document.getElementById('riceConfidence').value  = parsed.confidence;
    document.getElementById('riceEffort').value      = parsed.effort;
    updateRiceScore();
}

// --- LIVE RICE CALCULATION ---
function updateRiceScore() {
    const reach      = parseFloat(document.getElementById('riceReach').value)      || 0;
    const impact     = parseFloat(document.getElementById('riceImpact').value)     || 0;
    const confidence = parseFloat(document.getElementById('riceConfidence').value) || 0;
    const effort     = parseFloat(document.getElementById('riceEffort').value)     || 1;
    const score      = Math.round((reach * impact * (confidence / 100)) / effort);
    document.getElementById('riceScoreDisplay').textContent = score || '—';
}

// --- READ CURRENT STORY FROM FIELDS ---
function getCurrentStoryData() {
    const title     = document.getElementById('storyTitle').value.trim();
    const userStory = _editorUserStory
        ? _editorUserStory.getText().trim()
        : document.getElementById('storyUserStory').value.trim();
    const reach      = parseFloat(document.getElementById('riceReach').value)      || 0;
    const impact     = parseFloat(document.getElementById('riceImpact').value)     || 0;
    const confidence = parseFloat(document.getElementById('riceConfidence').value) || 80;
    const effort     = parseFloat(document.getElementById('riceEffort').value)     || 1;
    const score      = parseFloat(document.getElementById('riceScoreDisplay').textContent) || 0;

    return {
        title,
        content: userStory,
        rice: { reach, impact, confidence, effort, score },
    };
}

// --- EXPERT COMMITTEE CARDS (unchanged) ---
function renderCommitteeCards(text, targetContainerId = 'committeeContainer') {
    const container = document.getElementById(targetContainerId);
    const experts = [
        { key: 'UX',  emoji: '👨‍🏫', label: 'EXPERT UX' },
        { key: 'CTO', emoji: '⚙️',  label: 'EXPERT CTO' },
        { key: 'PM',  emoji: '🎯',  label: 'EXPERT PM' },
    ];

    experts.forEach(expert => {
        const regex = new RegExp(`${expert.label}[:\\s]*([\\s\\S]*?)(?=EXPERT|DEV SENIOR|$)`, 'i');
        const match = text.match(regex);

        if (match) {
            const content        = match[1].trim();
            const proposalMatch  = content.match(/✨\s*(?:PROPOSITION|SUGGESTION)[:\s]*([\s\S]*?)$/i);
            const analysis       = content.replace(/✨\s*(?:PROPOSITION|SUGGESTION)[:\s]*[\s\S]*$/i, '').trim();
            let proposal         = proposalMatch ? proposalMatch[1].trim() : '';

            const refusalPhrases = [/no proposal/i, /no suggestion/i, /no improvement/i, /nothing to add/i, /compliant/i, /validated/i, /n\/?a/i, /pas de proposition/i, /aucune proposition/i, /pas d'amélioration/i, /aucune amélioration/i, /rien à ajouter/i, /conforme/i, /validé/i];
            if (proposal.length < 30 || refusalPhrases.some(p => p.test(proposal))) proposal = '';

            const card = document.createElement('div');
            card.className = 'expert-card';
            card.style = 'background:white; border:1px solid #e2e8f0; padding:15px; border-radius:10px; margin-bottom:15px; box-shadow:0 2px 4px rgba(0,0,0,0.05);';

            let cardHtml = `<div style="display:flex; justify-content:space-between; align-items:center;"><strong>${expert.emoji} ${expert.label}</strong>`;
            cardHtml += proposal ? `<span style="color:#f97316; font-size:0.75em; font-weight:bold;">💡 IMPROVEMENT</span></div>` : `<span style="color:#059669; font-size:0.75em; font-weight:bold;">✅ VALIDATED</span></div>`;
            cardHtml += `<p style="margin-top:10px; color:#4b5563; font-size:0.9em; line-height:1.4;">${analysis}</p>`;

            if (proposal) {
                cardHtml += `
                    <div style="background:#fff7ed; padding:12px; border-radius:6px; border-left:4px solid #f97316; margin-top:12px; font-size:0.85em;">
                        <strong style="color:#9a3412;">💡 BUSINESS SUGGESTION</strong>
                        <div style="margin-top:8px; white-space:pre-wrap;">${proposal}</div>
                    </div>
                    <button onclick="applyExpertSuggestion(\`${proposal.replace(/`/g, '\\`').replace(/\$/g, '\\$')}\`)"
                            style="width:100%; margin-top:10px; cursor:pointer; padding:10px; background:#f97316; color:white; border:none; border-radius:6px; font-weight:bold; font-size:0.85em;">
                        ➕ Apply this improvement
                    </button>`;
            }
            card.innerHTML = cardHtml;
            container.appendChild(card);
        }
    });
}

// --- GENERATE STORY ---
async function sendMessage() {
    const text = getUserInput().value.trim();
    if (!text) { alert('Please enter a description'); return; }

    setVisible('loadingOverlay', true);
    setVisible('storyOutput', false);
    document.getElementById('committeeContainer').innerHTML = '';

    try {
        const [settings, vault] = await Promise.all([
            Auth.fetch('/api/settings').then(r => r.json()),
            Auth.fetch('/api/learning/vault').then(r => r.json()).catch(() => ({ advice: '' })),
        ]);
        const personasContext  = (settings.personas || []).filter(p => p.name).map(p => `- ${p.name}${p.role ? ` (${p.role})` : ''}`).join('\n');
        const objectivesContext = (settings.objectives || []).join('\n- ');

        const vaultSection = vault?.advice
            ? `\nDEEP LEARNING GUIDANCE (learned from past backlog frictions — apply these improvements):\n${vault.advice}\n`
            : '';

        const systemPrompt = `You are an expert Product Manager. Write a professional User Story.
PRODUCT CONTEXT:
Vision: ${settings.vision}
Objectives:
- ${objectivesContext}
Priorities: ${(settings.priorities || []).join(', ')}
Available Personas:
${personasContext}
USER STORY TEMPLATE — follow this structure exactly:
${settings.userStoryTemplate}
${vaultSection}
The USER STORY section must follow this template structure exactly. Do not add any section or header that is not in the template above.
STRICT RULES:
1. Use a RELEVANT persona 2. Aligned with Vision/OKRs 3. "TBD" if technical detail is missing 4. Include error cases 5. Real KPI or "TBD" 6. Fibonacci effort.

Format your response with these exact section headers:
TITLE: [4-6 word title]
USER STORY:
[Story following the template above]
RICE:
Reach: [number]
Impact: [0.25-3]
Confidence: [0-100]
Effort: [fibonacci number]`;

        const response = await Auth.fetch('/api/generate', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ system: systemPrompt, messages: [{ role: 'user', content: text }] }),
        });

        const data = await response.json();
        if (data.content && data.content[0]) {
            const parsed = parseStoryResponse(data.content[0].text);
            populateFields(parsed);
            setVisible('storyOutput', true);
            window._seniorPMQuestions = [];
            window._uxGaps = [];
            window._ctoConcerns = [];
            await runDualAnalysis(getCurrentStoryData().content, settings);
        }
    } catch (e) { console.error(e); }

    setVisible('loadingOverlay', false);
}

// --- LOAD PRODUCT CONTEXT (backlog + radar) ---
async function loadProductContext() {
    try {
        const [backlogRes, historyRes] = await Promise.all([
            Auth.fetch('/api/backlog/summary'),
            Auth.fetch('/api/history')
        ]);

        const backlogSummary = await backlogRes.json();
        const historyFiles   = await historyRes.json();

        let radarSignals = 'No radar analysis available';
        let radarRisks   = 'No risks identified';

        if (historyFiles.length > 0) {
            const latestRadar = await Auth.fetch(
                `/api/history/${historyFiles[0]}`
            ).then(r => r.json());

            const analysis = latestRadar.analysis || latestRadar;

            if (analysis.trends?.length > 0) {
                radarSignals = analysis.trends
                    .slice(0, 4)
                    .map(t => `- ${t.topic} (${t.signal_strength}, ${t.evolution})`)
                    .join('\n');
            }

            if (analysis.risks?.length > 0) {
                radarRisks = analysis.risks
                    .slice(0, 3)
                    .map(r => `- ${r.title}: ${r.description}`)
                    .join('\n');
            }
        }

        return {
            backlogSummary: backlogSummary.summary || 'Empty backlog',
            radarSignals,
            radarRisks
        };
    } catch (e) {
        console.error('loadProductContext failed:', e);
        return {
            backlogSummary: 'Context unavailable',
            radarSignals:   'No radar analysis available',
            radarRisks:     'No risks identified'
        };
    }
}

// --- UNIFIED COMMITTEE PROMPT ---
function buildCommitteePrompt(storyText, settings, productContext, previousQA) {
    const okrList     = (settings.objectives || []).map((o, i) => `${i + 1}. ${o}`).join('\n') || 'None defined';
    const personaList = (settings.personas   || []).map(p => p.name).join(', ') || 'Not defined';
    const dorCriteria = settings.definitionOfReady || 'Not defined';

    const previousQASection = previousQA?.length > 0 ? `
PREVIOUS REVIEW CONTEXT:
The PM has already answered blocking questions from a previous review.
Do not ask the same questions again. Acknowledge the answers and focus on whether the updated story addresses the original concerns.

${previousQA.map(qa => `Q: ${qa.question}\nA: ${qa.answer}`).join('\n\n')}
` : '';

    return `You are a product review committee of four experts reviewing a user story simultaneously.
Return your complete analysis as a single JSON object — no text before or after the JSON.

LANGUAGE RULE: Always respond in English only, regardless of input language.

COMPREHENSION RULE (applies to all experts):
Before flagging any issue, ask yourself: 'Is this concept communicated in the story, even if different words are used than I would expect?'
A PM rarely uses exact technical or UX terms. Understand intent, not keywords.
Only flag issues where the concept is genuinely absent.

DE-DUPLICATION RULE: If two experts identify the same issue, only the most relevant expert keeps it.

PRODUCT CONTEXT:
Vision: ${settings.vision || 'Not defined'}
OKRs:
${okrList}
Personas: ${personaList}
Current Backlog: ${productContext.backlogSummary}
Active Radar Signals: ${productContext.radarSignals}
Active Radar Risks: ${productContext.radarRisks}

Definition of Ready:
${dorCriteria}
${previousQASection}
STORY TO REVIEW:
${storyText}

EXPERT 1 — SENIOR PM (strategic alignment & need validation):
ASSUMPTION RULE: Do not assume or infer information not explicitly stated in the story or product context. If unclear, ask.
- Challenge the need: who specifically asked for this and in what context?
- What happens concretely if we don't build this?
- Is there evidence of this need in the Radar signals? If yes, cite it explicitly. If a connection exists, propose it — don't say 'no radar signals'.
- Does this duplicate something already in the backlog?
- Does this advance a specific OKR? Which one and how?
- If alignment is weak, say so directly. Do not soften.
- Maximum 3 blocking questions — only if verdict is BLOCK or CHALLENGE.
- If verdict is PROCEED, blocking_questions must be an empty array [].

EXPERT 2 — SENIOR UX (user flow completeness):
SCOPE RULE: Only expose flow gaps that make the story untestable or confusing. Never suggest new features.
- Map: trigger (explicit action or implicit/automatic?), journey, outcome (visible result)
- Expose gaps for: in-progress state, success feedback, failure state, empty state, new data awareness
- Only flag a dimension as a gap if it is genuinely absent from the story.
- Maximum 3 flow gaps — only if verdict is FLOW_INCOMPLETE.
- If verdict is FLOW_COMPLETE, flow_gaps must be an empty array [].

EXPERT 3 — CTO (architectural risks):
SCOPE RULE: Only flag architecture-level risks — not implementation details (retry intervals, schema, specific error codes, API rate limiting).
- Assess: extensibility (one tool vs generic?), coupling (tight dependency on third-party?), config scope (per user/workspace/org?), failure handling, technical debt
- If a dimension is clearly addressed in the story, do not flag it.
- Maximum 3 architectural concerns — only if verdict is ARCH_RISK.
- If verdict is ARCH_SOUND, arch_concerns must be an empty array [].

EXPERT 4 — DoR CHECKER:
- Check each criterion in the Definition of Ready listed above against the story.
- Mark met: true if satisfied, false if not.

Return ONLY valid JSON with no surrounding text:
{
  "senior_pm": {
    "verdict": "BLOCK",
    "analysis": "2-3 sentence strategic analysis grounded in the context above",
    "blocking_questions": [{ "number": 1, "text": "Question text?" }]
  },
  "ux": {
    "verdict": "FLOW_INCOMPLETE",
    "analysis": "Flow analysis text",
    "flow_gaps": [{ "number": 1, "text": "Gap description" }]
  },
  "cto": {
    "verdict": "ARCH_SOUND",
    "analysis": "Architecture analysis text",
    "arch_concerns": []
  },
  "dor": {
    "criteria": [{ "text": "Criterion text", "met": true }]
  }
}`;
}

// --- UNIFIED COMMITTEE REVIEW (1 API call → 4 cards) ---
async function runCommitteeReview(storyText, settings, productContext, previousQA = null) {
    const prompt = buildCommitteePrompt(storyText, settings, productContext, previousQA);

    const response = await Auth.fetch('/api/generate', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
            system:    'You are a product review committee. Always respond in English only. Return only valid JSON, no surrounding text.',
            messages:  [{ role: 'user', content: prompt }],
            callType:  'story_grooming_committee',
            maxTokens: 4096,
        }),
    });

    const data = await response.json();
    const text = data.content?.[0]?.text || '';

    let committee;
    try {
        const match = text.match(/\{[\s\S]*\}/);
        committee   = match ? JSON.parse(match[0]) : null;
    } catch (e) {
        console.error('Committee JSON parse error:', e, '\nRaw:', text.slice(0, 300));
        return;
    }
    if (!committee) return;

    const container = document.getElementById('committeeContainer');

    _renderSeniorPMCard(committee.senior_pm || {}, container);
    _renderDorCard(committee.dor           || {}, container);
    _renderUXCard(committee.ux             || {}, container);
    _renderCTOCard(committee.cto           || {}, container);

    // Expose to consolidated feedback form
    window._seniorPMQuestions = committee.senior_pm?.blocking_questions || [];
    window._uxGaps            = committee.ux?.flow_gaps                 || [];
    window._ctoConcerns       = committee.cto?.arch_concerns            || [];

    await renderConsolidatedFeedback();
}

function _renderSeniorPMCard(data, container) {
    const isBlock      = data.verdict === 'BLOCK';
    const isChallenge  = data.verdict === 'CHALLENGE';
    const borderColor  = isBlock ? '#ef4444' : isChallenge ? '#f97316' : '#10b981';
    const verdictBadge = isBlock ? '🚫 BLOCKED' : isChallenge ? '⚠️ CHALLENGED' : '✅ PROCEED';
    const badgeColor   = isBlock ? '#ef4444' : isChallenge ? '#f97316' : '#10b981';
    const card = document.createElement('div');
    card.style = `background:white; border:1px solid #e2e8f0; border-left:4px solid ${borderColor}; padding:20px; border-radius:10px; margin-bottom:20px; box-shadow:0 2px 4px rgba(0,0,0,0.05);`;
    card.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
            <strong>🎯 SENIOR PM REVIEW</strong>
            <span style="color:${badgeColor}; font-size:0.8em; font-weight:bold; background:${badgeColor}15; padding:4px 10px; border-radius:20px;">${verdictBadge}</span>
        </div>
        <div style="color:#1e293b; font-size:0.9em; line-height:1.6; white-space:pre-wrap;">${data.analysis || ''}</div>`;
    container.appendChild(card);
}

function _renderDorCard(data, container) {
    const criteria    = data.criteria || [];
    const hasFailures = criteria.some(c => !c.met);
    const lines       = criteria.map(c => `${c.met ? '✅' : '❌'} ${c.text}`).join('<br>');
    const card = document.createElement('div');
    card.style = `background:${hasFailures ? '#1e293b' : '#064e3b'}; color:#f1f5f9; padding:15px; border-radius:10px; margin-bottom:20px; border-left:5px solid ${hasFailures ? '#ef4444' : '#10b981'};`;
    card.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
            <strong style="color:#cbd5e1;">🛡️ DoR COMPLIANCE</strong>
            ${hasFailures
                ? `<button onclick="autoFixStory()" style="background:#ef4444; color:white; border:none; padding:8px 16px; border-radius:6px; cursor:pointer; font-weight:bold;">🔧 AUTO-FIX STORY</button>`
                : `<span style="color:#86efac; font-weight:bold;">✅ COMPLIANT</span>`}
        </div>
        <div style="font-family:monospace; font-size:0.85em;">${lines}</div>`;
    container.appendChild(card);
}

function _renderUXCard(data, container) {
    const isComplete   = data.verdict === 'FLOW_COMPLETE';
    const borderColor  = isComplete ? '#10b981' : '#f97316';
    const verdictBadge = isComplete ? '✅ FLOW COMPLETE' : '⚠️ FLOW INCOMPLETE';
    const badgeColor   = isComplete ? '#10b981' : '#f97316';
    const card = document.createElement('div');
    card.style = `background:white; border:1px solid #e2e8f0; border-left:4px solid ${borderColor}; padding:20px; border-radius:10px; margin-bottom:20px; box-shadow:0 2px 4px rgba(0,0,0,0.05);`;
    card.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
            <strong>👨‍🏫 SENIOR UX REVIEW</strong>
            <span style="color:${badgeColor}; font-size:0.8em; font-weight:bold; background:${badgeColor}15; padding:4px 10px; border-radius:20px;">${verdictBadge}</span>
        </div>
        <div style="color:#1e293b; font-size:0.9em; line-height:1.6; white-space:pre-wrap;">${data.analysis || ''}</div>`;
    container.appendChild(card);
}

function _renderCTOCard(data, container) {
    const isSound      = data.verdict === 'ARCH_SOUND';
    const borderColor  = isSound ? '#10b981' : '#ef4444';
    const verdictBadge = isSound ? '✅ ARCH SOUND' : '⚠️ ARCH RISK';
    const badgeColor   = isSound ? '#10b981' : '#ef4444';
    const card = document.createElement('div');
    card.style = `background:white; border:1px solid #e2e8f0; border-left:4px solid ${borderColor}; padding:20px; border-radius:10px; margin-bottom:20px; box-shadow:0 2px 4px rgba(0,0,0,0.05);`;
    card.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
            <strong>⚙️ CTO REVIEW</strong>
            <span style="color:${badgeColor}; font-size:0.8em; font-weight:bold; background:${badgeColor}15; padding:4px 10px; border-radius:20px;">${verdictBadge}</span>
        </div>
        <div style="color:#1e293b; font-size:0.9em; line-height:1.6; white-space:pre-wrap;">${data.analysis || ''}</div>`;
    container.appendChild(card);
}

// --- LEGACY: kept for reference, no longer called ---
async function runSeniorPMReview(storyText, settings, productContext, previousQA = null) {
    const container = document.getElementById('committeeContainer');

    const prompt = `CRITICAL RULE — LANGUAGE: You MUST respond in English. This is non-negotiable. Do not respond in French or any other language regardless of the language used in the context, answers, vision, OKRs, or any other input. If any input is in French, translate it mentally and respond in English only.

FORMAT RULE — MANDATORY:
Your response must follow this exact structure, in this exact order:

1. BLOCKING_QUESTIONS block (if verdict is BLOCK or CHALLENGE)
2. Strategic analysis (2-3 sentences maximum)
3. Verdict line

Nothing else. No introduction. No repetition of questions in the analysis text. No conclusion after the verdict.

BLOCKING_QUESTIONS must always come FIRST — before any analysis text.
If you write the questions anywhere else in your response, you have violated this rule.

Example of correct structure:
BLOCKING_QUESTIONS:
[Q1] ...
[Q2] ...
END_BLOCKING_QUESTIONS

[2-3 sentences of strategic analysis]

⚠️ CHALLENGE [one sentence verdict]

COMPREHENSION RULE — MANDATORY:
Before asking a question or flagging a concern, read the entire story and ask yourself:
'Is this concept communicated in the story, even if different words are used than what I would expect?'

A PM will rarely use exact technical or UX terms.
Your job is to understand intent, not match keywords.
If the concept is present — even expressed differently — do not flag it or ask about it.
Only raise issues where the concept is genuinely absent.

ASSUMPTION RULE:
You cannot assume or infer information that is not explicitly stated in the story or in the product context provided above.

If the story does not mention who requested this capability, do not assume a persona would benefit — ask who specifically requested it and in what context.

If the story does not mention the business consequences of not building this, do not assume it aligns with an OKR — ask what happens concretely if this is not built.

If you find yourself writing phrases like:
- 'this likely addresses...'
- 'this could be seen as...'
- 'this would probably...'
- 'senior PMs would benefit from...'
...you are making assumptions. Stop and ask a blocking question instead.

A well-written story should speak for itself.
If you are filling in gaps with your own assumptions to reach a PROCEED verdict, that is a signal you should issue a CHALLENGE verdict with blocking questions instead.

You are a Senior Product Manager with 10+ years in B2B SaaS. You are direct, demanding, and never let a vague story pass through without challenge.


STORY FOCUS RULE: You are reviewing ONLY the story provided in the STORY TO REVIEW section below. The backlog is provided as context only — do not review or reference backlog items as if they were the subject of your review.

PRODUCT CONTEXT — use this actively in your review:
Vision: ${settings.vision || 'Not defined'}
OKRs:
${(settings.objectives || []).map((o, i) => `${i + 1}. ${o}`).join('\n') || 'None defined'}
Personas: ${(settings.personas || []).map(p => p.name).join(', ') || 'Not defined'}

Current Backlog:
${productContext.backlogSummary}

Active Radar Signals:
${productContext.radarSignals}

Active Radar Risks:
${productContext.radarRisks}

${previousQA && previousQA.length > 0 ? `PREVIOUS REVIEW CONTEXT:
The PM has already answered blocking questions from a previous review.
These answers informed the story update you are now reviewing.
Do not ask the same questions again.
Acknowledge the answers and focus your review on whether the updated story now addresses the original concerns.

${previousQA.map(qa => `Q: ${qa.question}\nA: ${qa.answer}`).join('\n\n')}

` : ''}STORY TO REVIEW:
${storyText}

PREPARATION — Before starting your review, do this first:
1. Read the Active Radar Signals and Radar Risks completely
2. Read the Current Backlog completely
3. Identify any connections between the story and what you just read
4. Keep these connections in mind throughout your entire review

Only after completing this preparation, start your review.
This means you should never say 'no radar signals support this story' if you have already identified a connection in your preparation.

YOUR REVIEW PROCESS — follow this order strictly:

## STEP 1 — CHALLENGE THE NEED
RULE FOR STEP 1: Before asking any question, check if the answer already exists in the Radar signals, backlog, or product context provided above. If the answer is already there, do not ask the question — instead acknowledge the evidence explicitly and move on. Only ask questions that are genuinely unanswered by the available context.

Ask 1-3 sharp questions that challenge the need itself.
These are blockers, not polite clarifications.
- Who specifically asked for this and in what context?
- What happens concretely if we don't build this?
- Is this a real user need or a solution looking for a problem?
- Is there evidence of this need in the Radar signals provided?
- Does this duplicate something already in the backlog?
Only ask questions that are genuinely blocking.
If the story already answers a question clearly, skip it.

FORMATTING RULE FOR BLOCKING QUESTIONS:
If you have blocking questions, format them exactly like this so they can be parsed programmatically:

BLOCKING_QUESTIONS:
[Q1] Your first question here?
[Q2] Your second question here?
[Q3] Your third question here (if needed)?
END_BLOCKING_QUESTIONS

Never put blocking questions outside of this block.
Maximum 3 blocking questions — pick the most critical ones only.

## STEP 2 — STRATEGIC ALIGNMENT
- Does this story advance a specific OKR? Which one and how?
- Is it aligned with the product vision?
- If Radar signals are available in the context, actively look for connections between those signals and this story — even if the story doesn't mention them. If a connection exists, cite the signal by name and explain how this story addresses it. Do not just say 'no radar signals cited' — make the connection yourself if it exists.
- If alignment is weak, say so directly — do not soften it.

IMPORTANT — You are a sparring partner, not just a judge.
If you see a potential connection between a Radar signal and this story that the author missed, point it out and suggest how to make it explicit.
Example: 'I notice [signal X] in your Radar — this story could address it if you reframe the So that clause to mention [specific outcome]. Is that the intent?'
Never leave a Radar signal unaddressed if it relates to the story domain.
Always propose the connection, even if the story doesn't mention it.

## STEP 3 — VERDICT
If verdict is BLOCK or CHALLENGE, you MUST include the BLOCKING_QUESTIONS block. If verdict is PROCEED, do not include it.

End with exactly one of these three verdicts:

🚫 BLOCK
Need is unclear or unsupported by evidence.
Do not estimate. State exactly what information is missing.

⚠️ CHALLENGE
Need is understandable but strategic alignment is weak.
State what would change your verdict.

✅ PROCEED
Clear need + strong alignment.
Note any AC gaps the Dev team should address before estimation.

RULES:
- Be direct. No corporate softening.
- Ground every observation in the context provided.
- If the story duplicates a backlog item, call it out immediately.
- Never suggest new features — your job is to validate, not expand.
- Maximum 250 words total.`;

    const response = await Auth.fetch('/api/generate', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
            system:   'You are a Senior PM doing a story review. You always respond in English only, regardless of the language of any input provided.',
            messages: [{ role: 'user', content: prompt }]
        })
    });

    const data       = await response.json();
    const reviewText = data.content?.[0]?.text || '';

    const isBlock     = reviewText.includes('🚫 BLOCK');
    const isChallenge = reviewText.includes('⚠️ CHALLENGE');

    const borderColor  = isBlock ? '#ef4444' : isChallenge ? '#f97316' : '#10b981';
    const verdictBadge = isBlock ? '🚫 BLOCKED' : isChallenge ? '⚠️ CHALLENGED' : '✅ PROCEED';
    const badgeColor   = isBlock ? '#ef4444' : isChallenge ? '#f97316' : '#10b981';

    const cleanReview = reviewText
        .replace(/BLOCKING_QUESTIONS:[\s\S]*?END_BLOCKING_QUESTIONS/g, '')
        .replace(/🚫\s*BLOCK|⚠️\s*CHALLENGE|✅\s*PROCEED/g, '')
        .trim();

    const card = document.createElement('div');
    card.style = `background:white; border:1px solid #e2e8f0; border-left:4px solid ${borderColor}; padding:20px; border-radius:10px; margin-bottom:20px; box-shadow:0 2px 4px rgba(0,0,0,0.05);`;
    card.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
            <strong>🎯 SENIOR PM REVIEW</strong>
            <span style="color:${badgeColor}; font-size:0.8em; font-weight:bold; background:${badgeColor}15; padding:4px 10px; border-radius:20px;">
                ${verdictBadge}
            </span>
        </div>
        <div style="color:#1e293b; font-size:0.9em; line-height:1.6; white-space:pre-wrap;">${cleanReview}</div>`;
    container.appendChild(card);

    const questions = parseSeniorPMQuestions(reviewText);
    window._seniorPMQuestions = questions;
}

// --- PARSE SENIOR PM BLOCKING QUESTIONS ---
function parseSeniorPMQuestions(reviewText) {
    const match = reviewText.match(/BLOCKING_QUESTIONS:([\s\S]*?)END_BLOCKING_QUESTIONS/);
    if (!match) return [];

    const block = match[1];
    const questions = [];
    const regex = /\[Q(\d+)\]\s*(.+?)(?=\[Q\d+\]|$)/gs;
    let m;
    while ((m = regex.exec(block)) !== null) {
        questions.push({
            number: parseInt(m[1]),
            text:   m[2].trim()
        });
    }
    return questions;
}

// --- CONSOLIDATED FEEDBACK SECTION ---
async function renderConsolidatedFeedback() {
    const pmQuestions = window._seniorPMQuestions || [];
    const uxGaps      = window._uxGaps || [];
    const ctoConcerns = window._ctoConcerns || [];

    if (pmQuestions.length === 0 && uxGaps.length === 0 && ctoConcerns.length === 0) return;

    const container = document.getElementById('committeeContainer');
    const section   = document.createElement('div');
    section.id      = 'consolidatedFeedback';
    section.style   = `background:#f8fafc; border:2px solid #6366f1; border-radius:12px; padding:20px; margin-top:10px;`;

    let html = `
        <div style="font-size:0.85em; font-weight:bold; color:#6366f1; text-transform:uppercase; letter-spacing:0.05em; margin-bottom:20px;">
            ✏️ Address all feedback to update the story
        </div>`;

    if (pmQuestions.length > 0) {
        html += `
        <div style="margin-bottom:20px;">
            <div style="font-size:0.8em; font-weight:bold; color:#1e293b; margin-bottom:12px; display:flex; align-items:center; gap:8px;">
                <span style="background:#6366f1; color:white; padding:2px 8px; border-radius:20px; font-size:0.75em;">🎯 Senior PM</span>
                Blocking questions
            </div>
            ${pmQuestions.map(q => `
            <div style="margin-bottom:12px;">
                <label style="display:block; font-size:0.85em; font-weight:bold; color:#1e293b; margin-bottom:6px;">
                    Q${q.number}. ${q.text}
                </label>
                <textarea id="pm_answer_${q.number}" rows="2"
                          style="width:100%; padding:10px; border:1px solid #e2e8f0; border-radius:8px; font-size:0.85em; resize:vertical; font-family:inherit;"
                          placeholder="Your answer..."></textarea>
            </div>`).join('')}
        </div>`;
    }

    if (pmQuestions.length > 0 && uxGaps.length > 0) {
        html += `<hr style="border:none; border-top:1px solid #e2e8f0; margin:20px 0;">`;
    }

    if (uxGaps.length > 0) {
        html += `
        <div style="margin-bottom:20px;">
            <div style="font-size:0.8em; font-weight:bold; color:#1e293b; margin-bottom:12px; display:flex; align-items:center; gap:8px;">
                <span style="background:#f97316; color:white; padding:2px 8px; border-radius:20px; font-size:0.75em;">👨‍🏫 UX</span>
                Flow gaps to address
            </div>
            ${uxGaps.map(g => `
            <div style="margin-bottom:12px;">
                <label style="display:block; font-size:0.85em; font-weight:bold; color:#1e293b; margin-bottom:6px;">
                    G${g.number}. ${g.text}
                </label>
                <textarea id="ux_answer_${g.number}" rows="2"
                          style="width:100%; padding:10px; border:1px solid #e2e8f0; border-radius:8px; font-size:0.85em; resize:vertical; font-family:inherit;"
                          placeholder="Describe the expected UX behavior..."></textarea>
            </div>`).join('')}
        </div>`;
    }

    if (ctoConcerns.length > 0) {
        if (pmQuestions.length > 0 || uxGaps.length > 0) {
            html += `<hr style="border:none; border-top:1px solid #e2e8f0; margin:20px 0;">`;
        }
        html += `
        <div style="margin-bottom:20px;">
            <div style="font-size:0.8em; font-weight:bold; color:#1e293b; margin-bottom:12px; display:flex; align-items:center; gap:8px;">
                <span style="background:#ef4444; color:white; padding:2px 8px; border-radius:20px; font-size:0.75em;">⚙️ CTO</span>
                Architectural concerns to address
            </div>
            ${ctoConcerns.map(c => `
            <div style="margin-bottom:12px;">
                <label style="display:block; font-size:0.85em; font-weight:bold; color:#1e293b; margin-bottom:6px;">
                    A${c.number}. ${c.text}
                </label>
                <textarea id="cto_answer_${c.number}" rows="2"
                          style="width:100%; padding:10px; border:1px solid #e2e8f0; border-radius:8px; font-size:0.85em; resize:vertical; font-family:inherit;"
                          placeholder="Describe the architectural decision..."></textarea>
            </div>`).join('')}
        </div>`;
    }

    html += `
        <button onclick="updateStoryWithAllFeedback()"
                style="width:100%; padding:14px; background:#6366f1; color:white; border:none; border-radius:10px; font-weight:bold; cursor:pointer; font-size:0.95em; margin-top:5px;">
            🔄 Update Story & Re-analyze
        </button>`;

    section.innerHTML = html;
    container.appendChild(section);
}

// --- UNIFIED STORY UPDATE FROM ALL FEEDBACK ---
async function updateStoryWithAllFeedback() {
    const pmAnswers = Array.from(document.querySelectorAll('[id^="pm_answer_"]'))
        .map(el => ({
            question: el.previousElementSibling?.innerText?.replace(/^Q\d+\.\s*/, '') || '',
            answer:   el.value.trim()
        }))
        .filter(qa => qa.answer.length > 0);

    const uxAnswers = Array.from(document.querySelectorAll('[id^="ux_answer_"]'))
        .map(el => ({
            gap:    el.previousElementSibling?.innerText?.replace(/^G\d+\.\s*/, '') || '',
            answer: el.value.trim()
        }))
        .filter(qa => qa.answer.length > 0);

    const ctoAnswers = Array.from(document.querySelectorAll('[id^="cto_answer_"]'))
        .map(el => ({
            concern: el.previousElementSibling?.innerText?.replace(/^A\d+\.\s*/, '') || '',
            answer:  el.value.trim()
        }))
        .filter(qa => qa.answer.length > 0);

    if (pmAnswers.length === 0 && uxAnswers.length === 0 && ctoAnswers.length === 0) {
        alert('Please answer at least one question before updating.');
        return;
    }

    const currentStory = [
        document.getElementById('storyTitle').value,
        _editorUserStory ? _editorUserStory.getText() : document.getElementById('storyUserStory').value,
    ].join('\n\n');

    const settings = await Auth.fetch('/api/settings').then(r => r.json());
    setVisible('loadingOverlay', true);

    try {
        const response = await Auth.fetch('/api/generate', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({
                system: `You are an expert PM writer. Update the user story incorporating all feedback provided.

USER STORY TEMPLATE — your USER STORY output must follow this structure exactly:
${settings.userStoryTemplate}

The current user story is provided as HTML. If it contains HTML panel elements (div[data-panel]), you MUST preserve ALL HTML structure, data-panel attributes, and formatting exactly as-is. Only enrich the text content within the panels — do not remove or restructure any HTML element.

- PM answers → enrich the "So that" clause and business context within the existing structure
- UX answers → add as specific testable Acceptance Criteria at the end of USER STORY
- CTO answers → add as technical constraints or non-functional AC items at the end of USER STORY
Do not invent information not present in the answers.
Acceptance Criteria must be included at the end of the USER STORY section — do NOT add a separate "ACCEPTANCE CRITERIA:" header.
Respond using this exact format:
TITLE: ...
USER STORY:
[enriched content including Acceptance Criteria at the end]
RICE:
Reach: ...
Impact: ...
Confidence: ...
Effort: ...`,
                messages: [{
                    role:    'user',
                    content: `Current story (includes manual edits — preserve all existing content):
${currentStory}

${pmAnswers.length > 0 ? `Business context from PM:
${pmAnswers.map(qa => `Q: ${qa.question}\nA: ${qa.answer}`).join('\n\n')}` : ''}

${uxAnswers.length > 0 ? `UX specifications:
${uxAnswers.map(qa => `Gap: ${qa.gap}\nSpec: ${qa.answer}`).join('\n\n')}` : ''}

${ctoAnswers.length > 0 ? `Architectural decisions from CTO review:
${ctoAnswers.map(qa => `Concern: ${qa.concern}\nDecision: ${qa.answer}`).join('\n\n')}` : ''}

Update the story incorporating all this feedback.
PM answers → make the need and alignment more explicit.
UX answers → add as testable AC items.
CTO answers → add as technical constraints or non-functional AC items.

CRITICAL: Do not rewrite or restructure the story.
Only incorporate the additional context from the answers above.
Preserve all existing wording, formatting, and manual edits exactly.
Add or enrich — do not replace.`
                }]
            })
        });

        const data = await response.json();
        if (data.content?.[0]) {
            console.log('Raw AI response:', data.content[0].text);
            const parsed = parseStoryResponse(data.content[0].text);
            console.log('Parsed story:', parsed);
            populateFields(parsed);

            // Show update banner
            const updateBanner = document.createElement('div');
            updateBanner.style = `background:#ecfdf5; border:1px solid #6ee7b7; padding:10px 15px; border-radius:8px; margin-bottom:15px; font-size:0.85em; color:#065f46; font-weight:bold;`;
            updateBanner.innerHTML = '✅ Story updated with your answers — review the changes below before saving.';
            const storyOutput = document.getElementById('storyOutput');
            if (storyOutput) storyOutput.insertBefore(updateBanner, storyOutput.firstChild);
            setTimeout(() => updateBanner.remove(), 10000);

            document.getElementById('consolidatedFeedback')?.remove();

            const allPreviousQA = [
                ...pmAnswers.map(qa  => ({ question: qa.question, answer: qa.answer })),
                ...uxAnswers.map(qa  => ({ question: qa.gap,      answer: qa.answer })),
                ...ctoAnswers.map(qa => ({ question: qa.concern,  answer: qa.answer }))
            ];

            await runDualAnalysis(parsed.userStory, settings, allPreviousQA);
        }
    } catch (e) {
        console.error('Error updating story:', e);
    }

    setVisible('loadingOverlay', false);
}

// --- SENIOR UX REVIEW ---
async function runUXReview(storyText, settings, productContext) {
    const prompt = `You are a Senior UX Designer with 10+ years in B2B SaaS data products. Your primary concern is system feedback and user awareness.
You think exclusively in terms of user flows — trigger, journey, outcome.
You never suggest new features outside the story scope.
You only expose flow gaps that would make the story untestable or confusing for the user.

CRITICAL RULE — LANGUAGE: Always respond in English only.

FORMAT RULE:
Do not introduce yourself.
Do not explain your rules or constraints.
Do not say 'I am a UX designer' or any variation.
Start your response directly with STEP 1 — MAP THE FLOW.

COMPREHENSION RULE — MANDATORY:
Before asking a question or flagging a concern, read the entire story and ask yourself:
'Is this concept communicated in the story, even if different words are used than what I would expect?'

A PM will rarely use exact technical or UX terms.
Your job is to understand intent, not match keywords.
If the concept is present — even expressed differently — do not flag it or ask about it.
Only raise issues where the concept is genuinely absent.

PRODUCT CONTEXT:
Vision: ${settings.vision || 'Not defined'}
Personas: ${(settings.personas || []).map(p => p.name).join(', ') || 'Not defined'}
Current Backlog: ${productContext.backlogSummary}

STORY TO REVIEW:
${storyText}

YOUR REVIEW PROCESS — follow this order:

## STEP 1 — MAP THE FLOW
Identify:
- TRIGGER: What user action or system event starts this flow? Is it explicit (button click) or implicit (automatic)?
- JOURNEY: What does the user see and do at each step?
- OUTCOME: What is the visible result when it works?

## STEP 2 — EXPOSE FLOW GAPS
For each of these dimensions, identify if the story leaves it unanswered:

IN-PROGRESS STATE:
What does the user see while the action is happening?
Loading spinner? Progress bar? Nothing?
If the story doesn't specify, this is a gap.

SUCCESS FEEDBACK:
How does the user know it worked and what changed?
Toast? Badge? Timestamp "Last synced 2 min ago"?
If the story doesn't specify, this is a gap.

NEW DATA AWARENESS:
How does the user distinguish new data from existing data?
Visual indicator? "12 new entries imported" banner?
If the story doesn't specify, this is a gap.

FAILURE STATE:
What does the user see when it fails?
Silent failure? Error message? Retry option?
If the story doesn't specify, this is a gap.

AMBIENT AWARENESS:
If the user is on another page when the action completes, how do they know something happened?
If the story doesn't specify and the action is async, this is a gap.

EMPTY STATE:
What does the user see if there is no data to show?
If the story involves a list or dashboard, this is a gap if unspecified.

## STEP 3 — VERDICT

Format your gaps exactly like this so they can be parsed:

FLOW_GAPS:
[G1] Gap description — what question the story leaves unanswered
[G2] Gap description
[G3] Gap description (if needed)
END_FLOW_GAPS

Maximum 3 gaps — pick the most critical ones only.
If a dimension is clearly addressed in the story, do not flag it as a gap.

End with one of two verdicts:
FLOW_COMPLETE — The flow is clear enough to design and test
FLOW_INCOMPLETE — Critical flow gaps must be addressed before design

RULES:
- Maximum 200 words total outside the FLOW_GAPS block
- Never suggest features — only expose what is missing
- Ground every gap in the story text — quote it if needed
- If the story clearly addresses a dimension, acknowledge it`;

    const response = await Auth.fetch('/api/generate', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
            system:   'You are a Senior UX Designer reviewing a user story. Always respond in English only.',
            messages: [{ role: 'user', content: prompt }]
        })
    });

    const data       = await response.json();
    const reviewText = data.content?.[0]?.text || '';

    const isComplete   = reviewText.includes('FLOW_COMPLETE');
    const borderColor  = isComplete ? '#10b981' : '#f97316';
    const verdictBadge = isComplete ? '✅ FLOW COMPLETE' : '⚠️ FLOW INCOMPLETE';
    const badgeColor   = isComplete ? '#10b981' : '#f97316';

    const gapsMatch = reviewText.match(/FLOW_GAPS:([\s\S]*?)END_FLOW_GAPS/);
    const gaps = [];
    if (gapsMatch) {
        const regex = /\[G(\d+)\]\s*(.+?)(?=\[G\d+\]|$)/gs;
        let m;
        while ((m = regex.exec(gapsMatch[1])) !== null) {
            gaps.push({ number: parseInt(m[1]), text: m[2].trim() });
        }
    }

    const cleanReview = reviewText
        .replace(/FLOW_GAPS:[\s\S]*?END_FLOW_GAPS/g, '')
        .replace(/FLOW_COMPLETE|FLOW_INCOMPLETE/g, '')
        .trim();

    window._uxGaps = gaps;

    const container = document.getElementById('committeeContainer');
    const card = document.createElement('div');
    card.style = `background:white; border:1px solid #e2e8f0; border-left:4px solid ${borderColor}; padding:20px; border-radius:10px; margin-bottom:20px; box-shadow:0 2px 4px rgba(0,0,0,0.05);`;
    card.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
            <strong>👨‍🏫 SENIOR UX REVIEW</strong>
            <span style="color:${badgeColor}; font-size:0.8em; font-weight:bold; background:${badgeColor}15; padding:4px 10px; border-radius:20px;">
                ${verdictBadge}
            </span>
        </div>
        <div style="color:#1e293b; font-size:0.9em; line-height:1.6; white-space:pre-wrap;">${cleanReview}</div>`;
    container.appendChild(card);
}


// --- CTO REVIEW ---
async function runCTOReview(storyText, settings, productContext) {
    const prompt = `ABSOLUTE RULE — YOU MUST FOLLOW THIS BEFORE ANYTHING ELSE:
Respond in English only. No exceptions.
Do not use French, Spanish, or any other language.
Even if the story, context, or any input is written in French, your entire response must be in English.
If you respond in any language other than English, you have failed this review.

FORMAT RULE:
Do not introduce yourself.
Do not explain your rules or language constraints.
Do not say 'I must respond in English' or any variation.
Start your response directly with STEP 1 — ASSESS ARCHITECTURE.

COMPREHENSION RULE — MANDATORY:
Before asking a question or flagging a concern, read the entire story and ask yourself:
'Is this concept communicated in the story, even if different words are used than what I would expect?'

A PM will rarely use exact technical or UX terms.
Your job is to understand intent, not match keywords.
If the concept is present — even expressed differently — do not flag it or ask about it.
Only raise issues where the concept is genuinely absent.

You are a CTO with 10+ years building B2B SaaS platforms.
You think exclusively in terms of architecture, extensibility, and technical debt. You never approve a story that creates tight coupling where abstraction would cost the same effort.
You never suggest features — you expose architectural risks.

SCOPE RULE: You are reviewing a user story, not a technical specification.
A story does not need to define implementation details such as:
- Exact retry intervals, backoff strategies, or timeout values
- Database schema, table structure, or config storage location
- API rate limiting implementation details
- Specific error codes or HTTP status handling
These are implementation decisions made by the dev team, not the PM.
Only flag risks that would require a fundamentally different architecture or approach — not missing implementation details.
If a concern is implementation-level rather than architecture-level, do not flag it.

COMPREHENSION RULE — MANDATORY:
Before flagging any concern, read the entire story including TECHNICAL CONSTRAINTS and ask yourself:

'Does this story communicate that this concern has been considered and addressed, even if different words are used?'

Examples of equivalent meaning:
- 'abstraction layer' = 'generic interface' = 'connector pattern' = 'each tool has its own file' = extensibility addressed
- 'per user config' = 'each user manages their own' = 'user-level settings' = config scope addressed
- 'error message with retry' = 'graceful failure' = 'user sees an error and can retry' = failure handling addressed

If the concept is communicated — even with different words — do NOT flag it as a concern.
Only flag concerns where the concept is genuinely absent from the story, not just expressed differently.

A story written by a PM will rarely use exact technical terms.
Your job is to understand intent, not match keywords.

PRODUCT CONTEXT:
Vision: ${settings.vision || 'Not defined'}
Current Backlog: ${productContext.backlogSummary}
Active Radar Signals: ${productContext.radarSignals}

STORY TO REVIEW:
${storyText}

YOUR REVIEW PROCESS — follow this order:

## STEP 1 — ASSESS ARCHITECTURE

Evaluate these dimensions:

EXTENSIBILITY:
Is this built for one specific tool or designed as a configurable integration layer?
If the story mentions a specific tool (Jira, Linear, etc.), ask: "If we need to support another tool in 6 months, what needs to change?"
If the answer is "everything", this is an architectural risk.

COUPLING:
Does this create tight dependencies between the core product and a third-party tool?
Is the data transformation logic coupled to the tool's specific format?
Tight coupling where abstraction costs the same effort is not acceptable.

CONFIGURATION:
What is configurable vs hardcoded?
Where does the integration config live — per user, per workspace, per org?
If config scope is unclear, flag it.

FAILURE HANDLING:
How does the system behave when the third-party API is unavailable?
Is there a retry strategy? A graceful degradation?
If the story does not address failure handling, flag it.

TECHNICAL DEBT:
What shortcuts in this story will cost double to fix later?
Is there existing code that should be extended rather than duplicated?

## STEP 2 — VERDICT

Format your architectural concerns exactly like this:

ARCH_CONCERNS:
[A1] Concern description — specific architectural risk
[A2] Concern description
[A3] Concern description (if needed)
END_ARCH_CONCERNS

Maximum 3 concerns — pick the most critical ones only.
If a dimension is clearly addressed in the story, do not flag it.

End with one of two verdicts:
ARCH_SOUND — Architecture is acceptable, proceed to estimation
ARCH_RISK — Architectural concerns must be addressed before estimation

RULES:
- Maximum 200 words outside the ARCH_CONCERNS block
- Never suggest features — only expose architectural risks
- Be specific — cite the story text when flagging a concern
- If the story is intentionally simple and the architectural risk is low, say so and give ARCH_SOUND
- Do not penalize simplicity — only flag risks that will cause real pain later`;

    const response = await Auth.fetch('/api/generate', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
            system:   'You are a CTO reviewing a user story for architectural risks. IMPORTANT: You must always respond in English only, regardless of any other language in the input. Never respond in French or any other language.',
            messages: [{ role: 'user', content: prompt }]
        })
    });

    const data       = await response.json();
    const reviewText = data.content?.[0]?.text || '';

    const isSound      = reviewText.includes('ARCH_SOUND');
    const borderColor  = isSound ? '#10b981' : '#ef4444';
    const verdictBadge = isSound ? '✅ ARCH SOUND' : '⚠️ ARCH RISK';
    const badgeColor   = isSound ? '#10b981' : '#ef4444';

    const concernsMatch = reviewText.match(/ARCH_CONCERNS:([\s\S]*?)END_ARCH_CONCERNS/);
    const concerns = [];
    if (concernsMatch) {
        const regex = /\[A(\d+)\]\s*(.+?)(?=\[A\d+\]|$)/gs;
        let m;
        while ((m = regex.exec(concernsMatch[1])) !== null) {
            concerns.push({ number: parseInt(m[1]), text: m[2].trim() });
        }
    }

    window._ctoConcerns = isSound ? [] : concerns;

    const cleanReview = reviewText
        .replace(/ARCH_CONCERNS:[\s\S]*?END_ARCH_CONCERNS/g, '')
        .replace(/ARCH_SOUND|ARCH_RISK/g, '')
        .trim();

    const container = document.getElementById('committeeContainer');
    const card = document.createElement('div');
    card.style = `background:white; border:1px solid #e2e8f0; border-left:4px solid ${borderColor}; padding:20px; border-radius:10px; margin-bottom:20px; box-shadow:0 2px 4px rgba(0,0,0,0.05);`;
    card.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
            <strong>⚙️ CTO REVIEW</strong>
            <span style="color:${badgeColor}; font-size:0.8em; font-weight:bold; background:${badgeColor}15; padding:4px 10px; border-radius:20px;">
                ${verdictBadge}
            </span>
        </div>
        <div style="color:#1e293b; font-size:0.9em; line-height:1.6; white-space:pre-wrap;">${cleanReview}</div>`;
    container.appendChild(card);
}

// --- UNIFIED ANALYSIS: 1 committee call → 4 cards ---
async function runDualAnalysis(storyText, settings, previousQA = null) {
    const container = document.getElementById('committeeContainer');
    container.innerHTML = '<div style="text-align:center; padding:20px; color:#64748b;">🔍 Loading context and starting review...</div>';

    try {
        const productContext = await loadProductContext();
        container.innerHTML  = '';
        await runCommitteeReview(storyText, settings, productContext, previousQA);
    } catch (e) { console.error(e); }
}

// --- ADD SUGGESTION TO SPECIFIC FIELD ---
function addSuggestionToStory(suggestion, expertName) {
    if (_editorUserStory) {
        const current = _editorUserStory.getText();
        _editorUserStory.setContent(current + (current ? '\n\n' : '') + `[${expertName}] ${suggestion}`);
    } else {
        const el = document.getElementById('storyUserStory');
        if (el) el.value = el.value + (el.value ? '\n\n' : '') + `[${expertName}] ${suggestion}`;
    }
}

// --- APPLY EXPERT SUGGESTION (from renderCommitteeCards) ---
function applyExpertSuggestion(suggestion) {
    if (_editorUserStory) {
        const current = _editorUserStory.getText();
        _editorUserStory.setContent(current + (current ? '\n\n' : '') + suggestion);
    } else {
        const el = document.getElementById('storyUserStory');
        if (el) el.value = el.value + (el.value ? '\n\n' : '') + suggestion;
    }
}

// --- AUTO-FIX FOR DoR ---
async function autoFixStory() {
    const data = getCurrentStoryData();
    setVisible('loadingOverlay', true);
    try {
        const settings = await Auth.fetch('/api/settings').then(r => r.json());
        const response = await Auth.fetch('/api/generate', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({
                system:   `Fix this story to comply with the Definition of Ready: ${settings.definitionOfReady}. Include Acceptance Criteria at the end of the USER STORY section — do NOT add a separate "ACCEPTANCE CRITERIA:" header. Format your response with these exact section headers:\nTITLE: [title]\nUSER STORY:\n[story with Acceptance Criteria at the end]\nRICE:\nReach: [number]\nImpact: [0.25-3]\nConfidence: [0-100]\nEffort: [fibonacci number]`,
                messages: [{ role: 'user', content: data.content }],
            }),
        });
        const result = await response.json();
        if (result.content && result.content[0]) {
            populateFields(parseStoryResponse(result.content[0].text));
            await runDualAnalysis(getCurrentStoryData().content, settings);
        }
    } catch (e) { console.error(e); }
    setVisible('loadingOverlay', false);
}

function resetChat() {
    window._seniorPMQuestions = [];
    window._uxGaps            = [];
    window._ctoConcerns       = [];

    if (_editorUserStory) _editorUserStory.clear();

    document.getElementById('storyTitle').value       = '';
    document.getElementById('riceReach').value        = '';
    document.getElementById('riceImpact').value       = '';
    document.getElementById('riceConfidence').value   = '';
    document.getElementById('riceEffort').value       = '';
    document.getElementById('riceScoreDisplay').textContent = '—';
    document.getElementById('user-input').value       = '';
    document.getElementById('committeeContainer').innerHTML = '<div class="empty-state"><div style="font-size:40px;margin-bottom:20px;opacity:0.5;">📋</div>The analysis will run after generation:<br><br>• Definition of Ready Audit<br>• UX &amp; Business Suggestions<br>• CTO &amp; Dev Technical Review</div>';

    const fb = document.getElementById('consolidatedFeedback');
    if (fb) fb.remove();

    setVisible('storyOutput', false);
    setVisible('loadingOverlay', false);
}

// --- JIRA (unchanged) ---
let _savedFileName = null;

let _lastJiraPushAt = 0;
const JIRA_PUSH_COOLDOWN_MS = 30_000;

async function pushToJira() {
    const btn       = document.getElementById('jiraBtn');
    const resultDiv = document.getElementById('jiraResult');

    if (!_savedFileName) {
        resultDiv.style.display = 'block';
        resultDiv.innerHTML = '<span style="color:#ef4444;">⚠️ Save the story to the backlog first.</span>';
        return;
    }

    const elapsed = Date.now() - _lastJiraPushAt;
    if (elapsed < JIRA_PUSH_COOLDOWN_MS) {
        const wait = Math.ceil((JIRA_PUSH_COOLDOWN_MS - elapsed) / 1000);
        resultDiv.style.display = 'block';
        resultDiv.innerHTML = `<span style="color:#b45309;">⏱ Please wait ${wait}s before pushing another story to Jira.</span>`;
        return;
    }

    btn.disabled  = true;
    btn.innerText = '⏳ Pushing...';
    resultDiv.style.display = 'none';

    try {
        const res  = await Auth.fetch('/api/integration/push-story', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ fileName: _savedFileName }),
        });
        const data = await res.json();

        resultDiv.style.display = 'block';
        if (res.ok && data.ticketUrl) {
            _lastJiraPushAt = Date.now();
            resultDiv.innerHTML = `✅ Created <a href="${data.ticketUrl}" target="_blank" rel="noopener"
                style="color:#4f46e5; font-weight:bold; text-decoration:underline;">${data.ticketKey}</a>`;
            btn.innerText = `✅ Pushed (${data.ticketKey})`;
            btn.style.background = '#059669';
        } else {
            resultDiv.innerHTML = `<span style="color:#ef4444;">❌ ${data.error || 'Push failed — is Jira configured in Settings?'}</span>`;
            btn.disabled  = false;
            btn.innerText = '🔗 Push to Jira →';
        }
    } catch (e) {
        resultDiv.style.display = 'block';
        resultDiv.innerHTML = '<span style="color:#ef4444;">❌ Connection error</span>';
        btn.disabled  = false;
        btn.innerText = '🔗 Push to Jira →';
    }
}

// --- HTML → PLAIN TEXT (preserves panel content via DOMParser) ---
function htmlToStructuredText(html) {
    if (!html) return '';
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const BLOCK = new Set(['P','DIV','H1','H2','H3','H4','H5','H6','LI','BLOCKQUOTE','TR']);

    function walk(node) {
        if (node.nodeType === Node.TEXT_NODE) return node.textContent;
        if (node.nodeName === 'BR') return '\n';
        if (node.nodeName === 'HR') return '\n---\n';
        const children = Array.from(node.childNodes).map(walk).join('');
        return BLOCK.has(node.nodeName) ? children + '\n' : children;
    }

    return walk(doc.body).replace(/\n{3,}/g, '\n\n').trim();
}

// --- SAVE TO BACKLOG (reads from fields, no AI call) ---
async function saveToBacklog() {
    const data = getCurrentStoryData(); // plain text, used for rice/title/guard
    const btn  = document.getElementById('saveBtn');

    if (!data.title && !data.content.trim()) return;

    // HTML version (for backlog display — preserves panels and formatting)
    const richContent = _editorUserStory ? _editorUserStory.getHTML() : data.content;

    // Plain text version (for Jira export) — use DOMParser so Panel nodes are included
    const plainContent = htmlToStructuredText(richContent);

    btn.disabled  = true;
    btn.innerText = '⏳ Saving...';

    try {
        const response = await Auth.fetch('/api/backlog', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({
                content:      richContent,
                contentText:  plainContent,
                title:        data.title,
                rice:         data.rice,
                status:       'To Do',
                source:       'grooming',
                issueType:    'Story',
                labels:       [],
            }),
        });

        const result = await response.json();
        if (result.success) {
            _savedFileName = result.fileName;

            const jiraBtn = document.getElementById('jiraBtn');
            if (jiraBtn) {
                jiraBtn.style.display    = 'inline-block';
                jiraBtn.disabled         = false;
                jiraBtn.innerText        = '🔗 Push to Jira →';
                jiraBtn.style.background = '#7c3aed';
            }
            const jiraResult = document.getElementById('jiraResult');
            if (jiraResult) jiraResult.style.display = 'none';

            btn.style.background = '#059669';
            btn.innerText = `✅ Saved (Score: ${data.rice.score})`;
            setTimeout(() => {
                btn.style.background = '#4f46e5';
                btn.innerText = '💾 Save to Backlog';
                btn.disabled = false;
            }, 3000);
        }
    } catch (e) {
        console.error(e);
        alert('Error saving to backlog');
        btn.disabled  = false;
        btn.innerText = '💾 Save to Backlog';
    }
}

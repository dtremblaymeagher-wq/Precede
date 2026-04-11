'use strict';
/**
 * shared/prompts.js
 *
 * Central repository for every AI prompt in the application.
 * Functions take structured data and return prompt strings.
 * No API calls. No imports. No side effects.
 *
 * Prompts NOT here (client-side, go through /api/generate proxy):
 *   - story-grooming.js: generate, senior PM review, UX review, CTO review,
 *     compliance, complexity, DoR checklist
 *   - Vision-board: vision board generation
 * These can be migrated server-side in a future pass if needed.
 */


// ─── RADAR ANALYSIS ───────────────────────────────────────────────────────────
// Route: POST /api/analyze
// Model: MODELS.sonnet  max_tokens: 4000
// HARD RULE: never modify citation validation or analysis_type = 'full'

/**
 * @param {object} p
 * @param {{ vision: string, okrs: any[], personas: string }} p.context
 * @param {object[]} p.high        - entries from last 14 days
 * @param {object[]} p.medium      - entries from 15–60 days
 * @param {object[]} p.background  - entries older than 60 days
 * @param {string}   p.memorySection       - pre-built sprint memory block
 * @param {string}   p.longitudinalSection - pre-built longitudinal instructions block
 * @param {boolean}  p.shouldRunLongitudinal
 * @param {{ count: number, oldestDaysAgo: number }} p.sprintStats
 */
exports.buildAnalyzeSystem = ({
    context, high, medium, background,
    memorySection, longitudinalSection,
    shouldRunLongitudinal, sprintStats,
}) => `CRITICAL INSTRUCTION: You must respond EXCLUSIVELY in English. All JSON field values must be in English, even if the input data is in French. Do not write a single word in French in your response.

You are a strategic Expert Product Manager. You analyze product signals with fine temporal awareness.

Vision produit : ${context.vision}
OKRs (score each one individually based on the signals):
${Array.isArray(context.okrs) && context.okrs.length ? context.okrs.map((o, i) => `${i + 1}. ${o}`).join('\n') : 'Not defined'}
Personas : ${context.personas}

## TIME-WEIGHTED DATA

### 🔴 RECENT SIGNALS — Last 14 days (${high.length} entries) — HIGH PRIORITY
${JSON.stringify(high.map(e => ({ id: e.id, body: e.body, person: e.person, sourceType: e.sourceType, date: e.date })), null, 2)}

### 🟡 CURRENT SIGNALS — 15 to 60 days (${medium.length} entries) — MEDIUM PRIORITY
${JSON.stringify(medium.map(e => ({ id: e.id, body: e.body, person: e.person, sourceType: e.sourceType, date: e.date })), null, 2)}

### ⚪ BACKGROUND CONTEXT — Over 60 days (${background.length} entries) — CONTEXT ONLY
${JSON.stringify(background.map(e => ({ id: e.id, body: e.body, person: e.person, sourceType: e.sourceType, date: e.date })), null, 2)}

${memorySection}
${longitudinalSection}

---

Respond EXCLUSIVELY in valid JSON with this structure:

{
  "analysis": {
    "summary": "Narrative summary of 2-3 sentences on the current product state",
    "strategic_alignment_summary": "Assessment of alignment with OKRs",

    "trends": [
      {
        "topic": "Signal or pattern name",
        "description": "Concrete description with examples from the data",
        "strategic_alignment": 80,
        "evolution": "rising | stable | declining",
        "signal_strength": "emerging | established | declining",
        "persona_impacted": "Persona name or General",
        "evidence_count": 4,
        "source_ids": ["entry-id-1", "entry-id-2"]
      }
    ],

    "okr_alignment": [
      {
        "okr": "Exact OKR text as provided — do not rephrase",
        "score": 75,
        "trend": "rising | stable | declining",
        "rationale": "1-2 sentences explaining the score based on concrete signals"
      }
    ],

    "delta": {
      "new_signals": ["Signal that did not exist in the last sprint"],
      "strengthened": ["Signal that has strengthened since the last sprint"],
      "resolved": ["Signal that disappeared or was addressed"],
      "contradictions": ["Reversal detected — e.g. previously critical user turned positive"]
    },

    "strategic_gap_deep_dive": [
      {
        "topic": "Short gap label",
        "description": "Concrete explanation of the gap with supporting examples from the data",
        "evidence_count": 2
      }
    ],

    "sentiment": [
      {
        "actor": "Group or persona name",
        "status": "positive | neutral | tense",
        "feedback": "Sentiment summary with short quote if possible",
        "source_ids": ["entry-id-1"]
      }
    ],

    "opportunities": [
      { "title": "Title", "description": "Actionable description" }
    ],

    "risks": [
      { "title": "Title", "description": "Description with estimated probability and impact" }
    ],

    "next_actions": [
      { "title": "Concrete action", "description": "Why this action now" }
    ],

    "longitudinal": ${shouldRunLongitudinal ? `{
      "status": "available",
      "period_analyzed": "${Math.round(sprintStats.oldestDaysAgo)} days",
      "sprints_analyzed": ${sprintStats.count},
      "recurring_signals": [
        {
          "topic": "Short topic label",
          "description": "Why this keeps recurring across sprints and what pattern it reveals",
          "evidence_count": 3
        }
      ],
      "accelerating_trends": ["Trend that is accelerating with its slope: slow/moderate/fast"],
      "decelerating_trends": ["Trend that is losing momentum"],
      "persistent_contradictions": ["Contradiction detected across multiple sprints"],
      "silent_signals": [
        {
          "topic": "Topic that disappeared",
          "last_seen": "Approximate sprint or date",
          "hypothesis": "resolved | abandoned | suppressed",
          "risk_level": "low | medium | high"
        }
      ],
      "velocity_alerts": [
        {
          "topic": "Accelerating signal",
          "velocity": "slow | moderate | fast",
          "projection": "This signal will become critical in X sprints if the trend continues"
        }
      ],
      "churn_signals": [
        {
          "actor": "User or group name",
          "signal": "Description of the detected behavior",
          "risk_level": "low | medium | high"
        }
      ],
      "weak_signal_alert": "Weak signal today that resembles a previously ignored signal"
    }` : `{
      "status": "insufficient_data",
      "sprints_completed": ${sprintStats.count},
      "sprints_required": 4,
      "days_accumulated": ${Math.round(sprintStats.oldestDaysAgo)},
      "days_required": 60
    }`}
  },

  "sprint_memory": {
    "savedAt": "${new Date().toISOString()}",
    "established_trends": ["Confirmed trends to keep in mind"],
    "active_risks": ["Active risks to monitor"],
    "tracked_opportunities": ["Opportunities being validated"],
    "decisions_made": ["Decisions or actions confirmed in the data"]
  }
}

RULES:
- Trends must be based on CONCRETE signals, not generalities
- "evidence_count" (trends and recurring_signals): count the distinct input entries that directly contributed — must be ≥ 1 for any item you report
- "source_ids" (trends and sentiment): list the exact "id" values of the input entries that directly support this trend or sentiment observation. Must match entry IDs from the data above.
- "delta" empty if no sprint memory available
- "signal_strength": emerging = < 2 weeks, established = confirmed across multiple entries, declining = background only
- "next_actions" must be justified by RECENT signals (high priority)
- No opportunities or risks without grounding in the data
- For "okr_alignment": score each OKR separately from 0 to 100 based on the signals. If no signal relates to an OKR, score = 50 (neutral). Do not invent rationale without grounding in the data. Use the EXACT text of each OKR as provided — do not rephrase.
- **LANGUAGE: ALL text values in the JSON must be written in ENGLISH. The input data may be in French — that is fine, but your entire output must be in English. No exceptions.**
`;


// ─── SMART AUDIT ──────────────────────────────────────────────────────────────
// Route: POST /api/backlog/smart-audit
// Model: MODELS.haikuLegacy  max_tokens: 3000
// HARD RULE: NEVER modify citation validation (15-word minimum, type direction math)

/**
 * @param {{ vision: string, objectives: string[] }} context
 */
exports.buildSmartAuditSystem = ({ context }) => `Always respond in English.

Tu es un Expert Product Manager spécialisé en priorisation stratégique.

CONTEXTE PRODUIT :
Vision : ${context.vision}
Objectifs stratégiques :
${context.objectives.map((o, i) => `${i + 1}. ${o}`).join('\n')}

📊 ÉCHELLE RICE :
- Impact : 0 (aucun) → 10 (impact majeur)
- Score RICE = (Reach × Impact × Confidence%) / Effort

MISSION :
1. DÉTECTER LES DOUBLONS : Identifie les stories qui parlent de la MÊME fonctionnalité
2. ANALYSER L'ALIGNEMENT STRATÉGIQUE : Compare l'Impact RICE avec la demande terrain et l'alignement vision/OKRs

RÈGLES CRITIQUES :

COHÉRENCE MATHÉMATIQUE OBLIGATOIRE :
- Si type = "overvalued" → suggestedImpact DOIT être < currentImpact
- Si type = "undervalued" → suggestedImpact DOIT être > currentImpact
- L'Impact peut aller de 0 à 10

CITATIONS TEXTUELLES OBLIGATOIRES :
- Copie EXACTEMENT ET COMPLÈTEMENT les phrases des feedbacks
- Format : "[Source exacte] : 'copie mot-à-mot complète du texte'"
- Minimum 15 mots consécutifs obligatoires — sinon NE CRÉE PAS L'AUDIT

RÈGLE D'OR : Si tu ne peux pas copier AU MOINS 15 mots consécutifs exactement comme dans le feedback, NE CRÉE PAS L'AUDIT.

Format JSON :
{
  "duplicates": [
    {
      "type": "duplicate",
      "stories": ["story-123.json", "story-456.json"],
      "reason": "Les deux stories parlent d'automatiser le RICE scoring",
      "recommendation": "Fusionner ces stories ou supprimer le doublon"
    }
  ],
  "audits": [
    {
      "fileName": "story-123.json",
      "type": "undervalued",
      "reasoning": {
        "feedbackCount": 2,
        "demandLevel": "moyenne",
        "strategicAlignment": "forte",
        "alignmentRationale": "Contribue directement à l'objectif #1",
        "currentImpactAnalysis": "Impact actuel trop bas car...",
        "suggestedImpactRationale": "Impact de 7 recommandé car..."
      },
      "currentImpact": 3,
      "suggestedImpact": 7,
      "evidence": ["[Source exacte] : 'copie mot-à-mot complète'"]
    }
  ]
}

Si aucun doublon ET aucun audit : {"duplicates": [], "audits": []}`;

/**
 * @param {object[]} feedbacks
 * @param {object[]} storiesSummary
 */
exports.buildSmartAuditUser = ({ feedbacks, storiesSummary }) =>
`FEEDBACKS DU HUB :

${feedbacks.map((f, i) => {
    const source  = f.source || f.person || f.sourceType || 'Feedback client';
    const content = f.content || f.text || f.description || f.body || '';
    return `FEEDBACK #${i + 1}:\nSource : ${source}\nTexte complet : "${content}"\nDate : ${f.date || f.createdAt || 'Date inconnue'}`;
}).join('\n---\n')}

STORIES DU BACKLOG :
${JSON.stringify(storiesSummary, null, 2)}

RAPPELS : Détecte les doublons, copie les citations mot-à-mot (min 15 mots), vérifie la cohérence type/direction.`;


// ─── MEETING PREP ─────────────────────────────────────────────────────────────
// Route: POST /api/meeting-prep
// Model: MODELS.haikuLegacy  max_tokens: 2500

/**
 * @param {string}   p.actor
 * @param {string}   p.subject
 * @param {string}   p.context
 * @param {string}   p.format
 * @param {string}   p.radarSection       - pre-built radar intelligence block
 * @param {object[]} p.relevantFeedbacks
 */
exports.buildMeetingPrepPrompt = ({ actor, subject, context, format, radarSection, relevantFeedbacks }) =>
`Always respond in English.

Tu es un stratège PM expérimenté.

CONTEXTE DE LA RÉUNION :
- Interlocuteur : ${actor}
- Objectif : ${subject}
- Format : ${format || 'Réunion'}
${context ? `- Contexte : ${context}` : ''}
${radarSection}

GÉNÈRE UNE STRATÉGIE EN DEUX PARTIES :

<SECRET>
[Brief confidentiel PM]

**OBJECTIFS CACHÉS & OBSERVATIONS :**
**TACTIQUES DE NÉGOCIATION :**
${relevantFeedbacks.length > 0 ? `\n**FEEDBACKS TERRAIN (à utiliser) :**\n${relevantFeedbacks.map((f, i) => `${i+1}. [${f.person || f.source}] "${(f.body || f.content || '').substring(0, 150)}"`).join('\n')}` : ''}
**ANGLES STRATÉGIQUES :**
**CE QU'IL FAUT DÉTECTER :**
</SECRET>

<PUBLIC>
[Agenda à partager]

**ORDRE DU JOUR :**
**RÉSULTATS ATTENDUS :**
**PRÉPARATION REQUISE :**
**DURÉE ESTIMÉE :**
</PUBLIC>

${relevantFeedbacks.length > 0 ? `<REFERENCES>\n${relevantFeedbacks.map((f, i) => `**FEEDBACK #${i+1}**\nSource : ${f.person || f.source}\nDate : ${f.date || f.createdAt}\nContenu : "${f.body || f.content || ''}"`).join('\n---\n')}\n</REFERENCES>` : ''}

Sois concret, actionnable, stratégique.`;


// ─── POST MEETING ─────────────────────────────────────────────────────────────
// Route: POST /api/post-meeting
// Model: MODELS.haikuLegacy  max_tokens: 2000

/**
 * @param {string} p.notes
 * @param {string} p.actor
 */
exports.buildPostMeetingPrompt = ({ notes, actor }) =>
`Always respond in English.

Tu es un assistant PM spécialisé dans la synthèse de réunions.

NOTES : ${notes}
INTERLOCUTEUR : ${actor}

GÉNÈRE :

<SUMMARY>
**DÉCISION(S) CLÉS :**
**PROCHAINES ÉTAPES :**
**DATE DE SUIVI :**
**PARTICIPANTS :**
</SUMMARY>

<INSIGHT>
- Qu'est-ce qui n'a PAS été dit mais est important ?
- Tensions, désalignements, non-dits ?
- Opportunités ou risques stratégiques ?
- Recommandations concrètes
</INSIGHT>

RÈGLE : Extrais UNIQUEMENT les infos présentes dans les notes. N'invente jamais.`;


// ─── RICE ESTIMATION ─────────────────────────────────────────────────────────
// Used in: batchCalculateRice()
// Model: MODELS.haiku  max_tokens: 1024

/**
 * @param {string} p.list - pre-formatted list of stories with index, title, description
 */
exports.buildRicePrompt = ({ list }) =>
`You are a product management expert. Estimate RICE scoring for each user story below.

RICE definitions:
- reach:      number of users impacted per quarter (integer, e.g. 50–10000)
- impact:     3=massive, 2=significant, 1=medium, 0.5=low, 0.25=minimal
- confidence: how confident are you in these estimates (integer 0–100)
- effort:     story points in fibonacci (1,2,3,5,8,13) — only estimate if not already provided

Return ONLY a valid JSON array, no explanation:
[{ "index": 0, "reach": 500, "impact": 1, "confidence": 60, "effort": 3 }, ...]

Stories:
${list}`;


// ─── UNTRACKED DEMAND ─────────────────────────────────────────────────────────
// Route: POST /api/dashboard/untracked-demand
// Model: MODELS.sonnetV2  max_tokens: 2048

/**
 * @param {string} p.signalsList - pre-formatted hub signals
 * @param {string} p.storiesList - pre-formatted active backlog stories
 */
exports.buildUntrackedDemandPrompt = ({ signalsList, storiesList }) =>
`You are a senior product manager assistant. Your job is to find user demands that are slipping through the cracks — real recurring pain points not being addressed by the current roadmap.

MINIMUM SIGNAL THRESHOLD: Only include topics mentioned in at least 2 distinct signals.

HUB SIGNALS — qualitative feedback from users, customers, market, and support:
${signalsList}

ACTIVE BACKLOG STORIES — what the team is currently planning or building (excludes Done):
${storiesList}

Instructions:
1. Group the Hub signals into recurring topics (minimum 2 signals each).
2. For each topic, check semantically whether an active backlog story already covers it.
   - Be generous in matching: "slow loading" matches "performance optimization", "can't find X" matches "navigation improvements".
   - Only mark as UNTRACKED if there is genuinely no related active story.
3. Return ONLY the untracked topics — demands with no story coverage.
4. Rank by urgency based on signal volume, sentiment, and business impact.

Return ONLY valid JSON array, no explanation or markdown:
[
  {
    "topic": "concise topic name (5 words max)",
    "signalCount": 3,
    "signals": ["brief verbatim excerpt from signal 1", "brief verbatim excerpt from signal 2"],
    "suggestedTitle": "actionable story title the PM could create",
    "urgency": "high|medium|low",
    "reasoning": "one sentence: why this matters and why it has no coverage"
  }
]

If all recurring topics are already covered by active stories, return: []`;


// ─── OKR COVERAGE ─────────────────────────────────────────────────────────────
// Route: POST /api/dashboard/okr-coverage
// Model: MODELS.sonnetV2  max_tokens: 6000

/**
 * @param {string}   p.okrList
 * @param {string}   p.sprintGoal
 * @param {string}   p.sprintLabel
 * @param {string}   p.storiesList
 * @param {string}   p.signalsList
 * @param {number}   p.totalSprintPoints
 * @param {object[]} p.sprintStories
 */
exports.buildOkrCoveragePrompt = ({ okrList, sprintGoal, sprintLabel, storiesList, signalsList, totalSprintPoints, sprintStories }) =>
`You are a senior product strategist. Analyze alignment between OKRs, sprint work, and customer signals.

OKRs:
${okrList}

SPRINT GOAL: ${sprintGoal || 'Not defined'}

CURRENT SPRINT STORIES (${sprintLabel} — In Progress or pulled into this sprint, total sprint = ${totalSprintPoints} SP):
${storiesList}

HUB SIGNALS (customer feedback, user research, support tickets, market signals):
${signalsList}

Return ONLY valid JSON with this exact shape, no markdown or explanation:
{
  "storyCoverage": [
    {
      "okr": "exact OKR text from the list above",
      "storyCount": 2,
      "storyPoints": 8,
      "stories": [{"title": "story title", "status": "In Progress", "points": 5}],
      "executionScore": 70,
      "coverageLevel": "strong|partial|none",
      "sprintGoalAlignmentScore": 80,
      "note": "one sentence: are we actually working on this OKR?"
    }
  ],
  "demandAlignment": [
    {
      "okr": "exact OKR text",
      "signalCount": 5,
      "alignment": "strong|partial|none",
      "signals": [{"text": "verbatim signal excerpt up to 200 chars", "sourceType": "feedback"}]
    }
  ],
  "unalignedDemand": {
    "signalCount": 3,
    "topics": ["topic 1", "topic 2"],
    "note": "one sentence: what customers want that no OKR addresses",
    "signals": [{"text": "verbatim signal excerpt up to 200 chars", "sourceType": "feedback"}]
  },
  "storyScores": [
    {
      "title": "exact story title",
      "status": "In Progress",
      "points": 5,
      "okrScores": [8, 2, 6, 1]
    }
  ]
}

Rules:
- storyCoverage: For EVERY OKR, list semantically related stories from the current sprint.
  - storyPoints = sum of SP for matched stories (use 0 if none or SP unknown).
  ${totalSprintPoints > 0
    ? `- executionScore = round(storyPoints / ${totalSprintPoints} * 100). Cap at 100. Use 0 if no matched stories.`
    : `- SP data is unavailable (all stories have unknown SP). executionScore = round(matched story count / ${sprintStories.length || 1} * 100). Cap at 100.`}
  - coverageLevel: strong = 2+ matched stories or executionScore ≥ 30, partial = 1 matched story or executionScore ≥ 10, none = 0 matched stories.
  - sprintGoalAlignmentScore: 0–100. How well does the SPRINT GOAL text semantically advance this OKR? 100 = sprint goal explicitly and directly targets this OKR. 50 = tangentially related or sprint goal not defined. 0 = sprint goal is unrelated or contradicts this OKR.
- demandAlignment: For EVERY OKR, count Hub signals topically relevant to it. alignment: strong = 3+ signals, partial = 1-2, none = 0. signals: include up to 5 verbatim excerpts (up to 200 chars each) from the most relevant Hub signals for that OKR.
- unalignedDemand: signals that don't map to ANY OKR. signals: include up to 5 verbatim excerpts from the most representative unaligned signals.
- unalignedDemand: signals that don't map to ANY OKR — genuine strategic blind spots.
- storyScores: For EVERY story in the sprint, score its relevance to EACH OKR from 1 (completely unrelated) to 10 (directly advances this OKR). okrScores is an array with one integer per OKR in the same order as the OKR list above. Every sprint story must appear exactly once.
- Be generous in semantic matching: "checkout friction" matches "improve conversion", "slow loading" matches "performance".
- Every OKR must appear in BOTH storyCoverage and demandAlignment arrays.`;


// ─── BRAINSTORM ───────────────────────────────────────────────────────────────
// Route: POST /api/brainstorm
// Model: MODELS.sonnet  max_tokens: 2048

/**
 * @param {string} p.productBlock - pre-built vision/OKR/persona/client block
 * @param {string} p.radarCtx     - pre-built radar intelligence block (may be empty)
 * @param {string} p.itemsBlock   - pre-built selected dashboard items block (may be empty)
 */
exports.buildBrainstormSystem = ({ productBlock, radarCtx, itemsBlock }) =>
`You are a strategic thinking partner embedded inside a PM's daily workflow. You have full visibility into their product, signals, and current sprint context. Your job is to help them think clearly, generate sharp ideas, and reach decisions — not to lecture them.

## Product Context
${productBlock || 'Not configured yet.'}
${radarCtx}${itemsBlock}

## How to respond
- Be direct and concrete. Lead with insight, not preamble.
- Use short headers (##) to structure longer answers. Use bullets only when listing distinct items.
- When brainstorming solutions: give 3–5 distinct options with different trade-off profiles (quick win vs strategic, risky vs safe, etc.).
- When asked to analyze: reference the actual signals and context above — not generic PM advice.
- When you spot a contradiction with existing data or a risk the PM might not see, flag it briefly.
- Do not repeat context back to the user unless they ask for a summary.
- Always respond in English.`;

/**
 * Auto-init message sent when user arrives with selected dashboard items.
 * @param {number} p.selectedItemCount
 */
exports.buildBrainstormInitMessage = ({ selectedItemCount }) =>
`I just selected ${selectedItemCount} item${selectedItemCount !== 1 ? 's' : ''} from my dashboard to brainstorm. Based on what you know about the product and the latest signals, what are the most important angles to explore here? Be specific — reference the actual data, not generics.`;


// ─── EPIC CATEGORIZATION ──────────────────────────────────────────────────────
// Used in: categorizeCompleted() in routes/epic-prediction-routes.js
// Model: MODELS.sonnet  max_tokens: 1500

/**
 * @param {object[]} p.epicList - pre-serialized epic summaries
 */
exports.buildEpicCategorizePrompt = ({ epicList }) =>
`You are categorizing completed software product epics for a PM tool.

EPIC TYPES (pick one):
- feature: new end-user functionality
- integration: connecting external APIs or third-party services
- refactor: internal code quality, tech debt, architecture
- ux: design overhaul, UI redesign, accessibility
- data: analytics, reporting, dashboards, data pipelines
- infra: DevOps, infrastructure, platform engineering, CI/CD
- security: security hardening, compliance, auth/SSO

T-SHIRT SIZES (based on final story count):
XS=1–5  S=6–10  M=11–20  L=21–35  XL=36+

For each epic return ONLY a JSON array — no markdown, no explanation:
[{ "epicKey": "...", "tshirt_size": "M", "epic_type": "feature", "rationale": "one sentence max" }]

EPICS:
${JSON.stringify(epicList, null, 2)}`;


// ─── EPIC MATCHING ────────────────────────────────────────────────────────────
// Used in: matchActiveEpics() in routes/epic-prediction-routes.js
// Model: MODELS.sonnet  max_tokens: 2000

/**
 * @param {object[]} p.historicalContext - pre-serialized completed epic predictions
 * @param {object[]} p.activeContext     - pre-serialized active epics to match
 */
exports.buildEpicMatchPrompt = ({ historicalContext, activeContext }) =>
`You are a PM analyst predicting scope creep for active software epics by matching them to historical completed epics.

CONFIDENCE LEVELS:
- precise_match: ≥1 match with same type AND same size
- type_expanded: ≥1 match with same type, any size
- size_only: ≥1 match with same size, different type
- insufficient: no reliable match (<3 completed epics or no meaningful similarity)

HISTORICAL COMPLETED EPICS (with actual performance):
${JSON.stringify(historicalContext, null, 2)}

ACTIVE EPICS TO MATCH:
${JSON.stringify(activeContext, null, 2)}

For each active epic return ONLY a JSON array — no markdown, no explanation:
[{
  "epicKey": "...",
  "tshirt_size": "M",
  "epic_type": "feature",
  "rationale": "one sentence explaining classification and match logic",
  "confidence_level": "precise_match",
  "matched_epic_keys": ["KEY1", "KEY2"],
  "scope_projection": {
    "additionalStories": 4,
    "creepPct": 35,
    "fromPhase": "development",
    "basedOnEpics": 2
  }
}]

Rules:
- matched_epic_keys: list the 1–3 most similar historical epic keys, ordered by similarity
- scope_projection.additionalStories: stories likely to be added from now until completion
- scope_projection.creepPct: total expected creep % based on matched epics
- scope_projection.fromPhase: current phase of the active epic
- If insufficient history, still provide best-effort tshirt_size and epic_type`;


// ─── DECOMPOSED ANALYZE ROUTES ────────────────────────────────────────────────
// Routes: POST /api/analyze/signals · /delta · /longitudinal · /alignment
// Model: MODELS.sonnet  max_tokens: 2000 each (focused, no cross-concern noise)
// analysis_type saved: 'signals' | 'delta' | 'longitudinal' | 'alignment'

const _entryBlock = (label, entries) =>
    `### ${label} (${entries.length} entries)\n` +
    JSON.stringify(entries.map(e => ({ id: e.id, body: e.body, person: e.person, sourceType: e.sourceType, date: e.date })), null, 2);

/**
 * POST /api/analyze/signals
 * Trends + sentiment from time-weighted Hub entries.
 */
exports.buildSignalsPrompt = ({ context, high, medium, background }) =>
`You are a strategic Expert Product Manager. Analyse the Hub signals and return ONLY valid JSON.

Vision: ${context.vision}
OKRs: ${Array.isArray(context.okrs) ? context.okrs.map((o, i) => `${i + 1}. ${o}`).join('\n') : 'Not defined'}
Personas: ${context.personas}

## TIME-WEIGHTED SIGNALS
${_entryBlock('🔴 RECENT — last 14 days — HIGH PRIORITY', high)}
${_entryBlock('🟡 CURRENT — 15–60 days — MEDIUM PRIORITY', medium)}
${_entryBlock('⚪ BACKGROUND — over 60 days — CONTEXT ONLY', background)}

Return ONLY valid JSON:
{
  "trends": [
    { "topic": "string", "description": "string", "strategic_alignment": 0, "evolution": "rising|stable|declining", "signal_strength": "emerging|established|declining", "persona_impacted": "string", "evidence_count": 1, "source_ids": [] }
  ],
  "sentiment": [
    { "actor": "string", "status": "positive|neutral|tense", "feedback": "string", "source_ids": [] }
  ]
}

RULES:
- trends: based only on CONCRETE signals in the data above
- evidence_count: count distinct entries that directly contributed — minimum 1
- source_ids: list the exact "id" values of entries that support each trend or sentiment observation
- strategic_alignment: 0–100, how well the trend aligns with the OKRs
- ALL text values in English`;

/**
 * POST /api/analyze/delta
 * What changed vs last sprint memory.
 */
exports.buildDeltaPrompt = ({ context, high, medium, background, sprintMemory }) => {
    const mem = sprintMemory;
    const memBlock = mem ? `
## LAST SPRINT MEMORY (${mem.savedAt?.split('T')[0] || 'unknown'})
Established trends: ${(mem.established_trends || []).map(t => `- ${t}`).join('\n') || 'None'}
Active risks: ${(mem.active_risks || []).map(r => `- ${r}`).join('\n') || 'None'}
Tracked opportunities: ${(mem.tracked_opportunities || []).map(o => `- ${o}`).join('\n') || 'None'}
Decisions made: ${(mem.decisions_made || []).map(d => `- ${d}`).join('\n') || 'None'}` : '## NO SPRINT MEMORY — return empty arrays for all delta fields.';

    return `You are a strategic Expert Product Manager. Compare current signals against sprint memory and return ONLY valid JSON.

Vision: ${context.vision}

## CURRENT SIGNALS
${_entryBlock('🔴 RECENT — last 14 days', high)}
${_entryBlock('🟡 CURRENT — 15–60 days', medium)}
${_entryBlock('⚪ BACKGROUND — over 60 days', background)}
${memBlock}

Return ONLY valid JSON:
{
  "delta": {
    "new_signals": ["Signal that did not exist in last sprint"],
    "strengthened": ["Signal that has strengthened since last sprint"],
    "resolved": ["Signal that disappeared or was addressed"],
    "contradictions": ["Reversal — e.g. previously critical user turned positive"]
  },
  "sprint_memory": {
    "savedAt": "${new Date().toISOString()}",
    "established_trends": ["Confirmed trends to keep in mind"],
    "active_risks": ["Active risks to monitor"],
    "tracked_opportunities": ["Opportunities being validated"],
    "decisions_made": ["Decisions or actions confirmed in the data"]
  }
}

RULES:
- delta empty arrays if no sprint memory
- ALL text values in English`;
};

/**
 * POST /api/analyze/longitudinal
 * Silent signals, velocity, churn — requires ≥ 4 sprints / 60 days.
 */
exports.buildLongitudinalPrompt = ({ context, high, medium, background, sprintStats, historicalSnapshots }) => {
    const historyBlock = historicalSnapshots.map((snap, i) => `
### Sprint ${i + 1} — ${snap.date}
Summary: ${snap.summary}
Trends: ${snap.trends.map(t => `${t.topic} (${t.alignment}% alignment, ${t.evolution})`).join(' | ') || 'none'}
Opportunities: ${snap.opportunities.join(' | ') || 'none'}
Risks: ${snap.risks.join(' | ') || 'none'}`).join('\n');

    return `You are a strategic Expert Product Manager. Perform a longitudinal analysis over ${sprintStats.count} sprints (${Math.round(sprintStats.oldestDaysAgo)} days) and return ONLY valid JSON.

Vision: ${context.vision}
Personas: ${context.personas}

## RECENT SIGNALS
${_entryBlock('🔴 RECENT — last 14 days', high)}
${_entryBlock('🟡 CURRENT — 15–60 days', medium)}

## SPRINT HISTORY (oldest → newest)
${historyBlock}

Return ONLY valid JSON:
{
  "longitudinal": {
    "status": "available",
    "period_analyzed": "${Math.round(sprintStats.oldestDaysAgo)} days",
    "sprints_analyzed": ${sprintStats.count},
    "recurring_signals": [{ "topic": "string", "description": "string", "evidence_count": 1 }],
    "silent_signals": [{ "topic": "string", "hypothesis": "string", "risk_level": "low|medium|high", "last_seen": "string" }],
    "velocity_alerts": [{ "topic": "string", "velocity": "slow|moderate|fast", "projection": "string" }],
    "churn_signals": [{ "actor": "string", "signal": "string", "risk_level": "low|medium|high" }],
    "weak_signal_alert": "string"
  }
}

RULES:
- recurring_signals: topics appearing multiple times without resolution
- silent_signals: topics frequent in past sprints, now absent — flag each as resolved/abandoned/suppressed
- velocity_alerts: signals doubling in frequency or intensity
- churn_signals: users whose feedback is shortening, more negative, or comparing competitors
- ALL text values in English`;
};

/**
 * POST /api/analyze/alignment
 * OKR alignment score + strategic gap analysis.
 */
exports.buildAlignmentPrompt = ({ context, high, medium, background }) =>
`You are a strategic Expert Product Manager. Score OKR alignment and identify strategic gaps. Return ONLY valid JSON.

OKRs (score each individually):
${Array.isArray(context.okrs) && context.okrs.length ? context.okrs.map((o, i) => `${i + 1}. ${o}`).join('\n') : 'Not defined'}

Vision: ${context.vision}

## SIGNALS
${_entryBlock('🔴 RECENT — last 14 days', high)}
${_entryBlock('🟡 CURRENT — 15–60 days', medium)}
${_entryBlock('⚪ BACKGROUND — over 60 days', background)}

Return ONLY valid JSON:
{
  "okr_alignment": [
    { "okr": "Exact OKR text as provided", "score": 75, "trend": "rising|stable|declining", "rationale": "string" }
  ],
  "strategic_gap_deep_dive": [
    { "topic": "string", "description": "string", "evidence_count": 1 }
  ],
  "strategic_alignment_summary": "string"
}

RULES:
- okr: use EXACT text of each OKR as provided — do not rephrase
- score: 0–100 based on signal evidence; 50 = neutral/no signal
- strategic_gap_deep_dive: customer signals not covered by any OKR
- ALL text values in English`;

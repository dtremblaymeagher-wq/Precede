'use strict';
/**
 * utils/sprint-end-jobs.js
 *
 * Background jobs triggered by the sprint-end and change-detection crons.
 *
 * runRadarAnalysis(supabase, userId, instanceId)
 *   Replicates the /api/analyze monolith flow, loading entries from DB instead
 *   of from req.body. Saves to analysis_history + upserts radar_memory.
 *
 * runEpicPrediction(supabase, userId, instanceId)
 *   Categorizes stale completed epics and matches stale active epics.
 *   Saves results to epic_predictions.
 */

const { randomUUID }       = require('crypto');
const { LONGITUDINAL }     = require('../shared/constants');
const { MODELS, callAI }   = require('../shared/ai-client');
const prompts              = require('../shared/prompts');
const helpers              = require('./analyze-helpers');
const { makeSprintUtils }  = require('./sprint-utils');
const { TSHIRT_SIZES, countToSize, sprintNumFromName } = require('./story-constants');
const {
    EPIC_TYPES,
    epicComplete,
    storyHash,
    byEpic,
    categorizeCompleted,
    matchActiveEpics,
} = require('./epic-prediction-service');

// ─── Radar analysis ───────────────────────────────────────────────────────────

async function runRadarAnalysis(supabase, userId, instanceId) {
    const { getCurrentSprint } = makeSprintUtils(supabase);
    const fakeReq = { userId, instanceId, requestId: randomUUID() };

    // Load entries from DB (replaces req.body.dataset in the HTTP route)
    const dataset = await helpers.loadEntries(userId, instanceId);
    if (!dataset.length) {
        console.log(`[runRadarAnalysis] No entries for ${userId}/${instanceId} — skipping`);
        return;
    }

    // Load context + sprint memory + user feedback rules in parallel
    const [ctxResult, sprintMemResult, feedbackResult] = await Promise.allSettled([
        helpers.loadContext(userId, instanceId),
        helpers.loadSprintMemory(userId, instanceId),
        supabase.from('learning_vault').select('data, created_at')
            .eq('user_id', userId).eq('instance_id', instanceId).eq('type', 'user_feedback')
            .order('created_at', { ascending: false }).limit(10),
    ]);

    const ctx = ctxResult.status === 'fulfilled' ? ctxResult.value
        : { vision: 'Non définie', okrs: [], personas: 'Non définis' };
    const context = {
        vision:   ctx.vision,
        okrs:     ctx.okrs,
        okrsText: Array.isArray(ctx.okrs) ? ctx.okrs.join('\n') : 'Not defined',
        personas: ctx.personas,
    };

    const sprintMemory = sprintMemResult.status === 'fulfilled' ? sprintMemResult.value : null;
    const hasMemory    = sprintMemory !== null;

    let userFeedbackSection = '';
    if (feedbackResult.status === 'fulfilled' && feedbackResult.value.data?.length) {
        const rules = feedbackResult.value.data
            .filter(r => r.data?.recommendation?.trim())
            .map((r, i) => `${i + 1}. ${r.data.recommendation.trim()}`);
        if (rules.length)
            userFeedbackSection = `\n## ANALYSIS RULES FROM PM FEEDBACK\nApply these rules strictly in your analysis. They were derived from direct PM observations on past outputs:\n\n${rules.join('\n')}\n`;
    }

    // Temporal buckets
    const { high, medium, background } = helpers.bucketByWeight(dataset);

    // Sprint memory section
    let memorySection = '';
    if (hasMemory) {
        memorySection = `
## LAST SPRINT MEMORY (${sprintMemory.savedAt?.split('T')[0] || 'unknown date'})

**Established trends:**
${(sprintMemory.established_trends || []).map(t => `- ${t}`).join('\n') || '- None'}

**Active risks:**
${(sprintMemory.active_risks || []).map(r => `- ${r}`).join('\n') || '- None'}

**Tracked opportunities:**
${(sprintMemory.tracked_opportunities || []).map(o => `- ${o}`).join('\n') || '- None'}

**Decisions made:**
${(sprintMemory.decisions_made || []).map(d => `- ${d}`).join('\n') || '- None'}

⚠️ DELTA INSTRUCTIONS:
- Identify what is **new** compared to this memory
- Identify what has **strengthened** (stronger signal than before)
- Identify what has **disappeared** or been **resolved**
- Identify **contradictions** or **reversals**
`;
    }

    // Longitudinal decision
    const sprintStats           = await helpers.getSprintStats(userId, instanceId);
    const shouldRunLongitudinal = sprintStats.count >= LONGITUDINAL.MIN_SPRINTS
                               && sprintStats.oldestDaysAgo >= LONGITUDINAL.MIN_DAYS;

    const daysNeeded = Math.max(0, Math.round(LONGITUDINAL.MIN_DAYS - sprintStats.oldestDaysAgo));
    const longitudinalSection = shouldRunLongitudinal
        ? `## LONGITUDINAL ANALYSIS\n→ Set longitudinal.status = "available" — data will be merged from a separate call.`
        : `## LONGITUDINAL ANALYSIS NOT AVAILABLE\nConditions not met: ${sprintStats.count}/4 sprints completed${daysNeeded > 0 ? `, ${daysNeeded} days remaining` : ''}.\n→ Leave the "longitudinal" field with status "insufficient_data" and sprints_completed: ${sprintStats.count}.`;

    // Build prompt and run Call 1
    const totalEntries = high.length + medium.length + background.length;
    const promptSystem = prompts.buildAnalyzeSystem({
        context, high, medium, background,
        memorySection, longitudinalSection,
        shouldRunLongitudinal, sprintStats,
        userFeedbackSection,
        totalEntries,
        isFirstAnalysis: sprintStats.count === 0,
    });

    const rawText = await callAI({
        model:        MODELS.sonnet,
        maxTokens:    4000,
        system:       promptSystem,
        messages:     [{ role: 'user', content: 'Run the full analysis and return the JSON. Remember: all text values must be in English.' }],
        callType:     'signal_analysis',
        req:          fakeReq,
        deliveryMode: 'batch',
    });
    if (!rawText) throw new Error('[runRadarAnalysis] Empty response from AI');
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('[runRadarAnalysis] AI returned no JSON');
    const analysisJSON = JSON.parse(jsonMatch[0]);

    // Calls 2 + 3 in parallel
    const synthPromise = (async () => {
        const synthSystem = prompts.buildStrategicSynthesisPrompt(analysisJSON.analysis);
        return callAI({
            model:        MODELS.sonnet,
            maxTokens:    1200,
            system:       synthSystem,
            messages:     [{ role: 'user', content: 'Write the narratives and re-qualify the risks and opportunities. Return only valid JSON.' }],
            callType:     'strategic_synthesis',
            req:          fakeReq,
            deliveryMode: 'batch',
        });
    })().catch(err => { console.error('[runRadarAnalysis] synthesis failed:', err.message); return null; });

    const longPromise = shouldRunLongitudinal
        ? (async () => {
            const historicalSnapshots = await helpers.loadHistoricalSnapshots(userId, instanceId);
            const longSystem = prompts.buildLongitudinalPrompt({
                context, high, medium, background: [],
                sprintStats, historicalSnapshots,
            });
            return callAI({
                model:        MODELS.sonnet,
                maxTokens:    1500,
                system:       longSystem,
                messages:     [{ role: 'user', content: 'Run the longitudinal analysis and return only valid JSON.' }],
                callType:     'longitudinal_analysis',
                req:          fakeReq,
                deliveryMode: 'batch',
            });
        })().catch(err => { console.error('[runRadarAnalysis] longitudinal failed:', err.message); return null; })
        : Promise.resolve(null);

    const [synthRaw, longRaw] = await Promise.all([synthPromise, longPromise]);

    if (synthRaw) {
        const synthMatch = synthRaw.match(/\{[\s\S]*\}/);
        if (synthMatch) {
            const synth = JSON.parse(synthMatch[0]);
            analysisJSON.analysis.summary                     = synth.summary                     || '';
            analysisJSON.analysis.strategic_alignment_summary = synth.strategic_alignment_summary || '';
            analysisJSON.analysis.strategic_gap               = synth.strategic_gap               || '';
            if (Array.isArray(synth.risks)         && synth.risks.length)         analysisJSON.analysis.risks         = synth.risks;
            if (Array.isArray(synth.opportunities) && synth.opportunities.length) analysisJSON.analysis.opportunities = synth.opportunities;
        }
    }

    if (longRaw) {
        const longMatch = longRaw.match(/\{[\s\S]*\}/);
        if (longMatch) {
            const longJSON = JSON.parse(longMatch[0]);
            if (longJSON.longitudinal) analysisJSON.analysis.longitudinal = longJSON.longitudinal;
        }
    }

    // Save to analysis_history
    const fileName = `radar-${Date.now()}.json`;
    const { error: histErr } = await supabase.from('analysis_history')
        .insert({ user_id: userId, instance_id: instanceId, filename: fileName, data: analysisJSON });
    if (histErr) console.error('[runRadarAnalysis] history save failed:', histErr.message);

    // Upsert radar_memory
    if (analysisJSON.sprint_memory) {
        const currentSprint  = await getCurrentSprint(userId, instanceId);
        const memoryToSave   = { ...analysisJSON.sprint_memory, last_analyzed_sprint: currentSprint?.identifier ?? null };
        const { error: memErr } = await supabase.from('radar_memory')
            .upsert(
                { user_id: userId, instance_id: instanceId, data: memoryToSave, updated_at: new Date().toISOString() },
                { onConflict: 'user_id,instance_id' }
            );
        if (memErr) console.error('[runRadarAnalysis] memory save failed:', memErr.message);
    }

    console.log(`[runRadarAnalysis] done ${userId}/${instanceId} → ${fileName}`);
}

// ─── Epic prediction ──────────────────────────────────────────────────────────

async function runEpicPrediction(supabase, userId, instanceId) {
    const fakeReq = { userId, instanceId, requestId: randomUUID() };
    const batchId = randomUUID();

    // Load stories
    const { data: rows, error: stErr } = await supabase.from('backlog_stories')
        .select('data, display_order')
        .eq('user_id', userId).eq('instance_id', instanceId);
    if (stErr) throw stErr;

    const epicMap = byEpic(rows ?? []);
    if (!epicMap.size) {
        console.log(`[runEpicPrediction] No epics for ${userId}/${instanceId} — skipping`);
        return;
    }

    // Load existing predictions
    const { data: existing } = await supabase.from('epic_predictions')
        .select('*').eq('user_id', userId).eq('instance_id', instanceId);
    const predMap = new Map((existing ?? []).map(p => [p.epic_key, p]));

    // Split completed vs active
    const completedEpics = [];
    const activeEpics    = [];
    for (const [, epic] of epicMap) {
        epicComplete(epic.stories) ? completedEpics.push(epic) : activeEpics.push(epic);
    }

    // Step 1 — categorize stale completed epics
    const toCategorizе = completedEpics.filter(e => {
        const ex = predMap.get(e.epicKey);
        return !ex || ex.stories_hash !== storyHash(e.stories);
    });

    if (toCategorizе.length) {
        const cats    = await categorizeCompleted(toCategorizе, fakeReq, batchId);
        const upserts = cats.map(c => ({
            user_id:      userId,
            instance_id:  instanceId,
            epic_key:     c.epicKey,
            epic_name:    epicMap.get(c.epicKey)?.epicName ?? c.epicKey,
            tshirt_size:  TSHIRT_SIZES.includes(c.tshirt_size) ? c.tshirt_size : countToSize(epicMap.get(c.epicKey)?.stories.length ?? 0),
            epic_type:    EPIC_TYPES.includes(c.epic_type)    ? c.epic_type    : null,
            rationale:    c.rationale ?? null,
            stories_hash: storyHash(epicMap.get(c.epicKey)?.stories ?? []),
            computed_at:  new Date().toISOString(),
            ...(predMap.get(c.epicKey) ? {
                tshirt_override: predMap.get(c.epicKey).tshirt_override,
                type_override:   predMap.get(c.epicKey).type_override,
                override_note:   predMap.get(c.epicKey).override_note,
                overridden_at:   predMap.get(c.epicKey).overridden_at,
            } : {}),
        }));
        const { error: upErr } = await supabase.from('epic_predictions')
            .upsert(upserts, { onConflict: 'user_id,instance_id,epic_key' });
        if (upErr) throw upErr;
        upserts.forEach(u => predMap.set(u.epic_key, u));
    }

    // Step 2 — match stale active epics
    const toMatch = activeEpics.filter(e => {
        const ex = predMap.get(e.epicKey);
        return !ex || ex.stories_hash !== storyHash(e.stories);
    });

    if (toMatch.length) {
        const completedPreds = [...predMap.values()].filter(p => {
            const epic = epicMap.get(p.epic_key);
            return epic && epicComplete(epic.stories);
        });

        // Enrich scope_projection on completed preds that don't have it yet
        completedPreds.forEach(p => {
            if (!p.scope_projection) {
                const epic = epicMap.get(p.epic_key);
                if (!epic) return;
                const idx  = epic.stories.map(s => {
                    const id = Number(s.data?.sprintId);
                    if (!isNaN(id) && id > 0) return id;
                    return sprintNumFromName(s.data?.sprintName);
                }).filter(v => v !== null);
                const minS = idx.length ? Math.min(...idx) : 0;
                const maxS = idx.length ? Math.max(...idx) : 0;
                const thr  = minS + Math.max(1, (maxS - minS) * 0.10);
                const init = idx.filter(v => v <= thr).length;
                p.scope_projection = {
                    creepPct:        init > 0 ? Math.round(((epic.stories.length - init) / init) * 100) : 0,
                    durationSprints: maxS - minS + 1,
                };
            }
        });

        const matches = await matchActiveEpics(toMatch, completedPreds, fakeReq, batchId);
        const upserts = matches.map(m => {
            const epic = epicMap.get(m.epicKey);
            return {
                user_id:           userId,
                instance_id:       instanceId,
                epic_key:          m.epicKey,
                epic_name:         epic?.epicName ?? m.epicKey,
                tshirt_size:       TSHIRT_SIZES.includes(m.tshirt_size) ? m.tshirt_size : countToSize(epic?.stories.length ?? 0),
                epic_type:         EPIC_TYPES.includes(m.epic_type)    ? m.epic_type    : null,
                rationale:         m.rationale ?? null,
                confidence_level:  ['precise_match', 'type_expanded', 'size_only', 'insufficient'].includes(m.confidence_level)
                                   ? m.confidence_level : 'insufficient',
                matched_epic_keys: Array.isArray(m.matched_epic_keys) ? m.matched_epic_keys : [],
                scope_projection:  m.scope_projection ?? null,
                stories_hash:      storyHash(epic?.stories ?? []),
                computed_at:       new Date().toISOString(),
                ...(predMap.get(m.epicKey) ? {
                    tshirt_override: predMap.get(m.epicKey).tshirt_override,
                    type_override:   predMap.get(m.epicKey).type_override,
                    override_note:   predMap.get(m.epicKey).override_note,
                    overridden_at:   predMap.get(m.epicKey).overridden_at,
                } : {}),
            };
        });
        const { error: mErr } = await supabase.from('epic_predictions')
            .upsert(upserts, { onConflict: 'user_id,instance_id,epic_key' });
        if (mErr) throw mErr;
    }

    console.log(`[runEpicPrediction] done ${userId}/${instanceId}`);
}

// ─── Agent Radar ──────────────────────────────────────────────────────────────

const AGENT_RADAR_SYSTEM = `You are the PM Radar Agent for Precede, an AI toolkit built for experienced Product Managers.

## Your role
You surface signals that matter to product decisions — not delivery status.
You think like a Chief Product Officer scanning the horizon, not a project manager tracking tickets.

## Your mindset
A senior PM's value is in detecting what's changing before anyone else notices.
You look for drift, opportunity, and risk at the product and market level.
You have opinions. You prioritize ruthlessly. Silence is better than noise.

## Signal categories you watch

**Usage drift**
- Features losing engagement without explanation
- Unexpected adoption patterns (something taking off or dying quietly)
- User segments behaving differently than expected

**Strategic risk**
- Roadmap commitments drifting from original intent
- Assumptions underneath key bets that may no longer hold
- Gaps between what was promised and what is being built

**Opportunity signals**
- Unmet needs surfacing repeatedly in feedback
- Adjacent problems the product could solve
- Moments where user workarounds reveal missing value

**Alignment signals**
- Disconnect between stakeholder expectations and product direction
- Decisions made without clear rationale still in the backlog
- Items that have lost their "why" over time

## What you have access to
- Roadmap items and their stated rationale
- Backlog and its evolution over time
- User feedback and recurring themes
- Previous signals you've raised

## Output rules
- Maximum 4 signals per run
- Only surface what genuinely needs a PM's attention
- Never repeat a signal unless its importance increased
- Each signal must answer: "So what?" — why does this matter now?
- Every signal MUST reference the specific data point that triggered it. No signal without evidence. If you can't point to something concrete in the data provided, don't surface it.
- source_ids: list the [#N] integers from the entries above that directly triggered this signal (e.g. [2, 5] — integers only, no #)
- strategic_summary, strategic_alignment, and strategic_gap MUST be written from YOUR signals and Hub entries only. Do not paraphrase, echo, or reference the Last Full Analysis content. Write as if you had never seen it.
- Every sentence in strategic_summary, strategic_alignment, and strategic_gap must be grounded in a named source, date, specific signal, or Hub entry [#N]. Generic observations not tied to specific data are not acceptable. "The product shows signs of drift" → rejected. "Three entries from Acme Corp ([#2],[#5],[#8]) in the last 14 days show X" → accepted.

## Output format (JSON only)
{
  "signals": [
    {
      "severity": "red | yellow | blue",
      "category": "usage_drift | strategic_risk | opportunity | alignment",
      "finding": "One sentence — what is happening",
      "so_what": "One sentence — why it matters to the product now",
      "evidence": "The specific item(s), quote, or data point that triggered this signal — e.g. 'AUTH-12, DASH-34 added this week have no OKR tag' or 'Three separate feedbacks from Acme Corp mention X'",
      "source_ids": [1, 3],
      "suggested_focus": "One sentence — what the PM should think about, not do"
    }
  ],
  "radar_summary": "One sentence on overall product signal health",
  "strategic_summary": "2-3 sentences — your read of what is happening right now, derived strictly from the Hub signals and epics above",
  "strategic_alignment": "2-3 sentences — your assessment of how well the signals and active work support the OKRs, based on what you see in the data",
  "strategic_gap": "2-3 sentences — what is structurally absent or unaddressed in the signals and epics, from your analysis only"
}`;

const { isDone, detectPhase } = require('./story-constants');

async function runAgentRadar(supabase, userId, instanceId, deliveryMode = 'batch') {
    const fakeReq = { userId, instanceId, requestId: randomUUID() };

    // Load entries + context + active epics + previous signals + last full analysis in parallel
    const [entriesResult, ctxResult, storiesResult, prevResult, fullAnalysisResult] = await Promise.allSettled([
        helpers.loadEntries(userId, instanceId),
        helpers.loadContext(userId, instanceId),
        supabase.from('backlog_stories').select('data')
            .eq('user_id', userId).eq('instance_id', instanceId),
        supabase.from('analysis_history')
            .select('data, created_at')
            .eq('user_id', userId).eq('instance_id', instanceId)
            .eq('analysis_type', 'agent_radar')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle(),
        supabase.from('analysis_history')
            .select('data, created_at')
            .eq('user_id', userId).eq('instance_id', instanceId)
            .like('filename', 'radar-%')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle(),
    ]);

    const allEntries = entriesResult.status === 'fulfilled' ? entriesResult.value : [];
    if (!allEntries.length) {
        console.log(`[runAgentRadar] No entries for ${userId}/${instanceId} — skipping`);
        return null;
    }

    // Only high + medium signals — background is too stale to be actionable
    const { high, medium } = helpers.bucketByWeight(allEntries);
    const relevantEntries = [...high, ...medium];

    const ctx = ctxResult.status === 'fulfilled' ? ctxResult.value
        : { vision: 'Not defined', okrs: [], personas: 'Not defined' };

    // Active epics summary
    const storyRows  = storiesResult.status === 'fulfilled' ? (storiesResult.value.data ?? []) : [];
    const epicMap    = byEpic(storyRows);
    const activeEpics = [...epicMap.values()]
        .filter(e => !epicComplete(e.stories))
        .map(e => ({
            name:      e.epicName,
            phase:     detectPhase(e.stories),
            total:     e.stories.length,
            done:      e.stories.filter(isDone).length,
        }));

    // Previous signals
    const prevData    = prevResult.status === 'fulfilled' ? prevResult.value?.data?.data : null;
    const prevSignals = prevData?.signals ?? [];

    // Last full analysis context (inject only if < 30 days old)
    let fullAnalysisContext = '';
    if (fullAnalysisResult.status === 'fulfilled' && fullAnalysisResult.value?.data) {
        const fullRow      = fullAnalysisResult.value;
        const fullAnalysis = fullRow.data?.analysis || fullRow.data;
        const daysAgo      = Math.floor((Date.now() - new Date(fullRow.created_at).getTime()) / 86400000);
        if (daysAgo <= 30 && fullAnalysis) {
            const summary   = fullAnalysis.summary                    || '';
            const alignment = fullAnalysis.strategic_alignment_summary || '';
            const gap       = fullAnalysis.strategic_gap_deep_dive    || fullAnalysis.strategic_gap || '';
            const risks     = (fullAnalysis.risks || []).slice(0, 5)
                .map(r => typeof r === 'string' ? r : (r.risk || r.title || r.description || ''))
                .filter(Boolean);
            if (summary || alignment || gap) {
                fullAnalysisContext = `
## LAST FULL ANALYSIS (${daysAgo} day${daysAgo !== 1 ? 's' : ''} ago — for signal generation only)

${summary   ? `Summary: "${summary}"` : ''}
${alignment ? `Strategic Alignment: "${alignment}"` : ''}
${gap       ? `Strategic Gap: "${gap}"` : ''}
${risks.length ? `Active Risks:\n${risks.map(r => `- ${r}`).join('\n')}` : ''}

→ Use this ONLY to avoid repeating known signals. Do NOT use it to write your strategic_summary, strategic_alignment, or strategic_gap — those must come from your own reading of the Hub entries above.`;
            }
        }
    }

    // Build user message
    const capped = relevantEntries.slice(0, 30);
    const entryMap = {};
    capped.forEach((e, i) => {
        entryMap[i + 1] = {
            id:      e.id ?? null,
            date:    (e.date || e.createdAt || '').slice(0, 10),
            source:  e.source || e.person || 'Unknown',
            snippet: (e.body || e.content || e.text || e.description || '').slice(0, 150),
        };
    });
    const entriesText = capped.map((e, i) => {
        const date    = (e.date || e.createdAt || '').slice(0, 10);
        const source  = e.source || e.person || 'Unknown';
        const content = (e.body || e.content || e.text || e.description || '').slice(0, 200);
        return `[#${i + 1}] [${date}] ${source} — "${content}"`;
    }).join('\n');

    const epicsText = activeEpics.length
        ? activeEpics.map(e => `- ${e.name} | ${e.phase} | ${e.done}/${e.total} stories done`).join('\n')
        : 'No active epics found.';

    const okrsText = ctx.okrs?.length
        ? ctx.okrs.map((o, i) => `${i + 1}. ${o}`).join('\n')
        : 'No OKRs defined.';

    const prevText = prevSignals.length
        ? prevSignals.map(s => `- [${s.category}] "${s.finding}"`).join('\n')
        : 'None — this is the first run.';

    const userMessage = `## HUB SIGNALS (high + medium priority, last 60 days)

${entriesText}

## ACTIVE EPICS

${epicsText}

## PRODUCT CONTEXT

Vision: ${ctx.vision}

OKRs:
${okrsText}
${fullAnalysisContext}
## PREVIOUS RADAR SIGNALS (do not repeat unless importance increased)

${prevText}

Analyze and return JSON only.`;

    const rawText = await callAI({
        model:        MODELS.sonnet,
        maxTokens:    2000,
        system:       AGENT_RADAR_SYSTEM,
        messages:     [{ role: 'user', content: userMessage }],
        callType:     'agent_radar',
        req:          fakeReq,
        deliveryMode,
    });

    const jsonMatch = rawText?.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('[runAgentRadar] AI returned no JSON');
    const result = JSON.parse(jsonMatch[0]);

    await supabase.from('analysis_history').insert({
        user_id:       userId,
        instance_id:   instanceId,
        filename:      `agent-radar-${Date.now()}.json`,
        analysis_type: 'agent_radar',
        data:          { ...result, entryMap },
    });

    console.log(`[runAgentRadar] done ${userId}/${instanceId} — ${result.signals?.length ?? 0} signal(s)`);
    return result;
}

module.exports = { runRadarAnalysis, runEpicPrediction, runAgentRadar };

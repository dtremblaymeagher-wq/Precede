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

module.exports = { runRadarAnalysis, runEpicPrediction };

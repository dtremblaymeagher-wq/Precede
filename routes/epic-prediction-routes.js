'use strict';
const { randomUUID } = require('crypto');
/**
 * routes/epic-prediction-routes.js
 * AI-powered T-shirt sizing + epic type categorization + scope creep prediction.
 *
 * POST /api/epic-prediction/analyze          — trigger AI categorization of all epics
 * GET  /api/epic-prediction/epics            — fetch predictions merged with live epic data
 * PUT  /api/epic-prediction/override/:key    — PM saves an override
 * GET  /api/epic-prediction/summary          — categorization stats (for Settings page)
 *
 * Caching: each epic stores a stories_hash. Re-analysis is skipped when the
 * hash is unchanged, unless the caller passes { force: true }.
 */

const { Router } = require('express');
const { apiError } = require('../utils/api-error');
const { TSHIRT_SIZES, countToSize, sprintNumFromName } = require('../utils/story-constants');
const {
    EPIC_TYPES,
    epicComplete,
    storyHash,
    byEpic,
    parseJsonResponse,
    categorizeCompleted,
    matchActiveEpics,
} = require('../utils/epic-prediction-service');
const { isDone, detectPhase } = require('../utils/story-constants');

// ─── Router factory ────────────────────────────────────────────────────────────

module.exports = function epicPredictionRoutes(supabase) {
    const router = Router();

    // ── POST /api/epic-prediction/analyze ─────────────────────────────────────
    // Triggers AI categorization for all epics that need it.
    // Completed epics: categorize (tshirt + type).
    // Active epics: categorize + match against completed.
    // Pass { force: true } to recalculate everything ignoring the hash.
    router.post('/analyze', async (req, res) => {
        try {
            const userId     = req.userId;
            const instanceId = req.instanceId;
            const force      = req.body?.force === true;

            // Load all stories
            const { data: rows, error: stErr } = await supabase
                .from('backlog_stories')
                .select('data, display_order')
                .eq('user_id', userId)
                .eq('instance_id', instanceId);
            if (stErr) throw stErr;

            const epicMap = byEpic(rows ?? []);
            if (!epicMap.size) return res.json({ message: 'No epics found', categorized: 0, matched: 0 });

            // Load existing predictions
            const { data: existing } = await supabase
                .from('epic_predictions')
                .select('*')
                .eq('user_id', userId)
                .eq('instance_id', instanceId);
            const predMap = new Map((existing ?? []).map(p => [p.epic_key, p]));

            // Split epics
            const completedEpics = [];
            const activeEpics    = [];
            for (const [, epic] of epicMap) {
                epicComplete(epic.stories) ? completedEpics.push(epic) : activeEpics.push(epic);
            }

            // ── Step 1: categorize completed epics ────────────────────────────
            const toCategorizе = force
                ? completedEpics
                : completedEpics.filter(e => {
                    const existing = predMap.get(e.epicKey);
                    return !existing || existing.stories_hash !== storyHash(e.stories);
                });

            // Return immediately — AI processing runs in background
            const batchId = randomUUID();
            res.json({ batchId, status: 'queued', totalEpics: epicMap.size });

            // ── Background AI processing ──────────────────────────────────────
            (async () => {
                if (toCategorizе.length) {
                    const cats = await categorizeCompleted(toCategorizе, req, batchId);

                    const upserts = cats.map(c => ({
                        user_id:          userId,
                        instance_id:      instanceId,
                        epic_key:         c.epicKey,
                        epic_name:        epicMap.get(c.epicKey)?.epicName ?? c.epicKey,
                        tshirt_size:      TSHIRT_SIZES.includes(c.tshirt_size)  ? c.tshirt_size  : countToSize(epicMap.get(c.epicKey)?.stories.length ?? 0),
                        epic_type:        EPIC_TYPES.includes(c.epic_type)     ? c.epic_type     : null,
                        rationale:        c.rationale ?? null,
                        stories_hash:     storyHash(epicMap.get(c.epicKey)?.stories ?? []),
                        computed_at:      new Date().toISOString(),
                        ...(predMap.get(c.epicKey) ? {
                            tshirt_override: predMap.get(c.epicKey).tshirt_override,
                            type_override:   predMap.get(c.epicKey).type_override,
                            override_note:   predMap.get(c.epicKey).override_note,
                            overridden_at:   predMap.get(c.epicKey).overridden_at,
                        } : {}),
                    }));

                    const { error: upErr } = await supabase
                        .from('epic_predictions')
                        .upsert(upserts, { onConflict: 'user_id,instance_id,epic_key' });
                    if (upErr) throw upErr;

                    upserts.forEach(u => predMap.set(u.epic_key, u));
                }

                // ── Step 2: match active epics ────────────────────────────────
                const toMatch = force
                    ? activeEpics
                    : activeEpics.filter(e => {
                        const ex = predMap.get(e.epicKey);
                        return !ex || ex.stories_hash !== storyHash(e.stories);
                    });

                if (toMatch.length) {
                    const completedPreds = [...predMap.values()].filter(p => {
                        const epic = epicMap.get(p.epic_key);
                        return epic && epicComplete(epic.stories);
                    });

                    completedPreds.forEach(p => {
                        if (!p.scope_projection) {
                            const epic  = epicMap.get(p.epic_key);
                            if (!epic) return;
                            const idx   = epic.stories.map(s => {
                                const id = Number(s.data?.sprintId);
                                if (!isNaN(id) && id > 0) return id;
                                return sprintNumFromName(s.data?.sprintName);
                            }).filter(v => v !== null);
                            const minS  = idx.length ? Math.min(...idx) : 0;
                            const maxS  = idx.length ? Math.max(...idx) : 0;
                            const thr   = minS + Math.max(1, (maxS - minS) * 0.10);
                            const init  = idx.filter(v => v <= thr).length;
                            p.scope_projection = {
                                creepPct:        init > 0 ? Math.round(((epic.stories.length - init) / init) * 100) : 0,
                                durationSprints: maxS - minS + 1,
                            };
                        }
                    });

                    const matches = await matchActiveEpics(toMatch, completedPreds, req, batchId);

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
                            confidence_level:  ['precise_match','type_expanded','size_only','insufficient'].includes(m.confidence_level)
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

                    const { error: mErr } = await supabase
                        .from('epic_predictions')
                        .upsert(upserts, { onConflict: 'user_id,instance_id,epic_key' });
                    if (mErr) throw mErr;
                }
            })().catch(err => console.error('[epic-prediction/analyze]', err.message));
        } catch (err) {
            console.error('[epic-prediction/analyze]', err);
            apiError(res, err);
        }
    });

    // ── GET /api/epic-prediction/epics ────────────────────────────────────────
    // Returns all epics with their predictions merged in.
    // Each entry has: epicKey, epicName, isCompleted, stories stats,
    // + effective tshirt/type (override wins), confidence, matched epics, projection.
    router.get('/epics', async (req, res) => {
        try {
            const userId     = req.userId;
            const instanceId = req.instanceId;

            const [storiesRes, predsRes] = await Promise.all([
                supabase.from('backlog_stories').select('data, display_order')
                    .eq('user_id', userId).eq('instance_id', instanceId),
                supabase.from('epic_predictions').select('*')
                    .eq('user_id', userId).eq('instance_id', instanceId),
            ]);

            if (storiesRes.error) throw storiesRes.error;

            const epicMap = byEpic(storiesRes.data ?? []);
            const predMap = new Map((predsRes.data ?? []).map(p => [p.epic_key, p]));

            const result = [...epicMap.values()].map(epic => {
                const pred        = predMap.get(epic.epicKey);
                const isCompleted = epicComplete(epic.stories);
                const doneStories = epic.stories.filter(isDone).length;

                return {
                    epicKey:         epic.epicKey,
                    epicName:        epic.epicName,
                    isCompleted,
                    totalStories:    epic.stories.length,
                    doneStories,
                    progressPct:     Math.round((doneStories / Math.max(epic.stories.length, 1)) * 100),
                    phase:           isCompleted ? 'completed' : detectPhase(epic.stories),

                    // Effective values: override wins, then AI, then null
                    tshirtSize:      pred?.tshirt_override ?? pred?.tshirt_size    ?? null,
                    epicType:        pred?.type_override   ?? pred?.epic_type      ?? null,
                    rationale:       pred?.rationale       ?? null,

                    // Override metadata
                    hasOverride:     !!(pred?.tshirt_override || pred?.type_override),
                    overrideNote:    pred?.override_note   ?? null,

                    // Matching (active only)
                    confidenceLevel: pred?.confidence_level   ?? null,
                    matchedEpicKeys: pred?.matched_epic_keys  ?? [],
                    scopeProjection: pred?.scope_projection   ?? null,

                    // Cache state
                    isPredicted:     !!pred,
                    isStale:         pred ? pred.stories_hash !== storyHash(epic.stories) : true,
                    computedAt:      pred?.computed_at ?? null,
                };
            });

            res.json(result);
        } catch (err) {
            console.error('[epic-prediction/epics]', err);
            apiError(res, err);
        }
    });

    // ── PUT /api/epic-prediction/override/:epicKey ────────────────────────────
    // PM saves an override for a specific epic.
    // Body: { tshirt_size?, epic_type?, note? }
    // Override always wins over AI. Pass null to clear an override field.
    router.put('/override/:epicKey', async (req, res) => {
        try {
            const userId     = req.userId;
            const instanceId = req.instanceId;
            const epicKey    = decodeURIComponent(req.params.epicKey);
            const { tshirt_size, epic_type, note, additionalStories } = req.body ?? {};

            if (tshirt_size  !== undefined && tshirt_size  !== null && !TSHIRT_SIZES.includes(tshirt_size))
                return res.status(400).json({ error: `Invalid tshirt_size. Use: ${TSHIRT_SIZES.join(', ')}` });
            if (epic_type !== undefined && epic_type !== null && !EPIC_TYPES.includes(epic_type))
                return res.status(400).json({ error: `Invalid epic_type. Use: ${EPIC_TYPES.join(', ')}` });

            // Load epic name from stories
            const { data: rows } = await supabase
                .from('backlog_stories').select('data')
                .eq('user_id', userId).eq('instance_id', instanceId);
            const epicMap  = byEpic(rows ?? []);
            const epic     = epicMap.get(epicKey);
            const epicName = epic?.epicName ?? epicKey;

            // Load existing scope_projection so we only patch additionalStories into it
            const { data: existing } = await supabase
                .from('epic_predictions')
                .select('scope_projection')
                .eq('user_id', userId).eq('instance_id', instanceId).eq('epic_key', epicKey)
                .maybeSingle();

            let scopeProjectionPatch = undefined;
            if (additionalStories !== undefined) {
                const base = existing?.scope_projection ?? {};
                scopeProjectionPatch = { ...base, additionalStories };
            }

            const patch = {
                user_id:          userId,
                instance_id:      instanceId,
                epic_key:         epicKey,
                epic_name:        epicName,
                tshirt_override:  tshirt_size !== undefined ? tshirt_size : undefined,
                type_override:    epic_type   !== undefined ? epic_type   : undefined,
                override_note:    note        !== undefined ? note        : undefined,
                overridden_at:    new Date().toISOString(),
                scope_projection: scopeProjectionPatch,
            };
            // Remove undefined keys so we don't accidentally null out other fields
            Object.keys(patch).forEach(k => patch[k] === undefined && delete patch[k]);

            const { error } = await supabase
                .from('epic_predictions')
                .upsert(patch, { onConflict: 'user_id,instance_id,epic_key' });
            if (error) throw error;

            res.json({ ok: true, epicKey, patch });
        } catch (err) {
            console.error('[epic-prediction/override]', err);
            apiError(res, err);
        }
    });

    // ── GET /api/epic-prediction/summary ─────────────────────────────────────
    // Categorization stats for the Settings page.
    router.get('/summary', async (req, res) => {
        try {
            const userId     = req.userId;
            const instanceId = req.instanceId;

            const [storiesRes, predsRes] = await Promise.all([
                supabase.from('backlog_stories').select('data')
                    .eq('user_id', userId).eq('instance_id', instanceId),
                supabase.from('epic_predictions').select('*')
                    .eq('user_id', userId).eq('instance_id', instanceId),
            ]);

            const epicMap   = byEpic(storiesRes.data ?? []);
            const preds     = predsRes.data ?? [];
            const predMap   = new Map(preds.map(p => [p.epic_key, p]));

            const totalEpics     = epicMap.size;
            const completedEpics = [...epicMap.values()].filter(e => epicComplete(e.stories)).length;
            const activeEpics    = totalEpics - completedEpics;
            const predicted      = preds.length;
            const stale          = [...epicMap.values()].filter(e => {
                const p = predMap.get(e.epicKey);
                return p && p.stories_hash !== storyHash(e.stories);
            }).length;
            const withOverride   = preds.filter(p => p.tshirt_override || p.type_override).length;

            // Distribution by type
            const byType = {};
            for (const p of preds) {
                const t = p.type_override ?? p.epic_type ?? 'unknown';
                byType[t] = (byType[t] || 0) + 1;
            }

            // Distribution by size
            const bySize = {};
            for (const p of preds) {
                const s = p.tshirt_override ?? p.tshirt_size ?? 'unknown';
                bySize[s] = (bySize[s] || 0) + 1;
            }

            // Confidence distribution (active epics only)
            const byConfidence = {};
            for (const p of preds) {
                const epic = epicMap.get(p.epic_key);
                if (!epic || epicComplete(epic.stories)) continue;
                const c = p.confidence_level ?? 'not_analyzed';
                byConfidence[c] = (byConfidence[c] || 0) + 1;
            }

            const lastComputed = preds.reduce((latest, p) => {
                return !latest || p.computed_at > latest ? p.computed_at : latest;
            }, null);

            res.json({
                totalEpics, completedEpics, activeEpics,
                predicted, stale, withOverride,
                byType, bySize, byConfidence,
                lastComputed,
            });
        } catch (err) {
            console.error('[epic-prediction/summary]', err);
            apiError(res, err);
        }
    });

    return router;
};

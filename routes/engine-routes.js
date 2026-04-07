'use strict';
/**
 * routes/engine-routes.js
 * Predictive Engine — Reality Factor + Scope Creep Kinetics
 *
 * GET /api/engine/analysis         full output: realityFactor + projections + retrospective
 * GET /api/engine/reality-factor   lightweight: historical performance baseline only
 * GET /api/engine/predict/:epicKey scope prediction for a specific active epic
 *
 * All computation is local (no Claude API calls).
 * Sprint numbers are used as the temporal axis (proxy for calendar time).
 */

const { Router } = require('express');
const { apiError } = require('../utils/api-error');
const { isDone, TSHIRT_RANGES, durationToTshirt, sprintNumFromName } = require('../utils/story-constants');

// ─── Constants ─────────────────────────────────────────────────────────────────
const SEGMENTS = 10; // inflation curve resolution (each segment = 10% of epic duration)

// ─── Pure helpers ──────────────────────────────────────────────────────────────

/**
 * Sprint numeric index for ordering.
 * Prefers sprintId (Jira numeric), falls back to trailing number in sprint name.
 */
function sprintIdx(story) {
    const id = Number(story.data?.sprintId);
    if (!isNaN(id) && id > 0) return id;
    return sprintNumFromName(story.data?.sprintName);
}

/** Confidence score 0–1 based on sample count */
function confidence(n) {
    if (n === 0) return 0;
    if (n === 1) return 0.25;
    if (n < 5)  return 0.25 + (n - 1) * 0.10;
    return Math.min(0.95, 0.65 + (n - 5) * 0.03);
}

/**
 * Build 10-segment cumulative ratio curve for a single epic.
 * sprintIndices : all story sprint indices (including future/backlog estimated in range)
 * minS / maxS   : epic's sprint range
 */
function buildEpicCurve(sprintIndices, minS, maxS) {
    const range = maxS - minS;
    const total = sprintIndices.length;
    if (range === 0 || total === 0) return Array(SEGMENTS).fill(1.0);
    return Array.from({ length: SEGMENTS }, (_, i) => {
        const threshold = minS + (range * (i + 1)) / SEGMENTS;
        return sprintIndices.filter(v => v <= threshold).length / total;
    });
}

/**
 * Average multiple epic curves.
 * Returns { avg: number[10], std: number[10] }
 */
function avgCurves(curves) {
    if (!curves.length) return null;
    const avg = Array(SEGMENTS).fill(0);
    const std = Array(SEGMENTS).fill(0);
    for (let i = 0; i < SEGMENTS; i++) {
        const vals = curves.map(c => c[i]);
        avg[i] = vals.reduce((a, b) => a + b, 0) / vals.length;
        const mean = avg[i];
        std[i] = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length);
    }
    return { avg, std };
}

/** Load all backlog_stories rows for an instance */
async function loadStories(supabase, userId, instanceId) {
    const { data, error } = await supabase
        .from('backlog_stories')
        .select('data, created_at, display_order')
        .eq('user_id', userId)
        .eq('instance_id', instanceId)
        .order('display_order', { ascending: true });
    if (error) throw error;
    return data ?? [];
}

/**
 * Group story rows by epic key.
 * Returns Map<epicKey, { epicKey, epicName, stories[] }>
 */
function byEpic(stories) {
    const map = new Map();
    for (const s of stories) {
        const key  = s.data?.epicKey ?? s.data?.epicName ?? null;
        if (!key) continue;
        const name = s.data?.epicName ?? key;
        if (!map.has(key)) map.set(key, { epicKey: key, epicName: name, stories: [] });
        map.get(key).stories.push(s);
    }
    return map;
}

/** True if an epic is effectively complete (≥90% stories done, no active sprint work) */
function epicComplete(stories) {
    if (!stories.length) return false;
    const donePct   = stories.filter(isDone).length / stories.length;
    const hasActive = stories.some(s => (s.data?.sprintState ?? '').toLowerCase() === 'active');
    return donePct >= 0.9 && !hasActive;
}

// ─── Historical analysis ────────────────────────────────────────────────────────

/**
 * Analyze all completed epics to derive:
 *   realityFactor  — aggregate performance baseline
 *   inflationCurve — 10-segment scope growth curve (with _raw for internal reuse)
 *   retrospective  — per-epic post-mortem data
 */
function analyzeHistory(epicMap) {
    const samples = [];
    const retro   = [];

    for (const [, epic] of epicMap) {
        const { stories, epicKey, epicName } = epic;
        if (!epicComplete(stories)) continue;

        const allIdx = stories.map(sprintIdx).filter(v => v !== null);
        if (!allIdx.length) continue;

        const minS = Math.min(...allIdx);
        const maxS = Math.max(...allIdx);

        // Initial cohort: stories present in the first 10% of the sprint range
        const initThreshold = minS + Math.max(1, (maxS - minS) * 0.10);
        const initCount     = allIdx.filter(v => v <= initThreshold).length;
        const finalCount    = stories.length;
        const scopeInflation = initCount > 0 ? (finalCount - initCount) / initCount : 0;

        // Friction: share of sprint slots that had no story completions (stagnation proxy)
        const doneIdx        = stories.filter(isDone).map(sprintIdx).filter(v => v !== null);
        const durationSprints = maxS - minS + 1;
        const sprintsWithDone = new Set(doneIdx).size;
        const frictionRate   = durationSprints > 1
            ? Math.max(0, 1 - sprintsWithDone / durationSprints)
            : 0;

        const curve = buildEpicCurve(allIdx, minS, maxS);
        samples.push({ scopeInflation, durationSprints, frictionRate, curve });

        // Temporal inflation map: story count at each 10% lifecycle mark.
        // Use ordinal rank of unique sprints (not raw numbers) so gaps between
        // sprint IDs don't compress all stories into the last segment.
        const uniqueSprints = [...new Set(allIdx)].sort((a, b) => a - b);
        const sprintRank    = new Map(uniqueSprints.map((s, i) => [s, i]));
        const nSprints      = uniqueSprints.length;
        const temporalMap   = {};
        for (let seg = 1; seg <= SEGMENTS; seg++) {
            const thr = seg / SEGMENTS; // 0.1 … 1.0
            temporalMap[`${seg * 10}%`] = allIdx.filter(v => {
                const rank = sprintRank.get(v) ?? 0;
                const pct  = nSprints > 1 ? rank / (nSprints - 1) : 0;
                return pct <= thr;
            }).length;
        }

        const totalPts = stories.reduce((a, s) => a + (Number(s.data?.importedEffort) || 0), 0);
        const donePts  = stories.filter(isDone).reduce((a, s) => a + (Number(s.data?.importedEffort) || 0), 0);

        retro.push({
            epicKey,
            epicName,
            initialEstimate:     initCount,
            finalCount,
            scopeCreepPct:       Math.round(scopeInflation * 100),
            durationSprints,
            frictionRate:        Math.round(frictionRate * 100) / 100,
            totalPoints:         totalPts,
            completedPoints:     donePts,
            completionRate:      Math.round((donePts / Math.max(totalPts, 1)) * 100),
            temporalInflationMap: temporalMap,
        });
    }

    if (!samples.length) {
        return { realityFactor: null, inflationCurve: null, retrospective: retro };
    }

    const n           = samples.length;
    const avgScope    = samples.reduce((a, e) => a + e.scopeInflation,  0) / n;
    const avgFriction = samples.reduce((a, e) => a + e.frictionRate,    0) / n;
    const avgDuration = samples.reduce((a, e) => a + e.durationSprints, 0) / n;

    const raw = avgCurves(samples.map(e => e.curve));

    // Peak inflation: segment with the highest marginal story addition rate
    const peakSeg = raw.avg.reduce((best, _, i, arr) => {
        const delta     = i > 0 ? arr[i] - arr[i - 1] : arr[0];
        const bestDelta = best > 0 ? arr[best] - arr[best - 1] : arr[0];
        return delta > bestDelta ? i : best;
    }, 0);

    // Per-T-shirt-size breakdown
    const sizeGroups = Object.fromEntries(TSHIRT_RANGES.map(([sz]) => [sz, []]));
    for (const s of samples) sizeGroups[durationToTshirt(s.durationSprints)].push(s);

    const inflationBySize = {};
    for (const [size] of TSHIRT_RANGES) {
        const group = sizeGroups[size];
        if (!group.length) continue;
        const gc      = avgCurves(group.map(g => g.curve));
        const peakSz  = gc.avg.reduce((best, _, i, arr) => {
            const delta = i > 0 ? arr[i] - arr[i - 1] : arr[0];
            const bDelta = best > 0 ? arr[best] - arr[best - 1] : arr[0];
            return delta > bDelta ? i : best;
        }, 0);
        inflationBySize[size] = {
            count:              group.length,
            avgDurationSprints: Math.round((group.reduce((a, g) => a + g.durationSprints, 0) / group.length) * 10) / 10,
            avgInflationRate:   Math.round((group.reduce((a, g) => a + g.scopeInflation,  0) / group.length) * 1000) / 1000,
            segments: gc.avg.map((v, i) => ({
                mark:            `${(i + 1) * 10}%`,
                cumulativeRatio: Math.round(v * 1000) / 1000,
            })),
            peakInflationAt: `${(peakSz + 1) * 10}%`,
            _raw: gc,
        };
    }

    return {
        realityFactor: {
            avgDurationSprints: Math.round(avgDuration * 10) / 10,
            scopeInflationRate: Math.round(avgScope    * 1000) / 1000,
            frictionRate:       Math.round(avgFriction * 1000) / 1000,
            confidence:         confidence(n),
            basedOn:            n,
        },
        inflationCurve: {
            segments: raw.avg.map((v, i) => ({
                mark:            `${(i + 1) * 10}%`,
                cumulativeRatio: Math.round(v         * 1000) / 1000,
                stdDev:          Math.round(raw.std[i] * 1000) / 1000,
            })),
            peakInflationAt: `${(peakSeg + 1) * 10}%`,
            _raw: raw, // internal use only — stripped before API response
        },
        inflationBySize,
        retrospective: retro,
    };
}

// ─── Scope prediction ──────────────────────────────────────────────────────────

/**
 * predictRemainingScope(stories, rawCurve, currentSprint)
 *
 * Locates the epic's current position on the historical inflation curve and
 * projects how many additional stories are likely to be added before completion.
 *
 * Returns:
 *   predictedTotal     — expected final story count
 *   additionalStories  — stories not yet created that history predicts will appear
 *   inflationCoeff     — multiplier applied to current scope (1.0 = no growth expected)
 *   progressPct        — current position in epic lifecycle (0–100)
 */
function predictRemainingScope(stories, rawCurve) {
    if (!rawCurve) {
        return { predictedTotal: stories.length, additionalStories: 0, inflationCoeff: 1.0, progressPct: 0 };
    }

    // Use story completion % as lifecycle position — sprint numbers are unreliable
    // when sprints aren't pre-created in Jira (maxSprint = currentSprint → progress always ≈ 1.0)
    const doneCount = stories.filter(isDone).length;
    const progress  = stories.length > 0 ? doneCount / stories.length : 0;
    const segIdx    = Math.min(SEGMENTS - 1, Math.floor(progress * SEGMENTS));

    const curRatio   = rawCurve.avg[segIdx];
    const finalRatio = rawCurve.avg[SEGMENTS - 1]; // ≈ 1.0 by construction

    if (curRatio <= 0) {
        return { predictedTotal: stories.length, additionalStories: 0, inflationCoeff: 1.0, progressPct: Math.round(progress * 100) };
    }

    const coeff          = finalRatio / curRatio;
    const predictedTotal = Math.round(stories.length * coeff);
    const additional     = Math.max(0, predictedTotal - stories.length);

    return {
        predictedTotal,
        additionalStories: additional,
        inflationCoeff:    Math.round(coeff * 100) / 100,
        progressPct:       Math.round(progress * 100),
    };
}

// ─── Scenario generation ───────────────────────────────────────────────────────

/**
 * Generate Optimistic / Realistic / Pessimistic projections for all active epics.
 * velocityData — from computeVelocity()
 * Priority rank (backlog order) determines velocity share: P1=48% … P4+=7%
 */
function generateProjections(epicMap, realityFactor, inflationCurve, velocityData) {
    const { avgStoriesPerSprint = 5, carryOverRate = 0.15, newFeaturePct = 0.70 } = velocityData;
    const effectiveVelocity = Math.max(1, avgStoriesPerSprint * (1 - carryOverRate) * newFeaturePct);
    const rawCurve          = inflationCurve?._raw ?? null;
    const vShares           = [0.48, 0.29, 0.16, 0.07];

    const activeEpics = [...epicMap.values()].filter(e => !epicComplete(e.stories) && e.stories.length > 0);

    return activeEpics.map((epic, rank) => {
        const { stories, epicKey, epicName } = epic;
        const remaining = stories.filter(s => !isDone(s));
        if (!remaining.length) return null;

        const scopePred = stories.length > 0
            ? predictRemainingScope(stories, rawCurve)
            : { predictedTotal: stories.length, additionalStories: 0, inflationCoeff: 1.0, progressPct: 0 };

        const friction   = realityFactor?.frictionRate ?? 0.10;
        const vShare     = vShares[Math.min(rank, vShares.length - 1)];
        const v          = effectiveVelocity * vShare;
        const base       = remaining.length;

        // Optimistic: minimal creep (5%), full velocity allocation
        const optimisticSprints  = Math.ceil((base * 1.05) / Math.max(v * 1.15, 0.5));

        // Realistic: predicted inflation + historical friction multiplier
        const realisticScope   = base + scopePred.additionalStories;
        const realisticSprints = Math.ceil((realisticScope * (1 + friction)) / Math.max(v, 0.5));

        // Pessimistic: 1.5× inflation, -20% velocity, amplified friction (worst 12-month proxy)
        const pessimisticScope   = base * Math.max(scopePred.inflationCoeff * 1.30, 1.5);
        const pessimisticSprints = Math.ceil((pessimisticScope * (1 + friction * 1.5)) / Math.max(v * 0.8, 0.5));

        const dataConf = realityFactor?.confidence ?? 0.20;
        const spread   = optimisticSprints > 0 ? pessimisticSprints / optimisticSprints : 3;
        const conf     = Math.max(0.10, Math.min(0.95, dataConf - Math.min(0.40, (spread - 1) * 0.08)));

        const pts = s => Number(s.data?.importedEffort ?? s.data?.storyPoints ?? s.data?.story_points) || 0;
        const currentStoryPoints   = stories.reduce((a, s) => a + pts(s), 0);
const avgPtsPerStory       = stories.length > 0 ? currentStoryPoints / stories.length : 0;
        const estimatedStoryPoints = Math.round(currentStoryPoints + scopePred.additionalStories * avgPtsPerStory);

        return {
            epicKey,
            epicName,
            totalStories:          stories.length,
            doneStories:           stories.filter(isDone).length,
            remainingStories:      base,
            estimatedStories:      stories.length + scopePred.additionalStories,
            currentStoryPoints,
            estimatedStoryPoints,
            progressPct:      Math.round((stories.filter(isDone).length / stories.length) * 100),
            scopePrediction: {
                additionalStories:  scopePred.additionalStories,
                inflationCoeff:     scopePred.inflationCoeff,
                currentPositionPct: scopePred.progressPct,
            },
            optimistic:  { sprintsRemaining: optimisticSprints  },
            realistic:   { sprintsRemaining: realisticSprints   },
            pessimistic: { sprintsRemaining: pessimisticSprints },
            confidence:  Math.round(conf * 100) / 100,
        };
    }).filter(Boolean);
}

// ─── Inline velocity (no cross-module dependency) ──────────────────────────────

/**
 * Derive velocity snapshot from story data.
 * Uses last 6 closed sprints; returns safe defaults when insufficient history.
 */
function computeVelocity(stories) {
    const doneBySprintMap = new Map();
    for (const s of stories) {
        if (!isDone(s)) continue;
        const idx = sprintIdx(s);
        if (idx === null) continue;
        doneBySprintMap.set(idx, (doneBySprintMap.get(idx) || 0) + 1);
    }

    if (!doneBySprintMap.size) {
        return { avgStoriesPerSprint: 5, carryOverRate: 0.15, newFeaturePct: 0.70 };
    }

    const sorted  = [...doneBySprintMap.entries()].sort((a, b) => a[0] - b[0]);
    const recentN = sorted.slice(-6);
    const avg     = recentN.reduce((a, [, c]) => a + c, 0) / recentN.length;

    // Carry-over proxy: fraction of sprints where output was <70% of average
    const belowAvg  = recentN.filter(([, c]) => c < avg * 0.70).length;
    const carryOver = Math.round((belowAvg / recentN.length) * 100) / 100;

    return {
        avgStoriesPerSprint: Math.round(avg * 10) / 10,
        carryOverRate:       carryOver,
        newFeaturePct:       0.70,
    };
}

// ─── Router factory ────────────────────────────────────────────────────────────

module.exports = function engineRoutes(supabase) {
    const router = Router();

    // ── GET /api/engine/analysis ───────────────────────────────────────────────
    // Full engine output: reality factor + inflation curve + projections + retrospective
    router.get('/analysis', async (req, res) => {
        try {
            const userId     = req.userId;
            const instanceId = req.instanceId;

            const stories = await loadStories(supabase, userId, instanceId);
            if (!stories.length) {
                return res.json({
                    realityFactor: null, inflationCurve: null,
                    projections: [], retrospective: [], velocitySnapshot: null,
                    meta: { totalEpics: 0, completedEpics: 0, activeEpics: 0, analysisTs: new Date().toISOString() },
                });
            }

            const epicMap  = byEpic(stories);
            const history  = analyzeHistory(epicMap);
            const velocity = computeVelocity(stories);
            const projections = generateProjections(epicMap, history.realityFactor, history.inflationCurve, velocity);

            // Strip internal _raw before sending
            const curveOut = history.inflationCurve
                ? { segments: history.inflationCurve.segments, peakInflationAt: history.inflationCurve.peakInflationAt }
                : null;

            const sizeOut = history.inflationBySize
                ? Object.fromEntries(
                    Object.entries(history.inflationBySize).map(([sz, v]) => {
                        const { _raw, ...rest } = v;
                        return [sz, rest];
                    })
                )
                : null;

            res.json({
                realityFactor:    history.realityFactor,
                inflationCurve:   curveOut,
                inflationBySize:  sizeOut,
                projections,
                retrospective:    history.retrospective,
                velocitySnapshot: velocity,
                meta: {
                    totalEpics:     epicMap.size,
                    completedEpics: history.retrospective.length,
                    activeEpics:    projections.length,
                    analysisTs:     new Date().toISOString(),
                },
            });
        } catch (err) {
            apiError(res, err, 'engine/analysis');
        }
    });

    // ── GET /api/engine/reality-factor ────────────────────────────────────────
    // Lightweight: historical baseline only (no projection computation)
    router.get('/reality-factor', async (req, res) => {
        try {
            const stories = await loadStories(supabase, req.userId, req.instanceId);
            const epicMap = byEpic(stories);
            const { realityFactor, retrospective } = analyzeHistory(epicMap);
            res.json({ realityFactor, completedEpicsAnalyzed: retrospective.length });
        } catch (err) {
            apiError(res, err, 'engine/reality-factor');
        }
    });

    // ── GET /api/engine/predict/:epicKey ──────────────────────────────────────
    // Scope prediction for a single active epic
    router.get('/predict/:epicKey', async (req, res) => {
        try {
            const userId     = req.userId;
            const instanceId = req.instanceId;
            const target     = decodeURIComponent(req.params.epicKey);

            const stories = await loadStories(supabase, userId, instanceId);
            const epicMap = byEpic(stories);
            const { realityFactor, inflationCurve } = analyzeHistory(epicMap);

            const epic = epicMap.get(target);
            if (!epic) return res.status(404).json({ error: 'Epic not found' });

            const { stories: epStories } = epic;
            const allIdx    = epStories.map(sprintIdx).filter(v => v !== null);
            const activeIdx = epStories
                .filter(s => (s.data?.sprintState ?? '').toLowerCase() === 'active')
                .map(sprintIdx).filter(v => v !== null);
            const currentSprint = activeIdx.length
                ? Math.max(...activeIdx)
                : allIdx.length ? Math.max(...allIdx) : null;

            if (currentSprint === null) {
                return res.status(422).json({ error: 'No sprint data available for this epic' });
            }

            const pred = predictRemainingScope(epStories, inflationCurve?._raw ?? null, currentSprint);

            res.json({
                epicKey:          target,
                epicName:         epic.epicName,
                currentStories:   epStories.length,
                doneStories:      epStories.filter(isDone).length,
                remainingStories: epStories.filter(s => !isDone(s)).length,
                prediction:       pred,
                realityFactor,
                confidence:       realityFactor?.confidence ?? 0.10,
            });
        } catch (err) {
            apiError(res, err, 'engine/predict');
        }
    });

    return router;
};

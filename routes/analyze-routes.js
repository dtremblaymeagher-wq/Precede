'use strict';
/**
 * routes/analyze-routes.js
 *
 * Decomposed /api/analyze/* routes (CLAUDE.md §7).
 * Each route is a focused Claude call — additive, monolith untouched.
 *
 * POST /api/analyze/signals      → trends + sentiment
 * POST /api/analyze/delta        → sprint delta
 * POST /api/analyze/longitudinal → silent signals, velocity, churn
 * POST /api/analyze/alignment    → OKR alignment + strategic gap
 */

const { Router } = require('express');
const { apiError } = require('../utils/api-error');
const { MODELS, callAI } = require('../shared/ai-client');
const prompts = require('../shared/prompts');
const {
    loadEntries,
    loadContext,
    loadSprintMemory,
    getSprintStats,
    loadHistoricalSnapshots,
    bucketByWeight,
    saveAnalysis,
    parseJSON,
} = require('../utils/analyze-helpers');

const router = Router();

// ── /api/analyze/signals ──────────────────────────────────────────────────────
router.post('/signals', async (req, res) => {
    try {
        const { userId, instanceId } = req;
        const entries  = await loadEntries(userId, instanceId);
        const context  = await loadContext(userId, instanceId);
        const { high, medium, background } = bucketByWeight(entries);

        const systemPrompt = prompts.buildSignalsPrompt({ context, high, medium, background });
        const raw = await callAI({
            model:      MODELS.sonnet,
            maxTokens:  2000,
            system:     systemPrompt,
            messages:   [{ role: 'user', content: 'Analyse and return JSON.' }],
            callType:   'signal_analysis',
            req,
        });

        const analysis = parseJSON(raw);
        const fileName = await saveAnalysis(userId, instanceId, 'signals', { analysis });

        res.json({ analysis, meta: { fileName, entryCount: entries.length } });
    } catch (e) {
        apiError(res, e, 'analyze/signals');
    }
});

// ── /api/analyze/delta ────────────────────────────────────────────────────────
router.post('/delta', async (req, res) => {
    try {
        const { userId, instanceId } = req;
        const entries      = await loadEntries(userId, instanceId);
        const context      = await loadContext(userId, instanceId);
        const sprintMemory = await loadSprintMemory(userId, instanceId);
        const { high, medium, background } = bucketByWeight(entries);

        const systemPrompt = prompts.buildDeltaPrompt({ context, high, medium, background, sprintMemory });
        const raw = await callAI({
            model:      MODELS.sonnet,
            maxTokens:  2000,
            system:     systemPrompt,
            messages:   [{ role: 'user', content: 'Compare and return JSON.' }],
            callType:   'delta_analysis',
            req,
        });

        const analysis = parseJSON(raw);

        // Persist updated sprint memory
        if (analysis.sprint_memory) {
            const supabase = require('../database/db');
            await supabase.from('radar_memory').upsert(
                { user_id: userId, instance_id: instanceId, data: analysis.sprint_memory },
                { onConflict: 'user_id,instance_id' }
            );
        }

        const fileName = await saveAnalysis(userId, instanceId, 'delta', { analysis });
        res.json({ analysis, meta: { fileName, memoryUsed: !!sprintMemory, entryCount: entries.length } });
    } catch (e) {
        apiError(res, e, 'analyze/delta');
    }
});

// ── /api/analyze/longitudinal ─────────────────────────────────────────────────
router.post('/longitudinal', async (req, res) => {
    try {
        const { userId, instanceId } = req;
        const entries              = await loadEntries(userId, instanceId);
        const context              = await loadContext(userId, instanceId);
        const sprintStats          = await getSprintStats(userId, instanceId);
        const historicalSnapshots  = await loadHistoricalSnapshots(userId, instanceId);
        const { high, medium, background } = bucketByWeight(entries);

        if (sprintStats.count < 4 || sprintStats.oldestDaysAgo < 50) {
            return res.json({
                analysis: { longitudinal: { status: 'insufficient_data', sprints_analyzed: sprintStats.count, period_analyzed: `${Math.round(sprintStats.oldestDaysAgo)} days` } },
                meta: { skipped: true, reason: 'Requires ≥ 4 sprints and ≥ 50 days of history' },
            });
        }

        const systemPrompt = prompts.buildLongitudinalPrompt({ context, high, medium, background, sprintStats, historicalSnapshots });
        const raw = await callAI({
            model:      MODELS.sonnet,
            maxTokens:  2500,
            system:     systemPrompt,
            messages:   [{ role: 'user', content: 'Perform longitudinal analysis and return JSON.' }],
            callType:   'longitudinal_analysis',
            req,
        });

        const analysis = parseJSON(raw);
        const fileName = await saveAnalysis(userId, instanceId, 'longitudinal', { analysis });

        res.json({ analysis, meta: { fileName, sprintStats, snapshotCount: historicalSnapshots.length } });
    } catch (e) {
        apiError(res, e, 'analyze/longitudinal');
    }
});

// ── /api/analyze/alignment ────────────────────────────────────────────────────
router.post('/alignment', async (req, res) => {
    try {
        const { userId, instanceId } = req;
        const entries  = await loadEntries(userId, instanceId);
        const context  = await loadContext(userId, instanceId);
        const { high, medium, background } = bucketByWeight(entries);

        if (!context.okrs?.length) {
            return res.status(400).json({ error: 'No OKRs defined. Add OKRs in Settings before running alignment analysis.' });
        }

        const systemPrompt = prompts.buildAlignmentPrompt({ context, high, medium, background });
        const raw = await callAI({
            model:      MODELS.sonnet,
            maxTokens:  2000,
            system:     systemPrompt,
            messages:   [{ role: 'user', content: 'Score OKR alignment and return JSON.' }],
            callType:   'okr_alignment',
            req,
        });

        const analysis = parseJSON(raw);
        const fileName = await saveAnalysis(userId, instanceId, 'alignment', { analysis });

        res.json({ analysis, meta: { fileName, okrCount: context.okrs.length, entryCount: entries.length } });
    } catch (e) {
        apiError(res, e, 'analyze/alignment');
    }
});

module.exports = router;

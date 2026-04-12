'use strict';
/**
 * routes/dashboard-routes.js
 *
 * POST /api/dashboard/untracked-demand — AI: hub signals with no backlog story (24h cache)
 * POST /api/dashboard/okr-coverage    — AI: OKR × sprint stories × hub signals (24h cache)
 *
 * Mounted at /api/dashboard.
 */

const { Router }         = require('express');
const { makeHelpers }    = require('../utils/db-helpers');
const { makeSprintUtils } = require('../utils/sprint-utils');
const { apiError }       = require('../utils/api-error');
const { MODELS, callAI } = require('../shared/ai-client');
const prompts            = require('../shared/prompts');

module.exports = function createDashboardRouter(supabase, { aiLimiter } = {}) {
    const router = Router();
    const { instanceSelect } = makeHelpers(supabase);
    const { getCurrentSprint } = makeSprintUtils(supabase);

    // ── POST /api/dashboard/untracked-demand ──────────────────────────────────

    router.post('/untracked-demand', aiLimiter, async (req, res) => {
        try {
            const userId = req.userId;

            // Load settings + entries in parallel (entries needed for fingerprint)
            const [settingsRes, hubRows, backlogRows] = await Promise.all([
                instanceSelect('settings', 'data', userId, req.instanceId).single(),
                instanceSelect('intelligence_entries', 'data', userId, req.instanceId),
                instanceSelect('backlog_stories', 'data', userId, req.instanceId),
            ]);

            const settingsRow = settingsRes.data;
            const entries     = (hubRows.data    || []).map(r => r.data);
            const stories     = (backlogRows.data || []).map(r => r.data);

            if (entries.length < 2) {
                return res.json({ results: [], computedAt: new Date().toISOString(), insufficient: true });
            }

            // Signal fingerprint: entry count + most-recent signal date
            // If identical to cached fingerprint → no new signals, return cache as-is
            const mostRecent  = entries.reduce((max, e) => {
                const d = e.date || e.createdAt || '';
                return d > max ? d : max;
            }, '');
            const fingerprint = `${entries.length}|${mostRecent}`;

            const cache = settingsRow?.data?.untrackedDemandCache;
            if (!req.body.force && cache?.signalFingerprint === fingerprint) {
                return res.json(cache);
            }

            // Build prompt context
            const signalsList = entries
                .sort((a, b) => new Date(b.date || b.createdAt || 0) - new Date(a.date || a.createdAt || 0))
                .slice(0, 120)
                .map((e, i) =>
                    `[${i}] (${e.sourceType || 'feedback'} · ${(e.date || '').slice(0, 10)}) ${(e.body || '').slice(0, 220)}`
                ).join('\n');

            const activeStories = stories.filter(s => s.status !== 'Done');
            const storiesList = activeStories.length
                ? activeStories.map(s =>
                    `- ${s.title}${s.contentText ? ': ' + s.contentText.slice(0, 120) : ''}`
                  ).join('\n')
                : 'No active stories in backlog yet.';

            const text = await callAI({
                model:     MODELS.sonnetV2,
                maxTokens: 2048,
                messages:  [{ role: 'user', content: prompts.buildUntrackedDemandPrompt({ signalsList, storiesList }) }],
                callType:  'untracked_demand',
                req,
            }) || '[]';
            const match = text.match(/\[[\s\S]*\]/);
            let results = [];
            try {
                results = match ? JSON.parse(match[0]) : [];
            } catch (parseErr) {
                console.error('❌ Untracked demand JSON parse error:', parseErr.message, '\nRaw:', text.slice(0, 300));
            }

            // Cache result with fingerprint
            const cachePayload = { results, computedAt: new Date().toISOString(), signalFingerprint: fingerprint };
            const merged = { ...(settingsRow?.data || {}), untrackedDemandCache: cachePayload };
            await supabase.from('settings').upsert(
                { user_id: userId, instance_id: req.instanceId, data: merged, updated_at: new Date().toISOString() },
                { onConflict: 'user_id,instance_id' }
            );

            res.json(cachePayload);
        } catch (e) {
            console.error('❌ Untracked demand:', e.message);
            apiError(res, e);
        }
    });

    // ── POST /api/dashboard/okr-coverage ─────────────────────────────────────

    router.post('/okr-coverage', aiLimiter, async (req, res) => {
        try {
            const userId = req.userId;

            // Load settings + normalize objectives
            const { data: settingsRow } = await instanceSelect('settings', 'data', userId, req.instanceId).single();

            const objectives = (settingsRow?.data?.objectives || [])
                .flatMap(o => o.split('|').map(s => s.trim()))
                .filter(Boolean);
            if (!objectives.length) {
                return res.json({ noObjectives: true, computedAt: new Date().toISOString() });
            }

            // Resolve sprint + fetch stories early (needed for cache fingerprint)
            const currentSprint      = await getCurrentSprint(userId, req.instanceId);
            const currentSprintStart = currentSprint?.start_date || null;
            const currentSprintEnd   = currentSprint?.end_date   || null;

            const [hubRows, backlogRows] = await Promise.all([
                instanceSelect('intelligence_entries', 'data', userId, req.instanceId),
                instanceSelect('backlog_stories', 'data', userId, req.instanceId),
            ]);

            const entries    = (hubRows.data    || []).map(r => r.data);
            const allStories = (backlogRows.data || []).map(r => r.data);

            const sprintStories = allStories.filter(s => {
                if (s.status === 'Done') return false;
                if (s.status === 'In Progress') return true;
                if (currentSprintStart && currentSprintEnd && s.updatedAt) {
                    const d = s.updatedAt.slice(0, 10);
                    return d >= currentSprintStart && d <= currentSprintEnd;
                }
                return false;
            });

            if (!sprintStories.length && entries.length < 2) {
                return res.json({ noData: true, computedAt: new Date().toISOString() });
            }

            const totalSprintPoints = sprintStories.reduce((sum, s) => sum + (s.importedEffort || 0), 0);

            // 24h cache (bust on shape, OKR count, or SP total change)
            const cache = settingsRow?.data?.okrCoverageCache;
            const cacheValid = cache?.computedAt
                && !req.body.force
                && cache.storyCoverage?.[0]?.sprintGoalAlignmentScore !== undefined
                && Array.isArray(cache.storyScores)
                && cache.storyCoverage?.length === objectives.length
                && (cache.storyScores.length === 0 || cache.storyScores[0]?.okrScores?.length === objectives.length)
                && cache.totalSprintPoints === totalSprintPoints
                && Array.isArray(cache.demandAlignment?.[0]?.signals);
            if (cacheValid) {
                const hoursOld = (Date.now() - new Date(cache.computedAt)) / 3_600_000;
                if (hoursOld < 24) return res.json(cache);
            }

            // Build prompt context
            const okrList = objectives.map((o, i) => `${i + 1}. ${o}`).join('\n');

            const sprintLabel = currentSprintStart
                ? `current sprint (${currentSprintStart} → ${currentSprintEnd})`
                : 'current sprint';

            const sprintGoal = currentSprint?.goal || null;

            const cappedStories = sprintStories.slice(0, 40);
            const storiesList = cappedStories.length
                ? cappedStories.map(s =>
                    `- [${s.status || 'To Do'}] ${s.title} (${s.importedEffort != null ? s.importedEffort + ' SP' : 'SP unknown'})${s.contentText ? ': ' + s.contentText.slice(0, 100) : ''}`
                  ).join('\n')
                : 'No stories in the current sprint.';

            const signalsList = entries
                .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))
                .slice(0, 100)
                .map(e => `(${e.sourceType || 'feedback'}) ${(e.body || '').slice(0, 180)}`)
                .join('\n');

            const text = await callAI({
                model:     MODELS.sonnetV2,
                maxTokens: 6000,
                messages:  [{ role: 'user', content: prompts.buildOkrCoveragePrompt({ okrList, sprintGoal, sprintLabel, storiesList, signalsList, totalSprintPoints, sprintStories }) }],
                callType:  'okr_coverage',
                req,
            }) || '{}';
            const match = text.match(/\{[\s\S]*\}/);
            let result = {};
            try {
                result = match ? JSON.parse(match[0]) : {};
            } catch (parseErr) {
                console.error('❌ OKR coverage JSON parse error:', parseErr.message, '\nRaw:', text.slice(0, 500));
                throw new Error('AI returned invalid JSON');
            }

            const payload = { ...result, totalSprintPoints, sprintGoal: sprintGoal || null, computedAt: new Date().toISOString() };

            // Cache result
            const merged = { ...(settingsRow?.data || {}), okrCoverageCache: payload };
            await supabase.from('settings').upsert(
                { user_id: userId, instance_id: req.instanceId, data: merged, updated_at: new Date().toISOString() },
                { onConflict: 'user_id,instance_id' }
            );

            res.json(payload);
        } catch (e) {
            console.error('❌ OKR coverage:', e.message);
            apiError(res, e);
        }
    });

    return router;
};

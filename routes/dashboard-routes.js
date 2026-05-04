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
const { randomUUID }     = require('crypto');
const { makeHelpers }    = require('../utils/db-helpers');
const { makeSprintUtils } = require('../utils/sprint-utils');
const { apiError }       = require('../utils/api-error');
const { MODELS, callAI, fetchBatch, fetchBatchResults } = require('../shared/ai-client');
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

            // Build set of signal IDs already actioned (non-Done story exists for them)
            // Used to filter out items the PM has already started working on
            const actionedSignalIds = new Set(
                stories.flatMap(s => {
                    const status = (s.status ?? '').toLowerCase();
                    if (status === 'done' || status === 'closed') return [];
                    return s.precede_origin?.signal_ids ?? [];
                })
            );
            const filterActioned = results =>
                actionedSignalIds.size === 0
                    ? results
                    : results.filter(item => {
                        const ids = item.source_ids;
                        if (!Array.isArray(ids) || !ids.length) return true; // no source_ids → keep
                        return !ids.some(id => actionedSignalIds.has(id));
                    });

            // Fingerprint: entry count + most-recent entry date + active story count
            const mostRecent  = entries.reduce((max, e) => {
                const d = e.date || e.createdAt || '';
                return d > max ? d : max;
            }, '');
            const activeCount = stories.filter(s => {
                const st = (s.status ?? '').toLowerCase();
                return st !== 'done' && st !== 'closed';
            }).length;
            const fingerprint = `${entries.length}|${mostRecent}|${activeCount}`;

            const cache = settingsRow?.data?.untrackedDemandCache;

            // cacheOnly: return cache immediately, never trigger AI
            if (req.body.cacheOnly) {
                if (cache) return res.json({ ...cache, results: filterActioned(cache.results ?? []) });
                return res.json({ results: [], computedAt: null });
            }

            if (!req.body.force && cache?.signalFingerprint === fingerprint) {
                return res.json({ ...cache, results: filterActioned(cache.results ?? []) });
            }

            // Build prompt context
            const signalsList = entries
                .sort((a, b) => new Date(b.date || b.createdAt || 0) - new Date(a.date || a.createdAt || 0))
                .slice(0, 80)
                .map((e, i) =>
                    `[id:${e.id ?? i}] (${e.sourceType || 'feedback'} · ${(e.date || '').slice(0, 10)}) ${(e.body || '').slice(0, 150)}`
                ).join('\n');

            const activeStories = stories.filter(s => s.status !== 'Done');
            const storiesList = activeStories.length
                ? activeStories.map(s =>
                    `- ${s.title}${s.contentText ? ': ' + s.contentText.slice(0, 120) : ''}`
                  ).join('\n')
                : 'No active stories in backlog yet.';

            const text = await callAI({
                model:     MODELS.haiku,
                maxTokens: 4096,
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

            // Build olderResults: items from previous analysis no longer current and not actioned
            const prevResults  = cache?.results      ?? [];
            const prevOlder    = cache?.olderResults  ?? [];
            const newTopics    = new Set(results.map(r => (r.topic || '').toLowerCase().trim()));
            const disappeared  = prevResults.filter(item => {
                if (newTopics.has((item.topic || '').toLowerCase().trim())) return false;
                const ids = item.source_ids;
                if (Array.isArray(ids) && ids.length && ids.some(id => actionedSignalIds.has(id))) return false;
                return true;
            });
            const seenTopics   = new Set();
            const olderResults = [...disappeared, ...prevOlder].filter(item => {
                const key = (item.topic || '').toLowerCase().trim();
                if (seenTopics.has(key)) return false;
                seenTopics.add(key);
                return true;
            }).slice(0, 20);

            // Cache full unfiltered results — filter is applied dynamically on read
            const cachePayload = { results, olderResults, computedAt: new Date().toISOString(), signalFingerprint: fingerprint };
            const merged = { ...(settingsRow?.data || {}), untrackedDemandCache: cachePayload };
            await supabase.from('settings').upsert(
                { user_id: userId, instance_id: req.instanceId, data: merged, updated_at: new Date().toISOString() },
                { onConflict: 'user_id,instance_id' }
            );

            res.json({ ...cachePayload, results: filterActioned(results) });
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

    // ── GET /api/dashboard/lead-time ─────────────────────────────────────────
    // Monthly response lead time for the current instance (last 3 months).
    // No AI call — pure DB read + computation.

    router.get('/lead-time', async (req, res) => {
        try {
            const userId = req.userId;
            const [backlogRes, hubRes] = await Promise.all([
                instanceSelect('backlog_stories', 'data', userId, req.instanceId),
                instanceSelect('intelligence_entries', 'data', userId, req.instanceId),
            ]);
            const stories = (backlogRes.data || []).map(r => r.data);
            const entries = (hubRes.data    || []).map(r => r.data);

            const avg = arr => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null;
            const now = new Date();

            const monthly = Array.from({ length: 3 }, (_, i) => {
                const d     = new Date(now.getFullYear(), now.getMonth() - (2 - i), 1);
                const year  = d.getFullYear();
                const month = d.getMonth();
                const label = d.toLocaleString('en-US', { month: 'short', year: 'numeric' });
                const times = stories
                    .filter(s => {
                        const resolvedAt = s.precede_origin?.resolved_at ?? s.resolvedAt ?? null;
                        if (!resolvedAt || s.precede_origin?.lead_time_days == null) return false;
                        const rd = new Date(resolvedAt);
                        return rd.getFullYear() === year && rd.getMonth() === month;
                    })
                    .map(s => s.precede_origin.lead_time_days);
                return { label, avg_lead_time: avg(times), count: times.length };
            });

            const allTraced = stories
                .filter(s => s.precede_origin?.lead_time_days != null)
                .map(s => s.precede_origin.lead_time_days);

            // Build signal index by data.id for drilldown enrichment
            const signalIndex = Object.fromEntries(
                entries.filter(e => e.id != null).map(e => [e.id, e])
            );

            // Build story_pairs for drilldown (traced stories only, no cap — PM's own instance)
            const story_pairs = stories
                .filter(s => s.precede_origin?.lead_time_days != null)
                .map(s => {
                    const origin  = s.precede_origin;
                    const signals = (origin.signal_ids ?? [])
                        .map(id => signalIndex[id])
                        .filter(Boolean)
                        .map(sig => ({
                            body:       sig.body ?? '',
                            date:       sig.date ?? null,
                            sourceType: sig.sourceType ?? 'Signal',
                        }));
                    return {
                        title:          s.title ?? '',
                        externalId:     s.externalId ?? null,
                        lead_time_days: origin.lead_time_days,
                        resolved_at:    origin.resolved_at ?? s.resolvedAt ?? null,
                        signals,
                    };
                });

            res.json({ monthly, avg_traced_lead_time: avg(allTraced), traced_count: allTraced.length, story_pairs });
        } catch (e) {
            console.error('❌ Lead time:', e.message);
            apiError(res, e);
        }
    });

    // ── POST /api/dashboard/refresh-signal-links ──────────────────────────────
    // Re-submits a signal-link batch against ALL current backlog stories
    // (not just new ones from sync) and the current untracked demand cache.
    // Called when the user manually refreshes the Untracked Demand widget.

    router.post('/refresh-signal-links', async (req, res) => {
        try {
            const userId = req.userId;

            const [settingsRes, backlogRes] = await Promise.all([
                instanceSelect('settings', 'data', userId, req.instanceId).single(),
                instanceSelect('backlog_stories', 'data', userId, req.instanceId),
            ]);
            const settings = settingsRes.data?.data || {};
            const cache    = settings.untrackedDemandCache || {};

            const untrackedItems = [...(cache.results || []), ...(cache.olderResults || [])];
            if (!untrackedItems.length) return res.json({ proposals: [], skipped: true });

            const allStoryRows = backlogRes.data || [];
            const stories = allStoryRows
                .filter(r => r.data?.title && r.data?.status !== 'Done' && r.data?.status !== 'Closed')
                .slice(0, 30)
                .map(r => ({
                    id:          r.data.externalId || (r.filename ? r.filename.replace('.json', '') : r.data.id),
                    title:       r.data.title,
                    contentText: r.data.contentText || '',
                }));
            if (!stories.length) return res.json({ proposals: [], skipped: true });

            const text  = await callAI({
                model:    MODELS.haiku,
                maxTokens: 1024,
                messages: [{ role: 'user', content: prompts.buildSuggestLinksPrompt({ stories, untrackedItems }) }],
                callType: 'signal_link_refresh',
                req,
            }) || '[]';
            const match = text.match(/\[[\s\S]*\]/);
            let raw = [];
            try { raw = match ? JSON.parse(match[0]) : []; } catch (_) {}

            const dismissed = settings.dismissedSignalLinks || [];
            const proposals = raw
                .filter(p => !dismissed.some(d => d.storyId === p.storyId && d.topic === p.topic))
                .map(p => ({ ...p, id: randomUUID(), dismissed: false, confirmedAt: null }));

            const merged = { ...settings, signalLinkProposals: proposals };
            await supabase.from('settings').upsert(
                { user_id: userId, instance_id: req.instanceId, data: merged, updated_at: new Date().toISOString() },
                { onConflict: 'user_id,instance_id' }
            );

            res.json({ proposals });
        } catch (e) {
            console.error('❌ Refresh signal links:', e.message);
            apiError(res, e);
        }
    });

    // ── GET /api/dashboard/signal-link-proposals ──────────────────────────────
    // Polls pending Anthropic batch (if any), resolves proposals, returns active ones.

    router.get('/signal-link-proposals', async (req, res) => {
        try {
            const userId = req.userId;
            const { data: settingsRow } = await instanceSelect('settings', 'data', userId, req.instanceId).single();
            const settings = settingsRow?.data || {};

            const batchId  = settings.pendingSignalLinksBatchId;
            let proposals  = settings.signalLinkProposals || [];

            if (batchId) {
                try {
                    const batch = await fetchBatch(batchId);
                    if (batch.processing_status === 'ended') {
                        const lines = await fetchBatchResults(batchId);
                        const first = lines[0];
                        if (first?.result?.type === 'message') {
                            const text  = first.result.message.content?.[0]?.text || '[]';
                            const match = text.match(/\[[\s\S]*\]/);
                            const raw   = match ? JSON.parse(match[0]) : [];
                            const dismissed = settings.dismissedSignalLinks || [];
                            proposals   = raw
                                .filter(p => !dismissed.some(d => d.storyId === p.storyId && d.topic === p.topic))
                                .map(p => ({ ...p, id: randomUUID(), dismissed: false, confirmedAt: null }));
                        }
                        const merged = { ...settings, pendingSignalLinksBatchId: null, signalLinkProposals: proposals };
                        await supabase.from('settings').upsert(
                            { user_id: userId, instance_id: req.instanceId, data: merged, updated_at: new Date().toISOString() },
                            { onConflict: 'user_id,instance_id' }
                        );
                    }
                } catch (batchErr) {
                    console.warn('⚠️ Signal link batch poll (non-fatal):', batchErr.message);
                }
            }

            const active = proposals.filter(p => !p.dismissed && !p.confirmedAt);
            res.json({ proposals: active, hasPending: !!batchId });
        } catch (e) {
            console.error('❌ Signal link proposals:', e.message);
            apiError(res, e);
        }
    });

    // ── POST /api/dashboard/confirm-signal-link ───────────────────────────────
    // Links a story to untracked demand topic by populating precede_origin.signal_ids.

    router.post('/confirm-signal-link', async (req, res) => {
        try {
            const { proposalId, storyId, topic } = req.body;
            if (!proposalId || !storyId) return res.status(400).json({ error: 'proposalId and storyId required' });

            const userId = req.userId;
            const { data: settingsRow } = await instanceSelect('settings', 'data', userId, req.instanceId).single();
            const settings = settingsRow?.data || {};

            // Resolve signal IDs from the matched untracked topic (current + older results)
            const cache          = settings.untrackedDemandCache || {};
            const allUntracked   = [...(cache.results || []), ...(cache.olderResults || [])];
            const matchedItem    = allUntracked.find(i => i.topic === topic);
            const signalIds      = matchedItem?.source_ids || [];

            // Look up signal entries to compute date anchors for lead time tracking
            const { data: hubRows } = await instanceSelect('intelligence_entries', 'data', userId, req.instanceId);
            const entries = (hubRows || []).map(r => r.data);
            const signalDates = signalIds
                .map(id => entries.find(e => e.id === id))
                .filter(Boolean)
                .map(e => e.date || e.createdAt)
                .filter(Boolean)
                .sort();
            const oldest_signal_date = signalDates[0] || null;
            const median_signal_at   = signalDates.length ? signalDates[Math.floor(signalDates.length / 2)] : null;

            // Update the backlog story's precede_origin — same structure as createStoryFromDemand
            const [storyRowsRes] = await Promise.all([
                instanceSelect('backlog_stories', 'filename, data', userId, req.instanceId),
            ]);
            const storyRow = (storyRowsRes.data || []).find(r =>
                r.data?.externalId === storyId ||
                r.data?.id         === storyId ||
                r.filename         === storyId + '.json'
            );
            if (storyRow) {
                const existing = storyRow.data.precede_origin || {};
                const updatedData = {
                    ...storyRow.data,
                    precede_origin: {
                        ...existing,
                        signal_ids:          [...new Set([...(existing.signal_ids || []), ...signalIds])],
                        oldest_signal_date:  existing.oldest_signal_date  || oldest_signal_date,
                        median_signal_at:    existing.median_signal_at    || median_signal_at,
                        linked_at:           existing.linked_at           || new Date().toISOString(),
                    },
                };
                await supabase.from('backlog_stories')
                    .update({ data: updatedData, updated_at: new Date().toISOString() })
                    .eq('user_id', userId).eq('instance_id', req.instanceId).eq('filename', storyRow.filename);
            }

            // Mark proposal confirmed
            const proposals = (settings.signalLinkProposals || []).map(p =>
                p.id === proposalId ? { ...p, confirmedAt: new Date().toISOString() } : p
            );
            const merged = { ...settings, signalLinkProposals: proposals };
            await supabase.from('settings').upsert(
                { user_id: userId, instance_id: req.instanceId, data: merged, updated_at: new Date().toISOString() },
                { onConflict: 'user_id,instance_id' }
            );

            res.json({ success: true });
        } catch (e) {
            console.error('❌ Confirm signal link:', e.message);
            apiError(res, e);
        }
    });

    // ── POST /api/dashboard/dismiss-signal-link ───────────────────────────────

    router.post('/dismiss-signal-link', async (req, res) => {
        try {
            const { proposalId } = req.body;
            if (!proposalId) return res.status(400).json({ error: 'proposalId required' });

            const userId = req.userId;
            const { data: settingsRow } = await instanceSelect('settings', 'data', userId, req.instanceId).single();
            const settings = settingsRow?.data || {};

            const proposals = (settings.signalLinkProposals || []).map(p =>
                p.id === proposalId ? { ...p, dismissed: true } : p
            );
            const target = (settings.signalLinkProposals || []).find(p => p.id === proposalId);
            const dismissed = settings.dismissedSignalLinks || [];
            if (target && !dismissed.some(d => d.storyId === target.storyId && d.topic === target.topic)) {
                dismissed.push({ storyId: target.storyId, topic: target.topic });
            }
            const merged = { ...settings, signalLinkProposals: proposals, dismissedSignalLinks: dismissed };
            await supabase.from('settings').upsert(
                { user_id: userId, instance_id: req.instanceId, data: merged, updated_at: new Date().toISOString() },
                { onConflict: 'user_id,instance_id' }
            );

            res.json({ success: true });
        } catch (e) {
            console.error('❌ Dismiss signal link:', e.message);
            apiError(res, e);
        }
    });

    return router;
};

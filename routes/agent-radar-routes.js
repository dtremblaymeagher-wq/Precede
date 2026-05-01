'use strict';
/**
 * routes/agent-radar-routes.js
 *
 * GET  /api/agent-radar/latest  — latest run results for the widget
 * POST /api/agent-radar/run     — manual trigger (instant delivery)
 */

const { Router }        = require('express');
const { apiError }      = require('../utils/api-error');
const supabase          = require('../database/db');
const { runAgentRadar } = require('../utils/sprint-end-jobs');

module.exports = function agentRadarRoutes() {
    const router = Router();

    // ── GET /api/agent-radar/latest ───────────────────────────────────────────
    router.get('/latest', async (req, res) => {
        try {
            const { userId, instanceId } = req;
            const { data, error } = await supabase
                .from('analysis_history')
                .select('data, created_at')
                .eq('user_id', userId)
                .eq('instance_id', instanceId)
                .eq('analysis_type', 'agent_radar')
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle();

            if (error) throw error;
            if (!data) return res.json({ hasRun: false });

            res.json({
                hasRun:        true,
                signals:       data.data?.signals       ?? [],
                radar_summary: data.data?.radar_summary ?? '',
                entryMap:      data.data?.entryMap      ?? {},
                ranAt:         data.created_at,
            });
        } catch (e) {
            apiError(res, e, 'agent-radar/latest');
        }
    });

    // ── POST /api/agent-radar/run ─────────────────────────────────────────────
    // Manual trigger — runs synchronously (user waits for result).
    // Returns { skipped: true } if no new entries since last run.
    router.post('/run', async (req, res) => {
        try {
            const { userId, instanceId } = req;

            // Check for new entries since last run
            const [lastRunRes, latestEntryRes] = await Promise.all([
                supabase.from('analysis_history')
                    .select('created_at')
                    .eq('user_id', userId).eq('instance_id', instanceId)
                    .eq('analysis_type', 'agent_radar')
                    .order('created_at', { ascending: false })
                    .limit(1).maybeSingle(),
                supabase.from('intelligence_entries')
                    .select('created_at')
                    .eq('user_id', userId).eq('instance_id', instanceId)
                    .order('created_at', { ascending: false })
                    .limit(1).maybeSingle(),
            ]);

            const lastRunAt      = lastRunRes.data?.created_at      ?? null;
            const latestEntryAt  = latestEntryRes.data?.created_at  ?? null;

            if (lastRunAt && latestEntryAt && new Date(latestEntryAt) <= new Date(lastRunAt)) {
                return res.json({ skipped: true });
            }

            const result = await runAgentRadar(supabase, userId, instanceId, 'instant');
            if (!result) return res.json({ skipped: true });

            res.json({
                success:       true,
                signals:       result.signals       ?? [],
                radar_summary: result.radar_summary ?? '',
                entryMap:      result.entryMap      ?? {},
            });
        } catch (e) {
            apiError(res, e, 'agent-radar/run');
        }
    });

    return router;
};

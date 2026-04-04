'use strict';
/**
 * routes/sprint-routes.js
 *
 * GET    /api/sprints/current        — current sprint (Jira or calculated, exception-aware)
 * GET    /api/sprints/list           — sprint list (Jira or calculated)
 * GET    /api/sprint-exceptions      — list exceptions
 * POST   /api/sprint-exceptions      — create exception
 * DELETE /api/sprint-exceptions/:id  — delete exception
 * GET    /api/analyze/should-run     — check if auto-analysis should trigger
 *
 * Mounted at /api — routes use full sub-paths (e.g. /sprints/current).
 */

const { Router } = require('express');
const { makeHelpers }     = require('../utils/db-helpers');
const { makeSprintUtils } = require('../utils/sprint-utils');
const { apiError }        = require('../utils/api-error');

module.exports = function createSprintRouter(supabase) {
    const router = Router();
    const { instanceSelect }                          = makeHelpers(supabase);
    const { calculateSprint, getSprintConfig, getCurrentSprint } = makeSprintUtils(supabase);

    // ── GET /api/sprints/current ──────────────────────────────────────────────

    router.get('/sprints/current', async (req, res) => {
        try {
            const userId = req.userId;
            const sprint = await getCurrentSprint(userId, req.instanceId);
            if (!sprint) return res.json(null);

            // Jira-sourced sprints are authoritative — return directly
            if (sprint.source === 'jira') return res.json(sprint);

            // Calculated path: honour sprint exceptions
            const { startDate, durationDays } = await getSprintConfig(userId, req.instanceId);
            const today = new Date().toISOString().split('T')[0];

            const { data: exceptions } = await instanceSelect('sprint_exceptions', '*', userId, req.instanceId)
                .lte('start_date', today)
                .gte('end_date',   today)
                .limit(1);

            if (exceptions?.length > 0) {
                const ex            = exceptions[0];
                const start         = new Date(ex.start_date);
                const end           = new Date(ex.end_date);
                const now           = new Date(today);
                const totalDays     = Math.round((end - start) / 86400000) + 1;
                const daysElapsed   = Math.round((now - start) / 86400000) + 1;
                const daysRemaining = Math.max(0, totalDays - daysElapsed);
                const base          = calculateSprint(startDate, durationDays, new Date(ex.start_date));
                return res.json({
                    name:           ex.label || `Sprint ${base.sprint_number}`,
                    sprint_number:  base.sprint_number,
                    identifier:     base.sprint_number,
                    start_date:     ex.start_date,
                    end_date:       ex.end_date,
                    goal:           null,
                    source:         'calculated',
                    days_elapsed:   daysElapsed,
                    days_remaining: daysRemaining,
                    duration_days:  totalDays,
                    is_exception:   true,
                });
            }

            res.json(sprint);
        } catch (e) {
            apiError(res, e);
        }
    });

    // ── GET /api/sprints/list ─────────────────────────────────────────────────

    router.get('/sprints/list', async (req, res) => {
        try {
            const userId = req.userId;
            const count  = Math.min(parseInt(req.query.count) || 10, 52);

            // Jira-imported sprints — scoped to active instance
            const { data: jiraSprints } = await supabase
                .from('sprints')
                .select('*')
                .eq('user_id', userId)
                .eq('instance_id', req.instanceId)
                .in('state', ['active', 'closed'])
                .order('start_date', { ascending: false })
                .limit(count);

            if (jiraSprints?.length > 0) {
                return res.json(
                    jiraSprints.reverse().map(s => ({
                        name:          s.name,
                        sprint_number: null,
                        jira_id:       s.jira_id,
                        identifier:    s.jira_id,
                        start_date:    s.start_date,
                        end_date:      s.end_date,
                        goal:          s.goal,
                        state:         s.state,
                        source:        'jira',
                    }))
                );
            }

            // Fallback: calculated
            const { startDate, durationDays } = await getSprintConfig(userId, req.instanceId);
            if (!startDate) return res.json([]);

            const current = calculateSprint(startDate, durationDays);
            const sprints = [];
            for (let i = -(count - 1); i <= 0; i++) {
                const targetDate = new Date(current.start_date);
                targetDate.setDate(targetDate.getDate() + i * durationDays);
                const s = calculateSprint(startDate, durationDays, targetDate);
                sprints.push({ ...s, identifier: s.sprint_number, name: `Sprint ${s.sprint_number}`, source: 'calculated', goal: null });
            }
            res.json(sprints);
        } catch (e) {
            apiError(res, e);
        }
    });

    // ── GET /api/sprint-exceptions ────────────────────────────────────────────

    router.get('/sprint-exceptions', async (req, res) => {
        try {
            const userId = req.userId;
            const { data, error } = await instanceSelect('sprint_exceptions', '*', userId, req.instanceId)
                .order('start_date', { ascending: false });
            if (error) return apiError(res, error);
            res.json(data ?? []);
        } catch (e) {
            apiError(res, e);
        }
    });

    // ── POST /api/sprint-exceptions ───────────────────────────────────────────

    router.post('/sprint-exceptions', async (req, res) => {
        try {
            const userId = req.userId;
            const { start_date, end_date, label } = req.body;
            if (!start_date || !end_date)
                return res.status(400).json({ error: 'start_date and end_date are required' });

            const { data, error } = await supabase
                .from('sprint_exceptions')
                .insert({ user_id: userId, instance_id: req.instanceId, start_date, end_date, label: label || null })
                .select()
                .single();
            if (error) return apiError(res, error);
            res.json({ success: true, exception: data });
        } catch (e) {
            apiError(res, e);
        }
    });

    // ── DELETE /api/sprint-exceptions/:id ────────────────────────────────────

    router.delete('/sprint-exceptions/:id', async (req, res) => {
        try {
            const userId = req.userId;
            const { error } = await supabase
                .from('sprint_exceptions')
                .delete()
                .eq('id',          req.params.id)
                .eq('user_id',     userId)
                .eq('instance_id', req.instanceId);
            if (error) return apiError(res, error);
            res.json({ success: true });
        } catch (e) {
            apiError(res, e);
        }
    });

    // ── GET /api/analyze/should-run ───────────────────────────────────────────

    router.get('/analyze/should-run', async (req, res) => {
        try {
            const userId = req.userId;

            // 1. Sprint config
            const sprint = await getCurrentSprint(userId, req.instanceId);
            if (!sprint) return res.json({ should_run: false, reason: 'no_sprint_config' });
            if (sprint.days_elapsed !== 1) return res.json({ should_run: false, reason: 'not_sprint_start' });

            // 2. Last analysis
            const { data: historyRows } = await instanceSelect('analysis_history', 'filename, created_at', userId, req.instanceId)
                .order('created_at', { ascending: false })
                .limit(1);

            const lastAnalysis = historyRows?.[0] ?? null;

            if (!lastAnalysis) {
                const { count } = await supabase
                    .from('intelligence_entries')
                    .select('id', { count: 'exact', head: true })
                    .eq('user_id', userId)
                    .eq('instance_id', req.instanceId);
                if (!count) return res.json({ should_run: false, reason: 'no_new_signals' });
                return res.json({ should_run: true, reason: 'first_analysis', sprint_number: sprint.sprint_number, sprint_name: sprint.name, new_signals: count });
            }

            // 3. Check last_analyzed_sprint from radar_memory
            const { data: memRow } = await instanceSelect('radar_memory', 'data', userId, req.instanceId).single();
            const lastAnalyzedSprint = memRow?.data?.last_analyzed_sprint ?? null;

            if (lastAnalyzedSprint === sprint.identifier) {
                return res.json({ should_run: false, reason: 'already_ran_this_sprint' });
            }

            // 4. Count new signals since last analysis
            const { count: newCount } = await supabase
                .from('intelligence_entries')
                .select('id', { count: 'exact', head: true })
                .eq('user_id', userId)
                .eq('instance_id', req.instanceId)
                .gt('created_at', lastAnalysis.created_at);

            if (!newCount) return res.json({ should_run: false, reason: 'no_new_signals' });

            res.json({
                should_run:         true,
                reason:             'sprint_start_with_new_signals',
                sprint_number:      sprint.sprint_number,
                sprint_name:        sprint.name,
                new_signals:        newCount,
                last_analysis_date: lastAnalysis.created_at.slice(0, 10),
            });
        } catch (e) {
            console.error('should-run check error:', e.message);
            res.json({ should_run: false, reason: 'error' });
        }
    });

    return router;
};

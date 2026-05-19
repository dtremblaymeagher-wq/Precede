'use strict';
/**
 * routes/decisions-routes.js
 *
 * GET  /api/decisions           — list decisions from settings JSONB
 * POST /api/decisions           — replace decisions array
 * POST /api/decisions/escalate  — copy decision to executive instance
 */

const { Router } = require('express');
const { apiError } = require('../utils/api-error');
const { makeHelpers } = require('../utils/db-helpers');

module.exports = function decisionsRoutes(supabase) {
    const router = Router();
    const { instanceSelect } = makeHelpers(supabase);

    router.get('/', async (req, res) => {
        const { data, error } = await instanceSelect('settings', 'data', req.userId, req.instanceId).single();
        if (error && error.code !== 'PGRST116') return apiError(res, error, 'decisions GET');
        res.json(data?.data?.decisions ?? []);
    });

    router.post('/', async (req, res) => {
        const { decisions } = req.body;
        if (!Array.isArray(decisions)) return res.status(400).json({ error: 'decisions must be an array' });

        const { data: existing } = await instanceSelect('settings', 'data', req.userId, req.instanceId).single();
        const updatedData = Object.assign({}, existing?.data ?? {}, { decisions });

        const { error } = await supabase
            .from('settings')
            .upsert(
                { user_id: req.userId, instance_id: req.instanceId, data: updatedData, updated_at: new Date().toISOString() },
                { onConflict: 'user_id,instance_id' }
            );
        if (error) return apiError(res, error, 'decisions POST');
        res.json({ success: true });
    });

    router.post('/escalate', async (req, res) => {
        try {
            const { decisionId } = req.body;
            if (!decisionId) return res.status(400).json({ error: 'decisionId is required' });

            const { data: instances, error: instErr } = await supabase
                .from('instances')
                .select('id')
                .eq('user_id', req.userId)
                .eq('instance_type', 'executive')
                .limit(1);
            if (instErr) return apiError(res, instErr, 'decisions/escalate instances');
            if (!instances?.length) return res.status(404).json({ error: 'No executive instance found' });
            const execInstanceId = instances[0].id;

            const { data: pmSettings } = await instanceSelect('settings', 'data', req.userId, req.instanceId).single();
            const pmDecisions = pmSettings?.data?.decisions ?? [];
            const pmDecision = pmDecisions.find(d => d.id === decisionId);
            if (!pmDecision) return res.status(404).json({ error: 'Decision not found' });
            if (pmDecision.escalated) return res.status(400).json({ error: 'Already escalated' });

            const execDecisionId = Date.now().toString() + '_exec';
            const execDecision = {
                id: execDecisionId,
                name: pmDecision.name,
                description: pmDecision.description,
                date: pmDecision.date,
                approver: pmDecision.approver,
                status: 'pending',
                sources:    pmDecision.sources    || [],
                source_ids: pmDecision.source_ids || [],
                okr_ids:    pmDecision.okr_ids    || [],
                createdAt: new Date().toISOString(),
                approvedAt: null,
                linkedPmDecisionId: decisionId,
                linkedPmInstanceId: req.instanceId,
                isEscalation: true,
            };

            const { data: execSettings } = await supabase
                .from('settings')
                .select('data')
                .eq('user_id', req.userId)
                .eq('instance_id', execInstanceId)
                .maybeSingle();
            const execDecisions = [execDecision, ...(execSettings?.data?.decisions ?? [])];
            const updatedExecData = Object.assign({}, execSettings?.data ?? {}, { decisions: execDecisions });
            const { error: execSaveErr } = await supabase
                .from('settings')
                .upsert(
                    { user_id: req.userId, instance_id: execInstanceId, data: updatedExecData, updated_at: new Date().toISOString() },
                    { onConflict: 'user_id,instance_id' }
                );
            if (execSaveErr) return apiError(res, execSaveErr, 'decisions/escalate exec save');

            const updatedPmDecisions = pmDecisions.map(d =>
                d.id === decisionId ? { ...d, escalated: true, execDecisionId, execInstanceId } : d
            );
            const updatedPmData = Object.assign({}, pmSettings?.data ?? {}, { decisions: updatedPmDecisions });
            const { error: pmSaveErr } = await supabase
                .from('settings')
                .upsert(
                    { user_id: req.userId, instance_id: req.instanceId, data: updatedPmData, updated_at: new Date().toISOString() },
                    { onConflict: 'user_id,instance_id' }
                );
            if (pmSaveErr) return apiError(res, pmSaveErr, 'decisions/escalate pm save');

            res.json({ success: true, execDecisionId, execInstanceId });
        } catch (err) {
            apiError(res, err, 'decisions/escalate');
        }
    });

    // ── POST /api/decisions/respond ──────────────────────────────────────────
    // Exec submits a response to an escalated decision.
    // Updates both exec and PM instance decisions → status: awaiting_acknowledgment.
    router.post('/respond', async (req, res) => {
        try {
            const { decisionId, response, rationale } = req.body;
            if (!decisionId || !response?.trim())
                return res.status(400).json({ error: 'decisionId and response are required' });

            const { data: execSettings } = await instanceSelect('settings', 'data', req.userId, req.instanceId).single();
            const execDecisions = execSettings?.data?.decisions ?? [];
            const execDecision  = execDecisions.find(d => d.id === decisionId);
            if (!execDecision)          return res.status(404).json({ error: 'Decision not found' });
            if (!execDecision.isEscalation) return res.status(400).json({ error: 'Not an escalated decision' });
            if (execDecision.status !== 'pending') return res.status(400).json({ error: 'Decision already responded' });

            const execResponse = {
                text:        response.trim(),
                rationale:   rationale?.trim() || '',
                respondedAt: new Date().toISOString(),
            };

            // Update exec decision
            const updatedExecDecisions = execDecisions.map(d =>
                d.id === decisionId ? { ...d, status: 'awaiting_acknowledgment', execResponse } : d
            );
            const updatedExecData = Object.assign({}, execSettings?.data ?? {}, { decisions: updatedExecDecisions });
            const { error: execSaveErr } = await supabase.from('settings').upsert(
                { user_id: req.userId, instance_id: req.instanceId, data: updatedExecData, updated_at: new Date().toISOString() },
                { onConflict: 'user_id,instance_id' }
            );
            if (execSaveErr) return apiError(res, execSaveErr, 'decisions/respond exec save');

            // Mirror to PM decision
            const { linkedPmInstanceId: pmInstanceId, linkedPmDecisionId: pmDecisionId } = execDecision;
            if (pmInstanceId && pmDecisionId) {
                const { data: pmSettings } = await supabase.from('settings').select('data')
                    .eq('user_id', req.userId).eq('instance_id', pmInstanceId).maybeSingle();
                const pmDecisions = pmSettings?.data?.decisions ?? [];
                const updatedPmDecisions = pmDecisions.map(d =>
                    d.id === pmDecisionId ? { ...d, status: 'awaiting_acknowledgment', execResponse } : d
                );
                const updatedPmData = Object.assign({}, pmSettings?.data ?? {}, { decisions: updatedPmDecisions });
                await supabase.from('settings').upsert(
                    { user_id: req.userId, instance_id: pmInstanceId, data: updatedPmData, updated_at: new Date().toISOString() },
                    { onConflict: 'user_id,instance_id' }
                );
            }

            res.json({ success: true });
        } catch (err) { apiError(res, err, 'decisions/respond'); }
    });

    // ── POST /api/decisions/acknowledge ──────────────────────────────────────
    // PM acknowledges the exec response → status: approved on both sides.
    router.post('/acknowledge', async (req, res) => {
        try {
            const { decisionId } = req.body;
            if (!decisionId) return res.status(400).json({ error: 'decisionId is required' });

            const { data: pmSettings } = await instanceSelect('settings', 'data', req.userId, req.instanceId).single();
            const pmDecisions = pmSettings?.data?.decisions ?? [];
            const pmDecision  = pmDecisions.find(d => d.id === decisionId);
            if (!pmDecision) return res.status(404).json({ error: 'Decision not found' });
            if (pmDecision.status !== 'awaiting_acknowledgment')
                return res.status(400).json({ error: 'Decision not awaiting acknowledgment' });

            const now = new Date().toISOString();

            // Update PM decision
            const updatedPmDecisions = pmDecisions.map(d =>
                d.id === decisionId ? { ...d, status: 'approved', approvedAt: now } : d
            );
            const updatedPmData = Object.assign({}, pmSettings?.data ?? {}, { decisions: updatedPmDecisions });
            const { error: pmSaveErr } = await supabase.from('settings').upsert(
                { user_id: req.userId, instance_id: req.instanceId, data: updatedPmData, updated_at: new Date().toISOString() },
                { onConflict: 'user_id,instance_id' }
            );
            if (pmSaveErr) return apiError(res, pmSaveErr, 'decisions/acknowledge pm save');

            // Mirror to exec decision
            const { execInstanceId, execDecisionId } = pmDecision;
            if (execInstanceId && execDecisionId) {
                const { data: execSettings } = await supabase.from('settings').select('data')
                    .eq('user_id', req.userId).eq('instance_id', execInstanceId).maybeSingle();
                const execDecisions = execSettings?.data?.decisions ?? [];
                const updatedExecDecisions = execDecisions.map(d =>
                    d.id === execDecisionId ? { ...d, status: 'approved', approvedAt: now } : d
                );
                const updatedExecData = Object.assign({}, execSettings?.data ?? {}, { decisions: updatedExecDecisions });
                await supabase.from('settings').upsert(
                    { user_id: req.userId, instance_id: execInstanceId, data: updatedExecData, updated_at: new Date().toISOString() },
                    { onConflict: 'user_id,instance_id' }
                );
            }

            res.json({ success: true });
        } catch (err) { apiError(res, err, 'decisions/acknowledge'); }
    });

    return router;
};

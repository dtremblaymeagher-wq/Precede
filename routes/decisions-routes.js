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
        if (error && error.code !== 'PGRST116') {
            console.error('❌ decisions GET:', error);
            return res.status(500).json({ error: 'Failed to load decisions' });
        }
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
        if (error) {
            console.error('❌ decisions POST:', error);
            return res.status(500).json({ error: 'Failed to save decisions' });
        }
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
                createdAt: new Date().toISOString(),
                approvedAt: null,
                linkedPmDecisionId: decisionId,
                linkedPmInstanceId: req.instanceId,
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

    return router;
};

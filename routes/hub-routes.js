'use strict';
/**
 * routes/hub-routes.js
 *
 * GET    /api/intelligence-hub/entries               — list all entries
 * GET    /api/intelligence-hub/new-since-last-analysis — count new signals
 * POST   /api/intelligence-hub/entry                 — create entry
 * PUT    /api/intelligence-hub/entry/:id             — update entry
 * DELETE /api/intelligence-hub/entry/:id             — delete entry
 */

const { Router } = require('express');
const { apiError } = require('../utils/api-error');
const { makeHelpers } = require('../utils/db-helpers');

const ENTRY_SOURCE_TYPES = new Set([
    'Meeting', 'Email', 'Intercom', 'Support Ticket',
    'Sales', 'Insight', 'Sprint Question', 'Autre',
]);

function validateEntry(raw, { requireBody = false } = {}) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return { error: 'Invalid entry body' };
    }
    const { id, body, person, sourceType, date, createdAt, updatedAt, tags } = raw;

    if (requireBody || body !== undefined) {
        if (typeof body !== 'string' || body.trim() === '') {
            return { error: 'body is required and must be a non-empty string' };
        }
        if (body.length > 10_000) {
            return { error: 'body exceeds 10 000 character limit' };
        }
    }
    if (id !== undefined && (typeof id !== 'string' || id.length > 100)) {
        return { error: 'id must be a string ≤ 100 chars' };
    }
    if (person !== undefined && (typeof person !== 'string' || person.length > 200)) {
        return { error: 'person must be a string ≤ 200 chars' };
    }
    if (sourceType !== undefined && !ENTRY_SOURCE_TYPES.has(sourceType)) {
        return { error: `sourceType must be one of: ${[...ENTRY_SOURCE_TYPES].join(', ')}` };
    }
    if (date !== undefined && (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date))) {
        return { error: 'date must be YYYY-MM-DD' };
    }
    if (tags !== undefined && (!Array.isArray(tags) || tags.some(t => typeof t !== 'string' || t.length > 100))) {
        return { error: 'tags must be an array of strings ≤ 100 chars each' };
    }

    const clean = {};
    if (id !== undefined)         clean.id         = id;
    if (body !== undefined)       clean.body       = body;
    if (person !== undefined)     clean.person     = person;
    if (sourceType !== undefined) clean.sourceType = sourceType;
    if (date !== undefined)       clean.date       = date;
    if (createdAt !== undefined)  clean.createdAt  = createdAt;
    if (updatedAt !== undefined)  clean.updatedAt  = updatedAt;
    if (tags !== undefined)       clean.tags       = tags;
    return { clean };
}

module.exports = function hubRoutes(supabase) {
    const router = Router();
    const { instanceSelect } = makeHelpers(supabase);

    router.get('/new-since-last-analysis', async (req, res) => {
        try {
            const userId = req.userId;
            const { data: historyRows } = await instanceSelect('analysis_history', 'created_at', userId, req.instanceId)
                .order('created_at', { ascending: false })
                .limit(1);

            if (!historyRows || historyRows.length === 0) {
                return res.json({ count: 0, since: null });
            }
            const lastAnalysisAt = historyRows[0].created_at;
            const { count } = await supabase
                .from('intelligence_entries')
                .select('id', { count: 'exact', head: true })
                .eq('user_id', userId)
                .eq('instance_id', req.instanceId)
                .gt('created_at', lastAnalysisAt);

            res.json({ count: count ?? 0, since: lastAnalysisAt.slice(0, 10) });
        } catch (e) {
            apiError(res, e, 'hub/new-since');
        }
    });

    router.get('/entries', async (req, res) => {
        const userId = req.userId;
        const { data, error } = await instanceSelect('intelligence_entries', 'data', userId, req.instanceId)
            .order('created_at', { ascending: false });
        if (error) return apiError(res, error, 'hub GET');
        res.json((data ?? []).map(row => row.data));
    });

    router.post('/entry', async (req, res) => {
        const userId = req.userId;
        const { error: validErr, clean } = validateEntry(req.body, { requireBody: true });
        if (validErr) return res.status(400).json({ error: validErr });

        const { error } = await supabase
            .from('intelligence_entries')
            .insert({ user_id: userId, instance_id: req.instanceId, data: clean });
        if (error) return apiError(res, error, 'hub POST');
        res.json({ success: true });
    });

    router.put('/entry/:id', async (req, res) => {
        const userId = req.userId;
        const { id } = req.params;
        const { error: validErr, clean } = validateEntry(req.body);
        if (validErr) return res.status(400).json({ error: validErr });

        const { error } = await supabase
            .from('intelligence_entries')
            .update({ data: clean })
            .filter('data->>id', 'eq', id)
            .eq('user_id', userId)
            .eq('instance_id', req.instanceId);
        if (error) return apiError(res, error, 'hub PUT');
        res.json({ success: true });
    });

    router.delete('/entry/:id', async (req, res) => {
        const userId = req.userId;
        const { id } = req.params;
        const { error } = await supabase
            .from('intelligence_entries')
            .delete()
            .filter('data->>id', 'eq', id)
            .eq('user_id', userId)
            .eq('instance_id', req.instanceId);
        if (error) return apiError(res, error, 'hub DELETE');
        res.json({ success: true });
    });

    return router;
};

'use strict';
/**
 * routes/instances-routes.js
 *
 * GET    /api/instances        — list all instances for user
 * POST   /api/instances        — create instance
 * PUT    /api/instances/:id    — rename / recolor instance
 * DELETE /api/instances/:id    — delete instance (blocks if only one)
 *
 * These routes are in INSTANCE_FREE_PATHS — no X-Instance-Id required.
 */

const { Router } = require('express');
const { apiError } = require('../utils/api-error');

module.exports = function instancesRoutes(supabase) {
    const router = Router();

    router.get('/', async (req, res) => {
        try {
            const userId = req.userId;
            const { data, error } = await supabase
                .from('instances')
                .select('id, name, color, instance_type, created_at')
                .eq('user_id', userId)
                .order('created_at', { ascending: true });
            if (error) return apiError(res, error);
            res.json(data ?? []);
        } catch (e) { apiError(res, e); }
    });

    router.post('/', async (req, res) => {
        try {
            const userId = req.userId;
            const { name, color, instance_type } = req.body;
            if (!name?.trim()) return res.status(400).json({ error: 'name is required' });
            const validTypes = ['pm', 'executive'];
            const type = validTypes.includes(instance_type) ? instance_type : 'pm';
            const { data, error } = await supabase
                .from('instances')
                .insert({ user_id: userId, name: name.trim(), color: color || '#6366f1', instance_type: type })
                .select('id, name, color, instance_type, created_at')
                .single();
            if (error) return apiError(res, error);
            res.json(data);
        } catch (e) { apiError(res, e); }
    });

    router.put('/:id', async (req, res) => {
        try {
            const userId = req.userId;
            const { name, color } = req.body;
            const patch = {};
            if (name?.trim()) patch.name = name.trim();
            if (color)         patch.color = color;
            if (!Object.keys(patch).length) return res.status(400).json({ error: 'Nothing to update' });
            const { error } = await supabase
                .from('instances')
                .update(patch)
                .eq('id', req.params.id)
                .eq('user_id', userId);
            if (error) return apiError(res, error);
            res.json({ success: true });
        } catch (e) { apiError(res, e); }
    });

    router.delete('/:id', async (req, res) => {
        try {
            const userId = req.userId;
            const { count } = await supabase
                .from('instances')
                .select('id', { count: 'exact', head: true })
                .eq('user_id', userId);
            if (count <= 1) return res.status(400).json({ error: 'Cannot delete your only instance' });
            const { error } = await supabase
                .from('instances')
                .delete()
                .eq('id', req.params.id)
                .eq('user_id', userId);
            if (error) return apiError(res, error);
            res.json({ success: true });
        } catch (e) { apiError(res, e); }
    });

    return router;
};

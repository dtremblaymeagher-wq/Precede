'use strict';
/**
 * routes/vision-routes.js
 *
 * GET  /api/vision  — load vision board content
 * POST /api/vision  — save vision board content
 */

const { Router } = require('express');
const { apiError } = require('../utils/api-error');
const { makeHelpers } = require('../utils/db-helpers');

module.exports = function visionRoutes(supabase) {
    const router = Router();
    const { instanceSelect } = makeHelpers(supabase);

    router.get('/', async (req, res) => {
        const userId = req.userId;
        const { data } = await instanceSelect('vision', 'data', userId, req.instanceId)
            .single();
        res.json(data?.data ?? { vision: '' });
    });

    router.post('/', async (req, res) => {
        const userId = req.userId;
        const { error } = await supabase
            .from('vision')
            .upsert(
                { user_id: userId, instance_id: req.instanceId, data: req.body, updated_at: new Date().toISOString() },
                { onConflict: 'user_id,instance_id' }
            );
        if (error) return apiError(res, error, 'vision POST');
        res.json({ success: true });
    });

    return router;
};

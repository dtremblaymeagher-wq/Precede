'use strict';
/**
 * routes/onboarding-routes.js
 *
 * GET  /api/onboarding  — current onboarding state
 * POST /api/onboarding  — update step / mark complete
 *
 * These routes are in INSTANCE_FREE_PATHS.
 */

const { Router } = require('express');
const { apiError } = require('../utils/api-error');

module.exports = function onboardingRoutes(supabase) {
    const router = Router();

    router.get('/', async (req, res) => {
        try {
            const userId = req.userId;
            const { data } = await supabase
                .from('onboarding')
                .select('completed, current_step')
                .eq('user_id', userId)
                .single();
            res.json(data ?? { completed: false, current_step: 1 });
        } catch (e) {
            console.error('[onboarding GET]', e.message);
            res.json({ completed: false, current_step: 1 });
        }
    });

    router.post('/', async (req, res) => {
        try {
            const userId = req.userId;
            const { current_step, completed } = req.body;
            const payload = {
                user_id:      userId,
                current_step: current_step ?? 1,
                completed:    completed ?? false,
                updated_at:   new Date().toISOString(),
                ...(completed ? { completed_at: new Date().toISOString() } : {}),
            };
            const { error } = await supabase.from('onboarding').upsert(payload, { onConflict: 'user_id' });
            if (error) console.error('[onboarding POST]', error.message);
            res.json({ success: true });
        } catch (e) {
            console.error('[onboarding POST catch]', e.message);
            apiError(res, e);
        }
    });

    return router;
};

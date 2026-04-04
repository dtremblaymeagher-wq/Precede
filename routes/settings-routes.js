'use strict';
/**
 * routes/settings-routes.js
 *
 * GET  /api/settings  — load instance settings
 * POST /api/settings  — partial-update instance settings (safe merge)
 */

const { Router } = require('express');
const { makeHelpers } = require('../utils/db-helpers');

const SETTINGS_KEYS = [
    'vision', 'objectives', 'priorities', 'userStoryTemplate',
    'definitionOfReady', 'personas', 'clients',
    'sprint_duration_days', 'sprint_start_date', 'decisions',
];

module.exports = function settingsRoutes(supabase) {
    const router = Router();
    const { instanceSelect } = makeHelpers(supabase);

    router.get('/', async (req, res) => {
        const userId = req.userId;
        const { data, error } = await instanceSelect('settings', 'data', userId, req.instanceId)
            .single();
        if (error && error.code !== 'PGRST116') {
            console.error('❌ Erreur settings GET:', error);
            return res.status(500).json({ error: 'Impossible de charger les réglages.' });
        }
        res.json(data?.data ?? { personas: [], clients: [], objectives: [], userStoryTemplate: '', defaultAC: '' });
    });

    router.post('/', async (req, res) => {
        const userId = req.userId;
        const { data: existing } = await instanceSelect('settings', 'data', userId, req.instanceId)
            .single();
        const picked = Object.fromEntries(
            SETTINGS_KEYS.filter(k => k in req.body).map(k => [k, req.body[k]])
        );
        const updatedData = Object.assign({}, existing?.data ?? {}, picked);
        const { error } = await supabase
            .from('settings')
            .upsert(
                { user_id: userId, instance_id: req.instanceId, data: updatedData, updated_at: new Date().toISOString() },
                { onConflict: 'user_id,instance_id' }
            );
        if (error) {
            console.error('❌ Erreur settings POST:', error);
            return res.status(500).json({ error: 'Impossible de sauvegarder les réglages.' });
        }
        console.log('✅ Settings saved');
        res.json({ success: true });
    });

    return router;
};

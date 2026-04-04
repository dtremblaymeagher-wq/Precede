'use strict';
/**
 * routes/history-routes.js
 *
 * GET /api/history            — list all analysis filenames (newest first)
 * GET /api/history/:filename  — fetch a single analysis by filename
 */

const { Router } = require('express');
const { makeHelpers } = require('../utils/db-helpers');

module.exports = function historyRoutes(supabase) {
    const router = Router();
    const { instanceSelect } = makeHelpers(supabase);

    router.get('/', async (req, res) => {
        const userId = req.userId;
        const { data, error } = await instanceSelect('analysis_history', 'filename', userId, req.instanceId)
            .order('created_at', { ascending: false });
        if (error) return res.json([]);
        res.json((data ?? []).map(row => row.filename));
    });

    router.get('/:filename', async (req, res) => {
        const userId = req.userId;
        const { data, error } = await instanceSelect('analysis_history', 'data', userId, req.instanceId)
            .eq('filename', req.params.filename)
            .single();
        if (error || !data) return res.status(404).json({ error: 'Fichier non trouvé' });
        res.json(data.data);
    });

    return router;
};

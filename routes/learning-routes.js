'use strict';
/**
 * routes/learning-routes.js
 *
 * POST /api/learning/sync   — AI analysis of dev questions → saved advice
 * GET  /api/learning/vault  — read saved writing advice
 */

const { Router } = require('express');
const { apiError } = require('../utils/api-error');
const { MODELS, callAI } = require('../shared/ai-client');
const { makeHelpers } = require('../utils/db-helpers');

module.exports = function learningRoutes(supabase) {
    const router = Router();
    const { instanceSelect } = makeHelpers(supabase);

    router.post('/sync', async (req, res) => {
        try {
            const userId = req.userId;
            const { data: storyRows } = await instanceSelect('backlog_stories', 'data', userId, req.instanceId);

            const techDebtData = (storyRows ?? [])
                .map(row => row.data)
                .filter(story => story.devQuestions?.length > 0)
                .map(story => ({ story: story.title, questions: story.devQuestions }));

            if (techDebtData.length === 0) {
                return res.json({ success: false, advice: 'Aucune question technique trouvée.' });
            }

            const advice = await callAI({
                model:     MODELS.haikuLegacy,
                maxTokens: 400,
                system:    'Always respond in English.',
                messages:  [{ role: 'user', content: `Analyse ces questions de dev : ${JSON.stringify(techDebtData)}. Donne 3 consignes de rédaction sous forme de liste à puces.` }],
                req,
            });
            await supabase
                .from('learning_vault')
                .upsert(
                    { user_id: userId, instance_id: req.instanceId, data: { advice, lastUpdate: new Date() }, updated_at: new Date().toISOString() },
                    { onConflict: 'user_id,instance_id' }
                );
            res.json({ success: true, advice });
        } catch (e) {
            apiError(res, e, 'learning/sync');
        }
    });

    router.get('/vault', async (req, res) => {
        const userId = req.userId;
        const { data } = await instanceSelect('learning_vault', 'data', userId, req.instanceId)
            .single();
        res.json(data?.data ?? { advice: '' });
    });

    return router;
};

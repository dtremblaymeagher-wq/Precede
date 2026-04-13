'use strict';
/**
 * routes/grooming-routes.js
 *
 * POST /api/grooming/generate — server-side story grooming
 *   Fetches settings + vault, builds system prompt via buildGroomingSystem(),
 *   calls Claude, returns { content: [{ text }] } for story-grooming.js compat.
 */

const { Router }              = require('express');
const { apiError }            = require('../utils/api-error');
const { MODELS, callAI }      = require('../shared/ai-client');
const { makeHelpers }         = require('../utils/db-helpers');
const { buildGroomingSystem } = require('../shared/prompts');

module.exports = function createGroomingRouter(supabase, { aiLimiter } = {}) {
    const router = Router();
    const { instanceSelect } = makeHelpers(supabase);

    router.post('/generate', aiLimiter, async (req, res) => {
        try {
            const userId = req.userId;
            const { storyInput } = req.body;
            if (!storyInput?.trim()) return res.status(400).json({ error: 'storyInput is required' });

            const [settingsRes, vaultRes] = await Promise.all([
                instanceSelect('settings', 'data', userId, req.instanceId).single(),
                instanceSelect('learning_vault', 'id, type, data, created_at', userId, req.instanceId)
                    .order('created_at', { ascending: false }),
            ]);

            const settings = settingsRes.data?.data ?? {};
            const entries  = vaultRes.data ?? [];

            const personas = (settings.personas ?? [])
                .filter(p => p.name)
                .map(p => `- ${p.name}${p.role ? ` (${p.role})` : ''}`)
                .join('\n');

            const vaultAdvice = entries.find(e => e.type === 'dev_questions')?.data?.advice ?? '';

            const jiraRules = entries
                .filter(e => e.type === 'jira_comment' && e.data?.hasImprovement && e.data?.recommendation?.trim())
                .map(e => e.data.recommendation.trim());

            const system = buildGroomingSystem({
                vision:            settings.vision            ?? '',
                objectives:        settings.objectives        ?? [],
                priorities:        settings.priorities        ?? [],
                personas,
                userStoryTemplate: settings.userStoryTemplate ?? '',
                vaultAdvice,
                jiraRules,
            });

            const text = await callAI({
                model:     MODELS.haiku,
                maxTokens: 2500,
                system,
                messages:  [{ role: 'user', content: storyInput }],
                callType:  'story_grooming',
                req,
            });

            res.json({ content: [{ text }] });
        } catch (e) {
            apiError(res, e, 'grooming/generate');
        }
    });

    return router;
};

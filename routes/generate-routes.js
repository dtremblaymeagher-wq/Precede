'use strict';
/**
 * routes/generate-routes.js
 *
 * POST /api/generate — AI proxy for story-grooming.js
 *   INSTANCE_FREE_PATH — no X-Instance-Id required, no DB writes.
 *   Returns { content: [{ text }] } to preserve story-grooming.js compatibility.
 */

const { Router }         = require('express');
const { apiError }       = require('../utils/api-error');
const { MODELS, callAI } = require('../shared/ai-client');

module.exports = function createGenerateRouter({ aiLimiter } = {}) {
    const router = Router();

    router.post('/', aiLimiter, async (req, res) => {
        try {
            const { system, messages, callType, maxTokens } = req.body;
            const systemWithEnglish = system
                ? `Always respond in English.\n\n${system}`
                : 'Always respond in English.';
            const text = await callAI({ model: MODELS.haiku, maxTokens: maxTokens || 2500, system: systemWithEnglish, messages, callType: callType || 'story_grooming', req });
            // Preserve original response envelope for story-grooming.js compatibility
            res.json({ content: [{ text }] });
        } catch (e) { apiError(res, e); }
    });

    return router;
};

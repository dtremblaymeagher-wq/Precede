'use strict';
/**
 * routes/brainstorm-routes.js
 *
 * POST /api/brainstorm — AI solution brainstorming with product context + radar
 *
 * Mounted at /api/brainstorm.
 */

const { Router }         = require('express');
const { makeHelpers }    = require('../utils/db-helpers');
const { apiError }       = require('../utils/api-error');
const { MODELS, callAI } = require('../shared/ai-client');
const prompts            = require('../shared/prompts');

module.exports = function createBrainstormRouter(supabase, { aiLimiter } = {}) {
    const router = Router();
    const { instanceSelect } = makeHelpers(supabase);

    router.post('/', aiLimiter, async (req, res) => {
        try {
            const { message, context = {} } = req.body;
            if (!message) return res.status(400).json({ error: 'message is required' });

            const userId = req.userId;
            const { conversationHistory = [], selectedItems = [] } = context;

            // Load product context from settings
            let vision = '', objectives = [], personas = [], clients = [], priorities = '';
            try {
                const { data: settingsRow } = await instanceSelect('settings', 'data', userId, req.instanceId).single();
                const { data: visionRow }   = await instanceSelect('vision', 'content', userId, req.instanceId).maybeSingle();
                vision   = visionRow?.content || '';
                const s  = settingsRow?.data || {};
                objectives = s.objectives || [];
                personas   = s.personas   || [];
                clients    = s.clients    || [];
                priorities = s.priorities || '';
            } catch (_) { /* non-fatal */ }

            // Load latest radar analysis
            let radarCtx = '';
            try {
                const { data: radarRows } = await instanceSelect('analysis_history', 'data, created_at', userId, req.instanceId)
                    .like('filename', 'radar-%')
                    .order('created_at', { ascending: false })
                    .limit(1)
                    .single();
                const r = radarRows?.data?.analysis;
                if (r) {
                    const lines = [];
                    if (r.summary) lines.push(`Overall state: ${r.summary}`);
                    if (r.trends?.length)        lines.push(`Top trends:\n${r.trends.slice(0, 4).map(t => `  - ${t.topic} (${t.signal_strength}, ${t.evolution}): ${t.description}`).join('\n')}`);
                    if (r.opportunities?.length) lines.push(`Opportunities:\n${r.opportunities.slice(0, 3).map(o => `  - ${o.title}: ${o.description}`).join('\n')}`);
                    if (r.risks?.length)         lines.push(`Risks:\n${r.risks.slice(0, 3).map(rk => `  - ${rk.title}: ${rk.description}`).join('\n')}`);
                    if (r.sentiment?.length)     lines.push(`Stakeholder sentiment:\n${r.sentiment.map(s => `  - ${s.actor}: ${s.status} — ${s.feedback}`).join('\n')}`);
                    if (r.delta) {
                        const d = r.delta;
                        const parts = [];
                        if (d.new_signals?.length)  parts.push(`new: ${d.new_signals.join(', ')}`);
                        if (d.strengthened?.length) parts.push(`strengthened: ${d.strengthened.join(', ')}`);
                        if (d.resolved?.length)     parts.push(`resolved: ${d.resolved.join(', ')}`);
                        if (parts.length) lines.push(`Sprint delta: ${parts.join(' | ')}`);
                    }
                    if (r.next_actions?.length) lines.push(`Previously suggested actions:\n${r.next_actions.slice(0, 3).map(a => `  - ${a.title}: ${a.description}`).join('\n')}`);
                    if (lines.length) radarCtx = '\n## Latest Radar Intelligence\n' + lines.join('\n');
                }
            } catch (_) { /* non-fatal — no radar yet */ }

            // Build system prompt
            const productBlock = [
                vision                  && `Vision: ${vision}`,
                objectives.length       && `OKRs:\n${objectives.map((o, i) => `  ${i + 1}. ${o.title || o}`).join('\n')}`,
                personas.length         && `User personas: ${personas.map(p => p.name || p).join(', ')}`,
                clients.length          && `Key clients / customer segments: ${clients.map(c => c.name || c).join(', ')}`,
                priorities              && `Current sprint priorities: ${priorities}`,
            ].filter(Boolean).join('\n');

            const itemsBlock = selectedItems.length > 0
                ? '\n## Selected Dashboard Items\n' + selectedItems.map((item, i) => {
                    if (typeof item === 'object' && item.content) return `${i + 1}. [${item.widget}] ${item.content}`;
                    return `${i + 1}. ${item}`;
                }).join('\n')
                : '';

            // Auto-init message
            const isInit = message === '__init__';
            const userMessage = isInit
                ? prompts.buildBrainstormInitMessage({ selectedItemCount: selectedItems.length })
                : message;

            // Build messages array: last 10 turns of history + new message
            const history = conversationHistory.slice(-10).map(m => ({
                role:    m.role === 'user' ? 'user' : 'assistant',
                content: String(m.content),
            }));
            const apiMessages = [...history, { role: 'user', content: userMessage }];

            const text = await callAI({
                model:     MODELS.sonnet,
                maxTokens: 2048,
                system:    prompts.buildBrainstormSystem({ productBlock: productBlock || 'Not configured yet.', radarCtx, itemsBlock }),
                messages:  apiMessages,
                req,
            });
            if (!text) return apiError(res, new Error('Empty response from AI'), 'brainstorm');
            res.json({ response: text });
        } catch (e) {
            apiError(res, e);
        }
    });

    return router;
};

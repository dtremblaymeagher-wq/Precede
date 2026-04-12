'use strict';
/**
 * routes/learning-routes.js
 *
 * POST /api/learning/sync              — AI analysis of dev questions → saved advice (type: dev_questions)
 * POST /api/learning/feedback          — save user feedback from Solution Mode (type: user_feedback)
 * POST /api/learning/analyze-feedback  — AI analysis of user_feedback → saved recs (type: improvement_recs)
 * GET  /api/learning/vault             — all vault entries + latest dev_questions advice (for backward compat)
 */

const { Router } = require('express');
const { apiError } = require('../utils/api-error');
const { MODELS, callAI } = require('../shared/ai-client');
const { makeHelpers } = require('../utils/db-helpers');

module.exports = function learningRoutes(supabase) {
    const router = Router();
    const { instanceSelect } = makeHelpers(supabase);

    // ── POST /api/learning/sync ───────────────────────────────────────────────
    // Analyzes dev questions from backlog stories → saves as type='dev_questions'.
    // Replaces any existing dev_questions entry for this instance.

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
                callType:  'learning_advice',
                req,
            });

            // Replace existing dev_questions entry for this instance
            await supabase.from('learning_vault')
                .delete()
                .eq('user_id', userId).eq('instance_id', req.instanceId).eq('type', 'dev_questions');
            await supabase.from('learning_vault')
                .insert({ user_id: userId, instance_id: req.instanceId, type: 'dev_questions', data: { advice, lastUpdate: new Date().toISOString() } });

            res.json({ success: true, advice });
        } catch (e) {
            apiError(res, e, 'learning/sync');
        }
    });

    // ── POST /api/learning/feedback ───────────────────────────────────────────
    // Saves a user_feedback entry and immediately generates a specific AI rule
    // from the comment via Claude → stored as `recommendation` in the same row.
    // Body: { comment, context: { selectedItems: string[], aiSnippet: string } }

    router.post('/feedback', async (req, res) => {
        try {
            const userId = req.userId;
            const { comment, context = {} } = req.body;
            if (!comment?.trim()) return res.status(400).json({ error: 'comment is required' });

            const trimmed = comment.trim();
            const contextSummary = [
                (context.selectedItems ?? []).join(', '),
                context.aiSnippet?.trim() ? `Context: ${context.aiSnippet.trim().slice(0, 200)}` : '',
            ].filter(Boolean).join(' — ');

            // Generate a specific, actionable AI rule from this comment
            const recommendation = await callAI({
                model:     MODELS.haikuLegacy,
                maxTokens: 120,
                system:    'You are a rules editor for an AI product analysis system. Always respond in English. Write exactly one short, specific rule (1–2 sentences max) telling the AI what to do or avoid in future analyses. No preamble, no bullet, no heading — just the rule.',
                messages:  [{
                    role: 'user',
                    content: `A PM left this feedback on an AI analysis:\n"${trimmed}"${contextSummary ? `\n\nContext of what they were viewing: ${contextSummary}` : ''}\n\nWrite the rule for the AI.`,
                }],
                callType: 'feedback_rule',
                req,
            });

            const { error } = await supabase.from('learning_vault').insert({
                user_id:     userId,
                instance_id: req.instanceId,
                type:        'user_feedback',
                data: {
                    comment:        trimmed,
                    recommendation: recommendation.trim(),
                    selectedItems:  context.selectedItems ?? [],
                    aiSnippet:      context.aiSnippet    ?? '',
                    createdAt:      new Date().toISOString(),
                },
            });
            if (error) throw error;
            res.json({ success: true, recommendation: recommendation.trim() });
        } catch (e) {
            apiError(res, e, 'learning/feedback');
        }
    });

    // ── POST /api/learning/analyze-feedback ──────────────────────────────────
    // Reads all user_feedback entries, sends to Claude, saves as type='improvement_recs'.
    // Replaces any existing improvement_recs entry for this instance.

    router.post('/analyze-feedback', async (req, res) => {
        try {
            const userId = req.userId;
            const { data: rows } = await instanceSelect('learning_vault', 'data, created_at', userId, req.instanceId)
                .eq('type', 'user_feedback')
                .order('created_at', { ascending: false });

            const feedbackRows = rows ?? [];
            if (feedbackRows.length === 0) {
                return res.json({ success: false, recommendations: 'No user feedback found yet.' });
            }

            const feedbackText = feedbackRows.map((r, i) => {
                const d       = r.data ?? {};
                const date    = r.created_at ? r.created_at.slice(0, 10) : '';
                const items   = (d.selectedItems ?? []).join(', ');
                const snippet = d.aiSnippet?.trim() ? `\n  Context: ${d.aiSnippet.slice(0, 300)}` : '';
                return `${i + 1}. [${date}]${items ? ` (on: ${items})` : ''} "${d.comment}"${snippet}`;
            }).join('\n\n');

            const recommendations = await callAI({
                model:     MODELS.haikuLegacy,
                maxTokens: 600,
                system:    'You are a product management coach. Always respond in English. Be concise and specific.',
                messages:  [{
                    role: 'user',
                    content: `The following is feedback a PM left on AI analyses in their product dashboard. Each comment flags something the AI missed, got wrong, or could do better.\n\nFeedback:\n${feedbackText}\n\nBased on this feedback, generate 3–5 specific, actionable recommendations for how the AI should improve its future analyses. Format as a numbered list. Focus on patterns across multiple comments if they exist.`,
                }],
                callType: 'feedback_analysis',
                req,
            });

            await supabase.from('learning_vault')
                .delete()
                .eq('user_id', userId).eq('instance_id', req.instanceId).eq('type', 'improvement_recs');
            await supabase.from('learning_vault')
                .insert({
                    user_id: userId, instance_id: req.instanceId, type: 'improvement_recs',
                    data: { recommendations, feedbackCount: feedbackRows.length, lastUpdate: new Date().toISOString() },
                });

            res.json({ success: true, recommendations });
        } catch (e) {
            apiError(res, e, 'learning/analyze-feedback');
        }
    });

    // ── GET /api/learning/vault ───────────────────────────────────────────────
    // Returns all vault entries + top-level `advice` string for backward compat
    // (story-grooming.js reads vault.advice).

    router.get('/vault', async (req, res) => {
        const userId = req.userId;
        const { data: rows } = await instanceSelect('learning_vault', 'id, type, data, created_at', userId, req.instanceId)
            .order('created_at', { ascending: false });

        const entries = rows ?? [];
        const devQRow = entries.find(r => r.type === 'dev_questions');
        const advice  = devQRow?.data?.advice ?? '';

        res.json({ advice, entries });
    });

    return router;
};

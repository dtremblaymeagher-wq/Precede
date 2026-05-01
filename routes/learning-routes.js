'use strict';
const { randomUUID } = require('crypto');
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
                model:     MODELS.haiku,
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
    // Saves a user_feedback entry and generates an AI rule in background.
    // Returns immediately — the recommendation is stored async in learning_vault.
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

            // Return immediately — AI rule generation runs in background
            const batchId = randomUUID();
            res.json({ success: true });

            (async () => {
                const recommendation = await callAI({
                    model:        MODELS.haiku,
                    maxTokens:    120,
                    system:       'You are a transcription assistant for a PM\'s instructions. Always respond in English. Your only job is to rewrite the PM\'s comment as a clear, direct instruction for the AI analysis system — preserving the PM\'s intent exactly as stated, without questioning, reversing, or adding to it. No preamble, no bullet, no heading — just the instruction.',
                    messages:     [{
                        role: 'user',
                        content: `PM comment: "${trimmed}"${contextSummary ? `\nContext: ${contextSummary}` : ''}\n\nRewrite as a direct AI instruction that faithfully reflects what the PM asked.`,
                    }],
                    callType:     'feedback_rule',
                    req,
                    deliveryMode: 'batch',
                    batchId,
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
                if (error) console.error('[learning/feedback] vault insert failed:', error.message);
            })().catch(e => console.error('[learning/feedback]', e.message));
        } catch (e) {
            apiError(res, e, 'learning/feedback');
        }
    });

    // ── PATCH /api/learning/:id ───────────────────────────────────────────────
    // Updates data.recommendation for a user_feedback entry.
    // Body: { recommendation: string }

    router.patch('/:id', async (req, res) => {
        try {
            const userId = req.userId;
            const { id } = req.params;
            const { recommendation } = req.body;
            if (!recommendation?.trim()) return res.status(400).json({ error: 'recommendation is required' });

            // Fetch current row to merge data (can't update single jsonb key directly)
            const { data: row, error: fetchErr } = await supabase
                .from('learning_vault')
                .select('data')
                .eq('id', id)
                .eq('user_id', userId)
                .eq('instance_id', req.instanceId)
                .single();
            if (fetchErr || !row) return res.status(404).json({ error: 'Entry not found' });

            const { error } = await supabase
                .from('learning_vault')
                .update({ data: { ...row.data, recommendation: recommendation.trim() } })
                .eq('id', id)
                .eq('user_id', userId)
                .eq('instance_id', req.instanceId);
            if (error) throw error;
            res.json({ success: true });
        } catch (e) {
            apiError(res, e, 'learning/patch');
        }
    });

    // ── DELETE /api/learning/:id ──────────────────────────────────────────────
    // Deletes a learning_vault entry owned by this user + instance.

    router.delete('/:id', async (req, res) => {
        try {
            const userId = req.userId;
            const { id } = req.params;
            const { error } = await supabase
                .from('learning_vault')
                .delete()
                .eq('id', id)
                .eq('user_id', userId)
                .eq('instance_id', req.instanceId);
            if (error) throw error;
            res.json({ success: true });
        } catch (e) {
            apiError(res, e, 'learning/delete');
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
                model:     MODELS.haiku,
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

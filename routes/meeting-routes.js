'use strict';
/**
 * routes/meeting-routes.js
 *
 * POST /api/meeting-prep         — AI meeting strategy (radar-enriched)
 * POST /api/post-meeting         — AI meeting synthesis from notes
 * POST /api/meeting-prep/save    — persist prep record to DB
 * GET  /api/meeting-prep/history — list saved preps
 *
 * Mounted at /api — routes use full sub-paths.
 */

const { Router }         = require('express');
const { makeHelpers }    = require('../utils/db-helpers');
const { apiError }       = require('../utils/api-error');
const { MODELS, callAI } = require('../shared/ai-client');
const prompts            = require('../shared/prompts');

module.exports = function createMeetingRouter(supabase, { aiLimiter } = {}) {
    const router = Router();
    const { instanceSelect } = makeHelpers(supabase);

    async function loadVision(userId, instanceId) {
        const { data } = await instanceSelect('vision', 'data', userId, instanceId).single();
        return data?.data?.vision ?? 'Non définie';
    }

    // ── POST /api/meeting-prep ────────────────────────────────────────────────

    router.post('/meeting-prep', aiLimiter, async (req, res) => {
        try {
            const { actor, subject, context, format } = req.body;
            if (!subject) return res.status(400).json({ error: 'Le sujet de la réunion est requis' });

            const userId = req.userId;
            let radarContext = {
                hasData: false, latestAnalysis: null,
                relevantTrends: [], relevantOpportunities: [], relevantRisks: [], relevantFeedbacks: [],
                productContext: { vision: 'Non définie', objectives: [] },
            };

            try {
                radarContext.productContext.vision = await loadVision(userId, req.instanceId);

                const { data: settingsRow } = await instanceSelect('settings', 'data', userId, req.instanceId).single();
                if (settingsRow?.data) radarContext.productContext.objectives = settingsRow.data.objectives || [];

                const { data: latestRadar } = await instanceSelect('analysis_history', 'data', userId, req.instanceId)
                    .like('filename', 'radar-%')
                    .order('created_at', { ascending: false })
                    .limit(1)
                    .single();
                if (latestRadar?.data) {
                    radarContext.latestAnalysis = latestRadar.data;
                    radarContext.hasData        = true;

                    const subjectWords = subject.toLowerCase().split(' ');
                    const contextWords = context ? context.toLowerCase().split(' ') : [];
                    const searchTerms  = [actor.toLowerCase()].concat(subjectWords, contextWords).filter(t => t.length >= 3);
                    const isRelevant   = (text) => searchTerms.some(term => (text || '').toLowerCase().includes(term));
                    const analysis     = radarContext.latestAnalysis.analysis || radarContext.latestAnalysis;

                    radarContext.relevantTrends        = (analysis.trends        || []).filter(t => isRelevant(t.topic)       || isRelevant(t.description));
                    radarContext.relevantOpportunities = (analysis.opportunities || []).filter(o => isRelevant(o.title)       || isRelevant(o.description));
                    radarContext.relevantRisks         = (analysis.risks         || []).filter(r => isRelevant(r.title)       || isRelevant(r.description));
                }

                const { data: hubRows } = await instanceSelect('intelligence_entries', 'data', userId, req.instanceId);
                const hubData      = (hubRows ?? []).map(row => row.data);
                const subjectWords = subject.toLowerCase().split(' ');
                const contextWords = context ? context.toLowerCase().split(' ') : [];
                const searchTerms  = [actor.toLowerCase()].concat(subjectWords, contextWords).filter(t => t.length >= 3);

                radarContext.relevantFeedbacks = hubData.filter(f => {
                    const body   = (f.body || f.content || f.text || f.description || '').toLowerCase();
                    const source = (f.source || f.person || '').toLowerCase();
                    if (body.includes('[backlog question]')) return false;
                    return source.includes(actor.toLowerCase()) || searchTerms.some(term => body.includes(term));
                }).slice(0, 10);
            } catch (e) { console.warn('⚠️ Contexte Radar indisponible:', e.message); }

            let radarSection = '';
            if (radarContext.hasData || radarContext.relevantFeedbacks.length > 0) {
                radarSection = `
📊 INTELLIGENCE RADAR :

Vision : ${radarContext.productContext.vision}
Objectifs : ${radarContext.productContext.objectives.map((o, i) => `${i+1}. ${o}`).join(', ')}

Tendances pertinentes : ${radarContext.relevantTrends.map(t => `- ${t.topic} : ${t.description}`).join('\n') || '- Aucune'}
Opportunités : ${radarContext.relevantOpportunities.map(o => `- ${o.title} : ${o.description}`).join('\n') || '- Aucune'}
Risques : ${radarContext.relevantRisks.map(r => `- ${r.title} : ${r.description}`).join('\n') || '- Aucun'}

Feedbacks récents pertinents :
${radarContext.relevantFeedbacks.map((f, i) => {
    const content = f.body || f.content || f.text || f.description || '';
    const source  = f.person || f.source || 'Source inconnue';
    const date    = f.date || f.createdAt || 'Date inconnue';
    return `FEEDBACK #${i+1}:\nSource : ${source} | Date : ${date}\nContenu : "${content}"`;
}).join('\n---\n') || '- Aucun feedback trouvé'}
`;
            } else {
                radarSection = '⚠️ AUCUNE ANALYSE RADAR DISPONIBLE';
            }

            const prompt = prompts.buildMeetingPrepPrompt({
                actor, subject, context, format, radarSection,
                relevantFeedbacks: radarContext.relevantFeedbacks,
            });

            const analysis = await callAI({
                model: MODELS.haiku, maxTokens: 2500,
                messages: [{ role: 'user', content: prompt }],
                callType: 'meeting_prep',
                req,
            });
            if (!analysis) throw new Error("Réponse vide de l'API Claude");

            res.json({
                success: true,
                analysis,
                radarEnriched: radarContext.hasData,
                radarInsights: {
                    trendsUsed:        radarContext.relevantTrends.length,
                    opportunitiesUsed: radarContext.relevantOpportunities.length,
                    risksUsed:         radarContext.relevantRisks.length,
                    feedbacksUsed:     radarContext.relevantFeedbacks.length,
                },
            });
        } catch (error) {
            apiError(res, error, 'meeting-prep');
        }
    });

    // ── POST /api/post-meeting ────────────────────────────────────────────────

    router.post('/post-meeting', aiLimiter, async (req, res) => {
        try {
            const { notes, actor } = req.body;
            if (!notes) return res.status(400).json({ error: 'Les notes de réunion sont requises' });
            const analysis = await callAI({
                model: MODELS.haiku, maxTokens: 2000,
                messages: [{ role: 'user', content: prompts.buildPostMeetingPrompt({ notes, actor }) }],
                callType: 'post_meeting',
                req,
            });
            if (!analysis) throw new Error('Réponse vide');
            res.json({ success: true, analysis });
        } catch (error) {
            apiError(res, error, 'post-meeting');
        }
    });

    // ── POST /api/meeting-prep/save ───────────────────────────────────────────

    router.post('/meeting-prep/save', async (req, res) => {
        const userId = req.userId;
        const { actor, subject, context, format, meetingDate, secretBrief, publicAgenda, radarInsights } = req.body;
        if (!subject) return res.status(400).json({ error: 'subject is required' });

        const record = {
            actor:        actor        || '',
            subject,
            context:      context      || '',
            format:       format       || 'Réunion',
            meetingDate:  meetingDate  || new Date().toISOString().split('T')[0],
            secretBrief:  secretBrief  || '',
            publicAgenda: publicAgenda || '',
            radarInsights: radarInsights || { trendsUsed: 0, opportunitiesUsed: 0, risksUsed: 0, feedbacksUsed: 0 },
        };

        const { error } = await supabase
            .from('meeting_prep_history')
            .insert({ user_id: userId, instance_id: req.instanceId, data: record });

        if (error) {
            console.error('❌ meeting-prep/save:', error.message);
            return apiError(res, error);
        }
        res.json({ success: true });
    });

    // ── GET /api/meeting-prep/history ─────────────────────────────────────────

    router.get('/meeting-prep/history', async (req, res) => {
        const userId = req.userId;
        const { data, error } = await instanceSelect('meeting_prep_history', 'id, created_at, data', userId, req.instanceId)
            .order('created_at', { ascending: false });

        if (error) {
            console.error('❌ meeting-prep/history:', error.message);
            return apiError(res, error);
        }
        res.json((data ?? []).map(row => ({ id: row.id, savedAt: row.created_at, ...row.data })));
    });

    return router;
};

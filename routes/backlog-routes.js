'use strict';
/**
 * routes/backlog-routes.js
 *
 * GET    /api/backlog               — list stories (Jira-ranked first, then RICE)
 * POST   /api/backlog               — create story
 * GET    /api/backlog/summary       — plain-text summary
 * PUT    /api/backlog/:fileName     — update story (tracks status history)
 * POST   /api/backlog/reorder       — persist display_order
 * POST   /api/backlog/suggest-order — RICE-based reorder suggestions (no DB write)
 * POST   /api/backlog/smart-audit   — AI citation-validated RICE audit
 *   ⚠  NEVER modify the smart-audit citation validation logic (HARD RULE)
 */

const { Router } = require('express');
const { makeHelpers } = require('../utils/db-helpers');
const { apiError }   = require('../utils/api-error');
const { MODELS, callAI } = require('../shared/ai-client');
const prompts = require('../shared/prompts');

module.exports = function createBacklogRouter(supabase, { aiLimiter } = {}) {
    const router = Router();
    const { instanceSelect } = makeHelpers(supabase);

    async function loadVision(userId, instanceId) {
        const { data } = await instanceSelect('vision', 'data', userId, instanceId).single();
        return data?.data?.vision ?? 'Non définie';
    }

    // ── GET /api/backlog ──────────────────────────────────────────────────────

    router.get('/', async (req, res) => {
        const userId = req.userId;
        const { data, error } = await instanceSelect('backlog_stories', 'filename, data, display_order', userId, req.instanceId);
        if (error) return apiError(res, error);
        const stories = (data ?? []).map(row => Object.assign({}, row.data, { fileName: row.filename }));
        // Sort: Jira-ranked stories by jiraRank, local stories by RICE score at the end
        stories.sort((a, b) => {
            const aHasRank = a.jiraRank != null;
            const bHasRank = b.jiraRank != null;
            if (aHasRank && bHasRank) return a.jiraRank - b.jiraRank;
            if (aHasRank) return -1;
            if (bHasRank) return 1;
            return (b.rice?.score || 0) - (a.rice?.score || 0);
        });
        res.json(stories);
    });

    // ── POST /api/backlog ─────────────────────────────────────────────────────

    router.post('/', async (req, res) => {
        const userId = req.userId;
        const { title, content, contentText, rice, status, storyData, labels, source, projectKey, issueType, priority, sprintName } = req.body;
        const timestamp   = Date.now();
        const now         = new Date().toISOString();
        const storyStatus = status ?? storyData?.status ?? 'To Do';
        const finalStory  = {
            id:          timestamp,
            externalId:  null,
            source:      source      ?? 'grooming',
            projectKey:  projectKey  ?? null,
            issueType:   issueType   ?? 'Story',
            priority:    priority    ?? null,
            title:        title       ?? storyData?.title,
            content:      content     ?? storyData?.content,
            contentText:  contentText ?? null,
            status:      storyStatus,
            sprintName:  sprintName  ?? null,
            createdAt:   now,
            updatedAt:   now,
            resolvedAt:  null,
            rice:        rice        ?? storyData?.rice ?? { reach: 0, impact: 0, confidence: 0, effort: 0, score: 0 },
            labels:      labels      ?? [],
            history:     [{ field: 'status', from: null, to: storyStatus, changedAt: now }],
            comments:    [],
        };
        const fileName = `story-${timestamp}.json`;
        const { error } = await supabase
            .from('backlog_stories')
            .insert({ user_id: userId, instance_id: req.instanceId, filename: fileName, data: finalStory, display_order: 0 });
        if (error) {
            console.error('❌ Erreur Backlog Save:', error);
            return apiError(res, error);
        }
        res.json({ success: true, fileName, title, riceScore: finalStory.rice.score });
    });

    // ── GET /api/backlog/summary ──────────────────────────────────────────────

    router.get('/summary', async (req, res) => {
        const userId = req.userId;
        const { data, error } = await instanceSelect('backlog_stories', 'data', userId, req.instanceId);
        if (error) return apiError(res, error);
        let summary = '';
        (data ?? []).forEach(row => {
            summary += `- [${row.data.status || 'To Do'}] ${row.data.title}\n`;
        });
        res.json({ summary: summary || 'Le backlog est vide.' });
    });

    // ── PUT /api/backlog/:fileName ────────────────────────────────────────────

    router.put('/:fileName', async (req, res) => {
        const userId = req.userId;
        const { fileName } = req.params;
        const { data: existing, error: fetchError } = await instanceSelect('backlog_stories', 'data', userId, req.instanceId)
            .eq('filename', fileName)
            .single();
        if (fetchError || !existing) return res.status(404).send('Fichier non trouvé');
        const currentData = existing.data;
        const now = new Date().toISOString();

        // Track status changes in history
        if (req.body.status && req.body.status !== currentData.status) {
            currentData.history = currentData.history || [];
            currentData.history.push({ field: 'status', from: currentData.status ?? null, to: req.body.status, changedAt: now });
            if (req.body.status === 'Done') currentData.resolvedAt = now;
        }

        Object.assign(currentData, req.body);
        currentData.updatedAt = now;
        const { error } = await supabase
            .from('backlog_stories')
            .update({ data: currentData })
            .eq('user_id', userId)
            .eq('instance_id', req.instanceId)
            .eq('filename', fileName);
        if (error) return apiError(res, error);
        res.json({ success: true });
    });

    // ── POST /api/backlog/reorder ─────────────────────────────────────────────

    router.post('/reorder', async (req, res) => {
        const userId = req.userId;
        const { orderedFiles } = req.body;
        await Promise.all(orderedFiles.map((fileName, index) =>
            supabase
                .from('backlog_stories')
                .update({ display_order: index })
                .eq('user_id', userId)
                .eq('instance_id', req.instanceId)
                .eq('filename', fileName)
        ));
        res.json({ success: true });
    });

    // ── POST /api/backlog/suggest-order ───────────────────────────────────────

    router.post('/suggest-order', async (req, res) => {
        try {
            const stories = req.body.stories;
            if (!Array.isArray(stories) || stories.length > 500) {
                return res.status(400).json({ error: 'stories must be an array of ≤ 500 items' });
            }
            const idealOrder = stories.slice().sort((a, b) => (b.rice?.score || 0) - (a.rice?.score || 0));
            const suggestions = [];
            idealOrder.slice(0, 3).forEach((story, idealIndex) => {
                const realIndex = stories.findIndex(s => s.fileName === story.fileName);
                if (realIndex > idealIndex) {
                    suggestions.push({ fileName: story.fileName, reason: `Priorité RICE élevée (${story.rice.score})` });
                }
            });
            res.json({ suggestions: suggestions.slice(0, 2) });
        } catch (e) { apiError(res, e); }
    });

    // ── POST /api/backlog/smart-audit ─────────────────────────────────────────
    // ⚠ NEVER modify the citation validation logic below (HARD RULE)

    router.post('/smart-audit', aiLimiter, async (req, res) => {
        try {
            const userId = req.userId;
            const stories = req.body.stories;
            if (!Array.isArray(stories) || stories.length > 200) {
                return res.status(400).json({ error: 'stories must be an array of ≤ 200 items' });
            }

            const { data: hubRows } = await instanceSelect('intelligence_entries', 'data', userId, req.instanceId);
            const allData = (hubRows ?? []).map(row => row.data);
            const feedbacks = allData.filter(f => {
                const content = (f.content || f.text || f.description || f.body || '').toLowerCase();
                return !content.includes('[story:') && !content.includes('[backlog') &&
                       !content.includes('question dev:') && !content.includes('how do you quantify');
            });
            if (feedbacks.length === 0) {
                return res.json({ audits: [], duplicates: [], message: "Aucun feedback utilisateur dans l'Intelligence Hub." });
            }

            let context = { vision: 'Non définie', objectives: [] };
            try {
                context.vision = await loadVision(userId, req.instanceId);
                const { data: settingsRow } = await instanceSelect('settings', 'data', userId, req.instanceId).single();
                if (settingsRow?.data) context.objectives = settingsRow.data.objectives || [];
            } catch (e) { console.warn('⚠️ Contexte produit incomplet'); }

            const storiesSummary = stories.map(s => ({
                fileName:          s.fileName,
                title:             s.title,
                currentRiceScore:  s.rice?.score      || 0,
                currentReach:      s.rice?.reach      || 0,
                currentImpact:     s.rice?.impact     || 0,
                currentConfidence: s.rice?.confidence || 100,
                currentEffort:     s.rice?.effort     || 1,
                excerpt:           (s.content || '').substring(0, 300),
            }));

            const systemPrompt = prompts.buildSmartAuditSystem({ context });
            const userPrompt   = prompts.buildSmartAuditUser({ feedbacks, storiesSummary });

            const rawText = await callAI({
                model:     MODELS.haikuLegacy,
                maxTokens: 3000,
                system:    systemPrompt,
                messages:  [{ role: 'user', content: userPrompt }],
                callType:  'smart_audit',
                req,
            });
            const jsonMatch = rawText.match(/\{[\s\S]*\}/);
            if (!jsonMatch) return res.json({ audits: [], duplicates: [] });

            const analysisJSON = JSON.parse(jsonMatch[0]);
            const feedbackTexts = feedbacks.map(f => (f.content || f.text || f.description || f.body || '').toLowerCase());

            const validAudits = (analysisJSON.audits || []).filter((audit) => {
                const story = stories.find(s => s.fileName === audit.fileName);
                if (!story) { console.warn('❌ REJETÉ : Story non trouvée'); return false; }

                const currentImpact   = story.rice?.impact || 0;
                const suggestedImpact = audit.suggestedImpact;

                if (currentImpact === suggestedImpact) { console.warn('❌ REJETÉ : Impact identique'); return false; }
                if (suggestedImpact < 0 || suggestedImpact > 10) { console.warn('❌ REJETÉ : Hors limites'); return false; }

                if (audit.type === 'overvalued'  && suggestedImpact >= currentImpact) { console.warn('❌ REJETÉ : overvalued mais suggère augmenter'); return false; }
                if (audit.type === 'undervalued' && suggestedImpact <= currentImpact) { console.warn('❌ REJETÉ : undervalued mais suggère diminuer'); return false; }
                if (audit.type === 'undervalued' && currentImpact >= 9)              { console.warn('❌ REJETÉ : Impact déjà max'); return false; }

                if (!audit.evidence || audit.evidence.length === 0) { console.warn('❌ REJETÉ : Aucune evidence'); return false; }

                const invalidPatterns = ['pas de citation', 'feedbacks sont vides', 'aucun feedback', 'pas de feedback', 'aucun commentaire', 'aucune mention'];
                const hasInvalid = audit.evidence.some(e => {
                    if (!e || typeof e !== 'string' || e.trim().length < 15) return true;
                    return invalidPatterns.some(p => e.toLowerCase().includes(p));
                });
                if (hasInvalid) { console.warn('❌ REJETÉ : Evidence invalide'); return false; }

                const hasFake = audit.evidence.some((e) => {
                    let clean = e.toLowerCase();
                    const ci  = clean.indexOf(':');
                    if (ci > -1) clean = clean.substring(ci + 1).trim();
                    clean = clean.replace(/['"]/g, '').trim();
                    const words = clean.split(' ').filter(w => w.length > 2);
                    let found = false;
                    for (let len = 8; len >= 3 && !found; len--) {
                        for (let j = 0; j <= words.length - len; j++) {
                            const phrase = words.slice(j, j + len).join(' ');
                            if (phrase.length >= 15 && feedbackTexts.some(ft => ft.includes(phrase))) {
                                found = true;
                                break;
                            }
                        }
                    }
                    return !found;
                });
                if (hasFake) { console.warn('❌ REJETÉ : Citations inventées'); return false; }

                audit.currentImpact = currentImpact;
                return true;
            });

            const totalAudits   = (analysisJSON.audits || []).length;
            const rejectedCount = totalAudits - validAudits.length;
            console.log(`\n🏁 ${validAudits.length}/${totalAudits} audits valides | ${(analysisJSON.duplicates || []).length} doublon(s)\n`);
            res.json({ audits: validAudits, duplicates: analysisJSON.duplicates || [], rejected: rejectedCount });

        } catch (e) {
            console.error('💥 Erreur Smart Audit:', e.message);
            apiError(res, e);
        }
    });

    return router;
};

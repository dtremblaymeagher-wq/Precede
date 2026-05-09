'use strict';
/**
 * routes/hub-routes.js
 *
 * GET    /api/intelligence-hub/entries                  — list all entries
 * GET    /api/intelligence-hub/new-since-last-analysis  — count new signals
 * POST   /api/intelligence-hub/entry                    — create entry
 * PUT    /api/intelligence-hub/entry/:id                — update entry
 * DELETE /api/intelligence-hub/entry/:id                — delete entry
 * GET    /api/intelligence-hub/entry/:id/download       — signed download URL
 * POST   /api/intelligence-hub/chat                     — conversational search
 */

const { Router }         = require('express');
const { apiError }       = require('../utils/api-error');
const { makeHelpers }    = require('../utils/db-helpers');
const { callAI, MODELS } = require('../shared/ai-client');

const ENTRY_SOURCE_TYPES = new Set([
    'Meeting', 'Email', 'Intercom', 'Support Ticket',
    'Sales', 'Insight', 'Sprint Question', 'Autre',
]);

function validateEntry(raw, { requireBody = false } = {}) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return { error: 'Invalid entry body' };
    }
    const { id, body, person, sourceType, date, createdAt, updatedAt, tags,
            title, raw_text, file_path, file_name, file_type } = raw;

    if (requireBody || body !== undefined) {
        if (typeof body !== 'string' || body.trim() === '') {
            return { error: 'body is required and must be a non-empty string' };
        }
        if (body.length > 10_000) {
            return { error: 'body exceeds 10 000 character limit' };
        }
    }
    if (id !== undefined && (typeof id !== 'string' || id.length > 100)) {
        return { error: 'id must be a string ≤ 100 chars' };
    }
    if (person !== undefined && (typeof person !== 'string' || person.length > 200)) {
        return { error: 'person must be a string ≤ 200 chars' };
    }
    if (sourceType !== undefined && !ENTRY_SOURCE_TYPES.has(sourceType)) {
        return { error: `sourceType must be one of: ${[...ENTRY_SOURCE_TYPES].join(', ')}` };
    }
    if (date !== undefined && (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date))) {
        return { error: 'date must be YYYY-MM-DD' };
    }
    if (tags !== undefined && (!Array.isArray(tags) || tags.some(t => typeof t !== 'string' || t.length > 100))) {
        return { error: 'tags must be an array of strings ≤ 100 chars each' };
    }

    const clean = {};
    if (id !== undefined)         clean.id         = id;
    if (body !== undefined)       clean.body       = body;
    if (person !== undefined)     clean.person     = person;
    if (sourceType !== undefined) clean.sourceType = sourceType;
    if (date !== undefined)       clean.date       = date;
    if (createdAt !== undefined)  clean.createdAt  = createdAt;
    if (updatedAt !== undefined)  clean.updatedAt  = updatedAt;
    if (tags !== undefined)       clean.tags       = tags;
    // File-backed entry fields
    if (title     !== undefined)  clean.title     = typeof title     === 'string' ? title.slice(0, 120)    : undefined;
    if (raw_text  !== undefined)  clean.raw_text  = typeof raw_text  === 'string' ? raw_text               : undefined;
    if (file_path !== undefined)  clean.file_path = typeof file_path === 'string' ? file_path.slice(0, 512): undefined;
    if (file_name !== undefined)  clean.file_name = typeof file_name === 'string' ? file_name.slice(0, 255): undefined;
    if (file_type !== undefined)  clean.file_type = typeof file_type === 'string' ? file_type.slice(0, 50) : undefined;
    return { clean };
}

module.exports = function hubRoutes(supabase, { aiLimiter } = {}) {
    const router = Router();
    const { instanceSelect } = makeHelpers(supabase);

    router.get('/new-since-last-analysis', async (req, res) => {
        try {
            const userId = req.userId;
            const { data: historyRows } = await instanceSelect('analysis_history', 'created_at', userId, req.instanceId)
                .order('created_at', { ascending: false })
                .limit(1);

            if (!historyRows || historyRows.length === 0) {
                return res.json({ count: 0, since: null });
            }
            const lastAnalysisAt = historyRows[0].created_at;
            const { count } = await supabase
                .from('intelligence_entries')
                .select('id', { count: 'exact', head: true })
                .eq('user_id', userId)
                .eq('instance_id', req.instanceId)
                .gt('created_at', lastAnalysisAt);

            res.json({ count: count ?? 0, since: lastAnalysisAt.slice(0, 10) });
        } catch (e) {
            apiError(res, e, 'hub/new-since');
        }
    });

    router.get('/entries', async (req, res) => {
        const userId = req.userId;
        const { data, error } = await instanceSelect('intelligence_entries', 'data', userId, req.instanceId)
            .order('created_at', { ascending: false });
        if (error) return apiError(res, error, 'hub GET');
        // raw_text is stripped from the list response — it's stored server-side
        // for future RAG/search features and must not bloat AI prompt contexts.
        res.json((data ?? []).map(row => {
            const { raw_text: _raw, ...entry } = row.data ?? {};
            return entry;
        }));
    });

    // Generates a signed download URL (1 hour) for a PDF entry.
    // Validates the entry belongs to the authenticated user + instance before signing.
    router.get('/entry/:id/download', async (req, res) => {
        const userId = req.userId;
        const { id } = req.params;

        const { data, error } = await instanceSelect('intelligence_entries', 'data', userId, req.instanceId)
            .eq('data->>id', id)
            .single();
        if (error || !data) return res.status(404).json({ error: 'Entry not found' });

        const filePath = data.data?.file_path;
        if (!filePath) return res.status(404).json({ error: 'No file attached to this entry' });

        const { data: signedData, error: signErr } = await supabase.storage
            .from('entry-files')
            .createSignedUrl(filePath, 3600); // 1 hour
        if (signErr) return apiError(res, signErr, 'hub/download');

        res.json({ url: signedData.signedUrl });
    });

    router.post('/entry', async (req, res) => {
        const userId = req.userId;
        const { error: validErr, clean } = validateEntry(req.body, { requireBody: true });
        if (validErr) return res.status(400).json({ error: validErr });

        const { error } = await supabase
            .from('intelligence_entries')
            .insert({ user_id: userId, instance_id: req.instanceId, data: clean });
        if (error) return apiError(res, error, 'hub POST');
        res.json({ success: true });
    });

    router.put('/entry/:id', async (req, res) => {
        const userId = req.userId;
        const { id } = req.params;
        const { error: validErr, clean } = validateEntry(req.body);
        if (validErr) return res.status(400).json({ error: validErr });

        const { error } = await supabase
            .from('intelligence_entries')
            .update({ data: clean })
            .filter('data->>id', 'eq', id)
            .eq('user_id', userId)
            .eq('instance_id', req.instanceId);
        if (error) return apiError(res, error, 'hub PUT');
        res.json({ success: true });
    });

    router.delete('/entry/:id', async (req, res) => {
        const userId = req.userId;
        const { id } = req.params;
        const { error } = await supabase
            .from('intelligence_entries')
            .delete()
            .filter('data->>id', 'eq', id)
            .eq('user_id', userId)
            .eq('instance_id', req.instanceId);
        if (error) return apiError(res, error, 'hub DELETE');
        res.json({ success: true });
    });

    // ── Conversational search ─────────────────────────────────────────────────
    router.post('/chat', aiLimiter, async (req, res) => {
        const userId = req.userId;
        const { message, history = [] } = req.body;
        if (!message?.trim()) return res.status(400).json({ error: 'message is required' });

        const { data, error } = await instanceSelect('intelligence_entries', 'data', userId, req.instanceId)
            .order('created_at', { ascending: false });
        if (error) return apiError(res, error, 'hub/chat');

        const entries = (data ?? []).map(row => {
            const { raw_text: _, ...e } = row.data ?? {};
            return {
                id:      e.id,
                date:    e.date,
                client:  e.person,
                source:  e.sourceType,
                title:   e.title  || null,
                content: e.body?.slice(0, 300) ?? '',
            };
        });

        if (!entries.length) {
            return res.json({
                answer:    'Your Data Archive is empty. Add some feedback entries to get started.',
                citations: [],
                type:      'none',
            });
        }

        const system = `You are an AI research assistant for a Product Manager. Answer questions ONLY based on the Data Archive entries below — no external knowledge, no assumptions.

Rules:
- Cite every claim with the entry id(s) it comes from
- Synthesis questions → analyze patterns, summarize insights
- List questions → return the relevant entries directly
- No relevant entries → say so clearly, never fabricate
- Respond in the same language as the question

Return ONLY valid JSON (no markdown wrapper):
{
  "type": "synthesis" | "list" | "none",
  "answer": "<response using **bold** for key points and - for bullets>",
  "citations": [{ "id": "<entry_id>", "label": "<client name or short excerpt>" }]
}

Data Archive (${entries.length} entries):
${JSON.stringify(entries)}`;

        const messages = [];
        for (const turn of history.slice(-5)) {
            messages.push({ role: 'user',      content: turn.question });
            messages.push({ role: 'assistant', content: turn.answer_raw });
        }
        messages.push({ role: 'user', content: message });

        try {
            const aiText = await callAI({
                model:     MODELS.sonnet,
                maxTokens: 1024,
                callType:  'archive_chat',
                req,
                system,
                messages,
            });

            let parsed = {};
            try {
                const cleaned = aiText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
                parsed = JSON.parse(cleaned);
            } catch {
                parsed = { type: 'synthesis', answer: aiText, citations: [] };
            }

            res.json({
                answer:    typeof parsed.answer === 'string' ? parsed.answer : aiText,
                citations: Array.isArray(parsed.citations) ? parsed.citations.slice(0, 10) : [],
                type:      ['synthesis', 'list', 'none'].includes(parsed.type) ? parsed.type : 'synthesis',
            });
        } catch (err) {
            apiError(res, err, 'hub/chat');
        }
    });

    return router;
};

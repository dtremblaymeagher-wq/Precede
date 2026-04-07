'use strict';
/**
 * routes/integration-routes.js
 *
 * POST /api/integration/save-config  — save/update Jira config
 * GET  /api/integration/config       — read config (apiKey omitted)
 * POST /api/integration/test         — test connection
 * POST /api/integration/push-story   — push one story to Jira (30s rate limit per user)
 * POST /api/integration/sync-signals — pull Jira signals into Intelligence Hub
 */

const { Router } = require('express');
const { makeHelpers }          = require('../utils/db-helpers');
const { makeIntegrationUtils } = require('../utils/integration-utils');
const { apiError }             = require('../utils/api-error');
const { getIntegration }       = require('../integrations');
const { encrypt, decrypt }     = require('../utils/credentials-crypto');

// Rate-limit map for push-story: userId → timestamp of last push
const _pushStoryLastAt    = new Map();
const PUSH_STORY_COOLDOWN = 30_000;

module.exports = function createIntegrationRouter(supabase) {
    const router = Router();
    const { instanceSelect }                            = makeHelpers(supabase);
    const { loadIntegrationConfig, validateJiraBaseUrl } = makeIntegrationUtils(supabase);

    // ── POST /api/integration/save-config ────────────────────────────────────

    router.post('/save-config', async (req, res) => {
        try {
            const userId     = req.userId;
            const type       = (req.body.type       || '').trim();
            const baseUrl    = (req.body.baseUrl    || '').trim().replace(/\/$/, '');
            const email      = (req.body.email      || '').trim();
            const apiKey     = (req.body.apiKey     || '').trim();
            const projectKey = (req.body.projectKey || '').trim();
            const boardId    = req.body.boardId ? parseInt(req.body.boardId) : null;

            if (!type || !baseUrl || !email)
                return res.status(400).json({ error: 'type, baseUrl, and email are required' });

            const urlErr = validateJiraBaseUrl(baseUrl);
            if (urlErr) return res.status(400).json({ error: urlErr });

            // Preserve existing API key if none supplied; fall back to another instance of same user.
            // Always work with plaintext internally — encrypt only at the storage step.
            let finalApiKey = apiKey || null;
            if (!finalApiKey) {
                const { data: existing } = await instanceSelect('integrations', 'config', userId, req.instanceId)
                    .maybeSingle();
                finalApiKey = decrypt(existing?.config?.apiKey || null);
            }
            if (!finalApiKey) {
                const { data: anyInstance } = await supabase
                    .from('integrations')
                    .select('config')
                    .eq('user_id', userId)
                    .neq('instance_id', req.instanceId)
                    .limit(1)
                    .maybeSingle();
                finalApiKey = decrypt(anyInstance?.config?.apiKey || null);
            }
            if (!finalApiKey)
                return res.status(400).json({ error: 'API key is required for first-time setup' });

            const { error: upsertError } = await supabase
                .from('integrations')
                .upsert(
                    { user_id: userId, instance_id: req.instanceId, type, config: { baseUrl, email, apiKey: encrypt(finalApiKey), projectKey, boardId }, updated_at: new Date().toISOString() },
                    { onConflict: 'user_id,instance_id' }
                );
            if (upsertError) return apiError(res, upsertError, 'integration/save-config upsert');
            res.json({ success: true });
        } catch (e) {
            apiError(res, e, 'integration/save-config');
        }
    });

    // ── GET /api/integration/config (omits apiKey) ───────────────────────────

    router.get('/config', async (req, res) => {
        try {
            const userId = req.userId;
            const { data } = await instanceSelect('integrations', 'type, config, updated_at', userId, req.instanceId)
                .single();
            if (!data) return res.json(null);
            const { apiKey: _omit, ...safeConfig } = data.config || {};
            res.json({ type: data.type, ...safeConfig, updatedAt: data.updated_at });
        } catch (e) {
            apiError(res, e);
        }
    });

    // ── POST /api/integration/test ────────────────────────────────────────────

    router.post('/test', async (req, res) => {
        try {
            const userId = req.userId;
            const config = await loadIntegrationConfig(userId, req.instanceId);
            if (!config) return res.status(404).json({ success: false, message: 'No integration configured' });
            const integration = getIntegration(config);
            const result = await integration.testConnection();
            res.json(result);
        } catch (e) {
            apiError(res, e, 'integration/test');
        }
    });

    // ── POST /api/integration/push-story (30s rate limit per user) ───────────

    router.post('/push-story', async (req, res) => {
        try {
            const userId = req.userId;
            const { fileName } = req.body;
            if (!fileName) return res.status(400).json({ error: 'fileName is required' });

            const lastAt  = _pushStoryLastAt.get(userId) || 0;
            const elapsed = Date.now() - lastAt;
            if (elapsed < PUSH_STORY_COOLDOWN) {
                const wait = Math.ceil((PUSH_STORY_COOLDOWN - elapsed) / 1000);
                return res.status(429).json({ error: `Rate limit — wait ${wait}s before pushing another story to Jira.` });
            }
            _pushStoryLastAt.set(userId, Date.now());

            const config = await loadIntegrationConfig(userId, req.instanceId);
            if (!config) return res.status(404).json({ error: 'No integration configured' });

            const { data: row } = await instanceSelect('backlog_stories', 'data', userId, req.instanceId)
                .eq('filename', fileName)
                .single();
            if (!row) return res.status(404).json({ error: 'Story not found' });

            const story = row.data;
            const integration = getIntegration(config);
            const plainDescription = story.contentText
                || (story.content || '')
                    .replace(/<br\s*\/?>/gi, '\n')
                    .replace(/<\/p>/gi, '\n\n')
                    .replace(/<\/h[1-6]>/gi, '\n\n')
                    .replace(/<\/li>/gi, '\n')
                    .replace(/<\/div>/gi, '\n')
                    .replace(/<[^>]+>/g, '')
                    .replace(/\n{3,}/g, '\n\n')
                    .trim();
            const result = await integration.createTicket({
                title:       story.title || fileName,
                description: plainDescription,
                riceScore:   story.rice?.score || 0,
                labels:      [...(story.labels || []), 'pm-ai-toolkit'],
                issueType:   story.issueType || 'Story',
            });

            const now = new Date().toISOString();
            const updatedData = {
                ...story,
                externalId: result.ticketKey,
                projectKey: config.projectKey ?? story.projectKey,
                updatedAt:  now,
                history:    [...(story.history || []), { field: 'externalId', from: null, to: result.ticketKey, changedAt: now }],
            };
            await supabase
                .from('backlog_stories')
                .update({ data: updatedData })
                .eq('user_id', userId)
                .eq('instance_id', req.instanceId)
                .eq('filename', fileName);

            res.json(result);
        } catch (e) {
            console.error('❌ Integration push-story:', e.message);
            const msg       = e.message || '';
            const jiraMatch = msg.match(/Jira API .+? → (\d+): (.+)/s);
            if (jiraMatch) {
                const status = parseInt(jiraMatch[1], 10);
                let userMsg = 'Jira returned an error. Check your integration settings.';
                if (status === 401 || status === 403) {
                    userMsg = 'Jira rejected the request — your API token may lack "Create Issues" permission on this project.';
                } else if (status === 404) {
                    userMsg = 'Project not found in Jira — check the project key in Settings.';
                } else {
                    try {
                        const body = JSON.parse(jiraMatch[2]);
                        const msgs = body.errorMessages || Object.values(body.errors || {});
                        if (msgs.length) userMsg = msgs.join(' ');
                    } catch (_) { /* keep default */ }
                }
                return res.status(502).json({ error: userMsg });
            }
            apiError(res, e);
        }
    });

    // ── POST /api/integration/sync-signals ───────────────────────────────────

    router.post('/sync-signals', async (req, res) => {
        try {
            const userId = req.userId;
            const config = await loadIntegrationConfig(userId, req.instanceId);
            if (!config) return res.status(404).json({ error: 'No integration configured' });

            const integration = getIntegration(config);
            const signals     = await integration.fetchSignals();
            if (!signals.length) return res.json({ count: 0 });

            const rows = signals.map(s => ({
                user_id:     userId,
                instance_id: req.instanceId,
                data: {
                    id:         crypto.randomUUID(),
                    body:       s.body,
                    person:     s.person,
                    sourceType: s.sourceType,
                    date:       s.date,
                    createdAt:  new Date().toISOString(),
                },
            }));
            await supabase.from('intelligence_entries').insert(rows);
            res.json({ count: signals.length });
        } catch (e) {
            console.error('❌ Integration sync-signals:', e.message);
            apiError(res, e);
        }
    });

    return router;
};

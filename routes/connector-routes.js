'use strict';
/**
 * routes/connector-routes.js
 *
 * Google Drive connector — OAuth lifecycle + file import pipeline.
 *
 * Routes (all under /api/connectors):
 *   GET    /google-drive/auth-url       → { url }
 *   GET    /google-drive/callback       → redirect (INSTANCE_FREE_PATH)
 *   GET    /google-drive/status         → { connected, email? }
 *   GET    /google-drive/folders        → [{ id, name }]
 *   GET    /google-drive/preview        → { supported, unsupported }
 *   POST   /google-drive/import-stream  → SSE (review ≤10 | auto >10)
 *   POST   /google-drive/save-batch     → { imported }
 *   DELETE /google-drive/disconnect     → { success }
 */

const { Router }         = require('express');
const { apiError }       = require('../utils/api-error');
const { callAI, MODELS } = require('../shared/ai-client');
const { encrypt, decrypt } = require('../utils/credentials-crypto');
const { detectFileType, extractText } = require('../utils/file-extractors');
const drive = require('../connectors/google-drive');

const BUCKET   = 'entry-files';
const PROVIDER = 'google-drive';
const REVIEW_THRESHOLD = 10; // files ≤ this → review mode

// ── Token helpers ──────────────────────────────────────────────────────────────

async function loadTokens(supabase, userId, instanceId) {
    const { data, error } = await supabase
        .from('connector_tokens')
        .select('tokens')
        .eq('user_id', userId)
        .eq('instance_id', instanceId)
        .eq('provider', PROVIDER)
        .order('updated_at', { ascending: false })
        .limit(1);
    if (error) { console.error('[connector/loadTokens]', error.message); return null; }
    if (!data || data.length === 0) return null;
    try {
        const decrypted = decrypt(data[0].tokens);
        const parsed = JSON.parse(decrypted);
        // email stored inside the tokens JSON as _email
        return { tokens: parsed, email: parsed._email || null };
    } catch (e) {
        console.error('[connector/loadTokens] decrypt failed:', e.message);
        return null;
    }
}

async function saveTokens(supabase, userId, instanceId, tokens, email) {
    // Store email inside the tokens JSON so no extra column is needed
    const payload = { ...tokens, _email: email || null };
    const encrypted = encrypt(JSON.stringify(payload));
    // Delete first so we don't need a UNIQUE constraint on the table
    await supabase.from('connector_tokens')
        .delete()
        .eq('user_id', userId)
        .eq('instance_id', instanceId)
        .eq('provider', PROVIDER);
    const { error } = await supabase.from('connector_tokens').insert({
        user_id:     userId,
        instance_id: instanceId,
        provider:    PROVIDER,
        tokens:      encrypted,
        updated_at:  new Date().toISOString(),
    });
    if (error) console.error('[connector/saveTokens]', error.message, error);
}

// ── Claude file analysis ───────────────────────────────────────────────────────

async function analyzeFile(rawText, fileName, req) {
    const textForAI = rawText.slice(0, 15_000);
    let aiText;
    try {
        aiText = await callAI({
            model:     MODELS.haiku,
            maxTokens: 600,
            callType:  'drive_file_analysis',
            req,
            messages: [{
                role:    'user',
                content: `You are a PM assistant. Analyze this document and return ONLY a valid JSON object — no markdown, no explanation — with these keys:
- "title": concise title (max 80 chars)
- "summary": self-contained PM-focused summary of key insights, pain points, feature requests, or decisions. Must be a complete sentence or paragraph. Hard limit: 1000 characters.
- "tags": array of up to 5 relevant string tags

Document (filename: ${fileName}):
${textForAI}`,
            }],
        });
    } catch {
        return { title: fileName, summary: rawText.slice(0, 500), tags: [] };
    }

    let parsed = {};
    try {
        const cleaned = aiText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
        parsed = JSON.parse(cleaned);
    } catch { /* use defaults */ }

    return {
        title:   typeof parsed.title   === 'string' ? parsed.title.slice(0, 80)    : fileName,
        summary: typeof parsed.summary === 'string' ? parsed.summary.slice(0, 1000) : rawText.slice(0, 1000),
        tags:    Array.isArray(parsed.tags) ? parsed.tags.slice(0, 5).map(t => String(t).slice(0, 100)) : [],
    };
}

// ── SSE helpers ────────────────────────────────────────────────────────────────

function sseStart(res) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
}

function sseSend(res, data) {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
}

// ── Module ─────────────────────────────────────────────────────────────────────

module.exports = function connectorRoutes(supabase, { aiLimiter } = {}) {
    const router = Router();

    // ── Auth URL ───────────────────────────────────────────────────────────────

    router.get('/google-drive/auth-url', (req, res) => {
        try {
            const url = drive.getAuthUrl(req.userId, req.instanceId);
            res.json({ url });
        } catch (err) {
            apiError(res, err, 'connector/auth-url');
        }
    });

    // ── OAuth Callback (INSTANCE_FREE_PATH — no X-Instance-Id header) ─────────

    router.get('/google-drive/callback', async (req, res) => {
        const { code, state, error: oauthError } = req.query;

        if (oauthError) {
            return res.redirect(`/Modules/intelligence-hub/data-archive.html?drive_error=${encodeURIComponent(oauthError)}`);
        }
        if (!code) {
            return res.redirect('/Modules/intelligence-hub/data-archive.html?drive_error=missing_code');
        }

        const parsed = drive.verifyState(state);
        if (!parsed) {
            return res.redirect('/Modules/intelligence-hub/data-archive.html?drive_error=invalid_state');
        }

        const { userId, instanceId } = parsed;

        try {
            const tokens = await drive.exchangeCode(code);
            const info   = await drive.getUserInfo(tokens.access_token).catch(() => ({}));
            await saveTokens(supabase, userId, instanceId, tokens, info.email);
            res.redirect('/Modules/intelligence-hub/data-archive.html?drive_connected=1');
        } catch (err) {
            console.error('[connector/callback]', err);
            res.redirect(`/Modules/intelligence-hub/data-archive.html?drive_error=${encodeURIComponent(err.message)}`);
        }
    });

    // ── Status ─────────────────────────────────────────────────────────────────

    router.get('/google-drive/status', async (req, res) => {
        try {
            const record = await loadTokens(supabase, req.userId, req.instanceId);
            if (!record) return res.json({ connected: false });
            res.json({ connected: true, email: record.email || null });
        } catch (err) {
            apiError(res, err, 'connector/status');
        }
    });

    // ── Folder browser ─────────────────────────────────────────────────────────

    router.get('/google-drive/folders', async (req, res) => {
        try {
            const record = await loadTokens(supabase, req.userId, req.instanceId);
            if (!record) return res.status(401).json({ error: 'Google Drive not connected' });

            const accessToken = await drive.getValidToken(record.tokens, supabase, req.userId, req.instanceId);
            const parentId    = req.query.parentId || 'root';
            const folders     = await drive.listFolders(accessToken, parentId);
            res.json(folders);
        } catch (err) {
            apiError(res, err, 'connector/folders');
        }
    });

    // ── File preview in folder ─────────────────────────────────────────────────

    router.get('/google-drive/preview', async (req, res) => {
        const { folderId } = req.query;
        if (!folderId) return res.status(400).json({ error: 'folderId is required' });

        try {
            const record = await loadTokens(supabase, req.userId, req.instanceId);
            if (!record) return res.status(401).json({ error: 'Google Drive not connected' });

            const accessToken = await drive.getValidToken(record.tokens, supabase, req.userId, req.instanceId);
            const { supported, unsupported } = await drive.listFilesInFolder(accessToken, folderId);
            res.json({ supported, unsupported });
        } catch (err) {
            apiError(res, err, 'connector/preview');
        }
    });

    // ── Import stream (SSE) ────────────────────────────────────────────────────
    // Body: { files: [{id, name, mimeType}], meta: { client, sourceType, date } }
    // mode auto (>10 files) → download + extract + analyze + save; stream progress
    // mode review (≤10)     → download + extract + analyze; stream progress + return entries

    router.post('/google-drive/import-stream', aiLimiter, async (req, res) => {
        const { files, meta = {} } = req.body;

        if (!Array.isArray(files) || files.length === 0) {
            return res.status(400).json({ error: 'files array is required' });
        }
        if (files.length > 100) {
            return res.status(400).json({ error: 'Maximum 100 files per import' });
        }

        sseStart(res);

        const userId     = req.userId;
        const instanceId = req.instanceId;
        const total      = files.length;
        const isReview   = total <= REVIEW_THRESHOLD;
        const prepared   = []; // review mode accumulator
        const errors     = [];

        let record;
        try {
            record = await loadTokens(supabase, userId, instanceId);
            if (!record) {
                sseSend(res, { type: 'error', message: 'Google Drive not connected' });
                return res.end();
            }
        } catch (err) {
            sseSend(res, { type: 'error', message: err.message });
            return res.end();
        }

        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const { id: fileId, name: fileName, mimeType, createdTime } = file;

            try {
                // Refresh token once per file in case it expires mid-import
                const accessToken = await drive.getValidToken(record.tokens, supabase, userId, instanceId);

                // Step 1: download (Google-native files are exported to Office format)
                sseSend(res, { type: 'progress', current: i + 1, total, fileName, step: 'downloading' });
                const { buffer, effectiveMime } = await drive.downloadFile(accessToken, fileId, mimeType);

                // Step 2: detect type + extract text (use effectiveMime after export)
                sseSend(res, { type: 'progress', current: i + 1, total, fileName, step: 'extracting' });
                const fileType = detectFileType(effectiveMime, fileName);
                if (!fileType) {
                    errors.push({ fileName, error: 'Unsupported file type' });
                    sseSend(res, { type: 'file_error', fileName, error: 'Unsupported file type' });
                    continue;
                }
                const rawText = await extractText(buffer, fileType);
                if (!rawText) {
                    errors.push({ fileName, error: 'Could not extract text' });
                    sseSend(res, { type: 'file_error', fileName, error: 'Could not extract text' });
                    continue;
                }

                // Step 3: upload original to Supabase Storage
                const safeName    = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
                const storagePath = `${userId}/${instanceId}/${Date.now()}_${safeName}`;
                const { error: storageErr } = await supabase.storage
                    .from(BUCKET)
                    .upload(storagePath, buffer, { contentType: effectiveMime, upsert: false });
                if (storageErr) throw storageErr;

                // Step 4: Claude analysis
                sseSend(res, { type: 'progress', current: i + 1, total, fileName, step: 'analyzing' });
                const { title, summary, tags } = await analyzeFile(rawText, fileName, req);

                const entry = {
                    title,
                    body:      summary,
                    raw_text:  rawText,
                    file_path: storagePath,
                    file_name: fileName,
                    file_type: fileType,
                    tags,
                    person:     meta.client     || null,
                    sourceType: meta.sourceType || null,
                    date:       meta.date       || (createdTime ? createdTime.slice(0, 10) : new Date().toISOString().slice(0, 10)),
                    driveFileId: fileId,
                };

                if (isReview) {
                    prepared.push(entry);
                } else {
                    // Auto-import: save directly
                    const { body, raw_text, file_path, file_name, file_type,
                            title: entryTitle, tags: entryTags, person, sourceType, date } = entry;
                    await supabase.from('intelligence_entries').insert({
                        user_id:     userId,
                        instance_id: instanceId,
                        data: { id: require('crypto').randomUUID(), body, raw_text, file_path, file_name, file_type,
                                title: entryTitle, tags: entryTags, person, sourceType, date },
                    });
                    sseSend(res, { type: 'saved', current: i + 1, total, fileName });
                }

            } catch (err) {
                console.error(`[connector/import] ${fileName}:`, err);
                errors.push({ fileName, error: err.message });
                sseSend(res, { type: 'file_error', fileName, error: err.message });
            }
        }

        if (isReview) {
            sseSend(res, { type: 'complete', mode: 'review', entries: prepared, errors });
        } else {
            sseSend(res, { type: 'complete', mode: 'auto', imported: files.length - errors.length, errors });
        }
        res.end();
    });

    // ── Save batch (review mode) ───────────────────────────────────────────────
    // Body: { entries: [{ title, body, tags, person, sourceType, date,
    //                     raw_text, file_path, file_name, file_type }] }

    router.post('/google-drive/save-batch', async (req, res) => {
        const { entries } = req.body;
        if (!Array.isArray(entries) || entries.length === 0) {
            return res.status(400).json({ error: 'entries array is required' });
        }
        if (entries.length > REVIEW_THRESHOLD) {
            return res.status(400).json({ error: `save-batch limited to ${REVIEW_THRESHOLD} entries` });
        }

        const userId     = req.userId;
        const instanceId = req.instanceId;

        try {
            const rows = entries.map(e => ({
                user_id:     userId,
                instance_id: instanceId,
                data: {
                    id:         require('crypto').randomUUID(),
                    body:       typeof e.body      === 'string' ? e.body.slice(0, 10_000) : '',
                    title:      typeof e.title     === 'string' ? e.title.slice(0, 120)   : undefined,
                    raw_text:   typeof e.raw_text  === 'string' ? e.raw_text              : undefined,
                    file_path:  typeof e.file_path === 'string' ? e.file_path.slice(0, 512) : undefined,
                    file_name:  typeof e.file_name === 'string' ? e.file_name.slice(0, 255) : undefined,
                    file_type:  typeof e.file_type === 'string' ? e.file_type.slice(0, 50)  : undefined,
                    tags:       Array.isArray(e.tags) ? e.tags.slice(0, 5) : [],
                    person:     typeof e.person     === 'string' ? e.person     : undefined,
                    sourceType: typeof e.sourceType === 'string' ? e.sourceType : undefined,
                    date:       typeof e.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(e.date)
                                    ? e.date : new Date().toISOString().slice(0, 10),
                },
            }));

            const { error } = await supabase.from('intelligence_entries').insert(rows);
            if (error) return apiError(res, error, 'connector/save-batch');
            res.json({ imported: rows.length });
        } catch (err) {
            apiError(res, err, 'connector/save-batch');
        }
    });

    // ── Disconnect ─────────────────────────────────────────────────────────────

    router.delete('/google-drive/disconnect', async (req, res) => {
        try {
            const record = await loadTokens(supabase, req.userId, req.instanceId);
            if (record?.tokens?.access_token) {
                await drive.revokeToken(record.tokens.access_token).catch(() => {});
            }
            await supabase.from('connector_tokens')
                .delete()
                .eq('user_id', req.userId)
                .eq('instance_id', req.instanceId)
                .eq('provider', PROVIDER);
            res.json({ success: true });
        } catch (err) {
            apiError(res, err, 'connector/disconnect');
        }
    });

    return router;
};

'use strict';
/**
 * routes/pdf-routes.js
 *
 * POST /api/intelligence-hub/upload-file
 *   Supported formats: PDF · Word (.docx) · Excel (.xlsx) · CSV
 *
 *   Flow: upload → extract text → Supabase Storage (private) → Claude analysis
 *         → return title / summary / tags for user review.
 *   Caller then POSTs to /api/intelligence-hub/entry to save the entry.
 */

const { Router }         = require('express');
const multer             = require('multer');
const { callAI, MODELS } = require('../shared/ai-client');
const { apiError }       = require('../utils/api-error');
const { detectFileType, extractText } = require('../utils/file-extractors');

const BUCKET = 'entry-files';

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
    fileFilter: (_req, file, cb) => {
        const type = detectFileType(file.mimetype, file.originalname);
        if (type) return cb(null, true);
        cb(Object.assign(
            new Error('Only PDF, Word (.docx), Excel (.xlsx) and CSV files are allowed'),
            { status: 400 },
        ));
    },
});

// ── Route ──────────────────────────────────────────────────────────────────────

module.exports = function fileRoutes(supabase, { aiLimiter } = {}) {
    const router = Router();

    router.post('/upload-file', aiLimiter, upload.single('file'), async (req, res) => {
        if (!req.file) return res.status(400).json({ error: 'No file provided' });

        const fileType = detectFileType(req.file.mimetype, req.file.originalname);
        if (!fileType) return res.status(400).json({ error: 'Unsupported file type' });

        const userId     = req.userId;
        const instanceId = req.instanceId;

        try {
            // 1. Extract text
            const rawText = await extractText(req.file.buffer, fileType);
            if (!rawText) {
                const hints = {
                    pdf:  'The PDF may be scanned or image-based.',
                    docx: 'The Word document appears to be empty.',
                    xlsx: 'The spreadsheet appears to have no text content.',
                    csv:  'The CSV file appears to be empty.',
                };
                return res.status(422).json({ error: `Could not extract text. ${hints[fileType] ?? ''}` });
            }

            // 2. Upload original file to Supabase Storage (private bucket)
            const safeName    = req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
            const storagePath = `${userId}/${instanceId}/${Date.now()}_${safeName}`;
            const contentType = req.file.mimetype;

            const { error: storageErr } = await supabase.storage
                .from(BUCKET)
                .upload(storagePath, req.file.buffer, { contentType, upsert: false });
            if (storageErr) throw storageErr;

            // 3. Claude analysis — first 15k chars
            const textForAI = rawText.slice(0, 15_000);
            const aiText = await callAI({
                model:     MODELS.haiku,
                maxTokens: 600,
                callType:  'file_analysis',
                req,
                messages: [{
                    role:    'user',
                    content: `You are a PM assistant. Analyze this document and return ONLY a valid JSON object — no markdown, no explanation — with these keys:
- "title": concise title (max 80 chars)
- "summary": a self-contained PM-focused summary of key insights, pain points, feature requests, or decisions. Must be a complete sentence or paragraph — do NOT cut off mid-sentence. Hard limit: 1000 characters total.
- "tags": array of up to 5 relevant string tags

The summary must fit entirely within 1000 characters. Write a complete, readable summary — do not truncate.

Document:
${textForAI}`,
                }],
            });

            let parsed = {};
            try {
                const cleaned = aiText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
                parsed = JSON.parse(cleaned);
            } catch { /* use defaults below */ }

            res.json({
                title:     typeof parsed.title   === 'string' ? parsed.title.slice(0, 80)    : safeName,
                summary:   typeof parsed.summary === 'string' ? parsed.summary.slice(0, 1000) : rawText.slice(0, 1000),
                tags:      Array.isArray(parsed.tags) ? parsed.tags.slice(0, 5).map(t => String(t).slice(0, 100)) : [],
                raw_text:  rawText,
                file_path: storagePath,
                file_name: req.file.originalname,
                file_type: fileType,
                char_count: rawText.length,
            });

        } catch (err) {
            if (err.status === 400) return res.status(400).json({ error: err.message });
            apiError(res, err, 'file/upload');
        }
    });

    return router;
};

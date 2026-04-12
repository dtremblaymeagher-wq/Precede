const express = require('express');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const { TEMPORAL, LONGITUDINAL, RATE_LIMIT } = require('./shared/constants');
require('dotenv').config();

// ─── REQUIRED ENV VARS — fail fast at boot, not at runtime ───────────────────
const REQUIRED_ENV = [
    'ANTHROPIC_API_KEY',
    'SUPABASE_URL',
    'SUPABASE_SERVICE_KEY',
    'CLERK_SECRET_KEY',
];
const missingEnv = REQUIRED_ENV.filter(k => !process.env[k]?.trim());
if (missingEnv.length) {
    console.error(`❌ Missing required environment variables: ${missingEnv.join(', ')}`);
    console.error('   Set them in .env (local) or your host\'s env config (production).');
    process.exit(1);
}

const { clerkMiddleware, requireAuth, getAuth } = require('@clerk/express');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const { apiError } = require('./utils/api-error');
const { MODELS, callAI } = require('./shared/ai-client');
const prompts = require('./shared/prompts');
const supabase = require('./database/db');
const { getIntegration } = require('./integrations');
const JiraStoryImporter  = require('./integrations/jira-story-importer');

const app = express();
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://localhost:3001')
    .split(',').map(o => o.trim());
app.use(cors({
    origin: (origin, cb) => {
        // Allow same-origin requests (no Origin header) and whitelisted origins
        if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
        cb(null, false); // reject with 403 — never throw, to avoid crashing the process
    },
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Instance-Id'],
}));
app.use(express.json({ limit: '5mb' }));

// Swap the hardcoded Clerk test key for the production key in every HTML file.
// Only runs when CLERK_PUBLISHABLE_KEY is set and is a live key.
// Keep in sync with shared/client-constants.js → CLERK_TEST_KEY
const CLERK_TEST_KEY = 'pk_test_dmFzdC1wZWdhc3VzLTQzLmNsZXJrLmFjY291bnRzLmRldiQ';
const clerkProdKey   = process.env.CLERK_PUBLISHABLE_KEY;
if (clerkProdKey && clerkProdKey !== CLERK_TEST_KEY) {
    console.log('[Clerk] Key swap active — HTML responses will use production publishable key');
    app.use((req, res, next) => {
        if (!req.path.endsWith('.html')) return next();
        const filePath = path.join(__dirname, req.path);
        fs.readFile(filePath, 'utf8', (err, content) => {
            if (err) return next();
            res.type('html').send(content.replace(new RegExp(CLERK_TEST_KEY, 'g'), clerkProdKey));
        });
    });
}

app.use(express.static(__dirname));
app.get('/health', (_req, res) => res.json({ status: 'ok' }));
app.get('/clerk-key.js', (_req, res) => {
    res.type('application/javascript');
    const key = process.env.CLERK_PUBLISHABLE_KEY || 'pk_test_dmFzdC1wZWdhc3VzLTQzLmNsZXJrLmFjY291bnRzLmRldiQ';
    res.send(`window.__CLERK_PK__=${JSON.stringify(key)};`);
});

app.use(clerkMiddleware()); // populates req.auth on every request

// All /api/* routes require a valid Clerk session token.
// req.userId is set once by the middleware below and available in every handler.
app.use('/api', requireAuth());
app.use('/api', (req, res, next) => { req.userId = getAuth(req).userId; next(); });

// ─── INSTANCE RESOLUTION MIDDLEWARE ──────────────────────────────────────────
// Reads X-Instance-Id header, validates ownership, attaches req.instanceId.
// Skipped for platform-level routes and pure AI-proxy routes (no DB writes).

const INSTANCE_FREE_PATHS = [
    '/onboarding',
    '/instances',
    '/exec/instances', // exec PM instance list — no instance context needed
    '/generate',
    '/post-meeting',
    '/backlog/suggest-order', // pure client-side sort on req.body.stories — no DB reads
];

async function resolveInstance(req, res, next) {
    if (INSTANCE_FREE_PATHS.some(p => req.path.startsWith(p))) return next();
    const instanceId = req.headers['x-instance-id'];
    if (!instanceId) return res.status(400).json({ error: 'X-Instance-Id header is required' });
    const userId = req.userId;
    const { data, error } = await supabase
        .from('instances')
        .select('id')
        .eq('id', instanceId)
        .eq('user_id', userId)
        .single();
    if (error || !data) return res.status(403).json({ error: 'Invalid or unauthorized instance' });
    req.instanceId = instanceId;
    next();
}

app.use('/api', resolveInstance);

// ── Instance-scoped query helpers ─────────────────────────────────────────────
// instanceSelect — returns a chainable Supabase SELECT pre-filtered to user + instance.
//   Chain .single(), .maybeSingle(), .order(), .limit(), .like(), etc. as needed.
const instanceSelect = (table, cols, userId, instanceId) =>
    supabase.from(table).select(cols).eq('user_id', userId).eq('instance_id', instanceId);

// instanceUpsert — upserts a row scoped to user + instance (standard conflict key).
//   payload must NOT include user_id or instance_id.
const instanceUpsert = (table, payload, userId, instanceId) =>
    supabase.from(table).upsert(
        { user_id: userId, instance_id: instanceId, ...payload },
        { onConflict: 'user_id,instance_id' }
    );

// instanceInsert — inserts a row scoped to user + instance.
//   row must NOT include user_id or instance_id.
const instanceInsert = (table, row, userId, instanceId) =>
    supabase.from(table).insert({ user_id: userId, instance_id: instanceId, ...row });

// ─── ROUTE FILES ──────────────────────────────────────────────────────────────
const createExecRouter           = require('./routes/exec-routes');
const createRoadmapRouter        = require('./routes/roadmap-routes');
const createEngineRouter         = require('./routes/engine-routes');
const createEpicPredictionRouter = require('./routes/epic-prediction-routes');
const analyzeRouter              = require('./routes/analyze-routes');
const createInstancesRouter      = require('./routes/instances-routes');
const createVisionRouter         = require('./routes/vision-routes');
const createOnboardingRouter     = require('./routes/onboarding-routes');
const createSettingsRouter       = require('./routes/settings-routes');
const createDecisionsRouter      = require('./routes/decisions-routes');
const createHubRouter            = require('./routes/hub-routes');
const createHistoryRouter        = require('./routes/history-routes');
const createLearningRouter       = require('./routes/learning-routes');
const createBacklogRouter        = require('./routes/backlog-routes');
const createSprintRouter         = require('./routes/sprint-routes');
const createIntegrationRouter    = require('./routes/integration-routes');
const createImportRouter         = require('./routes/import-routes');
const createGenerateRouter       = require('./routes/generate-routes');
const createMeetingRouter        = require('./routes/meeting-routes');
const createDashboardRouter      = require('./routes/dashboard-routes');
const createBrainstormRouter     = require('./routes/brainstorm-routes');
const createUsageRouter          = require('./routes/usage-routes');
const { makeSprintUtils }        = require('./utils/sprint-utils');

app.use('/api/exec',             createExecRouter(supabase));
app.use('/api/roadmap',          createRoadmapRouter(supabase));
app.use('/api/engine',           createEngineRouter(supabase));
app.use('/api/epic-prediction',  createEpicPredictionRouter(supabase));
app.use('/api/analyze',          analyzeRouter);
app.use('/api/instances',        createInstancesRouter(supabase));
app.use('/api/vision',           createVisionRouter(supabase));
app.use('/api/onboarding',       createOnboardingRouter(supabase));
app.use('/api/settings',         createSettingsRouter(supabase));
app.use('/api/decisions',        createDecisionsRouter(supabase));
app.use('/api/intelligence-hub', createHubRouter(supabase));
app.use('/api/history',          createHistoryRouter(supabase));
app.use('/api/learning',         createLearningRouter(supabase));

// Rate limiter for AI endpoints — 20 requests per 15 minutes per user
const aiLimiter = rateLimit({
    windowMs: RATE_LIMIT.WINDOW_MINUTES * 60 * 1000,
    max: RATE_LIMIT.MAX_REQUESTS,
    keyGenerator: (req) => req.userId || ipKeyGenerator(req),
    handler: (req, res) => {
        res.status(429).json({ error: 'Too many requests. Please wait a few minutes before running another analysis.' });
    },
    standardHeaders: true,
    legacyHeaders: false,
});

app.use('/api/backlog',      createBacklogRouter(supabase, { aiLimiter }));
app.use('/api',             createSprintRouter(supabase));
app.use('/api/integration', createIntegrationRouter(supabase));
app.use('/api/import',      createImportRouter(supabase));
app.use('/api/generate',    createGenerateRouter({ aiLimiter }));
app.use('/api',             createMeetingRouter(supabase, { aiLimiter }));
app.use('/api/dashboard',   createDashboardRouter(supabase, { aiLimiter }));
app.use('/api/brainstorm',  createBrainstormRouter(supabase, { aiLimiter }));
app.use('/api/usage',       createUsageRouter(supabase));

// Sprint helpers used by the analyze monolith
const { getCurrentSprint } = makeSprintUtils(supabase);

const PORT = process.env.PORT || 3001;

const modulesPath = path.join(__dirname, 'Modules');
const paths = {
    settings:  path.join(modulesPath, 'Settings/settings.json'),
    vision:    path.join(modulesPath, 'Vision-board/vision-board.json'),
    hub:       path.join(modulesPath, 'Intelligence-hub/intelligence-hub.json'),
    backlog:   path.join(modulesPath, 'Backlog'),
    vault:     path.join(modulesPath, 'Settings', 'learning-vault.json'),
    memory:    path.join(modulesPath, 'Intelligence-hub', 'radar-memory.json')
};

[paths.backlog, path.join(modulesPath, 'Settings')].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

async function loadVision(userId, instanceId) {
    const { data } = await instanceSelect('vision', 'data', userId, instanceId)
        .single();
    return data?.data?.vision ?? "Non définie";
}

// ─── HELPERS RADAR ───────────────────────────────────────────────────────────

function getTemporalWeight(dateStr) {
    const date = new Date(dateStr);
    if (isNaN(date)) return 'medium';
    const daysAgo = (Date.now() - date.getTime()) / (1000 * 60 * 60 * 24);
    if (daysAgo <= TEMPORAL.HIGH_DAYS)   return 'high';
    if (daysAgo <= TEMPORAL.MEDIUM_DAYS) return 'medium';
    return 'background';
}

async function loadSprintMemory(userId, instanceId) {
    try {
        const { data } = await instanceSelect('radar_memory', 'data', userId, instanceId)
            .single();
        return data?.data ?? null;
    } catch (e) { console.warn("⚠️ Mémoire de sprint illisible, on continue sans."); }
    return null;
}

async function getSprintStats(userId, instanceId) {
    try {
        const { data } = await instanceSelect('analysis_history', 'created_at', userId, instanceId)
            .like('filename', 'radar-%')
            .order('created_at', { ascending: true });
        if (!data || data.length === 0) return { count: 0, oldestDaysAgo: 0 };
        const oldestDaysAgo = (Date.now() - new Date(data[0].created_at).getTime()) / (1000 * 60 * 60 * 24);
        return { count: data.length, oldestDaysAgo };
    } catch (e) { return { count: 0, oldestDaysAgo: 0 }; }
}

async function loadHistoricalSnapshots(userId, instanceId) {
    try {
        const { data } = await instanceSelect('analysis_history', 'data, created_at', userId, instanceId)
            .like('filename', 'radar-%')
            .order('created_at', { ascending: true });
        if (!data) return [];
        return data.map(row => {
            try {
                const analysis = row.data.analysis || row.data;
                return {
                    date: new Date(row.created_at).toISOString().split('T')[0],
                    summary: analysis.summary || '',
                    trends: (analysis.trends || []).map(t => ({
                        topic: t.topic,
                        alignment: t.strategic_alignment,
                        evolution: t.evolution
                    })),
                    opportunities: (analysis.opportunities || []).map(o => o.title || o.name),
                    risks: (analysis.risks || []).map(r => r.title || r.name)
                };
            } catch (e) { return null; }
        }).filter(Boolean);
    } catch (e) { return []; }
}

// ─── ROUTE /api/analyze ───────────────────────────────────────────────────────

app.post('/api/analyze', aiLimiter, async (req, res) => {
    try {
        const userId = req.userId;
        const instanceId = req.instanceId;
        const { dataset } = req.body;
        if (!dataset || dataset.length === 0) {
            return res.status(400).json({ error: "Aucune donnée dans le Hub à analyser." });
        }
        if (!Array.isArray(dataset) || dataset.length > 500) {
            return res.status(400).json({ error: 'dataset must be an array of ≤ 500 entries' });
        }

        // 1. CONTEXTE PRODUIT
        let context = { vision: "Non définie", okrs: "Non définis", personas: "Non définis" };
        try {
            context.vision = await loadVision(userId, instanceId);
            const { data: settingsRow, error: settingsError } = await instanceSelect('settings', 'data', userId, instanceId)
                .single();
            if (settingsError) console.error("❌ Supabase settings error:", settingsError);
            if (settingsRow?.data) {
                const s = settingsRow.data;
                context.okrs     = s.objectives || [];
                context.okrsText = s.objectives ? s.objectives.join('\n') : 'Not defined';
                context.personas = s.personas   ? s.personas.map(p => p.name).join(', ') : context.personas;
            }
        } catch (e) { console.warn("⚠️ Contexte vision/settings incomplet:", e.message); }

        // 2. PONDÉRATION TEMPORELLE
        const weightedDataset = dataset.map(entry => ({
            ...entry,
            _weight: getTemporalWeight(entry.date || entry.createdAt)
        }));
        const high       = weightedDataset.filter(e => e._weight === 'high');
        const medium     = weightedDataset.filter(e => e._weight === 'medium');
        const background = weightedDataset.filter(e => e._weight === 'background');
        // 3. MÉMOIRE DU DERNIER SPRINT
        const sprintMemory = await loadSprintMemory(userId, instanceId);
        const hasMemory    = sprintMemory !== null;

        let memorySection = '';
        if (hasMemory) {
            memorySection = `
## LAST SPRINT MEMORY (${sprintMemory.savedAt?.split('T')[0] || 'unknown date'})

**Established trends:**
${(sprintMemory.established_trends || []).map(t => `- ${t}`).join('\n') || '- None'}

**Active risks:**
${(sprintMemory.active_risks || []).map(r => `- ${r}`).join('\n') || '- None'}

**Tracked opportunities:**
${(sprintMemory.tracked_opportunities || []).map(o => `- ${o}`).join('\n') || '- None'}

**Decisions made:**
${(sprintMemory.decisions_made || []).map(d => `- ${d}`).join('\n') || '- None'}

⚠️ DELTA INSTRUCTIONS:
- Identify what is **new** compared to this memory
- Identify what has **strengthened** (stronger signal than before)
- Identify what has **disappeared** or been **resolved**
- Identify **contradictions** or **reversals**
`;
        }

        // 4. DÉCISION LONGITUDINALE
        const sprintStats           = await getSprintStats(userId, instanceId);
        const shouldRunLongitudinal = sprintStats.count >= LONGITUDINAL.MIN_SPRINTS && sprintStats.oldestDaysAgo >= LONGITUDINAL.MIN_DAYS;
        let longitudinalSection     = '';

        if (shouldRunLongitudinal) {
            const longitudinalData = await loadHistoricalSnapshots(userId, instanceId);

            longitudinalSection = `
## LONGITUDINAL ANALYSIS REQUESTED (${sprintStats.count} sprints over ${Math.round(sprintStats.oldestDaysAgo)} days)

Here is the history of past analyses (oldest to most recent):

${longitudinalData.map((snap, i) => `
### Sprint ${i + 1} — ${snap.date}
Summary: ${snap.summary}
Trends: ${snap.trends.map(t => `${t.topic} (${t.alignment}% alignment, ${t.evolution})`).join(' | ') || 'none'}
Opportunities: ${snap.opportunities.join(' | ') || 'none'}
Risks: ${snap.risks.join(' | ') || 'none'}
`).join('\n')}

⚠️ LONGITUDINAL INSTRUCTIONS — answer each of these questions precisely:

**RECURRING SIGNALS:**
Which signals appear repeatedly without ever having been decided upon?
Which trends are accelerating or losing momentum over the period?

**SUSPICIOUS SILENCES:**
Which topics were frequently mentioned in past sprints and have completely disappeared recently?
For each silence: was it resolved, abandoned, or suppressed?
A topic that disappears without an explicit decision is a hidden risk — flag it.

**SIGNAL VELOCITY:**
Which signals double in frequency or intensity from one sprint to the next?
Estimate the slope: slow (a few mentions across multiple sprints), moderate (steady growth), fast (sudden spike).
Which signal that is weak today could become critical in 2-3 sprints if velocity continues?

**PRE-CHURN DISENGAGEMENT SIGNALS:**
Are there users or groups whose feedback is becoming shorter, more negative, or starting to compare with competitors?
Are there mentions of dependency, lock-in, or vulnerability that signal relational fragility?
A user requesting a public roadmap or expressing fear of dependency is a potential churn signal — identify them by name.

**WEAK SIGNAL ALERT:**
Which weak signal today resembles a previously ignored signal that later became structural?
`;
        } else {
            const daysNeeded = Math.max(0, Math.round(60 - sprintStats.oldestDaysAgo));
            longitudinalSection = `
## LONGITUDINAL ANALYSIS NOT AVAILABLE
Conditions not met: ${sprintStats.count}/4 sprints completed${daysNeeded > 0 ? `, ${daysNeeded} days remaining` : ''}.
→ Leave the "longitudinal" field with status "insufficient_data" and sprints_completed: ${sprintStats.count}.
`;
        }

        // 5. PROMPT
        const promptSystem = prompts.buildAnalyzeSystem({
            context, high, medium, background,
            memorySection, longitudinalSection,
            shouldRunLongitudinal, sprintStats,
        });

        // 6. APPEL CLAUDE
        const rawText = await callAI({
            model:     MODELS.sonnet,
            maxTokens: 4000,
            system:    promptSystem,
            messages:  [{ role: 'user', content: 'Run the full analysis and return the JSON. Remember: all text values must be in English.' }],
            callType:  'signal_analysis',
            req,
        });
        if (!rawText) throw new Error("Réponse vide d'Anthropic.");
        const jsonMatch = rawText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error("L'IA n'a pas renvoyé un format JSON valide.");

        const analysisJSON = JSON.parse(jsonMatch[0]);

        // 6b. CALL 2 — Strategic Synthesis (sequential, uses Call 1 output as input)
        try {
            const synthSystem = prompts.buildStrategicSynthesisPrompt(analysisJSON.analysis);
            const synthRaw = await callAI({
                model:     MODELS.sonnet,
                maxTokens: 1200,
                system:    synthSystem,
                messages:  [{ role: 'user', content: 'Write the narratives and re-qualify the risks and opportunities. Return only valid JSON.' }],
                callType:  'strategic_synthesis',
                req,
            });
            if (synthRaw) {
                const synthMatch = synthRaw.match(/\{[\s\S]*\}/);
                if (synthMatch) {
                    const synth = JSON.parse(synthMatch[0]);
                    analysisJSON.analysis.summary                    = synth.summary                    || '';
                    analysisJSON.analysis.strategic_alignment_summary = synth.strategic_alignment_summary || '';
                    analysisJSON.analysis.strategic_gap              = synth.strategic_gap              || '';
                    if (Array.isArray(synth.risks)         && synth.risks.length)         analysisJSON.analysis.risks         = synth.risks;
                    if (Array.isArray(synth.opportunities) && synth.opportunities.length) analysisJSON.analysis.opportunities = synth.opportunities;
                }
            }
        } catch (synthErr) {
            console.error('❌ Strategic synthesis (Call 2) failed:', synthErr.message);
            // Degrade gracefully — analysis still saved without enriched narratives
        }

        // 7. SAUVEGARDES
        const fileName = `radar-${Date.now()}.json`;
        const { error: historyError } = await supabase
            .from('analysis_history')
            .insert({ user_id: userId, instance_id: instanceId, filename: fileName, data: analysisJSON });
        if (historyError) console.error("❌ Erreur sauvegarde snapshot:", historyError);
        else console.log("✅ Snapshot sauvegardé :", fileName);

        if (analysisJSON.sprint_memory) {
            const currentSprint = await getCurrentSprint(userId, instanceId);

            const memoryToSave = {
                ...analysisJSON.sprint_memory,
                last_analyzed_sprint: currentSprint?.identifier ?? null,
            };

            const { error: memoryError } = await supabase
                .from('radar_memory')
                .upsert(
                    { user_id: userId, instance_id: instanceId, data: memoryToSave, updated_at: new Date().toISOString() },
                    { onConflict: 'user_id,instance_id' }
                );
            if (memoryError) console.error("❌ Erreur sauvegarde mémoire sprint:", memoryError);
            else console.log("✅ Sprint memory updated");
        }

        // 8. RÉPONSE
        res.json({
            analysis: analysisJSON.analysis,
            meta: {
                longitudinal_triggered: shouldRunLongitudinal,
                sprints_available:      sprintStats.count,
                memory_used:            hasMemory,
                data_breakdown: {
                    high:       high.length,
                    medium:     medium.length,
                    background: background.length
                }
            }
        });

    } catch (e) {
        apiError(res, e, 'analyze');
    }
});

// ─── GLOBAL ERROR HANDLER ─────────────────────────────────────────────────────
// Must have 4 params for Express to treat it as an error handler.
// Catches errors that escape route-level try/catch (e.g. middleware throws,
// Express 5 async re-throw). Returns JSON instead of Express's default HTML page.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
    apiError(res, err, 'unhandled');
});

// ─── DÉMARRAGE ────────────────────────────────────────────────────────────────

if (require.main === module) {
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`🚀 Server running on port ${PORT}`);
    });
}

module.exports = { app };
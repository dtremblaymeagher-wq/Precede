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
    'CREDENTIALS_SECRET',
];
const missingEnv = REQUIRED_ENV.filter(k => !process.env[k]?.trim());
if (missingEnv.length) {
    console.error(`❌ Missing required environment variables: ${missingEnv.join(', ')}`);
    console.error('   Set them in .env (local) or your host\'s env config (production).');
    process.exit(1);
}

const { clerkMiddleware, getAuth } = require('@clerk/express');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const { apiError } = require('./utils/api-error');
const { MODELS, callAI } = require('./shared/ai-client');
const prompts = require('./shared/prompts');
const supabase = require('./database/db');
const { makeHelpers } = require('./utils/db-helpers');
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

// Attach a unique request ID to every request for log correlation.
app.use((req, res, next) => {
    req.requestId = crypto.randomUUID();
    res.setHeader('X-Request-Id', req.requestId);
    next();
});

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
app.use('/api', (req, res, next) => {
    const { userId } = getAuth(req);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    req.userId = userId;
    next();
});

// ─── INSTANCE RESOLUTION MIDDLEWARE ──────────────────────────────────────────
// Reads X-Instance-Id header, validates ownership, attaches req.instanceId.
// Skipped for platform-level routes and pure AI-proxy routes (no DB writes).

const INSTANCE_FREE_PATHS = [
    '/onboarding',
    '/instances',
    '/exec/instances',        // exec PM instance list — no instance context needed
    '/exec/classify-stories', // aggregates across all PM instances — no single instance context
    '/exec/milestones',       // aggregates milestones across all PM instances — no single instance context
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
const { instanceSelect, instanceUpsert, instanceInsert } = makeHelpers(supabase);

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
const createGroomingRouter       = require('./routes/grooming-routes');
const createUsageRouter          = require('./routes/usage-routes');
const createAgentRadarRouter     = require('./routes/agent-radar-routes');
const createDemoSeedRouter       = require('./routes/demo-seed-routes');
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
app.use('/api/grooming',   createGroomingRouter(supabase, { aiLimiter }));
app.use('/api/usage',       createUsageRouter(supabase));
app.use('/api/agent-radar', createAgentRadarRouter());
app.use('/api/demo-seed',  createDemoSeedRouter(supabase)); // restricted to demo user only — no nav link

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
            .order('created_at', { ascending: false })
            .limit(12);
        if (!data) return [];
        data.reverse(); // restore chronological order after DESC fetch
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

        // 1. CONTEXTE PRODUIT + FEEDBACK + SPRINT MEMORY — all independent, load in parallel
        let context = { vision: "Non définie", okrs: "Non définis", personas: "Non définis" };
        let userFeedbackSection = '';
        let sprintMemory = null;

        const [visionResult, settingsResult, feedbackResult, sprintMemoryResult] = await Promise.allSettled([
            loadVision(userId, instanceId),
            instanceSelect('settings', 'data', userId, instanceId).single(),
            supabase.from('learning_vault').select('data, created_at')
                .eq('user_id', userId).eq('instance_id', instanceId).eq('type', 'user_feedback')
                .order('created_at', { ascending: false }).limit(10),
            loadSprintMemory(userId, instanceId),
        ]);

        if (visionResult.status === 'fulfilled') context.vision = visionResult.value;

        if (settingsResult.status === 'fulfilled') {
            const { data: settingsRow, error: settingsError } = settingsResult.value;
            if (settingsError) console.error("❌ Supabase settings error:", settingsError);
            if (settingsRow?.data) {
                const s = settingsRow.data;
                context.okrs     = s.objectives || [];
                context.okrsText = s.objectives ? s.objectives.join('\n') : 'Not defined';
                context.personas = s.personas   ? s.personas.map(p => p.name).join(', ') : context.personas;
            }
        } else { console.warn("⚠️ Contexte vision/settings incomplet:", settingsResult.reason?.message); }

        if (feedbackResult.status === 'fulfilled') {
            const feedbackRows = feedbackResult.value.data;
            if (feedbackRows?.length) {
                const rules = feedbackRows
                    .filter(r => r.data.recommendation?.trim())
                    .map((r, i) => `${i + 1}. ${r.data.recommendation.trim()}`);
                if (rules.length)
                    userFeedbackSection = `\n## ANALYSIS RULES FROM PM FEEDBACK\nApply these rules strictly in your analysis. They were derived from direct PM observations on past outputs:\n\n${rules.join('\n')}\n`;
            }
        }

        if (sprintMemoryResult.status === 'fulfilled') sprintMemory = sprintMemoryResult.value;
        const hasMemory = sprintMemory !== null;

        // 2. PONDÉRATION TEMPORELLE
        const weightedDataset = dataset.map(entry => ({
            ...entry,
            _weight: getTemporalWeight(entry.date || entry.createdAt)
        }));
        const high       = weightedDataset.filter(e => e._weight === 'high');
        const medium     = weightedDataset.filter(e => e._weight === 'medium');
        const background = weightedDataset.filter(e => e._weight === 'background');

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

        // Longitudinal is now a separate call — main prompt always gets the "not available" stub
        const daysNeeded = Math.max(0, Math.round(LONGITUDINAL.MIN_DAYS - sprintStats.oldestDaysAgo));
        const longitudinalSection = shouldRunLongitudinal
            ? `## LONGITUDINAL ANALYSIS\n→ Set longitudinal.status = "available" — data will be merged from a separate call.`
            : `## LONGITUDINAL ANALYSIS NOT AVAILABLE\nConditions not met: ${sprintStats.count}/4 sprints completed${daysNeeded > 0 ? `, ${daysNeeded} days remaining` : ''}.\n→ Leave the "longitudinal" field with status "insufficient_data" and sprints_completed: ${sprintStats.count}.`;

        // 5. PROMPT
        const totalEntries = high.length + medium.length + background.length;
        const promptSystem = prompts.buildAnalyzeSystem({
            context, high, medium, background,
            memorySection, longitudinalSection,
            shouldRunLongitudinal, sprintStats,
            userFeedbackSection,
            totalEntries,
            isFirstAnalysis: sprintStats.count === 0,
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
        // 6b+6c. CALL 2 (synthesis) + CALL 3 (longitudinal) — parallelized
        // Call 3 includes its own DB fetch (loadHistoricalSnapshots) which also runs in parallel.
        const synthPromise = (async () => {
            const synthSystem = prompts.buildStrategicSynthesisPrompt(analysisJSON.analysis);
            return callAI({
                model:     MODELS.sonnet,
                maxTokens: 1200,
                system:    synthSystem,
                messages:  [{ role: 'user', content: 'Write the narratives and re-qualify the risks and opportunities. Return only valid JSON.' }],
                callType:  'strategic_synthesis',
                req,
            });
        })().catch(err => { console.error('❌ Strategic synthesis (Call 2) failed:', err.message); return null; });

        const longPromise = shouldRunLongitudinal
            ? (async () => {
                const historicalSnapshots = await loadHistoricalSnapshots(userId, instanceId);
                const longSystem = prompts.buildLongitudinalPrompt({
                    context, high, medium, background: [],
                    sprintStats, historicalSnapshots,
                });
                return callAI({
                    model:     MODELS.sonnet,
                    maxTokens: 1500,
                    system:    longSystem,
                    messages:  [{ role: 'user', content: 'Run the longitudinal analysis and return only valid JSON.' }],
                    callType:  'longitudinal_analysis',
                    req,
                });
            })().catch(err => { console.error('❌ Longitudinal analysis (Call 3) failed:', err.message); return null; })
            : Promise.resolve(null);

        const [synthRaw, longRaw] = await Promise.all([synthPromise, longPromise]);

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

        if (longRaw) {
            const longMatch = longRaw.match(/\{[\s\S]*\}/);
            if (longMatch) {
                const longJSON = JSON.parse(longMatch[0]);
                if (longJSON.longitudinal) analysisJSON.analysis.longitudinal = longJSON.longitudinal;
            }
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
        require('./utils/sprint-cron').startCrons();
    });
}

module.exports = { app };
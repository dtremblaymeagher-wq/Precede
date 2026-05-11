/**
 * tests/analyze.test.js
 *
 * Tests for POST /api/analyze.
 * Mocks: Clerk, Supabase (queue-based), global.fetch (Claude API).
 *
 * Queue consumption order for a full happy-path call:
 *   [0] resolveInstance          → instances.single()
 *   [1] loadVision               → vision.single()
 *   [2] settings context         → settings.single()
 *   [3] loadSprintMemory         → radar_memory.single()
 *   [4] getSprintStats           → analysis_history.then()   (thenable await)
 *   [5] save analysis_history    → analysis_history.insert().then()
 *
 * No sprint_memory in the mocked Claude response → getCurrentSprint / radar_memory
 * upsert are not triggered, keeping the queue at 6 slots.
 */

const { makeAuthRequest, makeUnauthRequest, USER_A, INSTANCE_A, INSTANCE_B, instanceOk, instanceFail } = require('./setup');

jest.mock('@clerk/express');
jest.mock('../database/db');
jest.mock('../routes/exec-routes');
jest.mock('../routes/roadmap-routes');

const { app } = require('../server');
const db = require('../database/db');

// ── Claude API mock ───────────────────────────────────────────────────────────

const VALID_ANALYSIS = {
    analysis: {
        summary: 'Test summary',
        strategic_alignment_summary: 'Good alignment',
        trends: [{ topic: 'Topic A', description: 'Desc', strategic_alignment: 70, evolution: 'rising', signal_strength: 'established', persona_impacted: 'User', evidence_count: 3 }],
        okr_alignment: [{ okr: 'OKR 1', score: 75, trend: 'stable', rationale: 'Based on signals' }],
        delta: { new_signals: [], strengthened: [], resolved: [], contradictions: [] },
        opportunities: [],
        risks: [],
        recommendations: [],
    },
    // no sprint_memory → avoids getCurrentSprint + radar_memory upsert
};

function mockClaudeSuccess(body = VALID_ANALYSIS) {
    global.fetch = jest.fn().mockResolvedValue({
        json: () => Promise.resolve({ content: [{ text: JSON.stringify(body) }] }),
    });
}

function mockClaudeMalformed() {
    global.fetch = jest.fn().mockResolvedValue({
        json: () => Promise.resolve({ content: [{ text: 'this is not json at all' }] }),
    });
}

const savedFetch = global.fetch;
beforeEach(() => {
    db.__reset();
    global.fetch = jest.fn(); // fresh mock each test — prevents silent reuse of a previous Claude mock
    // signal_summaries is queried in parallel with context — serve empty list via
    // per-table queue so it never consumes a global queue slot.
    db.__qTable('signal_summaries', [{ data: [], error: null }]);
});
afterAll(() => { global.fetch = savedFetch; });

// ── queue helpers ─────────────────────────────────────────────────────────────

const visionOk    = () => ({ data: { data: { vision: 'Build the best PM tool' } }, error: null });
const settingsOk  = () => ({ data: { data: { objectives: ['Grow ARR'], personas: [{ name: 'PM' }] } }, error: null });
const memoryNull  = () => ({ data: null, error: null });
const statsEmpty  = () => ({ data: [], error: null });
const insertOk    = () => ({ data: null, error: null });

function fullQueue() {
    return [
        instanceOk(),    // [0] resolveInstance
        visionOk(),      // [1] loadVision
        settingsOk(),    // [2] settings context
        memoryNull(),    // [3] loadSprintMemory
        statsEmpty(),    // [4] getSprintStats (thenable)
        insertOk(),      // [5] save analysis_history (thenable)
    ];
}

const DATASET = [{ body: 'User wants dark mode', person: 'Alice', date: new Date().toISOString() }];

// ── 401 — no Clerk token ──────────────────────────────────────────────────────

describe('POST /api/analyze — auth', () => {
    test('401 when no Authorization header', async () => {
        const res = await makeUnauthRequest(app, 'post', '/api/analyze', { dataset: DATASET });
        expect(res.status).toBe(401);
    });
});

// ── 400 — missing dataset ─────────────────────────────────────────────────────

describe('POST /api/analyze — input validation', () => {
    test('400 when dataset is missing', async () => {
        db.__q([instanceOk()]);
        const res = await makeAuthRequest(app, 'post', '/api/analyze', {});
        expect(res.status).toBe(400);
    });

    test('400 when dataset is empty array', async () => {
        db.__q([instanceOk()]);
        const res = await makeAuthRequest(app, 'post', '/api/analyze', { dataset: [] });
        expect(res.status).toBe(400);
    });
});

// ── 403 — wrong instance ──────────────────────────────────────────────────────

describe('POST /api/analyze — instance isolation', () => {
    test('403 when instance does not belong to user', async () => {
        db.__q([instanceFail()]);
        const res = await makeAuthRequest(app, 'post', '/api/analyze', { dataset: DATASET }, INSTANCE_B, USER_A);
        expect(res.status).toBe(403);
    });
});

// ── 200 happy path ────────────────────────────────────────────────────────────

describe('POST /api/analyze — happy path', () => {
    test('returns analysis + meta on valid dataset', async () => {
        mockClaudeSuccess();
        db.__q(fullQueue());

        const res = await makeAuthRequest(app, 'post', '/api/analyze', { dataset: DATASET });
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('analysis');
        expect(res.body).toHaveProperty('meta');
    });

    test('meta.memory_used is false when no sprint memory exists', async () => {
        mockClaudeSuccess();
        db.__q(fullQueue());

        const res = await makeAuthRequest(app, 'post', '/api/analyze', { dataset: DATASET });
        expect(res.status).toBe(200);
        expect(res.body.meta.memory_used).toBe(false);
    });

    test('meta.longitudinal_triggered is false when fewer than 4 sprints', async () => {
        mockClaudeSuccess();
        db.__q(fullQueue());

        const res = await makeAuthRequest(app, 'post', '/api/analyze', { dataset: DATASET });
        expect(res.status).toBe(200);
        expect(res.body.meta.longitudinal_triggered).toBe(false);
    });

    test('response includes data_breakdown with high/medium/background counts', async () => {
        mockClaudeSuccess();
        db.__q(fullQueue());

        const res = await makeAuthRequest(app, 'post', '/api/analyze', { dataset: DATASET });
        expect(res.status).toBe(200);
        expect(res.body.meta).toHaveProperty('data_breakdown');
        const bd = res.body.meta.data_breakdown;
        expect(bd).toHaveProperty('high');
        expect(bd).toHaveProperty('medium');
        expect(bd).toHaveProperty('background');
    });
});

// ── Claude API resilience ─────────────────────────────────────────────────────

describe('POST /api/analyze — Claude API resilience', () => {
    test('500 when Claude returns no JSON block', async () => {
        mockClaudeMalformed();
        db.__q(fullQueue());

        const res = await makeAuthRequest(app, 'post', '/api/analyze', { dataset: DATASET });
        expect(res.status).toBe(500);
    });

    test('500 when Claude API call itself fails (network error)', async () => {
        global.fetch = jest.fn().mockRejectedValue(new Error('network error'));
        db.__q(fullQueue());

        const res = await makeAuthRequest(app, 'post', '/api/analyze', { dataset: DATASET });
        expect(res.status).toBe(500);
    });

    // Regression: Claude returns a JSON block but it's cut off (maxTokens truncation).
    // jsonMatch succeeds (finds the outer braces), but JSON.parse fails → 500, no crash.
    // This was the exact production failure at position 14059.
    test('500 when Claude returns truncated JSON (jsonMatch succeeds, parse fails)', async () => {
        global.fetch = jest.fn().mockResolvedValue({
            json: () => Promise.resolve({
                content: [{ text: '{"analysis": {"summary": "ok", "trends": [{"topic": "A", "d": }' }],
            }),
        });
        db.__q(fullQueue());

        const res = await makeAuthRequest(app, 'post', '/api/analyze', { dataset: DATASET });
        expect(res.status).toBe(500);
    });
});

// ── Regression tests ──────────────────────────────────────────────────────────

describe('POST /api/analyze — regression: personas stored as string', () => {
    // Bug fbe7b48: personas saved as "PM, Designer" (string) instead of [{name,role}] array
    // → s.personas.map is not a function → 500.
    // Fix: guard added in server.js — string personas silently ignored, analysis proceeds.

    test('200 when personas is a plain string (legacy format)', async () => {
        mockClaudeSuccess();
        db.__q([
            instanceOk(),
            visionOk(),
            // personas stored as legacy string instead of array
            { data: { data: { objectives: ['Grow ARR'], personas: 'PM, Designer' } }, error: null },
            memoryNull(),
            statsEmpty(),
            insertOk(),
        ]);

        const res = await makeAuthRequest(app, 'post', '/api/analyze', { dataset: DATASET });
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('analysis');
    });

    test('200 when personas is null or missing', async () => {
        mockClaudeSuccess();
        db.__q([
            instanceOk(),
            visionOk(),
            { data: { data: { objectives: ['Grow ARR'] } }, error: null }, // no personas field
            memoryNull(),
            statsEmpty(),
            insertOk(),
        ]);

        const res = await makeAuthRequest(app, 'post', '/api/analyze', { dataset: DATASET });
        expect(res.status).toBe(200);
    });
});

describe('POST /api/analyze — regression: sprint_memory in Claude response', () => {
    // When Claude returns sprint_memory, the route must call getCurrentSprint and
    // upsert radar_memory. Missing queue slots here would cause the test to hang or
    // return wrong data — verifying this path exercises the full save pipeline.
    //
    // Extra queue slots vs fullQueue():
    //   [6] getCurrentSprint → sprints.single() → null (no Jira sprint)
    //   [7] getSprintConfig  → settings.single() → no startDate → returns null
    //   [8] radar_memory.upsert → then()

    test('200 and radar_memory upserted when sprint_memory is present', async () => {
        const analysisWithMemory = {
            analysis: VALID_ANALYSIS.analysis,
            sprint_memory: {
                established_trends:    ['users want dark mode'],
                active_risks:          ['scope creep on epic A'],
                tracked_opportunities: [],
                decisions_made:        [],
            },
        };
        mockClaudeSuccess(analysisWithMemory);

        db.__q([
            instanceOk(),     // [0] resolveInstance
            visionOk(),       // [1] loadVision
            settingsOk(),     // [2] settings context
            memoryNull(),     // [3] loadSprintMemory
            statsEmpty(),     // [4] getSprintStats
            insertOk(),       // [5] save analysis_history
            { data: null, error: null }, // [6] getCurrentSprint → sprints.single() → null
            { data: null, error: null }, // [7] getSprintConfig  → settings.single() → no startDate
            insertOk(),       // [8] radar_memory.upsert
        ]);

        const res = await makeAuthRequest(app, 'post', '/api/analyze', { dataset: DATASET });
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('analysis');
        // meta still correct even when sprint_memory path ran
        expect(res.body.meta.memory_used).toBe(false); // no prior memory loaded
    });
});

/**
 * tests/meeting.test.js
 *
 * Tests for:
 *   POST /api/meeting-prep        (instance-scoped, AI call)
 *   POST /api/post-meeting        (INSTANCE_FREE_PATHS — no resolveInstance)
 *   POST /api/meeting-prep/save   (instance-scoped, DB write)
 *   GET  /api/meeting-prep/history (instance-scoped, DB read)
 *
 * Queue consumption for /api/meeting-prep (happy path):
 *   [0] resolveInstance          → instances.single()
 *   [1] loadVision               → vision.single()
 *   [2] settings                 → settings.single()
 *   [3] latestRadar              → analysis_history.single()
 *   [4] hubRows                  → intelligence_entries.then()
 *
 * /api/post-meeting: INSTANCE_FREE_PATHS → no resolveInstance, no DB calls.
 *
 * /api/meeting-prep/save:
 *   [0] resolveInstance          → instances.single()
 *   [1] insert                   → meeting_prep_history.insert().then()
 *
 * /api/meeting-prep/history:
 *   [0] resolveInstance          → instances.single()
 *   [1] select                   → meeting_prep_history.then()
 */

const { makeAuthRequest, makeUnauthRequest, USER_A, INSTANCE_A, INSTANCE_B, instanceOk, instanceFail } = require('./setup');

jest.mock('@clerk/express');
jest.mock('../database/db');
jest.mock('../routes/exec-routes');
jest.mock('../routes/roadmap-routes');

const { app } = require('../server');
const db = require('../database/db');

// ── Claude API mock ───────────────────────────────────────────────────────────

function mockClaudeText(text = '<SECRET>brief</SECRET><PUBLIC>agenda</PUBLIC>') {
    global.fetch = jest.fn().mockResolvedValue({
        json: () => Promise.resolve({ content: [{ text }] }),
    });
}

const savedFetch = global.fetch;
beforeEach(() => {
    db.__reset();
    global.fetch = jest.fn(); // fresh mock each test — prevents silent reuse of a previous Claude mock
});
afterAll(() => { global.fetch = savedFetch; });

// ── queue helpers ─────────────────────────────────────────────────────────────

const visionOk   = () => ({ data: { data: { vision: 'Best PM tool' } }, error: null });
const settingsOk = () => ({ data: { data: { objectives: [] } }, error: null });
const noRadar    = () => ({ data: null, error: { code: 'PGRST116' } });
const noHub      = () => ({ data: [], error: null });
const insertOk   = () => ({ data: null, error: null });

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/meeting-prep
// ═══════════════════════════════════════════════════════════════════════════════

describe('POST /api/meeting-prep', () => {
    test('401 when no Authorization header', async () => {
        const res = await makeUnauthRequest(app, 'post', '/api/meeting-prep', { actor: 'CEO', subject: 'Q3 priorities' });
        expect(res.status).toBe(401);
    });

    test('403 when wrong instance', async () => {
        db.__q([instanceFail()]);
        const res = await makeAuthRequest(app, 'post', '/api/meeting-prep', { actor: 'CEO', subject: 'Budget' }, INSTANCE_B, USER_A);
        expect(res.status).toBe(403);
    });

    test('400 when subject is missing', async () => {
        db.__q([instanceOk()]);
        const res = await makeAuthRequest(app, 'post', '/api/meeting-prep', { actor: 'CEO' });
        expect(res.status).toBe(400);
    });

    test('200 with valid subject — returns success + analysis', async () => {
        mockClaudeText();
        db.__q([
            instanceOk(),   // [0] resolveInstance
            visionOk(),     // [1] loadVision
            settingsOk(),   // [2] settings
            noRadar(),      // [3] latestRadar (not found — no radar yet)
            noHub(),        // [4] hubRows (thenable)
        ]);

        const res = await makeAuthRequest(app, 'post', '/api/meeting-prep', { actor: 'CEO', subject: 'Q3 planning', format: 'Meeting' });
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body).toHaveProperty('analysis');
        expect(res.body).toHaveProperty('radarEnriched');
    });

    test('radarEnriched is false when no radar analysis exists', async () => {
        mockClaudeText();
        db.__q([
            instanceOk(),
            visionOk(),
            settingsOk(),
            noRadar(),
            noHub(),
        ]);

        const res = await makeAuthRequest(app, 'post', '/api/meeting-prep', { actor: 'CEO', subject: 'Sprint review' });
        expect(res.status).toBe(200);
        expect(res.body.radarEnriched).toBe(false);
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/post-meeting  (INSTANCE_FREE_PATHS — no resolveInstance)
// ═══════════════════════════════════════════════════════════════════════════════

describe('POST /api/post-meeting', () => {
    test('401 when no Authorization header', async () => {
        const res = await makeUnauthRequest(app, 'post', '/api/post-meeting', { notes: 'We discussed roadmap', actor: 'CEO' });
        expect(res.status).toBe(401);
    });

    test('400 when notes is missing', async () => {
        // No X-Instance-Id needed — free path
        const supertest = require('supertest');
        const res = await supertest(app)
            .post('/api/post-meeting')
            .set('Authorization', `Bearer ${USER_A}`)
            .set('Content-Type', 'application/json')
            .send({ actor: 'CEO' });
        expect(res.status).toBe(400);
    });

    test('200 with valid notes — returns analysis', async () => {
        mockClaudeText('<SUMMARY>Key points</SUMMARY><INSIGHT>Watch the risk</INSIGHT>');
        // No X-Instance-Id needed — free path; no DB calls
        const supertest = require('supertest');
        const res = await supertest(app)
            .post('/api/post-meeting')
            .set('Authorization', `Bearer ${USER_A}`)
            .set('Content-Type', 'application/json')
            .send({ notes: 'Discussed roadmap priorities', actor: 'CTO' });
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body).toHaveProperty('analysis');
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/meeting-prep/save
// ═══════════════════════════════════════════════════════════════════════════════

describe('POST /api/meeting-prep/save', () => {
    test('401 when no Authorization header', async () => {
        const res = await makeUnauthRequest(app, 'post', '/api/meeting-prep/save', { subject: 'Q3' });
        expect(res.status).toBe(401);
    });

    test('400 when subject is missing', async () => {
        db.__q([instanceOk()]);
        const res = await makeAuthRequest(app, 'post', '/api/meeting-prep/save', { actor: 'CEO' });
        expect(res.status).toBe(400);
    });

    test('403 when wrong instance', async () => {
        db.__q([instanceFail()]);
        const res = await makeAuthRequest(app, 'post', '/api/meeting-prep/save', { subject: 'Sprint review' }, INSTANCE_B, USER_A);
        expect(res.status).toBe(403);
    });

    test('200 on valid save', async () => {
        db.__q([
            instanceOk(),  // [0] resolveInstance
            insertOk(),    // [1] insert (thenable)
        ]);

        const res = await makeAuthRequest(app, 'post', '/api/meeting-prep/save', {
            subject: 'Q3 Sprint Planning',
            actor: 'CTO',
            secretBrief: 'Confidential',
            publicAgenda: 'Agenda here',
        });
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/meeting-prep/history
// ═══════════════════════════════════════════════════════════════════════════════

describe('GET /api/meeting-prep/history', () => {
    test('401 when no Authorization header', async () => {
        const res = await makeUnauthRequest(app, 'get', '/api/meeting-prep/history');
        expect(res.status).toBe(401);
    });

    test('403 when wrong instance', async () => {
        db.__q([instanceFail()]);
        const res = await makeAuthRequest(app, 'get', '/api/meeting-prep/history', null, INSTANCE_B, USER_A);
        expect(res.status).toBe(403);
    });

    test('200 returns array', async () => {
        const rows = [
            { id: 'row-1', created_at: '2025-01-01T00:00:00Z', data: { subject: 'Sprint planning', actor: 'CEO' } },
        ];
        db.__q([
            instanceOk(),                        // [0] resolveInstance
            { data: rows, error: null },          // [1] history query (thenable)
        ]);

        const res = await makeAuthRequest(app, 'get', '/api/meeting-prep/history');
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
    });

    test('200 returns empty array when no history', async () => {
        db.__q([
            instanceOk(),
            { data: [], error: null },
        ]);

        const res = await makeAuthRequest(app, 'get', '/api/meeting-prep/history');
        expect(res.status).toBe(200);
        expect(res.body).toEqual([]);
    });

    test('history items include savedAt and subject', async () => {
        const rows = [
            { id: 'row-1', created_at: '2025-03-01T10:00:00Z', data: { subject: 'Board review', actor: 'Board' } },
        ];
        db.__q([
            instanceOk(),
            { data: rows, error: null },
        ]);

        const res = await makeAuthRequest(app, 'get', '/api/meeting-prep/history');
        expect(res.status).toBe(200);
        expect(res.body[0]).toHaveProperty('savedAt');
        expect(res.body[0]).toHaveProperty('subject');
    });
});

// ── Fault tolerance ───────────────────────────────────────────────────────────
// Context loading (vision, settings, radar, hub) is wrapped in a non-fatal inner
// try/catch — DB errors there are logged and swallowed. Only Claude failures
// propagate to the outer catch and produce a 500.

describe('POST /api/meeting-prep — fault tolerance', () => {
    test('500 when Claude API throws a network error', async () => {
        global.fetch = jest.fn().mockRejectedValue(new Error('network error'));
        db.__q([
            instanceOk(),  // [0] resolveInstance
            // context loading (vision, settings, radar, hub) is non-fatal — no queue slots needed
        ]);
        const res = await makeAuthRequest(app, 'post', '/api/meeting-prep',
            { actor: 'CEO', subject: 'Q3 planning' });
        expect(res.status).toBe(500);
    });
});

describe('POST /api/post-meeting — fault tolerance', () => {
    test('500 when Claude API throws a network error', async () => {
        global.fetch = jest.fn().mockRejectedValue(new Error('network error'));
        const supertest = require('supertest');
        const res = await supertest(app)
            .post('/api/post-meeting')
            .set('Authorization', `Bearer ${USER_A}`)
            .set('Content-Type', 'application/json')
            .send({ notes: 'Discussed roadmap priorities.', actor: 'CEO' });
        expect(res.status).toBe(500);
    });
});

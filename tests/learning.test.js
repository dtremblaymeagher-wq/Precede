/**
 * tests/learning.test.js
 *
 * Tests for:
 *   POST /api/learning/sync   — AI analysis of dev questions, saved to learning_vault
 *   GET  /api/learning/vault  — read back the saved advice
 *
 * Queue consumption:
 *
 * POST /api/learning/sync (no devQuestions):
 *   [0] resolveInstance         → instances.single()
 *   [1] backlog_stories         → instanceSelect.then()
 *   Returns { success: false, advice: "Aucune question technique trouvée." }
 *
 * POST /api/learning/sync (with devQuestions):
 *   [0] resolveInstance
 *   [1] backlog_stories         → instanceSelect.then()
 *   Claude API mock
 *   [2] upsert learning_vault   → learning_vault.then()
 *   Returns { success: true, advice }
 *
 * GET /api/learning/vault:
 *   [0] resolveInstance
 *   [1] learning_vault          → instanceSelect.single()
 *   Returns data?.data ?? { advice: "" }
 */

const { makeAuthRequest, makeUnauthRequest, USER_A, INSTANCE_A, INSTANCE_B, instanceOk, instanceFail } = require('./setup');

jest.mock('@clerk/express');
jest.mock('../database/db');
jest.mock('../routes/exec-routes');
jest.mock('../routes/roadmap-routes');

const { app } = require('../server');
const db = require('../database/db');

const savedFetch = global.fetch;
beforeEach(() => {
    db.__reset();
    global.fetch = savedFetch;
});
afterAll(() => { global.fetch = savedFetch; });

function mockClaude(text = '• Keep descriptions concise\n• Use acceptance criteria\n• Add context') {
    global.fetch = jest.fn().mockResolvedValue({
        json: () => Promise.resolve({ content: [{ text }] }),
    });
}

// ── POST /api/learning/sync ───────────────────────────────────────────────────

describe('POST /api/learning/sync', () => {
    test('returns success:false when no stories have dev questions', async () => {
        db.__q([
            instanceOk(),
            { data: [{ data: { title: 'Story A', devQuestions: [] } }], error: null },
        ]);
        const res = await makeAuthRequest(app, 'post', '/api/learning/sync', null, INSTANCE_A);
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(false);
        expect(res.body.advice).toBeTruthy();
    });

    test('returns success:true and advice when stories have dev questions', async () => {
        mockClaude('• Always respond in English. tip 1\n• tip 2\n• tip 3');
        db.__q([
            instanceOk(),
            { data: [{ data: { title: 'Story A', devQuestions: ['How should we handle auth?'] } }], error: null },
            { data: null, error: null }, // upsert
        ]);
        const res = await makeAuthRequest(app, 'post', '/api/learning/sync', null, INSTANCE_A);
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(typeof res.body.advice).toBe('string');
    });

    test('no auth → 401', async () => {
        const res = await makeUnauthRequest(app, 'post', '/api/learning/sync');
        expect(res.status).toBe(401);
    });

    test('missing X-Instance-Id → 400', async () => {
        const supertest = require('supertest');
        const res = await supertest(app).post('/api/learning/sync')
            .set('Authorization', `Bearer ${USER_A}`);
        expect(res.status).toBe(400);
    });

    test('wrong instance → 403', async () => {
        db.__q([instanceFail()]);
        const res = await makeAuthRequest(app, 'post', '/api/learning/sync', null, INSTANCE_B, USER_A);
        expect(res.status).toBe(403);
    });
});

// ── GET /api/learning/vault ───────────────────────────────────────────────────

describe('GET /api/learning/vault', () => {
    test('returns saved advice when vault exists', async () => {
        db.__q([
            instanceOk(),
            { data: { data: { advice: '• Write short titles\n• Add ACs' } }, error: null },
        ]);
        const res = await makeAuthRequest(app, 'get', '/api/learning/vault', null, INSTANCE_A);
        expect(res.status).toBe(200);
        expect(res.body.advice).toBe('• Write short titles\n• Add ACs');
    });

    test('returns empty advice when vault is empty', async () => {
        db.__q([instanceOk(), { data: null, error: null }]);
        const res = await makeAuthRequest(app, 'get', '/api/learning/vault', null, INSTANCE_A);
        expect(res.status).toBe(200);
        expect(res.body.advice).toBe('');
    });

    test('no auth → 401', async () => {
        const res = await makeUnauthRequest(app, 'get', '/api/learning/vault');
        expect(res.status).toBe(401);
    });

    test('wrong instance → 403', async () => {
        db.__q([instanceFail()]);
        const res = await makeAuthRequest(app, 'get', '/api/learning/vault', null, INSTANCE_B, USER_A);
        expect(res.status).toBe(403);
    });
});

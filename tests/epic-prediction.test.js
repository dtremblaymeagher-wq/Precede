/**
 * tests/epic-prediction.test.js
 *
 * Tests for routes/epic-prediction-routes.js:
 *   POST /api/epic-prediction/analyze       — AI categorization trigger
 *   GET  /api/epic-prediction/epics         — fetch predictions merged with story data
 *   PUT  /api/epic-prediction/override/:key — PM saves an override
 *   GET  /api/epic-prediction/summary       — categorization stats
 *
 * Queue consumption:
 *
 * POST /analyze (no epics):
 *   [0] resolveInstance
 *   [1] backlog_stories.then()
 *   [2] epic_predictions.then()
 *   → { message: 'No epics found', categorized: 0, matched: 0 }
 *
 * GET /epics (empty):
 *   [0] resolveInstance
 *   [1] backlog_stories.then()   (Promise.all)
 *   [2] epic_predictions.then()  (Promise.all)
 *
 * PUT /override/:key:
 *   [0] resolveInstance
 *   [1] backlog_stories.then()
 *   [2] epic_predictions.maybeSingle()
 *   [3] epic_predictions upsert.then()
 *
 * GET /summary (empty):
 *   [0] resolveInstance
 *   [1] backlog_stories.then()   (Promise.all)
 *   [2] epic_predictions.then()  (Promise.all)
 */

const { makeAuthRequest, makeUnauthRequest, USER_A, INSTANCE_A, INSTANCE_B, instanceOk, instanceFail } = require('./setup');

jest.mock('@clerk/express');
jest.mock('../database/db');
jest.mock('../routes/exec-routes');
jest.mock('../routes/roadmap-routes');

const { app } = require('../server');
const db = require('../database/db');

beforeEach(() => db.__reset());

// ── POST /api/epic-prediction/analyze ────────────────────────────────────────

describe('POST /api/epic-prediction/analyze', () => {
    test('returns no-epics message when backlog is empty', async () => {
        db.__q([
            instanceOk(),
            { data: [], error: null }, // backlog_stories
            { data: [], error: null }, // epic_predictions
        ]);
        const res = await makeAuthRequest(app, 'post', '/api/epic-prediction/analyze', {}, INSTANCE_A);
        expect(res.status).toBe(200);
        expect(res.body.message).toBe('No epics found');
        expect(res.body.categorized).toBe(0);
        expect(res.body.matched).toBe(0);
    });

    test('no auth → 401', async () => {
        const res = await makeUnauthRequest(app, 'post', '/api/epic-prediction/analyze', {});
        expect(res.status).toBe(401);
    });

    test('missing X-Instance-Id → 400', async () => {
        const supertest = require('supertest');
        const res = await supertest(app).post('/api/epic-prediction/analyze')
            .set('Authorization', `Bearer ${USER_A}`)
            .send({});
        expect(res.status).toBe(400);
    });

    test('wrong instance → 403', async () => {
        db.__q([instanceFail()]);
        const res = await makeAuthRequest(app, 'post', '/api/epic-prediction/analyze', {}, INSTANCE_B, USER_A);
        expect(res.status).toBe(403);
    });
});

// ── GET /api/epic-prediction/epics ───────────────────────────────────────────

describe('GET /api/epic-prediction/epics', () => {
    test('returns empty array when no stories', async () => {
        db.__q([
            instanceOk(),
            { data: [], error: null }, // backlog_stories
            { data: [], error: null }, // epic_predictions
        ]);
        const res = await makeAuthRequest(app, 'get', '/api/epic-prediction/epics', null, INSTANCE_A);
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
        expect(res.body).toHaveLength(0);
    });

    test('returns epics with prediction fields when stories exist', async () => {
        const stories = [
            { data: { epicKey: 'EPIC-1', epicName: 'Auth Epic', title: 'Story A', status: 'To Do' }, display_order: 1 },
            { data: { epicKey: 'EPIC-1', epicName: 'Auth Epic', title: 'Story B', status: 'Done' }, display_order: 2 },
        ];
        db.__q([
            instanceOk(),
            { data: stories, error: null },
            { data: [], error: null }, // no predictions yet
        ]);
        const res = await makeAuthRequest(app, 'get', '/api/epic-prediction/epics', null, INSTANCE_A);
        expect(res.status).toBe(200);
        expect(res.body).toHaveLength(1);
        expect(res.body[0].epicKey).toBe('EPIC-1');
        expect(res.body[0].isStale).toBe(true); // no prediction exists → stale
    });

    test('no auth → 401', async () => {
        const res = await makeUnauthRequest(app, 'get', '/api/epic-prediction/epics');
        expect(res.status).toBe(401);
    });

    test('wrong instance → 403', async () => {
        db.__q([instanceFail()]);
        const res = await makeAuthRequest(app, 'get', '/api/epic-prediction/epics', null, INSTANCE_B, USER_A);
        expect(res.status).toBe(403);
    });
});

// ── PUT /api/epic-prediction/override/:epicKey ───────────────────────────────

describe('PUT /api/epic-prediction/override/:epicKey', () => {
    test('saves valid tshirt_size override', async () => {
        db.__q([
            instanceOk(),
            { data: [], error: null },    // backlog_stories (to get epic name)
            { data: null, error: null },  // existing scope_projection
            { data: null, error: null },  // upsert
        ]);
        const res = await makeAuthRequest(app, 'put', '/api/epic-prediction/override/EPIC-1',
            { tshirt_size: 'M', note: 'Manually assessed' }, INSTANCE_A);
        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);
        expect(res.body.epicKey).toBe('EPIC-1');
    });

    test('rejects invalid tshirt_size → 400', async () => {
        db.__q([instanceOk()]);
        const res = await makeAuthRequest(app, 'put', '/api/epic-prediction/override/EPIC-1',
            { tshirt_size: 'HUGE' }, INSTANCE_A);
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/tshirt_size/i);
    });

    test('rejects invalid epic_type → 400', async () => {
        db.__q([instanceOk()]);
        const res = await makeAuthRequest(app, 'put', '/api/epic-prediction/override/EPIC-1',
            { epic_type: 'nonsense' }, INSTANCE_A);
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/epic_type/i);
    });

    test('no auth → 401', async () => {
        const res = await makeUnauthRequest(app, 'put', '/api/epic-prediction/override/EPIC-1',
            { tshirt_size: 'M' });
        expect(res.status).toBe(401);
    });

    test('wrong instance → 403', async () => {
        db.__q([instanceFail()]);
        const res = await makeAuthRequest(app, 'put', '/api/epic-prediction/override/EPIC-1',
            { tshirt_size: 'M' }, INSTANCE_B, USER_A);
        expect(res.status).toBe(403);
    });
});

// ── GET /api/epic-prediction/summary ─────────────────────────────────────────

describe('GET /api/epic-prediction/summary', () => {
    test('returns zero-counts when no stories or predictions', async () => {
        db.__q([
            instanceOk(),
            { data: [], error: null }, // backlog_stories
            { data: [], error: null }, // epic_predictions
        ]);
        const res = await makeAuthRequest(app, 'get', '/api/epic-prediction/summary', null, INSTANCE_A);
        expect(res.status).toBe(200);
        expect(res.body.totalEpics).toBe(0);
        expect(res.body.predicted).toBe(0);
        expect(res.body.stale).toBe(0);
    });

    test('no auth → 401', async () => {
        const res = await makeUnauthRequest(app, 'get', '/api/epic-prediction/summary');
        expect(res.status).toBe(401);
    });

    test('wrong instance → 403', async () => {
        db.__q([instanceFail()]);
        const res = await makeAuthRequest(app, 'get', '/api/epic-prediction/summary', null, INSTANCE_B, USER_A);
        expect(res.status).toBe(403);
    });
});

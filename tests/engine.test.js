/**
 * tests/engine.test.js
 *
 * Tests for routes/engine-routes.js (no Claude API calls — pure computation):
 *   GET /api/engine/analysis        — full: realityFactor + projections + retrospective
 *   GET /api/engine/reality-factor  — lightweight: historical baseline only
 *   GET /api/engine/predict/:epicKey — scope prediction for a single epic
 *
 * Queue consumption for all three routes:
 *   [0] resolveInstance   → instances.single()
 *   [1] backlog_stories   → loadStories().then()   (uses .order() chain → awaited)
 *
 * No further DB calls — all processing is local.
 */

const { makeAuthRequest, makeUnauthRequest, USER_A, INSTANCE_A, INSTANCE_B, instanceOk, instanceFail } = require('./setup');

jest.mock('@clerk/express');
jest.mock('../database/db');
jest.mock('../routes/exec-routes');
jest.mock('../routes/roadmap-routes');

const { app } = require('../server');
const db = require('../database/db');

beforeEach(() => db.__reset());

// Minimal story rows for epic with sprint data
const makeStory = (epicKey, sprintId, done = false) => ({
    data: {
        title: `Story ${sprintId}`,
        epicKey,
        epicName: `Epic ${epicKey}`,
        sprintId,
        sprintState: done ? 'closed' : 'active',
        status: done ? 'Done' : 'To Do',
        importedEffort: 3,
    },
    display_order: sprintId,
    created_at: new Date().toISOString(),
});

// ── GET /api/engine/analysis ──────────────────────────────────────────────────

describe('GET /api/engine/analysis', () => {
    test('returns empty result when no stories exist', async () => {
        db.__q([instanceOk(), { data: [], error: null }]);
        const res = await makeAuthRequest(app, 'get', '/api/engine/analysis', null, INSTANCE_A);
        expect(res.status).toBe(200);
        expect(res.body.realityFactor).toBeNull();
        expect(res.body.inflationCurve).toBeNull();
        expect(res.body.projections).toEqual([]);
        expect(res.body.retrospective).toEqual([]);
        expect(res.body.meta.totalEpics).toBe(0);
    });

    test('returns computed result when stories exist', async () => {
        const stories = [
            makeStory('EPIC-1', 1, true),
            makeStory('EPIC-1', 2, true),
            makeStory('EPIC-1', 3, false),
        ];
        db.__q([instanceOk(), { data: stories, error: null }]);
        const res = await makeAuthRequest(app, 'get', '/api/engine/analysis', null, INSTANCE_A);
        expect(res.status).toBe(200);
        expect(res.body.meta.totalEpics).toBeGreaterThan(0);
        expect(Array.isArray(res.body.projections)).toBe(true);
    });

    test('no auth → 401', async () => {
        const res = await makeUnauthRequest(app, 'get', '/api/engine/analysis');
        expect(res.status).toBe(401);
    });

    test('missing X-Instance-Id → 400', async () => {
        const supertest = require('supertest');
        const res = await supertest(app).get('/api/engine/analysis')
            .set('Authorization', `Bearer ${USER_A}`);
        expect(res.status).toBe(400);
    });

    test('wrong instance → 403', async () => {
        db.__q([instanceFail()]);
        const res = await makeAuthRequest(app, 'get', '/api/engine/analysis', null, INSTANCE_B, USER_A);
        expect(res.status).toBe(403);
    });
});

// ── GET /api/engine/reality-factor ───────────────────────────────────────────

describe('GET /api/engine/reality-factor', () => {
    test('returns null realityFactor when no stories', async () => {
        db.__q([instanceOk(), { data: [], error: null }]);
        const res = await makeAuthRequest(app, 'get', '/api/engine/reality-factor', null, INSTANCE_A);
        expect(res.status).toBe(200);
        expect(res.body.realityFactor).toBeNull();
        expect(res.body.completedEpicsAnalyzed).toBe(0);
    });

    test('no auth → 401', async () => {
        const res = await makeUnauthRequest(app, 'get', '/api/engine/reality-factor');
        expect(res.status).toBe(401);
    });

    test('wrong instance → 403', async () => {
        db.__q([instanceFail()]);
        const res = await makeAuthRequest(app, 'get', '/api/engine/reality-factor', null, INSTANCE_B, USER_A);
        expect(res.status).toBe(403);
    });
});

// ── GET /api/engine/predict/:epicKey ─────────────────────────────────────────

describe('GET /api/engine/predict/:epicKey', () => {
    test('returns 404 when epic not found', async () => {
        db.__q([instanceOk(), { data: [], error: null }]);
        const res = await makeAuthRequest(app, 'get', '/api/engine/predict/NONEXISTENT', null, INSTANCE_A);
        expect(res.status).toBe(404);
    });

    test('returns prediction when epic exists with sprint data', async () => {
        const stories = [
            makeStory('EPIC-1', 5, false),
            makeStory('EPIC-1', 5, true),
        ];
        db.__q([instanceOk(), { data: stories, error: null }]);
        const res = await makeAuthRequest(app, 'get', '/api/engine/predict/EPIC-1', null, INSTANCE_A);
        expect(res.status).toBe(200);
        expect(res.body.epicKey).toBe('EPIC-1');
        expect(res.body.prediction).toBeDefined();
    });

    test('no auth → 401', async () => {
        const res = await makeUnauthRequest(app, 'get', '/api/engine/predict/EPIC-1');
        expect(res.status).toBe(401);
    });

    test('wrong instance → 403', async () => {
        db.__q([instanceFail()]);
        const res = await makeAuthRequest(app, 'get', '/api/engine/predict/EPIC-1', null, INSTANCE_B, USER_A);
        expect(res.status).toBe(403);
    });
});

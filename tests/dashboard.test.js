/**
 * tests/dashboard.test.js
 *
 * Tests for:
 *   POST /api/dashboard/untracked-demand  — AI: signals not tracked in backlog
 *   POST /api/dashboard/okr-coverage      — AI: OKR × sprint stories × signals
 *
 * Queue for POST /api/dashboard/untracked-demand:
 *
 *   Cache hit (computedAt within 24h):
 *     [0] resolveInstance
 *     [1] settings.single() → cache present & fresh → returns cached value
 *
 *   Insufficient data (entries.length < 2):
 *     [0] resolveInstance
 *     [1] settings.single() → no cache
 *     [2] intelligence_entries.then()   (Promise.all)
 *     [3] backlog_stories.then()        (Promise.all)
 *     → { insufficient: true }
 *
 * Queue for POST /api/dashboard/okr-coverage:
 *
 *   No objectives early return:
 *     [0] resolveInstance
 *     [1] settings.single() → no objectives → { noObjectives: true }
 *
 *   No sprint / no data early return:
 *     [0] resolveInstance
 *     [1] settings.single() → has objectives, no cache
 *     [2] sprints.single()  → null (getCurrentSprint: no jira sprint)
 *     [3] settings.single() → null (getSprintConfig: no start date → sprint=null)
 *     [4] intelligence_entries.then()  (Promise.all)
 *     [5] backlog_stories.then()       (Promise.all)
 *     → { noData: true }  (0 sprintStories, entries.length < 2)
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

// ── POST /api/dashboard/untracked-demand ─────────────────────────────────────

describe('POST /api/dashboard/untracked-demand', () => {
    test('returns cached result when fresh cache exists', async () => {
        // Fingerprint = entryCount|mostRecentDate — need ≥2 entries to pass the insufficient check
        const entries      = [{ body: 'signal 1', date: '2026-01-02' }, { body: 'signal 2', date: '2026-01-01' }];
        const fingerprint  = `2|2026-01-02`;
        const cachedPayload = {
            results: [{ theme: 'Dark mode', signals: 5 }],
            computedAt: new Date().toISOString(),
            signalFingerprint: fingerprint,
        };
        db.__q([
            instanceOk(),
            { data: { data: { untrackedDemandCache: cachedPayload } }, error: null }, // settings
            { data: entries.map(e => ({ data: e })), error: null },  // intelligence_entries (fingerprint matches → cache hit)
            { data: [], error: null },                               // backlog_stories
        ]);
        const res = await makeAuthRequest(app, 'post', '/api/dashboard/untracked-demand', {}, INSTANCE_A);
        expect(res.status).toBe(200);
        expect(res.body.results).toEqual(cachedPayload.results);
    });

    test('returns insufficient:true when fewer than 2 hub entries', async () => {
        db.__q([
            instanceOk(),
            { data: { data: {} }, error: null },             // no cache in settings
            { data: [{ data: { body: 'one entry' } }], error: null }, // 1 entry only
            { data: [], error: null },                       // backlog_stories
        ]);
        const res = await makeAuthRequest(app, 'post', '/api/dashboard/untracked-demand', {}, INSTANCE_A);
        expect(res.status).toBe(200);
        expect(res.body.insufficient).toBe(true);
        expect(res.body.results).toEqual([]);
    });

    test('no auth → 401', async () => {
        const res = await makeUnauthRequest(app, 'post', '/api/dashboard/untracked-demand', {});
        expect(res.status).toBe(401);
    });

    test('missing X-Instance-Id → 400', async () => {
        const supertest = require('supertest');
        const res = await supertest(app).post('/api/dashboard/untracked-demand')
            .set('Authorization', `Bearer ${USER_A}`)
            .set('Content-Type', 'application/json')
            .send({});
        expect(res.status).toBe(400);
    });

    test('wrong instance → 403', async () => {
        db.__q([instanceFail()]);
        const res = await makeAuthRequest(app, 'post', '/api/dashboard/untracked-demand', {}, INSTANCE_B, USER_A);
        expect(res.status).toBe(403);
    });
});

// ── POST /api/dashboard/okr-coverage ─────────────────────────────────────────

describe('POST /api/dashboard/okr-coverage', () => {
    test('returns noObjectives:true when no OKRs configured', async () => {
        db.__q([
            instanceOk(),
            { data: { data: { objectives: [] } }, error: null },
        ]);
        const res = await makeAuthRequest(app, 'post', '/api/dashboard/okr-coverage', {}, INSTANCE_A);
        expect(res.status).toBe(200);
        expect(res.body.noObjectives).toBe(true);
    });

    test('returns noData:true when no sprint stories and insufficient signals', async () => {
        db.__q([
            instanceOk(),
            { data: { data: { objectives: ['Grow ARR'] } }, error: null }, // settings
            { data: null, error: null },   // getCurrentSprint → sprints.single() → null
            { data: null, error: null },   // getSprintConfig → settings.single() → no startDate
            { data: [], error: null },     // intelligence_entries (Promise.all)
            { data: [], error: null },     // backlog_stories (Promise.all)
        ]);
        const res = await makeAuthRequest(app, 'post', '/api/dashboard/okr-coverage', {}, INSTANCE_A);
        expect(res.status).toBe(200);
        expect(res.body.noData).toBe(true);
    });

    test('no auth → 401', async () => {
        const res = await makeUnauthRequest(app, 'post', '/api/dashboard/okr-coverage', {});
        expect(res.status).toBe(401);
    });

    test('missing X-Instance-Id → 400', async () => {
        const supertest = require('supertest');
        const res = await supertest(app).post('/api/dashboard/okr-coverage')
            .set('Authorization', `Bearer ${USER_A}`)
            .set('Content-Type', 'application/json')
            .send({});
        expect(res.status).toBe(400);
    });

    test('wrong instance → 403', async () => {
        db.__q([instanceFail()]);
        const res = await makeAuthRequest(app, 'post', '/api/dashboard/okr-coverage', {}, INSTANCE_B, USER_A);
        expect(res.status).toBe(403);
    });
});

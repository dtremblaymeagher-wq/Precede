/**
 * tests/roadmap.test.js
 *
 * Tests for /api/roadmap/* routes (epics, velocity, projection).
 * These routes live in routes/roadmap-routes.js and are mounted by server.js.
 *
 * ⚠️  PREREQUISITE: server.js must export `app` and guard app.listen().
 */

const { makeAuthRequest, USER_A, INSTANCE_A, INSTANCE_B, instanceOk, instanceFail } = require('./setup');

jest.mock('@clerk/express');
jest.mock('../database/db');
jest.mock('../routes/exec-routes');
// NOTE: roadmap-routes is NOT mocked here — we need to test it
// But roadmap-routes is mounted via createRoadmapRouter(supabase, getAuth)
// which means it receives the mocked supabase. Tests should work.

const { app } = require('../server');
const db = require('../database/db');

beforeEach(() => db.__reset());

// Helper: a minimal backlog story row
const makeStory = (epicKey, status, jiraRank = null, position = 1) => ({
    filename: `story-${Date.now() + Math.random()}.json`,
    data: {
        title: `Story in ${epicKey}`,
        status,
        epicKey,
        epicName: `Epic ${epicKey}`,
        jiraRank,
        labels: [],
    },
    display_order: position,
});

// ── GET /api/roadmap/epics ────────────────────────────────────────────────────
describe('GET /api/roadmap/epics', () => {
    test('returns epics grouped from backlog stories', async () => {
        const stories = [
            makeStory('EPIC-1', 'To Do', 1),
            makeStory('EPIC-1', 'In Progress', 2),
            makeStory('EPIC-2', 'To Do', 3),
        ];
        // Consumption order: resolveInstance, then instances.single() (synchronous, built in array
        // literal), then loadStories.then (microtask scheduled by await on thenable chain).
        db.__q([
            instanceOk(),
            { data: { name: 'My Instance' }, error: null },       // instances.single (synchronous)
            { data: stories, error: null },                        // loadStories (.then via microtask)
        ]);

        const res = await makeAuthRequest(app, 'get', '/api/roadmap/epics', null, INSTANCE_A);
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
        // Response items use `id` (mapped from epic.key) and `name`
        const epicIds = res.body.map(e => e.id);
        expect(epicIds).toContain('EPIC-1');
        expect(epicIds).toContain('EPIC-2');
    });

    test('returns empty array if no stories', async () => {
        db.__q([
            instanceOk(),
            { data: { name: 'My Instance' }, error: null }, // instances.single (synchronous)
            { data: [], error: null },                       // loadStories (.then)
        ]);

        const res = await makeAuthRequest(app, 'get', '/api/roadmap/epics', null, INSTANCE_A);
        expect(res.status).toBe(200);
        expect(res.body).toEqual([]);
    });

    test('cannot access from other instance (→ 403)', async () => {
        db.__q([instanceFail()]);
        const res = await makeAuthRequest(app, 'get', '/api/roadmap/epics', null, INSTANCE_B, USER_A);
        expect(res.status).toBe(403);
    });
});

// ── GET /api/roadmap/velocity ─────────────────────────────────────────────────
describe('GET /api/roadmap/velocity', () => {
    test('returns velocity metrics object', async () => {
        const completedStories = [
            makeStory('EPIC-1', 'done'),
            makeStory('EPIC-1', 'done'),
        ];
        // Promise.all([loadStories, loadSprintContext]): loadSprintContext runs sync until
        // settings.maybeSingle (synchronous), then loadStories.then + sprints.then (microtasks)
        db.__q([
            instanceOk(),
            { data: { data: { sprint_duration_days: 14 } }, error: null }, // settings.maybeSingle
            { data: completedStories, error: null },                        // loadStories (.then)
            { data: [], error: null },                                      // sprints (.then)
        ]);

        const res = await makeAuthRequest(app, 'get', '/api/roadmap/velocity', null, INSTANCE_A);
        expect(res.status).toBe(200);
        expect(res.body).toBeInstanceOf(Object);
    });

    test('includes lowConfidence flag when fewer than 2 sprints of data', async () => {
        // With no completed stories, velocity is low confidence
        db.__q([
            instanceOk(),
            { data: { data: {} }, error: null }, // settings.maybeSingle
            { data: [], error: null },            // loadStories (.then)
            { data: [], error: null },            // sprints (.then)
        ]);

        const res = await makeAuthRequest(app, 'get', '/api/roadmap/velocity', null, INSTANCE_A);
        expect(res.status).toBe(200);
        expect(res.body.lowConfidence).toBe(true);
    });
});

// ── GET /api/roadmap/projection ───────────────────────────────────────────────
describe('GET /api/roadmap/projection', () => {
    test('returns projections wrapped in { projections, lowConfidence, ... }', async () => {
        const stories = [
            makeStory('EPIC-1', 'To Do', 1),
            makeStory('EPIC-1', 'To Do', 2),
        ];
        // Consumption order: resolveInstance, then loadSprintContext settings.maybeSingle (synchronous
        // when building inner Promise.all args), then loadStories.then + sprints.then (microtasks).
        db.__q([
            instanceOk(),
            { data: { data: { sprint_duration_days: 14 } }, error: null }, // settings.maybeSingle (synchronous)
            { data: stories, error: null },                                 // loadStories (.then microtask)
            { data: [], error: null },                                     // sprints (.then microtask)
        ]);

        const res = await makeAuthRequest(app, 'get', '/api/roadmap/projection', null, INSTANCE_A);
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('projections');
        expect(Array.isArray(res.body.projections)).toBe(true);
        expect(res.body).toHaveProperty('lowConfidence');
    });

    test('each projection item has projection.bestCase / mostLikely / worstCase', async () => {
        const stories = [makeStory('EPIC-A', 'To Do', 1)];
        db.__q([
            instanceOk(),
            { data: { data: { sprint_duration_days: 14 } }, error: null }, // settings.maybeSingle
            { data: stories, error: null },                                 // loadStories
            { data: [], error: null },                                     // sprints
        ]);

        const res = await makeAuthRequest(app, 'get', '/api/roadmap/projection', null, INSTANCE_A);
        expect(res.status).toBe(200);
        if (res.body.projections.length > 0) {
            const proj = res.body.projections[0];
            // Confidence keys are nested under proj.projection
            expect(proj).toHaveProperty('projection');
            expect(proj.projection).toHaveProperty('bestCase');
            expect(proj.projection).toHaveProperty('mostLikely');
            expect(proj.projection).toHaveProperty('worstCase');
        }
    });

    test('handles empty stories gracefully — returns projections: []', async () => {
        // Same consumption order — stories is empty → route returns early with projections:[]
        db.__q([
            instanceOk(),
            { data: { data: { sprint_duration_days: 14 } }, error: null }, // settings.maybeSingle
            { data: [], error: null },                                      // loadStories
            { data: [], error: null },                                      // sprints
        ]);

        const res = await makeAuthRequest(app, 'get', '/api/roadmap/projection', null, INSTANCE_A);
        expect(res.status).toBe(200);
        expect(res.body.projections).toEqual([]);
        expect(res.body.lowConfidence).toBe(true);
    });
});

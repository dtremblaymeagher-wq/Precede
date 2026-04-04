/**
 * tests/exec.test.js
 *
 * Tests for /api/exec/* routes (executive dashboard).
 * Routes are mounted from routes/exec-routes.js.
 *
 * /api/exec/instances  — INSTANCE_FREE_PATHS, no resolveInstance
 * /api/exec/strategic  — instance-scoped
 * /api/exec/pulse      — instance-scoped
 * /api/exec/forward    — instance-scoped
 *
 * Queue consumption (instance-scoped routes):
 *
 *   /strategic (0 PM instances):
 *     [0] resolveInstance → instances.single()
 *     [1] getPmInstances  → instances.then()
 *
 *   /strategic (1 PM instance):
 *     [0] resolveInstance → instances.single()
 *     [1] getPmInstances  → instances.then()
 *     [2] analyses        → analysis_history.then()   (Promise.all slot 0)
 *     [3] settings        → settings.then()           (Promise.all slot 1)
 *     [4] stories         → backlog_stories.then()    (Promise.all slot 2)
 *
 *   /pulse (1 PM instance):
 *     [0] resolveInstance → instances.single()
 *     [1] getPmInstances  → instances.then()
 *     [2] stories         → backlog_stories.then()    (Promise.all slot 0)
 *     [3] signals         → intelligence_entries.then() (Promise.all slot 1)
 *
 *   /forward (1 PM instance):
 *     [0] resolveInstance     → instances.single()
 *     [1] getPmInstances      → instances.then()
 *     [2] latestAnalysis (×1) → analysis_history.maybeSingle()  (inner Promise.all, sync)
 *     [3] activeSprintRes     → sprints.maybeSingle()           (outer Promise.all, sync)
 *     [4] storiesRes          → backlog_stories.then()          (outer Promise.all, thenable)
 *     [5] settingsRes         → settings.then()                 (outer Promise.all, thenable)
 *
 *   NOTE: In the outer Promise.all of /forward:
 *   - Promise.all(pmIds.map(...maybeSingle())) — inner array builds first → consumes queue[2]
 *   - backlog_stories (thenable) — evaluated next in array literal → no consume yet
 *   - sprints.maybeSingle() — called synchronously → consumes queue[3]
 *   - settings (thenable) — evaluated next → no consume yet
 *   Then Promise.all calls .then() on the two thenables → queue[4], queue[5]
 */

const { makeAuthRequest, makeUnauthRequest, USER_A, INSTANCE_A, INSTANCE_B, instanceOk, instanceFail } = require('./setup');

jest.mock('@clerk/express');
jest.mock('../database/db');
// roadmap-routes is NOT mocked here — exec-routes.js doesn't depend on it.
// But server.js imports both, so we mock roadmap-routes to keep the router empty.
jest.mock('../routes/roadmap-routes');

const { app } = require('../server');
const db = require('../database/db');

beforeEach(() => db.__reset());

const PM_INSTANCE = { id: INSTANCE_A, name: 'My PM Instance', color: '#4f46e5' };

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/exec/instances
// ═══════════════════════════════════════════════════════════════════════════════

describe('GET /api/exec/instances', () => {
    test('401 when no Authorization header', async () => {
        const res = await makeUnauthRequest(app, 'get', '/api/exec/instances');
        expect(res.status).toBe(401);
    });

    test('200 returns array of PM instances', async () => {
        // INSTANCE_FREE_PATHS — no resolveInstance → queue[0] is getPmInstances (thenable)
        db.__q([{ data: [PM_INSTANCE], error: null }]);

        const res = await makeAuthRequest(app, 'get', '/api/exec/instances');
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
    });

    test('200 returns empty array when no PM instances', async () => {
        db.__q([{ data: [], error: null }]);

        const res = await makeAuthRequest(app, 'get', '/api/exec/instances');
        expect(res.status).toBe(200);
        expect(res.body).toEqual([]);
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/exec/strategic
// ═══════════════════════════════════════════════════════════════════════════════

describe('GET /api/exec/strategic', () => {
    test('401 when no Authorization header', async () => {
        const res = await makeUnauthRequest(app, 'get', '/api/exec/strategic');
        expect(res.status).toBe(401);
    });

    test('403 when wrong instance', async () => {
        db.__q([instanceFail()]);
        const res = await makeAuthRequest(app, 'get', '/api/exec/strategic', null, INSTANCE_B, USER_A);
        expect(res.status).toBe(403);
    });

    test('200 with empty pm_instances array when no PM instances', async () => {
        db.__q([
            instanceOk(),                       // [0] resolveInstance
            { data: [], error: null },           // [1] getPmInstances (thenable)
        ]);

        const res = await makeAuthRequest(app, 'get', '/api/exec/strategic');
        expect(res.status).toBe(200);
        expect(res.body.pm_instances).toEqual([]);
        expect(Array.isArray(res.body.okr_trend)).toBe(true);
    });

    test('200 returns expected shape with 1 PM instance', async () => {
        db.__q([
            instanceOk(),                                        // [0] resolveInstance
            { data: [PM_INSTANCE], error: null },               // [1] getPmInstances
            { data: [], error: null },                          // [2] analyses (Promise.all[0])
            { data: [], error: null },                          // [3] settings (Promise.all[1])
            { data: [], error: null },                          // [4] stories  (Promise.all[2])
        ]);

        const res = await makeAuthRequest(app, 'get', '/api/exec/strategic');
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('pm_instances');
        expect(res.body).toHaveProperty('okr_trend');
        expect(res.body).toHaveProperty('okr_objectives');
        expect(res.body).toHaveProperty('signal_coverage');
        expect(res.body).toHaveProperty('vision_drift');
        expect(res.body).toHaveProperty('focus_guard');
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/exec/pulse
// ═══════════════════════════════════════════════════════════════════════════════

describe('GET /api/exec/pulse', () => {
    test('401 when no Authorization header', async () => {
        const res = await makeUnauthRequest(app, 'get', '/api/exec/pulse');
        expect(res.status).toBe(401);
    });

    test('403 when wrong instance', async () => {
        db.__q([instanceFail()]);
        const res = await makeAuthRequest(app, 'get', '/api/exec/pulse', null, INSTANCE_B, USER_A);
        expect(res.status).toBe(403);
    });

    test('200 returns empty arrays when no PM instances', async () => {
        db.__q([
            instanceOk(),
            { data: [], error: null },
        ]);

        const res = await makeAuthRequest(app, 'get', '/api/exec/pulse');
        expect(res.status).toBe(200);
        expect(res.body.pm_instances).toEqual([]);
        expect(Array.isArray(res.body.scope_drift)).toBe(true);
    });

    test('200 returns expected shape with 1 PM instance', async () => {
        db.__q([
            instanceOk(),                          // [0] resolveInstance
            { data: [PM_INSTANCE], error: null }, // [1] getPmInstances
            { data: [], error: null },             // [2] stories (Promise.all[0])
            { data: [], error: null },             // [3] signals (Promise.all[1])
        ]);

        const res = await makeAuthRequest(app, 'get', '/api/exec/pulse');
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('scope_drift');
        expect(res.body).toHaveProperty('signal_velocity');
        expect(res.body).toHaveProperty('epic_health');
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/exec/forward
// ═══════════════════════════════════════════════════════════════════════════════

describe('GET /api/exec/forward', () => {
    test('401 when no Authorization header', async () => {
        const res = await makeUnauthRequest(app, 'get', '/api/exec/forward');
        expect(res.status).toBe(401);
    });

    test('403 when wrong instance', async () => {
        db.__q([instanceFail()]);
        const res = await makeAuthRequest(app, 'get', '/api/exec/forward', null, INSTANCE_B, USER_A);
        expect(res.status).toBe(403);
    });

    test('200 returns empty arrays when no PM instances', async () => {
        db.__q([
            instanceOk(),
            { data: [], error: null },
        ]);

        const res = await makeAuthRequest(app, 'get', '/api/exec/forward');
        expect(res.status).toBe(200);
        expect(res.body.pm_instances).toEqual([]);
        expect(Array.isArray(res.body.predictive_timeline)).toBe(true);
        expect(Array.isArray(res.body.decisions_required)).toBe(true);
    });

    test('200 returns expected shape with 1 PM instance (no active sprint)', async () => {
        // For /forward with 1 PM instance:
        // Inner Promise.all: maybeSingle (latestAnalysis) → queue[2] (sync)
        // Outer Promise.all array evaluation: sprints.maybeSingle() → queue[3] (sync)
        // Then Promise.all calls .then() on: backlog_stories → queue[4], settings → queue[5]
        db.__q([
            instanceOk(),                           // [0] resolveInstance
            { data: [PM_INSTANCE], error: null },   // [1] getPmInstances
            { data: null,          error: null },   // [2] latestAnalysis (maybeSingle, inner Promise.all)
            { data: null,          error: null },   // [3] activeSprint   (maybeSingle, sync in outer array)
            { data: [],            error: null },   // [4] stories        (thenable, outer Promise.all)
            { data: [],            error: null },   // [5] settings       (thenable, outer Promise.all)
        ]);

        const res = await makeAuthRequest(app, 'get', '/api/exec/forward');
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('predictive_timeline');
        expect(res.body).toHaveProperty('risks');
        expect(res.body).toHaveProperty('decisions_required');
    });
});

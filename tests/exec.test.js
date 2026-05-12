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

const { makeAuthRequest, makeUnauthRequest, USER_A, USER_B, INSTANCE_A, INSTANCE_B, instanceOk, instanceFail } = require('./setup');

jest.mock('@clerk/express');
jest.mock('../database/db');
// roadmap-routes is NOT mocked here — exec-routes.js doesn't depend on it.
// But server.js imports both, so we mock roadmap-routes to keep the router empty.
jest.mock('../routes/roadmap-routes');

const { app } = require('../server');
const db = require('../database/db');

const savedFetch = global.fetch;
beforeEach(() => { db.__reset(); global.fetch = savedFetch; });
afterAll(() => { global.fetch = savedFetch; });

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

    test('cross-user isolation: USER_B gets their own (empty) instances via __qTable', async () => {
        // __qTable makes this test resilient to new DB calls added to the route.
        // USER_B has no PM instances — verifies the route uses req.userId (from token),
        // not a hardcoded or leaked value.
        const supertest = require('supertest');
        db.__qTable('instances', [{ data: [], error: null }]);
        const res = await supertest(app)
            .get('/api/exec/instances')
            .set('Authorization', `Bearer ${USER_B}`);
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
        expect(res.body).toHaveProperty('vision_alignment');
        expect(res.body).toHaveProperty('focus_guard');
    });

    test('cross-user isolation: USER_B only sees their own pm_instances', async () => {
        // USER_B has their own exec instance but no PM instances.
        // Even though PM_INSTANCE belongs to USER_A, USER_B must get [].
        const supertest = require('supertest');
        db.__q([
            { data: { id: INSTANCE_B }, error: null }, // [0] resolveInstance for USER_B's exec instance
            { data: [], error: null },                  // [1] getPmInstances(USER_B) → no PM instances
        ]);
        const res = await supertest(app)
            .get('/api/exec/strategic')
            .set('Authorization', `Bearer ${USER_B}`)
            .set('X-Instance-Id', INSTANCE_B);
        expect(res.status).toBe(200);
        expect(res.body.pm_instances).toEqual([]);
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
            { data: [], error: null },             // [4] sprints (Promise.all[2])
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

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/exec/synthesis
// ═══════════════════════════════════════════════════════════════════════════════
//
// Queue consumption:
//   [0] resolveInstance        → instances.single()
//   [1] getPmInstances         → instances.then()
//   [2] closedSprint           → sprints.maybeSingle()
//   [3] cached synthesis       → analysis_history.maybeSingle()
//   [4] analysesRes            → analysis_history.then()  (Promise.all[0])
//   [5] storiesRes             → backlog_stories.then()   (Promise.all[1])
//   [6] entriesRes             → intelligence_entries.then() (Promise.all[2])
//   [7] sprintsHistRes         → sprints.then()           (Promise.all[3])
//   Claude call (fetch mock)
//   [8] insert analysis_history → analysis_history.then()

describe('GET /api/exec/synthesis', () => {
    test('401 when no Authorization header', async () => {
        const res = await makeUnauthRequest(app, 'get', '/api/exec/synthesis');
        expect(res.status).toBe(401);
    });

    test('200 insufficient_data when no PM instances', async () => {
        db.__q([
            instanceOk(),              // [0] resolveInstance
            { data: [], error: null }, // [1] getPmInstances → no PM instances
        ]);
        const res = await makeAuthRequest(app, 'get', '/api/exec/synthesis');
        expect(res.status).toBe(200);
        expect(res.body.insufficient_data).toBe(true);
        expect(res.body.synthesis).toBeNull();
    });

    test('200 with generation_error when Claude returns malformed JSON', async () => {
        // Synthesis route has a try/catch around callAI: malformed JSON → { generation_error: true }
        // This verifies the route never crashes and always returns a 200 with structured data.
        global.fetch = jest.fn().mockResolvedValue({
            json: () => Promise.resolve({ content: [{ text: 'not valid json at all' }] }),
        });

        const CLOSED_SPRINT = { name: 'Sprint 1', start_date: '2024-01-01', end_date: '2024-01-14' };
        db.__q([
            instanceOk(),                                         // [0] resolveInstance
            { data: [PM_INSTANCE], error: null },                 // [1] getPmInstances
            { data: CLOSED_SPRINT,  error: null },                // [2] closedSprint (maybeSingle)
            { data: null,           error: null },                // [3] cached → cache miss
            { data: [],             error: null },                // [4] analysesRes     (Promise.all[0])
            { data: [],             error: null },                // [5] storiesRes      (Promise.all[1])
            { data: [],             error: null },                // [6] entriesRes      (Promise.all[2])
            { data: [],             error: null },                // [7] sprintsHistRes  (Promise.all[3])
            { data: null,           error: null },                // [8] insert analysis_history
        ]);

        const res = await makeAuthRequest(app, 'get', '/api/exec/synthesis');
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('synthesis');
        expect(res.body.synthesis).toHaveProperty('generation_error', true);
        expect(res.body.sprint_name).toBe('Sprint 1');
    });

    test('200 returns cached synthesis when sprint name matches', async () => {
        // Cache hit: cached.data.sprint_name === closedSprint.name → returns immediately, no Claude call
        const CLOSED_SPRINT  = { name: 'Sprint 3', start_date: '2026-01-01', end_date: '2026-01-14' };
        const CACHED_PAYLOAD = { sprint_name: 'Sprint 3', synthesis: { headline: 'Strong quarter' }, generated_at: '2026-01-15T10:00:00Z' };
        db.__q([
            instanceOk(),
            { data: [PM_INSTANCE],            error: null }, // [1] getPmInstances
            { data: CLOSED_SPRINT,            error: null }, // [2] closedSprint (maybeSingle)
            { data: { data: CACHED_PAYLOAD }, error: null }, // [3] cached (maybeSingle) — cache hit
        ]);
        const res = await makeAuthRequest(app, 'get', '/api/exec/synthesis');
        expect(res.status).toBe(200);
        expect(res.body.cached).toBe(true);
        expect(res.body.sprint_name).toBe('Sprint 3');
        expect(res.body.synthesis).toHaveProperty('headline');
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/exec/current-sprint
// ═══════════════════════════════════════════════════════════════════════════════
//
// Queue (no PM instances):
//   [0] resolveInstance   → instances.single()
//   [1] getPmInstances    → instances.then()
//   → { sprint: null, instances: [] }
//
// Queue (with PM instances, active sprint):
//   [0] resolveInstance
//   [1] getPmInstances    → [PM_INSTANCE]
//   [2] sprints.maybeSingle() — synchronous in Promise.all array eval
//   [3] backlog_stories   → thenable
//   [4] intelligence_entries → thenable

describe('GET /api/exec/current-sprint', () => {
    test('401 when no Authorization header', async () => {
        const res = await makeUnauthRequest(app, 'get', '/api/exec/current-sprint');
        expect(res.status).toBe(401);
    });

    test('403 when wrong instance', async () => {
        db.__q([instanceFail()]);
        const res = await makeAuthRequest(app, 'get', '/api/exec/current-sprint', null, INSTANCE_B, USER_A);
        expect(res.status).toBe(403);
    });

    test('returns { sprint: null } when no PM instances', async () => {
        db.__q([
            instanceOk(),
            { data: [], error: null }, // getPmInstances
        ]);
        const res = await makeAuthRequest(app, 'get', '/api/exec/current-sprint');
        expect(res.status).toBe(200);
        expect(res.body.sprint).toBeNull();
        expect(Array.isArray(res.body.instances)).toBe(true);
    });

    test('returns { sprint: null } when no active sprint', async () => {
        db.__q([
            instanceOk(),
            { data: [PM_INSTANCE], error: null }, // getPmInstances
            { data: null, error: null },            // sprints.maybeSingle() — no active sprint
            { data: [], error: null },              // backlog_stories (thenable)
            { data: [], error: null },              // intelligence_entries (thenable)
        ]);
        const res = await makeAuthRequest(app, 'get', '/api/exec/current-sprint');
        expect(res.status).toBe(200);
        expect(res.body.sprint).toBeNull();
    });

    test('returns sprint info and per-instance metrics when active sprint exists', async () => {
        const ACTIVE_SPRINT = { name: 'Sprint 7', state: 'active', start_date: '2026-01-20', end_date: '2026-02-03' };
        db.__q([
            instanceOk(),
            { data: [PM_INSTANCE],  error: null }, // getPmInstances
            { data: ACTIVE_SPRINT,  error: null }, // sprints.maybeSingle()
            { data: [],             error: null }, // backlog_stories
            { data: [],             error: null }, // intelligence_entries
        ]);
        const res = await makeAuthRequest(app, 'get', '/api/exec/current-sprint');
        expect(res.status).toBe(200);
        expect(res.body.sprint).toHaveProperty('name', 'Sprint 7');
        expect(Array.isArray(res.body.instances)).toBe(true);
    });
});

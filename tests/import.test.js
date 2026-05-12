/**
 * tests/import.test.js
 *
 * Tests for:
 *   POST /api/import/initial   — full import from Jira
 *   POST /api/import/sync      — incremental sync
 *   POST /api/import/sync-ranks — rank sync from Jira board API
 *
 * All three routes:
 *   1. Go through resolveInstance → queue[0]
 *   2. Call loadIntegrationConfig() → integrations.single() → queue[1]
 *   3. If no config → 404 (no further queue consumption)
 *
 * The Jira integration is mocked at the module level so no real HTTP calls
 * are made. For the happy-path tests we use empty story lists to avoid
 * triggering batchCalculateRice() (which would call Claude API) and the
 * per-story upsert loop.
 *
 * Happy-path queue for /import/initial (0 stories from Jira):
 *   [0] resolveInstance          → instances.single()
 *   [1] loadIntegrationConfig    → integrations.single()
 *   [2] existingRows             → backlog_stories.then()
 *   [3] saveImportState          → settings upsert .then()
 *   (no boardId in mock config → no sprint sync)
 *
 * Happy-path queue for /import/sync (0 stories):
 *   [0] resolveInstance
 *   [1] loadIntegrationConfig
 *   [2] existingRows (backlog_stories.then)
 *   [3] reconciliation: allStored (backlog_stories.then)
 *   [4] saveImportState (.then)
 *
 * Happy-path queue for /import/sync-ranks (no stories in DB):
 *   [0] resolveInstance
 *   [1] loadIntegrationConfig
 *   Jira board API calls → mocked via JiraIntegration mock
 *   [2] stored stories (backlog_stories.then)
 */

const { makeAuthRequest, makeUnauthRequest, USER_A, INSTANCE_A, INSTANCE_B, instanceOk, instanceFail } = require('./setup');

jest.mock('@clerk/express');
jest.mock('../database/db');
jest.mock('../routes/exec-routes');
jest.mock('../routes/roadmap-routes');

// Mock the Jira integration — returns 0 stories so batchCalculateRice is never called
jest.mock('../integrations', () => ({
    getIntegration: () => ({
        fetchSignals: jest.fn().mockResolvedValue([]),
    }),
}));

jest.mock('../integrations/jira-story-importer', () => {
    return jest.fn().mockImplementation(() => ({
        fetchInitial:    jest.fn().mockResolvedValue([]),
        fetchIncremental: jest.fn().mockResolvedValue([]),
        normalize:       jest.fn(r => r),
        jira: {
            _request: jest.fn().mockResolvedValue({ issues: [], values: [], total: 0 }),
        },
    }));
});

// Also mock the JiraIntegration class used directly in sync-ranks
jest.mock('../integrations/jira', () => {
    return jest.fn().mockImplementation(() => ({
        _request: jest.fn().mockResolvedValue({ issues: [], values: [], total: 0 }),
    }));
});

const { app } = require('../server');
const db = require('../database/db');

beforeEach(() => db.__reset());

// ── Queue helpers ─────────────────────────────────────────────────────────────

const noConfig   = () => ({ data: null,  error: { message: 'Not found' } });
const configOk   = (extra = {}) => ({
    data: { type: 'jira', config: { baseUrl: 'https://test.atlassian.net', email: 'test@example.com', apiKey: 'tok', projectKey: 'TEST', ...extra } },
    error: null,
});
const noStories  = () => ({ data: [], error: null });
const stateOk    = () => ({ data: null, error: null });

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/import/initial
// ═══════════════════════════════════════════════════════════════════════════════

describe('POST /api/import/initial', () => {
    test('401 when no Authorization header', async () => {
        const res = await makeUnauthRequest(app, 'post', '/api/import/initial');
        expect(res.status).toBe(401);
    });

    test('403 when wrong instance', async () => {
        db.__q([instanceFail()]);
        const res = await makeAuthRequest(app, 'post', '/api/import/initial', null, INSTANCE_B, USER_A);
        expect(res.status).toBe(403);
    });

    test('404 when no integration configured', async () => {
        db.__q([
            instanceOk(),  // [0] resolveInstance
            noConfig(),    // [1] loadIntegrationConfig
        ]);
        const res = await makeAuthRequest(app, 'post', '/api/import/initial');
        expect(res.status).toBe(404);
    });

    test('200 with 0 stories — returns created/updated/unchanged counts', async () => {
        db.__q([
            instanceOk(),   // [0] resolveInstance
            configOk(),     // [1] loadIntegrationConfig
            noStories(),    // [2] existingRows (thenable)
            stateOk(),      // [3] saveImportState (thenable)
        ]);

        const res = await makeAuthRequest(app, 'post', '/api/import/initial');
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body).toHaveProperty('created');
        expect(res.body).toHaveProperty('updated');
        expect(res.body).toHaveProperty('unchanged');
        expect(res.body).toHaveProperty('total');
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/import/sync
// ═══════════════════════════════════════════════════════════════════════════════

describe('POST /api/import/sync', () => {
    test('401 when no Authorization header', async () => {
        const res = await makeUnauthRequest(app, 'post', '/api/import/sync');
        expect(res.status).toBe(401);
    });

    test('403 when wrong instance', async () => {
        db.__q([instanceFail()]);
        const res = await makeAuthRequest(app, 'post', '/api/import/sync', null, INSTANCE_B, USER_A);
        expect(res.status).toBe(403);
    });

    test('404 when no integration configured', async () => {
        db.__q([
            instanceOk(),
            noConfig(),
        ]);
        const res = await makeAuthRequest(app, 'post', '/api/import/sync');
        expect(res.status).toBe(404);
    });

    test('200 with 0 incremental changes — returns created/updated/removed', async () => {
        db.__q([
            instanceOk(),   // [0] resolveInstance
            configOk(),     // [1] loadIntegrationConfig
            noStories(),    // [2] existingRows (thenable)
            noStories(),    // [3] allStored for reconciliation (thenable)
            stateOk(),      // [4] saveImportState (thenable)
        ]);

        const res = await makeAuthRequest(app, 'post', '/api/import/sync');
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body).toHaveProperty('removed');
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/import/sync-ranks
// ═══════════════════════════════════════════════════════════════════════════════

describe('POST /api/import/sync-ranks', () => {
    test('401 when no Authorization header', async () => {
        const res = await makeUnauthRequest(app, 'post', '/api/import/sync-ranks');
        expect(res.status).toBe(401);
    });

    test('403 when wrong instance', async () => {
        db.__q([instanceFail()]);
        const res = await makeAuthRequest(app, 'post', '/api/import/sync-ranks', null, INSTANCE_B, USER_A);
        expect(res.status).toBe(403);
    });

    test('404 when no integration configured', async () => {
        db.__q([
            instanceOk(),
            noConfig(),
        ]);
        const res = await makeAuthRequest(app, 'post', '/api/import/sync-ranks');
        expect(res.status).toBe(404);
    });

    test('400 when no boardId in config', async () => {
        // configOk() has no boardId (undefined) → route returns 400
        db.__q([
            instanceOk(),
            configOk(),   // no boardId field
        ]);
        const res = await makeAuthRequest(app, 'post', '/api/import/sync-ranks');
        expect(res.status).toBe(400);
    });

    test('200 with boardId — returns updated/total counts', async () => {
        db.__q([
            instanceOk(),
            configOk({ boardId: 42 }),  // has boardId
            noStories(),                 // stored stories (thenable)
        ]);

        const res = await makeAuthRequest(app, 'post', '/api/import/sync-ranks');
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body).toHaveProperty('updated');
        expect(res.body).toHaveProperty('total');
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/import/status
// ═══════════════════════════════════════════════════════════════════════════════
//
// Queue:
//   [0] resolveInstance   → instances.single()
//   [1] settings.single() → instanceSelect('settings').single()

describe('GET /api/import/status', () => {
    test('401 when no Authorization header', async () => {
        const res = await makeUnauthRequest(app, 'get', '/api/import/status');
        expect(res.status).toBe(401);
    });

    test('403 when wrong instance', async () => {
        db.__q([instanceFail()]);
        const res = await makeAuthRequest(app, 'get', '/api/import/status', null, INSTANCE_B, USER_A);
        expect(res.status).toBe(403);
    });

    test('200 returns importState from settings', async () => {
        const importState = { lastSyncAt: '2026-01-10T00:00:00Z', lastSyncCount: 42, initialDone: true };
        db.__q([
            instanceOk(),
            { data: { data: { importState } }, error: null },
        ]);
        const res = await makeAuthRequest(app, 'get', '/api/import/status');
        expect(res.status).toBe(200);
        expect(res.body.initialDone).toBe(true);
        expect(res.body.lastSyncCount).toBe(42);
    });

    test('200 returns defaults when no importState in settings', async () => {
        db.__q([
            instanceOk(),
            { data: { data: {} }, error: null },
        ]);
        const res = await makeAuthRequest(app, 'get', '/api/import/status');
        expect(res.status).toBe(200);
        expect(res.body.lastSyncAt).toBeNull();
        expect(res.body.initialDone).toBe(false);
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/import/sprints/initial
// ═══════════════════════════════════════════════════════════════════════════════
//
// Queue (404 — no config):
//   [0] resolveInstance
//   [1] integrations.single() → null → 404
//
// Queue (200 — boardId present, Jira mock returns [] so rawSprints=[]):
//   [0] resolveInstance
//   [1] integrations.single() → configOk({ boardId: 42 })
//   Jira._request mocked → rawSprints=[] → syncSprintsFromJira returns { total: 0 } with no DB calls

describe('POST /api/import/sprints/initial', () => {
    test('401 when no Authorization header', async () => {
        const res = await makeUnauthRequest(app, 'post', '/api/import/sprints/initial');
        expect(res.status).toBe(401);
    });

    test('403 when wrong instance', async () => {
        db.__q([instanceFail()]);
        const res = await makeAuthRequest(app, 'post', '/api/import/sprints/initial', null, INSTANCE_B, USER_A);
        expect(res.status).toBe(403);
    });

    test('404 when no integration configured', async () => {
        db.__q([instanceOk(), noConfig()]);
        const res = await makeAuthRequest(app, 'post', '/api/import/sprints/initial');
        expect(res.status).toBe(404);
    });

    test('200 returns success:true and total count', async () => {
        db.__q([instanceOk(), configOk({ boardId: 42 })]);
        const res = await makeAuthRequest(app, 'post', '/api/import/sprints/initial');
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body).toHaveProperty('total');
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/import/sprints/sync
// ═══════════════════════════════════════════════════════════════════════════════

describe('POST /api/import/sprints/sync', () => {
    test('401 when no Authorization header', async () => {
        const res = await makeUnauthRequest(app, 'post', '/api/import/sprints/sync');
        expect(res.status).toBe(401);
    });

    test('403 when wrong instance', async () => {
        db.__q([instanceFail()]);
        const res = await makeAuthRequest(app, 'post', '/api/import/sprints/sync', null, INSTANCE_B, USER_A);
        expect(res.status).toBe(403);
    });

    test('404 when no integration configured', async () => {
        db.__q([instanceOk(), noConfig()]);
        const res = await makeAuthRequest(app, 'post', '/api/import/sprints/sync');
        expect(res.status).toBe(404);
    });

    test('200 returns success:true and total count', async () => {
        db.__q([instanceOk(), configOk({ boardId: 42 })]);
        const res = await makeAuthRequest(app, 'post', '/api/import/sprints/sync');
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body).toHaveProperty('total');
    });
});

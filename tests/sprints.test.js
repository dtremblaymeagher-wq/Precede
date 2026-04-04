/**
 * tests/sprints.test.js
 *
 * Tests for:
 *   GET  /api/sprints/current
 *   GET  /api/sprints/list
 *   GET  /api/sprint-exceptions
 *   POST /api/sprint-exceptions
 *   DELETE /api/sprint-exceptions/:id
 *   GET  /api/analyze/should-run
 */

const { makeAuthRequest, makeUnauthRequest, USER_A, INSTANCE_A, INSTANCE_B, instanceOk, instanceFail } = require('./setup');

jest.mock('@clerk/express');
jest.mock('../database/db');
jest.mock('../routes/exec-routes');
jest.mock('../routes/roadmap-routes');

const { app } = require('../server');
const db = require('../database/db');

beforeEach(() => db.__reset());

// ── GET /api/sprints/current ──────────────────────────────────────────────────

describe('GET /api/sprints/current', () => {
    const jiraSprint = {
        name: 'Sprint 42', jira_id: 42, start_date: '2025-01-01', end_date: '2025-01-14',
        goal: 'Ship auth', state: 'active',
    };

    test('returns jira sprint when active sprint exists', async () => {
        db.__q([instanceOk(), { data: jiraSprint, error: null }]);
        const res = await makeAuthRequest(app, 'get', '/api/sprints/current', null, INSTANCE_A);
        expect(res.status).toBe(200);
        expect(res.body.source).toBe('jira');
        expect(res.body.jira_id).toBe(42);
    });

    test('returns null when no sprint config exists', async () => {
        // getCurrentSprint: sprints → null, then getSprintConfig → no startDate
        db.__q([instanceOk(), { data: null, error: null }, { data: null, error: null }]);
        const res = await makeAuthRequest(app, 'get', '/api/sprints/current', null, INSTANCE_A);
        expect(res.status).toBe(200);
        expect(res.body).toBeNull();
    });

    test('returns calculated sprint when settings have start date', async () => {
        const settings = { data: { sprint_start_date: '2024-01-01', sprint_duration_days: '14' } };
        // [0] resolveInstance, [1] sprints → null, [2] getSprintConfig (in getCurrentSprint),
        // [3] getSprintConfig (in route), [4] sprint_exceptions → []
        db.__q([
            instanceOk(),
            { data: null, error: null },
            { data: settings, error: null },
            { data: settings, error: null },
            { data: [],     error: null },
        ]);
        const res = await makeAuthRequest(app, 'get', '/api/sprints/current', null, INSTANCE_A);
        expect(res.status).toBe(200);
        expect(res.body.source).toBe('calculated');
        expect(res.body.sprint_number).toBeGreaterThan(0);
    });

    test('no Clerk token → 401', async () => {
        const res = await makeUnauthRequest(app, 'get', '/api/sprints/current');
        expect(res.status).toBe(401);
    });

    test('missing X-Instance-Id → 400', async () => {
        const supertest = require('supertest');
        const res = await supertest(app).get('/api/sprints/current')
            .set('Authorization', `Bearer ${USER_A}`);
        expect(res.status).toBe(400);
    });

    test('wrong instance → 403', async () => {
        db.__q([instanceFail()]);
        const res = await makeAuthRequest(app, 'get', '/api/sprints/current', null, INSTANCE_B, USER_A);
        expect(res.status).toBe(403);
    });
});

// ── GET /api/sprints/list ─────────────────────────────────────────────────────

describe('GET /api/sprints/list', () => {
    test('returns jira sprints when available', async () => {
        const sprints = [
            { name: 'Sprint 1', jira_id: 1, start_date: '2024-12-01', end_date: '2024-12-14', goal: null, state: 'closed' },
            { name: 'Sprint 2', jira_id: 2, start_date: '2024-12-15', end_date: '2024-12-28', goal: null, state: 'active' },
        ];
        db.__q([instanceOk(), { data: sprints, error: null }]);
        const res = await makeAuthRequest(app, 'get', '/api/sprints/list', null, INSTANCE_A);
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
        expect(res.body[0].source).toBe('jira');
    });

    test('falls back to calculated sprints when no jira data', async () => {
        const settings = { data: { sprint_start_date: '2024-01-01', sprint_duration_days: '14' } };
        db.__q([instanceOk(), { data: [], error: null }, { data: settings, error: null }]);
        const res = await makeAuthRequest(app, 'get', '/api/sprints/list', null, INSTANCE_A);
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
    });

    test('no auth → 401', async () => {
        const res = await makeUnauthRequest(app, 'get', '/api/sprints/list');
        expect(res.status).toBe(401);
    });

    test('wrong instance → 403', async () => {
        db.__q([instanceFail()]);
        const res = await makeAuthRequest(app, 'get', '/api/sprints/list', null, INSTANCE_B, USER_A);
        expect(res.status).toBe(403);
    });
});

// ── GET /api/sprint-exceptions ────────────────────────────────────────────────

describe('GET /api/sprint-exceptions', () => {
    test('returns exceptions list', async () => {
        const exceptions = [{ id: 'exc-1', start_date: '2025-01-01', end_date: '2025-01-07', label: 'Holiday' }];
        db.__q([instanceOk(), { data: exceptions, error: null }]);
        const res = await makeAuthRequest(app, 'get', '/api/sprint-exceptions', null, INSTANCE_A);
        expect(res.status).toBe(200);
        expect(res.body[0].label).toBe('Holiday');
    });

    test('returns empty array when none exist', async () => {
        db.__q([instanceOk(), { data: null, error: null }]);
        const res = await makeAuthRequest(app, 'get', '/api/sprint-exceptions', null, INSTANCE_A);
        expect(res.status).toBe(200);
        expect(res.body).toEqual([]);
    });

    test('no auth → 401', async () => {
        const res = await makeUnauthRequest(app, 'get', '/api/sprint-exceptions');
        expect(res.status).toBe(401);
    });

    test('wrong instance → 403', async () => {
        db.__q([instanceFail()]);
        const res = await makeAuthRequest(app, 'get', '/api/sprint-exceptions', null, INSTANCE_B, USER_A);
        expect(res.status).toBe(403);
    });
});

// ── POST /api/sprint-exceptions ───────────────────────────────────────────────

describe('POST /api/sprint-exceptions', () => {
    test('creates exception with required fields', async () => {
        const created = { id: 'exc-new', start_date: '2025-02-01', end_date: '2025-02-07', label: 'Freeze' };
        db.__q([instanceOk(), { data: created, error: null }]);
        const res = await makeAuthRequest(app, 'post', '/api/sprint-exceptions',
            { start_date: '2025-02-01', end_date: '2025-02-07', label: 'Freeze' }, INSTANCE_A);
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.exception.id).toBe('exc-new');
    });

    test('missing start_date → 400', async () => {
        db.__q([instanceOk()]);
        const res = await makeAuthRequest(app, 'post', '/api/sprint-exceptions',
            { end_date: '2025-02-07' }, INSTANCE_A);
        expect(res.status).toBe(400);
    });

    test('missing end_date → 400', async () => {
        db.__q([instanceOk()]);
        const res = await makeAuthRequest(app, 'post', '/api/sprint-exceptions',
            { start_date: '2025-02-01' }, INSTANCE_A);
        expect(res.status).toBe(400);
    });

    test('no auth → 401', async () => {
        const res = await makeUnauthRequest(app, 'post', '/api/sprint-exceptions',
            { start_date: '2025-02-01', end_date: '2025-02-07' });
        expect(res.status).toBe(401);
    });

    test('wrong instance → 403', async () => {
        db.__q([instanceFail()]);
        const res = await makeAuthRequest(app, 'post', '/api/sprint-exceptions',
            { start_date: '2025-02-01', end_date: '2025-02-07' }, INSTANCE_B, USER_A);
        expect(res.status).toBe(403);
    });
});

// ── DELETE /api/sprint-exceptions/:id ────────────────────────────────────────

describe('DELETE /api/sprint-exceptions/:id', () => {
    test('deletes exception', async () => {
        db.__q([instanceOk(), { error: null }]);
        const res = await makeAuthRequest(app, 'delete', '/api/sprint-exceptions/exc-1', null, INSTANCE_A);
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    test('no auth → 401', async () => {
        const res = await makeUnauthRequest(app, 'delete', '/api/sprint-exceptions/exc-1');
        expect(res.status).toBe(401);
    });

    test('wrong instance → 403', async () => {
        db.__q([instanceFail()]);
        const res = await makeAuthRequest(app, 'delete', '/api/sprint-exceptions/exc-1', null, INSTANCE_B, USER_A);
        expect(res.status).toBe(403);
    });
});

// ── GET /api/analyze/should-run ───────────────────────────────────────────────

describe('GET /api/analyze/should-run', () => {
    test('returns should_run: false when no sprint config', async () => {
        // getCurrentSprint: sprints → null, getSprintConfig → no startDate
        db.__q([instanceOk(), { data: null, error: null }, { data: null, error: null }]);
        const res = await makeAuthRequest(app, 'get', '/api/analyze/should-run', null, INSTANCE_A);
        expect(res.status).toBe(200);
        expect(res.body.should_run).toBe(false);
        expect(res.body.reason).toBe('no_sprint_config');
    });

    test('returns should_run: false when not sprint day 1', async () => {
        const jiraSprint = { name: 'Sprint 5', jira_id: 5, start_date: '2025-01-01', end_date: '2025-01-14', state: 'active' };
        // days_elapsed will be computed from dates — sprint has been running for a while
        // Force days_elapsed !== 1 by setting start_date far in the past
        const pastSprint = { ...jiraSprint, start_date: '2024-01-01', end_date: '2024-01-14' };
        db.__q([instanceOk(), { data: pastSprint, error: null }]);
        const res = await makeAuthRequest(app, 'get', '/api/analyze/should-run', null, INSTANCE_A);
        expect(res.status).toBe(200);
        expect(res.body.should_run).toBe(false);
        expect(res.body.reason).toBe('not_sprint_start');
    });

    test('returns should_run: false when already ran this sprint', async () => {
        // Use UTC date so new Date(start_date) in the server equals UTC midnight of today.
        // This ensures now - start < 86400000 ms → days_elapsed === 1.
        const todayUtc = new Date().toISOString().slice(0, 10);
        const sprint = {
            name: 'Sprint 10', jira_id: 10,
            start_date: todayUtc,
            end_date:   new Date(new Date(todayUtc).getTime() + 13 * 86400000).toISOString().slice(0, 10),
            state: 'active',
        };
        db.__q([
            instanceOk(),
            { data: sprint, error: null },                                                     // getCurrentSprint
            { data: [{ filename: 'radar-1.json', created_at: '2025-01-01T00:00:00Z' }] },     // analysis_history
            { data: { data: { last_analyzed_sprint: 10 } }, error: null },                    // radar_memory
        ]);
        const res = await makeAuthRequest(app, 'get', '/api/analyze/should-run', null, INSTANCE_A);
        expect(res.status).toBe(200);
        expect(res.body.should_run).toBe(false);
        expect(res.body.reason).toBe('already_ran_this_sprint');
    });

    test('no auth → 401', async () => {
        const res = await makeUnauthRequest(app, 'get', '/api/analyze/should-run');
        expect(res.status).toBe(401);
    });

    test('wrong instance → 403', async () => {
        db.__q([instanceFail()]);
        const res = await makeAuthRequest(app, 'get', '/api/analyze/should-run', null, INSTANCE_B, USER_A);
        expect(res.status).toBe(403);
    });
});

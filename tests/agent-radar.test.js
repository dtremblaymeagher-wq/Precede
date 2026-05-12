'use strict';
/**
 * tests/agent-radar.test.js
 *
 * HTTP layer tests for:
 *   GET  /api/agent-radar/latest  — latest snapshot for widget
 *   POST /api/agent-radar/run     — manual trigger with staleness check
 *
 * runAgentRadar (the background function) is tested separately in cron.test.js.
 * Here we mock it and test the HTTP routing + staleness logic.
 *
 * Queue — GET /api/agent-radar/latest:
 *   [0] resolveInstance      → instances.single()
 *   [1] analysis_history     → analysis_history.maybySingle()
 *
 * Queue — POST /api/agent-radar/run (staleness check):
 *   [0] resolveInstance      → instances.single()
 *   [1] analysis_history     → analysis_history.maybySingle() (lastRun, parallel)
 *   [2] intelligence_entries → intelligence_entries.maybySingle() (latestEntry, parallel)
 *   then runAgentRadar() if not skipped
 */

jest.mock('@clerk/express');
jest.mock('../database/db');
jest.mock('../routes/exec-routes');
jest.mock('../routes/roadmap-routes');
jest.mock('../utils/sprint-end-jobs', () => ({
    runAgentRadar: jest.fn(),
    scheduleAgentRadar: jest.fn(),
}));

const { makeAuthRequest, makeUnauthRequest, USER_A, INSTANCE_A, INSTANCE_B, instanceOk, instanceFail } = require('./setup');
const { app } = require('../server');
const db = require('../database/db');
const { runAgentRadar } = require('../utils/sprint-end-jobs');

const RADAR_RESULT = {
    signals:             [{ severity: 'yellow', finding: 'Export latency', category: 'risk', so_what: 'Churn risk', evidence: 'Users reported', source_ids: [], suggested_focus: 'Fix export' }],
    radar_summary:       'Early churn signals.',
    strategic_summary:   'Focus on reliability.',
    strategic_alignment: 'Partial OKR alignment.',
    strategic_gap:       'Export path uncovered.',
    entryMap:            { 'e-1': { body: 'Users report slow exports', date: '2026-01-01', person: 'Alice', sourceType: 'interview' } },
};

beforeEach(() => {
    db.__reset();
    runAgentRadar.mockClear();
});
afterAll(() => jest.restoreAllMocks());

// ── GET /api/agent-radar/latest ───────────────────────────────────────────────

describe('GET /api/agent-radar/latest', () => {
    test('401 when no Authorization header', async () => {
        const res = await makeUnauthRequest(app, 'get', '/api/agent-radar/latest');
        expect(res.status).toBe(401);
    });

    test('403 when wrong instance', async () => {
        db.__q([instanceFail()]);
        const res = await makeAuthRequest(app, 'get', '/api/agent-radar/latest', null, INSTANCE_B, USER_A);
        expect(res.status).toBe(403);
    });

    test('returns { hasRun: false } when no snapshot exists', async () => {
        db.__qTable('instances',         [{ data: { id: INSTANCE_A }, error: null }]);
        db.__qTable('analysis_history',  [{ data: null, error: null }]);
        const res = await makeAuthRequest(app, 'get', '/api/agent-radar/latest');
        expect(res.status).toBe(200);
        expect(res.body.hasRun).toBe(false);
    });

    test('returns signals and metadata when snapshot exists', async () => {
        db.__qTable('instances',        [{ data: { id: INSTANCE_A }, error: null }]);
        db.__qTable('analysis_history', [{
            data: { data: RADAR_RESULT, created_at: '2026-01-10T12:00:00Z' },
            error: null,
        }]);
        const res = await makeAuthRequest(app, 'get', '/api/agent-radar/latest');
        expect(res.status).toBe(200);
        expect(res.body.hasRun).toBe(true);
        expect(Array.isArray(res.body.signals)).toBe(true);
        expect(res.body.signals).toHaveLength(1);
        expect(res.body).toHaveProperty('entryMap');
        expect(res.body).toHaveProperty('radar_summary');
    });
});

// ── POST /api/agent-radar/run ─────────────────────────────────────────────────

describe('POST /api/agent-radar/run', () => {
    test('401 when no Authorization header', async () => {
        const res = await makeUnauthRequest(app, 'post', '/api/agent-radar/run', {});
        expect(res.status).toBe(401);
    });

    test('403 when wrong instance', async () => {
        db.__q([instanceFail()]);
        const res = await makeAuthRequest(app, 'post', '/api/agent-radar/run', {}, INSTANCE_B, USER_A);
        expect(res.status).toBe(403);
    });

    test('returns { skipped: true } when no new entries since last run', async () => {
        const lastRunAt     = '2026-01-10T12:00:00Z';
        const latestEntryAt = '2026-01-09T08:00:00Z'; // older than last run
        db.__qTable('instances',             [{ data: { id: INSTANCE_A }, error: null }]);
        db.__qTable('analysis_history',      [{ data: { created_at: lastRunAt },    error: null }]);
        db.__qTable('intelligence_entries',  [{ data: { created_at: latestEntryAt }, error: null }]);

        const res = await makeAuthRequest(app, 'post', '/api/agent-radar/run', {});
        expect(res.status).toBe(200);
        expect(res.body.skipped).toBe(true);
        expect(runAgentRadar).not.toHaveBeenCalled();
    });

    test('calls runAgentRadar and returns result when entries are newer than last run', async () => {
        const lastRunAt     = '2026-01-05T12:00:00Z';
        const latestEntryAt = '2026-01-10T08:00:00Z'; // newer than last run
        db.__qTable('instances',             [{ data: { id: INSTANCE_A }, error: null }]);
        db.__qTable('analysis_history',      [{ data: { created_at: lastRunAt },    error: null }]);
        db.__qTable('intelligence_entries',  [{ data: { created_at: latestEntryAt }, error: null }]);

        runAgentRadar.mockResolvedValue(RADAR_RESULT);

        const res = await makeAuthRequest(app, 'post', '/api/agent-radar/run', {});
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(Array.isArray(res.body.signals)).toBe(true);
        expect(runAgentRadar).toHaveBeenCalledTimes(1);
        expect(runAgentRadar).toHaveBeenCalledWith(
            expect.anything(), USER_A, INSTANCE_A, 'instant'
        );
    });

    test('returns { skipped: true } when no prior run (lastRunAt=null) and no entries', async () => {
        db.__qTable('instances',             [{ data: { id: INSTANCE_A }, error: null }]);
        db.__qTable('analysis_history',      [{ data: null, error: null }]); // no prior run
        db.__qTable('intelligence_entries',  [{ data: null, error: null }]); // no entries

        runAgentRadar.mockResolvedValue(null); // runAgentRadar returns null = no-op

        const res = await makeAuthRequest(app, 'post', '/api/agent-radar/run', {});
        expect(res.status).toBe(200);
        expect(res.body.skipped).toBe(true);
    });

    test('500 when runAgentRadar throws', async () => {
        db.__qTable('instances',             [{ data: { id: INSTANCE_A }, error: null }]);
        db.__qTable('analysis_history',      [{ data: { created_at: '2026-01-01T00:00:00Z' }, error: null }]);
        db.__qTable('intelligence_entries',  [{ data: { created_at: '2026-01-10T00:00:00Z' }, error: null }]);

        runAgentRadar.mockRejectedValue(new Error('Claude timeout'));

        const res = await makeAuthRequest(app, 'post', '/api/agent-radar/run', {});
        expect(res.status).toBe(500);
    });
});

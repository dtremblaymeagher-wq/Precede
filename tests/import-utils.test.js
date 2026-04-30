/**
 * tests/import-utils.test.js
 *
 * Tests for:
 *   POST /api/integration/push-story — push a single story to Jira
 *
 * Queue consumption:
 *
 * POST /api/import/backfill-sp (no config):
 * POST /api/integration/push-story (missing fileName):
 *   [0] resolveInstance → 400
 *
 * POST /api/integration/push-story (no config):
 *   [0] resolveInstance
 *   [1] integrations.single() → null → 404
 *
 * POST /api/integration/push-story (happy path):
 *   [0] resolveInstance
 *   [1] integrations.single() → config
 *   [2] backlog_stories.single() → story row
 *   integration.createTicket() → mocked
 *   [3] backlog_stories update.then()
 *   → { ticketKey, url, ... }
 */

const { makeAuthRequest, makeUnauthRequest, USER_A, INSTANCE_A, INSTANCE_B, instanceOk, instanceFail } = require('./setup');

jest.mock('@clerk/express');
jest.mock('../database/db');
jest.mock('../routes/exec-routes');
jest.mock('../routes/roadmap-routes');

// Mock Jira integration — no real HTTP calls
jest.mock('../integrations/jira', () => {
    return jest.fn().mockImplementation(() => ({
        _request: jest.fn().mockResolvedValue({ issues: [], values: [], total: 0 }),
        search: jest.fn().mockResolvedValue([]),
    }));
});

jest.mock('../integrations', () => ({
    getIntegration: jest.fn(() => ({
        createTicket: jest.fn().mockResolvedValue({ ticketKey: 'TEST-123', url: 'https://test.atlassian.net/browse/TEST-123' }),
        fetchSignals: jest.fn().mockResolvedValue([]),
    })),
}));

const { app } = require('../server');
const db = require('../database/db');

beforeEach(() => db.__reset());

const configRow = () => ({
    data: { type: 'jira', config: { baseUrl: 'https://test.atlassian.net', email: 'test@test.com', apiKey: 'tok', projectKey: 'TEST' } },
    error: null,
});
const noConfig = () => ({ data: null, error: { message: 'Not found' } });

// ── POST /api/integration/push-story ─────────────────────────────────────────
// Each test uses a unique userId so the in-memory rate limit (per-userId Map)
// does not carry over between tests within the same Jest run.

let pushTestCounter = 0;
const pushUser = () => `push-test-user-${Date.now()}-${pushTestCounter++}`;

describe('POST /api/integration/push-story', () => {
    test('missing fileName → 400', async () => {
        db.__q([instanceOk()]);
        const res = await makeAuthRequest(app, 'post', '/api/integration/push-story', {}, INSTANCE_A, pushUser());
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/fileName/i);
    });

    test('returns 404 when no integration configured', async () => {
        db.__q([instanceOk(), noConfig()]);
        const res = await makeAuthRequest(app, 'post', '/api/integration/push-story',
            { fileName: 'story-001.json' }, INSTANCE_A, pushUser());
        expect(res.status).toBe(404);
    });

    test('returns 404 when story row not found', async () => {
        db.__q([
            instanceOk(),
            configRow(),
            { data: null, error: null }, // story not found
        ]);
        const res = await makeAuthRequest(app, 'post', '/api/integration/push-story',
            { fileName: 'story-missing.json' }, INSTANCE_A, pushUser());
        expect(res.status).toBe(404);
    });

    test('pushes story to Jira and returns ticket key', async () => {
        db.__q([
            instanceOk(),
            configRow(),
            { data: { data: { title: 'Implement login', content: '<p>As a user...</p>', labels: ['auth'], rice: { score: 40 } } }, error: null },
            { data: null, error: null }, // update
        ]);
        const res = await makeAuthRequest(app, 'post', '/api/integration/push-story',
            { fileName: 'story-login.json' }, INSTANCE_A, pushUser());
        expect(res.status).toBe(200);
        expect(res.body.ticketKey).toBe('TEST-123');
    });

    test('no auth → 401', async () => {
        const res = await makeUnauthRequest(app, 'post', '/api/integration/push-story',
            { fileName: 'story-001.json' });
        expect(res.status).toBe(401);
    });

    test('wrong instance → 403', async () => {
        db.__q([instanceFail()]);
        const res = await makeAuthRequest(app, 'post', '/api/integration/push-story',
            { fileName: 'story-001.json' }, INSTANCE_B, pushUser());
        expect(res.status).toBe(403);
    });
});

/**
 * tests/integration.test.js
 *
 * Tests for /api/integration/* routes (Jira config, test, push).
 *
 * ⚠️  PREREQUISITE: server.js must export `app` and guard app.listen().
 */

const { makeAuthRequest, USER_A, INSTANCE_A, INSTANCE_B, instanceOk, instanceFail } = require('./setup');

jest.mock('@clerk/express');
jest.mock('../database/db');
jest.mock('../routes/exec-routes');
jest.mock('../routes/roadmap-routes');

const { app } = require('../server');
const db = require('../database/db');

beforeEach(() => db.__reset());

// ── GET /api/integration/config ───────────────────────────────────────────────
describe('GET /api/integration/config', () => {
    test('returns config without apiKey field', async () => {
        const storedConfig = {
            baseUrl:    'https://acme.atlassian.net',
            email:      'pm@acme.com',
            apiKey:     'secret-key-must-not-leak',
            projectKey: 'ACME',
        };
        db.__q([
            instanceOk(),
            { data: { type: 'jira', config: storedConfig, updated_at: '2025-01-01' }, error: null },
        ]);

        const res = await makeAuthRequest(app, 'get', '/api/integration/config', null, INSTANCE_A);
        expect(res.status).toBe(200);
        expect(res.body).not.toHaveProperty('apiKey');
        expect(res.body.baseUrl).toBe('https://acme.atlassian.net');
        expect(res.body.email).toBe('pm@acme.com');
    });

    test('returns null if no integration configured', async () => {
        db.__q([
            instanceOk(),
            // single() returns { data: null } when no row found
            { data: null, error: { code: 'PGRST116' } },
        ]);

        const res = await makeAuthRequest(app, 'get', '/api/integration/config', null, INSTANCE_A);
        expect(res.status).toBe(200);
        expect(res.body).toBeNull();
    });

    test('cannot read config from other instance (→ 403)', async () => {
        db.__q([instanceFail()]);
        const res = await makeAuthRequest(app, 'get', '/api/integration/config', null, INSTANCE_B, USER_A);
        expect(res.status).toBe(403);
    });
});

// ── POST /api/integration/save-config ────────────────────────────────────────
describe('POST /api/integration/save-config', () => {
    test('returns 400 if type missing', async () => {
        db.__q([instanceOk()]);
        const res = await makeAuthRequest(
            app, 'post', '/api/integration/save-config',
            { baseUrl: 'https://acme.atlassian.net', email: 'pm@acme.com', apiKey: 'key' },
            INSTANCE_A
        );
        expect(res.status).toBe(400);
    });

    test('returns 400 if baseUrl missing', async () => {
        db.__q([instanceOk()]);
        const res = await makeAuthRequest(
            app, 'post', '/api/integration/save-config',
            { type: 'jira', email: 'pm@acme.com', apiKey: 'key' },
            INSTANCE_A
        );
        expect(res.status).toBe(400);
    });

    test('returns 400 if email missing', async () => {
        db.__q([instanceOk()]);
        const res = await makeAuthRequest(
            app, 'post', '/api/integration/save-config',
            { type: 'jira', baseUrl: 'https://acme.atlassian.net', apiKey: 'key' },
            INSTANCE_A
        );
        expect(res.status).toBe(400);
    });

    test('saves config when all required fields present', async () => {
        db.__q([
            instanceOk(),
            { data: null, error: null },  // maybeSingle — check for existing apiKey in same instance
            { data: null, error: null },  // maybeSingle — check for existing apiKey in other instance
            // NOTE: if both return null, route returns 400 "API key required for first-time setup"
            // So we need a key in the request body for this test
            { data: null, error: null },  // upsert
        ]);

        const res = await makeAuthRequest(
            app, 'post', '/api/integration/save-config',
            { type: 'jira', baseUrl: 'https://acme.atlassian.net', email: 'pm@acme.com', apiKey: 'test-api-key', projectKey: 'ACME' },
            INSTANCE_A
        );
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    test('preserves existing apiKey if not provided in request', async () => {
        const existingConfig = { apiKey: 'stored-key', baseUrl: 'https://old.atlassian.net', email: 'old@acme.com' };
        db.__q([
            instanceOk(),
            { data: { config: existingConfig }, error: null }, // maybeSingle — existing config found → uses stored apiKey
            { data: null, error: null },                       // upsert
        ]);

        const res = await makeAuthRequest(
            app, 'post', '/api/integration/save-config',
            { type: 'jira', baseUrl: 'https://new.atlassian.net', email: 'new@acme.com' },
            // No apiKey in body — should use stored key
            INSTANCE_A
        );
        expect(res.status).toBe(200);
    });

    test('cannot save config to other instance (→ 403)', async () => {
        db.__q([instanceFail()]);
        const res = await makeAuthRequest(
            app, 'post', '/api/integration/save-config',
            { type: 'jira', baseUrl: 'https://x.atlassian.net', email: 'x@x.com', apiKey: 'k' },
            INSTANCE_B, USER_A
        );
        expect(res.status).toBe(403);
    });
});

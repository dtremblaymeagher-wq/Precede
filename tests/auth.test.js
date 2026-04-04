/**
 * tests/auth.test.js
 *
 * Verifies that all /api/* routes reject requests without a valid Clerk token.
 *
 * ⚠️  PREREQUISITE: server.js must export `app` and guard app.listen().
 *     Add to the bottom of server.js:
 *       if (require.main === module) app.listen(PORT, () => console.log(...));
 *       module.exports = { app };
 */

const { makeUnauthRequest, makeAuthRequest, USER_A, INSTANCE_A, instanceOk } = require('./setup');

jest.mock('@clerk/express');
jest.mock('../database/db');
jest.mock('../routes/exec-routes');
jest.mock('../routes/roadmap-routes');

const { app } = require('../server');
const db = require('../database/db');

beforeEach(() => db.__reset());

// ── Routes under test ────────────────────────────────────────────────────────
const PROTECTED_ROUTES = [
    { method: 'get',  path: '/api/settings' },
    { method: 'get',  path: '/api/intelligence-hub/entries' },
    { method: 'get',  path: '/api/backlog' },
    { method: 'get',  path: '/api/history' },
    { method: 'post', path: '/api/intelligence-hub/entry' },
    { method: 'get',  path: '/api/learning/vault' },
];

describe('Auth — 401 without Bearer token', () => {
    test.each(PROTECTED_ROUTES)('$method $path → 401', async ({ method, path }) => {
        const res = await makeUnauthRequest(app, method, path);
        expect(res.status).toBe(401);
    });
});

describe('Auth — 200/4xx with valid token (not 401)', () => {
    test('GET /api/settings with token → not 401', async () => {
        // resolveInstance + settings fetch
        db.__q([instanceOk(), { data: null, error: null }]);
        const res = await makeAuthRequest(app, 'get', '/api/settings', null, INSTANCE_A, USER_A);
        expect(res.status).not.toBe(401);
    });

    test('GET /api/backlog with token → not 401', async () => {
        db.__q([instanceOk(), { data: [], error: null }]);
        const res = await makeAuthRequest(app, 'get', '/api/backlog', null, INSTANCE_A, USER_A);
        expect(res.status).not.toBe(401);
    });
});

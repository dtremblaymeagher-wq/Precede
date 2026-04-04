/**
 * tests/intelligence-hub.test.js
 *
 * Tests for /api/intelligence-hub/* routes.
 *
 * ⚠️  PREREQUISITE: server.js must export `app` and guard app.listen().
 */

const { makeAuthRequest, USER_A, USER_B, INSTANCE_A, INSTANCE_B, instanceOk, instanceFail } = require('./setup');

jest.mock('@clerk/express');
jest.mock('../database/db');
jest.mock('../routes/exec-routes');
jest.mock('../routes/roadmap-routes');

const { app } = require('../server');
const db = require('../database/db');

beforeEach(() => db.__reset());

// ── GET /api/intelligence-hub/entries ────────────────────────────────────────
describe('GET /api/intelligence-hub/entries', () => {
    test('returns entries for correct instance', async () => {
        const entries = [
            { data: { id: '1', body: 'User feedback', person: 'Alice', date: '2025-01-01' } },
            { data: { id: '2', body: 'Bug report',    person: 'Bob',   date: '2025-01-02' } },
        ];
        db.__q([instanceOk(), { data: entries, error: null }]);

        const res = await makeAuthRequest(app, 'get', '/api/intelligence-hub/entries', null, INSTANCE_A);
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
        expect(res.body).toHaveLength(2);
        expect(res.body[0].body).toBe('User feedback');
    });

    test('returns empty array if no entries', async () => {
        db.__q([instanceOk(), { data: [], error: null }]);

        const res = await makeAuthRequest(app, 'get', '/api/intelligence-hub/entries', null, INSTANCE_A);
        expect(res.status).toBe(200);
        expect(res.body).toEqual([]);
    });

    test('does not return entries from other instance (wrong instance → 403)', async () => {
        // USER_A cannot access INSTANCE_B
        db.__q([instanceFail()]);
        const res = await makeAuthRequest(app, 'get', '/api/intelligence-hub/entries', null, INSTANCE_B, USER_A);
        expect(res.status).toBe(403);
    });
});

// ── POST /api/intelligence-hub/entry ────────────────────────────────────────
describe('POST /api/intelligence-hub/entry', () => {
    test('creates entry with correct instance_id', async () => {
        db.__q([instanceOk(), { data: null, error: null }]);

        const entry = { id: 'abc', body: 'New signal', person: 'Carol', date: '2025-03-01' };
        const res = await makeAuthRequest(app, 'post', '/api/intelligence-hub/entry', entry, INSTANCE_A);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    // NOTE: POST /api/intelligence-hub/entry does not validate an empty body —
    // it inserts whatever is sent. A TODO for a future validation improvement.
    // TODO: add 400 validation for missing required fields (body, person, date).
});

// ── DELETE /api/intelligence-hub/entry/:id ───────────────────────────────────
describe('DELETE /api/intelligence-hub/entry/:id', () => {
    test('deletes correct entry', async () => {
        db.__q([instanceOk(), { data: null, error: null }]);

        const res = await makeAuthRequest(app, 'delete', '/api/intelligence-hub/entry/abc', null, INSTANCE_A);
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    test('cannot delete entry from other instance (→ 403)', async () => {
        db.__q([instanceFail()]);
        const res = await makeAuthRequest(app, 'delete', '/api/intelligence-hub/entry/abc', null, INSTANCE_B, USER_A);
        expect(res.status).toBe(403);
    });
});

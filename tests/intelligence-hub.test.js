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

// ── GET /api/intelligence-hub/new-since-last-analysis ────────────────────────
//
// Queue (no history):
//   [0] resolveInstance
//   [1] analysis_history.order().limit() → thenable → [] → returns { count: 0, since: null }
//
// Queue (history exists):
//   [0] resolveInstance
//   [1] analysis_history.order().limit() → thenable → [{ created_at: '...' }]
//   [2] intelligence_entries count query (head: true) → thenable → { count: 3 }

describe('GET /api/intelligence-hub/new-since-last-analysis', () => {
    test('200 returns { count: 0, since: null } when no analysis history', async () => {
        db.__q([instanceOk(), { data: [], error: null }]);
        const res = await makeAuthRequest(app, 'get', '/api/intelligence-hub/new-since-last-analysis', null, INSTANCE_A);
        expect(res.status).toBe(200);
        expect(res.body.count).toBe(0);
        expect(res.body.since).toBeNull();
    });

    test('200 returns count of new entries since last analysis', async () => {
        db.__q([
            instanceOk(),
            { data: [{ created_at: '2026-01-10T12:00:00Z' }], error: null }, // analysis_history
            { count: 3, error: null },                                         // intelligence_entries count (head)
        ]);
        const res = await makeAuthRequest(app, 'get', '/api/intelligence-hub/new-since-last-analysis', null, INSTANCE_A);
        expect(res.status).toBe(200);
        expect(res.body.count).toBe(3);
        expect(res.body.since).toBe('2026-01-10');
    });

    test('403 when wrong instance', async () => {
        db.__q([instanceFail()]);
        const res = await makeAuthRequest(app, 'get', '/api/intelligence-hub/new-since-last-analysis', null, INSTANCE_B, USER_A);
        expect(res.status).toBe(403);
    });
});

// ── PUT /api/intelligence-hub/entry/:id ──────────────────────────────────────
//
// validateEntry is called without requireBody — partial updates are allowed.
// Queue: [0] resolveInstance, [1] update().filter().eq().eq() → thenable

describe('PUT /api/intelligence-hub/entry/:id', () => {
    test('400 when entry body is an array (invalid type)', async () => {
        db.__q([instanceOk()]);
        const res = await makeAuthRequest(app, 'put', '/api/intelligence-hub/entry/abc',
            [], INSTANCE_A);
        expect(res.status).toBe(400);
    });

    test('400 when date format is invalid', async () => {
        db.__q([instanceOk()]);
        const res = await makeAuthRequest(app, 'put', '/api/intelligence-hub/entry/abc',
            { date: '01/15/2026' }, INSTANCE_A); // wrong format
        expect(res.status).toBe(400);
    });

    test('200 updates entry with valid partial data', async () => {
        db.__q([instanceOk(), { data: null, error: null }]); // update (thenable)
        const res = await makeAuthRequest(app, 'put', '/api/intelligence-hub/entry/abc',
            { body: 'Updated feedback text', date: '2026-01-15' }, INSTANCE_A);
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    test('403 when wrong instance', async () => {
        db.__q([instanceFail()]);
        const res = await makeAuthRequest(app, 'put', '/api/intelligence-hub/entry/abc',
            { body: 'Updated' }, INSTANCE_B, USER_A);
        expect(res.status).toBe(403);
    });
});

// ── POST /api/intelligence-hub/chat ──────────────────────────────────────────
//
// Queue (empty entries):
//   [0] resolveInstance
//   [1] intelligence_entries.order() → thenable → [] → returns early with { answer, citations, type }
//
// Queue (with entries, Claude call):
//   [0] resolveInstance
//   [1] intelligence_entries.order() → thenable → [entry]
//   Claude via global.fetch

describe('POST /api/intelligence-hub/chat', () => {
    const savedFetch = global.fetch;
    beforeEach(() => { global.fetch = savedFetch; });
    afterAll(() => { global.fetch = savedFetch; });

    test('400 when message is missing', async () => {
        db.__q([instanceOk()]);
        const res = await makeAuthRequest(app, 'post', '/api/intelligence-hub/chat', {}, INSTANCE_A);
        expect(res.status).toBe(400);
    });

    test('200 returns early answer when no entries', async () => {
        db.__q([instanceOk(), { data: [], error: null }]);
        const res = await makeAuthRequest(app, 'post', '/api/intelligence-hub/chat',
            { message: 'What do users think about search?' }, INSTANCE_A);
        expect(res.status).toBe(200);
        expect(res.body.type).toBe('none');
        expect(Array.isArray(res.body.citations)).toBe(true);
    });

    test('200 returns Claude answer when entries exist', async () => {
        global.fetch = jest.fn().mockResolvedValue({
            json: () => Promise.resolve({
                content: [{ text: JSON.stringify({ type: 'synthesis', answer: 'Users want faster search.', citations: [{ id: 'e-1', label: 'Alice' }] }) }],
            }),
        });
        db.__q([
            instanceOk(),
            { data: [{ data: { id: 'e-1', body: 'Search is too slow', person: 'Alice', date: '2026-01-01', sourceType: 'Meeting' } }], error: null },
        ]);
        const res = await makeAuthRequest(app, 'post', '/api/intelligence-hub/chat',
            { message: 'What do users think about search?' }, INSTANCE_A);
        expect(res.status).toBe(200);
        expect(res.body.type).toBe('synthesis');
        expect(typeof res.body.answer).toBe('string');
    });

    test('403 when wrong instance', async () => {
        db.__q([instanceFail()]);
        const res = await makeAuthRequest(app, 'post', '/api/intelligence-hub/chat',
            { message: 'test' }, INSTANCE_B, USER_A);
        expect(res.status).toBe(403);
    });
});

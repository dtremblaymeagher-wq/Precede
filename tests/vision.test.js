'use strict';
/**
 * tests/vision.test.js
 *
 * Tests for GET/POST /api/vision.
 *
 * Queue:
 *   GET  [0] resolveInstance → instances.single()
 *        [1] vision          → vision.single()
 *
 *   POST [0] resolveInstance → instances.single()
 *        [1] vision upsert   → vision.then()
 */

const { makeAuthRequest, makeUnauthRequest, USER_A, INSTANCE_A, INSTANCE_B, instanceOk, instanceFail } = require('./setup');

jest.mock('@clerk/express');
jest.mock('../database/db');
jest.mock('../routes/exec-routes');
jest.mock('../routes/roadmap-routes');

const { app } = require('../server');
const db = require('../database/db');

beforeEach(() => db.__reset());

// ── GET /api/vision ───────────────────────────────────────────────────────────

describe('GET /api/vision', () => {
    test('returns vision data when set', async () => {
        db.__q([
            instanceOk(),
            { data: { data: { vision: 'Build the best PM tool', okrs: [] } }, error: null },
        ]);
        const res = await makeAuthRequest(app, 'get', '/api/vision');
        expect(res.status).toBe(200);
        expect(res.body.vision).toBe('Build the best PM tool');
    });

    test('returns empty object default when no vision row', async () => {
        db.__q([
            instanceOk(),
            { data: null, error: null },
        ]);
        const res = await makeAuthRequest(app, 'get', '/api/vision');
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ vision: '' });
    });

    test('no auth → 401', async () => {
        const res = await makeUnauthRequest(app, 'get', '/api/vision');
        expect(res.status).toBe(401);
    });

    test('wrong instance → 403', async () => {
        db.__q([instanceFail()]);
        const res = await makeAuthRequest(app, 'get', '/api/vision', null, INSTANCE_B, USER_A);
        expect(res.status).toBe(403);
    });
});

// ── POST /api/vision ──────────────────────────────────────────────────────────

describe('POST /api/vision', () => {
    test('saves vision successfully', async () => {
        db.__q([
            instanceOk(),
            { data: null, error: null }, // upsert
        ]);
        const res = await makeAuthRequest(app, 'post', '/api/vision', {
            vision: 'Ship faster, learn faster',
            okrs:   ['Reduce churn by 20%'],
        });
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    test('no auth → 401', async () => {
        const res = await makeUnauthRequest(app, 'post', '/api/vision', { vision: 'test' });
        expect(res.status).toBe(401);
    });

    test('wrong instance → 403', async () => {
        db.__q([instanceFail()]);
        const res = await makeAuthRequest(app, 'post', '/api/vision', { vision: 'test' }, INSTANCE_B, USER_A);
        expect(res.status).toBe(403);
    });
});

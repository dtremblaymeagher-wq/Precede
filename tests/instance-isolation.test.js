/**
 * tests/instance-isolation.test.js
 *
 * Core security test — verifies that instance-scoped data is properly isolated.
 * User A cannot access User B's data even with a valid token.
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

// ── Missing X-Instance-Id → 400 ──────────────────────────────────────────────
describe('Missing X-Instance-Id header', () => {
    const INSTANCE_REQUIRED_ROUTES = [
        { method: 'get',  path: '/api/settings' },
        { method: 'get',  path: '/api/intelligence-hub/entries' },
        { method: 'get',  path: '/api/backlog' },
        { method: 'get',  path: '/api/history' },
    ];

    test.each(INSTANCE_REQUIRED_ROUTES)('$method $path without X-Instance-Id → 400', async ({ method, path }) => {
        const supertest = require('supertest');
        // Send auth token but NO X-Instance-Id header
        const res = await supertest(app)
            [method](path)
            .set('Authorization', `Bearer ${USER_A}`);
        expect(res.status).toBe(400);
    });
});

// ── Wrong instance_id → 403 ──────────────────────────────────────────────────
describe('Wrong instance_id — 403', () => {
    test('User A accessing User B instance → 403 on hub entries', async () => {
        // resolveInstance: USER_A + INSTANCE_B → not found (belongs to USER_B)
        db.__q([instanceFail()]);
        const res = await makeAuthRequest(app, 'get', '/api/intelligence-hub/entries', null, INSTANCE_B, USER_A);
        expect(res.status).toBe(403);
    });

    test('User A accessing User B instance → 403 on settings', async () => {
        db.__q([instanceFail()]);
        const res = await makeAuthRequest(app, 'get', '/api/settings', null, INSTANCE_B, USER_A);
        expect(res.status).toBe(403);
    });

    test('User A accessing User B instance → 403 on backlog', async () => {
        db.__q([instanceFail()]);
        const res = await makeAuthRequest(app, 'get', '/api/backlog', null, INSTANCE_B, USER_A);
        expect(res.status).toBe(403);
    });

    test('User A accessing User B instance → 403 on radar history', async () => {
        db.__q([instanceFail()]);
        const res = await makeAuthRequest(app, 'get', '/api/history', null, INSTANCE_B, USER_A);
        expect(res.status).toBe(403);
    });
});

// ── Correct instance_id → resolves normally ──────────────────────────────────
describe('Correct instance_id — resolves', () => {
    test('User A + INSTANCE_A → resolveInstance passes', async () => {
        db.__q([instanceOk(INSTANCE_A), { data: [], error: null }]);
        const res = await makeAuthRequest(app, 'get', '/api/intelligence-hub/entries', null, INSTANCE_A, USER_A);
        // 200 or 500 (if further supabase calls fail) — but NOT 403 or 400
        expect(res.status).not.toBe(403);
        expect(res.status).not.toBe(400);
    });

    test('User B + INSTANCE_B → resolveInstance passes', async () => {
        db.__q([instanceOk(INSTANCE_B), { data: [], error: null }]);
        const res = await makeAuthRequest(app, 'get', '/api/intelligence-hub/entries', null, INSTANCE_B, USER_B);
        expect(res.status).not.toBe(403);
        expect(res.status).not.toBe(400);
    });
});

// ── Instance-free paths bypass resolveInstance ───────────────────────────────
describe('INSTANCE_FREE_PATHS bypass middleware', () => {
    test('GET /api/instances (no X-Instance-Id) → not 400', async () => {
        // No instance validation for this path — just return empty list
        db.__q([{ data: [], error: null }]);
        const supertest = require('supertest');
        const res = await supertest(app)
            .get('/api/instances')
            .set('Authorization', `Bearer ${USER_A}`);
        expect(res.status).not.toBe(400);
    });

    test('GET /api/onboarding (no X-Instance-Id) → not 400', async () => {
        db.__q([{ data: { completed: false, current_step: 1 }, error: null }]);
        const supertest = require('supertest');
        const res = await supertest(app)
            .get('/api/onboarding')
            .set('Authorization', `Bearer ${USER_A}`);
        expect(res.status).not.toBe(400);
    });
});

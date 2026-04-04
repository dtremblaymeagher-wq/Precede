/**
 * tests/setup.js
 *
 * Shared constants and request helpers for all test files.
 *
 * MOCKS ARE NOT HERE — jest.mock() must be declared in each test file
 * because Jest hoists mock calls before any imports/requires.
 *
 * HOW THE CLERK MOCK WORKS (must be replicated in each test file):
 *   - requireAuth() checks for "Authorization: Bearer <anything>" header
 *   - getAuth(req) extracts the userId directly from the Bearer value
 *   → makeAuthRequest passes `Bearer ${userId}` so the test controls identity
 *   → makeUnauthRequest passes no header → 401
 */

const USER_A = 'test-user-a';
const USER_B = 'test-user-b';
const INSTANCE_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const INSTANCE_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

/**
 * Authenticated request.
 * Sets Authorization: Bearer <userId> and X-Instance-Id header.
 *
 * @param {import('express').Application} app
 * @param {'get'|'post'|'put'|'delete'} method
 * @param {string} path
 * @param {object|null} body
 * @param {string} instanceId  - defaults to INSTANCE_A
 * @param {string} userId      - defaults to USER_A
 */
function makeAuthRequest(app, method, path, body = null, instanceId = INSTANCE_A, userId = USER_A) {
    const supertest = require('supertest');
    const req = supertest(app)
        [method.toLowerCase()](path)
        .set('Authorization', `Bearer ${userId}`)
        .set('X-Instance-Id', instanceId)
        .set('Content-Type', 'application/json');
    if (body !== null) req.send(body);
    return req;
}

/**
 * Unauthenticated request — no Authorization header.
 */
function makeUnauthRequest(app, method, path, body = null) {
    const supertest = require('supertest');
    const req = supertest(app)
        [method.toLowerCase()](path)
        .set('Content-Type', 'application/json');
    if (body !== null) req.send(body);
    return req;
}

/**
 * Standard Supabase mock factory.
 * Paste this jest.mock block at the top of every test file that needs DB access.
 *
 * Usage in test:
 *   const db = require('../database/db');
 *   db.__q([
 *     { data: { id: INSTANCE_A }, error: null },   // resolveInstance call
 *     { data: { data: { personas: [] } }, error: null }, // actual query
 *   ]);
 *
 * NOTE: resolveInstance always makes the FIRST supabase call in any protected route.
 * Always include it as queue[0] unless testing a path that bypasses it (INSTANCE_FREE_PATHS).
 */
const SUPABASE_MOCK_FACTORY = `
jest.mock('../database/db', () => {
    const state = { queue: [], idx: 0 };
    const next  = () => Promise.resolve(state.queue[state.idx++] ?? { data: null, error: null });
    const c = {
        select: () => c, insert: () => c, update: () => c, upsert: () => c, delete: () => c,
        eq: () => c, neq: () => c, like: () => c, gt: () => c,
        filter: () => c, order: () => c, limit: () => c,
        single:     () => next(),
        maybeSingle:() => next(),
        then:       (res, rej) => next().then(res, rej),
    };
    return {
        from:    () => c,
        __q:     (responses) => { state.queue = responses; state.idx = 0; },
        __reset: () => { state.queue = []; state.idx = 0; },
    };
});
`;

/** Convenience: instance validation success response (queue slot 0 for most routes) */
const instanceOk   = (instanceId = INSTANCE_A) => ({ data: { id: instanceId }, error: null });
const instanceFail = ()                          => ({ data: null, error: { message: 'Not found' } });

module.exports = {
    USER_A, USER_B, INSTANCE_A, INSTANCE_B,
    makeAuthRequest, makeUnauthRequest,
    SUPABASE_MOCK_FACTORY,
    instanceOk, instanceFail,
};

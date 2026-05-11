/**
 * tests/generate.test.js
 *
 * Tests for POST /api/generate
 *
 * /api/generate is an INSTANCE_FREE_PATH — resolveInstance is skipped.
 * No DB calls. Claude API is called and the raw response is forwarded.
 *
 * Response shape: { content: [{ text: string }] }
 * (Preserved for story-grooming.js compatibility)
 */

const { makeAuthRequest, makeUnauthRequest, USER_A, INSTANCE_A } = require('./setup');

jest.mock('@clerk/express');
jest.mock('../database/db');
jest.mock('../routes/exec-routes');
jest.mock('../routes/roadmap-routes');

const { app } = require('../server');
const db = require('../database/db');

const savedFetch = global.fetch;
beforeEach(() => {
    db.__reset();
    global.fetch = jest.fn(); // fresh mock each test — prevents silent reuse of a previous Claude mock
});
afterAll(() => { global.fetch = savedFetch; });

function mockClaude(text = 'Generated text response.') {
    global.fetch = jest.fn().mockResolvedValue({
        json: () => Promise.resolve({ content: [{ text }] }),
    });
}

// ── POST /api/generate ────────────────────────────────────────────────────────

describe('POST /api/generate', () => {
    test('returns { content: [{ text }] } for valid request', async () => {
        mockClaude('A well-structured user story.');
        const res = await makeAuthRequest(app, 'post', '/api/generate', {
            system: 'You are a PM assistant.',
            messages: [{ role: 'user', content: 'Write a user story for search.' }],
        }, INSTANCE_A);
        expect(res.status).toBe(200);
        expect(res.body.content).toBeDefined();
        expect(res.body.content[0].text).toBe('A well-structured user story.');
    });

    test('works without X-Instance-Id (INSTANCE_FREE_PATH)', async () => {
        mockClaude('Response without instance.');
        const supertest = require('supertest');
        const res = await supertest(app)
            .post('/api/generate')
            .set('Authorization', `Bearer ${USER_A}`)
            .set('Content-Type', 'application/json')
            .send({ messages: [{ role: 'user', content: 'hello' }] });
        expect(res.status).toBe(200);
        expect(res.body.content[0].text).toBe('Response without instance.');
    });

    test('no auth → 401', async () => {
        const res = await makeUnauthRequest(app, 'post', '/api/generate',
            { messages: [{ role: 'user', content: 'hi' }] });
        expect(res.status).toBe(401);
    });
});

// ── Fault tolerance ───────────────────────────────────────────────────────────

describe('POST /api/generate — fault tolerance', () => {
    test('500 when Claude API throws a network error', async () => {
        global.fetch = jest.fn().mockRejectedValue(new Error('network error'));
        const res = await makeAuthRequest(app, 'post', '/api/generate', {
            messages: [{ role: 'user', content: 'Write a user story.' }],
        }, INSTANCE_A);
        expect(res.status).toBe(500);
    });
});

/**
 * tests/brainstorm.test.js
 *
 * Tests for POST /api/brainstorm
 *
 * Queue consumption for happy path:
 *   [0] resolveInstance     → instances.single()
 *   [1] settingsRow         → settings.single()   (non-fatal try/catch)
 *   [2] visionRow           → vision.maybeSingle() (non-fatal try/catch)
 *   [3] radarRows           → analysis_history.single() (non-fatal try/catch)
 *   Claude API mock         → global.fetch
 *
 * Response: { response: string }
 */

const { makeAuthRequest, makeUnauthRequest, USER_A, INSTANCE_A, INSTANCE_B, instanceOk, instanceFail } = require('./setup');

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

function mockClaudeText(text = 'Here are some brainstorming ideas.') {
    global.fetch = jest.fn().mockResolvedValue({
        json: () => Promise.resolve({ content: [{ text }] }),
    });
}

// ── POST /api/brainstorm ──────────────────────────────────────────────────────

describe('POST /api/brainstorm', () => {
    test('returns AI response for valid message', async () => {
        mockClaudeText('Here are 3 solutions for your problem.');
        db.__q([instanceOk()]);
        const res = await makeAuthRequest(app, 'post', '/api/brainstorm',
            { message: 'How should I handle user churn?' }, INSTANCE_A);
        expect(res.status).toBe(200);
        expect(res.body.response).toBe('Here are 3 solutions for your problem.');
    });

    test('missing message → 400', async () => {
        db.__q([instanceOk()]);
        const res = await makeAuthRequest(app, 'post', '/api/brainstorm', {}, INSTANCE_A);
        expect(res.status).toBe(400);
    });

    test('no auth → 401', async () => {
        const res = await makeUnauthRequest(app, 'post', '/api/brainstorm', { message: 'hello' });
        expect(res.status).toBe(401);
    });

    test('missing X-Instance-Id → 400', async () => {
        const supertest = require('supertest');
        const res = await supertest(app).post('/api/brainstorm')
            .set('Authorization', `Bearer ${USER_A}`)
            .set('Content-Type', 'application/json')
            .send({ message: 'hello' });
        expect(res.status).toBe(400);
    });

    test('wrong instance → 403', async () => {
        db.__q([instanceFail()]);
        const res = await makeAuthRequest(app, 'post', '/api/brainstorm',
            { message: 'hello' }, INSTANCE_B, USER_A);
        expect(res.status).toBe(403);
    });

    test('passes conversation history to Claude', async () => {
        mockClaudeText('Continuing the conversation...');
        db.__q([instanceOk()]);
        const res = await makeAuthRequest(app, 'post', '/api/brainstorm', {
            message: 'follow up question',
            context: {
                conversationHistory: [
                    { role: 'user', content: 'first message' },
                    { role: 'assistant', content: 'first response' },
                ],
            },
        }, INSTANCE_A);
        expect(res.status).toBe(200);
        expect(res.body.response).toBeTruthy();
    });
});

// ── Fault tolerance ───────────────────────────────────────────────────────────

describe('POST /api/brainstorm — fault tolerance', () => {
    // Context loading (settings, vision, radar) is non-fatal — DB errors there are swallowed.
    // Only a Claude API failure propagates to the outer catch.

    test('500 when Claude API throws a network error', async () => {
        global.fetch = jest.fn().mockRejectedValue(new Error('network error'));
        db.__q([instanceOk()]);
        const res = await makeAuthRequest(app, 'post', '/api/brainstorm',
            { message: 'How should I handle user churn?' }, INSTANCE_A);
        expect(res.status).toBe(500);
    });
});

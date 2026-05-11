'use strict';
/**
 * tests/async-claude.test.js
 *
 * Tests for the fire-and-forget pattern in POST /api/learning/feedback.
 *
 * The route returns { success: true } immediately, then a background IIFE
 * calls Claude and inserts the result into learning_vault:
 *
 *   res.json({ success: true });          ← returned before IIFE starts
 *   (async () => {
 *     const recommendation = await callAI({ callType: 'feedback_rule', ... });
 *     await supabase.from('learning_vault').insert({ ... });
 *   })().catch(e => console.error(...));
 *
 * Queue consumption:
 *   [0] resolveInstance   → instances.single()
 *   [1] background insert → learning_vault.insert().then()  (after callAI resolves)
 *
 * Background tasks are drained with setImmediate, which flushes the
 * microtask queue after the HTTP response is sent.
 */

jest.mock('@clerk/express');
jest.mock('../database/db');
jest.mock('../routes/exec-routes');
jest.mock('../routes/roadmap-routes');
jest.mock('../shared/ai-client', () => ({
    ...jest.requireActual('../shared/ai-client'),
    callAI: jest.fn(),
}));

const { makeAuthRequest, makeUnauthRequest, USER_A, INSTANCE_A, INSTANCE_B, instanceOk, instanceFail } = require('./setup');
const { app } = require('../server');
const db = require('../database/db');
const { callAI } = require('../shared/ai-client');

// ── Lifecycle ─────────────────────────────────────────────────────────────────

beforeEach(() => {
    db.__reset();
    callAI.mockClear();
});

afterAll(() => {
    jest.restoreAllMocks();
});

// ── Auth / validation ─────────────────────────────────────────────────────────

describe('POST /api/learning/feedback — auth and validation', () => {
    test('401 when no Authorization header', async () => {
        const res = await makeUnauthRequest(app, 'post', '/api/learning/feedback',
            { comment: 'Focus more on churn signals' });
        expect(res.status).toBe(401);
    });

    test('403 when wrong instance', async () => {
        db.__q([instanceFail()]);
        const res = await makeAuthRequest(app, 'post', '/api/learning/feedback',
            { comment: 'Focus on churn' }, INSTANCE_B, USER_A);
        expect(res.status).toBe(403);
    });

    test('400 when comment is missing', async () => {
        db.__q([instanceOk()]);
        const res = await makeAuthRequest(app, 'post', '/api/learning/feedback', {});
        expect(res.status).toBe(400);
    });

    test('400 when comment is blank whitespace', async () => {
        db.__q([instanceOk()]);
        const res = await makeAuthRequest(app, 'post', '/api/learning/feedback',
            { comment: '   ' });
        expect(res.status).toBe(400);
    });
});

// ── Fire-and-forget: main flow not blocked ────────────────────────────────────
// The HTTP response must arrive before Claude responds.
// callAI is set to a never-resolving promise to simulate a slow Claude call.

describe('POST /api/learning/feedback — main flow not blocked', () => {
    test('returns 200 immediately even when callAI never resolves', async () => {
        // callAI hangs indefinitely — the route must not wait for it
        callAI.mockReturnValue(new Promise(() => {}));
        db.__q([instanceOk()]);  // only resolveInstance — insert never reached

        const res = await makeAuthRequest(app, 'post', '/api/learning/feedback',
            { comment: 'Focus more on churn signals' });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        // callAI was launched but the response did not wait for it
        expect(callAI).toHaveBeenCalledTimes(1);
    });
});

// ── Fire-and-forget: background success ──────────────────────────────────────
// When callAI resolves, the result is saved to learning_vault.

describe('POST /api/learning/feedback — background success', () => {
    test('callAI is invoked with callType feedback_rule and deliveryMode batch', async () => {
        callAI.mockResolvedValue('Always prioritise user-reported bugs over feature requests.');
        db.__q([
            instanceOk(),                    // [0] resolveInstance
            { data: null, error: null },     // [1] background learning_vault.insert
        ]);

        await makeAuthRequest(app, 'post', '/api/learning/feedback',
            { comment: 'Focus more on churn signals' });

        // Drain background microtasks: callAI resolves, then insert fires
        await new Promise(resolve => setImmediate(resolve));

        expect(callAI).toHaveBeenCalledWith(expect.objectContaining({
            callType:     'feedback_rule',
            deliveryMode: 'batch',
        }));
    });

    test('learning_vault.insert is called after callAI resolves', async () => {
        callAI.mockResolvedValue('Highlight sprint risks more prominently.');
        db.__q([
            instanceOk(),                    // [0] resolveInstance
            { data: null, error: null },     // [1] background learning_vault.insert
        ]);

        const fromSpy = jest.spyOn(db, 'from');

        await makeAuthRequest(app, 'post', '/api/learning/feedback',
            { comment: 'Highlight risks' });

        // Drain background microtasks
        await new Promise(resolve => setImmediate(resolve));

        // 'instances' (resolveInstance) + 'learning_vault' (background insert)
        expect(fromSpy).toHaveBeenCalledWith('learning_vault');

        fromSpy.mockRestore();
    });
});

// ── Fire-and-forget: background failure is silent ────────────────────────────
// When callAI rejects, the error is caught and logged — no crash, no 500.
// The route has already returned 200 before the failure occurs.

describe('POST /api/learning/feedback — background failure is silent', () => {
    test('Claude error does not crash the server — route already returned 200', async () => {
        callAI.mockRejectedValue(new Error('Claude API timeout'));
        // No insert slot — callAI throws before reaching it
        db.__q([instanceOk()]);

        const res = await makeAuthRequest(app, 'post', '/api/learning/feedback',
            { comment: 'More emphasis on user pain points' });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);

        // Drain background microtasks — the .catch() handler fires, no uncaught rejection
        await new Promise(resolve => setImmediate(resolve));

        expect(callAI).toHaveBeenCalledTimes(1);
    });

    test('route responds independently of callAI outcome', async () => {
        // First call: callAI throws → 200 anyway
        callAI.mockRejectedValueOnce(new Error('network error'));
        db.__q([instanceOk()]);
        const res1 = await makeAuthRequest(app, 'post', '/api/learning/feedback',
            { comment: 'Flag capacity risks' });
        await new Promise(resolve => setImmediate(resolve));
        expect(res1.status).toBe(200);

        // Second call: callAI resolves → 200 as well
        db.__reset();
        callAI.mockResolvedValue('Flag capacity risks earlier in sprint planning.');
        db.__q([
            instanceOk(),
            { data: null, error: null },
        ]);
        const res2 = await makeAuthRequest(app, 'post', '/api/learning/feedback',
            { comment: 'Flag capacity risks' });
        await new Promise(resolve => setImmediate(resolve));
        expect(res2.status).toBe(200);

        expect(callAI).toHaveBeenCalledTimes(2);
    });
});

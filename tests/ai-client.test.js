'use strict';
/**
 * tests/ai-client.test.js
 *
 * Unit tests for shared/ai-client.js (callAI).
 * Does NOT start the Express server — calls callAI directly.
 *
 * Timeout behaviour:
 *   callAI wraps each fetch attempt with an AbortController.
 *   The timeout duration is read from process.env.CALL_AI_TIMEOUT_MS
 *   (default 30 000 ms). Tests set it to a small value so the timeout
 *   fires quickly without fake-timer machinery.
 *
 *   When the AbortController fires, it dispatches 'abort' on the signal.
 *   The fetch mock listens on opts.signal and rejects with an AbortError,
 *   which then propagates out of callAI as an unhandled throw.
 */

jest.mock('../database/db'); // prevent real DB calls from usage-logging code

const { callAI, MODELS } = require('../shared/ai-client');

const savedFetch = global.fetch;
const savedTimeout = process.env.CALL_AI_TIMEOUT_MS;

beforeEach(() => {
    global.fetch = savedFetch;
    process.env.ANTHROPIC_API_KEY = 'test-key';
});

afterAll(() => {
    global.fetch = savedFetch;
    if (savedTimeout === undefined) delete process.env.CALL_AI_TIMEOUT_MS;
    else process.env.CALL_AI_TIMEOUT_MS = savedTimeout;
});

// ─── Timeout ──────────────────────────────────────────────────────────────────

describe('callAI — timeout', () => {
    test('throws when fetch hangs past CALL_AI_TIMEOUT_MS', async () => {
        // Use a very short timeout so the test completes in ~50 ms
        process.env.CALL_AI_TIMEOUT_MS = '50';

        // Mock fetch: respect the AbortController signal and reject when it fires
        global.fetch = jest.fn().mockImplementation((url, opts) =>
            new Promise((_, reject) => {
                opts.signal.addEventListener('abort', () => {
                    const err = new Error('The operation was aborted');
                    err.name = 'AbortError';
                    reject(err);
                });
                // Never resolves on its own — simulates a hanging Anthropic call
            })
        );

        await expect(
            callAI({ model: MODELS.haiku, messages: [{ role: 'user', content: 'hello' }] })
        ).rejects.toThrow();
    }, 10_000); // generous Jest timeout — real wait is only ~50 ms

    test('succeeds when fetch responds before timeout', async () => {
        process.env.CALL_AI_TIMEOUT_MS = '5000';

        global.fetch = jest.fn().mockResolvedValue({
            json: () => Promise.resolve({ content: [{ text: 'hi' }] }),
        });

        const result = await callAI({
            model:    MODELS.haiku,
            messages: [{ role: 'user', content: 'hello' }],
        });
        expect(result).toBe('hi');
    });
});

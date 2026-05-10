'use strict';
/**
 * tests/signal-compressor.test.js
 *
 * Unit tests for utils/signal-compressor.js (compressOldSignals).
 * Calls the function directly — no HTTP server needed.
 *
 * Queue per table for a happy-path call with 1 month of signals:
 *   intelligence_entries:
 *     [0] select (then)      → 2 old rows
 *     [1] update archived_at (then) → ok
 *   signal_summaries:
 *     [0] maybeSingle        → null (no existing summary)
 *     [1] insert (then)      → ok
 */

jest.mock('../database/db');
jest.mock('../shared/ai-client', () => ({
    ...jest.requireActual('../shared/ai-client'),
    callAI: jest.fn(),
}));

const db       = require('../database/db');
const { callAI } = require('../shared/ai-client');
const { compressOldSignals } = require('../utils/signal-compressor');

const USER     = 'user-test';
const INSTANCE = 'inst-test';

function makeRow(id, date, body = 'signal body') {
    return {
        id,
        data:       { body, date, person: 'Alice', sourceType: 'interview' },
        created_at: `${date}T10:00:00Z`,
    };
}

beforeEach(() => {
    db.__reset();
    callAI.mockClear();
    callAI.mockResolvedValue('Summary: users want dark mode and better onboarding.');
});

afterAll(() => {
    jest.restoreAllMocks();
});

// ── No old signals ─────────────────────────────────────────────────────────────

describe('compressOldSignals — no archivable signals', () => {
    test('returns { created: 0, archived: 0 } when no old entries exist', async () => {
        db.__qTable('intelligence_entries', [{ data: [], error: null }]);

        const result = await compressOldSignals(db, USER, INSTANCE);

        expect(result).toEqual({ created: 0, archived: 0 });
        expect(callAI).not.toHaveBeenCalled();
    });
});

// ── Happy path ─────────────────────────────────────────────────────────────────

describe('compressOldSignals — happy path', () => {
    test('one month of 2 signals → summary created, both entries archived', async () => {
        const rows = [makeRow('e1', '2024-01-15'), makeRow('e2', '2024-01-22')];

        db.__qTable('intelligence_entries', [
            { data: rows, error: null },   // initial select
            { data: null, error: null },   // update archived_at
        ]);
        db.__qTable('signal_summaries', [
            { data: null, error: null },   // maybeSingle → no existing summary
            { data: null, error: null },   // insert
        ]);

        const result = await compressOldSignals(db, USER, INSTANCE);

        expect(result.created).toBe(1);
        expect(result.archived).toBe(2);
        expect(callAI).toHaveBeenCalledTimes(1);
        expect(callAI).toHaveBeenCalledWith(expect.objectContaining({
            callType: 'signal_compression',
        }));
    });

    test('two months of signals → two summaries created', async () => {
        const rows = [
            makeRow('e1', '2024-01-10'),
            makeRow('e2', '2024-02-12'),
        ];

        db.__qTable('intelligence_entries', [
            { data: rows, error: null },   // initial select
            { data: null, error: null },   // archive Jan
            { data: null, error: null },   // archive Feb
        ]);
        db.__qTable('signal_summaries', [
            { data: null, error: null },   // maybeSingle Jan → no existing
            { data: null, error: null },   // insert Jan
            { data: null, error: null },   // maybeSingle Feb → no existing
            { data: null, error: null },   // insert Feb
        ]);

        const result = await compressOldSignals(db, USER, INSTANCE);

        expect(result.created).toBe(2);
        expect(result.archived).toBe(2);
        expect(callAI).toHaveBeenCalledTimes(2);
    });
});

// ── Already summarized ─────────────────────────────────────────────────────────

describe('compressOldSignals — idempotency', () => {
    test('existing summary → entries archived without calling AI', async () => {
        const rows = [makeRow('e1', '2024-01-10')];

        db.__qTable('intelligence_entries', [
            { data: rows, error: null },            // initial select
            { data: null, error: null },            // update archived_at
        ]);
        db.__qTable('signal_summaries', [
            { data: { id: 'existing-uuid' }, error: null }, // maybeSingle → already exists
        ]);

        const result = await compressOldSignals(db, USER, INSTANCE);

        expect(result.created).toBe(0);
        expect(result.archived).toBe(1);
        expect(callAI).not.toHaveBeenCalled();
    });

    test('one month existing, one new → only new summary created', async () => {
        const rows = [
            makeRow('e1', '2024-01-10'),
            makeRow('e2', '2024-02-10'),
        ];

        db.__qTable('intelligence_entries', [
            { data: rows, error: null },
            { data: null, error: null },   // archive Jan
            { data: null, error: null },   // archive Feb
        ]);
        db.__qTable('signal_summaries', [
            { data: { id: 'existing' }, error: null }, // Jan → already exists
            { data: null, error: null },               // Feb maybeSingle → new
            { data: null, error: null },               // Feb insert
        ]);

        const result = await compressOldSignals(db, USER, INSTANCE);

        expect(result.created).toBe(1);
        expect(result.archived).toBe(2);
        expect(callAI).toHaveBeenCalledTimes(1);
    });
});

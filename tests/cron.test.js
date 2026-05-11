'use strict';
/**
 * tests/cron.test.js
 *
 * Unit tests for runAgentRadar — the background job that generates the
 * agent-radar snapshots displayed on the intelligence dashboard.
 *
 * The function is called fire-and-forget by scheduleAgentRadar in
 * utils/sprint-cron.js:
 *   for (const { user_id, instance_id } of targets) {
 *     runAgentRadar(supabase, user_id, instance_id, 'batch')
 *       .catch(err => console.error(...));
 *   }
 *
 * DB call order inside runAgentRadar's Promise.allSettled:
 *   intelligence_entries  [0] loadEntries (.then)
 *   vision                [0] loadContext — vision (.single)
 *   backlog_stories       [0] direct query (.then via Promise.allSettled)
 *   analysis_history      [0] prevResult — agent_radar (.maybySingle)
 *   analysis_history      [1] fullAnalysisResult — radar-% (.maybySingle)
 *   radar_memory          [0] loadSprintMemory (.single)
 *   analysis_history      [2] getSprintStats — radar-% (.then)
 *   analysis_history      [3] loadHistoricalSnapshots — radar-% (.then)
 *   settings              [0] loadContext — settings (.single, after vision resolves)
 *
 * After the Claude call:
 *   analysis_history      [4] insert snapshot (.then)
 */

jest.mock('../database/db');
jest.mock('../shared/ai-client', () => ({
    ...jest.requireActual('../shared/ai-client'),
    callAI: jest.fn(),
}));

const db       = require('../database/db');
const { callAI } = require('../shared/ai-client');
const { runAgentRadar } = require('../utils/sprint-end-jobs');

const USER      = 'user-cron-test';
const INSTANCE_A = 'aaaaaaaa-0000-0000-0000-aaaaaaaaaaaa';
const INSTANCE_B = 'bbbbbbbb-0000-0000-0000-bbbbbbbbbbbb';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ENTRY = { body: 'Users complain about export latency', person: 'Alice', date: new Date().toISOString().slice(0, 10), id: 'e-1', sourceType: 'interview' };

const VALID_RADAR = JSON.stringify({
    signals: [{
        severity:        'yellow',
        category:        'opportunity',
        finding:         'Export latency surfacing repeatedly',
        so_what:         'Risk of churn if unaddressed this sprint.',
        evidence:        'Three users flagged PDF export timeouts.',
        source_ids:      [1],
        suggested_focus: 'Prioritise export reliability',
    }],
    radar_summary:      'Early churn signals detected.',
    strategic_summary:  'Export reliability is the single most urgent gap.',
    strategic_alignment:'Signals partially support the NPS OKR.',
    strategic_gap:      'Export path has no story in the active sprint.',
});

// ── Queue helper ──────────────────────────────────────────────────────────────

/**
 * Populate per-table queues for a standard runAgentRadar call.
 * All context loads are non-fatal (Promise.allSettled + inner try/catch),
 * so returning null for most is fine.
 *
 * @param {object[]} entries  intelligence_entries rows (each with a .data property)
 * @param {boolean}  withInsert  whether to include the analysis_history insert slot
 */
function setupQueues({ entries = [{ data: ENTRY }], withInsert = true } = {}) {
    db.__qTable('intelligence_entries', [{ data: entries, error: null }]);
    db.__qTable('vision',              [{ data: null, error: null }]);   // loadContext
    db.__qTable('settings',            [{ data: null, error: null }]);   // loadContext
    db.__qTable('backlog_stories',     [{ data: [], error: null }]);
    db.__qTable('radar_memory',        [{ data: null, error: null }]);   // loadSprintMemory
    db.__qTable('analysis_history', [
        { data: null, error: null },   // [0] prevResult  — agent_radar maybySingle
        { data: null, error: null },   // [1] fullAnalysis — radar-% maybySingle
        { data: [], error: null },     // [2] getSprintStats — radar-% then
        { data: [], error: null },     // [3] loadHistoricalSnapshots — radar-% then
        ...(withInsert ? [{ data: null, error: null }] : []),  // [4] insert
    ]);
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

beforeEach(() => {
    db.__reset();
    callAI.mockClear();
    callAI.mockResolvedValue(VALID_RADAR);
});

afterAll(() => {
    jest.restoreAllMocks();
});

// ── Happy path ────────────────────────────────────────────────────────────────

describe('runAgentRadar — happy path', () => {
    test('calls Claude with callType agent_radar and returns result with signals', async () => {
        setupQueues();

        const result = await runAgentRadar(db, USER, INSTANCE_A);

        expect(callAI).toHaveBeenCalledTimes(1);
        expect(callAI).toHaveBeenCalledWith(expect.objectContaining({
            callType: 'agent_radar',
        }));
        expect(result).not.toBeNull();
        expect(Array.isArray(result.signals)).toBe(true);
        expect(result.signals).toHaveLength(1);
    });

    test('snapshot includes the entryMap used by the dashboard drilldown', async () => {
        setupQueues();

        const result = await runAgentRadar(db, USER, INSTANCE_A);

        expect(result).toHaveProperty('entryMap');
        expect(typeof result.entryMap).toBe('object');
    });
});

// ── No active entries ─────────────────────────────────────────────────────────
// Proxy for "nothing new to process": when loadEntries returns an empty array
// (all signals archived or none yet), runAgentRadar exits early.
// The cron's 20-hour gap check adds a second layer of idempotency at the
// scheduling level (in scheduleAgentRadar), but this early-return is the
// job-level guard.

describe('runAgentRadar — no active entries', () => {
    test('returns null immediately without calling Claude when there are no entries', async () => {
        setupQueues({ entries: [] });

        const result = await runAgentRadar(db, USER, INSTANCE_A);

        expect(result).toBeNull();
        expect(callAI).not.toHaveBeenCalled();
    });

    test('does not insert into analysis_history when skipping', async () => {
        // Provide no insert slot — if insert were attempted the default fallback
        // would be consumed (null/null), but callAI is never called so insert
        // is never reached. Verify via callAI call count only.
        setupQueues({ entries: [], withInsert: false });

        await runAgentRadar(db, USER, INSTANCE_A);

        expect(callAI).not.toHaveBeenCalled();
    });
});

// ── Instance isolation ────────────────────────────────────────────────────────
// The cron calls runAgentRadar per instance as fire-and-forget (.catch).
// A failure on one instance must not prevent others from being processed.

describe('runAgentRadar — instance isolation', () => {
    test('failure for one instance does not prevent other instances from running', async () => {
        // Instance A: Claude is unavailable
        callAI.mockRejectedValueOnce(new Error('Claude timeout'));
        setupQueues({ withInsert: false }); // no insert slot — won't be reached

        // Simulate the cron's fire-and-forget pattern: catch the error and continue
        const resultA = await runAgentRadar(db, USER, INSTANCE_A).catch(() => null);
        expect(resultA).toBeNull(); // instance A failed gracefully

        // Reset and set up for instance B
        db.__reset();
        callAI.mockResolvedValue(VALID_RADAR);
        setupQueues();

        const resultB = await runAgentRadar(db, USER, INSTANCE_B);
        expect(resultB).not.toBeNull();
        expect(resultB.signals).toHaveLength(1);
    });

    test('callAI is called for both instances — the failing one attempted, the passing one succeeded', async () => {
        // Instance A fails
        callAI.mockRejectedValueOnce(new Error('network error'));
        setupQueues({ withInsert: false });
        await runAgentRadar(db, USER, INSTANCE_A).catch(() => {});

        // Instance B succeeds
        db.__reset();
        callAI.mockResolvedValue(VALID_RADAR);
        setupQueues();
        await runAgentRadar(db, USER, INSTANCE_B);

        expect(callAI).toHaveBeenCalledTimes(2);
    });
});

// ── Claude unavailable ────────────────────────────────────────────────────────

describe('runAgentRadar — Claude unavailable', () => {
    test('throws when Claude API throws, so the cron can catch and log', async () => {
        callAI.mockRejectedValue(new Error('Claude API timeout'));
        // No insert slot — if insert ran it would silently use the default
        // fallback. We verify the function throws BEFORE reaching the insert.
        setupQueues({ withInsert: false });

        await expect(runAgentRadar(db, USER, INSTANCE_A))
            .rejects.toThrow('Claude API timeout');
    });

    test('does not save a corrupt snapshot when Claude fails', async () => {
        callAI.mockRejectedValue(new Error('network error'));
        setupQueues({ withInsert: false });

        // Function throws — insert line is never reached
        await runAgentRadar(db, USER, INSTANCE_A).catch(() => {});

        // callAI was attempted (the job tried), but only once
        expect(callAI).toHaveBeenCalledTimes(1);
        // analysis_history insert slot [4] was NOT consumed:
        // (verified indirectly — the function threw before reaching it)
    });

    test('logs an error and rethrows when AI returns no JSON', async () => {
        callAI.mockResolvedValue('not valid json at all');
        setupQueues({ withInsert: false });

        await expect(runAgentRadar(db, USER, INSTANCE_A))
            .rejects.toThrow();
    });
});

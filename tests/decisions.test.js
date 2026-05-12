'use strict';
/**
 * tests/decisions.test.js
 *
 * Tests for decision log routes:
 *   GET  /api/decisions           — list decisions
 *   POST /api/decisions           — replace decisions array
 *   POST /api/decisions/escalate  — copy PM decision to exec instance
 *   POST /api/decisions/respond   — exec submits response (pending → awaiting_acknowledgment)
 *   POST /api/decisions/acknowledge — PM acknowledges (awaiting_acknowledgment → approved)
 *
 * Queue consumption:
 *
 *   GET  /api/decisions:
 *     [0] resolveInstance  → instances.single()
 *     [1] settings         → instanceSelect.single()
 *
 *   POST /api/decisions:
 *     [0] resolveInstance  → instances.single()
 *     [1] read settings    → instanceSelect.single()
 *     [2] upsert settings  → settings.then()
 *
 *   POST /api/decisions/respond (happy path — decision has linked PM):
 *     [0] resolveInstance  → instances.single()
 *     [1] execSettings     → instanceSelect.single()
 *     [2] upsert exec      → settings.then()
 *     [3] pmSettings       → settings.maybeSingle()
 *     [4] upsert PM        → settings.then()
 *
 *   POST /api/decisions/respond (guard: already responded):
 *     [0] resolveInstance  → instances.single()
 *     [1] execSettings     → instanceSelect.single()
 *     → 400 — no further DB calls
 *
 *   POST /api/decisions/acknowledge (happy path — decision has linked exec):
 *     [0] resolveInstance  → instances.single()
 *     [1] pmSettings       → instanceSelect.single()
 *     [2] upsert PM        → settings.then()
 *     [3] execSettings     → settings.maybeSingle()
 *     [4] upsert exec      → settings.then()
 *
 *   POST /api/decisions/acknowledge (guard: double-acknowledge):
 *     [0] resolveInstance  → instances.single()
 *     [1] pmSettings       → instanceSelect.single()
 *     → 400 — no further DB calls
 */

const { makeAuthRequest, makeUnauthRequest, USER_A, INSTANCE_A, INSTANCE_B, instanceOk, instanceFail } = require('./setup');

jest.mock('@clerk/express');
jest.mock('../database/db');
jest.mock('../routes/exec-routes');
jest.mock('../routes/roadmap-routes');

const { app } = require('../server');
const db = require('../database/db');

beforeEach(() => db.__reset());

// ── Fixtures ──────────────────────────────────────────────────────────────────

const EXEC_INSTANCE_ID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
const PM_DEC_ID   = 'pm-dec-1';
const EXEC_DEC_ID = 'exec-dec-1';

const pendingExecDecision = {
    id:                  EXEC_DEC_ID,
    name:                'Launch Feature X',
    status:              'pending',
    isEscalation:        true,
    linkedPmDecisionId:  PM_DEC_ID,
    linkedPmInstanceId:  INSTANCE_A,
};

const awaitingPmDecision = {
    id:             PM_DEC_ID,
    name:           'Launch Feature X',
    status:         'awaiting_acknowledgment',
    execInstanceId: EXEC_INSTANCE_ID,
    execDecisionId: EXEC_DEC_ID,
    execResponse:   { text: 'Approved', rationale: '', respondedAt: '2024-01-10T00:00:00Z' },
};

// ── GET /api/decisions ────────────────────────────────────────────────────────

describe('GET /api/decisions', () => {
    test('401 when no Authorization header', async () => {
        const res = await makeUnauthRequest(app, 'get', '/api/decisions');
        expect(res.status).toBe(401);
    });

    test('403 when wrong instance', async () => {
        db.__q([instanceFail()]);
        const res = await makeAuthRequest(app, 'get', '/api/decisions', null, INSTANCE_B, USER_A);
        expect(res.status).toBe(403);
    });

    test('200 returns decisions array from settings', async () => {
        const decisions = [{ id: '1', name: 'Decision A', status: 'pending' }];
        db.__q([
            instanceOk(),
            { data: { data: { decisions } }, error: null },
        ]);
        const res = await makeAuthRequest(app, 'get', '/api/decisions');
        expect(res.status).toBe(200);
        expect(res.body).toEqual(decisions);
    });

    test('200 returns empty array when settings has no decisions', async () => {
        db.__q([
            instanceOk(),
            { data: { data: {} }, error: null },
        ]);
        const res = await makeAuthRequest(app, 'get', '/api/decisions');
        expect(res.status).toBe(200);
        expect(res.body).toEqual([]);
    });
});

// ── POST /api/decisions ───────────────────────────────────────────────────────

describe('POST /api/decisions', () => {
    test('400 when decisions is not an array', async () => {
        db.__q([instanceOk()]);
        const res = await makeAuthRequest(app, 'post', '/api/decisions', { decisions: 'bad' });
        expect(res.status).toBe(400);
    });

    test('200 saves decisions array', async () => {
        db.__q([
            instanceOk(),
            { data: { data: {} }, error: null }, // read existing
            { data: null, error: null },           // upsert
        ]);
        const res = await makeAuthRequest(app, 'post', '/api/decisions', {
            decisions: [{ id: '1', name: 'Decision A', status: 'pending' }],
        });
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });
});

// ── POST /api/decisions/respond ───────────────────────────────────────────────

describe('POST /api/decisions/respond — state transitions', () => {
    test('400 when decisionId is missing', async () => {
        db.__q([instanceOk()]);
        const res = await makeAuthRequest(app, 'post', '/api/decisions/respond', { response: 'ok' });
        expect(res.status).toBe(400);
    });

    test('400 when decision is already responded (not pending)', async () => {
        // Guard: only 'pending' decisions can be responded to
        const alreadyRespondedDecision = { ...pendingExecDecision, status: 'awaiting_acknowledgment' };
        db.__q([
            instanceOk(),
            { data: { data: { decisions: [alreadyRespondedDecision] } }, error: null },
        ]);
        const res = await makeAuthRequest(app, 'post', '/api/decisions/respond', {
            decisionId: EXEC_DEC_ID,
            response:   'Approved',
        });
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/already responded/i);
    });

    test('200 transitions pending → awaiting_acknowledgment', async () => {
        db.__q([
            instanceOk(),                                                              // [0] resolveInstance
            { data: { data: { decisions: [pendingExecDecision] } }, error: null },    // [1] execSettings
            { data: null, error: null },                                               // [2] upsert exec
            { data: { data: { decisions: [] } }, error: null },                       // [3] pmSettings
            { data: null, error: null },                                               // [4] upsert PM
        ]);
        const res = await makeAuthRequest(app, 'post', '/api/decisions/respond', {
            decisionId: EXEC_DEC_ID,
            response:   'Approved',
            rationale:  'Meets Q2 goal',
        });
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });
});

// ── POST /api/decisions/acknowledge ──────────────────────────────────────────

describe('POST /api/decisions/acknowledge — state transitions', () => {
    test('400 when decisionId is missing', async () => {
        db.__q([instanceOk()]);
        const res = await makeAuthRequest(app, 'post', '/api/decisions/acknowledge', {});
        expect(res.status).toBe(400);
    });

    test('400 when decision is already approved (double-acknowledge guard)', async () => {
        const approvedDecision = { ...awaitingPmDecision, status: 'approved' };
        db.__q([
            instanceOk(),
            { data: { data: { decisions: [approvedDecision] } }, error: null },
        ]);
        const res = await makeAuthRequest(app, 'post', '/api/decisions/acknowledge', {
            decisionId: PM_DEC_ID,
        });
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/not awaiting acknowledgment/i);
    });

    test('400 when decision is still pending (not yet responded)', async () => {
        const pendingPmDecision = { id: PM_DEC_ID, name: 'X', status: 'pending' };
        db.__q([
            instanceOk(),
            { data: { data: { decisions: [pendingPmDecision] } }, error: null },
        ]);
        const res = await makeAuthRequest(app, 'post', '/api/decisions/acknowledge', {
            decisionId: PM_DEC_ID,
        });
        expect(res.status).toBe(400);
    });

    test('200 transitions awaiting_acknowledgment → approved', async () => {
        db.__q([
            instanceOk(),                                                               // [0] resolveInstance
            { data: { data: { decisions: [awaitingPmDecision] } }, error: null },     // [1] pmSettings
            { data: null, error: null },                                                // [2] upsert PM
            { data: { data: { decisions: [] } }, error: null },                        // [3] execSettings
            { data: null, error: null },                                                // [4] upsert exec
        ]);
        const res = await makeAuthRequest(app, 'post', '/api/decisions/acknowledge', {
            decisionId: PM_DEC_ID,
        });
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });
});

// ── POST /api/decisions/escalate ──────────────────────────────────────────────
//
// Queue:
//   [0] resolveInstance                       → instances.single()
//   [1] find exec instance                    → instances.limit(1) (thenable)
//   [2] pmSettings                            → settings.single()
//   [3] execSettings                          → settings.maybySingle()
//   [4] upsert exec settings                  → settings.upsert (thenable)
//   [5] upsert PM settings                    → settings.upsert (thenable)

describe('POST /api/decisions/escalate', () => {
    const PM_DECISION = { id: PM_DEC_ID, name: 'Launch Feature X', status: 'pending' };
    const EXEC_INST_ID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

    test('400 when decisionId is missing', async () => {
        db.__q([instanceOk()]);
        const res = await makeAuthRequest(app, 'post', '/api/decisions/escalate', {});
        expect(res.status).toBe(400);
    });

    test('404 when no executive instance found', async () => {
        db.__q([
            instanceOk(),
            { data: [], error: null }, // instances.limit(1) → empty
        ]);
        const res = await makeAuthRequest(app, 'post', '/api/decisions/escalate', { decisionId: PM_DEC_ID });
        expect(res.status).toBe(404);
        expect(res.body.error).toMatch(/executive instance/i);
    });

    test('404 when decision not found in PM settings', async () => {
        db.__q([
            instanceOk(),
            { data: [{ id: EXEC_INST_ID }], error: null },         // exec instance
            { data: { data: { decisions: [] } }, error: null },     // pmSettings.single() — no matching decision
        ]);
        const res = await makeAuthRequest(app, 'post', '/api/decisions/escalate', { decisionId: 'nonexistent' });
        expect(res.status).toBe(404);
        expect(res.body.error).toMatch(/decision not found/i);
    });

    test('400 when decision is already escalated', async () => {
        const escalatedDecision = { ...PM_DECISION, escalated: true };
        db.__q([
            instanceOk(),
            { data: [{ id: EXEC_INST_ID }], error: null },
            { data: { data: { decisions: [escalatedDecision] } }, error: null },
        ]);
        const res = await makeAuthRequest(app, 'post', '/api/decisions/escalate', { decisionId: PM_DEC_ID });
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/already escalated/i);
    });

    test('200 escalates decision to exec instance', async () => {
        db.__q([
            instanceOk(),
            { data: [{ id: EXEC_INST_ID }], error: null },                         // [1] exec instance
            { data: { data: { decisions: [PM_DECISION] } }, error: null },          // [2] pmSettings.single()
            { data: null, error: null },                                             // [3] execSettings.maybySingle()
            { data: null, error: null },                                             // [4] upsert exec
            { data: null, error: null },                                             // [5] upsert PM
        ]);
        const res = await makeAuthRequest(app, 'post', '/api/decisions/escalate', { decisionId: PM_DEC_ID });
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.execInstanceId).toBe(EXEC_INST_ID);
        expect(typeof res.body.execDecisionId).toBe('string');
    });

    test('wrong instance → 403', async () => {
        db.__q([instanceFail()]);
        const res = await makeAuthRequest(app, 'post', '/api/decisions/escalate',
            { decisionId: PM_DEC_ID }, INSTANCE_B, USER_A);
        expect(res.status).toBe(403);
    });
});

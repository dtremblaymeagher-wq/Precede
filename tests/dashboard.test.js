/**
 * tests/dashboard.test.js
 *
 * Tests for:
 *   POST /api/dashboard/untracked-demand  — AI: signals not tracked in backlog
 *   POST /api/dashboard/okr-coverage      — AI: OKR × sprint stories × signals
 *
 * Queue for POST /api/dashboard/untracked-demand:
 *
 *   Cache hit (computedAt within 24h):
 *     [0] resolveInstance
 *     [1] settings.single() → cache present & fresh → returns cached value
 *
 *   Insufficient data (entries.length < 2):
 *     [0] resolveInstance
 *     [1] settings.single() → no cache
 *     [2] intelligence_entries.then()   (Promise.all)
 *     [3] backlog_stories.then()        (Promise.all)
 *     → { insufficient: true }
 *
 * Queue for POST /api/dashboard/okr-coverage:
 *
 *   No objectives early return:
 *     [0] resolveInstance
 *     [1] settings.single() → no objectives → { noObjectives: true }
 *
 *   No sprint / no data early return:
 *     [0] resolveInstance
 *     [1] settings.single() → has objectives, no cache
 *     [2] sprints.single()  → null (getCurrentSprint: no jira sprint)
 *     [3] settings.single() → null (getSprintConfig: no start date → sprint=null)
 *     [4] intelligence_entries.then()  (Promise.all)
 *     [5] backlog_stories.then()       (Promise.all)
 *     → { noData: true }  (0 sprintStories, entries.length < 2)
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

// ── POST /api/dashboard/untracked-demand ─────────────────────────────────────

describe('POST /api/dashboard/untracked-demand', () => {
    test('returns cached result when fresh cache exists', async () => {
        // Fingerprint = entryCount|mostRecentDate — need ≥2 entries to pass the insufficient check
        const entries      = [{ body: 'signal 1', date: '2026-01-02' }, { body: 'signal 2', date: '2026-01-01' }];
        const fingerprint  = `2|2026-01-02|0`;
        const cachedPayload = {
            results: [{ theme: 'Dark mode', signals: 5 }],
            computedAt: new Date().toISOString(),
            signalFingerprint: fingerprint,
        };
        db.__q([
            instanceOk(),
            { data: { data: { untrackedDemandCache: cachedPayload } }, error: null }, // settings
            { data: entries.map(e => ({ data: e })), error: null },  // intelligence_entries (fingerprint matches → cache hit)
            { data: [], error: null },                               // backlog_stories
        ]);
        const res = await makeAuthRequest(app, 'post', '/api/dashboard/untracked-demand', {}, INSTANCE_A);
        expect(res.status).toBe(200);
        expect(res.body.results).toEqual(cachedPayload.results);
    });

    test('returns insufficient:true when fewer than 2 hub entries', async () => {
        db.__q([
            instanceOk(),
            { data: { data: {} }, error: null },             // no cache in settings
            { data: [{ data: { body: 'one entry' } }], error: null }, // 1 entry only
            { data: [], error: null },                       // backlog_stories
        ]);
        const res = await makeAuthRequest(app, 'post', '/api/dashboard/untracked-demand', {}, INSTANCE_A);
        expect(res.status).toBe(200);
        expect(res.body.insufficient).toBe(true);
        expect(res.body.results).toEqual([]);
    });

    test('no auth → 401', async () => {
        const res = await makeUnauthRequest(app, 'post', '/api/dashboard/untracked-demand', {});
        expect(res.status).toBe(401);
    });

    test('missing X-Instance-Id → 400', async () => {
        const supertest = require('supertest');
        const res = await supertest(app).post('/api/dashboard/untracked-demand')
            .set('Authorization', `Bearer ${USER_A}`)
            .set('Content-Type', 'application/json')
            .send({});
        expect(res.status).toBe(400);
    });

    test('wrong instance → 403', async () => {
        db.__q([instanceFail()]);
        const res = await makeAuthRequest(app, 'post', '/api/dashboard/untracked-demand', {}, INSTANCE_B, USER_A);
        expect(res.status).toBe(403);
    });
});

// ── POST /api/dashboard/okr-coverage ─────────────────────────────────────────

describe('POST /api/dashboard/okr-coverage', () => {
    test('returns noObjectives:true when no OKRs configured', async () => {
        db.__q([
            instanceOk(),
            { data: { data: { objectives: [] } }, error: null },
        ]);
        const res = await makeAuthRequest(app, 'post', '/api/dashboard/okr-coverage', {}, INSTANCE_A);
        expect(res.status).toBe(200);
        expect(res.body.noObjectives).toBe(true);
    });

    test('returns noData:true when no sprint stories and insufficient signals', async () => {
        db.__q([
            instanceOk(),
            { data: { data: { objectives: ['Grow ARR'] } }, error: null }, // settings
            { data: null, error: null },   // getCurrentSprint → sprints.single() → null
            { data: null, error: null },   // getSprintConfig → settings.single() → no startDate
            { data: [], error: null },     // intelligence_entries (Promise.all)
            { data: [], error: null },     // backlog_stories (Promise.all)
        ]);
        const res = await makeAuthRequest(app, 'post', '/api/dashboard/okr-coverage', {}, INSTANCE_A);
        expect(res.status).toBe(200);
        expect(res.body.noData).toBe(true);
    });

    test('no auth → 401', async () => {
        const res = await makeUnauthRequest(app, 'post', '/api/dashboard/okr-coverage', {});
        expect(res.status).toBe(401);
    });

    test('missing X-Instance-Id → 400', async () => {
        const supertest = require('supertest');
        const res = await supertest(app).post('/api/dashboard/okr-coverage')
            .set('Authorization', `Bearer ${USER_A}`)
            .set('Content-Type', 'application/json')
            .send({});
        expect(res.status).toBe(400);
    });

    test('wrong instance → 403', async () => {
        db.__q([instanceFail()]);
        const res = await makeAuthRequest(app, 'post', '/api/dashboard/okr-coverage', {}, INSTANCE_B, USER_A);
        expect(res.status).toBe(403);
    });
});

// ── POST /api/dashboard/untracked-demand — cache & filter edge cases ──────────

describe('POST /api/dashboard/untracked-demand — cacheOnly and force', () => {

    test('cacheOnly:true with no cache → { results: [], computedAt: null }', async () => {
        db.__q([
            instanceOk(),
            { data: { data: {} }, error: null },                        // settings — no cache
            { data: [{ data: { body: 's1', date: '2026-01-02' } }, { data: { body: 's2', date: '2026-01-01' } }], error: null }, // entries
            { data: [], error: null },                                   // backlog_stories
        ]);
        const res = await makeAuthRequest(app, 'post', '/api/dashboard/untracked-demand', { cacheOnly: true }, INSTANCE_A);
        expect(res.status).toBe(200);
        expect(res.body.results).toEqual([]);
        expect(res.body.computedAt).toBeNull();
    });

    test('force:true bypasses matching fingerprint cache and calls AI', async () => {
        const entries = [
            { data: { body: 'signal 1', date: '2026-01-02', id: 'sig-1' } },
            { data: { body: 'signal 2', date: '2026-01-01', id: 'sig-2' } },
        ];
        // Fingerprint the cache would match: 2 entries, mostRecent=2026-01-02, 0 active stories
        const matchingFingerprint = '2|2026-01-02|0';
        const staleCache = {
            results:          [{ topic: 'Old Result', urgency_score: 5 }],
            olderResults:     [],
            computedAt:       new Date().toISOString(),
            signalFingerprint: matchingFingerprint,
        };

        global.fetch = jest.fn().mockResolvedValue({
            json: () => Promise.resolve({
                content: [{ text: '[{"topic":"New Result","urgency_score":8,"signal_count":2}]' }],
            }),
        });

        db.__q([
            instanceOk(),
            { data: { data: { untrackedDemandCache: staleCache } }, error: null }, // settings — cache matches fingerprint
            { data: entries, error: null },                                         // intelligence_entries
            { data: [], error: null },                                              // backlog_stories
            { data: null, error: null },                                            // settings.upsert (save new cache)
        ]);

        const res = await makeAuthRequest(app, 'post', '/api/dashboard/untracked-demand', { force: true }, INSTANCE_A);
        expect(res.status).toBe(200);
        // force skipped the cache → AI was called → new result returned
        expect(res.body.results[0].topic).toBe('New Result');
    });
});

describe('POST /api/dashboard/untracked-demand — filterActioned', () => {

    test('items linked to an active story are excluded from results', async () => {
        // Cache has 2 items: 'Feature A' linked to sig-1, 'Feature B' linked to sig-2
        // Backlog has an active (non-Done) story with precede_origin.signal_ids = ['sig-1']
        // → sig-1 is actioned → Feature A filtered out, Feature B kept
        const entries = [
            { data: { body: 'signal 1', date: '2026-01-02', id: 'sig-1' } },
            { data: { body: 'signal 2', date: '2026-01-01', id: 'sig-2' } },
        ];
        const fingerprint = '2|2026-01-02|1'; // 1 active story
        const cache = {
            results: [
                { topic: 'Feature A', source_ids: ['sig-1'] },
                { topic: 'Feature B', source_ids: ['sig-2'] },
            ],
            olderResults:      [],
            computedAt:        new Date().toISOString(),
            signalFingerprint: fingerprint,
        };
        const activeStory = { data: { status: 'In Progress', precede_origin: { signal_ids: ['sig-1'] } } };

        db.__q([
            instanceOk(),
            { data: { data: { untrackedDemandCache: cache } }, error: null }, // settings
            { data: entries, error: null },                                    // intelligence_entries
            { data: [activeStory], error: null },                             // backlog_stories
        ]);

        const res = await makeAuthRequest(app, 'post', '/api/dashboard/untracked-demand', {}, INSTANCE_A);
        expect(res.status).toBe(200);
        expect(res.body.results).toHaveLength(1);
        expect(res.body.results[0].topic).toBe('Feature B');
    });

    test('Done stories do not count as actioned — their signal_ids remain filterable', async () => {
        // A Done story's signal_ids are excluded from actionedSignalIds
        // → both items remain in results
        const entries = [
            { data: { body: 'signal 1', date: '2026-01-02', id: 'sig-1' } },
            { data: { body: 'signal 2', date: '2026-01-01', id: 'sig-2' } },
        ];
        const fingerprint = '2|2026-01-02|0'; // 0 active stories (Done doesn't count)
        const cache = {
            results: [
                { topic: 'Feature A', source_ids: ['sig-1'] },
                { topic: 'Feature B', source_ids: ['sig-2'] },
            ],
            olderResults:      [],
            computedAt:        new Date().toISOString(),
            signalFingerprint: fingerprint,
        };
        const doneStory = { data: { status: 'Done', precede_origin: { signal_ids: ['sig-1'] } } };

        db.__q([
            instanceOk(),
            { data: { data: { untrackedDemandCache: cache } }, error: null },
            { data: entries, error: null },
            { data: [doneStory], error: null },
        ]);

        const res = await makeAuthRequest(app, 'post', '/api/dashboard/untracked-demand', {}, INSTANCE_A);
        expect(res.status).toBe(200);
        // Done story excluded from actionedSignalIds → both items kept
        expect(res.body.results).toHaveLength(2);
    });
});

// ── Fault tolerance ───────────────────────────────────────────────────────────

describe('POST /api/dashboard/untracked-demand — fault tolerance', () => {
    test('500 when Claude API throws a network error', async () => {
        global.fetch = jest.fn().mockRejectedValue(new Error('network error'));
        db.__q([
            instanceOk(),
            { data: { data: {} }, error: null },  // settings — no cache
            { data: [
                { data: { body: 'signal 1', date: '2026-01-02', id: 'sig-1' } },
                { data: { body: 'signal 2', date: '2026-01-01', id: 'sig-2' } },
            ], error: null },                      // intelligence_entries (≥2 → reaches callAI)
            { data: [], error: null },             // backlog_stories
        ]);
        const res = await makeAuthRequest(app, 'post', '/api/dashboard/untracked-demand',
            { force: true }, INSTANCE_A);
        expect(res.status).toBe(500);
    });

    test('500 when DB throws during data load (Promise.all rejection)', async () => {
        // Promise.resolve(rejectedPromise) propagates the rejection through Promise.all
        const rejected = Promise.reject(new Error('DB connection lost'));
        rejected.catch(() => {}); // prevent unhandled rejection warning
        db.__q([
            instanceOk(),
            rejected, // settings query in Promise.all throws → whole Promise.all rejects → 500
            // entries and backlog consume default slots; the settings rejection wins
        ]);
        const res = await makeAuthRequest(app, 'post', '/api/dashboard/untracked-demand',
            {}, INSTANCE_A);
        expect(res.status).toBe(500);
    });
});

describe('POST /api/dashboard/okr-coverage — fault tolerance', () => {
    test('500 when Claude API throws a network error', async () => {
        global.fetch = jest.fn().mockRejectedValue(new Error('network error'));
        db.__q([
            instanceOk(),
            { data: { data: { objectives: ['Grow ARR'] } }, error: null }, // settings
            { data: null, error: null },  // getCurrentSprint → sprints.single()
            { data: null, error: null },  // getSprintConfig → settings.single()
            { data: [
                { data: { body: 'signal 1', date: '2026-01-01', sourceType: 'interview' } },
                { data: { body: 'signal 2', date: '2026-01-02', sourceType: 'interview' } },
            ], error: null },             // intelligence_entries (≥2 → bypasses noData)
            { data: [], error: null },    // backlog_stories
        ]);
        const res = await makeAuthRequest(app, 'post', '/api/dashboard/okr-coverage',
            {}, INSTANCE_A);
        expect(res.status).toBe(500);
    });

    test('500 when DB throws on settings load', async () => {
        const rejected = Promise.reject(new Error('DB connection lost'));
        rejected.catch(() => {}); // prevent unhandled rejection warning
        db.__q([
            instanceOk(),
            rejected, // settings.single() throws → propagates to outer catch → 500
        ]);
        const res = await makeAuthRequest(app, 'post', '/api/dashboard/okr-coverage',
            {}, INSTANCE_A);
        expect(res.status).toBe(500);
    });
});

/**
 * tests/radar.test.js
 *
 * Tests for /api/history and /api/analyze routes.
 *
 * ⚠️  PREREQUISITE: server.js must export `app` and guard app.listen().
 */

const { makeAuthRequest, USER_A, INSTANCE_A, INSTANCE_B, instanceOk, instanceFail } = require('./setup');

jest.mock('@clerk/express');
jest.mock('../database/db');
jest.mock('../routes/exec-routes');
jest.mock('../routes/roadmap-routes');

const { app } = require('../server');
const db = require('../database/db');

// server.js uses the Node 18+ native global fetch — mock it here
const mockFetch = jest.fn();

beforeAll(() => { global.fetch = mockFetch; });
afterAll(() => { delete global.fetch; });
beforeEach(() => {
    db.__reset();
    mockFetch.mockReset();
});

// ── GET /api/history ─────────────────────────────────────────────────────────
describe('GET /api/history', () => {
    test('returns filenames ordered by created_at descending', async () => {
        const rows = [
            { filename: 'radar-2025-03.json' },
            { filename: 'radar-2025-02.json' },
        ];
        db.__q([instanceOk(), { data: rows, error: null }]);

        const res = await makeAuthRequest(app, 'get', '/api/history', null, INSTANCE_A);
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
        expect(res.body[0]).toBe('radar-2025-03.json');
    });

    test('cannot access history from other instance (→ 403)', async () => {
        db.__q([instanceFail()]);
        const res = await makeAuthRequest(app, 'get', '/api/history', null, INSTANCE_B, USER_A);
        expect(res.status).toBe(403);
    });
});

// ── GET /api/history/:filename ────────────────────────────────────────────────
describe('GET /api/history/:filename', () => {
    test('returns analysis data', async () => {
        const analysisData = { analysis: { summary: 'Test summary' }, sprint_memory: {} };
        db.__q([
            instanceOk(),
            { data: { data: analysisData }, error: null },
        ]);

        const res = await makeAuthRequest(app, 'get', '/api/history/radar-123.json', null, INSTANCE_A);
        expect(res.status).toBe(200);
        expect(res.body.analysis.summary).toBe('Test summary');
    });

    test('returns 404 for non-existent file', async () => {
        db.__q([
            instanceOk(),
            { data: null, error: { code: 'PGRST116', message: 'No rows' } },
        ]);

        const res = await makeAuthRequest(app, 'get', '/api/history/radar-missing.json', null, INSTANCE_A);
        expect(res.status).toBe(404);
    });

    test('cannot access history from other instance (→ 403)', async () => {
        db.__q([instanceFail()]);
        const res = await makeAuthRequest(app, 'get', '/api/history/radar-123.json', null, INSTANCE_B, USER_A);
        expect(res.status).toBe(403);
    });
});

// ── POST /api/analyze ────────────────────────────────────────────────────────
describe('POST /api/analyze', () => {
    test('returns 400 if dataset empty', async () => {
        db.__q([instanceOk()]);
        const res = await makeAuthRequest(app, 'post', '/api/analyze', { dataset: [] }, INSTANCE_A);
        expect(res.status).toBe(400);
    });

    test('returns 400 if dataset missing', async () => {
        db.__q([instanceOk()]);
        const res = await makeAuthRequest(app, 'post', '/api/analyze', {}, INSTANCE_A);
        expect(res.status).toBe(400);
    });

    test('response contains analysis + meta keys on success', async () => {
        const claudeResponse = {
            analysis: {
                summary: 'Things are going well.',
                trends: [], opportunities: [], risks: [], next_actions: [],
                delta: { new_signals: [], strengthened: [], resolved: [], contradictions: [] },
                okr_alignment: [], strategic_gap_deep_dive: [], sentiment: [],
                longitudinal: { status: 'insufficient_data', sprints_completed: 0, sprints_required: 4, days_accumulated: 0, days_required: 60 },
            },
            sprint_memory: {
                savedAt: new Date().toISOString(),
                established_trends: [], active_risks: [], tracked_opportunities: [], decisions_made: [],
            },
        };

        // Supabase calls made by /api/analyze:
        // 1. resolveInstance
        // 2. vision load (.single)
        // 3. settings load (.single)
        // 4. sprint memory load (.single)
        // 5. sprint stats (.then - direct await)
        // 6. analysis_history insert
        // 7. getCurrentSprint (sprint config from settings) - for radar_memory upsert
        // 8. radar_memory upsert
        const okResponse = { data: null, error: null };
        db.__q([
            instanceOk(),                                                        // 1. resolveInstance
            { data: { data: { vision: 'Build great products' } }, error: null }, // 2. vision
            { data: { data: { objectives: ['OKR1'], personas: [] } }, error: null }, // 3. settings
            { data: null, error: null },                                         // 4. sprint memory (none)
            { data: [], error: null },                                           // 5. sprint stats
            okResponse,                                                          // 6. insert history
            { data: { data: {} }, error: null },                                 // 7. getCurrentSprint settings
            okResponse,                                                          // 8. radar_memory upsert
        ]);

        // Mock Claude API response
        mockFetch.mockResolvedValueOnce({
            json: async () => ({
                content: [{ text: JSON.stringify(claudeResponse) }],
            }),
        });

        const dataset = [
            { body: 'Users love the new feature', person: 'Alice', sourceType: 'feedback', date: new Date().toISOString() },
        ];
        const res = await makeAuthRequest(app, 'post', '/api/analyze', { dataset }, INSTANCE_A);

        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('analysis');
        expect(res.body).toHaveProperty('meta');
    });

    test('handles malformed JSON from Claude gracefully (no crash → 500 with error message)', async () => {
        db.__q([
            instanceOk(),
            { data: { data: { vision: 'Test' } }, error: null },
            { data: { data: { objectives: [] } }, error: null },
            { data: null, error: null },
            { data: [], error: null },
        ]);

        // Claude returns malformed JSON (no JSON block at all)
        mockFetch.mockResolvedValueOnce({
            json: async () => ({
                content: [{ text: 'Sorry, I cannot process that.' }],
            }),
        });

        const dataset = [{ body: 'A signal', person: 'Bob', date: new Date().toISOString() }];
        const res = await makeAuthRequest(app, 'post', '/api/analyze', { dataset }, INSTANCE_A);

        // Should not crash the server — returns an error response, not a hang
        expect([400, 500]).toContain(res.status);
        expect(res.body).toHaveProperty('error');
    });
});

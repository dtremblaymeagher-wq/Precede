'use strict';
/**
 * tests/models.test.js
 *
 * Tests that:
 *   1. MODELS constants point to the correct model IDs (regression guard against
 *      silent model renames or copy-paste errors).
 *   2. Each major callType reaches the Anthropic API with the expected model.
 *      Verified by inspecting the JSON body sent to global.fetch.
 *
 * Model policy (from CLAUDE.md):
 *   sonnet — radar analysis, brainstorm, epic prediction, story grooming, OKR coverage
 *   haiku  — RICE estimation, smart audit, meeting prep, learning, signal compression
 */

jest.mock('@clerk/express');
jest.mock('../database/db');
jest.mock('../routes/exec-routes');
jest.mock('../routes/roadmap-routes');

const { app } = require('../server');
const db = require('../database/db');
const { MODELS } = require('../shared/ai-client');
const { makeAuthRequest, instanceOk } = require('./setup');

// ── MODELS constants ───────────────────────────────────────────────────────────

describe('MODELS constants', () => {
    test('MODELS.sonnet points to claude-sonnet-4-6', () => {
        expect(MODELS.sonnet).toBe('claude-sonnet-4-6');
    });

    test('MODELS.haiku points to claude-haiku-4-5-20251001', () => {
        expect(MODELS.haiku).toBe('claude-haiku-4-5-20251001');
    });

    test('no deprecated model IDs present (sonnetV2 was removed)', () => {
        expect(Object.values(MODELS)).not.toContain('claude-sonnet-4-0');
        expect(Object.keys(MODELS)).not.toContain('sonnetV2');
    });

    test('MODELS only exports known keys', () => {
        expect(Object.keys(MODELS).sort()).toEqual(['haiku', 'sonnet']);
    });
});

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Returns the model ID from the first Anthropic API call made via global.fetch. */
function capturedModel() {
    const calls = global.fetch.mock.calls;
    if (!calls.length) return null;
    try {
        return JSON.parse(calls[0][1].body).model;
    } catch {
        return null;
    }
}

const ok    = () => ({ data: null, error: null });
const rows  = (d = []) => ({ data: d, error: null });

const savedFetch = global.fetch;
beforeEach(() => {
    db.__reset();
    global.fetch = jest.fn();
    db.__qTable('signal_summaries', [{ data: [], error: null }]);
});
afterAll(() => { global.fetch = savedFetch; });

// ── /api/analyze — sonnet ──────────────────────────────────────────────────────

describe('model used: /api/analyze', () => {
    test('uses MODELS.sonnet (claude-sonnet-4-6)', async () => {
        const analysis = { analysis: { summary: 'ok', strategic_alignment_summary: 'ok', trends: [], okr_alignment: [], delta: { new_signals: [], strengthened: [], resolved: [], contradictions: [] }, opportunities: [], risks: [], recommendations: [] } };
        global.fetch.mockResolvedValue({
            json: () => Promise.resolve({ content: [{ text: JSON.stringify(analysis) }] }),
        });

        db.__q([
            instanceOk(),
            { data: { data: { vision: 'Build PM tool' } }, error: null },
            { data: { data: { objectives: ['Grow ARR'], personas: [{ name: 'PM' }] } }, error: null },
            rows(),   // feedback
            ok(),     // sprint memory
            rows(),   // analysis_history (getSprintStats)
            ok(),     // insert analysis_history
        ]);

        const dataset = [{ body: 'User wants dark mode', person: 'Alice', date: new Date().toISOString() }];
        await makeAuthRequest(app, 'post', '/api/analyze', { dataset });

        expect(capturedModel()).toBe(MODELS.sonnet);
    });
});

// ── /api/dashboard/untracked-demand — haiku ───────────────────────────────────

describe('model used: /api/dashboard/untracked-demand', () => {
    test('uses MODELS.haiku (claude-haiku-4-5-20251001) for AI call', async () => {
        global.fetch.mockResolvedValue({
            json: () => Promise.resolve({
                content: [{ text: '[{"topic":"Dark mode","urgency_score":8,"signal_count":2}]' }],
            }),
        });

        const entries = [
            { data: { body: 'signal 1', date: '2026-01-02', id: 'sig-1' } },
            { data: { body: 'signal 2', date: '2026-01-01', id: 'sig-2' } },
        ];

        db.__q([
            instanceOk(),
            { data: { data: {} }, error: null },      // settings — no cache
            { data: entries, error: null },            // intelligence_entries
            { data: [], error: null },                 // backlog_stories
            { data: null, error: null },               // settings.upsert (save cache)
        ]);

        await makeAuthRequest(app, 'post', '/api/dashboard/untracked-demand', { force: true });

        expect(capturedModel()).toBe(MODELS.haiku);
    });
});

// ── /api/dashboard/okr-coverage — sonnet ──────────────────────────────────────

describe('model used: /api/dashboard/okr-coverage', () => {
    test('uses MODELS.sonnet for OKR coverage AI call', async () => {
        const coverage = {
            storyCoverage:    [{ okr: 'Grow ARR', storyCount: 0, storyPoints: 0, stories: [], executionScore: 0, coverageLevel: 'none', sprintGoalAlignmentScore: 50, note: 'ok' }],
            demandAlignment:  [{ okr: 'Grow ARR', signalCount: 0, alignment: 'none', signals: [] }],
            unalignedDemand:  { signalCount: 0, topics: [], note: 'none', signals: [] },
            storyScores:      [],
        };
        global.fetch.mockResolvedValue({
            json: () => Promise.resolve({ content: [{ text: JSON.stringify(coverage) }] }),
        });

        db.__q([
            instanceOk(),
            { data: { data: { objectives: ['Grow ARR'] } }, error: null }, // settings
            { data: null, error: null },   // getCurrentSprint → sprints.single() → null
            { data: null, error: null },   // getSprintConfig → settings.single() → no startDate
            { data: [                      // intelligence_entries — ≥2 to bypass noData check
                { data: { body: 'signal 1', date: '2026-01-01', sourceType: 'interview' } },
                { data: { body: 'signal 2', date: '2026-01-02', sourceType: 'interview' } },
            ], error: null },
            { data: [], error: null },     // backlog_stories
            { data: null, error: null },   // settings.upsert save cache
        ]);

        await makeAuthRequest(app, 'post', '/api/dashboard/okr-coverage', {});

        expect(capturedModel()).toBe(MODELS.sonnet);
    });
});

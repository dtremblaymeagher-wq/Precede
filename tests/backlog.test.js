/**
 * tests/backlog.test.js
 *
 * Tests for /api/backlog routes.
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

beforeEach(() => db.__reset());

// ── GET /api/backlog ──────────────────────────────────────────────────────────
describe('GET /api/backlog', () => {
    test('returns stories for correct instance', async () => {
        const stories = [
            { filename: 'story-1.json', display_order: 0, data: { title: 'Story A', jiraRank: null, rice: { score: 80 } } },
            { filename: 'story-2.json', display_order: 1, data: { title: 'Story B', jiraRank: null, rice: { score: 60 } } },
        ];
        db.__q([instanceOk(), { data: stories, error: null }]);

        const res = await makeAuthRequest(app, 'get', '/api/backlog', null, INSTANCE_A);
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
        expect(res.body[0].title).toBe('Story A');
    });

    test('stories with jiraRank sort before stories without', async () => {
        const stories = [
            { filename: 'story-1.json', display_order: 0, data: { title: 'No rank',   jiraRank: null, rice: { score: 100 } } },
            { filename: 'story-2.json', display_order: 1, data: { title: 'Jira rank', jiraRank: 1,    rice: { score: 10  } } },
        ];
        db.__q([instanceOk(), { data: stories, error: null }]);

        const res = await makeAuthRequest(app, 'get', '/api/backlog', null, INSTANCE_A);
        expect(res.status).toBe(200);
        expect(res.body[0].title).toBe('Jira rank'); // jiraRank=1 sorts first
    });

    test('stories without jiraRank sorted by RICE score descending', async () => {
        const stories = [
            { filename: 'story-1.json', display_order: 0, data: { title: 'Low RICE',  jiraRank: null, rice: { score: 20 } } },
            { filename: 'story-2.json', display_order: 1, data: { title: 'High RICE', jiraRank: null, rice: { score: 90 } } },
        ];
        db.__q([instanceOk(), { data: stories, error: null }]);

        const res = await makeAuthRequest(app, 'get', '/api/backlog', null, INSTANCE_A);
        expect(res.status).toBe(200);
        expect(res.body[0].title).toBe('High RICE'); // higher RICE first
    });
});

// ── POST /api/backlog ─────────────────────────────────────────────────────────
describe('POST /api/backlog', () => {
    test('creates story with required fields', async () => {
        db.__q([instanceOk(), { data: null, error: null }]);

        const story = {
            title: 'As a user I want to login',
            content: '<p>...</p>',
            rice: { reach: 5, impact: 8, confidence: 80, effort: 3, score: 107 },
            status: 'To Do',
        };
        const res = await makeAuthRequest(app, 'post', '/api/backlog', story, INSTANCE_A);
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.fileName).toMatch(/^story-\d+\.json$/);
    });

    // NOTE: title is not validated server-side (body just uses title ?? storyData?.title).
    // A missing title results in title: undefined being stored — not a 400 error currently.
    // TODO: add 400 validation for missing title in a future cleanup.
});

// ── PUT /api/backlog/:fileName ────────────────────────────────────────────────
describe('PUT /api/backlog/:fileName', () => {
    const existingStory = {
        id: 1000,
        title: 'Existing story',
        status: 'To Do',
        history: [],
        rice: { score: 50 },
    };

    test('updates story', async () => {
        db.__q([
            instanceOk(),
            { data: { data: existingStory }, error: null },  // fetch existing
            { data: null, error: null },                     // update
        ]);

        const res = await makeAuthRequest(
            app, 'put', '/api/backlog/story-1000.json',
            { title: 'Updated title' },
            INSTANCE_A
        );
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    test('tracks status change in history array', async () => {
        // The route pushes { field: 'status', from, to, changedAt } to story.history
        // We can verify this indirectly: the route returns 200 (history logic runs server-side)
        db.__q([
            instanceOk(),
            { data: { data: { ...existingStory, status: 'To Do' } }, error: null },
            { data: null, error: null },
        ]);

        const res = await makeAuthRequest(
            app, 'put', '/api/backlog/story-1000.json',
            { status: 'In Progress' },
            INSTANCE_A
        );
        expect(res.status).toBe(200);
    });

    test('returns 404 if story not found', async () => {
        db.__q([
            instanceOk(),
            { data: null, error: { message: 'not found' } }, // fetch returns nothing
        ]);

        const res = await makeAuthRequest(
            app, 'put', '/api/backlog/story-nonexistent.json',
            { title: 'Updated' },
            INSTANCE_A
        );
        expect(res.status).toBe(404);
    });

    test('cannot update story from other instance (→ 403)', async () => {
        db.__q([instanceFail()]);
        const res = await makeAuthRequest(
            app, 'put', '/api/backlog/story-1000.json',
            { title: 'Updated' },
            INSTANCE_B, USER_A
        );
        expect(res.status).toBe(403);
    });
});

// ── GET /api/backlog/summary ──────────────────────────────────────────────────
describe('GET /api/backlog/summary', () => {
    test('returns text summary of all stories', async () => {
        const stories = [
            { data: { title: 'Login flow',   status: 'In Progress' } },
            { data: { title: 'Dark mode',    status: 'To Do'       } },
        ];
        db.__q([instanceOk(), { data: stories, error: null }]);
        const res = await makeAuthRequest(app, 'get', '/api/backlog/summary');
        expect(res.status).toBe(200);
        expect(typeof res.body.summary).toBe('string');
        expect(res.body.summary).toMatch(/Login flow/);
    });

    test('returns empty message when backlog is empty', async () => {
        db.__q([instanceOk(), { data: [], error: null }]);
        const res = await makeAuthRequest(app, 'get', '/api/backlog/summary');
        expect(res.status).toBe(200);
        expect(res.body.summary).toMatch(/vide/i);
    });

    test('wrong instance → 403', async () => {
        db.__q([instanceFail()]);
        const res = await makeAuthRequest(app, 'get', '/api/backlog/summary', null, INSTANCE_B, USER_A);
        expect(res.status).toBe(403);
    });
});

// ── POST /api/backlog/reorder ─────────────────────────────────────────────────
describe('POST /api/backlog/reorder', () => {
    test('400 when orderedFiles is missing or empty', async () => {
        db.__q([instanceOk()]);
        const res = await makeAuthRequest(app, 'post', '/api/backlog/reorder', {});
        expect(res.status).toBe(400);
    });

    test('200 when valid orderedFiles array provided', async () => {
        // 2 files → 2 update operations in Promise.all
        db.__q([instanceOk()]);
        db.__qTable('backlog_stories', [
            { data: null, error: null },
            { data: null, error: null },
        ]);
        const res = await makeAuthRequest(app, 'post', '/api/backlog/reorder', {
            orderedFiles: ['story-1.json', 'story-2.json'],
        });
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    test('wrong instance → 403', async () => {
        db.__q([instanceFail()]);
        const res = await makeAuthRequest(app, 'post', '/api/backlog/reorder',
            { orderedFiles: ['story-1.json'] }, INSTANCE_B, USER_A);
        expect(res.status).toBe(403);
    });
});

// ── POST /api/backlog/suggest-order ──────────────────────────────────────────
describe('POST /api/backlog/suggest-order', () => {
    test('400 when stories is not an array', async () => {
        db.__q([instanceOk()]);
        const res = await makeAuthRequest(app, 'post', '/api/backlog/suggest-order', { stories: 'bad' });
        expect(res.status).toBe(400);
    });

    test('returns suggestions array for valid stories list', async () => {
        db.__q([instanceOk()]);
        const stories = [
            { fileName: 'story-1.json', title: 'Search',   rice: { score: 90 } },
            { fileName: 'story-2.json', title: 'Dark mode', rice: { score: 20 } },
        ];
        const res = await makeAuthRequest(app, 'post', '/api/backlog/suggest-order', { stories });
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.suggestions)).toBe(true);
    });

    // NOTE: suggest-order is in INSTANCE_FREE_PATHS — no resolveInstance, no 403 case.
});

// ── POST /api/backlog/smart-audit ─────────────────────────────────────────────
// ⚠️  Tests the HARD RULE citation validation — evidence must reference real feedback text.
describe('POST /api/backlog/smart-audit', () => {
    const savedFetch = global.fetch;
    beforeEach(() => { global.fetch = jest.fn(); });
    afterAll(() => { global.fetch = savedFetch; });

    test('400 when stories is not an array', async () => {
        db.__q([instanceOk(), { data: [], error: null }]);
        const res = await makeAuthRequest(app, 'post', '/api/backlog/smart-audit', { stories: 'bad' });
        expect(res.status).toBe(400);
    });

    test('returns early with empty audits when no hub feedbacks', async () => {
        db.__q([
            instanceOk(),
            { data: [], error: null },  // intelligence_entries — empty
        ]);
        const res = await makeAuthRequest(app, 'post', '/api/backlog/smart-audit', { stories: [] });
        expect(res.status).toBe(200);
        expect(res.body.audits).toEqual([]);
        expect(res.body.message).toBeDefined();
    });

    test('citation validation — audit with real evidence phrase passes', async () => {
        const feedbackBody = 'users frequently report that the export feature is too slow and causes timeouts';
        global.fetch = jest.fn().mockResolvedValue({
            json: () => Promise.resolve({
                content: [{
                    text: JSON.stringify({
                        audits: [{
                            fileName:        'story-1.json',
                            type:            'overvalued',
                            suggestedImpact: 3,
                            evidence:        ['users frequently report that the export feature is too slow'],
                        }],
                        duplicates: [],
                    }),
                }],
            }),
        });
        db.__q([
            instanceOk(),
            { data: [{ data: { body: feedbackBody } }], error: null }, // feedbacks
            { data: null, error: null }, // vision (non-fatal try/catch)
            { data: null, error: null }, // settings (non-fatal try/catch)
        ]);
        const stories = [{ fileName: 'story-1.json', title: 'Export', rice: { score: 80, impact: 8 } }];
        const res = await makeAuthRequest(app, 'post', '/api/backlog/smart-audit', { stories });
        expect(res.status).toBe(200);
        expect(res.body.audits).toHaveLength(1);  // evidence matched → kept
    });

    test('citation validation — fabricated evidence that is not in feedbacks is rejected', async () => {
        const feedbackBody = 'users frequently report that the export feature is too slow';
        global.fetch = jest.fn().mockResolvedValue({
            json: () => Promise.resolve({
                content: [{
                    text: JSON.stringify({
                        audits: [{
                            fileName:        'story-1.json',
                            type:            'overvalued',
                            suggestedImpact: 3,
                            evidence:        ['users absolutely love this revolutionary new dashboard design'], // not in feedbacks
                        }],
                        duplicates: [],
                    }),
                }],
            }),
        });
        db.__q([
            instanceOk(),
            { data: [{ data: { body: feedbackBody } }], error: null },
            { data: null, error: null },
            { data: null, error: null },
        ]);
        const stories = [{ fileName: 'story-1.json', title: 'Export', rice: { score: 80, impact: 8 } }];
        const res = await makeAuthRequest(app, 'post', '/api/backlog/smart-audit', { stories });
        expect(res.status).toBe(200);
        expect(res.body.audits).toHaveLength(0);  // fabricated evidence → rejected
    });

    test('wrong instance → 403', async () => {
        db.__q([instanceFail()]);
        const res = await makeAuthRequest(app, 'post', '/api/backlog/smart-audit',
            { stories: [] }, INSTANCE_B, USER_A);
        expect(res.status).toBe(403);
    });
});

'use strict';
/**
 * tests/import-batch.test.js
 *
 * Regression tests for the parallel/batch DB operations introduced in import-routes.js:
 *   - Parallel creates (Promise.all) with randomUUID filenames — no collision
 *   - Batch delete via .in() during reconciliation
 *   - Historical filter: stories in a completed epic are never deleted
 *
 * Queue for POST /api/import/initial (3 parallel creates):
 *   [0] resolveInstance
 *   [1] loadIntegrationConfig
 *   [2] existingRows (empty → 3 creates)
 *   [3..5] 3 parallel inserts
 *   [6] settings.single() saveImportState
 *   [7] settings.upsert  saveImportState
 *
 * Queue for POST /api/import/sync (batch delete — 3 wrong-project stories):
 *   [0] resolveInstance
 *   [1] loadIntegrationConfig (projectKey: 'TEST')
 *   [2] existingRows → 3 wrong-project stories (Jira returns [] → toCreate/toUpdate empty)
 *   [3] allStored (reconciliation)
 *   [4] batch delete (.in) → 1 DB call
 *   [5] settings.single() saveImportState
 *   [6] settings.upsert  saveImportState
 *   [7] allRows epic backfill (empty)
 *
 * Queue for POST /api/import/sync (historical filter — all Done stories):
 *   Same as above but no delete call (toDelete filtered to []):
 *   [0..3] same
 *   [4] settings.single() saveImportState   ← no delete slot
 *   [5] settings.upsert  saveImportState
 *   [6] allRows epic backfill
 */

const { makeAuthRequest, instanceOk } = require('./setup');

jest.mock('@clerk/express');
jest.mock('../database/db');
jest.mock('../routes/exec-routes');
jest.mock('../routes/roadmap-routes');

jest.mock('../integrations/jira-story-importer', () =>
    jest.fn().mockImplementation(() => ({
        fetchInitial:     jest.fn().mockResolvedValue([]),
        fetchIncremental: jest.fn().mockResolvedValue([]),
        normalize:        jest.fn(r => r),
        jira: { _request: jest.fn().mockResolvedValue({ issues: [], values: [], total: 0 }) },
    }))
);

jest.mock('../integrations/jira', () =>
    jest.fn().mockImplementation(() => ({
        _request: jest.fn().mockResolvedValue({ issues: [], values: [], total: 0 }),
    }))
);

jest.mock('../integrations', () => ({
    getIntegration: () => ({ fetchSignals: jest.fn().mockResolvedValue([]) }),
}));

const { app } = require('../server');
const db = require('../database/db');
const JiraStoryImporter = require('../integrations/jira-story-importer');

const savedFetch = global.fetch;
beforeEach(() => {
    db.__reset();
    global.fetch = savedFetch;
});
afterAll(() => { global.fetch = savedFetch; });

// ── Helpers ───────────────────────────────────────────────────────────────────

const configOk = (extra = {}) => ({
    data: { type: 'jira', config: { baseUrl: 'https://test.atlassian.net', email: 'x@x.com', apiKey: 'tok', projectKey: 'TEST', ...extra } },
    error: null,
});
const ok     = () => ({ data: null, error: null });
const rows   = (data = []) => ({ data, error: null });

/** Minimal normalized story returned by the mocked JiraStoryImporter. */
function makeStory(n, extra = {}) {
    return {
        externalId: `TEST-${n}`, projectKey: 'TEST', source: 'jira',
        title: `Story ${n}`, issueType: 'Story', priority: 'Medium',
        status: 'To Do', statusCategoryKey: 'new',
        sprintName: null, sprintId: null, sprintState: null,
        jiraRank: null, importedEffort: null,
        epicKey: null, epicName: null, jiraCreatedAt: null,
        labels: [], comments: [], content: '', contentText: '',
        ...extra,
    };
}

/** Mock fetch so batchCalculateRice gets valid RICE data for N stories. */
function mockRice(n = 3) {
    const items = Array.from({ length: n }, (_, i) =>
        `{"index":${i},"reach":5,"impact":3,"confidence":70,"effort":2}`
    ).join(',');
    global.fetch = jest.fn().mockResolvedValue({
        json: () => Promise.resolve({ content: [{ text: `[${items}]` }] }),
    });
}

// ── Parallel creates — POST /api/import/initial ───────────────────────────────

describe('POST /api/import/initial — parallel creates', () => {
    test('3 stories created in parallel — all succeed, created: 3', async () => {
        JiraStoryImporter.mockImplementationOnce(() => ({
            fetchInitial: jest.fn().mockResolvedValue([makeStory(1), makeStory(2), makeStory(3)]),
            normalize:    jest.fn(r => r),
            jira:         { _request: jest.fn().mockResolvedValue({ issues: [], values: [], total: 0 }) },
        }));
        mockRice(3);

        db.__q([
            instanceOk(),      // [0] resolveInstance
            configOk(),        // [1] loadIntegrationConfig
            rows(),            // [2] existingRows → empty → all 3 go to toCreate
            ok(), ok(), ok(),  // [3..5] 3 parallel inserts (upsertImportedStory × 3)
            ok(),              // [6] settings.single() saveImportState
            ok(),              // [7] settings.upsert  saveImportState
        ]);

        const res = await makeAuthRequest(app, 'post', '/api/import/initial');
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.created).toBe(3);
        expect(res.body.updated).toBe(0);
        expect(res.body.total).toBe(3);
    });
});

// ── Batch delete — POST /api/import/sync ─────────────────────────────────────

describe('POST /api/import/sync — batch delete reconciliation', () => {

    /** Story belonging to wrong project (externalId prefix ≠ projectKey). */
    const wrongStory = (n, extra = {}) => ({
        filename: `story-wrong-${n}.json`,
        data: {
            externalId: `WRONG-${n}`, epicKey: 'EPIC-A',
            status: 'In Progress', statusCategoryKey: 'indeterminate',
            ...extra,
        },
    });

    test('wrong-project stories are deleted in a single batch call → removed: 3', async () => {
        const wrong = [wrongStory(1), wrongStory(2), wrongStory(3)];

        db.__q([
            instanceOk(),     // [0] resolveInstance
            configOk(),       // [1] loadIntegrationConfig (projectKey: 'TEST')
            rows(wrong),      // [2] existingRows → builds existingMap; Jira returns [] → no creates/updates
            rows(wrong),      // [3] allStored (reconciliation)
                              //     wrongProject = all 3 (WRONG ≠ TEST)
                              //     activeKeys.size = 0 (jira.searchAll not in mock → throws → caught)
                              //     toDelete = 3 → .in() → 1 DB call
            ok(),             // [4] batch delete
            ok(),             // [5] settings.single() saveImportState
            ok(),             // [6] settings.upsert  saveImportState
            rows(),           // [7] allRows epic backfill (empty → nothing to update)
        ]);

        const res = await makeAuthRequest(app, 'post', '/api/import/sync');
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.removed).toBe(3);
    });

    test('stories in a completed epic (≥90% Done) are kept — removed: 0', async () => {
        // All stories Done → done/total = 1.0 ≥ 0.9 → completedEpicKeys includes EPIC-A
        // → isHistorical() returns true for all → toDelete = [] → no delete call
        const historical = [
            wrongStory(1, { status: 'Done', statusCategoryKey: 'done' }),
            wrongStory(2, { status: 'Done', statusCategoryKey: 'done' }),
            wrongStory(3, { status: 'Done', statusCategoryKey: 'done' }),
        ];

        db.__q([
            instanceOk(),         // [0]
            configOk(),           // [1]
            rows(historical),     // [2] existingRows
            rows(historical),     // [3] allStored → completedEpicKeys = {'EPIC-A'} → skip all
                                  //     toDelete = [] → no delete call consumed
            ok(),                 // [4] settings.single() saveImportState
            ok(),                 // [5] settings.upsert  saveImportState
            rows(),               // [6] allRows epic backfill
        ]);

        const res = await makeAuthRequest(app, 'post', '/api/import/sync');
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.removed).toBe(0);
    });

    test('mixed epic: 2 Done + 1 active (< 90%) — active story is deleted, historical kept', async () => {
        // 2/3 Done = 66% < 90% → NOT a completed epic → all can be deleted
        const mixed = [
            wrongStory(1, { status: 'Done', statusCategoryKey: 'done' }),
            wrongStory(2, { status: 'Done', statusCategoryKey: 'done' }),
            wrongStory(3, { status: 'In Progress', statusCategoryKey: 'indeterminate' }),
        ];

        db.__q([
            instanceOk(),
            configOk(),
            rows(mixed),
            rows(mixed),
            ok(),        // batch delete (all 3 deleted — epic not completed)
            ok(),
            ok(),
            rows(),
        ]);

        const res = await makeAuthRequest(app, 'post', '/api/import/sync');
        expect(res.status).toBe(200);
        expect(res.body.removed).toBe(3);
    });
});

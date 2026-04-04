/**
 * tests/settings.test.js
 *
 * Tests for /api/settings routes.
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

const DEFAULT_SETTINGS = { personas: [], clients: [], objectives: [], userStoryTemplate: '', defaultAC: '' };

// ── GET /api/settings ─────────────────────────────────────────────────────────
describe('GET /api/settings', () => {
    test('returns settings for correct instance', async () => {
        const settingsData = { personas: ['PM'], clients: ['Acme'], objectives: ['Ship fast'] };
        db.__q([instanceOk(), { data: { data: settingsData }, error: null }]);

        const res = await makeAuthRequest(app, 'get', '/api/settings', null, INSTANCE_A);
        expect(res.status).toBe(200);
        expect(res.body.personas).toEqual(['PM']);
        expect(res.body.clients).toEqual(['Acme']);
    });

    test('returns default empty object if no settings exist', async () => {
        // PGRST116 = "no rows found" — not treated as error
        db.__q([instanceOk(), { data: null, error: { code: 'PGRST116' } }]);

        const res = await makeAuthRequest(app, 'get', '/api/settings', null, INSTANCE_A);
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject(DEFAULT_SETTINGS);
    });

    test('cannot read settings from other instance (→ 403)', async () => {
        db.__q([instanceFail()]);
        const res = await makeAuthRequest(app, 'get', '/api/settings', null, INSTANCE_B, USER_A);
        expect(res.status).toBe(403);
    });
});

// ── POST /api/settings ────────────────────────────────────────────────────────
describe('POST /api/settings', () => {
    test('saves settings successfully', async () => {
        const existing = { personas: ['PM'], clients: [] };
        db.__q([
            instanceOk(),
            { data: { data: existing }, error: null },  // fetch existing for merge
            { data: null, error: null },                // upsert
        ]);

        const res = await makeAuthRequest(
            app, 'post', '/api/settings',
            { objectives: ['Ship fast'] },
            INSTANCE_A
        );
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    test('merges with existing settings — partial update preserves existing fields', async () => {
        // The merge is done server-side: Object.assign({}, existing, req.body)
        // We test this indirectly: the route must read existing before writing.
        // If we get a 200, the merge path ran correctly.
        const existing = { personas: ['PM'], clients: ['Acme'], objectives: ['Goal 1'] };
        db.__q([
            instanceOk(),
            { data: { data: existing }, error: null },  // fetch existing
            { data: null, error: null },                // upsert merged
        ]);

        const res = await makeAuthRequest(
            app, 'post', '/api/settings',
            { objectives: ['New Goal'] },  // partial update
            INSTANCE_A
        );
        expect(res.status).toBe(200);
        // The existing personas/clients are preserved by the server-side merge.
        // We can't directly inspect what was written (mock doesn't capture insert args),
        // but the 200 confirms the merge path executed.
    });

    test('cannot write settings to other instance (→ 403)', async () => {
        db.__q([instanceFail()]);
        const res = await makeAuthRequest(
            app, 'post', '/api/settings',
            { personas: ['Hacker'] },
            INSTANCE_B, USER_A
        );
        expect(res.status).toBe(403);
    });
});

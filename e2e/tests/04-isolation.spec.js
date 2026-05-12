// e2e/tests/04-isolation.spec.js
// Flow 4 — Instance isolation: User A cannot read User B's data.
//
// Requires E2E_USER_B_EMAIL and E2E_USER_B_PASSWORD to be set.
// If not set, the test is skipped.
//
// What is tested:
//   1. User A creates a story in their instance
//   2. User B (different account) cannot read it via API — gets 403
//   3. User A cannot use User B's instance ID as X-Instance-Id — gets 403

const { test, expect } = require('@playwright/test');
const { apiRequest, getAuthHeaders } = require('../helpers/api');

const BASE_URL = process.env.E2E_BASE_URL || 'https://precede-automated-test.up.railway.app';
const USER_B_CONFIGURED = !!(process.env.E2E_USER_B_EMAIL && process.env.E2E_USER_B_PASSWORD);

test.describe('Flow 4 — Instance isolation', () => {
    test.skip(!USER_B_CONFIGURED, 'User B not configured — set E2E_USER_B_EMAIL and E2E_USER_B_PASSWORD');

    let pageA;
    let pageB;
    let instanceAId;
    let instanceBId;
    let createdFileName;

    test.beforeAll(async ({ browser }) => {
        // Open two separate browser contexts (different auth sessions)
        const contextA = await browser.newContext({ storageState: 'e2e/.auth/user-a.json' });
        const contextB = await browser.newContext({ storageState: 'e2e/.auth/user-b.json' });

        pageA = await contextA.newPage();
        pageB = await contextB.newPage();

        await pageA.goto(`${BASE_URL}/dashboard.html`);
        await pageB.goto(`${BASE_URL}/dashboard.html`);

        instanceAId = await pageA.evaluate(() => localStorage.getItem('precede_active_instance_id'));
        instanceBId = await pageB.evaluate(() => localStorage.getItem('precede_active_instance_id'));

        expect(instanceAId).toBeTruthy();
        expect(instanceBId).toBeTruthy();
        expect(instanceAId).not.toBe(instanceBId);
    });

    test.afterAll(async () => {
        // Clean up story created by User A
        if (createdFileName) {
            try {
                await apiRequest(pageA, 'DELETE', `/api/backlog/${createdFileName}`);
            } catch { /* non-fatal */ }
        }
        await pageA?.close();
        await pageB?.close();
    });

    test("User A can create a story in their own instance", async () => {
        const story = {
            title: `Isolation test story ${Date.now()}`,
            content: '<p>Isolation test</p>',
            status: 'To Do',
            rice: { reach: 1, impact: 1, confidence: 50, effort: 1, score: 50 },
        };

        const { status, body } = await apiRequest(pageA, 'POST', '/api/backlog', story);
        expect(status).toBe(200);
        expect(body.success).toBe(true);
        createdFileName = body.fileName;
    });

    test("User B cannot read User A's backlog (wrong instance → 403)", async () => {
        // User B tries to use User A's instance ID in their request
        const tokenB = await pageB.evaluate(async () => window.Clerk?.session?.getToken());

        const res = await fetch(`${BASE_URL}/api/backlog`, {
            headers: {
                Authorization: `Bearer ${tokenB}`,
                'X-Instance-Id': instanceAId,  // User A's instance
            },
        });

        // Must be 403 — User B does not own Instance A
        expect(res.status).toBe(403);
    });

    test("User A cannot write to User B's instance (→ 403)", async () => {
        const tokenA = await pageA.evaluate(async () => window.Clerk?.session?.getToken());

        const res = await fetch(`${BASE_URL}/api/backlog`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${tokenA}`,
                'X-Instance-Id': instanceBId,  // User B's instance
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ title: 'Injection attempt', status: 'To Do' }),
        });

        expect(res.status).toBe(403);
    });

    test("User B's intelligence entries are not visible to User A", async () => {
        const tokenA = await pageA.evaluate(async () => window.Clerk?.session?.getToken());

        const res = await fetch(`${BASE_URL}/api/intelligence-hub/entries`, {
            headers: {
                Authorization: `Bearer ${tokenA}`,
                'X-Instance-Id': instanceBId,
            },
        });

        expect(res.status).toBe(403);
    });
});

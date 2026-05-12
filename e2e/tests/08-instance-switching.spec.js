// e2e/tests/08-instance-switching.spec.js
// Flow 8 — Instance switching.
//
// Verifies that switching the active instance (via localStorage) causes the
// app to show data belonging to the new instance — not the previous one.
//
// Journey:
//   1. Start on instance A — create a story (API)
//   2. Create instance B — create a different story in B (API)
//   3. Switch active instance to B in the browser
//   4. Load backlog page — verify only B's story is present, not A's
//   5. Switch back to A — verify A's story is present again
//
// No Claude call.

const { test, expect } = require('@playwright/test');
const { apiRequest } = require('../helpers/api');

const BASE_URL = process.env.E2E_BASE_URL || 'https://precede-automated-test.up.railway.app';

test.use({ storageState: 'e2e/.auth/user-a.json' });

test.describe('Flow 8 — Instance switching', () => {
    let page;
    let instanceAId;
    let instanceBId;
    const storyATitle = `Instance-A-story-${Date.now()}`;
    const storyBTitle = `Instance-B-story-${Date.now()}`;
    let fileNameA;
    let fileNameB;

    test.beforeAll(async ({ browser }) => {
        page = await browser.newPage();
        await page.goto(`${BASE_URL}/dashboard.html`);
        await page.waitForFunction(() => !!localStorage.getItem('precede_active_instance_id'));

        instanceAId = await page.evaluate(() => localStorage.getItem('precede_active_instance_id'));
        expect(instanceAId).toBeTruthy();

        // Create story in instance A
        const resA = await apiRequest(page, 'POST', '/api/backlog', {
            title: storyATitle,
            content: '<p>Story in instance A</p>',
            status: 'To Do',
            rice: { reach: 1, impact: 1, confidence: 50, effort: 1, score: 50 },
        });
        expect(resA.status).toBe(200);
        fileNameA = resA.body.fileName;

        // Create instance B
        const resCreate = await apiRequest(page, 'POST', '/api/instances', {
            name: `E2E-Switch-B-${Date.now()}`,
            color: '#10b981',
        });
        expect(resCreate.status).toBe(200);
        instanceBId = resCreate.body.id;

        // Switch to B, create story there
        await page.evaluate((id) => localStorage.setItem('precede_active_instance_id', id), instanceBId);

        const resB = await apiRequest(page, 'POST', '/api/backlog', {
            title: storyBTitle,
            content: '<p>Story in instance B</p>',
            status: 'To Do',
            rice: { reach: 1, impact: 1, confidence: 50, effort: 1, score: 50 },
        });
        expect(resB.status).toBe(200);
        fileNameB = resB.body.fileName;

        // Switch back to A for clean state
        await page.evaluate((id) => localStorage.setItem('precede_active_instance_id', id), instanceAId);
    });

    test.afterAll(async () => {
        // Clean up instance A story
        if (fileNameA) {
            await page.evaluate((id) => localStorage.setItem('precede_active_instance_id', id), instanceAId);
            await apiRequest(page, 'DELETE', `/api/backlog/${fileNameA}`).catch(() => {});
        }

        // Clean up instance B (cascade deletes its story)
        if (instanceBId) {
            const { body: instances } = await apiRequest(page, 'GET', '/api/instances');
            if (Array.isArray(instances) && instances.length > 1) {
                const token = await page.evaluate(async () => window.Clerk?.session?.getToken());
                await fetch(`${BASE_URL}/api/instances/${instanceBId}`, {
                    method: 'DELETE',
                    headers: { Authorization: `Bearer ${token}` },
                }).catch(() => {});
            }
        }

        await page.close();
    });

    test('instance A backlog contains A story, not B story', async () => {
        await page.evaluate((id) => localStorage.setItem('precede_active_instance_id', id), instanceAId);

        const { status, body } = await apiRequest(page, 'GET', '/api/backlog');
        expect(status).toBe(200);

        const titles = body.map((s) => s.title ?? s.data?.title ?? '');
        expect(titles).toContain(storyATitle);
        expect(titles).not.toContain(storyBTitle);
    });

    test('instance B backlog contains B story, not A story', async () => {
        await page.evaluate((id) => localStorage.setItem('precede_active_instance_id', id), instanceBId);

        const { status, body } = await apiRequest(page, 'GET', '/api/backlog');
        expect(status).toBe(200);

        const titles = body.map((s) => s.title ?? s.data?.title ?? '');
        expect(titles).toContain(storyBTitle);
        expect(titles).not.toContain(storyATitle);
    });

    test('switching back to A restores A backlog', async () => {
        await page.evaluate((id) => localStorage.setItem('precede_active_instance_id', id), instanceAId);

        const { status, body } = await apiRequest(page, 'GET', '/api/backlog');
        expect(status).toBe(200);

        const titles = body.map((s) => s.title ?? s.data?.title ?? '');
        expect(titles).toContain(storyATitle);
    });

    test('UI reloads data after instance switch', async () => {
        // Switch to B and reload the backlog page
        await page.evaluate((id) => localStorage.setItem('precede_active_instance_id', id), instanceBId);
        await page.goto(`${BASE_URL}/Modules/Backlog/backlog-view.html`);
        await page.waitForLoadState('networkidle');

        // The page should not show a crash or 403 error
        const bodyText = await page.locator('body').textContent();
        expect(bodyText).not.toMatch(/403|Forbidden|Unauthorized/i);

        // Either shows stories or empty state — not a crash
        const hasContentOrEmpty =
            (await page.locator('.story-card, [data-story], tr, li').count()) > 0 ||
            (await page.locator('text=/empty|aucun|no stories/i').count()) > 0 ||
            (await page.locator('.placeholder-card, .empty-state').count()) > 0;
        expect(hasContentOrEmpty).toBe(true);
    });
});

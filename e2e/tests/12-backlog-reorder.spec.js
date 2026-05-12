// e2e/tests/12-backlog-reorder.spec.js
// Flow 12 — Backlog reorder persists.
//
// Verifies that POST /api/backlog/reorder writes display_order to the DB
// and that a subsequent GET returns stories in the new order.
//
// No Claude call.

const { test, expect } = require('@playwright/test');
const { apiRequest } = require('../helpers/api');

const BASE_URL = process.env.E2E_BASE_URL || 'https://precede-automated-test.up.railway.app';

test.use({ storageState: 'e2e/.auth/user-a.json' });

test.describe('Flow 12 — Backlog reorder persistence', () => {
    let page;
    const fileNames = [];

    test.beforeAll(async ({ browser }) => {
        page = await browser.newPage();
        await page.goto(`${BASE_URL}/dashboard.html`);

        // Seed 3 stories
        for (let i = 1; i <= 3; i++) {
            const { status, body } = await apiRequest(page, 'POST', '/api/backlog', {
                title: `E2E Reorder Story ${i} — ${Date.now()}`,
                content: `<p>Story ${i}</p>`,
                status: 'To Do',
                rice: { reach: i, impact: i, confidence: 50, effort: 1, score: i * 50 },
            });
            expect(status).toBe(200);
            fileNames.push(body.fileName);
        }
    });

    test.afterAll(async () => {
        for (const fileName of fileNames) {
            await apiRequest(page, 'DELETE', `/api/backlog/${fileName}`).catch(() => {});
        }
        await page.close();
    });

    test('POST /api/backlog/reorder returns 200 with success', async () => {
        expect(fileNames.length).toBe(3);

        // Reverse the order
        const reversed = [...fileNames].reverse();
        const { status, body } = await apiRequest(page, 'POST', '/api/backlog/reorder', {
            orderedFiles: reversed,
        });

        expect(status).toBe(200);
        expect(body.success).toBe(true);
    });

    test('GET /api/backlog returns stories in the new order', async () => {
        const reversed = [...fileNames].reverse();

        const { status, body } = await apiRequest(page, 'GET', '/api/backlog');
        expect(status).toBe(200);
        expect(Array.isArray(body)).toBe(true);

        // Extract only our test stories from the full backlog
        const ourStories = body.filter((s) => fileNames.includes(s.fileName));

        // They should exist
        expect(ourStories.length).toBe(fileNames.length);

        // Verify display_order reflects the reordered state
        // (stories are sorted by display_order in GET /api/backlog when jiraRank is null)
        const returnedFileNames = ourStories.map((s) => s.fileName);
        expect(returnedFileNames).toEqual(reversed);
    });

    test('POST /api/backlog/reorder returns 400 when orderedFiles is empty', async () => {
        const { status } = await apiRequest(page, 'POST', '/api/backlog/reorder', {
            orderedFiles: [],
        });
        expect(status).toBe(400);
    });

    test('POST /api/backlog/reorder returns 400 when orderedFiles is missing', async () => {
        const { status } = await apiRequest(page, 'POST', '/api/backlog/reorder', {});
        expect(status).toBe(400);
    });
});

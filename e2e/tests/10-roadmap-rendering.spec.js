// e2e/tests/10-roadmap-rendering.spec.js
// Flow 10 — Roadmap page rendering.
//
// Verifies:
//   - Page loads without JS crash
//   - Gantt area is present in the DOM
//   - Epics are displayed OR empty state is shown (no white screen)
//   - API endpoints return valid shapes
//
// No Claude call.

const { test, expect } = require('@playwright/test');
const { apiRequest } = require('../helpers/api');

const BASE_URL = process.env.E2E_BASE_URL || 'https://precede-automated-test.up.railway.app';

test.use({ storageState: 'e2e/.auth/user-a.json' });

test.describe('Flow 10 — Roadmap rendering', () => {
    test('roadmap.html loads without JS crash', async ({ page }) => {
        const consoleErrors = [];
        page.on('console', (msg) => {
            if (msg.type() === 'error') consoleErrors.push(msg.text());
        });
        page.on('pageerror', (err) => consoleErrors.push(`[pageerror] ${err.message}`));

        await page.goto(`${BASE_URL}/roadmap.html`);
        await page.waitForLoadState('networkidle');

        // Gantt container must exist
        await expect(page.locator('#gantt-rows')).toBeAttached({ timeout: 10_000 });

        const criticalErrors = consoleErrors.filter(
            (e) => !e.includes('favicon') && !e.includes('clerk') && !e.includes('Clerk') && !e.includes('Failed to load resource')
        );
        expect(criticalErrors).toHaveLength(0);
    });

    test('roadmap page shows epics or empty state — not a blank page', async ({ page }) => {
        await page.goto(`${BASE_URL}/roadmap.html`);
        await page.waitForLoadState('networkidle');

        // Either gantt rows rendered, or an empty/loading state message
        const ganttRows = await page.locator('#gantt-rows .gantt-row').count();
        const hasEmptyState =
            (await page.locator('text=/no epics|aucun epic|empty|chargement/i').count()) > 0 ||
            (await page.locator('.placeholder-card, .empty-state').count()) > 0;

        expect(ganttRows > 0 || hasEmptyState).toBe(true);
    });

    test('GET /api/roadmap/epics returns array', async ({ page }) => {
        await page.goto(`${BASE_URL}/dashboard.html`);

        const { status, body } = await apiRequest(page, 'GET', '/api/roadmap/epics');
        expect(status).toBe(200);
        expect(Array.isArray(body)).toBe(true);
    });

    test('GET /api/roadmap/velocity returns valid shape', async ({ page }) => {
        await page.goto(`${BASE_URL}/dashboard.html`);

        const { status, body } = await apiRequest(page, 'GET', '/api/roadmap/velocity');
        expect(status).toBe(200);
        // velocity returns an object — may have lowConfidence flag when no sprints
        expect(typeof body).toBe('object');
        expect(body).not.toBeNull();
    });

    test('GET /api/roadmap/projection returns projections array', async ({ page }) => {
        await page.goto(`${BASE_URL}/dashboard.html`);

        const { status, body } = await apiRequest(page, 'GET', '/api/roadmap/projection');
        expect(status).toBe(200);
        expect(body).toHaveProperty('projections');
        expect(Array.isArray(body.projections)).toBe(true);
    });

    test('GET /api/roadmap/scenarios returns array', async ({ page }) => {
        await page.goto(`${BASE_URL}/dashboard.html`);

        const { status, body } = await apiRequest(page, 'GET', '/api/roadmap/scenarios');
        expect(status).toBe(200);
        expect(Array.isArray(body)).toBe(true);
    });
});

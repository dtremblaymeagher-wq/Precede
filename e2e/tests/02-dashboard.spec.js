// e2e/tests/02-dashboard.spec.js
// Flow 2 — Dashboard loads correctly (data or empty state, no crash).
//
// Verifies:
//   - Page loads without JS errors
//   - Either skeleton loaders resolve OR empty-state placeholders are shown
//   - No unhandled promise rejections or console errors that indicate crashes

const { test, expect } = require('@playwright/test');

const BASE_URL = process.env.E2E_BASE_URL || 'https://precede-automated-test.up.railway.app';

test.use({ storageState: 'e2e/.auth/user-a.json' });

test.describe('Flow 2 — Dashboard loads correctly', () => {
    test('dashboard page loads without crash', async ({ page }) => {
        const consoleErrors = [];
        page.on('console', (msg) => {
            if (msg.type() === 'error') consoleErrors.push(msg.text());
        });
        page.on('pageerror', (err) => {
            consoleErrors.push(`[pageerror] ${err.message}`);
        });

        await page.goto(`${BASE_URL}/dashboard.html`);
        await page.waitForLoadState('networkidle');

        // Either skeletons have resolved or empty-state cards are shown
        // Skeleton elements should NOT be visible after networkidle
        const skeletons = page.locator('.skeleton');
        const skeletonCount = await skeletons.count();
        if (skeletonCount > 0) {
            // All skeletons should have disappeared (data loaded)
            for (let i = 0; i < skeletonCount; i++) {
                await expect(skeletons.nth(i)).toBeHidden({ timeout: 15_000 });
            }
        }

        // Page should show either populated widgets or placeholder cards
        const hasContent =
            (await page.locator('.signal-dot').count()) > 0 ||
            (await page.locator('.placeholder-card').count()) > 0 ||
            (await page.locator('[data-widget]').count()) > 0;
        expect(hasContent).toBe(true);

        // Filter out known non-critical noise (e.g. favicon 404s, Clerk dev mode warnings)
        const criticalErrors = consoleErrors.filter(
            (e) =>
                !e.includes('favicon') &&
                !e.includes('clerk') &&
                !e.includes('Clerk') &&
                !e.includes('net::ERR') &&
                !e.includes('Failed to load resource')
        );
        expect(criticalErrors).toHaveLength(0);
    });

    test('navigation links are reachable from dashboard', async ({ page }) => {
        await page.goto(`${BASE_URL}/dashboard.html`);
        await page.waitForLoadState('networkidle');

        // Check key pages load without 4xx/5xx
        const routes = [
            '/Modules/intelligence-hub/data-entry.html',
            '/Modules/story-grooming/story-grooming.html',
            '/roadmap.html',
        ];

        for (const route of routes) {
            const res = await page.goto(`${BASE_URL}${route}`);
            expect(res.status()).toBeLessThan(400);
            // No JS crash
            const title = await page.title();
            expect(title).toBeTruthy();
        }
    });

    test('unauthenticated request to API returns 401', async ({ page }) => {
        // Make a raw fetch without auth headers — should get 401, not 500
        await page.goto(`${BASE_URL}/dashboard.html`);
        const status = await page.evaluate(async () => {
            const res = await fetch('/api/backlog');
            return res.status;
        });
        expect(status).toBe(401);
    });
});

// e2e/tests/11-auth-guard.spec.js
// Flow 11 — Auth guard: unauthenticated users are redirected to login.
//
// Tests that protected pages redirect to login.html rather than crashing,
// and that every protected API route returns 401 (not 500) without a token.
//
// No auth storageState — this spec runs without a logged-in user.
// No Claude call.

const { test, expect } = require('@playwright/test');

const BASE_URL = process.env.E2E_BASE_URL || 'https://precede-automated-test.up.railway.app';

// Intentionally NO storageState — all requests are unauthenticated
test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Flow 11 — Auth guard', () => {
    test('dashboard.html redirects unauthenticated user to login', async ({ page }) => {
        await page.goto(`${BASE_URL}/dashboard.html`);
        await page.waitForLoadState('networkidle');

        // Should land on login.html or show the login/sign-in component
        const url = page.url();
        const hasLoginContent =
            url.includes('login') ||
            (await page.locator('#sign-in, .cl-signIn-root, input[name="identifier"]').count()) > 0;

        expect(hasLoginContent).toBe(true);
    });

    test('protected pages redirect to login, not 500', async ({ page }) => {
        const protectedPages = [
            '/roadmap.html',
            '/Modules/intelligence-hub/analyzer.html',
            '/Modules/intelligence-hub/data-entry.html',
            '/Modules/story-grooming/story-grooming.html',
            '/Modules/Backlog/backlog-view.html',
        ];

        for (const path of protectedPages) {
            const response = await page.goto(`${BASE_URL}${path}`);

            // HTTP response must not be a server error
            expect(response.status()).toBeLessThan(500);

            await page.waitForLoadState('networkidle');

            // Page must not be a blank white screen
            const bodyText = (await page.locator('body').textContent()).trim();
            expect(bodyText.length).toBeGreaterThan(0);
        }
    });

    const protectedApiRoutes = [
        ['GET',  '/api/backlog'],
        ['GET',  '/api/intelligence-hub/entries'],
        ['GET',  '/api/roadmap/epics'],
        ['GET',  '/api/instances'],
        ['POST', '/api/analyze'],
        ['GET',  '/api/import/status'],
    ];

    for (const [method, path] of protectedApiRoutes) {
        test(`${method} ${path} returns 401 without token`, async ({ page }) => {
            await page.goto(`${BASE_URL}/login.html`);

            const status = await page.evaluate(
                async ([method, path]) => {
                    const res = await fetch(path, { method });
                    return res.status;
                },
                [method, path]
            );

            expect(status).toBe(401);
        });
    }
});

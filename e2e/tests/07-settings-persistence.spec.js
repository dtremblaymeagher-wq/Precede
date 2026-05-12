// e2e/tests/07-settings-persistence.spec.js
// Flow 7 — Settings persistence.
//
// Verifies that vision and OKRs saved in /Modules/settings/settings.html
// survive a page reload and are still present via API.
//
// No Claude call.

const { test, expect } = require('@playwright/test');
const { apiRequest } = require('../helpers/api');

const BASE_URL = process.env.E2E_BASE_URL || 'https://precede-automated-test.up.railway.app';

test.use({ storageState: 'e2e/.auth/user-a.json' });

test.describe('Flow 7 — Settings persistence', () => {
    let page;
    let originalVision;
    let originalObjectives;

    const testVision = `E2E vision ${Date.now()}: Become the default PM tool for agile teams.`;
    const testOKRs = `E2E OKR ${Date.now()}: Increase activation by 20% in Q3.`;

    test.beforeAll(async ({ browser }) => {
        page = await browser.newPage();
        await page.goto(`${BASE_URL}/dashboard.html`);

        // Snapshot current values so we can restore them after the test
        const { body } = await apiRequest(page, 'GET', '/api/settings');
        originalVision = body?.vision ?? '';
        originalObjectives = body?.objectives ?? '';
    });

    test.afterAll(async () => {
        // Restore original values
        try {
            await apiRequest(page, 'POST', '/api/settings', {
                vision: originalVision,
                objectives: originalObjectives,
            });
        } catch { /* non-fatal */ }
        await page.close();
    });

    test('saves vision and OKRs in settings UI', async () => {
        await page.goto(`${BASE_URL}/Modules/settings/settings.html`);
        await page.waitForLoadState('networkidle');

        // Fill vision
        const visionField = page.locator('#vision');
        await expect(visionField).toBeVisible();
        await visionField.fill(testVision);

        // Fill OKRs
        const objectivesField = page.locator('#objectives');
        await expect(objectivesField).toBeVisible();
        await objectivesField.fill(testOKRs);

        // Save
        await page.locator('#save').click();

        // Wait for success confirmation
        const statusEl = page.locator('#status');
        await expect(statusEl).toContainText(/saved|enregistré|success/i, { timeout: 10_000 });
    });

    test('values persist after page reload', async () => {
        await page.reload();
        await page.waitForLoadState('networkidle');

        const visionValue = await page.locator('#vision').inputValue();
        expect(visionValue).toBe(testVision);

        const objectivesValue = await page.locator('#objectives').inputValue();
        expect(objectivesValue).toBe(testOKRs);
    });

    test('saved values are accessible via GET /api/settings', async () => {
        const { status, body } = await apiRequest(page, 'GET', '/api/settings');
        expect(status).toBe(200);
        expect(body.vision).toBe(testVision);
        expect(body.objectives).toBe(testOKRs);
    });

    test('settings are instance-scoped — different instance returns different values', async () => {
        // Create a second instance and verify settings are not shared
        const { status: createStatus, body: created } = await apiRequest(page, 'POST', '/api/instances', {
            name: `E2E-Settings-Isolation-${Date.now()}`,
            color: '#ff6600',
        });
        expect(createStatus).toBe(200);
        const otherInstanceId = created.id;

        try {
            // Fetch settings for the other instance directly
            const token = await page.evaluate(async () => window.Clerk?.session?.getToken());
            const res = await fetch(`${BASE_URL}/api/settings`, {
                headers: {
                    Authorization: `Bearer ${token}`,
                    'X-Instance-Id': otherInstanceId,
                },
            });
            const body = await res.json();

            // The new instance should NOT have the vision we just saved in the original instance
            expect(body.vision ?? '').not.toBe(testVision);
        } finally {
            // Clean up the extra instance (best-effort)
            const token = await page.evaluate(async () => window.Clerk?.session?.getToken());
            await fetch(`${BASE_URL}/api/instances/${otherInstanceId}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${token}` },
            }).catch(() => {});
        }
    });
});

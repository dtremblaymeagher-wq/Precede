// e2e/tests/01-onboarding.spec.js
// Flow 1 — Onboarding a new instance.
//
// Journey:
//   1. User logs in (storageState from global-setup)
//   2. Creates a fresh instance via API
//   3. Navigates to onboarding wizard, completes all steps
//   4. Adds a signal in the Intelligence Hub
//   5. Verifies the signal appears in the entries list
//
// Claude is NOT called in this flow — all steps are pure UI/API.

const { test, expect } = require('@playwright/test');
const { apiRequest } = require('../helpers/api');

const BASE_URL = process.env.E2E_BASE_URL || 'https://precede-automated-test.up.railway.app';

test.use({ storageState: 'e2e/.auth/user-a.json' });

test.describe('Flow 1 — Onboarding new instance', () => {
    let instanceId;
    let page;

    test.beforeAll(async ({ browser }) => {
        page = await browser.newPage();
        await page.goto(`${BASE_URL}/dashboard.html`);

        // Create a dedicated test instance so we don't pollute the default workspace
        const { status, body } = await apiRequest(page, 'POST', '/api/instances', {
            name: `E2E-Onboarding-${Date.now()}`,
            color: '#6366f1',
        });
        expect(status).toBe(200);
        instanceId = body.id;

        // Switch the browser context to the new instance
        await page.evaluate((id) => {
            localStorage.setItem('precede_active_instance_id', id);
        }, instanceId);
    });

    test.afterAll(async () => {
        // Clean up — delete the test instance (best-effort)
        try {
            // Get a fresh token from the page context
            const instances = await apiRequest(page, 'GET', '/api/instances');
            // Only delete if we're not the last instance
            if (instances.body?.length > 1 && instanceId) {
                await fetch(`${BASE_URL}/api/instances/${instanceId}`, {
                    method: 'DELETE',
                    headers: {
                        Authorization: `Bearer ${await page.evaluate(async () => window.Clerk?.session?.getToken())}`,
                    },
                });
            }
        } catch { /* non-fatal */ }
        await page.close();
    });

    test('onboarding wizard completes all 4 steps', async () => {
        await page.goto(`${BASE_URL}/onboarding.html`);
        await page.waitForLoadState('networkidle');

        // Step 1 — Vision
        const visionInput = page.locator('#visionText');
        await expect(visionInput).toBeVisible();
        await visionInput.fill('Build the best PM tool in the world');
        await page.locator('button:has-text("Next"), button:has-text("Suivant")').first().click();

        // Step 2 — Personas & OKRs
        const personaInput = page.locator('#personaInput');
        await expect(personaInput).toBeVisible({ timeout: 5000 });
        await personaInput.fill('Product Manager');
        const okrInput = page.locator('#okrInput');
        await okrInput.fill('Increase user activation by 20%');
        await page.locator('button:has-text("Next"), button:has-text("Suivant")').first().click();

        // Step 3 — Sprint settings
        const sprintDuration = page.locator('#sprintDuration');
        await expect(sprintDuration).toBeVisible({ timeout: 5000 });
        await sprintDuration.selectOption('2');
        const sprintStartDate = page.locator('#sprintStartDate');
        await sprintStartDate.fill('2026-06-01');
        await page.locator('button:has-text("Next"), button:has-text("Suivant"), button:has-text("Skip"), button:has-text("Passer")').first().click();

        // Step 4 — Jira (optional — skip)
        const skipBtn = page.locator('button:has-text("Skip"), button:has-text("Passer"), button:has-text("Finish"), button:has-text("Terminer")');
        await expect(skipBtn.first()).toBeVisible({ timeout: 5000 });
        await skipBtn.first().click();

        // Should redirect to dashboard after completing onboarding
        await page.waitForURL(/dashboard\.html/, { timeout: 15_000 });
        await expect(page).toHaveURL(/dashboard\.html/);
    });

    test('signal added in Intelligence Hub appears in entries list', async () => {
        // Navigate to data entry
        await page.goto(`${BASE_URL}/Modules/intelligence-hub/data-entry.html`);
        await page.waitForLoadState('networkidle');

        const signalBody = `E2E test signal ${Date.now()}`;

        // Fill the form
        await page.locator('#body').fill(signalBody);

        // Person (select) — pick first available option
        const personSelect = page.locator('#person');
        await expect(personSelect).toBeVisible();
        const options = await personSelect.locator('option').all();
        if (options.length > 1) {
            await personSelect.selectOption({ index: 1 });
        }

        // Source type
        const sourceType = page.locator('#sourceType');
        if (await sourceType.isVisible()) {
            await sourceType.selectOption({ index: 1 });
        }

        // Date
        await page.locator('#date').fill('2026-05-12');

        // Save
        await page.locator('#saveEntry').click();

        // Wait for success status
        const status = page.locator('#status');
        await expect(status).toContainText(/success|ajouté|saved|enregistré/i, { timeout: 10_000 });

        // Navigate to entries list (analyzer) and verify the signal appears
        // The entries are visible on the data-entry page itself in a list, or via API
        const { status: apiStatus, body } = await apiRequest(page, 'GET', '/api/intelligence-hub/entries');
        expect(apiStatus).toBe(200);
        expect(Array.isArray(body)).toBe(true);
        const found = body.some((e) => e.body === signalBody);
        expect(found).toBe(true);
    });
});

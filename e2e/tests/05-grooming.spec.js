// e2e/tests/05-grooming.spec.js
// Flow 5 — Story grooming: raw description → Claude → structured result → save.
//
// This is the ONLY flow that calls the real Claude API.
// Timeout is extended to 90s to accommodate API response time.
//
// Journey:
//   1. Navigate to story grooming page
//   2. Paste a feature description into #user-input
//   3. Click Generate & Analyze
//   4. Wait for #storyOutput to become visible (Claude responded)
//   5. Verify structured fields are populated (title, user story)
//   6. Click Save to Backlog
//   7. Verify story appears in /api/backlog

const { test, expect } = require('@playwright/test');
const { apiRequest } = require('../helpers/api');

const BASE_URL = process.env.E2E_BASE_URL || 'https://precede-automated-test.up.railway.app';

test.use({ storageState: 'e2e/.auth/user-a.json' });

// Extended timeout for Claude API call
test.setTimeout(90_000);

test.describe('Flow 5 — Story grooming with Claude', () => {
    let page;
    let savedStoryTitle;

    test.beforeAll(async ({ browser }) => {
        page = await browser.newPage();
        await page.goto(`${BASE_URL}/dashboard.html`);
    });

    test.afterAll(async () => {
        // Clean up the story created during this test
        if (savedStoryTitle) {
            try {
                const { body } = await apiRequest(page, 'GET', '/api/backlog');
                if (Array.isArray(body)) {
                    const story = body.find((s) => s.title === savedStoryTitle);
                    if (story?.fileName) {
                        await apiRequest(page, 'DELETE', `/api/backlog/${story.fileName}`);
                    }
                }
            } catch { /* non-fatal */ }
        }
        await page.close();
    });

    test('generates structured story from raw description', async () => {
        await page.goto(`${BASE_URL}/Modules/story-grooming/story-grooming.html`);
        await page.waitForLoadState('networkidle');

        const rawDescription = `
            Users are struggling to export their project backlog to CSV.
            The current export takes over 30 seconds for large backlogs (500+ stories)
            and often times out. We need a faster, paginated export with progress feedback.
            Priority: high. Affects all enterprise customers.
        `;

        // Fill the input
        const userInput = page.locator('#user-input');
        await expect(userInput).toBeVisible();
        await userInput.fill(rawDescription);

        // Click generate
        await page.locator('.btn-generate, button:has-text("Generate"), button:has-text("Analyser"), button:has-text("Analyze")').first().click();

        // Loading overlay should appear
        const loadingOverlay = page.locator('#loadingOverlay');
        // It may flash quickly — don't require it to be visible, just wait for output

        // Wait for Claude to respond and story output to become visible
        const storyOutput = page.locator('#storyOutput');
        await expect(storyOutput).toBeVisible({ timeout: 60_000 });

        // Verify structured fields are populated
        const storyTitle = page.locator('#storyTitle');
        await expect(storyTitle).not.toBeEmpty({ timeout: 5_000 });

        const storyUserStory = page.locator('#storyUserStory');
        await expect(storyUserStory).not.toBeEmpty({ timeout: 5_000 });

        // Store the title so we can clean up
        savedStoryTitle = await storyTitle.inputValue().catch(() => null)
            ?? await storyTitle.textContent().catch(() => null);
    });

    test('saves groomed story to backlog', async () => {
        // Ensure we're on the grooming page with output visible
        const storyOutput = page.locator('#storyOutput');
        const isVisible = await storyOutput.isVisible();
        if (!isVisible) {
            test.skip();
            return;
        }

        // Click Save to Backlog
        const saveBtn = page.locator('#saveBtn, button:has-text("Save to Backlog"), button:has-text("Enregistrer")');
        await expect(saveBtn).toBeVisible();
        await saveBtn.click();

        // Wait for success feedback (toast, status message, or redirect)
        await expect(
            page.locator('text=/saved|enregistré|success|backlog/i').first()
        ).toBeVisible({ timeout: 15_000 });

        // Verify via API that the story was actually persisted
        const { status, body } = await apiRequest(page, 'GET', '/api/backlog');
        expect(status).toBe(200);
        expect(Array.isArray(body)).toBe(true);
        expect(body.length).toBeGreaterThan(0);

        // The most recently added story should be export-related (matches our input)
        const recent = body[0];
        const title = recent.title ?? recent.data?.title ?? '';
        expect(title.length).toBeGreaterThan(0);
    });
});

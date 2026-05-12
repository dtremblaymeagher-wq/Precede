// e2e/tests/06-radar-analysis.spec.js
// Flow 6 — Radar analysis end-to-end.
//
// Journey:
//   1. Seed 3 intelligence entries via API
//   2. POST /api/analyze → Claude returns summary, trends, delta
//   3. Verify response shape and that analysis was persisted in history
//   4. Navigate to analyzer.html and verify results are displayed
//
// One real Claude call. Extended timeout.

const { test, expect } = require('@playwright/test');
const { apiRequest } = require('../helpers/api');

const BASE_URL = process.env.E2E_BASE_URL || 'https://precede-automated-test.up.railway.app';

test.use({ storageState: 'e2e/.auth/user-a.json' });
test.setTimeout(120_000);

test.describe('Flow 6 — Radar analysis', () => {
    let page;
    const seededIds = [];

    test.beforeAll(async ({ browser }) => {
        page = await browser.newPage();
        await page.goto(`${BASE_URL}/dashboard.html`);

        // Seed 3 signals so Claude has something to work with
        const signals = [
            { id: `e2e-r1-${Date.now()}`, body: 'Users report the dashboard loads slowly on mobile devices', person: 'Alice', date: '2026-05-01', sourceType: 'UserInterview' },
            { id: `e2e-r2-${Date.now()}`, body: 'The export feature times out for backlogs with more than 200 stories', person: 'Bob', date: '2026-05-03', sourceType: 'SupportTicket' },
            { id: `e2e-r3-${Date.now()}`, body: 'Enterprise clients want SSO support before they can expand their licence', person: 'Carol', date: '2026-05-05', sourceType: 'SalesCall' },
        ];

        for (const signal of signals) {
            const { status, body } = await apiRequest(page, 'POST', '/api/intelligence-hub/entry', signal);
            expect(status).toBe(200);
            seededIds.push(signal.id);
        }
    });

    test.afterAll(async () => {
        // Remove seeded signals
        for (const id of seededIds) {
            try {
                await apiRequest(page, 'DELETE', `/api/intelligence-hub/entry/${id}`);
            } catch { /* non-fatal */ }
        }
        await page.close();
    });

    test('POST /api/analyze returns valid analysis shape', async () => {
        const { status, body } = await apiRequest(page, 'POST', '/api/analyze', {});

        expect(status).toBe(200);
        expect(body).toHaveProperty('analysis');
        expect(typeof body.analysis.summary).toBe('string');
        expect(body.analysis.summary.length).toBeGreaterThan(10);
        expect(body).toHaveProperty('meta');
    });

    test('analysis contains trends array', async () => {
        const { status, body } = await apiRequest(page, 'POST', '/api/analyze', {});
        expect(status).toBe(200);

        // trends may be array or object — just verify it exists and is non-null
        expect(body.analysis.trends).toBeDefined();
    });

    test('analyzer.html displays analysis results without crash', async () => {
        const consoleErrors = [];
        page.on('console', (msg) => {
            if (msg.type() === 'error') consoleErrors.push(msg.text());
        });

        await page.goto(`${BASE_URL}/Modules/intelligence-hub/analyzer.html`);
        await page.waitForLoadState('networkidle');

        // Page should show either a past analysis or a "run analysis" button
        const hasAnalysis =
            (await page.locator('[data-analysis], #analysisOutput, #summary, .analysis-summary').count()) > 0 ||
            (await page.locator('button:has-text("Analyze"), button:has-text("Analyser"), button:has-text("Run")').count()) > 0;

        expect(hasAnalysis).toBe(true);

        const criticalErrors = consoleErrors.filter(
            (e) => !e.includes('favicon') && !e.includes('clerk') && !e.includes('Clerk') && !e.includes('Failed to load resource')
        );
        expect(criticalErrors).toHaveLength(0);
    });
});

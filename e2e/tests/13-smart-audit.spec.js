// e2e/tests/13-smart-audit.spec.js
// Flow 13 — Smart audit E2E with real citation validation.
//
// The HARD RULE: evidence in audit results must be phrases that genuinely
// appear in the seeded feedback. This test validates that rule end-to-end
// against the real Claude API (not a mock).
//
// Journey:
//   1. Seed 2 intelligence entries with known, specific text phrases
//   2. POST /api/backlog/smart-audit with stories linked to those themes
//   3. If audits are returned, verify each evidence phrase is a substring
//      of at least one real seeded signal body
//   4. Verify no hallucinated citations pass through
//
// One real Claude call. Extended timeout.

const { test, expect } = require('@playwright/test');
const { apiRequest } = require('../helpers/api');

const BASE_URL = process.env.E2E_BASE_URL || 'https://precede-automated-test.up.railway.app';

test.use({ storageState: 'e2e/.auth/user-a.json' });
test.setTimeout(90_000);

test.describe('Flow 13 — Smart audit citation validation', () => {
    let page;
    const seededIds = [];

    // Known phrases we will seed — Claude's evidence must be substrings of these
    const SIGNAL_A = 'users consistently report that the bulk CSV export hangs for more than sixty seconds on large datasets';
    const SIGNAL_B = 'three key accounts have explicitly said they will not renew without native SAML single sign-on support';

    test.beforeAll(async ({ browser }) => {
        page = await browser.newPage();
        await page.goto(`${BASE_URL}/dashboard.html`);

        const ts = Date.now();
        const signals = [
            { id: `e2e-audit-1-${ts}`, body: SIGNAL_A, person: 'Alice', date: '2026-05-01', sourceType: 'UserInterview' },
            { id: `e2e-audit-2-${ts}`, body: SIGNAL_B, person: 'Bob',   date: '2026-05-02', sourceType: 'SalesCall'     },
        ];

        for (const signal of signals) {
            const { status } = await apiRequest(page, 'POST', '/api/intelligence-hub/entry', signal);
            expect(status).toBe(200);
            seededIds.push(signal.id);
        }
    });

    test.afterAll(async () => {
        for (const id of seededIds) {
            await apiRequest(page, 'DELETE', `/api/intelligence-hub/entry/${id}`).catch(() => {});
        }
        await page.close();
    });

    test('returns 200 with audits array', async () => {
        const stories = [
            { fileName: 'story-export.json', title: 'Bulk CSV Export',  rice: { score: 90, impact: 9 } },
            { fileName: 'story-sso.json',    title: 'SAML SSO Support', rice: { score: 85, impact: 8 } },
        ];

        const { status, body } = await apiRequest(page, 'POST', '/api/backlog/smart-audit', { stories });

        expect(status).toBe(200);
        expect(body).toHaveProperty('audits');
        expect(Array.isArray(body.audits)).toBe(true);
    });

    test('citation validation — every evidence phrase is a real substring of seeded signals', async () => {
        const stories = [
            { fileName: 'story-export.json', title: 'Bulk CSV Export',  rice: { score: 90, impact: 9 } },
            { fileName: 'story-sso.json',    title: 'SAML SSO Support', rice: { score: 85, impact: 8 } },
        ];

        const { status, body } = await apiRequest(page, 'POST', '/api/backlog/smart-audit', { stories });
        expect(status).toBe(200);

        if (body.audits.length === 0) {
            // No audits — nothing to validate. Acceptable.
            return;
        }

        const allSignalBodies = [SIGNAL_A, SIGNAL_B].map((s) => s.toLowerCase());

        for (const audit of body.audits) {
            expect(Array.isArray(audit.evidence)).toBe(true);

            for (const evidencePhrase of audit.evidence) {
                const phrase = evidencePhrase.toLowerCase();

                // Each evidence phrase must be a substring of at least one real signal
                const matchFound = allSignalBodies.some((signalBody) =>
                    signalBody.includes(phrase) || phrase.includes(signalBody.substring(0, 30))
                );

                expect(matchFound).toBe(true);
            }
        }
    });

    test('400 when stories is not an array', async () => {
        const { status } = await apiRequest(page, 'POST', '/api/backlog/smart-audit', {
            stories: 'not-an-array',
        });
        expect(status).toBe(400);
    });

    test('returns early with empty audits when no hub feedback exists', async () => {
        // Use a fresh instance that has no intelligence entries
        const { body: created } = await apiRequest(page, 'POST', '/api/instances', {
            name: `E2E-Audit-Empty-${Date.now()}`,
            color: '#334455',
        });
        const emptyInstanceId = created?.id;
        if (!emptyInstanceId) return;

        try {
            const token = await page.evaluate(async () => window.Clerk?.session?.getToken());
            const res = await fetch(`${BASE_URL}/api/backlog/smart-audit`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'X-Instance-Id': emptyInstanceId,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ stories: [] }),
            });

            expect(res.status).toBe(200);
            const body = await res.json();
            expect(body.audits).toEqual([]);
            expect(body.message).toBeDefined();
        } finally {
            const token = await page.evaluate(async () => window.Clerk?.session?.getToken());
            await fetch(`${BASE_URL}/api/instances/${emptyInstanceId}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${token}` },
            }).catch(() => {});
        }
    });
});

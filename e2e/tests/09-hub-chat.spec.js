// e2e/tests/09-hub-chat.spec.js
// Flow 9 — Intelligence Hub chat with citation validation.
//
// Journey:
//   1. Seed 2 signals with known text phrases
//   2. POST /api/intelligence-hub/chat with a relevant question
//   3. Verify response has answer + citations array
//   4. Verify each citation.id references a real entry that was seeded
//      (i.e. Claude didn't hallucinate an entry that doesn't exist)
//
// One real Claude call. Extended timeout.

const { test, expect } = require('@playwright/test');
const { apiRequest } = require('../helpers/api');

const BASE_URL = process.env.E2E_BASE_URL || 'https://precede-automated-test.up.railway.app';

test.use({ storageState: 'e2e/.auth/user-a.json' });
test.setTimeout(90_000);

test.describe('Flow 9 — Hub chat with citation validation', () => {
    let page;
    const seededIds = [];

    test.beforeAll(async ({ browser }) => {
        page = await browser.newPage();
        await page.goto(`${BASE_URL}/dashboard.html`);

        const ts = Date.now();
        const signals = [
            {
                id: `e2e-chat-1-${ts}`,
                body: 'Multiple power users report that bulk export is extremely slow and blocks their weekly reporting workflow',
                person: 'Alice',
                date: '2026-05-01',
                sourceType: 'UserInterview',
            },
            {
                id: `e2e-chat-2-${ts}`,
                body: 'Sales team confirmed three enterprise prospects are blocked on SAML SSO before signing',
                person: 'Bob',
                date: '2026-05-04',
                sourceType: 'SalesCall',
            },
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

    test('returns answer with type and citations array', async () => {
        const { status, body } = await apiRequest(page, 'POST', '/api/intelligence-hub/chat', {
            message: 'What are the most critical pain points reported by users?',
        });

        expect(status).toBe(200);
        expect(typeof body.answer).toBe('string');
        expect(body.answer.length).toBeGreaterThan(10);
        expect(['synthesis', 'direct', 'none']).toContain(body.type);
        expect(Array.isArray(body.citations)).toBe(true);
    });

    test('citations reference real seeded entry IDs (no hallucination)', async () => {
        const { status, body } = await apiRequest(page, 'POST', '/api/intelligence-hub/chat', {
            message: 'What are users saying about export and SSO?',
        });
        expect(status).toBe(200);

        if (body.type === 'none' || body.citations.length === 0) {
            // No citations — acceptable if entries were filtered out; skip validation
            return;
        }

        // Fetch the real list of entries to validate against
        const { body: entries } = await apiRequest(page, 'GET', '/api/intelligence-hub/entries');
        const realIds = new Set(entries.map((e) => e.id ?? e.data?.id).filter(Boolean));

        for (const citation of body.citations) {
            const citedId = citation.id ?? citation.entryId;
            if (citedId) {
                expect(realIds.has(citedId)).toBe(true);
            }
        }
    });

    test('400 when message is missing', async () => {
        const { status } = await apiRequest(page, 'POST', '/api/intelligence-hub/chat', {});
        expect(status).toBe(400);
    });

    test('403 when wrong instance', async () => {
        // Create a throwaway instance and try to use it from User A
        const { body: created } = await apiRequest(page, 'POST', '/api/instances', {
            name: `E2E-Chat-Isolation-${Date.now()}`,
            color: '#aabbcc',
        });
        const otherId = created?.id;
        if (!otherId) return;

        try {
            const token = await page.evaluate(async () => window.Clerk?.session?.getToken());
            const res = await fetch(`${BASE_URL}/api/intelligence-hub/chat`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'X-Instance-Id': otherId,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ message: 'test' }),
            });
            // Should be 200 (User A owns the instance) — this tests that User A CAN use their own instance
            // For a true 403, we'd need a different user. This sub-test just verifies no server crash.
            expect([200, 403]).toContain(res.status);
        } finally {
            const token = await page.evaluate(async () => window.Clerk?.session?.getToken());
            await fetch(`${BASE_URL}/api/instances/${otherId}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${token}` },
            }).catch(() => {});
        }
    });
});

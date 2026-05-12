// e2e/helpers/api.js
// Direct API helpers that bypass the browser UI.
// Uses the Clerk JWT and instance ID extracted from the live page context.

/**
 * Extract auth headers from an authenticated browser page.
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<{ Authorization: string, 'X-Instance-Id': string }>}
 */
async function getAuthHeaders(page) {
    const token = await page.evaluate(async () => {
        return window.Clerk?.session?.getToken?.() ?? null;
    });
    if (!token) throw new Error('Could not get Clerk JWT from page');

    const instanceId = await page.evaluate(() =>
        localStorage.getItem('precede_active_instance_id')
    );
    if (!instanceId) throw new Error('Could not get instance ID from localStorage');

    return {
        Authorization: `Bearer ${token}`,
        'X-Instance-Id': instanceId,
    };
}

/**
 * Make an authenticated API request from the Node.js test process.
 * @param {import('@playwright/test').Page} page  — source of auth credentials
 * @param {string} method
 * @param {string} path  — e.g. '/api/backlog'
 * @param {object|null} body
 * @returns {Promise<{ status: number, body: any }>}
 */
async function apiRequest(page, method, path, body = null) {
    const baseUrl = process.env.E2E_BASE_URL || 'https://precede-automated-test.up.railway.app';
    const headers = await getAuthHeaders(page);

    const res = await fetch(`${baseUrl}${path}`, {
        method: method.toUpperCase(),
        headers: {
            ...headers,
            'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
    });

    let responseBody;
    try {
        responseBody = await res.json();
    } catch {
        responseBody = null;
    }

    return { status: res.status, body: responseBody };
}

module.exports = { getAuthHeaders, apiRequest };

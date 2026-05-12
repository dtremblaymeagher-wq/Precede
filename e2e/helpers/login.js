// e2e/helpers/login.js
// Handles Clerk two-step email/password login and saves storageState.

const BASE_URL = process.env.E2E_BASE_URL || 'https://precede-automated-test.up.railway.app';

/**
 * Log in as a user and save browser storage state to disk.
 * @param {import('@playwright/test').Browser} browser
 * @param {{ email: string, password: string, storageStatePath: string }} opts
 */
async function loginAndSave(browser, { email, password, storageStatePath }) {
    if (!email || !password) {
        throw new Error(`E2E login: missing email or password for storageState ${storageStatePath}`);
    }

    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto(`${BASE_URL}/login.html`);

    // Wait for Clerk to mount the sign-in widget
    await page.waitForSelector('#sign-in input', { timeout: 20_000 });

    // Step 1 — email
    await page.fill('input[name="identifier"], input[id="identifier-field"]', email);
    await page.click('button[type="submit"], button:has-text("Continue")');

    // Step 2 — password
    await page.waitForSelector('input[type="password"]', { timeout: 10_000 });
    await page.fill('input[type="password"]', password);
    await page.click('button[type="submit"], button:has-text("Continue")');

    // Wait for redirect to dashboard (Clerk redirects after successful auth)
    await page.waitForURL(/dashboard\.html|\/$/,  { timeout: 30_000 });

    // Ensure the app has finished bootstrapping (instance loaded into localStorage)
    await page.waitForFunction(
        () => !!localStorage.getItem('precede_active_instance_id'),
        { timeout: 20_000 }
    );

    await context.storageState({ path: storageStatePath });
    await context.close();

    console.log(`[global-setup] Saved auth state for ${email} → ${storageStatePath}`);
}

module.exports = { loginAndSave };

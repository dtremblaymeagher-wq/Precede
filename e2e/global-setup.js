// e2e/global-setup.js
// Runs once before all tests.
// Logs in as USER_A (and optionally USER_B for isolation tests) and saves
// browser state to e2e/.auth/ so each spec can reuse it without re-logging.

const { chromium } = require('@playwright/test');
const { loginAndSave } = require('./helpers/login');

module.exports = async function globalSetup() {
    const browser = await chromium.launch();

    // USER_A — primary test user
    await loginAndSave(browser, {
        email: process.env.E2E_USER_A_EMAIL,
        password: process.env.E2E_USER_A_PASSWORD,
        storageStatePath: 'e2e/.auth/user-a.json',
    });

    // USER_B — used only in isolation test (flow 4)
    if (process.env.E2E_USER_B_EMAIL) {
        await loginAndSave(browser, {
            email: process.env.E2E_USER_B_EMAIL,
            password: process.env.E2E_USER_B_PASSWORD,
            storageStatePath: 'e2e/.auth/user-b.json',
        });
    }

    await browser.close();
};

// playwright.config.js
// E2E tests run exclusively against the staging environment.
// Do NOT run on every push — use `npm run test:e2e` manually or in a scheduled CI job.

const { defineConfig, devices } = require('@playwright/test');
require('dotenv').config({ path: '.env.e2e' });

const BASE_URL = process.env.E2E_BASE_URL || 'https://precede-automated-test.up.railway.app';

module.exports = defineConfig({
    testDir: './e2e/tests',
    globalSetup: './e2e/global-setup.js',

    // Run tests serially — staging DB is shared, parallel runs would corrupt state
    fullyParallel: false,
    workers: 1,

    // Retry once on CI to handle transient network issues
    retries: process.env.CI ? 1 : 0,

    timeout: 60_000,
    expect: { timeout: 10_000 },

    reporter: [['list'], ['html', { outputFolder: 'e2e/report', open: 'never' }]],

    use: {
        baseURL: BASE_URL,
        headless: true,
        screenshot: 'only-on-failure',
        video: 'retain-on-failure',
        trace: 'retain-on-failure',
        actionTimeout: 15_000,
        navigationTimeout: 30_000,
    },

    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
    ],
});

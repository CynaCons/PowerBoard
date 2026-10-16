import { defineConfig } from '@playwright/test';

/**
 * E2E against the built standalone file. No web server: the app is one
 * offline HTML file, so the specs open it over file://.
 */
export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  globalSetup: './tests/global-setup.ts',
  timeout: 30000,
  retries: 0,
  expect: { timeout: 10000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
});

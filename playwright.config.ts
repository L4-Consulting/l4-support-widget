import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright drives a REAL browser for the things jsdom cannot do (computed
 * style, shadow-DOM style isolation, focus trap across the shadow boundary).
 * For Task 0 this is wired with a single trivial smoke; the real isolation
 * suite lands with the Tailwind-in-shadow spike.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:4173',
  },
  webServer: {
    // Serve the repo root so demo/index.html can load ../dist/l4-support-widget.js.
    // Requires `npm run build` first (CI runs build before e2e).
    command: 'npx --yes http-server . -p 4173 -c-1 --silent',
    port: 4173,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});

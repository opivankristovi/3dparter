// Production-build checks (manifest, service worker, offline). Run: npm run build, then npx playwright test -c playwright.preview.config.ts
// The preview server is started here on port 4173; the main config and its dev webServer are untouched.
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e-preview',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:4173', browserName: 'chromium', viewport: { width: 1440, height: 900 }, serviceWorkers: 'allow', screenshot: 'only-on-failure' },
  webServer: {
    command: 'npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
})

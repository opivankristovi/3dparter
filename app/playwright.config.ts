import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: 0,
  workers: 2,
  reporter: [['list'], ['json', { outputFile: 'e2e-results.json' }]],
  use: {
    baseURL: 'http://localhost:5173',
    acceptDownloads: true,
    screenshot: 'only-on-failure',
    trace: 'off',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'chromium-desktop',
      use: { browserName: 'chromium', viewport: { width: 1440, height: 900 } },
      grepInvert: /@mobile/,
    },
    {
      name: 'chromium-mobile',
      use: { browserName: 'chromium', viewport: { width: 390, height: 844 } },
      grep: /@mobile/,
    },
  ],
})

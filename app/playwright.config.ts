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
    // Cross-browser runs (CROSS_BROWSER=1 npx playwright test --project=firefox-desktop --project=webkit-desktop).
    // Off by default so the everyday suite stays Chromium-only and fast.
    ...(process.env.CROSS_BROWSER
      ? [
          {
            name: 'firefox-desktop',
            use: {
              browserName: 'firefox' as const,
              viewport: { width: 1440, height: 900 },
              // CI machines have no GPU; headless Firefox only falls back to software WebGL (Mesa llvmpipe) when forced.
              launchOptions: { firefoxUserPrefs: { 'webgl.force-enabled': true, 'webgl.disabled': false } },
            },
            grepInvert: /@mobile/,
          },
          { name: 'webkit-desktop', use: { browserName: 'webkit' as const, viewport: { width: 1440, height: 900 } }, grepInvert: /@mobile/ },
          { name: 'webkit-mobile', use: { browserName: 'webkit' as const, viewport: { width: 390, height: 844 }, hasTouch: true }, grep: /@mobile/ },
        ]
      : []),
  ],
})

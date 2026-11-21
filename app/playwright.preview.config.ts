// Production-build checks (manifest, service worker, offline). Run: npm run build, then npx playwright test -c playwright.preview.config.ts
// The preview server is started here on port 4173; the main config and its dev webServer are untouched.
// Sub-path check (GitHub Pages): BASE_PATH=/3dparter/ npm run build, then BASE_PATH=/3dparter/ npx playwright test -c playwright.preview.config.ts
// The same BASE_PATH reaches `vite preview`, which then serves the build under that path. Unset means the root, as before.
import { defineConfig } from '@playwright/test'

const basePath = (() => {
  const v = (process.env.BASE_PATH ?? '').trim().replace(/^\/+|\/+$/g, '')
  return v ? `/${v}/` : '/'
})()

export default defineConfig({
  testDir: 'e2e-preview',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: `http://localhost:4173${basePath}`, browserName: 'chromium', viewport: { width: 1440, height: 900 }, serviceWorkers: 'allow', screenshot: 'only-on-failure' },
  webServer: {
    command: 'npx vite preview --port 4173 --strictPort',
    url: `http://localhost:4173${basePath}`,
    reuseExistingServer: true,
    timeout: 60_000,
  },
})

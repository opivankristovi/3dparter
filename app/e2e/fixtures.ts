import { expect, test as base } from '@playwright/test'

/**
 * Every test gets a fresh browser context (fresh IndexedDB, so the seed project exists on first load) and an
 * automatic guard (X-1): any console error, uncaught page error or HTTP 5xx anywhere in the context fails the test.
 */
export const test = base.extend<{ guard: void }>({
  guard: [
    async ({ context }, use) => {
      const problems: string[] = []
      context.on('console', (m) => {
        if (m.type() === 'error') problems.push(`console.error: ${m.text()} @ ${m.location().url}`)
      })
      context.on('weberror', (e) => problems.push(`pageerror: ${e.error().message}`))
      context.on('response', (r) => {
        if (r.status() >= 500) problems.push(`HTTP ${r.status()} ${r.url()}`)
      })
      await use()
      expect(problems, 'console errors / page errors / 5xx responses').toEqual([])
    },
    { auto: true },
  ],
})

export { expect }

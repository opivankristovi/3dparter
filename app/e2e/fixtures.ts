import { expect, test as base } from '@playwright/test'

/**
 * Every test gets a fresh browser context (fresh IndexedDB, so the seed project exists on first load) and an
 * automatic guard (X-1): any console error, uncaught page error or HTTP 5xx anywhere in the context fails the test.
 */
/**
 * Emscripten logs these when a page navigates away while a WebAssembly module is still streaming in (Firefox reports
 * the cancelled fetch as an AbortError). The module is no longer needed by then, so they are not app errors.
 */
const BENIGN = [/wasm streaming compile failed: AbortError/, /falling back to ArrayBuffer instantiation/]

export const test = base.extend<{ guard: void }>({
  guard: [
    async ({ context }, use) => {
      const problems: string[] = []
      context.on('console', (m) => {
        if (m.type() === 'error' && !BENIGN.some((re) => re.test(m.text()))) problems.push(`console.error: ${m.text()} @ ${m.location().url}`)
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

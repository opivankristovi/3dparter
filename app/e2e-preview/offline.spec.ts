// Runs against `vite preview` (the production build): manifest, icons, service worker, and the app working offline.
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

test('manifest is valid JSON and every icon loads', async ({ page, request }) => {
  await page.goto('/')
  const href = await page.locator('link[rel="manifest"]').getAttribute('href')
  expect(href).toBe('/manifest.webmanifest')
  const res = await request.get(href!)
  expect(res.ok()).toBe(true)
  const m = await res.json()
  expect(m.name).toBe('3DParter')
  expect(m.short_name).toBeTruthy()
  expect(m.start_url).toBe('/')
  expect(m.scope).toBe('/')
  expect(m.display).toBe('standalone')
  expect(m.icons.some((i: { purpose: string }) => i.purpose === 'maskable')).toBe(true)
  for (const icon of m.icons) {
    const r = await request.get(icon.src)
    expect(r.ok(), icon.src).toBe(true)
    expect(r.headers()['content-type']).toContain(icon.type.split('/')[0])
  }
  for (const link of ['/favicon-16.png', '/favicon-32.png', '/apple-touch-icon.png', '/social-card.png']) {
    expect((await request.get(link)).ok(), link).toBe(true)
  }
})

/** Rectangle tool, then click around the canvas centre until a point lands on the Top plane and a sketch opens. */
async function openTopSketch(page: Page) {
  await page.getByRole('toolbar', { name: 'Tools' }).getByRole('button', { name: 'Rectangle', exact: true }).click()
  const box = (await page.locator('canvas').first().boundingBox())!
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  const finish = page.getByRole('button', { name: 'Finish sketch' })
  for (let r = 40; r <= 260; r += 20) {
    for (const [dx, dy] of [[0, r * 0.5], [r, 0], [-r, 0], [0, -r * 0.5], [r, r * 0.4], [-r, r * 0.4], [r, -r * 0.4], [-r, -r * 0.4]]) {
      await page.mouse.click(cx + dx, cy + dy)
      if (await finish.isVisible()) return { cx, cy }
    }
  }
  throw new Error('no point picked the Top plane')
}

test('service worker takes control, then the app opens and models offline', async ({ page, context }) => {
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'New project' }).first()).toBeVisible()
  // Registered and active after the first visit...
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
  })
  // ...and controlling the page after a reload (clients.claim makes this immediate, the reload proves it).
  await page.reload()
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true)
  // Install precaches everything before 'ready' resolves; confirm the OpenCascade .wasm is in the cache.
  const cached = await page.evaluate(async () => {
    const names = (await caches.keys()).filter((k) => k.startsWith('3dparter-'))
    const keys = names.length ? (await (await caches.open(names[0])).keys()).map((r) => new URL(r.url).pathname) : []
    return { names, keys }
  })
  expect(cached.names).toHaveLength(1)
  expect(cached.keys.some((k) => k.endsWith('.wasm') && k.includes('replicad'))).toBe(true)
  expect(cached.keys.some((k) => k.endsWith('.woff2'))).toBe(true)
  expect(cached.keys).toContain('/index.html')

  await context.setOffline(true)
  await page.reload()
  await expect(page.getByRole('button', { name: 'New project' }).first()).toBeVisible()
  await expect(page.getByText('Sample').first()).toBeVisible()

  // A new project opens, the geometry engine (cached .wasm and worker) loads, and a box extrudes.
  await page.getByRole('button', { name: 'New project' }).first().click()
  await expect(page).toHaveURL(/#\/p\//)
  await expect(page.getByRole('toolbar', { name: 'Tools' })).toBeVisible()
  await page.waitForTimeout(3000) // engine boot
  const { cx, cy } = await openTopSketch(page)
  await page.waitForTimeout(1200) // camera turns to the sketch
  await page.mouse.click(cx - 60, cy - 30)
  await expect(page.getByRole('group', { name: 'Shape size' })).toBeVisible()
  await page.keyboard.type('40')
  await page.keyboard.press('Tab')
  await page.keyboard.type('20')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('group', { name: 'Shape size' })).toBeHidden()
  await page.waitForTimeout(500)
  await page.getByRole('button', { name: 'Finish sketch' }).click()
  await page.getByRole('toolbar', { name: 'Tools' }).getByRole('button', { name: 'Extrude', exact: true }).click()
  const card = page.getByRole('dialog', { name: 'Extrude', exact: true })
  await expect(card).toBeVisible()
  await card.getByRole('button', { name: 'Apply' }).click()
  await expect(card).toBeHidden()
  await expect(page.getByRole('tree', { name: 'History' }).getByRole('treeitem', { name: /Extrude 1/ })).toBeVisible()
})

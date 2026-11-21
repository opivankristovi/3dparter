// Store screenshots. Skipped in the normal suite; run with `npm run shots` (sets STORE_SHOTS=1).
// Writes real product screens to replica/launch/screenshots/<device>/NN-scene.png at the exact store pixel sizes
// (CSS viewport x deviceScaleFactor).
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { blendEdges, buildBox, clickWorld, doc, drawRectangle, extrudeCard, newProject, pickTopPlane, settle, sketches, toolButton, waitCameraStable } from './helpers'

test.skip(!process.env.STORE_SHOTS, 'store screenshots only run with STORE_SHOTS=1')

const OUT = join(import.meta.dirname, '..', '..', 'replica', 'launch', 'screenshots')

// Pixel size = viewport x scale.
const DEVICES = [
  { name: 'iphone-6.9', viewport: { width: 440, height: 956 }, scale: 3, px: '1320x2868' },
  { name: 'ipad-13', viewport: { width: 1032, height: 1376 }, scale: 2, px: '2064x2752' },
  { name: 'android-phone', viewport: { width: 360, height: 640 }, scale: 3, px: '1080x1920' },
  { name: 'desktop', viewport: { width: 1440, height: 900 }, scale: 1, px: '1440x900' },
]

type V = [number, number, number]

/** Binary STL of an n-sided prism (a round boss) with closed caps, for the mesh-import scene. */
function prismStl(r: number, h: number, n: number): Buffer {
  const tris: V[][] = []
  const ring = (z: number): V[] => Array.from({ length: n }, (_, i) => [r * Math.cos((2 * Math.PI * i) / n), r * Math.sin((2 * Math.PI * i) / n), z])
  const lo = ring(0)
  const hi = ring(h)
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    tris.push([lo[i], lo[j], hi[j]], [lo[i], hi[j], hi[i]])
    tris.push([[0, 0, 0], lo[j], lo[i]], [[0, 0, h], hi[i], hi[j]])
  }
  const buf = Buffer.alloc(84 + 50 * tris.length)
  buf.writeUInt32LE(tris.length, 80)
  tris.forEach((t, i) => t.forEach((v, k) => v.forEach((x, j) => buf.writeFloatLE(x, 84 + 50 * i + 12 + 12 * k + 4 * j))))
  return buf
}

/** Fit the model, let the camera and any regenerate finish, park the mouse away from the canvas. */
async function frame(page: Page) {
  // The view column is hidden on narrow screens; the F shortcut does the same.
  const fit = page.getByRole('button', { name: 'Zoom to fit', exact: true })
  if (await fit.isVisible()) await fit.click()
  else await page.keyboard.press('f')
  await waitCameraStable(page)
  await settle(page)
  await page.mouse.move(2, 2)
  await page.waitForTimeout(400)
}

async function regionNames(page: Page): Promise<string[]> {
  return page.evaluate(() => (window.__3dparter!.engine as unknown as { regions: { name: string }[] }).regions.map((r) => r.name))
}

const scenes: { file: string; run: (page: Page, resize: () => Promise<void>) => Promise<void> }[] = [
  {
    file: '01-sketch-constraints',
    async run(page, resize) {
      await newProject(page)
      await resize()
      // Narrow screens show less of the sketch plane, so draw it smaller there. (No zoom-to-fit while sketching.)
      const narrow = (page.viewportSize()?.width ?? 1440) < 600
      await drawRectangle(page, narrow ? '24' : '40', narrow ? '16' : '20')
      await expect(page.getByRole('status').filter({ hasText: 'Fully defined' })).toBeVisible()
      await waitCameraStable(page)
      await page.mouse.move(2, 2)
      await page.waitForTimeout(400)
    },
  },
  {
    file: '02-filleted-part',
    async run(page, resize) {
      await newProject(page)
      await buildBox(page)
      await blendEdges(page, 'Fillet', [[20, 0, 10], [20, 20, 10], [0, 10, 10], [40, 10, 10]], '3')
      await resize()
      await frame(page)
    },
  },
  {
    file: '03-text-on-curve',
    async run(page, resize) {
      await newProject(page)
      await toolButton(page, 'Circle').click()
      await pickTopPlane(page)
      await clickWorld(page, [0, 0, 0])
      await expect(page.getByRole('group', { name: 'Shape size' })).toBeVisible()
      await page.keyboard.type('80')
      await page.keyboard.press('Enter')
      await expect.poll(async () => sketches(await doc(page))[0].sketch.entities.length).toBe(1)
      await toolButton(page, 'Text').click()
      await clickWorld(page, [-5, -5, 0])
      const card = page.getByRole('dialog', { name: 'Text', exact: true })
      await expect(card).toBeVisible()
      await card.getByRole('textbox', { name: 'Text' }).fill('3DPARTER')
      await card.getByLabel('Size', { exact: true }).fill('8')
      await card.getByLabel('Size', { exact: true }).blur()
      await card.getByRole('button', { name: 'Pick a curve' }).click()
      await clickWorld(page, [40, 0, 0])
      await expect(card.getByRole('radiogroup', { name: 'Side of the curve' })).toBeVisible()
      // Run the text across the far side of the circle so it reads upright from the default camera.
      await card.getByLabel('Start', { exact: true }).fill('40')
      await card.getByLabel('Start', { exact: true }).blur()
      await card.getByRole('button', { name: 'Apply' }).click()
      await expect(card).toBeHidden()
      await page.getByRole('button', { name: 'Finish sketch' }).click()
      await toolButton(page, 'Extrude').click()
      await expect.poll(async () => (await regionNames(page)).filter((n) => n.includes('~')).length).toBeGreaterThan(0)
      const names = (await regionNames(page)).filter((n) => n.includes('~'))
      await page.evaluate((list) => window.__3dparter!.store.getState().setSelection(list.map((name) => ({ kind: 'sketchRegion' as const, name }))), names)
      const ex = extrudeCard(page)
      await expect(ex).toBeVisible()
      await ex.getByLabel('Distance').fill('4')
      await ex.getByLabel('Distance').blur()
      await settle(page)
      await ex.getByRole('button', { name: 'Apply' }).click()
      await expect(ex).toBeHidden()
      await resize()
      await frame(page)
    },
  },
  {
    file: '04-export-dialog',
    async run(page, resize) {
      await newProject(page)
      await buildBox(page)
      await blendEdges(page, 'Fillet', [[20, 0, 10], [20, 20, 10], [0, 10, 10], [40, 10, 10]], '3')
      await resize()
      await frame(page)
      await page.getByRole('button', { name: 'Export', exact: true }).click()
      await expect(page.getByRole('dialog', { name: 'Export' })).toBeVisible()
      await page.waitForTimeout(400)
    },
  },
  {
    file: '05-mesh-import',
    async run(page, resize) {
      await newProject(page)
      await page.getByRole('button', { name: 'Import', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: 'Import' })
      await expect(dialog).toBeVisible()
      await dialog.getByLabel('CAD file').setInputFiles({ name: 'boss.stl', mimeType: 'model/stl', buffer: prismStl(18, 12, 48) })
      await expect(dialog.getByText(/triangles/)).toBeVisible()
      await dialog.getByRole('button', { name: 'Import', exact: true }).click()
      await expect(dialog).toBeHidden()
      await expect.poll(() => page.evaluate(() => (window.__3dparter!.engine as unknown as { bodies: Map<string, unknown> }).bodies.size)).toBe(1)
      await resize()
      await frame(page)
    },
  },
]

for (const d of DEVICES) {
  test.describe(`${d.name} ${d.px}`, () => {
    // Scenes are built at desktop size (the helpers click exact 3D positions), then the window is resized to the device.
    test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: d.scale })
    for (const s of scenes) {
      test(s.file, async ({ page }) => {
        test.setTimeout(120_000)
        await s.run(page, async () => {
          await page.setViewportSize(d.viewport)
          await page.waitForTimeout(600)
        })
        // A fresh solid stays selected and brings up the suggested-actions bar; store shots read better without it.
        // (The Export dialog scene keeps its selection: the dialog's own choice depends on it.)
        if (s.file !== '04-export-dialog') {
          await page.evaluate(() => window.__3dparter!.store.getState().setSelection([]))
          await page.waitForTimeout(300)
        }
        mkdirSync(join(OUT, d.name), { recursive: true })
        await page.screenshot({ path: join(OUT, d.name, `${s.file}.png`) })
      })
    }
  })
}

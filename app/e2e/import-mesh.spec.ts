// STL import (S10): a mesh file becomes a solid you can fillet, survives a reload, and errors read plainly.
import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { blendEdges, bodyMeshes, bodyStats, doc, near, newProject, settle, waitCameraStable, waitReady } from './helpers'

type V = [number, number, number]

/** Binary STL of a box from the origin; `skip` drops that many triangles to make an open mesh. */
function boxStl(w: number, h: number, d: number, skip = 0): Buffer {
  const p: V[] = [
    [0, 0, 0], [w, 0, 0], [w, h, 0], [0, h, 0],
    [0, 0, d], [w, 0, d], [w, h, d], [0, h, d],
  ]
  const quads = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [2, 3, 7, 6], [1, 2, 6, 5], [3, 0, 4, 7]]
  const tris: V[][] = []
  for (const [a, b, c, e] of quads) tris.push([p[a], p[b], p[c]], [p[a], p[c], p[e]])
  const used = tris.slice(skip)
  const buf = Buffer.alloc(84 + 50 * used.length)
  buf.writeUInt32LE(used.length, 80)
  used.forEach((t, i) => {
    t.forEach((v, k) => v.forEach((x, j) => buf.writeFloatLE(x, 84 + 50 * i + 12 + 12 * k + 4 * j)))
  })
  return buf
}

async function expectNoA11yViolations(page: Page, name: string) {
  const results = await new AxeBuilder({ page }).exclude('canvas').analyze()
  const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical' || v.impact === 'moderate')
  expect(
    blocking.map((v) => `${v.id} (${v.impact})`),
    `axe violations on ${name}`,
  ).toEqual([])
}

async function openImport(page: Page) {
  await page.getByRole('button', { name: 'Import', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Import' })
  await expect(dialog).toBeVisible()
  return dialog
}

test.describe('Mesh import', () => {
  test('imports a cube STL as a solid, fillets an edge, and regenerates after a reload', async ({ page }) => {
    await newProject(page)
    const dialog = await openImport(page)
    await dialog.getByLabel('CAD file').setInputFiles({ name: 'cube.stl', mimeType: 'model/stl', buffer: boxStl(20, 20, 10) })
    await expect(dialog.getByText(/12 triangles/)).toBeVisible()
    await expectNoA11yViolations(page, 'Import dialog with a mesh')
    await dialog.getByRole('button', { name: 'Import', exact: true }).click()
    await expect(dialog).toBeHidden()

    await expect.poll(() => bodyMeshes(page)).toBe(1)
    await settle(page)
    await page.getByRole('button', { name: 'Zoom to fit', exact: true }).click()
    await waitCameraStable(page)

    const imp = (await doc(page)).features.find((f) => f.type === 'import')
    expect(imp?.type === 'import' && imp.params.format).toBe('stl')
    const before = await bodyStats(page)
    near(before[0].volume, 4000, 60)

    await blendEdges(page, 'Fillet', [[10, 0, 10]], '2')
    const after = await bodyStats(page)
    expect(after[0].volume).toBeLessThan(before[0].volume - 10)

    await page.waitForTimeout(600)
    await page.reload()
    await waitReady(page)
    await expect.poll(() => bodyMeshes(page)).toBe(1)
    await settle(page)
    const reloaded = await bodyStats(page)
    expect(reloaded[0].volume).toBeLessThan(before[0].volume - 10)
  })

  test('shows a plain message for a mesh with gaps and for the wrong file type', async ({ page }) => {
    await newProject(page)
    const dialog = await openImport(page)
    await dialog.getByLabel('CAD file').setInputFiles({ name: 'open.stl', mimeType: 'model/stl', buffer: boxStl(20, 20, 10, 1) })
    await expect(dialog.getByRole('alert')).toContainText('has gaps')
    await expect(dialog.getByRole('button', { name: 'Import', exact: true })).toBeDisabled()
    await expectNoA11yViolations(page, 'Import dialog with an error')

    await dialog.getByLabel('CAD file').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') })
    await expect(dialog.getByRole('alert')).toContainText('.stl')
    await expect(dialog.getByRole('button', { name: 'Import', exact: true })).toBeDisabled()
  })
})

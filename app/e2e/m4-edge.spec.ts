// M4 edge, negative, mobile, keyboard, and bug regression tests (F09, F10, S03 selection filters, S09, S11, S12).
import { readFileSync } from 'node:fs'
import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import {
  addRectangleSketch,
  applyExtrude,
  bodyMeshes,
  buildBox,
  clickPickableNear,
  clickWorld,
  doc,
  extrudeCard,
  hasHorizontalScroll,
  historyItem,
  newProject,
  pickTopPlane,
  pickTopPlaneAgain,
  settle,
  toolButton,
  waitCameraStable,
} from './helpers'

async function expectNoA11yViolations(page: Page, name: string) {
  const results = await new AxeBuilder({ page }).exclude('canvas').analyze()
  const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical' || v.impact === 'moderate')
  expect(
    blocking.map((v) => `${v.id} (${v.impact})`),
    `axe violations on ${name}`,
  ).toEqual([])
}

function readZipEntries(buffer: Buffer): Map<string, string> {
  const entries = new Map<string, string>()
  let pos = 0
  while (pos + 30 <= buffer.length && buffer.readUInt32LE(pos) === 0x04034b50) {
    const method = buffer.readUInt16LE(pos + 8)
    const size = buffer.readUInt32LE(pos + 18)
    const nameLen = buffer.readUInt16LE(pos + 26)
    const extraLen = buffer.readUInt16LE(pos + 28)
    const name = buffer.toString('utf8', pos + 30, pos + 30 + nameLen)
    const dataStart = pos + 30 + nameLen + extraLen
    if (method === 0) entries.set(name, buffer.toString('utf8', dataStart, dataStart + size))
    pos = dataStart + size
  }
  return entries
}

function parse3mfInfo(xml: string): { objects: number; triangles: number; names: string[] } {
  const objects = [...xml.matchAll(/<object\b/g)].length
  const names = [...xml.matchAll(/<object\b[^>]*\bname="([^"]+)"/g)].map((m) => m[1])
  const triangles = [...xml.matchAll(/<triangle\b/g)].length
  return { objects, triangles, names }
}

async function buildCylinder(page: Page, diameter = '20', at: [number, number, number] = [0, 0, 0], firstSketch = true) {
  await toolButton(page, 'Circle').click()
  if (firstSketch) await pickTopPlane(page)
  else await pickTopPlaneAgain(page)
  await clickWorld(page, at)
  await expect(page.getByRole('group', { name: 'Shape size' })).toBeVisible()
  await page.keyboard.type(diameter)
  await page.keyboard.press('Enter')
  await page.getByRole('button', { name: 'Finish sketch' }).click()
  await applyExtrude(page)
}

test.describe('M4 edge & negative cases', () => {
  test('F09-E1 Curved geometry (radius/diameter), unit conversion in Measure, and live history re-flow', async ({ page }) => {
    await newProject(page)
    await buildCylinder(page, '20', [0, 0, 0], true) // r = 10, h = 10
    await expect.poll(() => bodyMeshes(page)).toBe(1)
    await settle(page)
    await waitCameraStable(page)
    await page.keyboard.press('Escape')

    await page.getByRole('button', { name: 'Measure', exact: true }).click()
    const card = page.getByRole('dialog', { name: 'Measure' })
    await expect(card).toBeVisible()

    // 1. Circular top edge (away from seam at +X so default filter picks edge).
    await clickPickableNear(page, [7.07, -7.07, 10], 'edge')
    await expect(card.getByText('62.83 mm')).toBeVisible()
    await expect(card.getByText('10 mm', { exact: true })).toBeVisible()
    await expect(card.getByText('20 mm', { exact: true })).toBeVisible()

    // 2. Cylindrical wall face + live unit change mm -> cm -> mm.
    await card.getByRole('button', { name: 'Clear' }).click()
    await card.getByRole('radio', { name: 'Face' }).click()
    await clickPickableNear(page, [7.07, -7.07, 5], 'face')
    await expect(card.getByText('628.32 mm²')).toBeVisible()
    await expect(card.getByText('10 mm', { exact: true })).toBeVisible()
    await expect(card.getByText('20 mm', { exact: true })).toBeVisible()

    await page.getByRole('button', { name: 'Settings' }).click()
    const settings = page.getByRole('dialog', { name: 'Settings' })
    await settings.getByRole('combobox', { name: 'Units' }).click()
    await page.getByRole('option', { name: 'Centimetres (cm)' }).click()
    await settings.getByRole('button', { name: 'Done' }).click()
    await expect(card.getByText('6.28 cm²')).toBeVisible()
    await expect(card.getByText('1 cm', { exact: true })).toBeVisible()
    await expect(card.getByText('2 cm', { exact: true })).toBeVisible()

    await page.getByRole('button', { name: 'Settings' }).click()
    await settings.getByRole('combobox', { name: 'Units' }).click()
    await page.getByRole('option', { name: 'Millimetres (mm)' }).click()
    await settings.getByRole('button', { name: 'Done' }).click()

    // 3. Solid volume before & after editing Extrude 1 from 10 to 20.
    await card.getByRole('button', { name: 'Clear' }).click()
    await card.getByRole('radio', { name: 'Solid' }).click()
    await clickPickableNear(page, [7.07, -7.07, 5], 'body')
    await expect(card.getByText('3141.59 mm³')).toBeVisible()

    await historyItem(page, 'Extrude 1').click()
    const ext = extrudeCard(page)
    await expect(ext).toBeVisible()
    await ext.getByLabel('Distance').fill('20')
    await ext.getByRole('button', { name: 'Apply' }).click()
    await expect(ext).toBeHidden()
    await settle(page)

    await page.getByRole('button', { name: 'Measure', exact: true }).click()
    await expect(card.getByText('6283.19 mm³')).toBeVisible()

    // Also verify Measure updates live while open on Ctrl+Z undo.
    await page.keyboard.press('Control+z')
    await settle(page)
    await expect(card.getByText('3141.59 mm³')).toBeVisible()
  })

  test('F09-E2 Closing Measure via U shortcut resets Point selection filter (BUG-019)', async ({ page }) => {
    await newProject(page)
    await buildBox(page)
    await settle(page)
    await waitCameraStable(page)
    await page.keyboard.press('Escape')

    await page.keyboard.press('u')
    const card = page.getByRole('dialog', { name: 'Measure' })
    await expect(card).toBeVisible()
    await card.getByRole('radio', { name: 'Point' }).click()
    await clickPickableNear(page, [40, 20, 10], 'vertex')
    await expect(card.getByText('(40, 20, 10) mm')).toBeVisible()

    // Close Measure via 'u' hotkey (without clicking Clear/Close button) and pick top face center.
    await page.keyboard.press('u')
    await expect(card).toBeHidden()
    await clickWorld(page, [20, 10, 10])
    await expect
      .poll(async () => page.evaluate(() => window.__3dshaper!.store.getState().selection[0]?.kind ?? null))
      .toBe('face')
  })

  test('F09-E3 Rolling back history removes selected vertex readout and viewport marker dot (BUG-021)', async ({ page }) => {
    await newProject(page)
    await buildBox(page)
    await settle(page)
    await waitCameraStable(page)
    await page.keyboard.press('Escape')

    await page.getByRole('button', { name: 'Measure', exact: true }).click()
    const card = page.getByRole('dialog', { name: 'Measure' })
    await card.getByRole('radio', { name: 'Point' }).click()
    await clickPickableNear(page, [40, 20, 10], 'vertex')
    await expect(card.getByText('(40, 20, 10) mm')).toBeVisible()

    // Roll back before Extrude 1 so no solid exists.
    const slider = page.getByRole('slider', { name: 'End of history' })
    await slider.focus()
    await page.keyboard.press('ArrowUp')
    await expect.poll(async () => (await doc(page)).rollbackIndex).toBe(0)
    await settle(page)

    await expect(card.getByText('Position')).toHaveCount(0)
    await expect(card.getByText('(40, 20, 10) mm')).toHaveCount(0)
    await expect
      .poll(() =>
        page.evaluate(() => (window.__3dshaper!.engine as unknown as { edgeMarksGroup: { children: unknown[] } }).edgeMarksGroup.children.length),
      )
      .toBe(0)
  })

  test('F09-E4 B hotkey toggles solid filter and Measure card fits cleanly at 390px mobile width', async ({ page }) => {
    await newProject(page)
    await buildBox(page)
    await settle(page)
    await waitCameraStable(page)
    await page.keyboard.press('Escape')

    // Press B -> clicking top face center picks whole body.
    await page.keyboard.press('b')
    await clickWorld(page, [20, 10, 10])
    await expect
      .poll(async () => page.evaluate(() => window.__3dshaper!.store.getState().selection[0]?.kind ?? null))
      .toBe('body')

    // Press B again -> toggles filter off, clicking top face center picks face.
    await page.keyboard.press('b')
    await clickWorld(page, [20, 10, 10])
    await expect
      .poll(async () => page.evaluate(() => window.__3dshaper!.store.getState().selection[0]?.kind ?? null))
      .toBe('face')

    // Phone layout check.
    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByRole('button', { name: 'Measure', exact: true }).click()
    const card = page.getByRole('dialog', { name: 'Measure' })
    await expect(card).toBeVisible()
    expect(await hasHorizontalScroll(page)).toBe(false)
    await expectNoA11yViolations(page, 'Measure card mobile 390px')
  })

  test('F10-E1 Hidden solids are excluded from 3MF export and High quality has more triangles than Low', async ({ page }) => {
    await newProject(page)
    await buildBox(page)
    await settle(page)
    await waitCameraStable(page)

    await buildCylinder(page, '20', [-30, 0, 0], false)
    await expect.poll(() => bodyMeshes(page)).toBe(2)
    await settle(page)

    // Hide Body 1 in Items so only Body 2 (cylinder) is visible.
    await page.getByRole('tab', { name: 'Items' }).click()
    await page.getByRole('tree', { name: 'Solids' }).getByRole('treeitem', { name: 'Body 1' }).hover()
    await page.getByRole('button', { name: 'Hide Body 1' }).click()
    await settle(page)

    const export3mf = async (quality: 'High' | 'Low') => {
      await page.getByRole('button', { name: 'Export', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: 'Export' })
      await expect(dialog).toBeVisible()
      // Only 1 visible body -> Solids scope switcher should not be shown.
      await expect(dialog.getByRole('radio', { name: /^Selected/ })).toHaveCount(0)
      await dialog.getByRole('combobox', { name: 'Format' }).click()
      await page.getByRole('option', { name: '3MF', exact: true }).click()
      await dialog.getByRole('radio', { name: quality, exact: true }).click()
      const [dl] = await Promise.all([
        page.waitForEvent('download'),
        dialog.getByRole('button', { name: 'Export', exact: true }).click(),
      ])
      await expect(dialog).toBeHidden()
      return readFileSync(await dl.path())
    }

    const highBuf = await export3mf('High')
    const lowBuf = await export3mf('Low')
    const highInfo = parse3mfInfo(readZipEntries(highBuf).get('3D/3dmodel.model')!)
    const lowInfo = parse3mfInfo(readZipEntries(lowBuf).get('3D/3dmodel.model')!)

    const body2Id = Object.entries((await doc(page)).bodies).find(([, b]) => b.name === 'Body 2')![0]
    expect(highInfo.objects).toBe(1)
    expect(lowInfo.objects).toBe(1)
    expect(highInfo.names).toEqual([body2Id])
    expect(lowInfo.names).toEqual([body2Id])
    expect(highInfo.triangles).toBeGreaterThan(lowInfo.triangles)
  })

  test('F10-E2 & F10-N1 Export dialog tracks liveBodies after Combine Join and shows empty state when rolled back (BUG-020)', async ({ page }) => {
    await newProject(page)
    await buildBox(page)
    await settle(page)
    await waitCameraStable(page)

    await addRectangleSketch(page, [10, 10, 0], '20', '20')
    await applyExtrude(page)
    await expect.poll(() => bodyMeshes(page)).toBe(2)
    await settle(page)

    await page.keyboard.press('Escape')
    await toolButton(page, 'Combine').click()
    const combine = page.getByRole('dialog', { name: 'Combine', exact: true })
    await expect(combine).toBeVisible()
    await page.getByRole('tab', { name: 'Items' }).click()
    const solids = page.getByRole('tree', { name: 'Solids' })
    await solids.getByRole('treeitem', { name: 'Body 1' }).click()
    await solids.getByRole('treeitem', { name: 'Body 2' }).click()
    await settle(page)
    await combine.getByRole('button', { name: 'Apply' }).click()
    await expect(combine).toBeHidden()
    await expect.poll(() => bodyMeshes(page)).toBe(1)
    await settle(page)

    // Select the single surviving solid: doc.bodies still holds consumed Body 2, but only 1 live solid exists.
    await solids.getByRole('treeitem', { name: 'Body 1' }).click()
    await page.getByRole('button', { name: 'Export', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Export' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('radio', { name: /^Selected/ })).toHaveCount(0)
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).toBeHidden()

    // F10-N1: roll back to the start -> 0 live solids -> Export shows empty state without Export action button.
    await page.getByRole('tab', { name: 'History' }).click()
    const slider = page.getByRole('slider', { name: 'End of history' })
    await slider.focus()
    for (let i = 0; i < 6; i++) {
      const now = await slider.getAttribute('aria-valuenow')
      if (now === '0') break
      await page.keyboard.press('ArrowUp')
    }
    await expect.poll(async () => (await doc(page)).rollbackIndex).toBe(-1)
    await expect.poll(() => bodyMeshes(page)).toBe(0)
    await settle(page)

    await page.getByRole('button', { name: 'Export', exact: true }).click()
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText('Nothing to export yet')).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Export', exact: true })).toHaveCount(0)
    await expectNoA11yViolations(page, 'Export dialog empty after rollback')
  })
})

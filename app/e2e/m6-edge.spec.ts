// M6 edge pass: sketch text, Scale, OBJ/GLB export, Save view as image, Snap to grid (cases M6-* in replica/test-plan.md).
import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import {
  bodyMeshes,
  bodyStats,
  buildBox,
  clickPickableNear,
  clickWorld,
  doc,
  exportStl,
  extrudeCard,
  extrudes,
  hasHorizontalScroll,
  newProject,
  pickTopPlane,
  addRectangleSketch,
  applyExtrude,
  historyItem,
  savedProjects,
  projectId,
  settle,
  sketches,
  toolButton,
  waitCameraStable,
  waitReady,
} from './helpers'
import { variableCommand, variablesOf } from './variablesPanel'
import type { SketchEntity, TextEntity } from '../src/doc/types'

const textCard = (page: Page) => page.getByRole('dialog', { name: 'Text', exact: true })
const scaleCard = (page: Page) => page.getByRole('dialog', { name: 'Scale', exact: true })

async function textEntities(page: Page): Promise<TextEntity[]> {
  return sketches(await doc(page)).flatMap((f) => f.sketch.entities.filter((e: SketchEntity): e is TextEntity => e.type === 'text'))
}
const scales = async (page: Page) => (await doc(page)).features.filter((f) => f.type === 'scale')

async function regionNames(page: Page): Promise<string[]> {
  return page.evaluate(() => (window.__3dshaper!.engine as unknown as { regions: { name: string }[] }).regions.map((r) => r.name))
}

/** Text tool -> Top plane -> click at `at` (card opens). */
async function startText(page: Page, at: [number, number, number] = [0, 0, 0]) {
  await toolButton(page, 'Text').click()
  await pickTopPlane(page)
  await clickWorld(page, at)
  await expect(textCard(page)).toBeVisible()
}

async function fillField(page: Page, label: string, value: string) {
  const f = textCard(page).getByLabel(label, { exact: true })
  await f.fill(value)
  await f.blur()
}

async function applyText(page: Page) {
  await textCard(page).getByRole('button', { name: 'Apply' }).click()
  await expect(textCard(page)).toBeHidden()
}

/** Finish the sketch, turn on Extrude, select all text regions, set mode and distance, apply. */
async function extrudeText(page: Page, opts: { mode?: 'Join' | 'Cut'; distance?: string } = {}) {
  await page.getByRole('button', { name: 'Finish sketch' }).click()
  await toolButton(page, 'Extrude').click()
  await expect.poll(async () => (await regionNames(page)).filter((n) => n.includes('~')).length).toBeGreaterThan(0)
  // The whole text, the way a plain click on a letter picks it: letters added later are included.
  const names = [...new Set((await regionNames(page)).filter((n) => n.includes('~')).map((n) => n.replace(/~\d+$/, '~*')))]
  await page.evaluate((list) => {
    window.__3dshaper!.store.getState().setSelection(list.map((name) => ({ kind: 'sketchRegion' as const, name })))
  }, names)
  const card = extrudeCard(page)
  await expect(card).toBeVisible()
  if (opts.mode) await card.getByRole('radio', { name: opts.mode }).click()
  await card.getByLabel('Distance').fill(opts.distance ?? '2')
  await card.getByLabel('Distance').blur()
  await settle(page)
  await card.getByRole('button', { name: 'Apply' }).click()
  await expect(card).toBeHidden()
  await settle(page)
}

/** Text tool on the box's top face, card open. */
async function textOnTopFace(page: Page) {
  await toolButton(page, 'Text').click()
  await clickPickableNear(page, [20, 10, 10], 'face')
  await expect.poll(async () => sketches(await doc(page)).length).toBe(2)
  await waitCameraStable(page)
  await clickWorld(page, [8, 8, 10])
  await expect(textCard(page)).toBeVisible()
}

/** Radial extent of every solid vertex around the Z axis. */
async function radii(page: Page): Promise<{ min: number; max: number }> {
  return page.evaluate(() => {
    const bodies = (window.__3dshaper!.engine as unknown as { bodies: Map<string, { data: { positions: Float32Array } }> }).bodies
    let min = Infinity
    let max = 0
    for (const b of bodies.values()) {
      const p = b.data.positions
      for (let i = 0; i < p.length; i += 3) {
        const r = Math.hypot(p[i], p[i + 1])
        min = Math.min(min, r)
        max = Math.max(max, r)
      }
    }
    return { min, max }
  })
}

async function circleWithText(page: Page, side: 'Outside' | 'Inside') {
  await toolButton(page, 'Circle').click()
  await pickTopPlane(page)
  await clickWorld(page, [0, 0, 0])
  await expect(page.getByRole('group', { name: 'Shape size' })).toBeVisible()
  await page.keyboard.type('40')
  await page.keyboard.press('Enter')
  await expect.poll(async () => sketches(await doc(page))[0].sketch.entities.length).toBe(1)
  await toolButton(page, 'Text').click()
  await clickWorld(page, [-5, -5, 0])
  const card = textCard(page)
  await expect(card).toBeVisible()
  await card.getByRole('textbox', { name: 'Text' }).fill('AB')
  await fillField(page, 'Size', '5')
  await card.getByRole('button', { name: 'Pick a curve' }).click()
  await clickWorld(page, [20, 0, 0])
  await expect(card.getByRole('radiogroup', { name: 'Side of the curve' })).toBeVisible()
  await card.getByRole('radio', { name: side }).click()
  await fillField(page, 'Start', '25')
  await applyText(page)
}

async function downloadExport(page: Page, format: 'OBJ' | 'GLB (glTF)', solids?: 'All visible' | 'Selected') {
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Export' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('combobox', { name: 'Format' }).click()
  await page.getByRole('option', { name: format, exact: true }).click()
  if (solids) await dialog.getByRole('radio', { name: new RegExp(`^${solids}`) }).click()
  const [dl] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('button', { name: 'Export', exact: true }).click()])
  await expect(dialog).toBeHidden()
  return { filename: dl.suggestedFilename(), buffer: readFileSync(await dl.path()) }
}

function parseGlb(buf: Buffer) {
  expect(buf.toString('ascii', 0, 4)).toBe('glTF')
  const jsonLen = buf.readUInt32LE(12)
  return JSON.parse(buf.toString('utf8', 20, 20 + jsonLen)) as { nodes: { name: string }[]; meshes: unknown[] }
}

// ---- Text -----------------------------------------------------------------------------------------------------

test.describe('M6 text edge cases', () => {
  test('M6-T-H2 emboss: text joined onto the top face grows the single solid', async ({ page }) => {
    await newProject(page)
    await buildBoxSettled(page)
    const before = (await bodyStats(page))[0].volume
    await textOnTopFace(page)
    await textCard(page).getByRole('textbox', { name: 'Text' }).fill('AB')
    await fillField(page, 'Size', '5')
    await applyText(page)
    await extrudeText(page, { mode: 'Join', distance: '1' })
    await expect.poll(() => bodyMeshes(page)).toBe(1)
    await expect.poll(async () => (await bodyStats(page))[0].volume).toBeGreaterThan(before + 1)
    expect(before).toBeCloseTo(8000, 0)
  })

  test('M6-T-H3 engrave: text cut into the top face shrinks the single solid', async ({ page }) => {
    await newProject(page)
    await buildBoxSettled(page)
    const before = (await bodyStats(page))[0].volume
    await textOnTopFace(page)
    await textCard(page).getByRole('textbox', { name: 'Text' }).fill('AB')
    await fillField(page, 'Size', '5')
    await applyText(page)
    await extrudeText(page, { mode: 'Cut', distance: '1' })
    await expect.poll(() => bodyMeshes(page)).toBe(1)
    await expect.poll(async () => (await bodyStats(page))[0].volume).toBeLessThan(before - 1)
  })

  for (const side of ['Outside', 'Inside'] as const) {
    test(`M6-T-H4 text on a circle, ${side}: outlines lie ${side.toLowerCase()} the circle`, async ({ page }) => {
      await newProject(page)
      await circleWithText(page, side)
      await extrudeText(page, { distance: '2' })
      await expect.poll(async () => (await bodyStats(page)).length).toBe(1)
      const r = await radii(page)
      if (side === 'Outside') {
        expect(r.min).toBeGreaterThan(19.3)
        expect(r.max).toBeGreaterThan(23)
      } else {
        expect(r.max).toBeLessThan(20.8)
        expect(r.min).toBeLessThan(18)
      }
    })
  }

  test('M6-T-E1 empty text shows a hint, adds no text and no error', async ({ page }) => {
    await newProject(page)
    await startText(page)
    const card = textCard(page)
    await card.getByRole('textbox', { name: 'Text' }).fill('')
    await expect(card.getByText('Type some text')).toBeVisible()
    await expect(card.getByRole('button', { name: 'Apply' })).toBeDisabled()
    await expect(card.getByRole('alert')).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(card).toBeHidden()
    expect(await textEntities(page)).toHaveLength(0)
  })

  test('BUG-032 the sketch status bar hides while the Text card is open', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 600 })
    await newProject(page)
    await startText(page)
    const card = textCard(page)
    await expect(card).toBeVisible()
    await expect(page.getByRole('button', { name: 'Finish sketch' })).toBeHidden()
    await expect(page.getByRole('button', { name: 'Snap to grid' })).toBeHidden()
    await card.getByRole('button', { name: 'Apply' }).click()
    await expect(card).toBeHidden()
    await expect(page.getByRole('button', { name: 'Finish sketch' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Snap to grid' })).toBeVisible()
  })

  test('M6-T-E2 a 60-character text keeps the card inside the viewport and builds regions in under 10 s', async ({ page }) => {
    await newProject(page)
    await startText(page)
    const card = textCard(page)
    await card.getByRole('textbox', { name: 'Text' }).fill('ABCDEFGHIJ'.repeat(6))
    const box = (await card.boundingBox())!
    const vp = page.viewportSize()!
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(vp.width + 0.5)
    expect(await card.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
    await applyText(page)
    await page.getByRole('button', { name: 'Finish sketch' }).click()
    await toolButton(page, 'Extrude').click()
    const t0 = Date.now()
    await expect.poll(async () => (await regionNames(page)).filter((n) => n.includes('~')).length, { timeout: 10_000 }).toBeGreaterThan(30)
    expect(Date.now() - t0).toBeLessThan(10_000)
  })

  test('M6-T-E3 accents are drawn and glyphs the font lacks are skipped without a crash', async ({ page }) => {
    await newProject(page)
    await startText(page)
    await textCard(page).getByRole('textbox', { name: 'Text' }).fill('Été Ø ✓ 🚀')
    await applyText(page)
    expect((await textEntities(page))[0].text).toBe('Été Ø ✓ 🚀')
    await page.getByRole('button', { name: 'Finish sketch' }).click()
    await toolButton(page, 'Extrude').click()
    // E, accent, t, e, accent, O-with-slash: at least the letters and their accents.
    await expect.poll(async () => (await regionNames(page)).filter((n) => n.includes('~')).length).toBeGreaterThanOrEqual(5)
    await expect(page.getByRole('alert')).toHaveCount(0)
  })

  for (const bad of ['0', '-3', 'abc']) {
    test(`M6-T-E4 size "${bad}" is refused on the field and Apply is disabled`, async ({ page }) => {
      await newProject(page)
      await startText(page)
      await fillField(page, 'Size', bad)
      await expect(textCard(page).getByLabel('Size', { exact: true })).toHaveAttribute('aria-invalid', 'true')
      await expect(textCard(page).getByRole('button', { name: 'Apply' })).toBeDisabled()
      await page.keyboard.press('Escape')
      expect(await textEntities(page)).toHaveLength(0)
    })
  }

  test('M6-T-E5 extruded text and its solid come back the same after a reload', async ({ page }) => {
    await newProject(page)
    await startText(page)
    await textCard(page).getByRole('textbox', { name: 'Text' }).fill('Hi')
    await applyText(page)
    await extrudeText(page, { distance: '3' })
    await expect.poll(async () => (await bodyStats(page)).length).toBe(1)
    const v1 = (await bodyStats(page))[0].volume
    const id = (await projectId(page))!
    await expect.poll(async () => extrudes((await savedProjects(page)).find((p) => p.id === id)!.document).length).toBe(1)
    await page.reload()
    await waitReady(page)
    await expect.poll(async () => (await bodyStats(page)).length).toBe(1)
    const v2 = (await bodyStats(page))[0].volume
    expect(Math.abs(v2 - v1)).toBeLessThan(0.01)
    expect((await textEntities(page))[0].text).toBe('Hi')
  })

  test('M6-T-E6 editing the text upstream of an extrude re-flows without an error', async ({ page }) => {
    await newProject(page)
    await startText(page, [-10, 0, 0])
    await textCard(page).getByRole('textbox', { name: 'Text' }).fill('AB')
    await applyText(page)
    await extrudeText(page, { distance: '2' })
    await expect.poll(async () => (await bodyStats(page)).length).toBe(1)
    const v1 = (await bodyStats(page))[0].volume
    // Reopen the sketch, edit the text.
    await historyItem(page, 'Sketch 1').click()
    await waitCameraStable(page)
    await toolButton(page, 'Text').click()
    const t = (await textEntities(page))[0]
    await clickWorld(page, [t.position[0] + 7, t.position[1] + 2, 0])
    await expect(textCard(page)).toBeVisible()
    await textCard(page).getByRole('textbox', { name: 'Text' }).fill('ABC')
    await applyText(page)
    await page.getByRole('button', { name: 'Finish sketch' }).click()
    await settle(page)
    await expect(page.getByRole('alert')).toHaveCount(0)
    await expect(historyItem(page, 'Extrude 1')).not.toContainText('Error:')
    await expect.poll(async () => (await bodyStats(page)).length).toBe(1)
    expect((await textEntities(page))[0].text).toBe('ABC')
    // The extrude took the whole text, so the new letter C is part of the solid.
    expect((await bodyStats(page))[0].volume).toBeGreaterThan(v1 + 20)
  })

  test('M6-T-E7 deleting the curve the text follows leaves the text usable', async ({ page }) => {
    await newProject(page)
    await circleWithText(page, 'Outside')
    const circle = sketches(await doc(page))[0].sketch.entities.find((e) => e.type === 'circle')!
    await toolButton(page, 'Text').click() // toggles the Text tool off
    await expect(toolButton(page, 'Text')).toHaveAttribute('aria-pressed', 'false')
    await clickWorld(page, [-20, 0, 0])
    await page.keyboard.press('Delete')
    await expect.poll(async () => sketches(await doc(page))[0].sketch.entities.some((e) => e.id === circle.id)).toBe(false)
    await settle(page)
    expect((await textEntities(page)).length).toBe(1)
    await expect(page.getByRole('alert')).toHaveCount(0)
    // Still extrudes (straight, or flagged) without a crash.
    await page.getByRole('button', { name: 'Finish sketch' }).click()
    await toolButton(page, 'Extrude').click()
    await settle(page)
    await expect(page.getByRole('heading', { name: /something went wrong/i })).toHaveCount(0)
  })

  test('M6-T-E8 undo removes the placed text, redo brings it back', async ({ page }) => {
    await newProject(page)
    await startText(page)
    await textCard(page).getByRole('textbox', { name: 'Text' }).fill('Hi')
    await applyText(page)
    await expect.poll(async () => (await textEntities(page)).length).toBe(1)
    await page.keyboard.press('Control+z')
    await expect.poll(async () => (await textEntities(page)).length).toBe(0)
    await page.keyboard.press('Control+y')
    await expect.poll(async () => (await textEntities(page)).length).toBe(1)
    expect((await textEntities(page))[0].text).toBe('Hi')
  })

  test('M6-T-E9 keyboard only: I, place, Tab through the fields, Enter applies, Esc cancels', async ({ page }) => {
    await newProject(page)
    await toolButton(page, 'Rectangle').click() // opens a sketch so the I key has a plane
    await pickTopPlane(page)
    await page.keyboard.press('i')
    await expect(toolButton(page, 'Text')).toHaveAttribute('aria-pressed', 'true')
    await clickWorld(page, [0, 0, 0])
    const card = textCard(page)
    await expect(card).toBeVisible()
    const text = card.getByRole('textbox', { name: 'Text' })
    await expect(text).toBeFocused()
    await text.fill('Key')
    for (const label of ['Size', 'Rotation']) {
      await page.keyboard.press('Tab')
      const f = card.getByLabel(label, { exact: true })
      await expect(f).toBeFocused()
      const outline = await f.evaluate((el) => getComputedStyle(el.parentElement!).outlineStyle)
      expect(outline).not.toBe('none')
    }
    await page.keyboard.press('Tab')
    await expect(card.getByRole('button', { name: 'Pick a curve' })).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(card.getByRole('button', { name: 'Cancel' })).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(card.getByRole('button', { name: 'Apply' })).toBeFocused()
    await text.focus()
    await page.keyboard.press('Enter')
    await expect(card).toBeHidden()
    await expect.poll(async () => (await textEntities(page)).length).toBe(1)
    // Esc cancels a second one.
    await clickWorld(page, [0, -15, 0])
    await expect(card).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(card).toBeHidden()
    expect(await textEntities(page)).toHaveLength(1)
  })

  test('M6-T-E10 @mobile the text card fits a 390 px screen', async ({ page }) => {
    await newProject(page)
    await startText(page)
    const box = (await textCard(page).boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(390.5)
    expect(box.y + box.height).toBeLessThanOrEqual(844.5)
    expect(await hasHorizontalScroll(page)).toBe(false)
  })
})

/** The standard 40 x 20 x 10 box (volume 8000). */
async function buildBoxSettled(page: Page) {
  await buildBox(page)
  await settle(page)
  await waitCameraStable(page)
}

// ---- Scale ----------------------------------------------------------------------------------------------------

async function openScale(page: Page) {
  await toolButton(page, 'Scale').click()
  await expect(scaleCard(page)).toBeVisible()
}

async function setFactor(page: Page, v: string) {
  const f = scaleCard(page).getByLabel('Factor', { exact: true })
  await f.fill(v)
  await f.press('Tab')
}

async function boxReady(page: Page) {
  await newProject(page)
  await buildBox(page)
  await settle(page)
  await waitCameraStable(page)
}

test.describe('M6 scale edge cases', () => {
  for (const bad of ['0', '-1', 'abc', '']) {
    test(`M6-S-E1 factor "${bad}" is refused and Apply is disabled`, async ({ page }) => {
      await boxReady(page)
      await openScale(page)
      // An empty field starts from the default 1, so type something first.
      await setFactor(page, bad === '' ? '2' : bad)
      if (bad === '') await setFactor(page, '')
      await expect(scaleCard(page).getByLabel('Factor', { exact: true })).toHaveAttribute('aria-invalid', 'true')
      await expect(scaleCard(page).getByRole('button', { name: 'Apply' })).toBeDisabled()
      expect(await scales(page)).toHaveLength(0)
    })
  }

  for (const f of [0.001, 1000]) {
    test(`M6-S-E2 extreme factor ${f} gives a valid solid and a usable view`, async ({ page }) => {
      await boxReady(page)
      await openScale(page)
      await setFactor(page, String(f))
      await settle(page)
      await expect(scaleCard(page).getByRole('alert')).toHaveCount(0)
      await scaleCard(page).getByRole('button', { name: 'Apply' }).click()
      await expect(scaleCard(page)).toBeHidden()
      await settle(page)
      await expect.poll(() => bodyMeshes(page)).toBe(1)
      const { info } = await exportStl(page)
      expect(info.volume).toBeGreaterThan(0)
      expect(Math.abs(info.volume / (8000 * f ** 3) - 1)).toBeLessThan(0.02)
      await page.getByRole('button', { name: 'Zoom to fit' }).click()
      await waitCameraStable(page)
      await expect(page.getByRole('alert')).toHaveCount(0)
    })
  }

  test('M6-S-E3 a variable factor re-scales when the variable changes', async ({ page }) => {
    await boxReady(page)
    expect((await variableCommand(page, 'addVariable', 'k', '2')).ok).toBe(true)
    await openScale(page)
    await setFactor(page, 'k')
    await settle(page)
    await scaleCard(page).getByRole('button', { name: 'Apply' }).click()
    await expect(scaleCard(page)).toBeHidden()
    await settle(page)
    await expect.poll(async () => (await bodyStats(page))[0].volume).toBeCloseTo(8000 * 8, -1)
    const id = (await variablesOf(page)).find((v) => v.name === 'k')!.id
    expect((await variableCommand(page, 'setVariableExpression', id, '3')).ok).toBe(true)
    await settle(page)
    await expect.poll(async () => (await bodyStats(page))[0].volume).toBeCloseTo(8000 * 27, -1)
  })

  test('M6-S-E4 a factor with a unit suffix is rejected', async ({ page }) => {
    await boxReady(page)
    await openScale(page)
    await setFactor(page, '2in')
    await expect(scaleCard(page).getByLabel('Factor', { exact: true })).toHaveAttribute('aria-invalid', 'true')
    await expect(scaleCard(page).getByRole('button', { name: 'Apply' })).toBeDisabled()
  })

  test('M6-S-E5 changing the Extrude distance upstream re-flows the scale', async ({ page }) => {
    await boxReady(page)
    await openScale(page)
    await setFactor(page, '2')
    await settle(page)
    await scaleCard(page).getByRole('button', { name: 'Apply' }).click()
    await expect(scaleCard(page)).toBeHidden()
    await settle(page)
    await expect.poll(async () => (await bodyStats(page))[0].volume).toBeCloseTo(64000, -1)
    const ex = extrudes(await doc(page))[0]
    await page.evaluate(async (id) => {
      const url = '/src/doc/commands.ts'
      const m = await import(/* @vite-ignore */ url)
      m.updateFeatureParams(id, { distance: '20' })
    }, ex.id)
    await settle(page)
    await expect(page.getByRole('alert')).toHaveCount(0)
    await expect(historyItem(page, 'Scale 1')).not.toContainText('Error:')
    await expect.poll(async () => (await bodyStats(page))[0].volume).toBeCloseTo(16000 * 8, -1)
  })

  test('M6-S-E6 double-clicking Apply adds exactly one Scale step', async ({ page }) => {
    await boxReady(page)
    await openScale(page)
    await setFactor(page, '2')
    await settle(page)
    await scaleCard(page).getByRole('button', { name: 'Apply' }).dblclick({ force: true })
    await settle(page)
    expect(await scales(page)).toHaveLength(1)
    await expect(page.getByRole('tree', { name: 'History' }).getByRole('treeitem', { name: /Scale/ })).toHaveCount(1)
  })

  test('M6-S-E7 @mobile W then Enter scales on a phone and the card fits', async ({ page }) => {
    await boxReady(page)
    await page.keyboard.press('w')
    await expect(scaleCard(page)).toBeVisible()
    const box = (await scaleCard(page).boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(390.5)
    expect(await hasHorizontalScroll(page)).toBe(false)
    await scaleCard(page).getByLabel('Factor', { exact: true }).fill('2')
    await page.keyboard.press('Enter')
    await expect(scaleCard(page)).toBeHidden()
    await settle(page)
    expect(await scales(page)).toHaveLength(1)
  })

  test('M6-S-E7b W then Enter scales from the keyboard', async ({ page }) => {
    await boxReady(page)
    await page.keyboard.press('w')
    await expect(scaleCard(page)).toBeVisible()
    await scaleCard(page).getByLabel('Factor', { exact: true }).fill('2')
    await page.keyboard.press('Enter')
    await expect(scaleCard(page)).toBeHidden()
    await settle(page)
    expect(await scales(page)).toHaveLength(1)
  })

  test('M6-S-N1 with no solids, Scale says to make a solid first and adds nothing', async ({ page }) => {
    await newProject(page)
    await page.keyboard.press('w')
    await expect(scaleCard(page)).toBeVisible()
    await expect(scaleCard(page).getByText(/solid/i).first()).toBeVisible()
    await expect(scaleCard(page).getByRole('button', { name: 'Apply' })).toBeDisabled()
    await page.keyboard.press('Escape')
    expect(await scales(page)).toHaveLength(0)
  })
})

// ---- Export OBJ / GLB ----------------------------------------------------------------------------------------

test.describe('M6 export edge cases', () => {
  async function twoBodies(page: Page) {
    await newProject(page)
    await buildBox(page)
    await settle(page)
    await waitCameraStable(page)
    await addRectangleSketch(page, [-35, 0, 0], '20', '20')
    await applyExtrude(page)
    await expect.poll(() => bodyMeshes(page)).toBe(2)
    await settle(page)
  }

  test('M6-X-E1 two solids to GLB give two nodes and two meshes', async ({ page }) => {
    await twoBodies(page)
    const glb = await downloadExport(page, 'GLB (glTF)', 'All visible')
    const g = parseGlb(glb.buffer)
    expect(g.nodes).toHaveLength(2)
    expect(g.meshes).toHaveLength(2)
  })

  test('M6-X-E2 odd body names survive in OBJ and GLB', async ({ page }) => {
    await newProject(page)
    await buildBox(page)
    await settle(page)
    const name = 'Bracket "A" – Ø12 🚀'
    await page.evaluate((n) => {
      const s = window.__3dshaper!.store.getState()
      s.apply('Rename body', (d) => {
        const key = Object.keys(d.bodies)[0]
        d.bodies[key].name = n
      })
    }, name)
    await settle(page)
    const obj = await downloadExport(page, 'OBJ')
    const text = obj.buffer.toString('utf8')
    const oLines = text.split(/\r?\n/).filter((l) => l.startsWith('o '))
    expect(oLines).toHaveLength(1)
    expect(oLines[0]).not.toMatch(/\s{2,}/)
    expect(oLines[0]).toContain('Ø12')
    expect(oLines[0]).toContain('"A"')
    expect(text.split(/\r?\n/).filter((l) => l.startsWith('f ')).length).toBe(12)
    const glb = await downloadExport(page, 'GLB (glTF)')
    const g = parseGlb(glb.buffer)
    expect(g.nodes[0].name).toBe(name)
  })
})

// ---- Save view as image --------------------------------------------------------------------------------------

test.describe('M6 save view as image', () => {
  const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

  test('M6-I-E1 an empty project still saves a PNG', async ({ page }) => {
    await newProject(page)
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Save view as image' }).click()])
    expect(dl.suggestedFilename()).toMatch(/\.png$/)
    const bytes = readFileSync(await dl.path())
    expect([...bytes.subarray(0, 8)]).toEqual(PNG)
  })

  test('M6-I-E2 an odd project name gives a safe file name', async ({ page }) => {
    await newProject(page)
    await page.getByRole('button', { name: 'Untitled' }).dblclick()
    const input = page.getByLabel('Project name')
    await input.fill('a/b:c*? 🚀')
    await input.press('Enter')
    await settle(page)
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Save view as image' }).click()])
    const fn = dl.suggestedFilename()
    expect(fn).not.toMatch(/[/\\:*?"<>|]/)
    expect(fn).toMatch(/\.png$/)
    expect(fn.length).toBeGreaterThan(4)
  })
})

// ---- Snap to grid ---------------------------------------------------------------------------------------------

test.describe('M6 grid snap edge cases', () => {
  const group = (page: Page) => page.getByRole('group', { name: 'Grid snapping' })
  const isWhole = (n: number) => Math.abs(n - Math.round(n)) < 1e-6
  const lineEnds = async (page: Page) =>
    sketches(await doc(page)).flatMap((s) => s.sketch.entities.flatMap((e) => (e.type === 'line' ? [e.b] : [])))

  test('M6-N-E1 snap switched off stays off after a reload', async ({ page }) => {
    await newProject(page)
    await toolButton(page, 'Line').click()
    await pickTopPlane(page)
    const toggle = group(page).getByRole('button', { name: 'Snap to grid' })
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-pressed', 'false')
    await settle(page)
    await page.reload()
    await waitReady(page)
    await toolButton(page, 'Line').click()
    await pickTopPlane(page).catch(async () => {
      // the project already has a sketch after the reload: open it from History
      await historyItem(page, 'Sketch 1').click()
    })
    await expect(group(page).getByRole('button', { name: 'Snap to grid' })).toHaveAttribute('aria-pressed', 'false')
  })

  test('M6-N-E2 with snap off, holding Alt snaps to the grid', async ({ page }) => {
    await newProject(page)
    await toolButton(page, 'Line').click()
    await pickTopPlane(page)
    const toggle = group(page).getByRole('button', { name: 'Snap to grid' })
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-pressed', 'false')
    await clickWorld(page, [0, 0, 0])
    await page.keyboard.down('Alt')
    await clickWorld(page, [30.37, 12.61, 0])
    await page.keyboard.up('Alt')
    await page.keyboard.press('Escape')
    await expect.poll(async () => (await lineEnds(page)).length).toBe(1)
    const b = (await lineEnds(page))[0]
    expect(isWhole(b[0]) && isWhole(b[1]), `end point ${b} should be on the 1 mm grid`).toBe(true)
  })

  test('M6-N-E2b the Text tool respects the Snap to grid switch', async ({ page }) => {
    await newProject(page)
    await toolButton(page, 'Text').click()
    await pickTopPlane(page)
    const toggle = group(page).getByRole('button', { name: 'Snap to grid' })
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-pressed', 'false')
    await clickWorld(page, [30.37, 12.61, 0])
    await expect(textCard(page)).toBeVisible()
    await textCard(page).getByRole('button', { name: 'Apply' }).click()
    await expect.poll(async () => (await textEntities(page)).length).toBe(1)
    const p = (await textEntities(page))[0].position
    expect(isWhole(p[0]) || isWhole(p[1]), `position ${p} should NOT be rounded with snap off`).toBe(false)
  })

  test('M6-N-E3 with inches as the display unit the readout is in inches', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Settings' }).click()
    const dialog = page.getByRole('dialog', { name: 'Settings' })
    await dialog.getByRole('combobox', { name: 'Units' }).click()
    await page.getByRole('option', { name: 'Inches (in)' }).click()
    await dialog.getByRole('button', { name: 'Done' }).click()
    await newProject(page)
    await toolButton(page, 'Line').click()
    await pickTopPlane(page)
    const readout = group(page).getByText(/^Grid /)
    await expect(readout).toBeVisible()
    await expect(readout).toHaveText(/^Grid [\d.]+ in$/)
    await expect(readout).not.toContainText('mm')
  })
})

void [clickPickableNear, exportStl]

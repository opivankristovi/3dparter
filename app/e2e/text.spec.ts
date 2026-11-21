// Sketch text: place it, edit it in the card, put it on a curve, and turn its outlines into solids.
import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import {
  bodyStats,
  clickWorld,
  doc,
  exportStl,
  extrudeCard,
  extrudes,
  newProject,
  pickTopPlane,
  settle,
  sketches,
  toolButton,
  waitCameraStable,
} from './helpers'
import type { SketchEntity, TextEntity } from '../src/doc/types'
import { variableCommand, variablesOf } from './variablesPanel'

const textCard = (page: Page) => page.getByRole('dialog', { name: 'Text', exact: true })

async function textEntities(page: Page): Promise<TextEntity[]> {
  const s = sketches(await doc(page))
  return s.flatMap((f) => f.sketch.entities.filter((e: SketchEntity): e is TextEntity => e.type === 'text'))
}

/** Region names the viewport knows right now (all sketches while the Extrude tool is on). */
async function regionNames(page: Page): Promise<string[]> {
  return page.evaluate(() => (window.__3dparter!.engine as unknown as { regions: { name: string }[] }).regions.map((r) => r.name))
}

/** Finish the sketch, switch on Extrude, pick the text regions and apply. */
async function extrudeTextRegions(page: Page) {
  await page.getByRole('button', { name: 'Finish sketch' }).click()
  await toolButton(page, 'Extrude').click()
  await expect.poll(async () => (await regionNames(page)).filter((n) => n.includes('~')).length).toBeGreaterThan(0)
  const names = (await regionNames(page)).filter((n) => n.includes('~'))
  await page.evaluate((list) => {
    window.__3dparter!.store.getState().setSelection(list.map((name) => ({ kind: 'sketchRegion' as const, name })))
  }, names)
  const card = extrudeCard(page)
  await expect(card).toBeVisible()
  await card.getByLabel('Distance').fill('3')
  await card.getByLabel('Distance').blur()
  await settle(page)
  await card.getByRole('button', { name: 'Apply' }).click()
  await expect(card).toBeHidden()
  await settle(page)
  return names
}

/** World-space bounding box of each region the viewport shows (x and y, the sketch is on the Top plane). */
async function regionBoxes(page: Page): Promise<{ name: string; min: [number, number]; max: [number, number] }[]> {
  return page.evaluate(() => {
    const engine = window.__3dparter!.engine as unknown as {
      regions: { name: string; mesh: { geometry: { getAttribute(n: string): { count: number; getX(i: number): number; getY(i: number): number } } } }[]
    }
    return engine.regions.map((r) => {
      const p = r.mesh.geometry.getAttribute('position')
      let minX = Infinity
      let minY = Infinity
      let maxX = -Infinity
      let maxY = -Infinity
      for (let i = 0; i < p.count; i++) {
        minX = Math.min(minX, p.getX(i))
        maxX = Math.max(maxX, p.getX(i))
        minY = Math.min(minY, p.getY(i))
        maxY = Math.max(maxY, p.getY(i))
      }
      return { name: r.name, min: [minX, minY] as [number, number], max: [maxX, maxY] as [number, number] }
    })
  })
}

const selectedRegions = (page: Page) =>
  page.evaluate(() => window.__3dparter!.store.getState().selection.filter((r) => r.kind === 'sketchRegion').map((r) => r.name))

/** Text tool, a text "HELLO" of size 20 at (-30, 0), applied; then the sketch is finished and Extrude is on. */
async function helloAndExtrudeTool(page: Page) {
  await newProject(page)
  await toolButton(page, 'Text').click()
  await pickTopPlane(page)
  await clickWorld(page, [-30, 0, 0])
  const card = textCard(page)
  await expect(card).toBeVisible()
  await card.getByRole('textbox', { name: 'Text' }).fill('HELLO')
  await card.getByLabel('Size').fill('20')
  await card.getByLabel('Size').blur()
  await card.getByRole('button', { name: 'Apply' }).click()
  await expect(card).toBeHidden()
  await page.getByRole('button', { name: 'Finish sketch' }).click()
  await toolButton(page, 'Extrude').click()
  await expect.poll(async () => (await regionNames(page)).filter((n) => n.includes('~')).length).toBeGreaterThanOrEqual(5)
  await waitCameraStable(page)
}

test.describe('sketch text', () => {
  test('places "3D" at 12 mm, edits it again, and extrudes the outlines into a solid', async ({ page }) => {
    await newProject(page)
    await toolButton(page, 'Text').click()
    await pickTopPlane(page)
    await clickWorld(page, [-10, 0, 0])

    const card = textCard(page)
    await expect(card).toBeVisible()
    const textbox = card.getByRole('textbox', { name: 'Text' })
    await textbox.fill('3D')
    const size = card.getByLabel('Size')
    await size.fill('12')
    await size.blur()
    await card.getByRole('button', { name: 'Apply' }).click()
    await expect(card).toBeHidden()

    await expect.poll(async () => (await textEntities(page)).length).toBe(1)
    const t = (await textEntities(page))[0]
    expect(t.text).toBe('3D')
    expect(t.size).toBeCloseTo(12, 5)
    expect(t.path).toBeUndefined()

    // Click the text with the Text tool still on: the card opens again and one undo step undoes the edit.
    // (The selected text shows the sketch toolbar above itself, so click low on its right side.)
    await clickWorld(page, [t.position[0] + 15, t.position[1] + 2, 0])
    await expect(card).toBeVisible()
    await card.getByRole('textbox', { name: 'Text' }).fill('3DX')
    await card.getByRole('button', { name: 'Apply' }).click()
    await expect(card).toBeHidden()
    await expect.poll(async () => (await textEntities(page))[0].text).toBe('3DX')
    await page.evaluate(() => window.__3dparter!.store.getState().undo())
    await expect.poll(async () => (await textEntities(page))[0].text).toBe('3D')

    const names = await extrudeTextRegions(page)
    expect(names.length).toBeGreaterThanOrEqual(2)
    await expect.poll(async () => (await bodyStats(page)).length).toBe(1)
    const [body] = await bodyStats(page)
    expect(body.volume).toBeGreaterThan(20)
    expect(body.max[2] - body.min[2]).toBeCloseTo(3, 1)
    // About 12 mm tall letters, two of them side by side.
    expect(body.max[1] - body.min[1]).toBeGreaterThan(10)
    expect(body.max[1] - body.min[1]).toBeLessThan(14)
    expect(body.max[0] - body.min[0]).toBeGreaterThan(12)

    const out = await exportStl(page)
    expect(out.info.triangles).toBeGreaterThan(50)
    expect(out.info.volume).toBeGreaterThan(20)
  })

  test('the card asks for text when it is empty and can be reached by keyboard', async ({ page }) => {
    await newProject(page)
    await toolButton(page, 'Text').click()
    await pickTopPlane(page)
    await clickWorld(page, [0, 0, 0])
    const card = textCard(page)
    await expect(card).toBeVisible()
    await card.getByRole('textbox', { name: 'Text' }).fill('')
    await expect(card.getByText('Type some text')).toBeVisible()
    await expect(card.getByRole('button', { name: 'Apply' })).toBeDisabled()
    await card.getByRole('textbox', { name: 'Text' }).fill('Hi')
    await expect(card.getByRole('button', { name: 'Apply' })).toBeEnabled()
    // Esc leaves nothing behind.
    await card.getByRole('textbox', { name: 'Text' }).press('Escape')
    await expect(card).toBeHidden()
    expect(await textEntities(page)).toHaveLength(0)
  })

  test('text on a circle: outside letters stand outwards, and the outlines extrude', async ({ page }) => {
    await newProject(page)
    await toolButton(page, 'Circle').click()
    await pickTopPlane(page)
    await clickWorld(page, [0, 0, 0])
    await expect(page.getByRole('group', { name: 'Shape size' })).toBeVisible()
    await page.keyboard.type('40')
    await page.keyboard.press('Enter')
    await expect.poll(async () => sketches(await doc(page))[0].sketch.entities.length).toBe(1)
    const circle = sketches(await doc(page))[0].sketch.entities[0]

    await toolButton(page, 'Text').click()
    await clickWorld(page, [-5, -5, 0])
    const card = textCard(page)
    await expect(card).toBeVisible()
    await card.getByRole('textbox', { name: 'Text' }).fill('ROUND')
    await card.getByRole('button', { name: 'Pick a curve' }).click()
    await clickWorld(page, [20, 0, 0])
    await expect(card.getByText('Circle 1')).toBeVisible()
    await expect(card.getByRole('radiogroup', { name: 'Side of the curve' })).toBeVisible()
    await card.getByLabel('Start').fill('25')
    await card.getByLabel('Start').blur()
    await expect(card.getByLabel('Rotation')).toBeDisabled()
    await card.getByRole('button', { name: 'Apply' }).click()
    await expect(card).toBeHidden()

    const t = (await textEntities(page))[0]
    expect(t.text).toBe('ROUND')
    expect(t.path?.entityId).toBe(circle.id)
    expect(t.path?.side).toBe('outside')
    expect(t.path?.offset).toBeCloseTo(0.25, 5)

    await extrudeTextRegions(page)
    await expect.poll(async () => (await bodyStats(page)).length).toBe(1)
    const [body] = await bodyStats(page)
    expect(body.volume).toBeGreaterThan(20)
    // Letters sit on the circle (radius 20) and reach out by the text size (10 mm).
    for (const v of [body.min[0], body.max[0], body.min[1], body.max[1]]) expect(Math.abs(v)).toBeLessThanOrEqual(31)
    const reach = Math.max(-body.min[0], body.max[0], -body.min[1], body.max[1])
    expect(reach).toBeGreaterThan(24)
  })

  test('clicking one letter with Extrude picks the whole text; Alt+click picks that one letter', async ({ page }) => {
    await helloAndExtrudeTool(page)
    const boxes = (await regionBoxes(page)).filter((b) => b.name.includes('~')).sort((a, b) => a.min[0] - b.min[0])
    expect(boxes.length).toBe(5)
    // Inside the left stem of the H: a fifth of the way up, a little in from the left edge.
    const h = boxes[0]
    await clickWorld(page, [h.min[0] + 1.6, h.min[1] + (h.max[1] - h.min[1]) * 0.2, 0])
    const card = extrudeCard(page)
    await expect(card).toBeVisible()
    await expect(card.getByText('Text “HELLO”')).toBeVisible()
    expect(await selectedRegions(page)).toEqual([expect.stringMatching(/\/region:[^~]+~\*$/)])
    await expect(card.getByText(/region:|~/)).toHaveCount(0)

    // Alt+click on the first L (third letter) picks just that letter.
    const l = boxes[2]
    await page.keyboard.down('Alt')
    await clickWorld(page, [l.min[0] + 1.6, l.min[1] + (l.max[1] - l.min[1]) * 0.5, 0])
    await page.keyboard.up('Alt')
    await expect(card.getByText(/Letter \d of “HELLO”/)).toBeVisible()
    expect(await selectedRegions(page)).toEqual([expect.stringMatching(/~\d+$/)])
  })

  test('the whole text extrudes with every letter, and a letter added later is included', async ({ page }) => {
    await helloAndExtrudeTool(page)
    const boxes = (await regionBoxes(page)).filter((b) => b.name.includes('~')).sort((a, b) => a.min[0] - b.min[0])
    const h = boxes[0]
    await clickWorld(page, [h.min[0] + 1.6, h.min[1] + (h.max[1] - h.min[1]) * 0.2, 0])
    const card = extrudeCard(page)
    await expect(card.getByText('Text “HELLO”')).toBeVisible()
    await card.getByLabel('Distance').fill('3')
    await card.getByLabel('Distance').blur()
    await settle(page)
    await card.getByRole('button', { name: 'Apply' }).click()
    await expect(card).toBeHidden()
    await expect.poll(async () => (await bodyStats(page)).length).toBe(1)
    const before = (await bodyStats(page))[0]
    expect(before.volume).toBeGreaterThan(300)
    // The step keeps the whole-text ref, not a list of letters.
    const ref = extrudes(await doc(page))[0].params.profiles
    expect(ref).toHaveLength(1)
    expect(ref[0].name).toMatch(/~\*$/)
    // Change the wording upstream: the solid follows.
    await page.evaluate(() => {
      const s = window.__3dparter!.store.getState()
      s.apply('Edit text', (d) => {
        const f = d.features.find((x) => x.type === 'sketch')
        if (f?.type !== 'sketch') return
        const t = f.sketch.entities.find((e) => e.type === 'text')
        if (t?.type === 'text') t.text = 'HELLO!!'
      })
    })
    await expect.poll(async () => (await bodyStats(page))[0].volume).toBeGreaterThan(before.volume + 20)
  })

  test('the text size follows a variable and a change that makes it zero is refused', async ({ page }) => {
    await newProject(page)
    expect((await variableCommand(page, 'addVariable', 'h', '10')).ok).toBe(true)
    await toolButton(page, 'Text').click()
    await pickTopPlane(page)
    await clickWorld(page, [-10, 0, 0])
    const card = textCard(page)
    await expect(card).toBeVisible()
    await card.getByRole('textbox', { name: 'Text' }).fill('Hi')
    const size = card.getByLabel('Size')
    await size.fill('h * 2')
    await size.blur()
    await card.getByRole('button', { name: 'Apply' }).click()
    await expect(card).toBeHidden()
    await expect.poll(async () => (await textEntities(page))[0]?.size).toBeCloseTo(20, 5)
    expect((await textEntities(page))[0].sizeExpr).toBe('h * 2')

    const id = (await variablesOf(page))[0].id
    expect((await variableCommand(page, 'setVariableExpression', id, '15')).ok).toBe(true)
    await expect.poll(async () => (await textEntities(page))[0].size).toBeCloseTo(30, 5)
    const refused = await variableCommand(page, 'setVariableExpression', id, '0')
    expect(refused.ok).toBe(false)
    expect((await textEntities(page))[0].size).toBeCloseTo(30, 5)
    await page.evaluate(() => window.__3dparter!.store.getState().undo())
    await expect.poll(async () => (await textEntities(page))[0].size).toBeCloseTo(20, 5)
  })

  test('the text card has no accessibility violations', async ({ page }) => {
    await newProject(page)
    await toolButton(page, 'Text').click()
    await pickTopPlane(page)
    await clickWorld(page, [0, 0, 0])
    await expect(textCard(page)).toBeVisible()
    await waitCameraStable(page)
    const results = await new AxeBuilder({ page }).exclude('canvas').analyze()
    const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical' || v.impact === 'moderate')
    expect(blocking.map((v) => `${v.id} (${v.impact})`)).toEqual([])
  })
})

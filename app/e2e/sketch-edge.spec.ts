// Sketch edge cases and regressions: wide selection marks, persistence, phone width, keyboard, extreme values, reopening, slow engine.
import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import {
  bodyMeshes,
  buildBox,
  clickWorld,
  doc,
  drawRectangle,
  exportStl,
  extrudes,
  hasHorizontalScroll,
  near,
  newProject,
  pickTopPlane,
  savedProjects,
  sketches,
  toolButton,
  waitCameraStable,
  waitReady,
} from './helpers'

const bar = (page: Page) => page.getByRole('toolbar', { name: 'Constraints', exact: true })
const chip = (page: Page, text: string | RegExp) => page.getByRole('status').filter({ hasText: text })
const entitiesOf = async (page: Page) => sketches(await doc(page)).flatMap((s) => s.sketch.entities)
const constraintsOf = async (page: Page) => sketches(await doc(page)).flatMap((s) => s.sketch.constraints)
const historyItem = (page: Page, name: string) =>
  page.getByRole('tree', { name: 'History' }).getByRole('treeitem', { name: new RegExp(name) })

/** Clicking the active tool again turns it off, which gives selection mode. */
async function selectionMode(page: Page, tool: string) {
  await toolButton(page, tool).click()
  await expect(toolButton(page, tool)).toHaveAttribute('aria-pressed', 'false')
}

test.describe('sketch edge cases', () => {
  test('BUG-007 selected sketch lines are drawn wide', async ({ page }) => {
    await newProject(page)
    await drawRectangle(page)
    await selectionMode(page, 'Rectangle')
    await clickWorld(page, [20, 0, 0])
    await expect(bar(page)).toBeVisible()
    const marks = await page.evaluate(() => {
      const eng = window.__3dshaper!.engine as unknown as { marksGroup: { children: Record<string, unknown>[] } }
      return eng.marksGroup.children.map((c) => ({
        wide: (c as { isLineSegments2?: boolean }).isLineSegments2 === true,
        width: ((c as { material?: { linewidth?: number } }).material?.linewidth ?? 0) as number,
      }))
    })
    expect(marks.length).toBeGreaterThan(0)
    expect(marks.some((m) => m.wide && m.width >= 4), JSON.stringify(marks)).toBe(true)
  })

  test('F04-E10 constraints and dimensions survive a reload', async ({ page }) => {
    await newProject(page)
    await drawRectangle(page)
    await expect(chip(page, 'Fully defined')).toBeVisible()
    const before = (await constraintsOf(page)).length
    expect(before).toBeGreaterThan(0)
    await page.getByRole('button', { name: 'Finish sketch' }).click()
    await expect
      .poll(async () => (await savedProjects(page)).flatMap((p) => sketches(p.document)).flatMap((s) => s.sketch.constraints).length)
      .toBe(before)
    await page.reload()
    await waitReady(page)
    await historyItem(page, 'Sketch 1').click()
    await expect(chip(page, 'Fully defined')).toBeVisible()
    expect((await constraintsOf(page)).length).toBe(before)
    await expect(page.getByRole('list', { name: 'Sketch constraints' }).getByRole('listitem')).toHaveCount(before)
  })

  test('F04-E11 sketching at phone width', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await newProject(page)
    await drawRectangle(page)
    await selectionMode(page, 'Rectangle')
    await clickWorld(page, [20, 0, 0])
    await expect(bar(page)).toBeVisible()
    const box = await bar(page).boundingBox()
    expect(box).toBeTruthy()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.y).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(390)
    expect(box!.y + box!.height).toBeLessThanOrEqual(844)
    const finish = page.getByRole('button', { name: 'Finish sketch' })
    await expect(finish).toBeVisible()
    const fb = (await finish.boundingBox())!
    const covered = await finish.evaluate(
      (el, c) => {
        const top = document.elementFromPoint(c.x, c.y)
        return !(top && (top === el || el.contains(top)))
      },
      { x: fb.x + fb.width / 2, y: fb.y + fb.height / 2 },
    )
    expect(covered, 'Finish sketch is not covered').toBe(false)
    expect(await hasHorizontalScroll(page)).toBe(false)
  })

  test('F04-E12 keyboard only: delete a constraint from the side list', async ({ page }) => {
    await newProject(page)
    await drawRectangle(page)
    const before = (await constraintsOf(page)).length
    const del = page.getByRole('button', { name: /^Delete .* constraint$/ }).first()
    await del.focus()
    await expect(del).toBeFocused()
    await page.keyboard.press('Enter')
    await expect.poll(async () => (await constraintsOf(page)).length).toBe(before - 1)
    await page.keyboard.press('Control+z')
    await expect.poll(async () => (await constraintsOf(page)).length).toBe(before)
  })

  test('F04-E13 very large and very small values', async ({ page }) => {
    await newProject(page)
    await drawRectangle(page)
    const lineLengths = async () =>
      (await entitiesOf(page)).flatMap((e) => (e.type === 'line' ? [Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1])] : []))
    const field = page.getByRole('group', { name: 'Length value' })

    await page.getByRole('button', { name: /Length dimension 40 mm/ }).dblclick()
    await field.getByRole('textbox').fill('5000')
    await page.keyboard.press('Enter')
    await expect(field).toBeHidden()
    await expect.poll(async () => Math.max(...(await lineLengths()))).toBeGreaterThan(4999.99)
    near(Math.max(...(await lineLengths())), 5000, 1e-3)

    await page.getByRole('button', { name: /Length dimension 5000 mm/ }).dblclick({ force: true })
    await field.getByRole('textbox').fill('0.05')
    await page.keyboard.press('Enter')
    await expect(field).toBeHidden()
    await expect.poll(async () => (await lineLengths()).some((l) => Math.abs(l - 0.05) < 1e-6)).toBe(true)

    await page.getByRole('button', { name: /Length dimension 0\.05 mm/ }).dblclick({ force: true })
    await field.getByRole('textbox').fill('-5')
    await page.keyboard.press('Enter')
    await expect(field.getByText('The value must be greater than zero.')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(field).toBeHidden()
    await expect(page.getByRole('button', { name: /Length dimension 0\.05 mm/ })).toBeVisible()
    expect((await lineLengths()).some((l) => Math.abs(l - 0.05) < 1e-6)).toBe(true)
  })

  test('F04-E14 Enter twice on the dimension field adds one constraint', async ({ page }) => {
    await newProject(page)
    await toolButton(page, 'Line').click()
    await pickTopPlane(page)
    await clickWorld(page, [0, 0, 0])
    await clickWorld(page, [30, 0, 0])
    await page.keyboard.press('Escape')
    await selectionMode(page, 'Line')
    await clickWorld(page, [15, 0, 0])
    const before = (await constraintsOf(page)).filter((c) => c.type === 'length').length
    await page.keyboard.press('d')
    const field = page.getByRole('group', { name: 'Length value' })
    await expect(field).toBeVisible()
    await field.getByRole('textbox').fill('25')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(400)
    await expect(field).toBeHidden()
    expect((await constraintsOf(page)).filter((c) => c.type === 'length')).toHaveLength(before + 1)
  })

  test('F02-E1 reopen a used sketch and add a shape', async ({ page }) => {
    await newProject(page)
    await buildBox(page)
    const first = (await exportStl(page)).info
    await historyItem(page, 'Sketch 1').click()
    await waitCameraStable(page)
    await toolButton(page, 'Rectangle').click()
    // The camera zooms in on the sketch, so the second rectangle goes to the left of the first (the right is under the side panel).
    await clickWorld(page, [-30, 5, 0])
    await clickWorld(page, [-10, 15, 0])
    await expect.poll(async () => (await entitiesOf(page)).length).toBe(8)
    await page.getByRole('button', { name: 'Finish sketch' }).click()
    await expect(historyItem(page, 'Extrude 1')).toBeVisible()
    await expect(historyItem(page, 'Extrude 1')).not.toContainText('Error:')
    await expect(page.getByRole('alert')).toHaveCount(0)
    expect(extrudes(await doc(page))).toHaveLength(1)
    await expect.poll(() => bodyMeshes(page)).toBe(1)
    const after = (await exportStl(page)).info
    near(after.volume, first.volume, 0.01)
    for (let i = 0; i < 3; i++) near(after.size[i], first.size[i], 0.01)
  })

  test('F01-E8 slow engine load', async ({ page }) => {
    let delayed = 0
    await page.route(/replicad_single.*\.wasm/, async (route) => {
      delayed++
      await new Promise((r) => setTimeout(r, 3000))
      await route.continue()
    })
    await page.goto('/')
    await page.getByRole('button', { name: 'New project' }).first().click()
    await expect(page).toHaveURL(/#\/p\//)
    await expect(page.getByText('Loading geometry engine…').first()).toBeVisible()
    // Sketching works while the engine loads.
    await toolButton(page, 'Rectangle').click()
    await pickTopPlane(page)
    await clickWorld(page, [0, 0, 0])
    await expect(page.getByRole('group', { name: 'Shape size' })).toBeVisible()
    await page.keyboard.type('40')
    await page.keyboard.press('Tab')
    await page.keyboard.type('20')
    await page.keyboard.press('Enter')
    await expect.poll(async () => (await entitiesOf(page)).length).toBe(4)
    await waitReady(page)
    expect(delayed, 'the kernel wasm request was intercepted').toBeGreaterThan(0)
    await page.getByRole('button', { name: 'Finish sketch' }).click()
    await toolButton(page, 'Extrude').click()
    await page.getByRole('dialog', { name: 'Extrude', exact: true }).getByRole('button', { name: 'Apply' }).click()
    await expect.poll(() => bodyMeshes(page)).toBe(1)
  })
})

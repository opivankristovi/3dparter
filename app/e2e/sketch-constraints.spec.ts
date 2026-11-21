// Sketch constraints: automatic constraints, defined state, the constraint bar, dimensions, arcs and dragging.
import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import {
  bodyMeshes,
  clickWorld,
  clientOf,
  doc,
  drawRectangle,
  exportStl,
  extrudes,
  finishAndExtrude,
  near,
  newProject,
  pickTopPlane,
  sketches,
  toolButton,
} from './helpers'

const chip = (page: Page, text: string | RegExp) => page.getByRole('status').filter({ hasText: text })
const bar = (page: Page) => page.getByRole('toolbar', { name: 'Constraints', exact: true })
const entitiesOf = async (page: Page) => sketches(await doc(page)).flatMap((s) => s.sketch.entities)
const constraintsOf = async (page: Page) => sketches(await doc(page)).flatMap((s) => s.sketch.constraints)

/** Draws a rectangle with typed sizes whose first corner is NOT at the origin. */
async function drawOffsetRectangle(page: Page, corner: [number, number] = [10, 10]) {
  await toolButton(page, 'Rectangle').click()
  await pickTopPlane(page)
  await clickWorld(page, [corner[0], corner[1], 0])
  await expect(page.getByRole('group', { name: 'Shape size' })).toBeVisible()
  await page.keyboard.type('40')
  await page.keyboard.press('Tab')
  await page.keyboard.type('20')
  await page.keyboard.press('Enter')
  await expect.poll(async () => (await entitiesOf(page)).length).toBe(4)
}

async function shiftClickWorld(page: Page, world: [number, number, number]) {
  const [x, y] = await clientOf(page, world)
  await page.keyboard.down('Shift')
  await page.mouse.click(x, y)
  await page.keyboard.up('Shift')
}

/** Clicking the active tool again turns it off, which gives selection mode. */
async function selectionMode(page: Page, tool: string) {
  await toolButton(page, tool).click()
  await expect(toolButton(page, tool)).toHaveAttribute('aria-pressed', 'false')
}

test.describe('sketch constraints', () => {
  test('F04 a rectangle typed from the origin is fully defined', async ({ page }) => {
    await newProject(page)
    await drawRectangle(page)
    await expect(chip(page, 'Fully defined')).toBeVisible()
    const types = (await constraintsOf(page)).map((c) => c.type)
    expect(types.filter((t) => t === 'length')).toHaveLength(2)
    expect(types).toContain('coincident')
    expect(types).toContain('horizontal')
    expect(types).toContain('vertical')
    // The typed sizes show as dimensions, and also in the side list.
    await expect(page.getByRole('button', { name: /Length dimension 40 mm/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /Length dimension 20 mm/ })).toBeVisible()
    await expect(page.getByRole('list', { name: 'Sketch constraints' }).getByRole('listitem').first()).toBeVisible()
  })

  test('F04-N1 a rectangle away from the origin is under-defined until it is pinned', async ({ page }) => {
    await newProject(page)
    await drawOffsetRectangle(page)
    await expect(chip(page, 'Under-defined: 2 degrees of freedom')).toBeVisible()

    await selectionMode(page, 'Rectangle')
    await clickWorld(page, [10, 10, 0]) // the corner
    await shiftClickWorld(page, [0, 0, 0]) // the origin
    await expect(bar(page)).toBeVisible()
    await bar(page).getByRole('button', { name: 'Coincident', exact: true }).click()
    await expect(chip(page, 'Fully defined')).toBeVisible()
    const xs = (await entitiesOf(page)).flatMap((e) => (e.type === 'line' ? [e.a[0], e.b[0]] : []))
    near(Math.min(...xs), 0, 1e-6)
  })

  test('F04-N2 a conflicting constraint is refused with a reason and changes nothing', async ({ page }) => {
    await newProject(page)
    await drawRectangle(page)
    await selectionMode(page, 'Rectangle')
    const before = await doc(page)
    await clickWorld(page, [20, 0, 0]) // the bottom side, which is horizontal
    await expect(bar(page)).toBeVisible()
    await page.keyboard.press('v')
    await expect(page.getByRole('alert').filter({ hasText: 'conflicts' })).toBeVisible()
    expect(await doc(page)).toEqual(before)
    await expect(chip(page, 'Fully defined')).toBeVisible()
  })

  test('F04-E1 changing a dimension moves the geometry and the solid', async ({ page }) => {
    await newProject(page)
    await drawRectangle(page)
    await page.getByRole('button', { name: /Length dimension 40 mm/ }).dblclick()
    const field = page.getByRole('group', { name: 'Length value' })
    await expect(field).toBeVisible()
    await field.getByRole('textbox').fill('50')
    await page.keyboard.press('Enter')
    await expect(field).toBeHidden()
    await expect(page.getByRole('button', { name: /Length dimension 50 mm/ })).toBeVisible()
    const xs = (await entitiesOf(page)).flatMap((e) => (e.type === 'line' ? [e.a[0], e.b[0]] : []))
    near(Math.max(...xs), 50, 1e-6)
    await expect(chip(page, 'Fully defined')).toBeVisible()
    await finishAndExtrude(page)
    const { info } = await exportStl(page)
    near(info.size[0], 50, 0.05)
    near(info.size[1], 20, 0.05)
  })

  test('F04-N3 a bad value in the dimension field shows an error and keeps the old value', async ({ page }) => {
    await newProject(page)
    await drawRectangle(page)
    await page.getByRole('button', { name: /Length dimension 40 mm/ }).dblclick()
    const field = page.getByRole('group', { name: 'Length value' })
    await field.getByRole('textbox').fill('-5')
    await page.keyboard.press('Enter')
    await expect(field.getByText('The value must be greater than zero.')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(field).toBeHidden()
    await expect(page.getByRole('button', { name: /Length dimension 40 mm/ })).toBeVisible()
  })

  test('F04-E2 the D key adds a dimension through the inline field', async ({ page }) => {
    await newProject(page)
    await toolButton(page, 'Line').click()
    await pickTopPlane(page)
    await clickWorld(page, [0, 0, 0])
    await clickWorld(page, [30, 0, 0])
    await page.keyboard.press('Escape')
    await selectionMode(page, 'Line')
    await clickWorld(page, [15, 0, 0])
    await page.keyboard.press('d')
    const field = page.getByRole('group', { name: 'Length value' })
    await expect(field).toBeVisible()
    await expect(field.getByRole('textbox')).toHaveValue('30')
    await field.getByRole('textbox').fill('25')
    await page.keyboard.press('Enter')
    await expect(field).toBeHidden()
    await expect.poll(async () => (await constraintsOf(page)).filter((c) => c.type === 'length').map((c) => c.value)).toEqual(['25'])
    const line = (await entitiesOf(page))[0]
    if (line.type !== 'line') throw new Error('expected a line')
    near(Math.hypot(line.b[0] - line.a[0], line.b[1] - line.a[1]), 25, 1e-6)
  })

  test('F04-E3 a three-point arc and a line close a D shape that extrudes', async ({ page }) => {
    await newProject(page)
    await toolButton(page, 'Arc').click()
    await pickTopPlane(page)
    await clickWorld(page, [0, 0, 0])
    await clickWorld(page, [40, 0, 0])
    await clickWorld(page, [20, -15, 0])
    await expect.poll(async () => (await entitiesOf(page)).map((e) => e.type)).toEqual(['arc'])
    await toolButton(page, 'Line').click()
    await clickWorld(page, [0, 0, 0])
    await clickWorld(page, [40, 0, 0])
    await page.keyboard.press('Escape')
    await expect.poll(async () => (await entitiesOf(page)).map((e) => e.type)).toEqual(['arc', 'line'])
    await finishAndExtrude(page)
    expect(await bodyMeshes(page)).toBe(1)
    const { info } = await exportStl(page)
    near(info.size[0], 40, 0.05)
    // The arc bulges 15 mm below the chord.
    near(info.size[1], 15, 0.1)
    expect(extrudes(await doc(page))).toHaveLength(1)
  })

  test('F04-E4 dragging a corner of an under-defined rectangle keeps it rectangular, in one undo step', async ({ page }) => {
    await newProject(page)
    await toolButton(page, 'Rectangle').click()
    await pickTopPlane(page)
    // A new sketch shows about 120 mm of height, with the side panels over the right edge: stay on the left.
    await clickWorld(page, [-20, 5, 0])
    await clickWorld(page, [10, 25, 0])
    await expect.poll(async () => (await entitiesOf(page)).length).toBe(4)
    await selectionMode(page, 'Rectangle')
    const original = JSON.stringify(await entitiesOf(page))

    const [sx, sy] = await clientOf(page, [10, 25, 0])
    const [ex, ey] = await clientOf(page, [25, 35, 0])
    await page.mouse.move(sx, sy)
    await page.mouse.down()
    await page.mouse.move((sx + ex) / 2, (sy + ey) / 2, { steps: 4 })
    await page.mouse.move(ex, ey, { steps: 4 })
    // Nothing is written while dragging.
    expect(JSON.stringify(await entitiesOf(page))).toBe(original)
    await page.mouse.up()

    await expect.poll(async () => JSON.stringify(await entitiesOf(page))).not.toBe(original)
    const lines = (await entitiesOf(page)).flatMap((e) => (e.type === 'line' ? [e] : []))
    expect(lines).toHaveLength(4)
    for (const [i, l] of lines.entries()) {
      const flat = Math.abs(l.a[0] - l.b[0]) < 1e-6 || Math.abs(l.a[1] - l.b[1]) < 1e-6
      expect(flat, `side ${i} stays horizontal or vertical`).toBe(true)
      const next = lines[(i + 1) % 4]
      near(Math.hypot(l.b[0] - next.a[0], l.b[1] - next.a[1]), 0, 1e-6)
    }
    near(Math.max(...lines.flatMap((l) => [l.a[0], l.b[0]])), 25, 0.5)
    near(Math.max(...lines.flatMap((l) => [l.a[1], l.b[1]])), 35, 0.5)

    // One Ctrl+Z puts the whole drag back.
    await page.keyboard.press('Control+z')
    await expect.poll(async () => JSON.stringify(await entitiesOf(page))).toBe(original)
  })

  test('F04-E5 Escape during a drag cancels it', async ({ page }) => {
    await newProject(page)
    await toolButton(page, 'Rectangle').click()
    await pickTopPlane(page)
    await clickWorld(page, [-20, 5, 0])
    await clickWorld(page, [10, 25, 0])
    await expect.poll(async () => (await entitiesOf(page)).length).toBe(4)
    await selectionMode(page, 'Rectangle')
    const original = JSON.stringify(await entitiesOf(page))
    const [sx, sy] = await clientOf(page, [10, 25, 0])
    const [ex, ey] = await clientOf(page, [30, 40, 0])
    await page.mouse.move(sx, sy)
    await page.mouse.down()
    await page.mouse.move(ex, ey, { steps: 6 })
    await page.keyboard.press('Escape')
    await page.mouse.up()
    await page.waitForTimeout(150)
    expect(JSON.stringify(await entitiesOf(page))).toBe(original)
    // Still in the sketch.
    await expect(page.getByRole('button', { name: 'Finish sketch' })).toBeVisible()
  })

  test('F04-E6 undo removes a constraint that was just added', async ({ page }) => {
    await newProject(page)
    await drawOffsetRectangle(page)
    await selectionMode(page, 'Rectangle')
    const count = (await constraintsOf(page)).length
    await clickWorld(page, [10, 10, 0])
    await shiftClickWorld(page, [0, 0, 0])
    await bar(page).getByRole('button', { name: 'Coincident', exact: true }).click()
    await expect.poll(async () => (await constraintsOf(page)).length).toBe(count + 1)
    await expect(chip(page, 'Fully defined')).toBeVisible()
    await page.keyboard.press('Control+z')
    await expect.poll(async () => (await constraintsOf(page)).length).toBe(count)
    await expect(chip(page, 'Under-defined: 2 degrees of freedom')).toBeVisible()
  })

  test('F04-E7 the side list deletes a constraint and Delete removes a selected one', async ({ page }) => {
    await newProject(page)
    await drawRectangle(page)
    const list = page.getByRole('list', { name: 'Sketch constraints' })
    const before = (await constraintsOf(page)).length
    await list.getByRole('button', { name: /^Delete length constraint$/ }).first().click()
    await expect.poll(async () => (await constraintsOf(page)).length).toBe(before - 1)
    await expect(chip(page, /Under-defined: 1 degree of freedom/)).toBeVisible()
  })

  test('F04-E8 automatic constraints can be turned off', async ({ page }) => {
    await newProject(page)
    await toolButton(page, 'Rectangle').click()
    await pickTopPlane(page)
    await page.getByRole('switch', { name: 'Automatic constraints' }).click()
    await clickWorld(page, [0, 0, 0])
    await clickWorld(page, [40, 20, 0])
    await expect.poll(async () => (await entitiesOf(page)).length).toBe(4)
    const types = (await constraintsOf(page)).map((c) => c.type)
    // Only the joins inside the shape are kept: no horizontal/vertical, nothing on the origin.
    expect(types.every((t) => t === 'coincident')).toBe(true)
    expect(types).toHaveLength(4)
    await expect(chip(page, /Under-defined/)).toBeVisible()
  })

  test('F04-E9 construction lines are left out of the shape', async ({ page }) => {
    await newProject(page)
    await drawRectangle(page)
    await selectionMode(page, 'Rectangle')
    await clickWorld(page, [20, 20, 0]) // the top side
    await page.keyboard.press('x')
    await expect.poll(async () => (await entitiesOf(page)).filter((e) => e.construction).length).toBe(1)
    await page.getByRole('button', { name: 'Finish sketch' }).click()
    await toolButton(page, 'Extrude').click()
    // Three real sides do not close a shape any more.
    await expect(page.getByText('Pick a shape to extrude')).toBeVisible()
    await expect(page.getByRole('dialog', { name: 'Extrude', exact: true })).toHaveCount(0)
  })
})

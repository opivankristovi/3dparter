// Regression tests for reproduced sketch bugs (replica/bugs.md: BUG-006, BUG-008, BUG-009, BUG-010).
import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { clickWorld, clientOf, doc, newProject, pickTopPlane, sketches, toolButton } from './helpers'

const bar = (page: Page) => page.getByRole('toolbar', { name: 'Constraints', exact: true })
const entitiesOf = async (page: Page) => sketches(await doc(page)).flatMap((s) => s.sketch.entities)

/** Clicking the active tool again turns it off, which gives selection mode. */
async function selectionMode(page: Page, tool: string) {
  await toolButton(page, tool).click()
  await expect(toolButton(page, tool)).toHaveAttribute('aria-pressed', 'false')
}

async function shiftClickWorld(page: Page, world: [number, number, number]) {
  const [x, y] = await clientOf(page, world)
  await page.keyboard.down('Shift')
  await page.mouse.click(x, y)
  await page.keyboard.up('Shift')
}

/** Line tool, Top plane, three sides closed back on the start. Leaves the tool (selection mode). */
async function drawTriangle(page: Page) {
  await toolButton(page, 'Line').click()
  await pickTopPlane(page)
  await clickWorld(page, [0, 0, 0])
  await clickWorld(page, [40, 0, 0])
  await clickWorld(page, [20, 35, 0])
  await clickWorld(page, [0, 0, 0])
  await expect.poll(async () => (await entitiesOf(page)).length).toBe(3)
  await selectionMode(page, 'Line')
}

test.describe('BUG-006 shape size card on a touch screen', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

  test('the card opens next to the tapped corner, below the top bar', async ({ page }) => {
    await newProject(page)
    await toolButton(page, 'Rectangle').click()
    await pickTopPlane(page)
    const [tx, ty] = await clientOf(page, [0, 0, 0])
    await page.touchscreen.tap(tx, ty)
    const card = page.getByRole('group', { name: 'Shape size' })
    await expect(card).toBeVisible()
    const box = (await card.boundingBox())!
    const topBar = (await page.getByRole('banner').boundingBox())!
    const view = page.viewportSize()!
    expect(box.y, 'card top is below the top bar').toBeGreaterThanOrEqual(topBar.y + topBar.height)
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(view.width)
    expect(box.y + box.height).toBeLessThanOrEqual(view.height)
    // Close to the tap (the card is allowed to be pushed back inside the screen).
    const dx = Math.max(box.x - tx, 0, tx - (box.x + box.width))
    const dy = Math.max(box.y - ty, 0, ty - (box.y + box.height))
    expect(Math.hypot(dx, dy), 'distance from the tap to the card').toBeLessThanOrEqual(60)
  })
})

test.describe('sketch bugs', () => {
  test('BUG-008 an angle at a triangle corner shows the inside angle, 0 to 180', async ({ page }) => {
    await newProject(page)
    await drawTriangle(page)
    const lines = (await entitiesOf(page)).flatMap((e) => (e.type === 'line' ? [e] : []))
    // The two sides that meet at the origin corner, with the arm leaving the corner for each.
    const arms = lines.flatMap((l) => {
      const atA = Math.hypot(l.a[0], l.a[1]) < 1e-6
      const atB = Math.hypot(l.b[0], l.b[1]) < 1e-6
      if (atA === atB) return []
      const far = atA ? l.b : l.a
      return [{ id: l.id, far }]
    })
    expect(arms).toHaveLength(2)
    const dot = arms[0].far[0] * arms[1].far[0] + arms[0].far[1] * arms[1].far[1]
    const expected = (Math.acos(dot / (Math.hypot(...arms[0].far) * Math.hypot(...arms[1].far))) * 180) / Math.PI

    await clickWorld(page, [20, 0, 0]) // base
    await shiftClickWorld(page, [10, 17.5, 0]) // left side
    await expect(bar(page)).toBeVisible()
    await bar(page).getByRole('button', { name: 'Angle', exact: true }).click()
    const field = page.getByRole('group', { name: 'Angle value' }).getByRole('textbox')
    await expect(field).toBeVisible()
    const shown = Number(await field.inputValue())
    expect(shown).toBeGreaterThan(0)
    expect(shown).toBeLessThanOrEqual(180)
    expect(Math.abs(shown - expected)).toBeLessThan(0.01)
  })

  test('BUG-009 the constraint bar stays clear of the dimension labels', async ({ page }) => {
    await newProject(page)
    await drawTriangle(page)
    // A horizontal distance between the origin and the apex draws its label above the sketch outline.
    await clickWorld(page, [0, 0, 0])
    await shiftClickWorld(page, [20, 35, 0])
    await expect(bar(page)).toBeVisible()
    await bar(page).getByRole('button', { name: 'Horizontal distance', exact: true }).click()
    await page.keyboard.type('30')
    await page.keyboard.press('Enter')
    const label = page.getByRole('button', { name: /Horizontal distance dimension/ })
    await expect(label).toBeVisible()
    await expect(bar(page)).toBeVisible()
    const dims = page.getByRole('button', { name: /dimension/ })
    const count = await dims.count()
    expect(count).toBeGreaterThan(0)
    const b = (await bar(page).boundingBox())!
    for (let i = 0; i < count; i++) {
      const d = (await dims.nth(i).boundingBox())!
      // A label must also not touch the bar: keep a 4 px gap.
      const gap = 4
      const overlap = b.x < d.x + d.width + gap && d.x < b.x + b.width + gap && b.y < d.y + d.height + gap && d.y < b.y + b.height + gap
      expect(overlap, `constraint bar overlaps dimension ${i} (${await dims.nth(i).getAttribute('aria-label')})`).toBe(false)
    }
  })

  test('BUG-010 Equal marks both of its lines', async ({ page }) => {
    await newProject(page)
    await drawTriangle(page)
    await clickWorld(page, [20, 0, 0]) // base
    await shiftClickWorld(page, [10, 17.5, 0]) // left side
    await expect(bar(page)).toBeVisible()
    await bar(page).getByRole('button', { name: 'Equal', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Equal constraint', exact: true })).toHaveCount(2)
  })
})

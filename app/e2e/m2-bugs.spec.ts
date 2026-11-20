// Regression tests for the M2 manual-pass bugs BUG-012 to BUG-015 (see replica/bugs.md).
import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import {
  bodyStats,
  buildBox,
  clickPickableNear,
  clickWorld,
  doc,
  extrudeCard,
  historyItem,
  newProject,
  settle,
  toolButton,
  waitCameraStable,
} from './helpers'

const TOP_X_EDGE: [number, number, number] = [20, 0, 10]

async function boxReady(page: Page) {
  await newProject(page)
  await buildBox(page)
  await settle(page)
  await waitCameraStable(page)
}

const card = (page: Page, name: string) => page.getByRole('dialog', { name, exact: true })

test.describe('BUG-012 Enter applies from any field of a tool card', () => {
  test('Fillet: typing 3 and pressing Enter at once applies a radius of 3', async ({ page }) => {
    await boxReady(page)
    await clickPickableNear(page, TOP_X_EDGE, 'edge')
    await page.keyboard.press('g')
    const c = card(page, 'Fillet')
    await expect(c.getByLabel('Radius')).toBeFocused()
    await page.keyboard.type('3')
    await page.keyboard.press('Enter')
    await expect(c).toBeHidden()
    await expect(historyItem(page, 'Fillet 1')).toBeVisible()
    const fillets = (await doc(page)).features.filter((f) => f.type === 'fillet')
    expect(fillets).toHaveLength(1)
    expect(fillets[0].type === 'fillet' && fillets[0].params.radius).toBe('3')
  })

  test('Plane: Enter in the Offset field applies', async ({ page }) => {
    await boxReady(page)
    await toolButton(page, 'Plane').click()
    const c = card(page, 'Plane')
    await expect(c).toBeVisible()
    await c.getByLabel('Offset').click()
    await page.keyboard.press('Enter')
    await expect(c).toBeHidden()
    await expect(historyItem(page, 'Plane 1')).toBeVisible()
  })

  test('Fillet: an invalid radius plus Enter adds nothing', async ({ page }) => {
    await boxReady(page)
    await clickPickableNear(page, TOP_X_EDGE, 'edge')
    await page.keyboard.press('g')
    const c = card(page, 'Fillet')
    await expect(c.getByLabel('Radius')).toBeFocused()
    const before = (await doc(page)).features.length
    await page.keyboard.type('abc')
    await page.keyboard.press('Enter')
    await settle(page)
    await expect(c).toBeVisible()
    await expect(c.getByText('There is no variable called abc.')).toBeVisible()
    expect((await doc(page)).features).toHaveLength(before)
  })
})

test.describe('BUG-013 Move gizmo handles stay apart', () => {
  test('the three handles do not overlap and sit well away from the gizmo origin', async ({ page }) => {
    await boxReady(page)
    await toolButton(page, 'Move').click()
    await expect(card(page, 'Move')).toBeVisible()
    await settle(page)
    const names = ['Move X handle', 'Move Y handle', 'Move Z handle']
    const boxes = []
    for (const n of names) {
      await expect(page.getByRole('button', { name: new RegExp(n) })).toBeVisible()
      const b = await page.getByRole('button', { name: new RegExp(n) }).boundingBox()
      expect(b, n).not.toBeNull()
      boxes.push(b!)
    }
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]
        const b = boxes[j]
        const apart = a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y
        expect(apart, `${names[i]} and ${names[j]} overlap: ${JSON.stringify([a, b])}`).toBe(true)
      }
    }
    const [ox, oy] = await page.evaluate(() => window.__3dshaper!.toClient([20, 10, 5]))
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i]
      const nearestX = Math.max(b.x, Math.min(ox, b.x + b.width))
      const nearestY = Math.max(b.y, Math.min(oy, b.y + b.height))
      expect(Math.hypot(nearestX - ox, nearestY - oy), `${names[i]} is too close to the origin`).toBeGreaterThanOrEqual(60)
    }
  })
})

/** Every corner of the 40 x 20 x 10 box lies between the tool rail and the side panel, and inside the canvas. */
async function expectBoxClearOfPanels(page: Page, height: number) {
  const rail = await page.getByRole('toolbar', { name: 'Tools' }).boundingBox()
  const side = await page.getByRole('complementary', { name: 'Project panels' }).boundingBox()
  expect(rail).not.toBeNull()
  expect(side).not.toBeNull()
  for (const x of [0, 40]) {
    for (const y of [0, 20]) {
      for (const z of [0, 10]) {
        const [px, py] = await page.evaluate((w) => window.__3dshaper!.toClient(w), [x, y, z] as [number, number, number])
        const at = `corner ${x},${y},${z}`
        expect(px, at).toBeGreaterThanOrEqual(rail!.x + rail!.width)
        expect(px, at).toBeLessThanOrEqual(side!.x)
        expect(py, at).toBeGreaterThanOrEqual(0)
        expect(py, at).toBeLessThanOrEqual(height)
      }
    }
  }
}

test.describe('BUG-014 framing leaves the panels out', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('F puts every corner of the box between the tool rail and the side panel', async ({ page }) => {
    await boxReady(page)
    await page.keyboard.press('f')
    await waitCameraStable(page)
    await expectBoxClearOfPanels(page, 800)
  })

  test('the first solid of a new project is framed clear of the panels too', async ({ page }) => {
    await boxReady(page)
    await expectBoxClearOfPanels(page, 800)
  })
})

test.describe('BUG-015 Cut that points away from the solid', () => {
  /** A 6 mm circle on the top face of the box, finished, with the Extrude card open. */
  async function circleOnTopFace(page: Page) {
    await boxReady(page)
    await toolButton(page, 'Circle').click()
    await clickPickableNear(page, [20, 10, 10], 'face')
    await expect.poll(async () => (await doc(page)).features.filter((f) => f.type === 'sketch').length).toBe(2)
    await waitCameraStable(page)
    await clickWorld(page, [20, 10, 10])
    await expect(page.getByRole('group', { name: 'Shape size' })).toBeVisible()
    await page.keyboard.type('6')
    await page.keyboard.press('Enter')
    await expect.poll(async () => (await doc(page)).features.find((f, i) => f.type === 'sketch' && i > 1)).toBeTruthy()
    await page.getByRole('button', { name: 'Finish sketch' }).click()
    await toolButton(page, 'Extrude').click()
    await expect(extrudeCard(page)).toBeVisible()
  }

  test('choosing Cut on a face-hosted profile goes into the solid, and Apply makes a hole', async ({ page }) => {
    await circleOnTopFace(page)
    const c = extrudeCard(page)
    await c.getByRole('radio', { name: 'Cut' }).click()
    await expect(c.getByRole('radio', { name: 'Flip' })).toBeChecked()
    await settle(page)
    await expect(c.getByText(/does not reach the solid/)).toBeHidden()
    await c.getByRole('button', { name: 'Apply' }).click()
    await expect(c).toBeHidden()
    await settle(page)
    const [stat] = await bodyStats(page)
    expect(Math.abs(stat.volume - (8000 - Math.PI * 9 * 10))).toBeLessThan(4)
  })

  test('a Cut that points away shows a note and cannot be applied', async ({ page }) => {
    await circleOnTopFace(page)
    const c = extrudeCard(page)
    await c.getByRole('radio', { name: 'Cut' }).click()
    await settle(page)
    await c.getByRole('radio', { name: 'One side' }).click()
    await settle(page)
    await expect(c.getByText('This cut does not reach the solid. Try Flip.')).toBeVisible()
    await expect(c.getByRole('button', { name: 'Apply' })).toBeDisabled()
    await c.getByRole('radio', { name: 'Flip' }).click()
    await settle(page)
    await expect(c.getByText(/does not reach the solid/)).toBeHidden()
    await expect(c.getByRole('button', { name: 'Apply' })).toBeEnabled()
  })
})

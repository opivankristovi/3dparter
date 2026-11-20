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
  drawRectangle,
  extrudeCard,
  newProject,
  pickTopPlane,
  settle,
  toolButton,
  waitCameraStable,
} from './helpers'

/** Scans the page; fails on moderate, serious and critical violations and lists every violation (id, impact, targets). */
async function scan(page: Page, screen: string) {
  const results = await new AxeBuilder({ page }).exclude('canvas').analyze()
  const lines = results.violations.map(
    (v) => `${v.id} [${v.impact}] x${v.nodes.length}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`,
  )
  for (const l of lines) console.log(`AXE ${screen}: ${l}`)
  if (lines.length === 0) console.log(`AXE ${screen}: no violations`)
  const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical' || v.impact === 'moderate')
  expect(
    blocking.map((v) => v.id),
    `axe violations on ${screen} (all, including minor/moderate):\n${lines.join('\n') || '(none)'}`,
  ).toEqual([])
}

test.describe('F01-E10 axe scans', () => {
  test('F01-E10 S02 dashboard', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('main').getByRole('listitem')).toHaveCount(1)
    await scan(page, 'S02 dashboard')
  })

  test('F01-E10 S03 workspace idle', async ({ page }) => {
    await newProject(page)
    await expect(page.getByRole('toolbar', { name: 'Tools' })).toBeVisible()
    await scan(page, 'S03 workspace idle')
  })

  test('F01-E10 S03 while sketching', async ({ page }) => {
    await newProject(page)
    await toolButton(page, 'Rectangle').click()
    await pickTopPlane(page)
    await clickWorld(page, [0, 0, 0])
    await expect(page.getByRole('group', { name: 'Shape size' })).toBeVisible()
    await scan(page, 'S03 while sketching')
  })

  test('F01-E10 S04 sketch with constraints, bar and dimension field', async ({ page }) => {
    await newProject(page)
    await drawRectangle(page)
    await toolButton(page, 'Rectangle').click() // selection mode
    await clickWorld(page, [20, 0, 0])
    await expect(page.getByRole('toolbar', { name: 'Constraints', exact: true })).toBeVisible()
    await scan(page, 'S04 constraint bar and overlay')
    await page.getByRole('button', { name: /Length dimension 40 mm/ }).dblclick()
    await expect(page.getByRole('group', { name: 'Length value' })).toBeVisible()
    await scan(page, 'S04 dimension field')
  })

  test('F01-E10 S05 Extrude card open', async ({ page }) => {
    await newProject(page)
    await drawRectangle(page)
    await page.getByRole('button', { name: 'Finish sketch' }).click()
    await toolButton(page, 'Extrude').click()
    await expect(extrudeCard(page)).toBeVisible()
    await waitCameraStable(page)
    await scan(page, 'S05 Extrude card')
  })

  test('F01-E10 S11 Export dialog open', async ({ page }) => {
    await newProject(page)
    await page.getByRole('button', { name: 'Export', exact: true }).click()
    await expect(page.getByRole('dialog', { name: 'Export' })).toBeVisible()
    await scan(page, 'S11 Export dialog (empty project)')
  })

  test('F01-E10 S12 Settings dialog open', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Settings' }).click()
    await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible()
    await scan(page, 'S12 Settings dialog')
  })
})

test.describe('F01-E10 axe scans, M2 tool cards', () => {
  const card = (page: Page, name: string) => page.getByRole('dialog', { name, exact: true })

  async function boxReady(page: Page) {
    await newProject(page)
    await buildBox(page)
    await settle(page)
    await waitCameraStable(page)
  }

  test('F01-E10 M2 Fillet card open with an edge picked', async ({ page }) => {
    await boxReady(page)
    await toolButton(page, 'Fillet').click()
    await expect(card(page, 'Fillet')).toBeVisible()
    await clickPickableNear(page, [20, 0, 10], 'edge')
    await expect(card(page, 'Fillet').getByText('1 edge')).toBeVisible()
    await settle(page)
    await scan(page, 'M2 Fillet card')
  })

  test('F01-E10 M2 Combine card open with two solids picked', async ({ page }) => {
    await boxReady(page)
    await addRectangleSketch(page, [20, 10, 0], '40', '20')
    await applyExtrude(page)
    await expect.poll(() => bodyMeshes(page)).toBe(2)
    await settle(page)
    await page.keyboard.press('Escape')
    await toolButton(page, 'Combine').click()
    await expect(card(page, 'Combine')).toBeVisible()
    await page.getByRole('tab', { name: 'Items' }).click()
    const tree = page.getByRole('tree', { name: 'Solids' })
    await tree.getByRole('treeitem', { name: 'Body 1' }).click()
    await tree.getByRole('treeitem', { name: 'Body 2' }).click()
    await settle(page)
    await scan(page, 'M2 Combine card')
  })

  test('F01-E10 M2 Revolve card open', async ({ page }) => {
    await newProject(page)
    await drawRectangle(page)
    await page.getByRole('button', { name: 'Finish sketch' }).click()
    await toolButton(page, 'Revolve').click()
    await expect(card(page, 'Revolve')).toBeVisible()
    await card(page, 'Revolve').getByRole('button', { name: 'Y axis' }).click()
    await settle(page)
    await scan(page, 'M2 Revolve card')
  })

  test('F01-E10 M2 Shell card open', async ({ page }) => {
    await boxReady(page)
    await toolButton(page, 'Shell').click()
    await expect(card(page, 'Shell')).toBeVisible()
    await clickPickableNear(page, [20, 10, 10], 'face')
    await expect(card(page, 'Shell').getByText('1 face')).toBeVisible()
    await settle(page)
    await scan(page, 'M2 Shell card')
  })

  test('F01-E10 M2 Move card open', async ({ page }) => {
    await boxReady(page)
    await toolButton(page, 'Move').click()
    await expect(card(page, 'Move')).toBeVisible()
    await settle(page)
    await scan(page, 'M2 Move card')
  })

  test('F01-E10 M2 Plane card open', async ({ page }) => {
    await boxReady(page)
    await toolButton(page, 'Plane').click()
    await expect(card(page, 'Plane')).toBeVisible()
    await settle(page)
    await scan(page, 'M2 Plane card')
  })
})

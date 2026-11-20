import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import {
  addRectangleSketch,
  applyExtrude,
  blendEdges,
  bodyMeshes,
  buildBox,
  clickPickableNear,
  clickWorld,
  drawRectangle,
  extrudeCard,
  historyItem,
  newProject,
  pickTopPlane,
  settle,
  toolButton,
  waitCameraStable,
} from './helpers'
import { PANEL_MOUNTED, addVariableInPanel, openVariables, variableCommand } from './variablesPanel'

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

test.describe('F03 axe scans, variables and expression fields', () => {
  test('F03-E3 Variables panel with rows, an error and the empty state', async ({ page }) => {
    test.fixme(!PANEL_MOUNTED, 'needs the panel mounted')
    await newProject(page)
    const panel = await openVariables(page)
    await scan(page, 'S08 Variables panel (empty)')
    await addVariableInPanel(page, panel, 'w', '40')
    await addVariableInPanel(page, panel, 'a', '2 * w')
    // A refused change shows its message on the field.
    const expr = panel.getByRole('group', { name: 'Variable w', exact: true }).getByLabel('Expression')
    await expr.fill('a')
    await expr.press('Enter')
    await expect(panel.getByText(/circle/).first()).toBeVisible()
    await scan(page, 'S08 Variables panel (rows and an error)')
  })

  test('F03-E3 an expression field with an unknown name, and with the suggestion list open', async ({ page }) => {
    await newProject(page)
    await variableCommand(page, 'addVariable', 'width', '40')
    await drawRectangle(page)
    await page.getByRole('button', { name: 'Finish sketch' }).click()
    await toolButton(page, 'Extrude').click()
    const card = extrudeCard(page)
    await expect(card).toBeVisible()
    await waitCameraStable(page)
    const distance = card.getByLabel('Distance')
    await distance.fill('widht')
    await expect(card.getByText('There is no variable called widht.')).toBeVisible()
    await scan(page, 'F03 Extrude field with an error')
    await distance.fill('wi')
    await expect(page.getByRole('listbox', { name: 'Variables' })).toBeVisible()
    await scan(page, 'F03 Extrude field with suggestions')
    await distance.fill('width * 2')
    await expect(card.getByText('= 80 mm')).toBeVisible()
    await scan(page, 'F03 Extrude field with a preview')
  })
})

test.describe('F02 axe scans, History', () => {
  test('F02 History list rolled back: marker, dimmed rows, Show all steps', async ({ page }) => {
    await newProject(page)
    await buildBox(page)
    await settle(page)
    await waitCameraStable(page)
    await blendEdges(page, 'Fillet', [[20, 0, 10]], '2')
    await blendEdges(page, 'Chamfer', [[20, 20, 10]], '1')
    const marker = page.getByRole('slider', { name: 'End of history' })
    await marker.focus()
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('ArrowUp')
    await expect(page.getByRole('button', { name: 'Show all steps' })).toBeVisible()
    await expect(historyItem(page, 'Fillet 1')).toHaveAttribute('data-inactive', '')
    await settle(page)
    await scan(page, 'F02 History rolled back')
  })
})

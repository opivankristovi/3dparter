// F03 Drive a design with variables: the Variables panel, expression fields and name suggestions.
// The tests that drive the panel itself are marked fixme until it is mounted in the sidebar's Variables tab
// (see PANEL_MOUNTED in variablesPanel.ts). The rest drive variables through the same commands the panel uses.
import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import {
  bodyStats,
  doc,
  drawRectangle,
  extrudeCard,
  extrudes,
  hasHorizontalScroll,
  newProject,
  settle,
  sketches,
  toolButton,
} from './helpers'
import { PANEL_MOUNTED, addVariableInPanel, openVariables, variableCommand, variableRow, variablesOf } from './variablesPanel'

const volumeOf = async (page: Page) => (await bodyStats(page))[0]?.volume ?? 0
const undo = (page: Page) => page.evaluate(() => window.__3dparter!.store.getState().undo())
const entitiesOf = async (page: Page) => sketches(await doc(page)).flatMap((s) => s.sketch.entities)
const historyExtrude = (page: Page) => page.getByRole('tree', { name: 'History' }).getByRole('treeitem', { name: /Extrude 1/ })

/** Finishes the open sketch, opens Extrude, types `distance`, and applies. */
async function extrudeWith(page: Page, distance: string) {
  await page.getByRole('button', { name: 'Finish sketch' }).click()
  await toolButton(page, 'Extrude').click()
  const card = extrudeCard(page)
  await expect(card).toBeVisible()
  await card.getByLabel('Distance').fill(distance)
  await card.getByLabel('Distance').blur()
  await settle(page)
  await card.getByRole('button', { name: 'Apply' }).click()
  await expect(card).toBeHidden()
  await expect.poll(async () => extrudes(await doc(page)).length).toBe(1)
  await settle(page)
}

test.describe('F03 variables', () => {
  test('F03-H1 a variable drives the extrude distance, and one undo step restores it', async ({ page }) => {
    test.fixme(!PANEL_MOUNTED, 'needs the panel mounted')
    await newProject(page)
    const panel = await openVariables(page)
    await addVariableInPanel(page, panel, 'w', '40')
    await drawRectangle(page)
    await extrudeWith(page, 'w')
    expect(extrudes(await doc(page))[0].params.distance).toBe('w')
    await expect.poll(() => volumeOf(page)).toBeGreaterThan(31990)
    expect(await volumeOf(page)).toBeLessThan(32010) // 40 x 20 x 40

    const expr = variableRow(panel, 'w').getByLabel('Expression')
    await expr.fill('25')
    await expr.press('Enter')
    await settle(page)
    await expect.poll(() => volumeOf(page)).toBeLessThan(20010) // height 25
    expect(await volumeOf(page)).toBeGreaterThan(19990)

    await undo(page)
    await settle(page)
    expect((await variablesOf(page)).find((v) => v.name === 'w')?.expression).toBe('40')
    await expect.poll(() => volumeOf(page)).toBeGreaterThan(31990)
    await expect(expr).toHaveValue('40')
  })

  test('F03-H1b the same through the commands: w = 40, distance "w", w = 25 is one undo step', async ({ page }) => {
    await newProject(page)
    expect((await variableCommand(page, 'addVariable', 'w', '40')).ok).toBe(true)
    await drawRectangle(page)
    await extrudeWith(page, 'w')
    await expect.poll(() => volumeOf(page)).toBeGreaterThan(31990)
    const id = (await variablesOf(page))[0].id
    expect((await variableCommand(page, 'setVariableExpression', id, '25')).ok).toBe(true)
    await settle(page)
    await expect.poll(() => volumeOf(page)).toBeLessThan(20010)
    expect(await volumeOf(page)).toBeGreaterThan(19990)
    await undo(page)
    await settle(page)
    await expect.poll(() => volumeOf(page)).toBeGreaterThan(31990)
    expect((await variablesOf(page))[0].expression).toBe('40')
  })

  test('F03-H2 a sketch length dimension "w / 2" follows w', async ({ page }) => {
    await newProject(page)
    await variableCommand(page, 'addVariable', 'w', '40')
    await drawRectangle(page)
    await page.getByRole('button', { name: /Length dimension 40 mm/ }).dblclick()
    const field = page.getByRole('group', { name: 'Length value' })
    await field.getByRole('textbox').fill('w / 2')
    await expect(field.getByText('= 20 mm')).toBeVisible() // the preview, while typing
    await page.keyboard.press('Enter')
    await expect(field).toBeHidden()
    await expect(page.getByRole('button', { name: /Length dimension w \/ 2 = 20 mm/ })).toBeVisible()
    const xs = async () => (await entitiesOf(page)).flatMap((e) => (e.type === 'line' ? [e.a[0], e.b[0]] : []))
    expect(Math.max(...(await xs()))).toBeCloseTo(20, 4)

    const id = (await variablesOf(page))[0].id
    expect((await variableCommand(page, 'setVariableExpression', id, '60')).ok).toBe(true)
    await expect(page.getByRole('button', { name: /Length dimension w \/ 2 = 30 mm/ })).toBeVisible()
    expect(Math.max(...(await xs()))).toBeCloseTo(30, 4)
    // Opening the field shows the expression, not the number.
    await page.getByRole('button', { name: /Length dimension w \/ 2 = 30 mm/ }).dblclick()
    await expect(page.getByRole('group', { name: 'Length value' }).getByRole('textbox')).toHaveValue('w / 2')
  })

  test('F03-E1 renaming w to width rewrites the extrude field', async ({ page }) => {
    test.fixme(!PANEL_MOUNTED, 'needs the panel mounted')
    await newProject(page)
    const panel = await openVariables(page)
    await addVariableInPanel(page, panel, 'w', '40')
    await drawRectangle(page)
    await extrudeWith(page, 'w')
    const name = variableRow(panel, 'w').getByLabel('Name', { exact: true })
    await name.fill('width')
    await name.press('Enter')
    await expect(variableRow(panel, 'width')).toBeVisible()
    expect(extrudes(await doc(page))[0].params.distance).toBe('width')
    // Open the step again: the field shows the name, not 40.
    await page.getByRole('tab', { name: 'History' }).click()
    await historyExtrude(page).click()
    await expect(extrudeCard(page).getByLabel('Distance')).toHaveValue('width')
  })

  test('F03-E1b renaming through the command rewrites the field, and the card shows the name', async ({ page }) => {
    await newProject(page)
    await variableCommand(page, 'addVariable', 'w', '40')
    await drawRectangle(page)
    await extrudeWith(page, 'w')
    const id = (await variablesOf(page))[0].id
    expect((await variableCommand(page, 'renameVariable', id, 'width')).ok).toBe(true)
    await historyExtrude(page).click()
    await expect(extrudeCard(page).getByLabel('Distance')).toHaveValue('width')
  })

  test('F03-N1 an unknown name in the extrude distance shows an error and Apply stays disabled', async ({ page }) => {
    await newProject(page)
    await drawRectangle(page)
    await page.getByRole('button', { name: 'Finish sketch' }).click()
    await toolButton(page, 'Extrude').click()
    const card = extrudeCard(page)
    const distance = card.getByLabel('Distance')
    await distance.fill('widht')
    // The message appears while typing, before the field is left.
    await expect(card.getByText('There is no variable called widht.')).toBeVisible()
    await expect(distance).toHaveAttribute('aria-invalid', 'true')
    const describedBy = await distance.getAttribute('aria-describedby')
    expect(describedBy).toBeTruthy()
    await expect(page.locator(`[id="${describedBy}"]`)).toHaveText('There is no variable called widht.')
    await distance.blur()
    await expect(card.getByRole('button', { name: 'Apply' })).toBeDisabled()
    await distance.focus()
    await page.keyboard.press('Enter')
    await settle(page)
    await expect(card).toBeVisible()
    expect(extrudes(await doc(page))).toHaveLength(0)
  })

  test('F03-N2 two variables that use each other in a circle are refused', async ({ page }) => {
    test.fixme(!PANEL_MOUNTED, 'needs the panel mounted')
    await newProject(page)
    const panel = await openVariables(page)
    await addVariableInPanel(page, panel, 'a', '10')
    await addVariableInPanel(page, panel, 'b', 'a')
    const expr = variableRow(panel, 'a').getByLabel('Expression')
    await expr.fill('b')
    await expr.press('Enter')
    await expect(variableRow(panel, 'a').getByText(/circle/)).toBeVisible()
    await expect(expr).toHaveValue('b') // the typed text stays
    expect((await variablesOf(page)).find((v) => v.name === 'a')?.expression).toBe('10')
  })

  test('F03-N2b the same through the command', async ({ page }) => {
    await newProject(page)
    await variableCommand(page, 'addVariable', 'a', '10')
    await variableCommand(page, 'addVariable', 'b', 'a')
    const a = (await variablesOf(page)).find((v) => v.name === 'a')!
    const r = await variableCommand(page, 'setVariableExpression', a.id, 'b')
    expect(r.ok).toBe(false)
    expect(r.message).toMatch(/circle/)
  })

  test('F03-N3 deleting a variable that is used is refused and lists where', async ({ page }) => {
    test.fixme(!PANEL_MOUNTED, 'needs the panel mounted')
    await newProject(page)
    const panel = await openVariables(page)
    await addVariableInPanel(page, panel, 'w', '40')
    await drawRectangle(page)
    await extrudeWith(page, 'w')
    await variableRow(panel, 'w').getByRole('button', { name: 'Delete variable w' }).click()
    await expect(variableRow(panel, 'w').getByRole('alert')).toContainText('Extrude 1 (Distance)')
    expect(await variablesOf(page)).toHaveLength(1)
    // An unused variable goes.
    await addVariableInPanel(page, panel, 'spare', '5')
    await variableRow(panel, 'spare').getByRole('button', { name: 'Delete variable spare' }).click()
    await expect(variableRow(panel, 'spare')).toHaveCount(0)
  })

  test('F03-N3b the delete command is refused with the uses', async ({ page }) => {
    await newProject(page)
    await variableCommand(page, 'addVariable', 'w', '40')
    await drawRectangle(page)
    await extrudeWith(page, 'w')
    const r = await variableCommand(page, 'deleteVariable', (await variablesOf(page))[0].id)
    expect(r.ok).toBe(false)
    expect(r.message).toContain('Extrude 1 (Distance)')
  })

  test('F03-H3 units in an expression: "1 in + 5" is 30.4 mm, shown while typing and stored as typed', async ({ page }) => {
    await newProject(page)
    await drawRectangle(page)
    await page.getByRole('button', { name: 'Finish sketch' }).click()
    await toolButton(page, 'Extrude').click()
    const card = extrudeCard(page)
    const distance = card.getByLabel('Distance')
    await distance.fill('1 in + 5')
    await expect(card.getByText('= 30.4 mm')).toBeVisible()
    await distance.blur()
    await settle(page)
    await card.getByRole('button', { name: 'Apply' }).click()
    await expect(card).toBeHidden()
    await expect.poll(async () => extrudes(await doc(page)).length).toBe(1)
    expect(extrudes(await doc(page))[0].params.distance).toBe('1 in + 5')
    await settle(page)
    await expect.poll(() => volumeOf(page)).toBeGreaterThan(40 * 20 * 30.4 - 20)
    expect(await volumeOf(page)).toBeLessThan(40 * 20 * 30.4 + 20)
  })

  test('F03-H4 name suggestions: ArrowDown and Enter pick a variable, Escape closes the list', async ({ page }) => {
    await newProject(page)
    await variableCommand(page, 'addVariable', 'width', '40')
    await variableCommand(page, 'addVariable', 'wall', '2')
    await drawRectangle(page)
    await page.getByRole('button', { name: 'Finish sketch' }).click()
    await toolButton(page, 'Extrude').click()
    const card = extrudeCard(page)
    const distance = card.getByLabel('Distance')
    await distance.fill('2 * w')
    const list = page.getByRole('listbox', { name: 'Variables' })
    await expect(list.getByRole('option')).toHaveText([/^width/, /^wall/])
    await expect(distance).toHaveAttribute('role', 'combobox')
    await expect(distance).toHaveAttribute('aria-expanded', 'true')
    await page.keyboard.press('ArrowDown')
    await expect(list.getByRole('option').nth(1)).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('Enter') // accepts the first; does not apply the card
    await expect(distance).toHaveValue('2 * width')
    await expect(list).toBeHidden()
    await expect(card).toBeVisible()
    await expect(card.getByText('= 80 mm')).toBeVisible()
    // Escape closes the list and leaves the card open.
    await distance.fill('2 * wa')
    await expect(list).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(list).toBeHidden()
    await expect(card).toBeVisible()
    // Tab accepts.
    await distance.fill('wa')
    await page.keyboard.press('Tab')
    await expect(distance).toHaveValue('wall')
  })

  test('F03-E2 the panel is usable at phone width @mobile', async ({ page }) => {
    test.fixme(!PANEL_MOUNTED, 'needs the panel mounted')
    await newProject(page)
    const panel = await openVariables(page)
    await expect(panel.getByText('No variables yet')).toBeVisible()
    const row = await addVariableInPanel(page, panel, 'width', '2 * 20')
    await expect(row.getByText('= 40')).toBeVisible()
    for (const el of [row.getByLabel('Name', { exact: true }), row.getByLabel('Expression'), row.getByRole('button', { name: /Delete variable/ })]) {
      const b = await el.boundingBox()
      expect(b).toBeTruthy()
      expect(b!.x).toBeGreaterThanOrEqual(0)
      expect(b!.x + b!.width).toBeLessThanOrEqual(390.5)
    }
    expect(await hasHorizontalScroll(page)).toBe(false)
  })
})

// M3 test pass: edge and negative cases for F03 (variables) and the History marker that the build specs
// (variables.spec.ts, history.spec.ts) do not cover. Case ids match replica/test-plan.md.
import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import {
  blendEdges,
  bodyStats,
  buildBox,
  doc,
  drawRectangle,
  extrudeCard,
  extrudes,
  hasHorizontalScroll,
  historyItem,
  newProject,
  settle,
  toolButton,
  waitCameraStable,
  waitReady,
} from './helpers'
import { addVariableInPanel, openVariables, variableCommand, variableRow, variablesOf } from './variablesPanel'

const volumeOf = async (page: Page) => (await bodyStats(page))[0]?.volume ?? 0
const undo = (page: Page) => page.evaluate(() => window.__3dparter!.store.getState().undo())

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

async function setExpression(page: Page, panelRow: ReturnType<typeof variableRow>, text: string) {
  const expr = panelRow.getByLabel('Expression')
  await expr.fill(text)
  await expr.press('Enter')
  await settle(page)
}

test.describe('F03 variables: M3 test pass', () => {
  test('F03-E3 a sketch dimension driven by a derived variable follows the base variable (BUG-016)', async ({ page }) => {
    await newProject(page)
    const panel = await openVariables(page)
    await addVariableInPanel(page, panel, 'w', '30')
    await addVariableInPanel(page, panel, 'h', 'w / 2')
    await drawRectangle(page)
    await page.getByRole('button', { name: /Length dimension 40 mm/ }).dblclick()
    const field = page.getByRole('group', { name: 'Length value' })
    await field.getByRole('textbox').fill('h')
    await page.keyboard.press('Enter')
    await expect(field).toBeHidden()
    await extrudeWith(page, '10')
    await expect.poll(() => volumeOf(page)).toBeCloseTo(15 * 20 * 10, 0)

    await setExpression(page, variableRow(panel, 'w'), '50')
    expect((await variablesOf(page)).find((v) => v.name === 'w')?.expression).toBe('50')
    // h is now 25: the rectangle and the solid must follow.
    await expect.poll(() => volumeOf(page)).toBeCloseTo(25 * 20 * 10, 0)
    await undo(page)
    await settle(page)
    await expect.poll(() => volumeOf(page)).toBeCloseTo(15 * 20 * 10, 0)
  })

  test('F03-N4 a derived value that would break a sketch is refused, like a direct one (BUG-016)', async ({ page }) => {
    await newProject(page)
    await variableCommand(page, 'addVariable', 'w', '30')
    await variableCommand(page, 'addVariable', 'h', 'w - 10')
    await drawRectangle(page)
    await page.getByRole('button', { name: /Length dimension 40 mm/ }).dblclick()
    await page.getByRole('group', { name: 'Length value' }).getByRole('textbox').fill('h')
    await page.keyboard.press('Enter')
    const w = (await variablesOf(page)).find((v) => v.name === 'w')!.id
    // h would be 0: a zero-length side.
    const r = await variableCommand(page, 'setVariableExpression', w, '10')
    expect(r.ok).toBe(false)
    expect(r.message).toBe('Sketch 1 can no longer be solved with this value.')
    expect((await variablesOf(page)).find((v) => v.name === 'w')?.expression).toBe('30')
  })

  test('F03-E4 a unit of the wrong kind is refused: "45 deg" as a distance (BUG-017)', async ({ page }) => {
    await newProject(page)
    await drawRectangle(page)
    await page.getByRole('button', { name: 'Finish sketch' }).click()
    await toolButton(page, 'Extrude').click()
    const card = extrudeCard(page)
    const distance = card.getByLabel('Distance')
    for (const text of ['45 deg', '45°', '10 + 5 deg']) {
      await distance.fill(text)
      await expect(distance, text).toHaveAttribute('aria-invalid', 'true')
      await expect(card.getByText(/angle/i).first(), text).toBeVisible()
    }
    await distance.blur()
    await expect(card.getByRole('button', { name: 'Apply' })).toBeDisabled()
    expect(extrudes(await doc(page))).toHaveLength(0)
  })

  test('F03-E5 a 60-character name fits the panel and is saved exactly', async ({ page }) => {
    await newProject(page)
    const panel = await openVariables(page)
    const long = 'a_very_long_variable_name_for_the_overall_width_of_the_part1'
    expect(long).toHaveLength(60)
    const row = await addVariableInPanel(page, panel, long, '40')
    expect((await variablesOf(page))[0].name).toBe(long)
    const p = (await panel.boundingBox())!
    for (const el of [row.getByLabel('Name', { exact: true }), row.getByLabel('Expression'), row.getByRole('button', { name: /Delete variable/ })]) {
      const b = (await el.boundingBox())!
      expect(b.x + b.width).toBeLessThanOrEqual(p.x + p.width + 0.5)
    }
    expect(await hasHorizontalScroll(page)).toBe(false)
  })

  test('F03-E6 accents and emoji in a name are refused with a reason; nothing is saved', async ({ page }) => {
    await newProject(page)
    const panel = await openVariables(page)
    await addVariableInPanel(page, panel, 'v', '10')
    const name = variableRow(panel, 'v').getByLabel('Name', { exact: true })
    for (const bad of ['breite_ä', 'w🚀', 'été']) {
      await name.fill(bad)
      await name.press('Enter')
      await expect(panel.getByText('Use letters, digits and underscores, and start with a letter or underscore.')).toBeVisible()
      await expect(name).toHaveAttribute('aria-invalid', 'true')
      expect((await variablesOf(page))[0].name).toBe('v')
    }
    await name.press('Escape')
    await expect(name).toHaveValue('v')
  })

  test('F03-E7 refresh: variables and an expression field survive a reload', async ({ page }) => {
    await newProject(page)
    await variableCommand(page, 'addVariable', 'w', '25')
    await drawRectangle(page)
    await extrudeWith(page, 'w * 2')
    await expect.poll(() => volumeOf(page)).toBeCloseTo(40 * 20 * 50, 0)
    await page.waitForTimeout(1200) // the save debounce
    await page.reload()
    await waitReady(page)
    await settle(page)
    expect((await variablesOf(page)).map((v) => [v.name, v.expression])).toEqual([['w', '25']])
    expect(extrudes(await doc(page))[0].params.distance).toBe('w * 2')
    await expect.poll(() => volumeOf(page)).toBeCloseTo(40 * 20 * 50, 0)
  })

  test('F03-E8 two tabs: a variable change in tab A is announced in tab B', async ({ page, context }) => {
    await newProject(page)
    await variableCommand(page, 'addVariable', 'w', '25')
    await page.waitForTimeout(1200)
    const b = await context.newPage()
    await b.goto(page.url())
    await waitReady(b)
    await page.bringToFront()
    const id = (await variablesOf(page))[0].id
    expect((await variableCommand(page, 'setVariableExpression', id, '30')).ok).toBe(true)
    await expect(b.getByText('Changed in another tab. Reload to continue.')).toBeVisible()
    expect((await variablesOf(b))[0].expression).toBe('25') // no silent overwrite
  })

  test('F03-E9 Enter twice on an expression is one undo step', async ({ page }) => {
    await newProject(page)
    const panel = await openVariables(page)
    const row = await addVariableInPanel(page, panel, 'w', '40')
    const expr = row.getByLabel('Expression')
    await expr.fill('25')
    await expr.press('Enter')
    await expr.press('Enter')
    await settle(page)
    expect((await variablesOf(page))[0].expression).toBe('25')
    await undo(page)
    expect((await variablesOf(page))[0].expression).toBe('40')
  })

  test('F03-E10 keyboard only: add, name and set a variable without the mouse', async ({ page }) => {
    await newProject(page)
    const panel = await openVariables(page)
    await panel.getByRole('button', { name: 'Add variable' }).focus()
    await page.keyboard.press('Enter')
    await expect.poll(async () => (await variablesOf(page)).length).toBe(1)
    await page.keyboard.type('depth')
    await page.keyboard.press('Enter')
    await expect(variableRow(panel, 'depth')).toBeVisible()
    // Tab: name -> delete button -> expression.
    await page.keyboard.press('Tab')
    await page.keyboard.press('Tab')
    await expect(variableRow(panel, 'depth').getByLabel('Expression')).toBeFocused()
    await page.keyboard.press('ControlOrMeta+a')
    await page.keyboard.type('12 + 3')
    await page.keyboard.press('Enter')
    await expect.poll(async () => (await variablesOf(page))[0]).toMatchObject({ name: 'depth', expression: '12 + 3' })
  })

  test('F03-N5 divide by zero in the panel: error on the field, the saved expression stays', async ({ page }) => {
    await newProject(page)
    const panel = await openVariables(page)
    const row = await addVariableInPanel(page, panel, 'w', '40')
    const expr = row.getByLabel('Expression')
    await expr.fill('10 / 0')
    await expect(row.getByText('Cannot divide by zero.')).toBeVisible()
    await expr.press('Enter')
    await expect(row.getByText('Cannot divide by zero.')).toBeVisible()
    expect((await variablesOf(page))[0].expression).toBe('40')
  })

  test('F03-N6 a variable change that makes a fillet too big flags the Fillet; undo restores it', async ({ page }) => {
    await newProject(page)
    await variableCommand(page, 'addVariable', 'r', '2')
    await buildBox(page)
    await settle(page)
    await waitCameraStable(page)
    await blendEdges(page, 'Fillet', [[20, 0, 10]], 'r')
    await settle(page)
    const ok = await volumeOf(page)
    expect(ok).toBeLessThan(8000)
    const id = (await variablesOf(page))[0].id
    expect((await variableCommand(page, 'setVariableExpression', id, '50')).ok).toBe(true)
    await settle(page)
    await expect(historyItem(page, 'Fillet 1')).toContainText(/error/i)
    await undo(page)
    await settle(page)
    await expect(historyItem(page, 'Fillet 1')).not.toContainText(/error/i)
    await expect.poll(() => volumeOf(page)).toBeCloseTo(ok, 1)
  })
})

test.describe('History marker: M3 test pass', () => {
  test('F02-E3 refresh: the End of history marker survives a reload', async ({ page }) => {
    await newProject(page)
    await buildBox(page)
    await settle(page)
    await waitCameraStable(page)
    await blendEdges(page, 'Fillet', [[20, 0, 10]], '2')
    await settle(page)
    const marker = page.getByRole('slider', { name: 'End of history' })
    await marker.focus()
    await page.keyboard.press('ArrowUp')
    await expect.poll(async () => (await doc(page)).rollbackIndex).toBe(1)
    await settle(page)
    await expect.poll(() => volumeOf(page)).toBeCloseTo(8000, 0)
    await page.waitForTimeout(1200)
    await page.reload()
    await waitReady(page)
    await settle(page)
    expect((await doc(page)).rollbackIndex).toBe(1)
    await expect(historyItem(page, 'Fillet 1')).toHaveAttribute('data-inactive', '')
    await expect.poll(() => volumeOf(page)).toBeCloseTo(8000, 0)
  })

  test('F02-E4 holding the grip or marker on a phone does not pop an empty menu or freeze taps (BUG-018) @mobile', async ({ page }) => {
    await newProject(page)
    await page.evaluate(() => {
      const s = window.__3dparter!.store.getState()
      s.apply('Add steps', (d) => {
        for (let i = 1; i <= 2; i++) {
          d.features.push({
            id: `s${i}`,
            name: `Sketch ${i}`,
            suppressed: false,
            type: 'sketch',
            params: { on: { kind: 'originPlane', name: 'XY' } },
            sketch: { entities: [], constraints: [] },
          })
        }
      })
    })
    await page.getByRole('button', { name: 'More' }).click()
    await page.getByRole('menuitem', { name: 'Show panel' }).click()
    await expect(page.getByRole('tree', { name: 'History' })).toBeVisible()

    // Touch-hold on the grip past Radix ContextMenu's 700 ms long-press timer.
    await page.evaluate(() => {
      const row = document.querySelector('[data-tree-id="s2"]') as HTMLElement
      const grip = row.querySelector('[data-grip]') as HTMLElement
      const g = grip.getBoundingClientRect()
      grip.dispatchEvent(
        new PointerEvent('pointerdown', {
          bubbles: true,
          cancelable: true,
          composed: true,
          pointerId: 9,
          pointerType: 'touch',
          isPrimary: true,
          button: 0,
          clientX: g.x + g.width / 2,
          clientY: g.y + g.height / 2,
        }),
      )
    })
    await page.waitForTimeout(850)
    await page.evaluate(() => {
      const row = document.querySelector('[data-tree-id="s2"]') as HTMLElement
      const grip = row.querySelector('[data-grip]') as HTMLElement
      const g = grip.getBoundingClientRect()
      grip.dispatchEvent(
        new PointerEvent('pointerup', {
          bubbles: true,
          cancelable: true,
          composed: true,
          pointerId: 9,
          pointerType: 'touch',
          isPrimary: true,
          button: 0,
          clientX: g.x + g.width / 2,
          clientY: g.y + g.height / 2,
        }),
      )
    })

    await expect(page.getByRole('menu')).toHaveCount(0)
    expect(await page.evaluate(() => document.body.style.pointerEvents)).not.toBe('none')

    // Tapping the row menu still works cleanly.
    await page.getByRole('button', { name: 'Actions for Sketch 2' }).click()
    await page.getByRole('menuitem', { name: /Move up/ }).click()
    await expect.poll(async () => (await doc(page)).features.map((f) => f.name)).toEqual(['Sketch 2', 'Sketch 1'])
  })
})

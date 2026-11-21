// History: reorder steps by drag, keyboard and menu; the "End of history" marker (roll back, show all steps);
// the kernel check that puts a move back when it breaks a step.
import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { blendEdges, buildBox, doc, exportStl, historyItem, near, newProject, settle, waitCameraStable } from './helpers'

const TOP_X_EDGE: [number, number, number] = [20, 0, 10] // along X at y=0, z=10 (40 mm long)
const TOP_Y_EDGE: [number, number, number] = [40, 10, 10] // along Y at x=40, z=10 (20 mm long)
const FAR_X_EDGE: [number, number, number] = [20, 20, 10] // along X at y=20, z=10 (40 mm long)

const names = async (page: Page) => (await doc(page)).features.map((f) => f.name)
const marker = (page: Page) => page.getByRole('slider', { name: 'End of history' })
const tree = (page: Page) => page.getByRole('tree', { name: 'History' })

/** Box, then a fillet on one top edge and a chamfer on another: Sketch 1, Extrude 1, Fillet 1, Chamfer 1. */
async function twoBlends(page: Page) {
  await newProject(page)
  await buildBox(page)
  await settle(page)
  await waitCameraStable(page)
  await blendEdges(page, 'Fillet', [TOP_X_EDGE], '2')
  await blendEdges(page, 'Chamfer', [FAR_X_EDGE], '1')
  await expect(historyItem(page, 'Chamfer 1')).toBeVisible()
  await expect.poll(() => names(page)).toEqual(['Sketch 1', 'Extrude 1', 'Fillet 1', 'Chamfer 1'])
  await settle(page)
}

/** Presses on a row, drags it to just above or below another row and releases. `hold` runs before the release. */
async function dragRow(page: Page, from: string, to: string, where: 'above' | 'below', hold?: () => Promise<void>) {
  const a = (await historyItem(page, from).boundingBox())!
  const b = (await historyItem(page, to).boundingBox())!
  const x = a.x + 70
  const y0 = a.y + a.height / 2
  const y1 = where === 'above' ? b.y + 3 : b.y + b.height - 3
  await page.mouse.move(x, y0)
  await page.mouse.down()
  await page.mouse.move(x, y0 + (y1 > y0 ? 6 : -6), { steps: 3 })
  await page.mouse.move(x, y1, { steps: 10 })
  await hold?.()
  await page.mouse.up()
}

/** A History row by exact step name (Sketch 1 is not Sketch 10). */
const row = (page: Page, name: string) => historyItem(page, `^${name}(?!\\d)`)

const volume = async (page: Page) => (await exportStl(page)).info.volume

test.describe('History: reordering', () => {
  test('F02-H1 a fillet and a chamfer on different edges swap by drag; both still build and the volume is unchanged', async ({ page }) => {
    await twoBlends(page)
    const before = await volume(page)
    await dragRow(page, 'Chamfer 1', 'Fillet 1', 'above', async () => {
      await expect(page.locator('[data-drop-line="ok"]')).toBeVisible()
    })
    await expect.poll(() => names(page)).toEqual(['Sketch 1', 'Extrude 1', 'Chamfer 1', 'Fillet 1'])
    await expect(page.locator('[data-drop-line]')).toHaveCount(0)
    await settle(page)
    await expect(historyItem(page, 'Fillet 1')).not.toContainText('Error')
    await expect(historyItem(page, 'Chamfer 1')).not.toContainText('Error')
    near(await volume(page), before, 0.6)
    await expect(page.getByRole('status').filter({ hasText: 'Chamfer 1 moved above Fillet 1.' }).first()).toBeAttached()
    // The order really is the new one in the History list too.
    await expect(tree(page).getByRole('treeitem')).toHaveText([/Sketch 1/, /Extrude 1/, /Chamfer 1/, /Fillet 1/])
  })

  test('F02-H2 undo puts a move back in one step', async ({ page }) => {
    await twoBlends(page)
    await dragRow(page, 'Chamfer 1', 'Fillet 1', 'above')
    await expect.poll(() => names(page)).toEqual(['Sketch 1', 'Extrude 1', 'Chamfer 1', 'Fillet 1'])
    await settle(page)
    await page.keyboard.press('Control+z')
    await expect.poll(() => names(page)).toEqual(['Sketch 1', 'Extrude 1', 'Fillet 1', 'Chamfer 1'])
    await settle(page)
    await expect(historyItem(page, 'Fillet 1')).not.toContainText('Error')
    await page.keyboard.press('Control+y')
    await expect.poll(() => names(page)).toEqual(['Sketch 1', 'Extrude 1', 'Chamfer 1', 'Fillet 1'])
  })

  test('F02-H3 dragging Extrude 1 above Sketch 1 is refused with the reason and changes nothing', async ({ page }) => {
    await twoBlends(page)
    await dragRow(page, 'Extrude 1', 'Sketch 1', 'above', async () => {
      await expect(page.locator('[data-drop-line="blocked"]')).toBeVisible()
    })
    await expect(page.getByText('Extrude 1 uses Sketch 1, so it has to stay after it.').first()).toBeVisible()
    expect(await names(page)).toEqual(['Sketch 1', 'Extrude 1', 'Fillet 1', 'Chamfer 1'])
    // Nothing was added to the undo history: undo takes the chamfer, not a move.
    await page.keyboard.press('Control+z')
    await expect.poll(() => names(page)).toEqual(['Sketch 1', 'Extrude 1', 'Fillet 1'])
  })

  test('F02-H4 Alt+ArrowUp and Alt+ArrowDown move the focused row and keep the focus', async ({ page }) => {
    await twoBlends(page)
    await historyItem(page, 'Chamfer 1').focus()
    await page.keyboard.press('Alt+ArrowUp')
    await expect.poll(() => names(page)).toEqual(['Sketch 1', 'Extrude 1', 'Chamfer 1', 'Fillet 1'])
    await expect(historyItem(page, 'Chamfer 1')).toBeFocused()
    await expect(page.getByRole('status').filter({ hasText: 'Chamfer 1 moved above Fillet 1.' }).first()).toBeAttached()
    await page.keyboard.press('Alt+ArrowDown')
    await expect.poll(() => names(page)).toEqual(['Sketch 1', 'Extrude 1', 'Fillet 1', 'Chamfer 1'])
    // Past what it uses: refused, with the reason.
    await historyItem(page, 'Extrude 1').focus()
    await page.keyboard.press('Alt+ArrowUp')
    await expect(page.getByText('Extrude 1 uses Sketch 1, so it has to stay after it.').first()).toBeVisible()
    expect(await names(page)).toEqual(['Sketch 1', 'Extrude 1', 'Fillet 1', 'Chamfer 1'])
  })

  test('F02-H5 the row menu has Move up, Move down and Roll back to here', async ({ page }) => {
    await twoBlends(page)
    await historyItem(page, 'Fillet 1').click({ button: 'right' })
    await page.getByRole('menuitem', { name: /Move down/ }).click()
    await expect.poll(() => names(page)).toEqual(['Sketch 1', 'Extrude 1', 'Chamfer 1', 'Fillet 1'])
    await historyItem(page, 'Fillet 1').click({ button: 'right' })
    await expect(page.getByRole('menuitem', { name: /Move down/ })).toHaveAttribute('aria-disabled', 'true')
    await page.getByRole('menuitem', { name: /Move up/ }).click()
    await expect.poll(() => names(page)).toEqual(['Sketch 1', 'Extrude 1', 'Fillet 1', 'Chamfer 1'])
    // The button at the end of the row opens the same menu.
    await page.getByRole('button', { name: 'Actions for Chamfer 1' }).click()
    await expect(page.getByRole('menuitem', { name: 'Roll back to here' })).toHaveAttribute('aria-disabled', 'true') // already the last step
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Actions for Extrude 1' }).click()
    await page.getByRole('menuitem', { name: 'Roll back to here' }).click()
    await expect.poll(async () => (await doc(page)).rollbackIndex).toBe(1)
  })

  test('F02-H6 a move the names allow but the kernel cannot build is put back with the reason', async ({ page }) => {
    await twoBlends(page)
    // A fillet that finds its edge by position only: its name mentions no step, so the name check lets it go anywhere.
    await page.evaluate(() => {
      const s = window.__3dparter!.store.getState()
      s.apply('Add Fillet 2', (d) => {
        d.features.push({
          id: 'ghost-fillet',
          name: 'Fillet 2',
          suppressed: false,
          type: 'fillet',
          params: { edges: [{ kind: 'edge', name: 'nowhere|nowhere', hint: { centroid: [0, 10, 10] } }], radius: '1' },
        })
      })
    })
    await expect(historyItem(page, 'Fillet 2')).toBeVisible()
    await settle(page)
    await expect(historyItem(page, 'Fillet 2')).not.toContainText('Error')

    // It sits last. Above Chamfer 1 the kernel cannot find its edge any more, so the move is put back.
    await historyItem(page, 'Fillet 2').focus()
    await page.keyboard.press('Alt+ArrowUp')
    await expect(page.getByText('Fillet 2 cannot be built here, so it was put back.').first()).toBeVisible()
    await expect.poll(() => names(page)).toEqual(['Sketch 1', 'Extrude 1', 'Fillet 1', 'Chamfer 1', 'Fillet 2'])
    await settle(page)
    await expect(historyItem(page, 'Fillet 2')).not.toContainText('Error')
    // The put-back is one undo step too: undo now removes the added Fillet 2, not a move.
    await page.keyboard.press('Control+z')
    await expect.poll(() => names(page)).toEqual(['Sketch 1', 'Extrude 1', 'Fillet 1', 'Chamfer 1'])
  })
})

test.describe('History: the End of history marker', () => {
  test('F02-H7 rolling back above the fillet shows the unfilleted box; steps after the marker are dimmed and announced as inactive', async ({ page }) => {
    await twoBlends(page)
    const full = await volume(page)
    expect(full).toBeLessThan(8000 - 1)

    await marker(page).focus()
    await page.keyboard.press('ArrowUp') // Chamfer 1 inactive
    await page.keyboard.press('ArrowUp') // Fillet 1 inactive
    await expect.poll(async () => (await doc(page)).rollbackIndex).toBe(1)
    await expect(marker(page)).toHaveAttribute('aria-valuenow', '2')
    await expect(marker(page)).toHaveAttribute('aria-valuetext', 'After Extrude 1')
    await settle(page)
    near(await volume(page), 8000, 0.5)

    for (const name of ['Fillet 1', 'Chamfer 1']) {
      const item = historyItem(page, name)
      await expect(item).toHaveAttribute('data-inactive', '')
      await expect(item).toContainText('inactive')
      await expect(item).not.toContainText('Error')
      expect(Number(await item.evaluate((el) => getComputedStyle(el).opacity))).toBeLessThan(1)
    }
    await expect(historyItem(page, 'Extrude 1')).not.toHaveAttribute('data-inactive', '')

    // The marker bar sits between Extrude 1 and Fillet 1.
    const m = (await marker(page).boundingBox())!
    const above = (await historyItem(page, 'Extrude 1').boundingBox())!
    const below = (await historyItem(page, 'Fillet 1').boundingBox())!
    expect(m.y).toBeGreaterThanOrEqual(above.y + above.height - 1)
    expect(m.y + m.height).toBeLessThanOrEqual(below.y + 1)
    await expect(page.getByRole('button', { name: 'Show all steps' })).toBeVisible()
    // Nothing was deleted.
    expect(await names(page)).toEqual(['Sketch 1', 'Extrude 1', 'Fillet 1', 'Chamfer 1'])

    // An inactive step cannot be edited from History.
    await historyItem(page, 'Fillet 1').click()
    await expect(page.getByText('That step is after the end of history. Show all steps to edit it.').first()).toBeVisible()
    await expect(page.getByRole('dialog', { name: 'Fillet', exact: true })).toHaveCount(0)

    await page.getByRole('button', { name: 'Show all steps' }).click()
    await expect.poll(async () => (await doc(page)).rollbackIndex).toBeNull()
    await expect(page.getByRole('button', { name: 'Show all steps' })).toHaveCount(0)
    await settle(page)
    near(await volume(page), full, 0.6)
    await expect(historyItem(page, 'Fillet 1')).not.toHaveAttribute('data-inactive', '')
  })

  test('F02-H8 a chamfer added while rolled back lands at the marker; Show all steps then builds everything', async ({ page }) => {
    await twoBlends(page)
    await marker(page).focus()
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('ArrowUp')
    await expect.poll(async () => (await doc(page)).rollbackIndex).toBe(1)
    await settle(page)

    await blendEdges(page, 'Chamfer', [TOP_Y_EDGE], '1')
    await expect.poll(() => names(page)).toEqual(['Sketch 1', 'Extrude 1', 'Chamfer 2', 'Fillet 1', 'Chamfer 1'])
    expect((await doc(page)).rollbackIndex).toBe(2)
    await expect(historyItem(page, 'Chamfer 2')).not.toHaveAttribute('data-inactive', '')
    await expect(historyItem(page, 'Fillet 1')).toHaveAttribute('data-inactive', '')
    await expect(historyItem(page, 'Chamfer 2')).not.toContainText('Error')
    near(await volume(page), 8000 - 0.5 * 20, 0.6)

    await page.getByRole('button', { name: 'Show all steps' }).click()
    await settle(page)
    for (const n of ['Chamfer 2', 'Fillet 1', 'Chamfer 1']) await expect(historyItem(page, n)).not.toContainText('Error')
    near(await volume(page), 8000 - 0.5 * 20 - (4 - Math.PI) * 40 - 0.5 * 40, 8) // the corner where they meet differs a little
  })

  test('F02-H9 the marker moves with Home, End and the arrow keys, and by dragging; undo brings it back', async ({ page }) => {
    await twoBlends(page)
    await marker(page).focus()
    await page.keyboard.press('Home')
    await expect.poll(async () => (await doc(page)).rollbackIndex).toBe(-1)
    await expect(marker(page)).toHaveAttribute('aria-valuetext', 'Before the first step')
    await page.keyboard.press('ArrowDown')
    await expect.poll(async () => (await doc(page)).rollbackIndex).toBe(0)
    await page.keyboard.press('End')
    await expect.poll(async () => (await doc(page)).rollbackIndex).toBeNull()
    await page.keyboard.press('ArrowDown') // already at the end
    expect((await doc(page)).rollbackIndex).toBeNull()

    // Drag the bar up by two rows with the mouse.
    const m = (await marker(page).boundingBox())!
    const x = m.x + 40
    const y = m.y + m.height / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x, y - 30, { steps: 5 })
    await page.mouse.move(x, y - 58, { steps: 5 })
    await page.mouse.up()
    await expect.poll(async () => (await doc(page)).rollbackIndex).toBe(1)
    await settle(page)
    await expect(historyItem(page, 'Fillet 1')).toHaveAttribute('data-inactive', '')
    await page.keyboard.press('Control+z')
    await expect.poll(async () => (await doc(page)).rollbackIndex).toBeNull()
  })

  test('F02-H10 deleting a step above the marker moves the marker with it', async ({ page }) => {
    await twoBlends(page)
    await marker(page).focus()
    await page.keyboard.press('ArrowUp') // Chamfer 1 inactive; Fillet 1 is the last active step
    await expect.poll(async () => (await doc(page)).rollbackIndex).toBe(2)
    await historyItem(page, 'Fillet 1').focus()
    await page.keyboard.press('Delete')
    await expect.poll(() => names(page)).toEqual(['Sketch 1', 'Extrude 1', 'Chamfer 1'])
    expect((await doc(page)).rollbackIndex).toBe(1)
    await expect(historyItem(page, 'Chamfer 1')).toHaveAttribute('data-inactive', '')
  })
})

test.describe('History: a long list and a phone', () => {
  /** n independent sketches, so the list is long and every move is allowed. */
  async function manySketches(page: Page, n: number) {
    await newProject(page)
    await page.evaluate((count) => {
      const s = window.__3dparter!.store.getState()
      s.apply('Add steps', (d) => {
        for (let i = 1; i <= count; i++) {
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
    }, n)
    await expect.poll(async () => (await names(page)).length).toBe(n)
  }

  test('F02-H11 dragging near the bottom edge scrolls the panel', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 500 })
    await manySketches(page, 30)
    const first = await row(page, 'Sketch 1').boundingBox()
    const scroller = await page.evaluate(() => {
      const tree = document.querySelector('[role="tree"][aria-label="History"]')!
      for (let p = tree.parentElement; p; p = p.parentElement) {
        if (p.scrollHeight > p.clientHeight && /auto|scroll/.test(getComputedStyle(p).overflowY)) {
          const r = p.getBoundingClientRect()
          return { bottom: r.bottom, top: r.top, scrollTop: p.scrollTop }
        }
      }
      return null
    })
    expect(scroller, 'the History list scrolls').not.toBeNull()
    const x = first!.x + 70
    await page.mouse.move(x, first!.y + first!.height / 2)
    await page.mouse.down()
    await page.mouse.move(x, first!.y + 40, { steps: 3 })
    await page.mouse.move(x, scroller!.bottom - 8, { steps: 8 })
    await expect
      .poll(() =>
        page.evaluate(() => {
          const tree = document.querySelector('[role="tree"][aria-label="History"]')!
          for (let p = tree.parentElement; p; p = p.parentElement) {
            if (p.scrollHeight > p.clientHeight && /auto|scroll/.test(getComputedStyle(p).overflowY)) return p.scrollTop
          }
          return 0
        }),
      )
      .toBeGreaterThan(40)
    await page.mouse.up()
  })

  test('F02-H12 on a phone the grip drags with a finger and the row button opens the menu @mobile', async ({ page }) => {
    await manySketches(page, 4)
    await page.getByRole('button', { name: 'More' }).click()
    await page.getByRole('menuitem', { name: 'Show panel' }).click()
    await expect(tree(page)).toBeVisible()
    expect((await page.viewportSize())!.width).toBe(390)

    // A finger on the grip of Sketch 3 drags it above Sketch 1 (touch pointer events).
    await page.evaluate(() => {
      const row = document.querySelector('[data-tree-id="s3"]') as HTMLElement
      const grip = row.querySelector('[data-grip]') as HTMLElement
      const target = (document.querySelector('[data-tree-id="s1"]') as HTMLElement).getBoundingClientRect()
      const g = grip.getBoundingClientRect()
      const ev = (type: string, x: number, y: number, el: Element | Window) =>
        el.dispatchEvent(
          new PointerEvent(type, { bubbles: true, cancelable: true, composed: true, pointerId: 7, pointerType: 'touch', isPrimary: true, button: 0, clientX: x, clientY: y }),
        )
      const x = g.x + g.width / 2
      const y = g.y + g.height / 2
      ev('pointerdown', x, y, grip)
      ev('pointermove', x, y - 8, window)
      ev('pointermove', x, target.y + 3, window)
      ev('pointerup', x, target.y + 3, window)
    })
    await expect.poll(() => names(page)).toEqual(['Sketch 3', 'Sketch 1', 'Sketch 2', 'Sketch 4'])
    await settle(page)

    // The row button is visible without hovering, and its menu moves the step.
    const button = page.getByRole('button', { name: 'Actions for Sketch 4' })
    await expect(button).toBeVisible()
    await button.click()
    await page.getByRole('menuitem', { name: /Move up/ }).click()
    await expect.poll(() => names(page)).toEqual(['Sketch 3', 'Sketch 1', 'Sketch 4', 'Sketch 2'])
    // The closing menu hands focus back to its button; wait for that before focusing anything else.
    await expect(page.getByRole('menu')).toHaveCount(0)
    await expect(button).toBeFocused()

    // The marker: a finger on the bar moves it; the button shows every step again.
    await marker(page).focus()
    await page.keyboard.press('ArrowUp')
    await expect.poll(async () => (await doc(page)).rollbackIndex).toBe(2)
    await page.getByRole('button', { name: 'Show all steps' }).click()
    await expect.poll(async () => (await doc(page)).rollbackIndex).toBeNull()
    const sx = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
    expect(sx, 'no horizontal scroll').toBe(false)
  })
})

// M2 modelling tools: edge cases and failure paths (chamfer, multi-edge fillet, undo, upstream edits, combine,
// revolve, transform, shell, sketching on faces, construction planes, keyboard and phone width).
import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import {
  addRectangleSketch,
  applyExtrude,
  blendEdges,
  bodyMeshes,
  bodyStats,
  buildBox,
  clickPickableNear,
  clickWorld,
  doc,
  exportStl,
  extrudeCard,
  finishAndExtrude,
  hasHorizontalScroll,
  historyItem,
  near,
  newProject,
  pickTopPlane,
  settle,
  sketches,
  toolButton,
  waitCameraStable,
} from './helpers'

const TOP_X_EDGE: [number, number, number] = [20, 0, 10] // along X at y=0, z=10 (40 mm long)
const TOP_Y_EDGE: [number, number, number] = [40, 10, 10] // along Y at x=40, z=10 (20 mm long)

async function boxReady(page: Page) {
  await newProject(page)
  await buildBox(page)
  await settle(page)
  await waitCameraStable(page)
}

const card = (page: Page, name: string) => page.getByRole('dialog', { name, exact: true })

test.describe('M2 edge cases: fillet and chamfer', () => {
  test('F01-E11 chamfer 1 on one top edge removes a 0.5 mm^2 wedge', async ({ page }) => {
    await boxReady(page)
    await blendEdges(page, 'Chamfer', [TOP_X_EDGE], '1')
    await expect(historyItem(page, 'Chamfer 1')).toBeVisible()
    const { info } = await exportStl(page)
    near(info.volume, 8000 - 0.5 * 1 * 1 * 40, 0.5)
  })

  test('F01-E12 two adjacent edges filleted at once is one Fillet step', async ({ page }) => {
    await boxReady(page)
    await blendEdges(page, 'Fillet', [TOP_X_EDGE, TOP_Y_EDGE], '2')
    await expect(historyItem(page, 'Fillet')).toHaveCount(1)
    await expect(historyItem(page, 'Fillet 1')).not.toContainText('Error')
    const { info } = await exportStl(page)
    const blend = 4 - Math.PI
    // Two edges of 40 and 20 mm (about 60 mm of blend, a little less at the shared corner).
    expect(info.volume).toBeLessThan(8000 - blend * 50)
    expect(info.volume).toBeGreaterThan(8000 - blend * 62)
  })

  test('F01-N3 radius 0 and text are refused on the card, Apply stays disabled, Enter adds nothing', async ({ page }) => {
    await boxReady(page)
    await toolButton(page, 'Fillet').click()
    const c = card(page, 'Fillet')
    await expect(c).toBeVisible()
    await clickPickableNear(page, TOP_X_EDGE, 'edge')
    await expect(c.getByText('1 edge')).toBeVisible()
    const radius = c.getByLabel('Radius')
    const apply = c.getByRole('button', { name: 'Apply' })

    await radius.fill('0')
    await radius.blur()
    await expect(c.getByText('Enter a number above zero.')).toBeVisible()
    await expect(radius).toHaveAttribute('aria-invalid', 'true')
    await expect(apply).toBeDisabled()
    await radius.focus()
    await page.keyboard.press('Enter')
    await expect(c).toBeVisible()
    expect((await doc(page)).features.filter((f) => f.type === 'fillet')).toHaveLength(0)

    await radius.fill('abc')
    await radius.blur()
    await expect(c.getByText('There is no variable called abc.')).toBeVisible()
    await expect(apply).toBeDisabled()
    await radius.focus()
    await page.keyboard.press('Enter')
    await expect(c).toBeVisible()
    expect((await doc(page)).features.filter((f) => f.type === 'fillet')).toHaveLength(0)
    await expect(historyItem(page, 'Fillet')).toHaveCount(0)
  })

  test('F01-E13 undo removes the fillet, redo brings it back', async ({ page }) => {
    await boxReady(page)
    await blendEdges(page, 'Fillet', [TOP_X_EDGE], '2')
    const blend = (4 - Math.PI) * 40
    near((await exportStl(page)).info.volume, 8000 - blend, 2)

    await page.keyboard.press('Control+z')
    await expect(historyItem(page, 'Fillet 1')).toHaveCount(0)
    await settle(page)
    near((await exportStl(page)).info.volume, 8000, 1)

    await page.keyboard.press('Control+y')
    await expect(historyItem(page, 'Fillet 1')).toBeVisible()
    await settle(page)
    near((await exportStl(page)).info.volume, 8000 - blend, 2)
  })
})

test.describe('M2 edge cases: upstream edits', () => {
  test('F02-E2 widening the sketch keeps the fillet and re-flows the volume', async ({ page }) => {
    await boxReady(page)
    await blendEdges(page, 'Fillet', [TOP_X_EDGE], '2')
    await expect(historyItem(page, 'Fillet 1')).toBeVisible()

    await historyItem(page, 'Sketch 1').click()
    await page.getByRole('button', { name: /Length dimension 40 mm/ }).dblclick()
    const field = page.getByRole('group', { name: 'Length value' })
    await expect(field).toBeVisible()
    await field.getByRole('textbox').fill('50')
    await page.keyboard.press('Enter')
    await expect(field).toBeHidden()
    await page.getByRole('button', { name: 'Finish sketch' }).click()
    await settle(page)

    await expect(historyItem(page, 'Fillet 1')).toBeVisible()
    await expect(historyItem(page, 'Fillet 1')).not.toContainText('Error')
    await expect(historyItem(page, 'Extrude 1')).not.toContainText('Error')
    const { info } = await exportStl(page)
    near(info.volume, 50 * 20 * 10 - (4 - Math.PI) * 50, 2)
  })

  test('F02-N2 replacing the profile breaks the fillet: flagged in History, no crash, undo restores it', async ({ page }) => {
    await boxReady(page)
    await blendEdges(page, 'Fillet', [TOP_X_EDGE], '2')
    const filleted = (4 - Math.PI) * 40
    near((await exportStl(page)).info.volume, 8000 - filleted, 2)

    // Edit Sketch 1: delete the four lines of the rectangle and draw a circle instead.
    await historyItem(page, 'Sketch 1').click()
    await waitCameraStable(page) // the view flies to the sketch; click only once it has arrived
    await clickWorld(page, [20, 0, 0])
    await page.keyboard.down('Shift')
    // Off the middle of each line: the dimension labels sit on the midpoints.
    const others: [number, number, number][] = [
      [40, 4, 0],
      [12, 20, 0],
      [0, 4, 0],
    ]
    for (const p of others) await clickWorld(page, p)
    await page.keyboard.up('Shift')
    await page.keyboard.press('Delete')
    await expect.poll(async () => sketches(await doc(page))[0].sketch.entities.length).toBe(0)
    await toolButton(page, 'Circle').click()
    await clickWorld(page, [20, 10, 0])
    await expect(page.getByRole('group', { name: 'Shape size' })).toBeVisible()
    await page.keyboard.type('10')
    await page.keyboard.press('Enter')
    await expect.poll(async () => sketches(await doc(page))[0].sketch.entities.length).toBe(1)
    await page.getByRole('button', { name: 'Finish sketch' }).click()
    await settle(page)

    // The fillet (and what it depended on) is flagged with a readable reason.
    const fillet = historyItem(page, 'Fillet 1')
    await expect(fillet).toBeVisible()
    await expect(fillet).toContainText(/Error: \S+/)
    const msg = (await fillet.textContent()) ?? ''
    expect(msg.replace(/^.*Error:\s*/s, '').length, msg).toBeGreaterThan(8)
    await expect(page.getByRole('toolbar', { name: 'Tools' })).toBeVisible()

    // Undo the sketch edit (a few steps: circle, deletion): everything is back.
    for (let i = 0; i < 6 && (await historyItem(page, 'Fillet 1').textContent())?.includes('Error'); i++) {
      await page.keyboard.press('Control+z')
      await settle(page)
    }
    await expect(historyItem(page, 'Fillet 1')).not.toContainText('Error')
    near((await exportStl(page)).info.volume, 8000 - filleted, 2)
  })
})

test.describe('M2 edge cases: combine', () => {
  /** Box 1 [0..40]x[0..20]x[0..10] plus box 2 [20..60]x[10..30]x[0..10]; the overlap is 20 x 10 x 10 = 2000. */
  async function twoBoxes(page: Page) {
    await boxReady(page)
    await addRectangleSketch(page, [20, 10, 0], '40', '20')
    await applyExtrude(page)
    await expect.poll(() => bodyMeshes(page)).toBe(2)
    await settle(page)
    await page.keyboard.press('Escape')
  }

  async function openCombine(page: Page) {
    await toolButton(page, 'Combine').click()
    await expect(card(page, 'Combine')).toBeVisible()
    await page.getByRole('tab', { name: 'Items' }).click()
  }
  const solids = (page: Page) => page.getByRole('tree', { name: 'Solids' })
  async function pickBoth(page: Page) {
    await solids(page).getByRole('treeitem', { name: 'Body 1' }).click()
    await solids(page).getByRole('treeitem', { name: 'Body 2' }).click()
    await settle(page)
  }

  test('F06-E1 Intersect keeps only the overlap', async ({ page }) => {
    await twoBoxes(page)
    await openCombine(page)
    await pickBoth(page)
    const c = card(page, 'Combine')
    await c.getByRole('radio', { name: 'Intersect' }).click()
    await settle(page)
    await c.getByRole('button', { name: 'Apply' }).click()
    await expect(c).toBeHidden()
    await expect.poll(() => bodyMeshes(page)).toBe(1)
    const { info } = await exportStl(page)
    near(info.volume, 2000, 2)
    near(info.size[0], 20, 0.05)
    near(info.size[1], 10, 0.05)
  })

  test('F06-E2 Cut with Keep tool solids leaves two solids with the right volumes', async ({ page }) => {
    await twoBoxes(page)
    await openCombine(page)
    await pickBoth(page)
    const c = card(page, 'Combine')
    await c.getByRole('radio', { name: 'Cut' }).click()
    await c.getByRole('switch', { name: 'Keep tool solids' }).click()
    await settle(page)
    await c.getByRole('button', { name: 'Apply' }).click()
    await expect(c).toBeHidden()
    await expect(solids(page).getByRole('treeitem')).toHaveCount(2)
    await expect.poll(() => bodyMeshes(page)).toBe(2)
    const vols = (await bodyStats(page)).map((b) => Math.round(b.volume)).sort((a, b) => a - b)
    near(vols[0], 6000, 3) // Body 1 minus the overlap
    near(vols[1], 8000, 3) // Body 2 untouched
  })

  test('F06-N1 a single picked solid cannot be combined', async ({ page }) => {
    await twoBoxes(page)
    await openCombine(page)
    const c = card(page, 'Combine')
    await solids(page).getByRole('treeitem', { name: 'Body 1' }).click()
    await settle(page)
    await expect(c.getByRole('alert')).toContainText('Pick at least one more solid')
    await expect(c.getByRole('button', { name: 'Apply' })).toBeDisabled()
    await page.keyboard.press('Enter')
    await expect(c).toBeVisible()
    expect((await doc(page)).features.filter((f) => f.type === 'boolean')).toHaveLength(0)
    await expect(historyItem(page, 'Combine')).toHaveCount(0)
  })

  test('F06-N2 intersecting solids that do not touch gives a readable error and changes nothing', async ({ page }) => {
    await boxReady(page)
    await addRectangleSketch(page, [-20, 5, 0], '10', '10')
    await applyExtrude(page)
    await expect.poll(() => bodyMeshes(page)).toBe(2)
    await settle(page)
    await page.keyboard.press('Escape')
    await openCombine(page)
    await pickBoth(page)
    const c = card(page, 'Combine')
    await c.getByRole('radio', { name: 'Intersect' }).click()
    await settle(page)
    await expect(c.getByRole('alert')).toContainText(/\S{4,}/)
    await expect(c.getByRole('button', { name: 'Apply' })).toBeDisabled()
    await page.keyboard.press('Escape')
    await expect(c).toBeHidden()
    expect((await doc(page)).features.filter((f) => f.type === 'boolean')).toHaveLength(0)
    await expect.poll(() => bodyMeshes(page)).toBe(2)
  })
})

test.describe('M2 edge cases: revolve', () => {
  /** Rectangle at (x0, 0) of size w x 20 plus a construction line on the Y axis; the sketch is finished. */
  async function revolveSketch(page: Page, x0: number, w: string) {
    await newProject(page)
    await toolButton(page, 'Rectangle').click()
    await pickTopPlane(page)
    await clickWorld(page, [x0, 0, 0])
    await expect(page.getByRole('group', { name: 'Shape size' })).toBeVisible()
    await page.keyboard.type(w)
    await page.keyboard.press('Tab')
    await page.keyboard.type('20')
    await page.keyboard.press('Enter')
    await expect.poll(async () => sketches(await doc(page)).flatMap((s) => s.sketch.entities).length).toBe(4)
    await toolButton(page, 'Line').click()
    await clickWorld(page, [0, 0, 0])
    await clickWorld(page, [0, 20, 0])
    await page.keyboard.press('Enter')
    await expect.poll(async () => sketches(await doc(page)).flatMap((s) => s.sketch.entities).length).toBe(5)
    await toolButton(page, 'Line').click() // selection mode
    await clickWorld(page, [0, 10, 0])
    await page.keyboard.press('x') // toggle construction
    await page.getByRole('button', { name: 'Finish sketch' }).click()
  }

  test('F05-E1 Revolve 90 degrees gives a quarter of the full turn', async ({ page }) => {
    await revolveSketch(page, 10, '10')
    await toolButton(page, 'Revolve').click()
    const c = card(page, 'Revolve')
    await expect(c).toBeVisible()
    await expect(c.getByRole('button', { name: 'Construction line' })).toHaveAttribute('aria-pressed', 'true')
    await expect(c.getByLabel('Angle')).toHaveValue('360')
    await c.getByLabel('Angle').fill('90')
    await c.getByLabel('Angle').blur()
    await settle(page)
    await c.getByRole('button', { name: 'Apply' }).click()
    await expect(c).toBeHidden()
    await expect(historyItem(page, 'Revolve 1')).toBeVisible()
    const { info } = await exportStl(page)
    near(info.volume, (Math.PI * (20 * 20 - 10 * 10) * 20) / 4, 15)
    near(info.size[1], 20, 0.05) // along the axis
    expect(Math.max(info.size[0], info.size[2])).toBeLessThan(20.1) // a quarter turn spans one radius each way
  })

  test('F05-N1 a profile that crosses the axis is refused with a readable error', async ({ page }) => {
    await revolveSketch(page, -10, '20')
    await toolButton(page, 'Revolve').click()
    const c = card(page, 'Revolve')
    await expect(c).toBeVisible()
    await settle(page)
    await expect(c.getByRole('alert')).toContainText(/\S{4,}/)
    await expect(c.getByRole('button', { name: 'Apply' })).toBeDisabled()
    await page.keyboard.press('Escape')
    await expect(c).toBeHidden()
    expect((await doc(page)).features.filter((f) => f.type === 'revolve')).toHaveLength(0)
    await expect.poll(() => bodyMeshes(page)).toBe(0)
  })
})

test.describe('M2 edge cases: move and rotate', () => {
  test('M2-E1 Transform rotate 90 degrees about Z swaps the footprint', async ({ page }) => {
    await boxReady(page)
    await toolButton(page, 'Move').click()
    const c = card(page, 'Move')
    await expect(c).toBeVisible()
    await c.getByRole('radio', { name: 'Z' }).click()
    await c.getByLabel('Angle').fill('90')
    await c.getByLabel('Angle').blur()
    await settle(page)
    await c.getByRole('button', { name: 'Apply' }).click()
    await expect(c).toBeHidden()
    await expect(historyItem(page, 'Move 1')).toBeVisible()
    await settle(page)
    const stats = await bodyStats(page)
    expect(stats).toHaveLength(1)
    const [b] = stats
    near(b.max[0] - b.min[0], 20, 0.01)
    near(b.max[1] - b.min[1], 40, 0.01)
    near(b.max[2] - b.min[2], 10, 0.01)
    near(b.volume, 8000, 1)
    // Rotation is about the origin: the 40 x 20 footprint at x 0..40 lands at x -20..0, y 0..40.
    near(b.min[0], -20, 0.01)
    near(b.max[1], 40, 0.01)
  })

  test('M2-E2 Transform without copy leaves one solid, moved', async ({ page }) => {
    await boxReady(page)
    await toolButton(page, 'Move').click()
    const c = card(page, 'Move')
    await expect(c).toBeVisible()
    await expect(c.getByRole('switch', { name: 'Keep original (make a copy)' })).not.toBeChecked()
    await c.getByLabel('Move X').fill('100')
    await c.getByLabel('Move X').blur()
    await settle(page)
    await c.getByRole('button', { name: 'Apply' }).click()
    await expect(c).toBeHidden()
    await settle(page)
    await expect.poll(() => bodyMeshes(page)).toBe(1)
    const [b] = await bodyStats(page)
    near(b.min[0], 100, 0.01)
    near(b.max[0], 140, 0.01)
    near(b.volume, 8000, 1)
    await page.getByRole('tab', { name: 'Items' }).click()
    await expect(page.getByRole('tree', { name: 'Solids' }).getByRole('treeitem')).toHaveCount(1)
  })
})

test.describe('M2 edge cases: shell', () => {
  test('M2-N1 Shell with a thickness larger than the part gives a readable error and adds nothing', async ({ page }) => {
    await boxReady(page)
    await toolButton(page, 'Shell').click()
    const c = card(page, 'Shell')
    await expect(c).toBeVisible()
    await clickPickableNear(page, [20, 10, 10], 'face')
    await expect(c.getByText('1 face')).toBeVisible()
    await c.getByLabel('Thickness').fill('12')
    await c.getByLabel('Thickness').blur()
    await settle(page)
    await expect(c.getByRole('alert')).toContainText(/\S{4,}/)
    await expect(c.getByRole('button', { name: 'Apply' })).toBeDisabled()
    await c.getByLabel('Thickness').focus()
    await page.keyboard.press('Enter')
    await expect(c).toBeVisible()
    expect((await doc(page)).features.filter((f) => f.type === 'shell')).toHaveLength(0)
    await page.keyboard.press('Escape')
    await expect(c).toBeHidden()
    await expect(historyItem(page, 'Shell')).toHaveCount(0)
    near((await exportStl(page)).info.volume, 8000, 1)
  })
})

test.describe('M2 edge cases: sketching on faces and planes', () => {
  test('F07-E1 a circle on a side face, cut through, leaves a hole in the side', async ({ page }) => {
    await boxReady(page)
    await toolButton(page, 'Circle').click()
    await clickPickableNear(page, [20, 0, 5], 'face') // the front face (y = 0)
    await expect.poll(async () => sketches(await doc(page)).length).toBe(2)
    await waitCameraStable(page)
    await expect(page.getByText('Sketching on a face')).toBeVisible()
    await clickWorld(page, [20, 0, 5])
    await expect(page.getByRole('group', { name: 'Shape size' })).toBeVisible()
    await page.keyboard.type('6')
    await page.keyboard.press('Enter')
    await expect.poll(async () => sketches(await doc(page))[1].sketch.entities.length).toBe(1)
    await page.getByRole('button', { name: 'Finish sketch' }).click()

    await toolButton(page, 'Extrude').click()
    const e = extrudeCard(page)
    await expect(e).toBeVisible()
    await e.getByRole('radio', { name: 'Flip' }).click()
    await e.getByRole('radio', { name: 'Cut' }).click()
    await e.getByLabel('Distance').fill('20')
    await e.getByLabel('Distance').blur()
    await settle(page)
    await e.getByRole('button', { name: 'Apply' }).click()
    await expect(e).toBeHidden()
    await settle(page)
    near((await exportStl(page)).info.volume, 8000 - Math.PI * 9 * 20, 5)
  })

  test('F07-N1 a curved face cannot host a sketch', async ({ page }) => {
    await newProject(page)
    await toolButton(page, 'Circle').click()
    await pickTopPlane(page)
    await clickWorld(page, [0, 0, 0])
    await expect(page.getByRole('group', { name: 'Shape size' })).toBeVisible()
    await page.keyboard.type('20')
    await page.keyboard.press('Enter')
    await finishAndExtrude(page)
    await settle(page)
    await waitCameraStable(page)

    await toolButton(page, 'Circle').click()
    // The side of the cylinder: a point on the silhouette side facing the camera.
    const hit = await page.evaluate(() => {
      const h = window.__3dshaper!
      for (let a = 0; a < 360; a += 10) {
        const w: [number, number, number] = [10 * Math.cos((a * Math.PI) / 180), 10 * Math.sin((a * Math.PI) / 180), 5]
        const [x, y] = h.toClient(w)
        if (document.elementFromPoint(x, y) !== h.engine.canvas) continue
        const r = h.engine.pickAt(x, y)
        if (r?.kind === 'face') return [x, y] as [number, number]
      }
      return null
    })
    expect(hit, 'a pickable point on the cylinder side').toBeTruthy()
    await page.mouse.click(hit![0], hit![1])
    await settle(page)
    // The app says why, and no sketch is created.
    await expect(page.getByText('Cannot sketch on this face').first()).toBeVisible()
    await expect(page.getByText('Pick a flat face or a plane.').first()).toBeVisible()
    expect(sketches(await doc(page))).toHaveLength(1) // only the cylinder's own sketch
  })

  test('F07-E2 Construction plane offset 15 from Top hosts a sketch that extrudes from z = 15', async ({ page }) => {
    await newProject(page)
    await toolButton(page, 'Plane').click()
    const p = card(page, 'Plane')
    await expect(p).toBeVisible()
    await p.getByLabel('Offset').fill('15')
    await p.getByLabel('Offset').blur()
    await settle(page)
    await p.getByRole('button', { name: 'Apply' }).click()
    await expect(p).toBeHidden()
    await expect(historyItem(page, 'Plane 1')).toBeVisible()
    await waitCameraStable(page)

    await toolButton(page, 'Rectangle').click()
    let target: [number, number, number] | undefined
    await expect
      .poll(async () => {
        target = await page.evaluate(() => {
          const h = window.__3dshaper!
          for (let x = -30; x <= 30; x += 5) {
            for (let y = -30; y <= 30; y += 5) {
              const [cx, cy] = h.toClient([x, y, 15])
              if (document.elementFromPoint(cx, cy) !== h.engine.canvas) continue
              const r = h.engine.pickAt(cx, cy)
              if (r?.kind === 'constructionPlane') return [x, y, 15] as [number, number, number]
            }
          }
          return undefined
        })
        return Boolean(target)
      })
      .toBe(true)
    await clickWorld(page, target!)
    await expect.poll(async () => sketches(await doc(page)).length).toBe(1)
    await waitCameraStable(page)
    await clickWorld(page, [0, 0, 15])
    await expect(page.getByRole('group', { name: 'Shape size' })).toBeVisible()
    await page.keyboard.type('10')
    await page.keyboard.press('Tab')
    await page.keyboard.type('10')
    await page.keyboard.press('Enter')
    await finishAndExtrude(page)
    await settle(page)
    const { info } = await exportStl(page)
    near(info.min[2], 15, 0.01)
    near(info.volume, 10 * 10 * 10, 1)
  })
})

test.describe('M2 edge cases: keyboard', () => {
  test('F01-E14 Keyboard only: G opens Fillet with the preselected edge, type a radius, Enter applies', async ({ page }) => {
    await boxReady(page)
    await clickPickableNear(page, TOP_X_EDGE, 'edge') // selection mode: the edge is selected
    await expect.poll(async () => page.evaluate(() => window.__3dshaper!.store.getState().selection.length)).toBe(1)
    await page.keyboard.press('g')
    const c = card(page, 'Fillet')
    await expect(c).toBeVisible()
    await expect(c.getByText('1 edge')).toBeVisible()
    await expect(c.getByLabel('Radius')).toBeFocused()
    await page.keyboard.type('2')
    await page.keyboard.press('Enter') // right after typing: the apply waits for the preview of this value
    await expect(c).toBeHidden()
    await expect(historyItem(page, 'Fillet 1')).toBeVisible()
    await settle(page)
    near((await exportStl(page)).info.volume, 8000 - (4 - Math.PI) * 40, 2)
  })

  test('F01-N4 Esc on an open tool card adds nothing', async ({ page }) => {
    await boxReady(page)
    const before = (await doc(page)).features.length
    for (const [key, name] of [
      ['g', 'Fillet'],
      ['k', 'Chamfer'],
      ['m', 'Move'],
      ['s', 'Shell'],
      ['p', 'Plane'],
    ] as const) {
      await page.keyboard.press(key)
      const c = card(page, name)
      await expect(c, name).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(c, name).toBeHidden()
      expect((await doc(page)).features, name).toHaveLength(before)
    }
    await expect.poll(() => bodyMeshes(page)).toBe(1)
  })
})

test.describe('M2 edge cases: phone width', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  /** The card is fully on screen, Apply is inside the viewport and the page does not scroll sideways. */
  async function expectReachable(page: Page, c: ReturnType<typeof card>) {
    const apply = c.getByRole('button', { name: 'Apply' })
    await apply.scrollIntoViewIfNeeded()
    const box = await apply.boundingBox()
    expect(box, 'Apply has a box').toBeTruthy()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(390.5)
    expect(box!.y + box!.height).toBeLessThanOrEqual(844.5)
    expect(await hasHorizontalScroll(page)).toBe(false)
  }

  test('F01-E15 Fillet card is usable at 390 px: pick an edge, set a radius, Apply', async ({ page }) => {
    await boxReady(page)
    await toolButton(page, 'Fillet').click()
    const c = card(page, 'Fillet')
    await expect(c).toBeVisible()
    await clickPickableNear(page, TOP_X_EDGE, 'edge')
    await expect(c.getByText('1 edge')).toBeVisible()
    await c.getByLabel('Radius').fill('2')
    await c.getByLabel('Radius').blur()
    await settle(page)
    await expectReachable(page, c)
    await c.getByRole('button', { name: 'Apply' }).click()
    await expect(c).toBeHidden()
    await expect.poll(async () => (await doc(page)).features.filter((f) => f.type === 'fillet').length).toBe(1)
    await settle(page)
    near((await exportStl(page)).info.volume, 8000 - (4 - Math.PI) * 40, 2)
  })

  test('F06-E3 Combine card is usable at 390 px: two solids picked, Apply joins them', async ({ page }) => {
    await boxReady(page)
    await addRectangleSketch(page, [20, 10, 0], '40', '20')
    await applyExtrude(page)
    await expect.poll(() => bodyMeshes(page)).toBe(2)
    await settle(page)
    await page.keyboard.press('Escape')
    await toolButton(page, 'Combine').click()
    const c = card(page, 'Combine')
    await expect(c).toBeVisible()
    await expect(c.getByRole('button', { name: 'Apply' })).toBeDisabled()
    await expectReachable(page, c)
    // Click two different solids, wherever they are visible on the small screen.
    for (let n = 1; n <= 2; n++) {
      let pt: [number, number] | null = null
      await expect
        .poll(async () => {
          pt = await page.evaluate(() => {
            const h = window.__3dshaper!
            const picked = h.store.getState().selection.map((r) => r.name)
            for (let y = 20; y < 820; y += 8) {
              for (let x = 10; x < 380; x += 8) {
                if (document.elementFromPoint(x, y) !== h.engine.canvas) continue
                const r = h.engine.pickAt(x, y)
                if (r?.kind === 'body' && !picked.includes(r.name)) return [x, y] as [number, number]
              }
            }
            return null
          })
          return Boolean(pt)
        })
        .toBe(true)
      await page.mouse.click(pt![0], pt![1])
      await expect.poll(async () => page.evaluate(() => window.__3dshaper!.store.getState().selection.length)).toBe(n)
    }
    await settle(page)
    await expect(c.getByRole('button', { name: 'Apply' })).toBeEnabled()
    await expectReachable(page, c)
    await c.getByRole('button', { name: 'Apply' }).click()
    await expect(c).toBeHidden()
    await expect.poll(() => bodyMeshes(page)).toBe(1)
    near((await exportStl(page)).info.volume, 14000, 3)
  })
})

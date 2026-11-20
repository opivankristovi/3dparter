// M2 modeling tools & workflows: fillet, chamfer, extrude modes + drag handle, revolve, combine, shell, move/copy,
// construction planes, sketching on a flat face, and upstream edit re-flow.
import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import {
  bodyMeshes,
  buildBox,
  clickWorld,
  doc,
  exportStl,
  extrudeCard,
  near,
  newProject,
  pickTopPlane,
  settle,
  sketches,
  toolButton,
  waitCameraStable,
} from './helpers'

const historyItem = (page: Page, name: string) =>
  page.getByRole('tree', { name: 'History' }).getByRole('treeitem', { name: new RegExp(name) })

/** Picks the Top (XY) origin plane when the document may already contain sketches. */
async function pickTopPlaneAgain(page: Page) {
  const before = sketches(await doc(page)).length
  let target: [number, number, number] | undefined
  await expect
    .poll(async () => {
      target = await page.evaluate(() => {
        const h = window.__3dshaper!
        const candidates: [number, number, number][] = [
          [10, -10, 0],
          [5, -15, 0],
          [15, -15, 0],
          [10, -20, 0],
          [-10, -10, 0],
          [-15, -5, 0],
          [20, -15, 0],
          [30, -30, 0],
          [-30, 30, 0],
          [-30, -30, 0],
          [35, -35, 0],
          [-35, -5, 0],
          [-5, -35, 0],
          [20, 20, 0],
          [30, 30, 0],
        ]
        return candidates.find((c) => {
          const [x, y] = h.toClient(c)
          if (document.elementFromPoint(x, y) !== h.engine.canvas) return false
          const ref = h.engine.pickAt(x, y)
          return ref?.kind === 'originPlane' && ref.name === 'XY'
        })
      })
      return Boolean(target)
    })
    .toBe(true)
  await clickWorld(page, target!)
  await expect.poll(async () => sketches(await doc(page)).length).toBe(before + 1)
  await waitCameraStable(page)
}

/** Finds a screen coordinate where `engine.pickAt` returns the wanted `kind` near `world`. */
async function clickPickableNear(page: Page, world: [number, number, number], kind: 'edge' | 'face' | 'body') {
  let pt: [number, number] | null = null
  await expect
    .poll(async () => {
      pt = await page.evaluate(
        ({ w, want }) => {
          const h = window.__3dshaper!
          const [cx, cy] = h.toClient(w)
          const offsets: [number, number][] = [
            [0, 0],
            [0, 1],
            [0, -1],
            [1, 0],
            [-1, 0],
            [0, 2],
            [0, -2],
            [2, 0],
            [-2, 0],
            [0, 3],
            [0, -3],
            [3, 0],
            [-3, 0],
            [0, 4],
            [0, -4],
            [4, 0],
            [-4, 0],
          ]
          for (const [dx, dy] of offsets) {
            const x = cx + dx
            const y = cy + dy
            if (document.elementFromPoint(x, y) !== h.engine.canvas) continue
            const r = h.engine.pickAt(x, y)
            if (r?.kind === want) return [x, y] as [number, number]
          }
          return null
        },
        { w: world, want: kind },
      )
      return Boolean(pt)
    })
    .toBe(true)
  await page.mouse.click(pt![0], pt![1])
}

async function expectNoA11yViolations(page: Page, name: string) {
  const results = await new AxeBuilder({ page }).exclude('canvas').analyze()
  const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical' || v.impact === 'moderate')
  expect(
    blocking.map((v) => `${v.id} (${v.impact})`),
    `axe violations on ${name}`,
  ).toEqual([])
}

test.describe('M2 modeling tools', () => {
  test('F01 with Fillet: pick edge, preview, STL volume, and failure on oversized radius', async ({ page }) => {
    await newProject(page)
    await buildBox(page)
    await settle(page)
    await waitCameraStable(page)

    await toolButton(page, 'Fillet').click()
    const card = page.getByRole('dialog', { name: 'Fillet', exact: true })
    await expect(card).toBeVisible()
    await expect(card.getByRole('button', { name: 'Apply' })).toBeDisabled()

    await clickPickableNear(page, [20, 0, 10], 'edge')
    await expect(card.getByText('1 edge')).toBeVisible()
    await settle(page)
    await expectNoA11yViolations(page, 'Fillet card')

    await card.getByLabel('Radius').fill('2')
    await card.getByLabel('Radius').blur()
    await settle(page)
    await expect(card.getByRole('button', { name: 'Apply' })).toBeEnabled()
    await card.getByRole('button', { name: 'Apply' }).click()
    await expect(card).toBeHidden()
    await expect(historyItem(page, 'Fillet 1')).toBeVisible()

    const { info } = await exportStl(page)
    const blend = (2 * 2 - (Math.PI * 4) / 4) * 40
    near(info.volume, 8000 - blend, 2)

    // Oversized radius fails cleanly and disables Apply.
    await toolButton(page, 'Fillet').click()
    await expect(card).toBeVisible()
    await clickPickableNear(page, [20, 20, 10], 'edge')
    await card.getByLabel('Radius').fill('50')
    await card.getByLabel('Radius').blur()
    await settle(page)
    await expect(card.getByRole('alert')).toBeVisible()
    await expect(card.getByRole('button', { name: 'Apply' })).toBeDisabled()
  })

  test('Extrude drag handle and Cut boolean mode', async ({ page }) => {
    await newProject(page)
    await buildBox(page)
    await settle(page)
    await waitCameraStable(page)

    // Second sketch on XY inside the box footprint: 10 x 10 rectangle at [10, 5] -> [20, 15].
    await toolButton(page, 'Rectangle').click()
    await pickTopPlaneAgain(page)
    await clickWorld(page, [10, 5, 0])
    await expect(page.getByRole('group', { name: 'Shape size' })).toBeVisible()
    await page.keyboard.type('10')
    await page.keyboard.press('Tab')
    await page.keyboard.type('10')
    await page.keyboard.press('Enter')
    await expect.poll(async () => sketches(await doc(page)).length).toBe(2)
    await page.getByRole('button', { name: 'Finish sketch' }).click()

    await toolButton(page, 'Extrude').click()
    const card = extrudeCard(page)
    await expect(card).toBeVisible()
    await settle(page)

    // On-model distance handle updates Distance via keyboard arrow.
    const handle = page.getByRole('button', { name: /Extrude distance handle/ })
    await expect(handle).toBeVisible()
    await handle.focus()
    await page.keyboard.press('ArrowUp')
    await expect(card.getByLabel('Distance')).toHaveValue('11')
    await settle(page)
    await expectNoA11yViolations(page, 'Extrude card with handle')

    await card.getByRole('radio', { name: 'Cut' }).click()
    await expect(card.getByText('Body 1')).toBeVisible()
    await settle(page)
    await card.getByRole('button', { name: 'Apply' }).click()
    await expect(card).toBeHidden()
    await settle(page)

    const { info } = await exportStl(page)
    near(info.volume, 8000 - 10 * 10 * 10, 2)
  })

  test('F05 Revolve a profile around a construction line', async ({ page }) => {
    await newProject(page)
    await toolButton(page, 'Rectangle').click()
    await pickTopPlane(page)
    await clickWorld(page, [10, 0, 0])
    await expect(page.getByRole('group', { name: 'Shape size' })).toBeVisible()
    await page.keyboard.type('10')
    await page.keyboard.press('Tab')
    await page.keyboard.type('20')
    await page.keyboard.press('Enter')
    await expect.poll(async () => sketches(await doc(page)).flatMap((s) => s.sketch.entities).length).toBe(4)

    // Add a construction line on the Y axis (0, 0) -> (0, 20).
    await toolButton(page, 'Line').click()
    await clickWorld(page, [0, 0, 0])
    await clickWorld(page, [0, 20, 0])
    await page.keyboard.press('Enter')
    await expect.poll(async () => sketches(await doc(page)).flatMap((s) => s.sketch.entities).length).toBe(5)
    await toolButton(page, 'Line').click() // selection mode
    await clickWorld(page, [0, 10, 0])
    await page.keyboard.press('x') // toggle construction
    await page.getByRole('button', { name: 'Finish sketch' }).click()

    await toolButton(page, 'Revolve').click()
    const card = page.getByRole('dialog', { name: 'Revolve', exact: true })
    await expect(card).toBeVisible()
    await expect(card.getByRole('button', { name: 'Construction line' })).toHaveAttribute('aria-pressed', 'true')
    await settle(page)
    await expectNoA11yViolations(page, 'Revolve card')

    await card.getByLabel('Angle').fill('90')
    await card.getByLabel('Angle').blur()
    await settle(page)
    await card.getByRole('button', { name: 'Apply' }).click()
    await expect(card).toBeHidden()
    await expect(historyItem(page, 'Revolve 1')).toBeVisible()

    const { info } = await exportStl(page)
    const expected = (Math.PI * (20 * 20 - 10 * 10) * 20) / 4
    near(info.volume, expected, 15)
  })

  test('F06 Combine two solids with Join', async ({ page }) => {
    await newProject(page)
    await buildBox(page)
    await settle(page)
    await waitCameraStable(page)

    // Second solid overlapping the first: [20..60, 10..30, 0..10]
    await toolButton(page, 'Rectangle').click()
    await pickTopPlaneAgain(page)
    await clickWorld(page, [20, 10, 0])
    await expect(page.getByRole('group', { name: 'Shape size' })).toBeVisible()
    await page.keyboard.type('40')
    await page.keyboard.press('Tab')
    await page.keyboard.type('20')
    await page.keyboard.press('Enter')
    await page.getByRole('button', { name: 'Finish sketch' }).click()
    await toolButton(page, 'Extrude').click()
    await expect(extrudeCard(page)).toBeVisible()
    await extrudeCard(page).getByRole('button', { name: 'Apply' }).click()
    await expect(extrudeCard(page)).toBeHidden()
    await expect.poll(() => bodyMeshes(page)).toBe(2)

    await page.keyboard.press('Escape') // clear Body 2 selection so Combine starts empty
    await toolButton(page, 'Combine').click()
    const card = page.getByRole('dialog', { name: 'Combine', exact: true })
    await expect(card).toBeVisible()

    await page.getByRole('tab', { name: 'Items' }).click()
    const tree = page.getByRole('tree', { name: 'Solids' })
    await tree.getByRole('treeitem', { name: 'Body 1' }).click()
    await tree.getByRole('treeitem', { name: 'Body 2' }).click()
    await settle(page)
    await expectNoA11yViolations(page, 'Combine card')

    await card.getByRole('button', { name: 'Apply' }).click()
    await expect(card).toBeHidden()
    await expect.poll(() => bodyMeshes(page)).toBe(1)
    await expect(tree.getByRole('treeitem')).toHaveCount(1)

    const { info } = await exportStl(page)
    near(info.volume, 14000, 3)
  })

  test('Shell hollows a box with its top face opened', async ({ page }) => {
    await newProject(page)
    await buildBox(page)
    await settle(page)
    await waitCameraStable(page)

    await toolButton(page, 'Shell').click()
    const card = page.getByRole('dialog', { name: 'Shell', exact: true })
    await expect(card).toBeVisible()
    await expect(card.getByText('Body 1')).toBeVisible()

    await clickPickableNear(page, [20, 10, 10], 'face')
    await expect(card.getByText('1 face')).toBeVisible()
    await settle(page)
    await expectNoA11yViolations(page, 'Shell card')

    await card.getByRole('button', { name: 'Apply' }).click()
    await expect(card).toBeHidden()
    await expect(historyItem(page, 'Shell 1')).toBeVisible()

    const { info } = await exportStl(page)
    near(info.volume, 8000 - 36 * 16 * 8, 2)
  })

  test('Move makes a translated copy with the 3-axis gizmo', async ({ page }) => {
    await newProject(page)
    await buildBox(page)
    await settle(page)
    await waitCameraStable(page)

    await toolButton(page, 'Move').click()
    const card = page.getByRole('dialog', { name: 'Move', exact: true })
    await expect(card).toBeVisible()
    await settle(page)
    await expect(page.getByRole('button', { name: /Move X handle/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /Move Y handle/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /Move Z handle/ })).toBeVisible()
    await expectNoA11yViolations(page, 'Move card with gizmo')

    await card.getByRole('switch', { name: 'Keep original (make a copy)' }).click()
    await card.getByLabel('Move X').fill('100')
    await card.getByLabel('Move X').blur()
    await settle(page)
    await card.getByRole('button', { name: 'Apply' }).click()
    await expect(card).toBeHidden()

    await expect.poll(() => bodyMeshes(page)).toBe(2)
    await page.getByRole('tab', { name: 'Items' }).click()
    await expect(page.getByRole('tree', { name: 'Solids' }).getByRole('treeitem')).toHaveCount(2)
  })

  test('F07 Construction plane, sketch on flat face, cut hole and upstream edit re-flow', async ({ page }) => {
    await newProject(page)
    await buildBox(page)
    await settle(page)
    await waitCameraStable(page)

    // Create an offset construction plane.
    await toolButton(page, 'Plane').click()
    const pCard = page.getByRole('dialog', { name: 'Plane', exact: true })
    await expect(pCard).toBeVisible()
    await expect(page.getByRole('button', { name: /Plane offset handle/ })).toBeVisible()
    await settle(page)
    await expectNoA11yViolations(page, 'Plane card')
    await pCard.getByLabel('Offset').fill('-20')
    await pCard.getByLabel('Offset').blur()
    await settle(page)
    await pCard.getByRole('button', { name: 'Apply' }).click()
    await expect(pCard).toBeHidden()
    await expect(historyItem(page, 'Plane 1')).toBeVisible()

    // Sketch a circle on the top face of the box (z = 10).
    await toolButton(page, 'Circle').click()
    await clickPickableNear(page, [20, 10, 10], 'face')
    await expect.poll(async () => sketches(await doc(page)).length).toBe(2)
    await waitCameraStable(page)
    await expect(page.getByText('Sketching on a face')).toBeVisible()

    await clickWorld(page, [20, 10, 10])
    await expect(page.getByRole('group', { name: 'Shape size' })).toBeVisible()
    await page.keyboard.type('6')
    await page.keyboard.press('Enter')
    await expect.poll(async () => sketches(await doc(page))[1].sketch.entities.length).toBe(1)
    await page.getByRole('button', { name: 'Finish sketch' }).click()

    await toolButton(page, 'Extrude').click()
    const eCard = extrudeCard(page)
    await expect(eCard).toBeVisible()
    await eCard.getByRole('radio', { name: 'Flip' }).click()
    await eCard.getByRole('radio', { name: 'Cut' }).click()
    await settle(page)
    await eCard.getByRole('button', { name: 'Apply' }).click()
    await expect(eCard).toBeHidden()
    await settle(page)

    let stl = await exportStl(page)
    near(stl.info.volume, 8000 - Math.PI * 9 * 10, 4)

    // Edit Extrude 1 height from 10 to 25: the face-hosted sketch and cut hole re-flow onto the taller box.
    await historyItem(page, 'Extrude 1').click()
    await expect(eCard).toBeVisible()
    await eCard.getByLabel('Distance').fill('25')
    await eCard.getByLabel('Distance').press('Enter')
    await expect(eCard).toBeHidden()
    await settle(page)

    stl = await exportStl(page)
    near(stl.info.volume, 40 * 20 * 25 - Math.PI * 9 * 10, 6)
  })
})

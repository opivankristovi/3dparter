// The desktop layout pass: labelled tool rail, view column with the orientation cube, docked tool card
// with a bottom-centre action bar, and the tighter zoom on entering a sketch.
import { expect, test } from './fixtures'
import { buildBox, clickCubeFace, clientOf, drawRectangle, extrudeCard, newProject, toolButton, waitCameraStable } from './helpers'
import type { Page } from '@playwright/test'

const cameraDir = (page: Page) =>
  page.evaluate(() => {
    const e = window.__3dparter!.engine
    const d = e.camera.position.clone().sub(e.controls.target).normalize()
    return [d.x, d.y, d.z] as [number, number, number]
  })

test.describe('desktop layout', () => {
  test('tool rail shows names and key hints without changing accessible names', async ({ page }) => {
    await newProject(page)
    const rect = toolButton(page, 'Rectangle')
    await expect(rect).toContainText('Rectangle')
    await expect(rect).toContainText('R')
    await expect(rect).toHaveAttribute('aria-keyshortcuts', 'R')
    for (const n of ['Circle', 'Line', 'Arc', 'Extrude']) await expect(toolButton(page, n)).toBeVisible()
  })

  test('orientation cube faces fly the camera; Home view returns', async ({ page }) => {
    await newProject(page)
    await waitCameraStable(page)
    const home = await cameraDir(page)
    await clickCubeFace(page, 'View from top')
    await waitCameraStable(page)
    const top = await cameraDir(page)
    expect(top[2]).toBeGreaterThan(0.999)
    await page.getByRole('button', { name: 'Home view' }).click()
    await waitCameraStable(page)
    const back = await cameraDir(page)
    for (let i = 0; i < 3; i++) expect(Math.abs(back[i] - home[i])).toBeLessThan(0.01)
    // From the top, the Front face is edge-on; keyboard focus still reaches every face.
    await page.getByRole('button', { name: 'View from front' }).focus()
    await page.keyboard.press('Enter')
    await waitCameraStable(page)
    const front = await cameraDir(page)
    expect(front[1]).toBeLessThan(-0.999)
  })

  test('view column opens the side panel on a tab', async ({ page }) => {
    await newProject(page)
    await page.getByRole('button', { name: 'Collapse sidebar' }).click()
    await page.getByRole('button', { name: 'Show Items' }).click()
    await expect(page.getByRole('tab', { name: 'Items' })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('button', { name: 'Collapse sidebar' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Zoom to fit' })).toHaveCount(1)
  })

  test('Extrude card docks bottom-left; Cancel and Apply sit at the bottom centre', async ({ page }) => {
    await newProject(page)
    await drawRectangle(page)
    await page.getByRole('button', { name: 'Finish sketch' }).click()
    await toolButton(page, 'Extrude').click()
    const card = extrudeCard(page)
    await expect(card).toBeVisible()
    const box = (await card.boundingBox())!
    const vp = page.viewportSize()!
    expect(box.x + box.width / 2, 'card in the left half').toBeLessThan(vp.width / 2)
    expect(box.y + box.height, 'card at the bottom').toBeGreaterThan(vp.height - 40)
    const apply = card.getByRole('button', { name: 'Apply' })
    const cancel = card.getByRole('button', { name: 'Cancel' })
    const a = (await apply.boundingBox())!
    const c = (await cancel.boundingBox())!
    expect((a.x + c.x + c.width + a.width) / 2, 'actions centred').toBeGreaterThan(vp.width / 2 - 80)
    expect((a.x + c.x + c.width + a.width) / 2).toBeLessThan(vp.width / 2 + 80)
    expect(a.y, 'actions at the bottom').toBeGreaterThan(vp.height - 80)
    await expect(apply).toContainText('Enter')
    await expect(cancel).toContainText('Esc')
  })

  test('entering a sketch frames its geometry; leaving restores the 3D view', async ({ page }) => {
    await newProject(page)
    await waitCameraStable(page)
    const home = await cameraDir(page)
    await buildBox(page)
    await waitCameraStable(page)
    const before = await cameraDir(page)
    await page.getByRole('tree', { name: 'History' }).getByRole('treeitem', { name: /Sketch 1/ }).click()
    await waitCameraStable(page)
    const [x0, y0] = await clientOf(page, [0, 0, 0])
    const [x1, y1] = await clientOf(page, [40, 0, 0])
    // The sketch is framed in the part of the view the panels leave free (about 900 of 1440 px), not the whole canvas.
    expect(Math.hypot(x1 - x0, y1 - y0), 'the 40 mm side spans at least 340 px').toBeGreaterThan(340)
    expect(x1, 'and stays clear of the side panels').toBeLessThan(1040)
    await page.getByRole('button', { name: 'Finish sketch' }).click()
    await waitCameraStable(page)
    const after = await cameraDir(page)
    for (let i = 0; i < 3; i++) expect(Math.abs(after[i] - before[i])).toBeLessThan(0.02)
    expect(home).toBeTruthy()
  })
})

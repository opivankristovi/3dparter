// M5 features: STEP import (S10 / F08), Extrude offset & through-all, Loft, Split, Mirror, Pattern,
// sketcher Polygon/Slot/Trim/Fillet corner/Mirror/Pattern, adaptive Suggested tools, body colour & opacity,
// Section view, Wireframe display mode, Space/Ctrl+1 camera shortcuts, '?' shortcut sheet (S13),
// viewport context menu, and native .3dshaper.json project export/import.
import { readFileSync } from 'node:fs'
import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import {
  blendEdges,
  bodyMeshes,
  bodyStats,
  buildBox,
  clickWorld,
  doc,
  drawRectangle,
  extrudeCard,
  historyItem,
  near,
  newProject,
  pickTopPlane,
  pickTopPlaneAgain,
  settle,
  sketches,
  toolButton,
  waitCameraStable,
  waitReady,
} from './helpers'

async function expectNoA11yViolations(page: Page, name: string) {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => Number.isFinite(a.effect?.getComputedTiming().iterations))
        .map((a) => a.finished.catch(() => {})),
    ),
  )
  const results = await new AxeBuilder({ page }).exclude('canvas').analyze()
  const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical' || v.impact === 'moderate')
  expect(
    blocking.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
    `axe violations on ${name}`,
  ).toEqual([])
}

test.describe('M5 features', () => {
  test('F08-H1: exports STEP, imports it via S10 dialog as editable root body, fillets an edge, and persists across reload', async ({ page }) => {
    await newProject(page)
    await buildBox(page)
    await settle(page)

    await page.getByRole('button', { name: 'Export', exact: true }).click()
    const exportDialog = page.getByRole('dialog', { name: 'Export' })
    await exportDialog.getByRole('combobox', { name: 'Format' }).click()
    await page.getByRole('option', { name: 'STEP', exact: true }).click()
    const [dl] = await Promise.all([
      page.waitForEvent('download'),
      exportDialog.getByRole('button', { name: 'Export', exact: true }).click(),
    ])
    const stepPath = (await dl.path())!
    const stepName = dl.suggestedFilename()
    expect(stepName).toMatch(/\.step$/)
    await expect(exportDialog).toBeHidden()

    // Import into a brand new project.
    await newProject(page)
    await page.getByRole('button', { name: 'Import', exact: true }).click()
    const importDialog = page.getByRole('dialog', { name: 'Import' })
    await expect(importDialog).toBeVisible()
    await importDialog.getByLabel('CAD file').setInputFiles({
      name: stepName,
      mimeType: 'application/step',
      buffer: readFileSync(stepPath),
    })
    await expect(importDialog.getByRole('button', { name: 'Import', exact: true })).toBeEnabled()
    await expectNoA11yViolations(page, 'Import dialog')
    await importDialog.getByRole('button', { name: 'Import', exact: true }).click()
    await expect(importDialog).toBeHidden()

    await expect.poll(() => bodyMeshes(page)).toBe(1)
    await settle(page)
    await page.getByRole('button', { name: 'Zoom to fit', exact: true }).click()
    await waitCameraStable(page)

    await expect(historyItem(page, 'Untitled')).toBeVisible()
    const before = await bodyStats(page)
    near(before[0].volume, 8000, 120)

    // Fillet a top edge on the imported solid (r=2 along 40 mm removes ~34.34 mm3).
    await blendEdges(page, 'Fillet', [[20, 0, 10]], '2')
    const after = await bodyStats(page)
    expect(after[0].volume).toBeLessThan(before[0].volume - 20)

    await page.waitForTimeout(600)
    await page.reload()
    await waitReady(page)
    await expect.poll(() => bodyMeshes(page)).toBe(1)
  })

  test('M5-H1: Extrude start offset & through-all, Split, Mirror, Pattern, and Loft', async ({ page }) => {
    await newProject(page)
    await drawRectangle(page, '40', '20')
    await page.getByRole('button', { name: 'Finish sketch' }).click()

    await toolButton(page, 'Extrude').click()
    const card = extrudeCard(page)
    await expect(card).toBeVisible()
    await card.getByRole('radiogroup', { name: 'Start' }).getByRole('radio', { name: 'Offset' }).click()
    await card.getByLabel('Start offset').fill('5')
    await card.getByLabel('Start offset').blur()
    await card.getByRole('button', { name: 'Apply' }).click()
    await expect(card).toBeHidden()
    await settle(page)

    let stats = await bodyStats(page)
    expect(stats).toHaveLength(1)
    near(stats[0].min[2], 5, 0.2)
    near(stats[0].max[2], 15, 0.2)
    near(stats[0].volume, 8000, 120)

    // Sketch an inner rectangle on Top and cut Through all.
    await toolButton(page, 'Rectangle').click()
    await pickTopPlaneAgain(page)
    await clickWorld(page, [10, 5, 0])
    await expect(page.getByRole('group', { name: 'Shape size' })).toBeVisible()
    await page.keyboard.type('10')
    await page.keyboard.press('Tab')
    await page.keyboard.type('10')
    await page.keyboard.press('Enter')
    await page.getByRole('button', { name: 'Finish sketch' }).click()

    await toolButton(page, 'Extrude').click()
    await expect(card).toBeVisible()
    await card.getByRole('radiogroup', { name: 'Extent' }).getByRole('radio', { name: 'Through all' }).click()
    await expect(card.getByLabel('Distance')).toBeDisabled()
    await card.getByRole('radiogroup', { name: 'Operation' }).getByRole('radio', { name: 'Cut' }).click()
    await settle(page)
    await card.getByRole('button', { name: 'Apply' }).click()
    await expect(card).toBeHidden()
    await settle(page)

    stats = await bodyStats(page)
    near(stats[0].volume, 7000, 140)

    // Offset Plane + Second sketch + Loft on a clean project.
    await newProject(page)
    await drawRectangle(page, '20', '20')
    await page.getByRole('button', { name: 'Finish sketch' }).click()

    await toolButton(page, 'Plane').click()
    const planeCard = page.getByRole('dialog', { name: 'Plane', exact: true })
    await expect(planeCard).toBeVisible()
    await planeCard.getByLabel('Offset').fill('25')
    await planeCard.getByLabel('Offset').blur()
    await settle(page)
    await planeCard.getByRole('button', { name: 'Apply' }).click()
    await expect(planeCard).toBeHidden()
    const planeId = (await doc(page)).features.find((f) => f.type === 'plane')!.id

    await page.evaluate((id) => window.__3dshaper!.store.getState().setSelection([{ kind: 'constructionPlane', name: id }]), planeId)
    await toolButton(page, 'Rectangle').click()
    await expect.poll(async () => sketches(await doc(page)).length).toBe(2)
    await waitCameraStable(page)
    await clickWorld(page, [5, 5, 25])
    await expect(page.getByRole('group', { name: 'Shape size' })).toBeVisible()
    await page.keyboard.type('10')
    await page.keyboard.press('Tab')
    await page.keyboard.type('10')
    await page.keyboard.press('Enter')
    await page.getByRole('button', { name: 'Finish sketch' }).click()

    await toolButton(page, 'Loft').click()
    const loftCard = page.getByRole('dialog', { name: 'Loft', exact: true })
    await expect(loftCard).toBeVisible()
    const profileBtns = loftCard.getByRole('group', { name: 'Loft profile options' }).getByRole('button')
    await profileBtns.nth(0).click()
    await profileBtns.nth(1).click()
    await settle(page)
    await loftCard.getByRole('button', { name: 'Apply' }).click()
    await expect(loftCard).toBeHidden()
    await settle(page)

    stats = await bodyStats(page)
    expect(stats).toHaveLength(1)
    near(stats[0].max[2], 25, 0.2)
    expect(stats[0].volume).toBeGreaterThan(4500)

    // Split along a custom offset plane at Z = 10 -> 2 solids.
    await toolButton(page, 'Plane').click()
    await expect(planeCard).toBeVisible()
    await planeCard.getByLabel('Offset').fill('10')
    await planeCard.getByLabel('Offset').blur()
    await settle(page)
    await planeCard.getByRole('button', { name: 'Apply' }).click()
    const midPlaneId = (await doc(page)).features.filter((f) => f.type === 'plane')[1].id

    const loftBodyId = (await doc(page)).features.find((f) => f.type === 'loft')!.id
    await page.evaluate((id) => window.__3dshaper!.store.getState().setSelection([{ kind: 'body', name: id }]), loftBodyId)
    await toolButton(page, 'Split').click()
    const splitCard = page.getByRole('dialog', { name: 'Split', exact: true })
    await expect(splitCard).toBeVisible()
    await splitCard.getByRole('group', { name: 'Splitting plane' }).getByRole('button', { name: 'Plane 2' }).click()
    await settle(page)
    await splitCard.getByRole('button', { name: 'Apply' }).click()
    await expect(splitCard).toBeHidden()
    await settle(page)
    expect(midPlaneId).toBeTruthy()
    await expect.poll(() => bodyMeshes(page)).toBe(2)

    // Mirror one half across XZ plane -> 3 solids.
    await page.evaluate((id) => window.__3dshaper!.store.getState().setSelection([{ kind: 'body', name: id }]), loftBodyId)
    await toolButton(page, 'Mirror').click()
    const mirrorCard = page.getByRole('dialog', { name: 'Mirror', exact: true })
    await expect(mirrorCard).toBeVisible()
    await mirrorCard.getByRole('group', { name: 'Mirror plane' }).getByRole('button', { name: 'XZ' }).click()
    await settle(page)
    await mirrorCard.getByRole('button', { name: 'Apply' }).click()
    await expect(mirrorCard).toBeHidden()
    await settle(page)
    await expect.poll(() => bodyMeshes(page)).toBe(3)

    // Linear Pattern -> 5 solids total (adds 2 copies of the mirrored solid).
    await page.evaluate((id) => window.__3dshaper!.store.getState().setSelection([{ kind: 'body', name: id }]), loftBodyId)
    await toolButton(page, 'Pattern').click()
    const patCard = page.getByRole('dialog', { name: 'Pattern', exact: true })
    await expect(patCard).toBeVisible()
    await patCard.getByLabel('Spacing').fill('35')
    await patCard.getByLabel('Spacing').blur()
    await settle(page)
    await patCard.getByRole('button', { name: 'Apply' }).click()
    await expect(patCard).toBeHidden()
    await settle(page)
    await expect.poll(() => bodyMeshes(page)).toBe(5)
  })

  test('M5-H2: Sketcher Polygon, Slot, Trim, Fillet corner, Mirror sketch, and Pattern sketch', async ({ page }) => {
    await newProject(page)
    await toolButton(page, 'Polygon').click()
    await pickTopPlane(page)

    // Polygon: center [0,0], drag right and commit radius/diameter -> 6 lines.
    await clickWorld(page, [0, 0, 0])
    await expect(page.getByRole('group', { name: 'Shape size' })).toBeVisible()
    await page.keyboard.type('20')
    await page.keyboard.press('Enter')
    await expect.poll(async () => sketches(await doc(page))[0].sketch.entities.length).toBe(6)

    // Slot tool: anchor [40,0], drag toward [60,0] -> 4 entities (2 lines + 2 arcs).
    await toolButton(page, 'Slot').click()
    await clickWorld(page, [40, 0, 0])
    await expect(page.getByRole('group', { name: 'Shape size' })).toBeVisible()
    await page.keyboard.type('20')
    await page.keyboard.press('Tab')
    await page.keyboard.type('8')
    await page.keyboard.press('Enter')
    await expect.poll(async () => sketches(await doc(page))[0].sketch.entities.length).toBe(10)

    // Draw intersecting line segment and use Trim shortcut (T), Fillet corner, Mirror sketch, Pattern sketch.
    const skId = sketches(await doc(page))[0].id
    // Pick two adjacent hexagon lines and apply Fillet corner.
    const firstTwo = sketches(await doc(page))[0].sketch.entities.slice(0, 2).map((e) => `${skId}/${e.id}`)
    await page.evaluate(
      (refs) => window.__3dshaper!.store.getState().setSelection(refs.map((name) => ({ kind: 'sketchEdge' as const, name }))),
      firstTwo,
    )
    await page.getByRole('button', { name: 'Fillet corner' }).click()
    await expect.poll(async () => sketches(await doc(page))[0].sketch.entities.some((e) => e.type === 'arc')).toBe(true)

    // Pattern sketch: select 1 entity and click Pattern sketch -> +2 copies.
    const one = sketches(await doc(page))[0].sketch.entities[0]
    const beforePattern = sketches(await doc(page))[0].sketch.entities.length
    await page.evaluate((ref) => window.__3dshaper!.store.getState().setSelection([{ kind: 'sketchEdge', name: ref }]), `${skId}/${one.id}`)
    await page.getByRole('button', { name: 'Pattern sketch' }).click()
    await expect.poll(async () => sketches(await doc(page))[0].sketch.entities.length).toBe(beforePattern + 2)

    // Mirror sketch: select entity + construction line axis.
    await page.keyboard.press('l')
    await clickWorld(page, [-20, -20, 0])
    await expect(page.getByRole('group', { name: 'Shape size' })).toBeVisible()
    await page.keyboard.type('40')
    await page.keyboard.press('Enter')
    await toolButton(page, 'Line').click() // exit Line tool back to select mode
    const ents = sketches(await doc(page))[0].sketch.entities
    const axisEnt = ents[ents.length - 1]
    const beforeMirror = ents.length
    await page.evaluate(
      (refs) => window.__3dshaper!.store.getState().setSelection(refs.map((name) => ({ kind: 'sketchEdge' as const, name }))),
      [`${skId}/${one.id}`, `${skId}/${axisEnt.id}`],
    )
    await page.getByRole('button', { name: 'Mirror sketch' }).click()
    await expect.poll(async () => sketches(await doc(page))[0].sketch.entities.length).toBe(beforeMirror + 1)

    // Trim via T key trims or removes the selected entity.
    await page.evaluate((ref) => window.__3dshaper!.store.getState().setSelection([{ kind: 'sketchEdge', name: ref }]), `${skId}/${axisEnt.id}`)
    await page.keyboard.press('t')
    await expect.poll(async () => sketches(await doc(page))[0].sketch.entities.some((e) => e.id === axisEnt.id)).toBe(false)
  })

  test('M5-H3: Adaptive toolbar, Body appearance, Section view, Wireframe, Space/Ctrl+1, "?" sheet, Context menu, and .3dparter.json', async ({ page }) => {
    await newProject(page)
    await buildBox(page)
    await settle(page)
    await waitCameraStable(page)

    // Extrude Apply selects the created body -> Suggested actions toolbar appears.
    const suggested = page.getByRole('toolbar', { name: 'Suggested actions' })
    await expect(suggested).toBeVisible()
    await expect(suggested.getByRole('button', { name: 'Mirror' })).toBeVisible()
    await expect(suggested.getByRole('button', { name: 'Pattern' })).toBeVisible()

    // Items tab: set custom colour Blue & 50% opacity.
    await page.getByRole('tab', { name: 'Items' }).click()
    await page.getByRole('button', { name: /Appearance for/ }).first().click()
    await page.getByRole('menuitemcheckbox', { name: 'Blue' }).click()
    await page.getByRole('button', { name: /Appearance for/ }).first().click()
    await page.getByRole('menuitemcheckbox', { name: '50%' }).click()

    const app = await page.evaluate(() => Object.values(window.__3dshaper!.store.getState().doc.bodies)[0])
    expect(app.color).toBe('token:accent')
    expect(app.opacity).toBeCloseTo(0.5, 2)

    // Section view & Wireframe toggles in View controls.
    const sectionBtn = page.getByRole('button', { name: 'Section view' })
    await sectionBtn.click()
    await expect(sectionBtn).toHaveAttribute('aria-pressed', 'true')
    expect(await page.evaluate(() => window.__3dshaper!.engine.getSectionView())).toBe(true)

    const wireBtn = page.getByRole('button', { name: 'Wireframe' })
    await wireBtn.click()
    await expect(wireBtn).toHaveAttribute('aria-pressed', 'true')
    expect(await page.evaluate(() => window.__3dshaper!.engine.getDisplayMode())).toBe('wireframe')

    // Turn both back off via Viewport right-click context menu.
    const box = (await page.locator('canvas').boundingBox())!
    const cx = Math.round(box.x + box.width * 0.5)
    const cy = Math.round(box.y + box.height * 0.5)
    await page.mouse.click(cx, cy, { button: 'right' })
    const vpMenu = page.getByRole('menu', { name: 'Viewport menu' })
    await expect(vpMenu).toBeVisible()
    await vpMenu.getByRole('menuitemcheckbox', { name: 'Wireframe' }).click()
    await expect(vpMenu).toBeHidden()
    expect(await page.evaluate(() => window.__3dshaper!.engine.getDisplayMode())).toBe('shaded')

    await page.keyboard.press('Escape') // clear selection
    await expect(suggested).toBeHidden()

    // Select Top face / plane, press Space to zoom-to-face, then Ctrl+1 to reset Home view.
    await page.evaluate(() => window.__3dshaper!.store.getState().setSelection([{ kind: 'originPlane', name: 'XY' }]))
    await page.locator('canvas').focus()
    const keyBefore = await page.evaluate(() => window.__3dshaper!.engine.viewKey())
    await page.keyboard.press('Space')
    await waitCameraStable(page)
    const keyAfterSpace = await page.evaluate(() => window.__3dshaper!.engine.viewKey())
    expect(keyAfterSpace).not.toBe(keyBefore)

    await page.keyboard.press('Control+1')
    await waitCameraStable(page)
    const camPos = await page.evaluate(() => window.__3dshaper!.engine.camera.position.toArray())
    expect(camPos[2]).toBeGreaterThan(80)

    // '?' opens Keyboard shortcuts dialog (S13) with clean axe check.
    await page.keyboard.press('Shift+?')
    const shortcutDlg = page.getByRole('dialog', { name: 'Keyboard shortcuts' })
    await expect(shortcutDlg).toBeVisible()
    await expectNoA11yViolations(page, 'Keyboard shortcuts dialog')
    await shortcutDlg.getByRole('button', { name: 'Done' }).click()
    await expect(shortcutDlg).toBeHidden()

    // Navigate back to Dashboard -> Export .3dparter.json -> Import project -> appears in project list.
    await page.waitForTimeout(550)
    await page.getByRole('button', { name: 'Back to projects' }).click()
    await expect(page).toHaveURL(/#\/?$/)

    const firstCard = page.locator('li').first()
    await firstCard.getByRole('button', { name: /Actions for/i }).click()
    const [jsonDl] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('menuitem', { name: 'Export project' }).click(),
    ])
    expect(jsonDl.suggestedFilename()).toMatch(/\.3dparter\.json$/)
    const jsonPath = (await jsonDl.path())!
    const parsed = JSON.parse(readFileSync(jsonPath, 'utf8'))
    expect(parsed.schemaVersion).toBe(1)

    const beforeProjects = await page.locator('li').count()
    await page.getByLabel('Import project file').setInputFiles(jsonPath)
    await expect.poll(() => page.locator('li').count()).toBe(beforeProjects + 1)
  })
})

test.describe('@mobile M5 touch navigation', () => {
  test.use({ hasTouch: true })

  test('@mobile touch swipe orbits camera on phone viewport', async ({ page }) => {
    await newProject(page)
    const before = await page.evaluate(() => window.__3dshaper!.engine.camera.position.toArray())
    const box = (await page.locator('canvas').boundingBox())!
    const sx = Math.round(box.x + box.width * 0.5)
    const sy = Math.round(box.y + box.height * 0.5)
    await page.evaluate(
      ({ x, y }) => {
        const canvas = window.__3dshaper!.engine.canvas
        canvas.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, bubbles: true }))
        canvas.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, pointerType: 'touch', isPrimary: true, clientX: x + 90, clientY: y - 40, bubbles: true }))
        canvas.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, pointerType: 'touch', isPrimary: true, clientX: x + 140, clientY: y - 60, bubbles: true }))
        canvas.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, pointerType: 'touch', isPrimary: true, clientX: x + 140, clientY: y - 60, bubbles: true }))
      },
      { x: sx, y: sy },
    )
    const after = await page.evaluate(() => window.__3dshaper!.engine.camera.position.toArray())
    expect(Math.hypot(after[0] - before[0], after[1] - before[1], after[2] - before[2])).toBeGreaterThan(5)
  })
})

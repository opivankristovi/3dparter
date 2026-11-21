// M5 edge, negative, mobile, accessibility, and bug regression tests.
import type { Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { expect, test } from './fixtures'
import {
  addRectangleSketch,
  applyExtrude,
  bodyMeshes,
  bodyStats,
  buildBox,
  clickWorld,
  doc,
  drawRectangle,
  extrudeCard,
  extrudes,
  hasHorizontalScroll,
  historyItem,
  near,
  newProject,
  pickTopPlane,
  settle,
  sketches,
  toolButton,
  waitCameraStable,
  waitReady, axeFor } from './helpers'
import { addVariableInPanel, openVariables, variableRow } from './variablesPanel'

async function expectNoA11yViolations(page: Page, name: string) {
  const results = await axeFor(page).exclude('canvas').analyze()
  const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical' || v.impact === 'moderate')
  const details = blocking.map(
    (v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => `${n.target.join(' ')} (${n.failureSummary})`).join('; ')}`,
  )
  expect(details, `axe violations on ${name}:\n${details.join('\n')}`).toEqual([])
}

function readZipEntries(buffer: Buffer): Map<string, string> {
  const entries = new Map<string, string>()
  let pos = 0
  while (pos + 30 <= buffer.length && buffer.readUInt32LE(pos) === 0x04034b50) {
    const method = buffer.readUInt16LE(pos + 8)
    const size = buffer.readUInt32LE(pos + 18)
    const nameLen = buffer.readUInt16LE(pos + 26)
    const extraLen = buffer.readUInt16LE(pos + 28)
    const name = buffer.toString('utf8', pos + 30, pos + 30 + nameLen)
    const dataStart = pos + 30 + nameLen + extraLen
    if (method === 0) entries.set(name, buffer.toString('utf8', dataStart, dataStart + size))
    pos = dataStart + size
  }
  return entries
}

test.describe('M5 edge & negative cases', () => {
  test('F08-E1 & F08-N1-N3: STEP Import validation refuses unsupported/empty files, flags corrupt STEP, and undoes cleanly', async ({ page }) => {
    await newProject(page)
    await page.getByRole('button', { name: 'Import', exact: true }).click()
    const dlg = page.getByRole('dialog', { name: 'Import' })
    await expect(dlg).toBeVisible()

    // Non-STEP extension (.igs).
    await dlg.getByLabel('CAD file').setInputFiles({
      name: 'part.igs',
      mimeType: 'application/iges',
      buffer: Buffer.from('IGES header'),
    })
    // The file is checked as soon as it is chosen, so the message appears without clicking Import.
    await expect(dlg.getByRole('alert')).toContainText(/Unsupported file format/i)
    await expect(dlg).toBeVisible()

    // Valid extension but missing ISO-10303-21 header.
    await dlg.getByLabel('CAD file').setInputFiles({
      name: 'bad.step',
      mimeType: 'application/step',
      buffer: Buffer.from('not a real step file'),
    })
    await expect(dlg.getByRole('alert')).toContainText(/valid STEP/i)
    await expect(dlg).toBeVisible()

    // Syntactically corrupt STEP with header commits feature flagged in error, without crashing; Ctrl+Z removes it.
    await dlg.getByLabel('CAD file').setInputFiles({
      name: 'broken.step',
      mimeType: 'application/step',
      buffer: Buffer.from('ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\nGARBAGE;\nENDSEC;\nEND-ISO-10303-21;'),
    })
    await dlg.getByRole('button', { name: 'Import', exact: true }).click()
    await expect(dlg).toBeHidden()
    await settle(page)

    const item = historyItem(page, 'broken')
    await expect(item).toBeVisible()
    await expect(item.getByText(/Error:/)).toBeVisible()
    expect(await bodyMeshes(page)).toBe(0)

    await page.keyboard.press('Control+z')
    await expect(item).toBeHidden()
  })

  test('M5-E1: Slot width stability (BUG-023), Spline typed length (BUG-024), Ellipse extrusion, and Sweep UI', async ({ page }) => {
    await newProject(page)
    await toolButton(page, 'Slot').click()
    await pickTopPlane(page)

    // BUG-023: typing Length in Slot must not inflate the untouched Width field on Tab.
    await clickWorld(page, [0, 0, 0])
    const sizeGroup = page.getByRole('group', { name: 'Shape size' })
    await expect(sizeGroup).toBeVisible()
    await page.keyboard.type('20')
    await page.keyboard.press('Tab')
    await expect(sizeGroup.getByLabel('Width')).toHaveValue('4')
    await page.keyboard.type('8')
    await page.keyboard.press('Enter')
    await expect(page.getByRole('button', { name: /Radius dimension R 4 mm/ })).toBeVisible()

    // BUG-024: Spline typed Length (fixedA) must scale the committed end point distance from anchor to 40 mm.
    await toolButton(page, 'Spline').click()
    await clickWorld(page, [0, 20, 0])
    await clickWorld(page, [10, 28, 0])
    await expect(sizeGroup).toBeVisible()
    await page.keyboard.type('40')
    await page.keyboard.press('Enter')
    const splineEnts = sketches(await doc(page))[0].sketch.entities.slice(-8)
    const firstSplineLine = splineEnts[0]
    const lastSplineLine = splineEnts[splineEnts.length - 1]
    expect(
      firstSplineLine.type === 'line' &&
        lastSplineLine.type === 'line' &&
        Math.hypot(lastSplineLine.b[0] - firstSplineLine.a[0], lastSplineLine.b[1] - firstSplineLine.a[1]),
    ).toBeCloseTo(40, 1)

    // Ellipse closes a region and extrudes cleanly.
    await newProject(page)
    await toolButton(page, 'Ellipse').click()
    await pickTopPlane(page)
    await clickWorld(page, [0, 0, 0])
    await expect(sizeGroup).toBeVisible()
    await page.keyboard.type('20')
    await page.keyboard.press('Tab')
    await page.keyboard.type('10')
    await page.keyboard.press('Enter')
    await page.getByRole('button', { name: 'Finish sketch' }).click()
    await applyExtrude(page)
    await settle(page)
    const ellStats = await bodyStats(page)
    expect(ellStats).toHaveLength(1)
    expect(ellStats[0].volume).toBeGreaterThan(1000)

    // Sweep UI end-to-end: XY circle diameter 10 swept along XZ 30 mm vertical path -> ~2356 mm3.
    await newProject(page)
    await toolButton(page, 'Circle').click()
    await pickTopPlane(page)
    await clickWorld(page, [0, 0, 0])
    await expect(sizeGroup).toBeVisible()
    await page.keyboard.type('10')
    await page.keyboard.press('Enter')
    await page.getByRole('button', { name: 'Finish sketch' }).click()

    await page.evaluate(() => window.__3dparter!.store.getState().setSelection([{ kind: 'originPlane', name: 'XZ' }]))
    await toolButton(page, 'Line').click()
    await expect.poll(async () => sketches(await doc(page)).length).toBe(2)
    await waitCameraStable(page)
    await clickWorld(page, [0, 0, 0])
    const linePanel = page.getByRole('group', { name: 'Shape size' })
    await expect(linePanel).toBeVisible()
    await page.mouse.move(...(await page.evaluate(() => window.__3dparter!.toClient([0, 0, 30]))))
    await page.keyboard.type('30')
    await page.keyboard.press('Enter')
    await page.getByRole('button', { name: 'Finish sketch' }).click()
    const pathLine = sketches(await doc(page))[1].sketch.entities[0]
    expect(pathLine.type).toBe('line')
    if (pathLine.type === 'line') near(Math.hypot(pathLine.b[0] - pathLine.a[0], pathLine.b[1] - pathLine.a[1]), 30, 0.1)

    await toolButton(page, 'Sweep').click()
    const sweepCard = page.getByRole('dialog', { name: 'Sweep', exact: true })
    await expect(sweepCard).toBeVisible()
    await settle(page)
    await expectNoA11yViolations(page, 'Sweep card')
    const profileBtn = sweepCard.getByRole('group', { name: 'Profile options' }).getByRole('button').first()
    await expect(profileBtn).toHaveText(/^Sketch 1 · Region 1$/)
    const cardBox = (await sweepCard.boundingBox())!
    const btnBox = (await profileBtn.boundingBox())!
    expect(btnBox.x + btnBox.width).toBeLessThanOrEqual(cardBox.x + cardBox.width + 1)
    await sweepCard.getByRole('button', { name: 'Apply' }).click()
    await expect(sweepCard).toBeHidden()
    await settle(page)
    const sweepStats = await bodyStats(page)
    expect(sweepStats).toHaveLength(1)
    near(sweepStats[0].volume, Math.PI * 25 * 30, 80)
  })

  test('M5-E2: Loft/Split/Mirror/Pattern negative cases, History edit, axe scans, and variable Count sync (BUG-022)', async ({ page }) => {
    await newProject(page)
    await drawRectangle(page, '20', '20')
    await page.getByRole('button', { name: 'Finish sketch' }).click()
    await addRectangleSketch(page, [30, 0, 0], '10', '10')

    // Loft negative: two coplanar profiles cannot form a 3D loft -> error shown & Apply disabled + axe scan.
    await toolButton(page, 'Loft').click()
    const loftCard = page.getByRole('dialog', { name: 'Loft', exact: true })
    await expect(loftCard).toBeVisible()
    const btns = loftCard.getByRole('group', { name: 'Loft profile options' }).getByRole('button')
    await btns.nth(0).click()
    await btns.nth(1).click()
    await settle(page)
    await expect(loftCard.getByRole('button', { name: 'Apply' })).toBeDisabled()
    await expectNoA11yViolations(page, 'Loft card (error)')
    await loftCard.getByRole('button', { name: 'Cancel' }).click()

    // Box for Split / Mirror / Pattern negative & History edit tests.
    await newProject(page)
    await buildBox(page)
    await settle(page)

    // Split negative: YZ plane (x = 0) touches face but does not split through box [0..40].
    await toolButton(page, 'Split').click()
    const splitCard = page.getByRole('dialog', { name: 'Split', exact: true })
    await expect(splitCard).toBeVisible()
    await splitCard.getByRole('group', { name: 'Splitting plane' }).getByRole('button', { name: 'YZ' }).click()
    await settle(page)
    await expect(splitCard.getByRole('button', { name: 'Apply' })).toBeDisabled()
    await expectNoA11yViolations(page, 'Split card (missing plane)')
    await splitCard.getByRole('button', { name: 'Cancel' }).click()

    // Mirror with Join mirrored solids checked -> 1 merged solid (2x volume), then edit via History to unmerge -> 2 solids.
    await page.evaluate(
      (id) => window.__3dparter!.store.getState().setSelection([{ kind: 'body', name: id }]),
      (await doc(page)).features.find((f) => f.type === 'extrude')!.id,
    )
    await toolButton(page, 'Mirror').click()
    const mirrorCard = page.getByRole('dialog', { name: 'Mirror', exact: true })
    await expect(mirrorCard).toBeVisible()
    await mirrorCard.getByRole('switch', { name: 'Join mirrored solids' }).click()
    await settle(page)
    await expectNoA11yViolations(page, 'Mirror card')
    await mirrorCard.getByRole('button', { name: 'Apply' }).click()
    await expect(mirrorCard).toBeHidden()
    await settle(page)
    expect(await bodyMeshes(page)).toBe(1)
    near((await bodyStats(page))[0].volume, 16000, 120)

    await historyItem(page, 'Mirror 1').click()
    await expect(mirrorCard).toBeVisible()
    await mirrorCard.getByRole('switch', { name: 'Join mirrored solids' }).click()
    await settle(page)
    await mirrorCard.getByRole('button', { name: 'Apply' }).click()
    await settle(page)
    expect(await bodyMeshes(page)).toBe(2)

    // Undo unmerge back to 1 solid, pick the solid in Items, then open Pattern with Variable n.
    await page.keyboard.press('Control+z')
    await settle(page)
    expect(await bodyMeshes(page)).toBe(1)

    // Create variable n = 3 in Variables tab.
    const varsPanel = await openVariables(page)
    await addVariableInPanel(page, varsPanel, 'n', '3')
    await settle(page)

    await page.getByRole('tab', { name: 'Items' }).click()
    await page.getByRole('tree', { name: 'Solids' }).getByRole('treeitem').first().click()

    // Pattern negative checks + Circular preview + BUG-022 variable Count = n.
    await toolButton(page, 'Pattern').click()
    const patCard = page.getByRole('dialog', { name: 'Pattern', exact: true })
    await expect(patCard).toBeVisible()

    // Invalid Count ('1', '51', '2cm' unit suffix BUG-033, 'abc' + Enter) keeps Apply disabled and card open.
    const countInput = patCard.getByLabel('Count')
    await countInput.fill('1')
    await countInput.blur()
    await expect(patCard.getByRole('button', { name: 'Apply' })).toBeDisabled()
    await countInput.fill('51')
    await countInput.blur()
    await expect(patCard.getByRole('button', { name: 'Apply' })).toBeDisabled()
    await countInput.fill('2cm')
    await countInput.blur()
    await expect(countInput).toHaveAttribute('aria-invalid', 'true')
    await expect(patCard.getByRole('button', { name: 'Apply' })).toBeDisabled()
    await countInput.fill('abc')
    await countInput.press('Enter')
    await expect(patCard).toBeVisible()

    // Circular switch shows Angle field, Linear shows Spacing.
    await patCard.getByRole('radiogroup', { name: 'Pattern type' }).getByRole('radio', { name: 'Circular' }).click()
    await expect(patCard.getByLabel('Angle')).toBeVisible()
    await patCard.getByRole('radiogroup', { name: 'Pattern type' }).getByRole('radio', { name: 'Linear' }).click()
    await countInput.fill('n')
    await countInput.blur()
    await patCard.getByLabel('Spacing').fill('50')
    await patCard.getByLabel('Spacing').blur()
    await settle(page)
    await expectNoA11yViolations(page, 'Pattern card')
    await patCard.getByRole('button', { name: 'Apply' }).click()
    await expect(patCard).toBeHidden()
    await settle(page)
    await expect.poll(() => bodyMeshes(page)).toBe(3)

    // BUG-022: change variable n = 3 -> 5 -> Items, viewport meshes, and 3MF export must all report 5 solids!
    await page.getByRole('tab', { name: 'Variables' }).click()
    const nExpr = variableRow(varsPanel, 'n').getByLabel('Expression')
    await nExpr.fill('5')
    await nExpr.press('Enter')
    await settle(page)
    await expect.poll(() => bodyMeshes(page)).toBe(5)

    await page.getByRole('tab', { name: 'Items' }).click()
    await expect(page.getByRole('tree', { name: 'Solids' }).getByRole('treeitem')).toHaveCount(5)

    await page.getByRole('button', { name: 'Export', exact: true }).click()
    const exportDialog = page.getByRole('dialog', { name: 'Export' })
    const allVisibleRadio = exportDialog.getByRole('radiogroup', { name: 'Solids' }).getByRole('radio', { name: 'All visible (5)' })
    await expect(allVisibleRadio).toBeVisible()
    await allVisibleRadio.click()
    await exportDialog.getByRole('combobox', { name: 'Format' }).click()
    await page.getByRole('option', { name: '3MF', exact: true }).click()
    const [dl] = await Promise.all([
      page.waitForEvent('download'),
      exportDialog.getByRole('button', { name: 'Export', exact: true }).click(),
    ])
    const xml = readZipEntries(readFileSync((await dl.path())!)).get('3D/3dmodel.model')!
    expect([...xml.matchAll(/<object\b/g)]).toHaveLength(5)
    await expect(exportDialog).toBeHidden()

    // Rollback above Pattern 1 hides copies.
    await page.getByRole('tab', { name: 'History' }).click()
    const slider = page.getByRole('slider', { name: 'End of history' })
    await slider.focus()
    await page.keyboard.press('ArrowUp')
    await settle(page)
    await expect.poll(() => bodyMeshes(page)).toBe(1)
  })

  test('M5-E3: Extrude Start offset validation and History edit preserves Offset state', async ({ page }) => {
    await newProject(page)
    await drawRectangle(page, '20', '20')
    await page.getByRole('button', { name: 'Finish sketch' }).click()

    await toolButton(page, 'Extrude').click()
    const card = extrudeCard(page)
    await expect(card).toBeVisible()
    await card.getByRole('radiogroup', { name: 'Start' }).getByRole('radio', { name: 'Offset' }).click()
    const offsetInput = card.getByLabel('Start offset')
    await expect(offsetInput).toBeVisible()

    // Bad Start offset + Enter must NOT apply.
    await offsetInput.fill('abc')
    await offsetInput.press('Enter')
    await expect(card).toBeVisible()
    expect(extrudes(await doc(page))).toHaveLength(0)

    await offsetInput.fill('-5')
    await offsetInput.blur()
    await card.getByLabel('Distance').fill('15')
    await card.getByLabel('Distance').blur()
    await settle(page)
    await card.getByRole('button', { name: 'Apply' }).click()
    await expect(card).toBeHidden()
    await settle(page)

    const stats = await bodyStats(page)
    near(stats[0].min[2], -5, 0.2)
    near(stats[0].max[2], 10, 0.2)

    await historyItem(page, 'Extrude 1').click()
    await expect(card).toBeVisible()
    await expect(card.getByLabel('Start offset')).toHaveValue('-5')
  })

  test('M5-E4: Right-drag orbit vs menu, ? hotkey guards, appearance reload/reset, and invalid/emoji .3dshaper.json', async ({ page }) => {
    await newProject(page)
    await buildBox(page)
    await settle(page)
    await waitCameraStable(page)

    // Right-drag > 40 px orbits camera WITHOUT opening Viewport menu.
    const box = (await page.locator('canvas').boundingBox())!
    const cx = Math.round(box.x + box.width * 0.5)
    const cy = Math.round(box.y + box.height * 0.5)
    const camBefore = await page.evaluate(() => window.__3dparter!.engine.camera.position.toArray())
    await page.mouse.move(cx, cy)
    await page.mouse.down({ button: 'right' })
    await page.mouse.move(cx + 80, cy - 30, { steps: 6 })
    await page.mouse.up({ button: 'right' })
    const camAfter = await page.evaluate(() => window.__3dparter!.engine.camera.position.toArray())
    expect(Math.hypot(camAfter[0] - camBefore[0], camAfter[1] - camBefore[1], camAfter[2] - camBefore[2])).toBeGreaterThan(2)
    await expect(page.getByRole('menu', { name: 'Viewport menu' })).toBeHidden()

    // Stationary right-click opens Viewport menu cleanly with no axe violations, Escape closes.
    await page.mouse.click(cx, cy, { button: 'right' })
    const menu = page.getByRole('menu', { name: 'Viewport menu' })
    await expect(menu).toBeVisible()
    await expectNoA11yViolations(page, 'Viewport menu')
    await page.keyboard.press('Escape')
    await expect(menu).toBeHidden()

    // '?' does NOT open Shortcut sheet while renaming project or inside an open dialog.
    await page.getByRole('button', { name: 'Untitled' }).dblclick()
    const nameInput = page.getByLabel('Project name')
    await expect(nameInput).toBeVisible()
    await nameInput.fill('Bracket?1')
    await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeHidden()
    await nameInput.press('Enter')

    await page.getByRole('button', { name: 'Export', exact: true }).click()
    await expect(page.getByRole('dialog', { name: 'Export' })).toBeVisible()
    await page.keyboard.press('Shift+?')
    await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeHidden()
    await page.keyboard.press('Escape')

    // Body appearance Amber + 25% persists across reload, and Reset appearance restores defaults.
    await page.getByRole('tab', { name: 'Items' }).click()
    await page.getByRole('button', { name: /Appearance for/ }).first().click()
    await page.getByRole('menuitemcheckbox', { name: 'Amber' }).click()
    await page.getByRole('button', { name: /Appearance for/ }).first().click()
    await page.getByRole('menuitemcheckbox', { name: '25%' }).click()

    await page.waitForTimeout(650)
    await page.reload()
    await waitReady(page)
    const reloadedApp = await page.evaluate(() => Object.values(window.__3dparter!.store.getState().doc.bodies)[0])
    expect(reloadedApp.color).toBe('token:warning')
    expect(reloadedApp.opacity).toBeCloseTo(0.25, 2)

    await page.getByRole('tab', { name: 'Items' }).click()
    await page.getByRole('button', { name: /Appearance for/ }).first().click()
    await page.getByRole('menuitem', { name: 'Reset appearance' }).click()
    const resetApp = await page.evaluate(() => Object.values(window.__3dparter!.store.getState().doc.bodies)[0])
    expect(resetApp.color).toBeNull()
    expect(resetApp.opacity).toBe(1)

    // Dashboard: invalid .3dparter.json shows error toast; emoji/accented .3dparter.json imports cleanly.
    await page.waitForTimeout(600)
    await page.getByRole('button', { name: 'Back to projects' }).click()
    await expect(page).toHaveURL(/#\/?$/)

    await page.getByLabel('Import project file').setInputFiles({
      name: 'corrupt.3dparter.json',
      mimeType: 'application/json',
      buffer: Buffer.from('{bad json'),
    })
    await expect(page.getByText("Couldn't import the project")).toBeVisible()

    const firstCard = page.locator('li').first()
    await firstCard.getByRole('button', { name: /Actions for/i }).click()
    const [dl] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('menuitem', { name: 'Export project' }).click(),
    ])
    const exported = JSON.parse(readFileSync((await dl.path())!, 'utf8'))
    exported.name = 'Bracket Ø12 ✓ 🚀'
    await page.getByLabel('Import project file').setInputFiles({
      name: 'emoji.3dparter.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(exported)),
    })
    await expect(page.getByRole('link', { name: 'Bracket Ø12 ✓ 🚀' })).toBeVisible()
  })
})

test.describe('@mobile M5 phone layout (BUG-025)', () => {
  test('@mobile M5-E5: scrollable phone tool rail never overlaps Finish sketch, Suggested actions, or Extrude card', async ({ page }) => {
    await newProject(page)
    await drawRectangle(page, '20', '20')

    // Bottom horizontal tool rail must not overlap Finish sketch or cause horizontal overflow.
    const rail = page.getByRole('navigation', { name: 'Tools' }).locator('> div')
    const toolbar = page.getByRole('toolbar', { name: 'Tools' })
    const finishBtn = page.getByRole('button', { name: 'Finish sketch' })
    await expect(finishBtn).toBeVisible()
    const railBox1 = (await rail.boundingBox())!
    const toolbarBox = (await toolbar.boundingBox())!
    const finishBox = (await finishBtn.boundingBox())!
    expect(toolbarBox.x).toBeGreaterThanOrEqual(0)
    expect(toolbarBox.x + toolbarBox.width).toBeLessThanOrEqual(390)
    expect(await toolbar.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)
    expect(finishBox.y + finishBox.height).toBeLessThanOrEqual(railBox1.y + 1)
    expect(await hasHorizontalScroll(page)).toBe(false)

    // Extrude card sits above bottom tool rail cleanly.
    await finishBtn.click()
    await toolButton(page, 'Extrude').click()
    const ext = extrudeCard(page)
    await expect(ext).toBeVisible()
    const railBox2 = (await rail.boundingBox())!
    const extBox = (await ext.boundingBox())!
    expect(extBox.y + extBox.height).toBeLessThanOrEqual(railBox2.y + 1)
    await ext.getByRole('button', { name: 'Apply' }).click()
    await expect(ext).toBeHidden()
    await settle(page)

    // Suggested actions toolbar sits above bottom tool rail cleanly.
    const suggested = page.getByRole('toolbar', { name: 'Suggested actions' })
    await expect(suggested).toBeVisible()
    const railBox3 = (await rail.boundingBox())!
    const sugBox = (await suggested.boundingBox())!
    expect(sugBox.y + sugBox.height).toBeLessThanOrEqual(railBox3.y + 1)
    expect(await hasHorizontalScroll(page)).toBe(false)

    // Phone overflow More menu opens Keyboard shortcuts & Import STEP without overflow.
    await page.getByRole('button', { name: 'More' }).click()
    await page.getByRole('menuitem', { name: 'Keyboard shortcuts' }).click()
    const shortcutDlg = page.getByRole('dialog', { name: 'Keyboard shortcuts' })
    await expect(shortcutDlg).toBeVisible()
    expect(await hasHorizontalScroll(page)).toBe(false)
    await shortcutDlg.getByRole('button', { name: 'Done' }).click()

    await page.getByRole('button', { name: 'More' }).click()
    await page.getByRole('menuitem', { name: 'Import file' }).click()
    await expect(page.getByRole('dialog', { name: 'Import' })).toBeVisible()
  })
})

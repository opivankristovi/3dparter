import { expect, test } from './fixtures'
import {
  bodyMeshes,
  buildBox,
  clickWorld,
  doc,
  drawRectangle,
  exportStl,
  extrudeCard,
  extrudes,
  finishAndExtrude,
  hasHorizontalScroll,
  isEllipsized,
  near,
  newProject,
  pickTopPlane,
  projectId,
  savedProjects,
  settle,
  sketches,
  toolButton,
  waitCameraStable,
  waitReady,
} from './helpers'

const historyItem = (page: import('@playwright/test').Page, name: string) =>
  page.getByRole('tree', { name: 'History' }).getByRole('treeitem', { name: new RegExp(name) })

test.describe('F01 first part', () => {
  test('F01-H1 rectangle to STL', async ({ page }) => {
    await newProject(page)
    await drawRectangle(page)
    await finishAndExtrude(page)

    const history = page.getByRole('tree', { name: 'History' })
    await expect(history.getByRole('treeitem')).toHaveCount(2)
    await expect(historyItem(page, 'Sketch 1')).toBeVisible()
    await expect(historyItem(page, 'Extrude 1')).toBeVisible()

    const { info, filename } = await exportStl(page)
    expect(filename).toMatch(/\.stl$/)
    expect(info.binary, `byte length ${info.byteLength} should be 84 + 50 * ${info.triangles}`).toBe(true)
    expect(info.byteLength).toBe(84 + 50 * info.triangles)
    expect(info.triangles).toBe(12)
    near(info.size[0], 40)
    near(info.size[1], 20)
    near(info.size[2], 10)
    near(info.volume, 8000, 1)
  })

  test('F01-H2 keyboard only cylinder', async ({ page }) => {
    await newProject(page)
    await page.keyboard.press('c')
    await expect(toolButton(page, 'Circle')).toHaveAttribute('aria-pressed', 'true')
    await pickTopPlane(page)
    await clickWorld(page, [0, 0, 0])
    await expect(page.getByRole('group', { name: 'Shape size' })).toBeVisible()
    await page.keyboard.press('3')
    await page.keyboard.press('0')
    await page.keyboard.press('Enter')
    await expect.poll(async () => sketches(await doc(page)).flatMap((s) => s.sketch.entities).map((e) => e.type)).toEqual(['circle'])
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: 'Finish sketch' })).toBeHidden()
    await page.keyboard.press('e')
    const card = extrudeCard(page)
    await expect(card).toBeVisible()
    await expect(card.getByLabel('Distance')).toBeFocused()
    await expect(card.getByRole('button', { name: 'Apply' })).toBeEnabled()
    await page.keyboard.press('Enter')
    await expect(card).toBeHidden()
    await expect.poll(async () => Object.keys((await doc(page)).bodies).length).toBe(1)
    await expect.poll(() => bodyMeshes(page)).toBe(1)
    // The Items tab lists the one solid.
    await page.getByRole('tab', { name: 'Items' }).click()
    await expect(page.getByRole('tree', { name: 'Solids' }).getByRole('treeitem')).toHaveCount(1)
  })

  test('F01-E1 empty / zero / text distance', async ({ page }) => {
    await newProject(page)
    await drawRectangle(page)
    await page.getByRole('button', { name: 'Finish sketch' }).click()
    await toolButton(page, 'Extrude').click()
    const card = extrudeCard(page)
    await expect(card).toBeVisible()
    const distance = card.getByLabel('Distance')
    const apply = card.getByRole('button', { name: 'Apply' })
    for (const bad of ['', '0', 'abc']) {
      await distance.fill(bad)
      await distance.blur()
      // A word is read as a variable name now, so it gets the "no variable" message.
      const message = bad === 'abc' ? 'There is no variable called abc.' : 'Enter a number above zero.'
      await expect(card.getByText(message), `error for "${bad}"`).toBeVisible()
      await expect(apply, `Apply for "${bad}"`).toBeDisabled()
      expect(extrudes(await doc(page)), `no feature added for "${bad}"`).toHaveLength(0)
    }
  })

  test('F01-E1b Enter key on a bad distance does not apply', async ({ page }) => {
    await newProject(page)
    await drawRectangle(page)
    await page.getByRole('button', { name: 'Finish sketch' }).click()
    await toolButton(page, 'Extrude').click()
    const card = extrudeCard(page)
    await expect(card.getByRole('button', { name: 'Apply' })).toBeEnabled()
    for (const bad of ['0', 'abc', '']) {
      await card.getByLabel('Distance').fill(bad)
      await card.getByLabel('Distance').press('Enter')
      await page.waitForTimeout(300)
      expect(extrudes(await doc(page)), `Enter on "${bad}" must not add an extrude`).toHaveLength(0)
      await expect(card).toBeVisible()
    }
  })

  test('F01-E2 very long project name', async ({ page }) => {
    const name = ('Long project name ' + 'abcdefghij'.repeat(5)).slice(0, 60)
    expect(name).toHaveLength(60)
    await newProject(page)
    await page.getByRole('button', { name: 'Untitled', exact: true }).dblclick()
    await page.getByRole('textbox', { name: 'Project name' }).fill(name)
    await page.keyboard.press('Enter')
    const top = page.getByRole('button', { name, exact: true })
    await expect(top).toBeVisible()
    expect(await isEllipsized(top), 'top bar name is cut with an ellipsis').toBe(true)
    expect.soft(await top.getAttribute('title'), 'full name in the top bar title attribute').toContain(name)
    expect(await hasHorizontalScroll(page), 'no horizontal scroll in the workspace').toBe(false)
    await expect.poll(async () => (await savedProjects(page)).map((p) => p.name)).toContain(name)

    await page.getByRole('button', { name: 'Back to projects' }).click()
    const cardName = page.getByRole('main').getByText(name, { exact: true })
    await expect(cardName).toBeVisible()
    expect(await isEllipsized(cardName), 'card name is cut with an ellipsis').toBe(true)
    await expect(cardName).toHaveAttribute('title', name)
    expect(await hasHorizontalScroll(page), 'no horizontal scroll on the dashboard').toBe(false)
  })

  test('F01-E3 emoji and accents', async ({ page }) => {
    const name = 'Bracket – Ø12 ✓ été 🚀'
    await newProject(page)
    await page.getByRole('button', { name: 'Untitled', exact: true }).dblclick()
    await page.getByRole('textbox', { name: 'Project name' }).fill(name)
    await page.keyboard.press('Enter')
    await expect(page.getByRole('button', { name, exact: true })).toBeVisible()
    await expect.poll(async () => (await savedProjects(page)).map((p) => p.name)).toContain(name)

    await buildBox(page)
    const { filename, info } = await exportStl(page)
    expect(filename).toMatch(/\.stl$/)
    expect(filename.length).toBeGreaterThan('.stl'.length)
    expect(filename, 'file name has no characters Windows forbids').not.toMatch(/[\\/:*?"<>|]/)
    expect(info.triangles).toBe(12)
    console.log(`F01-E3 suggested filename: ${filename}`)

    await page.reload()
    await waitReady(page)
    await expect(page.getByRole('button', { name, exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Back to projects' }).click()
    await expect(page.getByRole('main').getByText(name, { exact: true })).toBeVisible()
  })

  test('F01-E4 double click Apply', async ({ page }) => {
    await newProject(page)
    await drawRectangle(page)
    await page.getByRole('button', { name: 'Finish sketch' }).click()
    await toolButton(page, 'Extrude').click()
    const card = extrudeCard(page)
    const apply = card.getByRole('button', { name: 'Apply' })
    await expect(apply).toBeEnabled()
    await apply.dblclick()
    await expect(card).toBeHidden()
    await page.waitForTimeout(400)
    expect(extrudes(await doc(page))).toHaveLength(1)
  })

  test('F01-E5 refresh mid-flow', async ({ page }) => {
    await newProject(page)
    await toolButton(page, 'Rectangle').click()
    await pickTopPlane(page)
    await clickWorld(page, [0, 0, 0])
    await expect(page.getByRole('group', { name: 'Shape size' })).toBeVisible()
    await page.reload()
    await waitReady(page)
    await expect(page.getByRole('button', { name: 'Back to projects' })).toBeVisible()
    await expect(page.getByRole('alert')).toHaveCount(0)
    const d = await doc(page)
    expect(
      d.features.flatMap((f) => (f.type === 'sketch' ? f.sketch.entities : [])),
      'no half shape saved',
    ).toHaveLength(0)
    expect(extrudes(d)).toHaveLength(0)
  })

  test('F01-E6 back button mid-flow', async ({ page }) => {
    await newProject(page)
    const id = await projectId(page)
    await drawRectangle(page)
    await page.getByRole('button', { name: 'Finish sketch' }).click()
    await toolButton(page, 'Extrude').click()
    await expect(extrudeCard(page)).toBeVisible()
    await page.goBack()
    await expect(page).not.toHaveURL(/#\/p\//)
    await expect(page.getByRole('heading', { name: 'Projects', level: 1 })).toBeVisible()
    await expect(page.getByRole('main').getByRole('link', { name: /^Untitled, / })).toBeVisible()
    await expect
      .poll(async () => {
        const p = (await savedProjects(page)).find((x) => x.id === id)
        return p ? { sketches: p.document.features.filter((f) => f.type === 'sketch').length, extrudes: p.document.features.filter((f) => f.type === 'extrude').length } : null
      })
      .toEqual({ sketches: 1, extrudes: 0 })
  })

  test('F01-E7 two tabs', async ({ page, context }) => {
    await newProject(page)
    const b = await context.newPage()
    await b.goto(page.url())
    await waitReady(b)
    await expect(b.getByRole('button', { name: 'Back to projects' })).toBeVisible()

    // Edit in tab A: open a sketch (one undo step, saved after the debounce).
    await page.bringToFront()
    await page.keyboard.press('r')
    await pickTopPlane(page)

    await expect(b.getByText('Changed in another tab. Reload to continue.')).toBeVisible()
    await expect(b.getByRole('button', { name: 'Reload' })).toBeVisible()
    // No silent overwrite: B still holds the old (empty) document until it reloads.
    expect((await doc(b)).features).toHaveLength(0)
    // Wait for the page to really reload first: waitReady alone can still see the old page's engine in slower browsers.
    const reloaded = b.waitForEvent('load')
    await b.getByRole('button', { name: 'Reload' }).click()
    await reloaded
    await waitReady(b)
    await expect.poll(async () => (await doc(b)).features.length).toBe(1)
    await expect(b.getByText('Changed in another tab. Reload to continue.')).toHaveCount(0)
  })

  test('F01-E9 mobile keyboard flow at 390 @mobile', async ({ page }) => {
    await newProject(page)
    expect(page.viewportSize()).toEqual({ width: 390, height: 844 })
    const rail = page.getByRole('toolbar', { name: 'Tools' })
    const railBox = (await rail.boundingBox())!
    expect(railBox.y, 'tool rail sits in the lower half').toBeGreaterThan(844 / 2)
    expect(railBox.x).toBeGreaterThanOrEqual(0)
    expect(railBox.x + railBox.width).toBeLessThanOrEqual(390)

    await page.keyboard.press('c')
    await pickTopPlane(page)
    await clickWorld(page, [0, 0, 0])
    await expect(page.getByRole('group', { name: 'Shape size' })).toBeVisible()
    await page.keyboard.press('3')
    await page.keyboard.press('0')
    await page.keyboard.press('Enter')
    await expect.poll(async () => sketches(await doc(page)).flatMap((s) => s.sketch.entities).length).toBe(1)
    await page.keyboard.press('Escape')
    await page.keyboard.press('e')
    const card = extrudeCard(page)
    await expect(card).toBeVisible()
    const box = (await card.boundingBox())!
    expect(box.x, 'card inside the viewport (left)').toBeGreaterThanOrEqual(0)
    expect(box.x + box.width, 'card inside the viewport (right)').toBeLessThanOrEqual(390)
    expect(box.y + box.height, 'card inside the viewport (bottom)').toBeLessThanOrEqual(844)
    await expect(card.getByRole('button', { name: 'Apply' })).toBeVisible()
    await expect(card.getByLabel('Distance')).toBeVisible()
    expect(await hasHorizontalScroll(page), 'no horizontal scroll').toBe(false)
    await expect(card.getByRole('button', { name: 'Apply' })).toBeEnabled()
    await page.keyboard.press('Enter')
    await expect(card).toBeHidden()
    await expect.poll(async () => Object.keys((await doc(page)).bodies).length).toBe(1)
  })

  test('F01-N1 extrude with no closed shape', async ({ page }) => {
    await newProject(page)
    await toolButton(page, 'Line').click()
    await pickTopPlane(page)
    await clickWorld(page, [0, 0, 0])
    await clickWorld(page, [30, 10, 0])
    await page.keyboard.press('Enter') // ends the chain
    await expect.poll(async () => sketches(await doc(page)).flatMap((s) => s.sketch.entities).length).toBe(1)
    await page.getByRole('button', { name: 'Finish sketch' }).click()
    await toolButton(page, 'Extrude').click()
    await expect(page.getByText('Pick a shape to extrude')).toBeVisible()
    await expect(extrudeCard(page)).toHaveCount(0)
    await page.waitForTimeout(300)
    const d = await doc(page)
    expect(extrudes(d)).toHaveLength(0)
    expect(Object.keys(d.bodies)).toHaveLength(0)
  })

  test('F01-N2 export with no bodies', async ({ page }) => {
    await newProject(page)
    await page.getByRole('button', { name: 'Export', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Export' })
    await expect(dialog.getByText('Nothing to export yet')).toBeVisible()
    const exportBtn = dialog.getByRole('button', { name: 'Export', exact: true })
    if ((await exportBtn.count()) > 0) await expect(exportBtn).toBeDisabled()
  })
})

test.describe('F02 change a dimension later', () => {
  test('F02-H1 edit extrude distance from History', async ({ page }) => {
    await newProject(page)
    await buildBox(page)
    await historyItem(page, 'Extrude 1').click()
    const card = extrudeCard(page)
    await expect(card).toBeVisible()
    await expect(card.getByText('Editing step 2')).toBeVisible()
    const distance = card.getByLabel('Distance')
    await expect(distance).toHaveValue('10')
    await distance.fill('25')
    await distance.press('Enter')
    await expect(card).toBeHidden()
    expect(extrudes(await doc(page))[0].params.distance).toBe('25')
    await settle(page)
    await expect.poll(() => bodyMeshes(page)).toBe(1)

    const { info } = await exportStl(page)
    near(info.size[0], 40)
    near(info.size[1], 20)
    near(info.size[2], 25)
    near(info.volume, 20000, 2)
  })

  test('F02-H2 undo and redo', async ({ page }) => {
    await newProject(page)
    await buildBox(page)
    await historyItem(page, 'Extrude 1').click()
    const card = extrudeCard(page)
    await card.getByLabel('Distance').fill('25')
    await card.getByLabel('Distance').press('Enter')
    await expect(card).toBeHidden()
    const dist = async () => extrudes(await doc(page))[0].params.distance
    const savedDist = async () => {
      const id = await projectId(page)
      const p = (await savedProjects(page)).find((x) => x.id === id)
      return p ? extrudes(p.document)[0]?.params.distance : undefined
    }
    expect(await dist()).toBe('25')
    await expect.poll(savedDist).toBe('25')

    await page.keyboard.press('Control+z')
    await expect.poll(dist).toBe('10')
    await expect.poll(savedDist, 'saved document follows undo').toBe('10')

    await page.keyboard.press('Control+y')
    await expect.poll(dist).toBe('25')
    await expect.poll(savedDist, 'saved document follows redo').toBe('25')
  })

  test('F02-N1 delete the sketch an extrude uses', async ({ page }) => {
    await newProject(page)
    await buildBox(page)
    await historyItem(page, 'Sketch 1').click({ button: 'right' })
    await page.getByRole('menuitem', { name: /Delete/ }).click()
    await expect(historyItem(page, 'Sketch 1')).toHaveCount(0)
    const extrudeRow = historyItem(page, 'Extrude 1')
    await expect(extrudeRow).toContainText(/Error: .{5,}/)
    await expect(page.getByText('The geometry engine failed to load.')).toHaveCount(0)
    await expect(extrudeRow).toBeVisible()

    await page.keyboard.press('Control+z')
    await expect(historyItem(page, 'Sketch 1')).toBeVisible()
    await expect(historyItem(page, 'Extrude 1')).toBeVisible()
    await expect(historyItem(page, 'Extrude 1')).not.toContainText('Error:')
    expect((await doc(page)).features).toHaveLength(2)
    await expect.poll(() => bodyMeshes(page)).toBe(1)
  })
})

test.describe('X settings', () => {
  test('X-2 theme and units persist', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Settings' }).click()
    const dialog = page.getByRole('dialog', { name: 'Settings' })
    await dialog.getByRole('radio', { name: 'Dark' }).click()
    await dialog.getByRole('combobox', { name: 'Units' }).click()
    await page.getByRole('option', { name: 'Inches (in)' }).click()
    await expect(dialog.getByRole('combobox', { name: 'Units' })).toContainText('Inches')
    await dialog.getByRole('button', { name: 'Done' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')

    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await page.getByRole('button', { name: 'Settings' }).click()
    await expect(page.getByRole('dialog', { name: 'Settings' }).getByRole('combobox', { name: 'Units' })).toContainText('Inches')
    await page.getByRole('dialog', { name: 'Settings' }).getByRole('button', { name: 'Done' }).click()

    // A new project uses the saved units: the Extrude card shows `in`.
    await newProject(page)
    await toolButton(page, 'Rectangle').click()
    await pickTopPlane(page)
    await clickWorld(page, [0, 0, 0])
    await expect(page.getByRole('group', { name: 'Shape size' })).toBeVisible()
    await page.keyboard.type('1')
    await page.keyboard.press('Tab')
    await page.keyboard.type('0.5')
    await page.keyboard.press('Enter')
    await expect.poll(async () => sketches(await doc(page)).flatMap((s) => s.sketch.entities).length).toBe(4)
    await page.getByRole('button', { name: 'Finish sketch' }).click()
    await toolButton(page, 'Extrude').click()
    const card = extrudeCard(page)
    await expect(card).toBeVisible()
    await expect(card.getByText('in', { exact: true })).toBeVisible()
    expect((await doc(page)).units).toBe('in')
    await waitCameraStable(page)
  })
})

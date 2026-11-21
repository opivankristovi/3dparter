// Scale tool, grid snap switch with its size readout, and saving the view as an image.
import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { buildBox, clickWorld, doc, exportStl, newProject, pickTopPlane, settle, sketches, toolButton, waitCameraStable } from './helpers'

const card = (page: Page, name: string) => page.getByRole('dialog', { name, exact: true })
const lines = async (page: Page) =>
  sketches(await doc(page)).flatMap((s) => s.sketch.entities.flatMap((e) => (e.type === 'line' ? [e] : [])))
const isWhole = (n: number) => Math.abs(n - Math.round(n)) < 1e-6

test.describe('Scale', () => {
  test('scales the box by 2 about the origin: volume x8, then shows as Scale in History', async ({ page }) => {
    await newProject(page)
    await buildBox(page) // 40 x 20 x 10 = 8000 mm3
    await settle(page)
    await waitCameraStable(page)

    await toolButton(page, 'Scale').click()
    const scale = card(page, 'Scale')
    await expect(scale).toBeVisible()
    await expect(scale.getByRole('radio', { name: 'Origin' })).toBeChecked()
    await scale.getByLabel('Factor').fill('2')
    await scale.getByLabel('Factor').press('Tab')
    await settle(page)
    await scale.getByRole('button', { name: 'Apply' }).click()
    await expect(scale).toBeHidden()

    await expect(page.getByRole('tree', { name: 'History' }).getByRole('treeitem', { name: /Scale 1/ })).toBeVisible()
    await settle(page)
    const { info } = await exportStl(page)
    expect(info.volume).toBeCloseTo(64000, -1)
  })

  test('a factor of 0 is refused in the field', async ({ page }) => {
    await newProject(page)
    await buildBox(page)
    await settle(page)
    await toolButton(page, 'Scale').click()
    const scale = card(page, 'Scale')
    await scale.getByLabel('Factor').fill('0')
    await scale.getByLabel('Factor').press('Tab')
    await expect(scale.getByText('Enter a scale factor above zero', { exact: false })).toBeVisible()
    await expect(scale.getByRole('button', { name: 'Apply' })).toBeDisabled()
  })
})

test.describe('Grid snap', () => {
  test('the readout shows the grid size and the switch turns snapping off', async ({ page }) => {
    await newProject(page)
    await toolButton(page, 'Line').click()
    await pickTopPlane(page)

    const group = page.getByRole('group', { name: 'Grid snapping' })
    await expect(group.getByText('Grid 1 mm')).toBeVisible()
    const toggle = group.getByRole('button', { name: 'Snap to grid' })
    await expect(toggle).toHaveAttribute('aria-pressed', 'true')

    // On: the end point is rounded to the 1 mm grid.
    await clickWorld(page, [0, 0, 0])
    await clickWorld(page, [30.37, 12.61, 0])
    await page.keyboard.press('Escape')
    await expect.poll(async () => (await lines(page)).length).toBe(1)
    const snapped = (await lines(page))[0]
    expect(isWhole(snapped.b[0]) && isWhole(snapped.b[1])).toBe(true)

    // Off: the end point stays where the pointer was.
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-pressed', 'false')
    await clickWorld(page, [0, -20, 0])
    await clickWorld(page, [30.37, -12.61, 0])
    await page.keyboard.press('Escape')
    await expect.poll(async () => (await lines(page)).length).toBe(2)
    const free = (await lines(page))[1]
    expect(isWhole(free.b[0])).toBe(false)
    expect(isWhole(free.b[1])).toBe(false)
    expect(Math.abs(free.b[0] - 30.37)).toBeLessThan(0.5)
  })
})

test.describe('Save view as image', () => {
  test('downloads a PNG named after the project', async ({ page }) => {
    await newProject(page)
    await buildBox(page)
    await settle(page)
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Save view as image' }).click()])
    expect(dl.suggestedFilename()).toMatch(/\.png$/)
    const { readFileSync } = await import('node:fs')
    const bytes = readFileSync(await dl.path())
    expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    expect(bytes.length).toBeGreaterThan(1000)
  })
})

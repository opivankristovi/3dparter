// BUG-038: a click on Apply that arrives before the typed value is committed (Firefox can deliver the click without
// blurring the field first) was dropped by the field's guard, so the card stayed open and nothing was applied.
import { expect, test } from './fixtures'
import { buildBox, bodyStats, extrudeCard, historyItem, newProject, settle } from './helpers'

test('BUG-038 Apply clicked while a typed distance is still uncommitted applies that distance', async ({ page, browserName }) => {
  // A click with no pointer press first is not something a person can produce. In Playwright's Firefox it crashes
  // the page process (3 of 3 CI runs, see bugs.md "To check"); the human-speed test below covers real clicks there.
  test.skip(browserName === 'firefox', 'synthetic click without a pointer press crashes Playwright Firefox')
  await newProject(page)
  await buildBox(page)
  await settle(page)
  await historyItem(page, 'Extrude 1').click()
  const ext = extrudeCard(page)
  await expect(ext).toBeVisible()
  const field = ext.getByLabel('Distance')
  await field.click()
  await field.press('Control+a')
  await page.keyboard.type('25')
  await expect(field).toBeFocused()
  // Deliver the click without the mousedown that would blur the field.
  await ext.getByRole('button', { name: 'Apply' }).dispatchEvent('click')
  await expect(ext).toBeHidden()
  await settle(page)
  await expect.poll(async () => (await bodyStats(page))[0].volume).toBeCloseTo(40 * 20 * 25, -1)
})

test('BUG-038 a human-speed click on Apply right after typing still applies (Apply must not disable mid-click)', async ({ page }) => {
  await newProject(page)
  await buildBox(page)
  await settle(page)
  await historyItem(page, 'Extrude 1').click()
  const ext = extrudeCard(page)
  await expect(ext).toBeVisible()
  const field = ext.getByLabel('Distance')
  await field.click()
  await field.press('Control+a')
  await page.keyboard.type('25')
  // Press, hold like a person does, release. Pressing commits the field, which starts a new preview.
  const box = (await ext.getByRole('button', { name: 'Apply' }).boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  // Release while the preview of the new value is still being computed: on a slow machine or a big model that is
  // exactly where a person's mouse-up lands.
  await expect(ext).toHaveAttribute('aria-busy', 'true')
  await page.mouse.up()
  await expect(ext).toBeHidden()
  await settle(page)
  await expect.poll(async () => (await bodyStats(page))[0].volume).toBeCloseTo(40 * 20 * 25, -1)
})

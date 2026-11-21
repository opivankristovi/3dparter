// BUG-038: a click on Apply that arrives before the typed value is committed (Firefox can deliver the click without
// blurring the field first) was dropped by the field's guard, so the card stayed open and nothing was applied.
import { expect, test } from './fixtures'
import { buildBox, bodyStats, extrudeCard, historyItem, newProject, settle } from './helpers'

test('BUG-038 Apply clicked while a typed distance is still uncommitted applies that distance', async ({ page }) => {
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

import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { clickWorld, drawRectangle, extrudeCard, newProject, pickTopPlane, toolButton, waitCameraStable } from './helpers'

/** Scans the page; fails on serious / critical violations and lists every violation (id, impact, targets). */
async function scan(page: Page, screen: string) {
  const results = await new AxeBuilder({ page }).exclude('canvas').analyze()
  const lines = results.violations.map(
    (v) => `${v.id} [${v.impact}] x${v.nodes.length}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`,
  )
  for (const l of lines) console.log(`AXE ${screen}: ${l}`)
  if (lines.length === 0) console.log(`AXE ${screen}: no violations`)
  const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  expect(
    blocking.map((v) => v.id),
    `axe violations on ${screen} (all, including minor/moderate):\n${lines.join('\n') || '(none)'}`,
  ).toEqual([])
}

test.describe('F01-E10 axe scans', () => {
  test('F01-E10 S02 dashboard', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('main').getByRole('listitem')).toHaveCount(1)
    await scan(page, 'S02 dashboard')
  })

  test('F01-E10 S03 workspace idle', async ({ page }) => {
    await newProject(page)
    await expect(page.getByRole('toolbar', { name: 'Tools' })).toBeVisible()
    await scan(page, 'S03 workspace idle')
  })

  test('F01-E10 S03 while sketching', async ({ page }) => {
    await newProject(page)
    await toolButton(page, 'Rectangle').click()
    await pickTopPlane(page)
    await clickWorld(page, [0, 0, 0])
    await expect(page.getByRole('group', { name: 'Shape size' })).toBeVisible()
    await scan(page, 'S03 while sketching')
  })

  test('F01-E10 S05 Extrude card open', async ({ page }) => {
    await newProject(page)
    await drawRectangle(page)
    await page.getByRole('button', { name: 'Finish sketch' }).click()
    await toolButton(page, 'Extrude').click()
    await expect(extrudeCard(page)).toBeVisible()
    await waitCameraStable(page)
    await scan(page, 'S05 Extrude card')
  })

  test('F01-E10 S11 Export dialog open', async ({ page }) => {
    await newProject(page)
    await page.getByRole('button', { name: 'Export', exact: true }).click()
    await expect(page.getByRole('dialog', { name: 'Export' })).toBeVisible()
    await scan(page, 'S11 Export dialog (empty project)')
  })

  test('F01-E10 S12 Settings dialog open', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Settings' }).click()
    await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible()
    await scan(page, 'S12 Settings dialog')
  })
})

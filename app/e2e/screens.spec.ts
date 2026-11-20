// Full-page captures for later layout diffing against the original. They are not assertions;
// only the shared console / 5xx guard can fail them.
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Page, TestInfo } from '@playwright/test'
import { expect, test } from './fixtures'
import { buildBox, clickWorld, drawRectangle, extrudeCard, newProject, toolButton, waitCameraStable } from './helpers'

function outFile(info: TestInfo, name: string): string {
  const dir = resolve(info.config.rootDir, '..', '..', 'replica', 'clone-screens')
  mkdirSync(dir, { recursive: true })
  return resolve(dir, name)
}

// SCREENS_THEME=dark captures the dark theme into files named S03-dark.png etc., for diffing against an
// original that runs dark. The default captures stay light and keep their names.
const DARK = process.env.SCREENS_THEME === 'dark'
if (DARK) test.use({ colorScheme: 'dark' })

async function capture(page: Page, info: TestInfo, name: string) {
  await page.waitForTimeout(400) // tooltips and transitions
  const file = DARK ? name.replace(/\.png$/, '-dark.png') : name
  await page.screenshot({ path: outFile(info, file), fullPage: true })
}

test.describe('clone screens', () => {
  test('S02 dashboard', async ({ page }, info) => {
    await page.goto('/')
    await expect(page.getByRole('main').getByRole('listitem')).toHaveCount(1)
    await capture(page, info, 'S02.png')
  })

  test('S03 workspace, empty project', async ({ page }, info) => {
    await newProject(page)
    await waitCameraStable(page)
    await capture(page, info, 'S03.png')
  })

  /** A fully defined 40 x 20 rectangle, its bottom side selected so the constraint bar shows. */
  async function sketchWithConstraints(page: Page) {
    await newProject(page)
    await drawRectangle(page)
    await toolButton(page, 'Rectangle').click() // back to selection mode
    await clickWorld(page, [20, 0, 0])
    await expect(page.getByRole('toolbar', { name: 'Constraints', exact: true })).toBeVisible()
    await expect(page.getByRole('status').filter({ hasText: 'Fully defined' })).toBeVisible()
    await page.mouse.move(2, 2) // out of the way of tooltips
    await waitCameraStable(page)
  }

  test('S04 sketching with constraints', async ({ page }, info) => {
    await sketchWithConstraints(page)
    await capture(page, info, 'S04.png')
  })

  test('S04-390 sketching with constraints on a phone @mobile', async ({ page }, info) => {
    await sketchWithConstraints(page)
    await capture(page, info, 'S04-390.png')
  })

  test('S05 Extrude card open', async ({ page }, info) => {
    await newProject(page)
    await drawRectangle(page)
    await page.getByRole('button', { name: 'Finish sketch' }).click()
    await toolButton(page, 'Extrude').click()
    await expect(extrudeCard(page)).toBeVisible()
    await expect(extrudeCard(page).getByRole('button', { name: 'Apply' })).toBeEnabled()
    await waitCameraStable(page)
    await capture(page, info, 'S05.png')
  })

  test('S11 Export dialog', async ({ page }, info) => {
    await newProject(page)
    await buildBox(page)
    await page.getByRole('button', { name: 'Export', exact: true }).click()
    await expect(page.getByRole('dialog', { name: 'Export' })).toBeVisible()
    await capture(page, info, 'S11.png')
  })

  test('S02-390 dashboard on a phone @mobile', async ({ page }, info) => {
    await page.goto('/')
    await expect(page.getByRole('main').getByRole('listitem')).toHaveCount(1)
    await capture(page, info, 'S02-390.png')
  })

  test('S03-390 workspace on a phone @mobile', async ({ page }, info) => {
    await newProject(page)
    await waitCameraStable(page)
    await capture(page, info, 'S03-390.png')
  })
})

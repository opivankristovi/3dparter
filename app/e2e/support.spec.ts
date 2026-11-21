import { axeFor } from './helpers'
import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'

async function expectNoBlockingViolations(page: Page) {
  const results = await axeFor(page).analyze()
  const blocking = results.violations.filter((v) => ['moderate', 'serious', 'critical'].includes(v.impact ?? ''))
  expect(blocking.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([])
}

/** A synthetic error event: it reaches window listeners but is not a real page error, so the console guard stays quiet. */
async function raise(page: Page, message: string) {
  await page.evaluate((m) => {
    window.dispatchEvent(new ErrorEvent('error', { message: m, error: new Error(m) }))
  }, message)
}

test.describe('privacy and support pages', () => {
  test('privacy page renders and is axe clean', async ({ page }) => {
    await page.goto('/#/privacy')
    await expect(page.getByRole('heading', { level: 1, name: 'Privacy policy' })).toBeVisible()
    await expect(page.getByText('Effective 2026-11-21')).toBeVisible()
    for (const name of ['What is stored, and where', 'The error log', 'How to delete everything']) {
      await expect(page.getByRole('heading', { level: 2, name })).toBeVisible()
    }
    await expectNoBlockingViolations(page)
  })

  test('terms page renders and is axe clean; linked from the privacy page', async ({ page }) => {
    await page.goto('/#/terms')
    await expect(page.getByRole('heading', { level: 1, name: 'Terms of use' })).toBeVisible()
    await expect(page.getByText('Draft for the beta. These terms will be reviewed before the beta ends.')).toBeVisible()
    await expect(page.getByText('Effective 2026-11-21')).toBeVisible()
    for (const name of ['Free to use, as is', 'Your data stays on your device', 'Acceptable use']) {
      await expect(page.getByRole('heading', { level: 2, name })).toBeVisible()
    }
    await expectNoBlockingViolations(page)

    await page.goto('/#/privacy')
    await expect(page.getByRole('heading', { level: 2, name: 'Hosting' })).toBeVisible()
    await page.getByRole('main').getByRole('link', { name: 'terms of use' }).click()
    await expect(page).toHaveURL(/#\/terms$/)
  })

  test('support page renders and is axe clean; landing footer links to both', async ({ page }) => {
    await page.goto('/#/support')
    await expect(page.getByRole('heading', { level: 1, name: 'Support' })).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: 'What to include' })).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: 'Known limits' })).toBeVisible()
    await expectNoBlockingViolations(page)

    await page.goto('/#/welcome')
    await page.getByRole('contentinfo').getByRole('link', { name: 'Privacy' }).click()
    await expect(page).toHaveURL(/#\/privacy$/)
    await page.getByRole('contentinfo').getByRole('link', { name: 'Terms' }).click()
    await expect(page).toHaveURL(/#\/terms$/)
    await page.goto('/#/welcome')
    await page.getByRole('contentinfo').getByRole('link', { name: 'Support' }).click()
    await expect(page).toHaveURL(/#\/support$/)
  })
})

test.describe('report a problem', () => {
  test('logged error shows in the report; copy works; GitHub button is off without a support URL', async ({ page, context, browserName }) => {
    // Only Chromium has clipboard permission names in Playwright; elsewhere the copy is checked through the app's own confirmation.
    if (browserName === 'chromium') await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.goto('/#/support')
    await expect(page.getByRole('heading', { level: 1, name: 'Support' })).toBeVisible()
    await raise(page, 'Synthetic failure for the support test')

    await page.getByRole('main').getByRole('button', { name: 'Report a problem' }).click()
    const dialog = page.getByRole('dialog', { name: 'Report a problem' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('region', { name: 'This is what the report contains' })).toContainText('Synthetic failure for the support test')
    await dialog.getByRole('textbox', { name: 'What happened?' }).fill('It broke while I was drawing')

    const github = dialog.getByRole('button', { name: 'Open a GitHub issue' })
    await expect(github).toBeDisabled()
    await expect(dialog.getByText('The support link is not set up yet')).toBeVisible()

    await dialog.getByRole('button', { name: 'Copy report' }).click()
    if (browserName !== 'chromium') {
      await expect(page.getByText('Report copied')).toBeVisible()
    } else {
      const copied = await page.evaluate(() => navigator.clipboard.readText())
      expect(copied).toContain('Synthetic failure for the support test')
      expect(copied).toContain('It broke while I was drawing')
      expect(copied).toContain('3DParter')
    }

    await expectNoBlockingViolations(page)

    await dialog.getByRole('button', { name: 'Clear log' }).click()
    await expect(dialog.getByText('No errors logged.')).toBeVisible()
  })

  test('reachable from Settings on the project list', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Settings' }).click()
    await page.getByRole('dialog', { name: 'Settings' }).getByRole('button', { name: 'Report a problem' }).click()
    await expect(page.getByRole('dialog', { name: 'Report a problem' })).toBeVisible()
  })
})

test.describe('delete all local data', () => {
  test('removes projects after confirming, and cancel keeps them', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'New project' }).first().click()
    await expect(page).toHaveURL(/#\/p\//)
    await page.getByRole('button', { name: 'Back to projects' }).click()
    const cards = page.getByRole('main').getByRole('listitem')
    await expect(cards).toHaveCount(2)

    await page.getByRole('button', { name: 'Settings' }).click()
    await page.getByRole('dialog', { name: 'Settings' }).getByRole('button', { name: 'Delete all local data' }).click()
    const confirm = page.getByRole('dialog', { name: 'Delete all local data?' })
    await confirm.getByRole('button', { name: 'Cancel' }).click()
    await page.keyboard.press('Escape')
    await expect(cards).toHaveCount(2)

    await page.getByRole('button', { name: 'Settings' }).click()
    await page.getByRole('dialog', { name: 'Settings' }).getByRole('button', { name: 'Delete all local data' }).click()
    await page.getByRole('dialog', { name: 'Delete all local data?' }).getByRole('button', { name: 'Delete everything' }).click()

    // The app reloads as a first run: only the sample project is back.
    await expect(cards).toHaveCount(1)
    await expect(page.getByRole('main').getByText('Untitled')).toHaveCount(0)
    const stored = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.includes('errorlog')))
    expect(stored).toEqual([])
  })
})

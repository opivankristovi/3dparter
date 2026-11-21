import AxeBuilder from '@axe-core/playwright'
import { readFileSync } from 'node:fs'
import { expect, test } from './fixtures'

// Names of the original product (replica/brand.json "avoid"). They must never appear on the page.
const AVOID: string[] = JSON.parse(readFileSync(new URL('../../replica/brand.json', import.meta.url), 'utf8')).avoid

test.describe('landing page', () => {
  test('renders with one primary button and no original name', async ({ page }) => {
    await page.goto('/#/welcome')
    await expect(page.getByRole('heading', { level: 1 })).toContainText('3D CAD')
    await expect(page.getByRole('img', { name: /3DParter workspace/ })).toBeVisible()
    await expect(page.locator('main a.bg-accent')).toHaveCount(1)
    await expect(page.getByRole('link', { name: 'Start a project' })).toBeVisible()
    for (const id of ['hero', 'problem', 'how', 'features', 'pricing', 'faq', 'cta']) {
      await expect(page.locator(`#${id}-title`)).toBeVisible()
    }
    const text = (await page.locator('body').innerText()).toLowerCase()
    const html = (await page.content()).toLowerCase()
    for (const name of AVOID) {
      expect(text, `visible text contains ${name}`).not.toContain(name.toLowerCase())
      expect(html, `markup contains ${name}`).not.toContain(name.toLowerCase())
    }
  })

  test('primary button opens the project list; Tab reaches it', async ({ page, browserName }) => {
    await page.goto('/#/welcome')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    // Safari (WebKit) does not Tab to links unless the user turns that on (Option+Tab otherwise), so the first Tab stop is not a link there.
    if (browserName !== 'webkit') {
      await page.keyboard.press('Tab')
      await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused()
    }
    await page.getByRole('link', { name: 'Start a project' }).focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('button', { name: 'New project' }).first()).toBeVisible()
  })

  test('axe: no moderate, serious or critical violations', async ({ page }) => {
    await page.goto('/#/welcome')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    const results = await new AxeBuilder({ page }).analyze()
    const blocking = results.violations.filter((v) => ['moderate', 'serious', 'critical'].includes(v.impact ?? ''))
    expect(blocking.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([])
  })

  test('@mobile no horizontal scroll at 390', async ({ page }) => {
    await page.goto('/#/welcome')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    const { scrollW, clientW } = await page.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
    }))
    expect(clientW).toBe(390)
    expect(scrollW).toBeLessThanOrEqual(clientW)
  })
})

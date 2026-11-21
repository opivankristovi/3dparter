import type { Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { expect, test } from './fixtures'
import { waitReady, axeFor } from './helpers'

const SEED = 'Sample: mounting plate'
const cards = (page: Page) => page.getByRole('main').getByRole('listitem')
const cardMenu = (page: Page, name: string) => page.getByRole('button', { name: `More actions for ${name}` })
const showTab = (page: Page, name: RegExp | string) => page.getByRole('radiogroup', { name: 'Show' }).getByRole('radio', { name })

/** New project from the dashboard, then back. Returns with the dashboard showing. */
async function createAndLeave(page: Page) {
  await page.getByRole('button', { name: 'New project' }).first().click()
  await expect(page).toHaveURL(/#\/p\//)
  await page.getByRole('button', { name: 'Back to projects' }).click()
  await expect(page).toHaveURL(/#\/$/)
}

async function deleteViaMenu(page: Page, name: string) {
  await cardMenu(page, name).click()
  await page.getByRole('menuitem', { name: 'Delete' }).click()
}

test.describe('F11 manage projects', () => {
  test('F11-H1 create, rename, search, sort', async ({ page }) => {
    await page.goto('/')
    await expect(cards(page)).toHaveCount(1)
    await expect(page.getByRole('main').getByRole('link', { name: new RegExp(`^${SEED}, `) })).toBeVisible()

    await createAndLeave(page)
    await expect(cards(page)).toHaveCount(2)

    // Rename through the card menu.
    await cardMenu(page, 'Untitled').click()
    await page.getByRole('menuitem', { name: 'Rename' }).click()
    const input = page.getByRole('textbox', { name: 'Project name' })
    await input.fill('Zeta bracket')
    await input.press('Enter')
    await expect(page.getByRole('main').getByText('Zeta bracket', { exact: true })).toBeVisible()
    await expect(page.getByRole('main').getByText('Untitled', { exact: true })).toHaveCount(0)

    // Search filters.
    await page.getByRole('searchbox', { name: 'Search projects' }).fill('zeta')
    await expect(cards(page)).toHaveCount(1)
    await expect(cards(page).first()).toContainText('Zeta bracket')
    await page.getByRole('searchbox', { name: 'Search projects' }).fill('')
    await expect(cards(page)).toHaveCount(2)

    // Last edited: the renamed project is newest. By name: "Sample" before "Zeta".
    await expect(cards(page).first()).toContainText('Zeta bracket')
    await page.getByRole('combobox', { name: 'Sort by' }).click()
    await page.getByRole('option', { name: 'Name' }).click()
    await expect(cards(page).first()).toContainText(SEED)
    await expect(cards(page).last()).toContainText('Zeta bracket')
  })

  test('F11-H2 delete and undo from the toast', async ({ page }) => {
    await page.goto('/')
    await deleteViaMenu(page, SEED)
    await expect(page.getByText(`Moved '${SEED}' to Trash`, { exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'No projects yet' })).toBeVisible()
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect(page.getByRole('main').getByRole('link', { name: new RegExp(`^${SEED}, `) })).toBeVisible()
    await expect(cards(page)).toHaveCount(1)
  })

  test('F11-H3 trash: restore and delete forever', async ({ page }) => {
    await page.goto('/')
    await createAndLeave(page)
    await expect(cards(page)).toHaveCount(2)

    // Delete the seed, restore it from Trash, open it.
    await deleteViaMenu(page, SEED)
    await expect(cards(page)).toHaveCount(1)
    await showTab(page, /^Trash/).click()
    await expect(page.getByRole('heading', { name: 'Trash', level: 1 })).toBeVisible()
    await expect(cards(page)).toHaveCount(1)
    await page.getByRole('button', { name: 'Restore' }).click()
    await expect(page.getByRole('heading', { name: 'Trash is empty' })).toBeVisible()
    await showTab(page, 'Projects').click()
    await expect(cards(page)).toHaveCount(2)
    await page.getByRole('main').getByRole('link', { name: new RegExp(`^${SEED}, `) }).click()
    await expect(page).toHaveURL(/#\/p\//)
    await waitReady(page)
    await expect(page.getByRole('button', { name: SEED, exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Back to projects' }).click()

    // Delete Untitled forever.
    await deleteViaMenu(page, 'Untitled')
    await showTab(page, /^Trash/).click()
    await expect(cards(page)).toHaveCount(1)
    await page.getByRole('button', { name: 'Delete forever' }).click()
    const dialog = page.getByRole('dialog', { name: 'Delete forever?' })
    await expect(dialog).toContainText("can't be undone")
    await dialog.getByRole('button', { name: 'Delete forever' }).click()
    await expect(page.getByRole('heading', { name: 'Trash is empty' })).toBeVisible()
    await showTab(page, 'Projects').click()
    await expect(cards(page)).toHaveCount(1)
    await expect(page.getByRole('main').getByText('Untitled', { exact: true })).toHaveCount(0)
  })

  test('F11-E1 empty dashboard', async ({ page }) => {
    await page.goto('/')
    await deleteViaMenu(page, SEED)
    await showTab(page, /^Trash/).click()
    await page.getByRole('button', { name: 'Delete forever' }).click()
    await page.getByRole('dialog', { name: 'Delete forever?' }).getByRole('button', { name: 'Delete forever' }).click()
    await expect(page.getByRole('heading', { name: 'Trash is empty' })).toBeVisible()
    await showTab(page, 'Projects').click()
    await expect(page.getByRole('heading', { name: 'No projects yet' })).toBeVisible()
    await page.reload()
    // The seed does not come back after a reload.
    await expect(page.getByRole('heading', { name: 'No projects yet' })).toBeVisible()
    const empty = page.getByRole('main').getByRole('button', { name: 'New project' })
    await expect(empty).toHaveCount(2) // header action and the empty-state action
    await empty.last().click()
    await expect(page).toHaveURL(/#\/p\//)
  })

  test('F11-E2 search with no results', async ({ page }) => {
    await page.goto('/')
    await expect(cards(page)).toHaveCount(1)
    await page.getByRole('searchbox', { name: 'Search projects' }).fill('zzzz')
    await expect(page.getByRole('heading', { name: "No matches for 'zzzz'" })).toBeVisible()
    await expect(cards(page)).toHaveCount(0)
  })

  test('F11-N1 open a trashed project by URL', async ({ page }) => {
    await page.goto('/')
    const href = await page.getByRole('main').getByRole('link', { name: new RegExp(`^${SEED}, `) }).getAttribute('href')
    expect(href).toMatch(/^#\/p\/.+/)
    await deleteViaMenu(page, SEED)
    await expect(cards(page)).toHaveCount(0)
    await page.goto('/' + href)
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Project not found' })).toBeVisible()
    await page.getByRole('link', { name: 'Go to projects' }).click()
    await expect(page).toHaveURL(/#\/$/)
    await expect(page.getByRole('heading', { name: 'Projects', level: 1 })).toBeVisible()
  })

  test('F11-N2 unknown id and unknown route', async ({ page }) => {
    await page.goto('/#/p/nope')
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Project not found' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Go to projects' })).toBeVisible()

    await page.goto('/#/nope')
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Go to projects' })).toBeVisible()
  })

  test('X-5 rebrand check: 3DParter title, favicon, legacy .3dshaper.json import, and dark-theme axe', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveTitle('3DParter')
    await expect(page.getByRole('link', { name: '3DParter', exact: true })).toBeVisible()

    // Favicon is the Deep Teal 3DParter vector mark (not the default icon).
    const fav = await page.request.get('/favicon.svg')
    expect(fav.status()).toBe(200)
    expect(await fav.text()).toContain('#0b6e69')

    // Export project as .3dparter.json, then verify legacy .3dshaper.json import compatibility.
    await cardMenu(page, SEED).click()
    const [dl] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('menuitem', { name: 'Export project' }).click(),
    ])
    expect(dl.suggestedFilename()).toMatch(/\.3dparter\.json$/)
    const exported = JSON.parse(readFileSync((await dl.path())!, 'utf8'))
    exported.name = 'Legacy Archive'
    await page.getByLabel('Import project file').setInputFiles({
      name: 'legacy.3dshaper.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(exported)),
    })
    await expect(page.getByRole('main').getByRole('link', { name: /^Legacy Archive, / })).toBeVisible()

    // Dark-theme Deep Teal palette (#2dd4bf / #071f1e) passes axe with zero moderate+ violations.
    await page.getByRole('button', { name: 'Theme' }).click()
    await page.getByRole('menuitemcheckbox', { name: 'Dark' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    const results = await axeFor(page).analyze()
    const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical' || v.impact === 'moderate')
    expect(blocking.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([])
  })
})

test.describe('rename migration', () => {
  test('X-6 projects saved under the old 3dshaper database show up after the rename', async ({ page }) => {
    // Seed the old database from a blank page on the app's origin, so the app has not touched IndexedDB yet.
    await page.route('**/__blank', (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>blank</title>' }))
    await page.goto('/__blank')
    await page.evaluate(
      () =>
        new Promise<void>((resolve, reject) => {
          const req = indexedDB.open('3dshaper', 10)
          req.onerror = () => reject(req.error)
          req.onupgradeneeded = () => {
            const d = req.result
            d.createObjectStore('settings', { keyPath: 'id' })
            d.createObjectStore('folders', { keyPath: 'id' })
            const p = d.createObjectStore('projects', { keyPath: 'id' })
            p.createIndex('name', 'name')
            d.createObjectStore('projectVersions', { keyPath: 'id' })
            d.createObjectStore('assets', { keyPath: 'id' })
          }
          req.onsuccess = () => {
            const d = req.result
            const tx = d.transaction(['settings', 'projects'], 'readwrite')
            tx.objectStore('settings').put({ id: 'app', theme: 'system', units: 'mm', precision: 2, gridSnap: true, seeded: true })
            for (const [id, name] of [['legacy-1', 'Legacy bracket'], ['legacy-2', 'Legacy gear']]) {
              tx.objectStore('projects').put({
                id, name, folderId: null, units: 'mm', revision: 1, thumbnail: null, createdAt: 1, updatedAt: 2, deletedAt: null,
                document: { schemaVersion: 1, units: 'mm', variables: [], features: [], rollbackIndex: null, bodies: {}, itemFolders: [] },
              })
            }
            tx.oncomplete = () => {
              d.close()
              resolve()
            }
            tx.onerror = () => reject(tx.error)
          }
        }),
    )
    await page.goto('/')
    await expect(cards(page)).toHaveCount(2)
    await expect(page.getByRole('main').getByText('Legacy bracket', { exact: true })).toBeVisible()
    await expect(page.getByRole('main').getByText('Legacy gear', { exact: true })).toBeVisible()
  })
})

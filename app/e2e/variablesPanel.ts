// Shared by the variables specs: the "is the panel mounted" switch, and helpers that drive variables.
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

/**
 * The Variables panel (src/screens/workspace/VariablesPanel.tsx) is built as a self-contained component.
 * Until it is mounted as the content of the sidebar's Variables tab, the tests that drive it are fixme.
 * Set this to true once it is mounted.
 */
export const PANEL_MOUNTED = true

export interface CommandResult {
  ok: boolean
  message?: string
  uses?: { label: string }[]
}

/** Runs one of the variable commands (addVariable, setVariableExpression, renameVariable, deleteVariable) in the page. */
export async function variableCommand(page: Page, name: string, ...args: string[]): Promise<CommandResult> {
  return page.evaluate(
    async ([fn, rest]) => {
      const url = '/src/doc/variableCommands.ts'
      const m = await import(/* @vite-ignore */ url)
      return m[fn as string](...(rest as string[]))
    },
    [name, args] as [string, string[]],
  )
}

export const variablesOf = (page: Page) =>
  page.evaluate(() => window.__3dparter!.store.getState().doc.variables.map((v) => ({ id: v.id, name: v.name, expression: v.expression })))

/** Opens the sidebar's Variables tab (on a phone, the panel first) and returns the panel. */
export async function openVariables(page: Page): Promise<Locator> {
  const tab = page.getByRole('tab', { name: 'Variables' })
  if (!(await tab.isVisible())) {
    const toggle = page.getByRole('button', { name: 'Show panel' })
    if (await toggle.isVisible()) await toggle.click()
    else {
      // A phone keeps the toggle in the More menu.
      await page.getByRole('button', { name: 'More' }).click()
      await page.getByRole('menuitem', { name: 'Show panel' }).click()
    }
  }
  await tab.click()
  const panel = page.getByRole('tabpanel', { name: 'Variables' })
  await expect(panel).toBeVisible()
  return panel
}

export const variableRow = (panel: Locator, name: string) => panel.getByRole('group', { name: `Variable ${name}`, exact: true })

/** "Add variable", then name and expression typed into the new row. Returns the row. */
export async function addVariableInPanel(page: Page, panel: Locator, name: string, expression: string): Promise<Locator> {
  const before = (await variablesOf(page)).length
  await panel.getByRole('button', { name: 'Add variable' }).first().click()
  await expect.poll(async () => (await variablesOf(page)).length).toBe(before + 1)
  const created = (await variablesOf(page)).at(-1)!
  const nameField = panel.locator(`[data-variable-id="${created.id}"] [data-field="name"]`)
  await expect(nameField).toBeFocused()
  await page.keyboard.type(name)
  await page.keyboard.press('Enter')
  const row = variableRow(panel, name)
  await expect(row).toBeVisible()
  const expr = row.getByLabel('Expression')
  await expr.fill(expression)
  await expr.press('Enter')
  await expect.poll(async () => (await variablesOf(page)).find((v) => v.name === name)?.expression).toBe(expression)
  return row
}

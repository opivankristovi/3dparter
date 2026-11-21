import { readFileSync } from 'node:fs'
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import type { ExtrudeFeature, ProjectDocument, SketchFeature } from '../src/doc/types'
import '../src/testing/hook'
import { parseBinaryStl } from './stl'
import type { StlInfo } from './stl'

type World = [number, number, number]

export const doc = (page: Page): Promise<ProjectDocument> => page.evaluate(() => window.__3dshaper!.store.getState().doc)
export const sketches = (d: ProjectDocument) => d.features.filter((f): f is SketchFeature => f.type === 'sketch')
export const extrudes = (d: ProjectDocument) => d.features.filter((f): f is ExtrudeFeature => f.type === 'extrude')

/** Waits until the geometry engine has loaded in the open workspace. */
export async function waitReady(page: Page) {
  await page.waitForFunction(() => window.__3dshaper?.kernelReady() === true, undefined, { timeout: 50_000 })
}

/** Dashboard -> New project -> empty workspace with the engine ready. */
export async function newProject(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'New project' }).first().click()
  await expect(page).toHaveURL(/#\/p\//)
  await waitReady(page)
}

/** Waits for the camera fly-to animation to end (the projected positions stop changing). */
export async function waitCameraStable(page: Page) {
  await page.evaluate(() => {
    delete (window as unknown as { __camLast?: string }).__camLast
  })
  await page.waitForFunction(
    () => {
      const h = window.__3dshaper
      if (!h) return false
      const r = (p: [number, number]) => [Math.round(p[0] * 10), Math.round(p[1] * 10)]
      const key = JSON.stringify([r(h.toClient([0, 0, 0])), r(h.toClient([40, 40, 0])), r(h.toClient([0, 0, 40]))])
      const w = window as unknown as { __camLast?: string }
      const same = w.__camLast === key
      w.__camLast = key
      return same
    },
    undefined,
    { polling: 120, timeout: 15_000 },
  )
}

export async function clientOf(page: Page, world: World): Promise<[number, number]> {
  return page.evaluate((w) => window.__3dshaper!.toClient(w), world)
}

export async function clickWorld(page: Page, world: World) {
  const [x, y] = await clientOf(page, world)
  await page.mouse.click(x, y)
}

export const toolButton = (page: Page, name: string) =>
  page.getByRole('toolbar', { name: 'Tools' }).getByRole('button', { name, exact: true })

/** With a sketch tool active: click the Top plane, wait for the sketch to open and the camera to settle. */
export async function pickTopPlane(page: Page) {
  // The other two origin planes can sit in front of the Top plane along the view ray, so ask the engine
  // which candidate point really picks the Top plane (XY) before clicking it.
  const target = await page.evaluate(() => {
    const h = window.__3dshaper!
    const candidates: [number, number, number][] = [
      [20, 20, 0],
      [30, 30, 0],
      [30, -30, 0],
      [-30, 30, 0],
      [-30, -30, 0],
      [35, 5, 0],
      [5, 35, 0],
      [-35, -5, 0],
      [-5, -35, 0],
    ]
    return candidates.find((c) => {
      const [x, y] = h.toClient(c)
      if (document.elementFromPoint(x, y) !== h.engine.canvas) return false // off screen or under a panel
      const ref = h.engine.pickAt(x, y)
      return ref?.kind === 'originPlane' && ref.name === 'XY'
    })
  })
  expect(target, 'a point where the Top plane is pickable').toBeTruthy()
  await clickWorld(page, target!)
  await expect.poll(async () => sketches(await doc(page)).length).toBe(1)
  await waitCameraStable(page)
}

/** Rectangle tool -> Top plane -> corner at the origin -> typed size. Leaves the sketch open. */
export async function drawRectangle(page: Page, w = '40', h = '20') {
  await toolButton(page, 'Rectangle').click()
  await pickTopPlane(page)
  await clickWorld(page, [0, 0, 0])
  await expect(page.getByRole('group', { name: 'Shape size' })).toBeVisible()
  await page.keyboard.type(w)
  await page.keyboard.press('Tab')
  await page.keyboard.type(h)
  await page.keyboard.press('Enter')
  await expect.poll(async () => sketches(await doc(page)).reduce((n, s) => n + s.sketch.entities.length, 0)).toBe(4)
}

export const extrudeCard = (page: Page) => page.getByRole('dialog', { name: 'Extrude', exact: true })

export async function bodyMeshes(page: Page): Promise<number> {
  return page.evaluate(() => (window.__3dshaper!.engine as unknown as { bodies: Map<string, unknown> }).bodies.size)
}

/** Finish sketch -> Extrude -> Apply. Leaves one solid. */
export async function finishAndExtrude(page: Page) {
  await page.getByRole('button', { name: 'Finish sketch' }).click()
  await toolButton(page, 'Extrude').click()
  const card = extrudeCard(page)
  await expect(card).toBeVisible()
  await card.getByRole('button', { name: 'Apply' }).click()
  await expect(card).toBeHidden()
  await expect.poll(async () => extrudes(await doc(page)).length).toBe(1)
  await expect.poll(() => bodyMeshes(page)).toBe(1)
}

/** The first part: 40 x 20 rectangle extruded 10. */
export async function buildBox(page: Page) {
  await drawRectangle(page)
  await finishAndExtrude(page)
}

/** Lets a regenerate that follows an edit start and finish. */
export async function settle(page: Page) {
  await page.waitForTimeout(250)
  await expect(page.getByRole('banner')).not.toHaveAttribute('aria-busy', 'true')
}

/** Export dialog -> Export; returns the downloaded file. */
export async function exportStl(page: Page): Promise<{ info: StlInfo; filename: string; buffer: Buffer }> {
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Export' })
  await expect(dialog).toBeVisible()
  const [dl] = await Promise.all([
    page.waitForEvent('download'),
    dialog.getByRole('button', { name: 'Export', exact: true }).click(),
  ])
  const path = await dl.path()
  const buffer = readFileSync(path)
  return { info: parseBinaryStl(buffer), filename: dl.suggestedFilename(), buffer }
}

export interface SavedProject {
  id: string
  name: string
  deletedAt: number | null
  document: ProjectDocument
}

/** What is really in IndexedDB (not what is on screen). */
export async function savedProjects(page: Page): Promise<SavedProject[]> {
  return page.evaluate(
    () =>
      new Promise<SavedProject[]>((resolve, reject) => {
        const open = indexedDB.open('3dshaper')
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const db = open.result
          const req = db.transaction('projects').objectStore('projects').getAll()
          req.onerror = () => reject(req.error)
          req.onsuccess = () => {
            db.close()
            resolve(req.result.map((r: SavedProject) => ({ id: r.id, name: r.name, deletedAt: r.deletedAt, document: r.document })))
          }
        }
      }),
  )
}

export const projectId = (page: Page): Promise<string | null> => page.evaluate(() => window.__3dshaper!.store.getState().projectId)

export function near(actual: number, expected: number, tol = 0.01) {
  expect(Math.abs(actual - expected), `${actual} should be within ${tol} of ${expected}`).toBeLessThanOrEqual(tol)
}

export async function hasHorizontalScroll(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
}

export async function isEllipsized(loc: Locator): Promise<boolean> {
  return loc.evaluate((el) => getComputedStyle(el).textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth)
}

// ---- M2 edge-case helpers -----------------------------------------------------------------------------------

export const historyItem = (page: Page, name: string) =>
  page.getByRole('tree', { name: 'History' }).getByRole('treeitem', { name: new RegExp(name) })

/** Picks the Top (XY) origin plane when the document may already contain sketches. */
export async function pickTopPlaneAgain(page: Page) {
  const before = sketches(await doc(page)).length
  let target: World | undefined
  await expect
    .poll(async () => {
      target = await page.evaluate(() => {
        const h = window.__3dshaper!
        const candidates: [number, number, number][] = [
          [10, -10, 0], [5, -15, 0], [15, -15, 0], [10, -20, 0], [-10, -10, 0], [-15, -5, 0], [20, -15, 0],
          [30, -30, 0], [-30, 30, 0], [-30, -30, 0], [35, -35, 0], [-35, -5, 0], [-5, -35, 0], [20, 20, 0], [30, 30, 0],
        ]
        return candidates.find((c) => {
          const [x, y] = h.toClient(c)
          if (document.elementFromPoint(x, y) !== h.engine.canvas) return false
          const ref = h.engine.pickAt(x, y)
          return ref?.kind === 'originPlane' && ref.name === 'XY'
        })
      })
      return Boolean(target)
    })
    .toBe(true)
  await clickWorld(page, target!)
  await expect.poll(async () => sketches(await doc(page)).length).toBe(before + 1)
  await waitCameraStable(page)
}

/** Clicks a screen point near `world` where `engine.pickAt` returns the wanted kind (edge, face, body or vertex). */
export async function clickPickableNear(page: Page, world: World, kind: 'edge' | 'face' | 'body' | 'vertex') {
  let pt: [number, number] | null = null
  await expect
    .poll(async () => {
      pt = await page.evaluate(
        ({ w, want }) => {
          const h = window.__3dshaper!
          const [cx, cy] = h.toClient(w)
          const offsets: [number, number][] = [[0, 0]]
          for (let r = 1; r <= 4; r++) offsets.push([0, r], [0, -r], [r, 0], [-r, 0])
          for (const [dx, dy] of offsets) {
            const x = cx + dx
            const y = cy + dy
            if (document.elementFromPoint(x, y) !== h.engine.canvas) continue
            const r = h.engine.pickAt(x, y)
            if (r?.kind === want) return [x, y] as [number, number]
          }
          return null
        },
        { w: world, want: kind },
      )
      return Boolean(pt)
    })
    .toBe(true)
  await page.mouse.click(pt![0], pt![1])
}

/** Draws a closed rectangle (corner at `at`, size w x h) on a fresh Top-plane sketch and finishes it. */
export async function addRectangleSketch(page: Page, at: World, w: string, h: string) {
  await toolButton(page, 'Rectangle').click()
  await pickTopPlaneAgain(page)
  await clickWorld(page, at)
  await expect(page.getByRole('group', { name: 'Shape size' })).toBeVisible()
  await page.keyboard.type(w)
  await page.keyboard.press('Tab')
  await page.keyboard.type(h)
  await page.keyboard.press('Enter')
  await page.getByRole('button', { name: 'Finish sketch' }).click()
}

/** Finish-sketch is already done: Extrude -> Apply (new body). */
export async function applyExtrude(page: Page) {
  await toolButton(page, 'Extrude').click()
  await expect(extrudeCard(page)).toBeVisible()
  await extrudeCard(page).getByRole('button', { name: 'Apply' }).click()
  await expect(extrudeCard(page)).toBeHidden()
}

/** Edge-blend tool on `tool` (Fillet or Chamfer): pick the edges near the given world points, type the value, Apply. */
export async function blendEdges(page: Page, tool: 'Fillet' | 'Chamfer', edges: World[], value: string) {
  await toolButton(page, tool).click()
  const card = page.getByRole('dialog', { name: tool, exact: true })
  await expect(card).toBeVisible()
  for (const e of edges) await clickPickableNear(page, e, 'edge')
  const field = card.getByLabel(tool === 'Fillet' ? 'Radius' : 'Distance')
  await field.fill(value)
  await field.blur()
  await settle(page)
  await card.getByRole('button', { name: 'Apply' }).click()
  await expect(card).toBeHidden()
  await settle(page)
}

export interface BodyStat {
  id: string
  volume: number
  min: [number, number, number]
  max: [number, number, number]
}

/** Volume and bounding box of every rendered solid, from the meshes the viewport holds. */
export async function bodyStats(page: Page): Promise<BodyStat[]> {
  return page.evaluate(() => {
    const bodies = (window.__3dshaper!.engine as unknown as { bodies: Map<string, { id: string; data: { positions: Float32Array; indices: Uint32Array } }> }).bodies
    return [...bodies.values()].map((b) => {
      const p = b.data.positions
      const ix = b.data.indices
      const min: [number, number, number] = [Infinity, Infinity, Infinity]
      const max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
      for (let i = 0; i < p.length; i += 3) {
        for (let k = 0; k < 3; k++) {
          min[k] = Math.min(min[k], p[i + k])
          max[k] = Math.max(max[k], p[i + k])
        }
      }
      let vol = 0
      for (let t = 0; t < ix.length; t += 3) {
        const a = ix[t] * 3
        const b2 = ix[t + 1] * 3
        const c = ix[t + 2] * 3
        vol +=
          (p[a] * (p[b2 + 1] * p[c + 2] - p[b2 + 2] * p[c + 1]) -
            p[a + 1] * (p[b2] * p[c + 2] - p[b2 + 2] * p[c]) +
            p[a + 2] * (p[b2] * p[c + 1] - p[b2 + 1] * p[c])) /
          6
      }
      return { id: b.id, volume: vol, min, max }
    })
  })
}

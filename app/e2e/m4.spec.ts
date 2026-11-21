// M4 features: Measure tool (S09 / F09), STEP & 3MF export with selection (S11 / F10),
// box select, 3D vertex picking, selection filters, orientation cube 90-deg roll arrows, and display precision (S12).
import { readFileSync } from 'node:fs'
import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import {
  addRectangleSketch,
  applyExtrude,
  bodyMeshes,
  buildBox,
  clickPickableNear,
  clickWorld,
  doc,
  extrudeCard,
  near,
  newProject,
  pickTopPlane,
  settle,
  toolButton,
  waitCameraStable,
  waitReady,
} from './helpers'

async function expectNoA11yViolations(page: Page, name: string) {
  const results = await new AxeBuilder({ page }).exclude('canvas').analyze()
  const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical' || v.impact === 'moderate')
  expect(
    blocking.map((v) => `${v.id} (${v.impact})`),
    `axe violations on ${name}`,
  ).toEqual([])
}

function readZipEntries(buffer: Buffer): Map<string, string> {
  const entries = new Map<string, string>()
  let pos = 0
  while (pos + 30 <= buffer.length && buffer.readUInt32LE(pos) === 0x04034b50) {
    const method = buffer.readUInt16LE(pos + 8)
    const size = buffer.readUInt32LE(pos + 18)
    const nameLen = buffer.readUInt16LE(pos + 26)
    const extraLen = buffer.readUInt16LE(pos + 28)
    const name = buffer.toString('utf8', pos + 30, pos + 30 + nameLen)
    const dataStart = pos + 30 + nameLen + extraLen
    if (method === 0) entries.set(name, buffer.toString('utf8', dataStart, dataStart + size))
    pos = dataStart + size
  }
  return entries
}

function parse3mfTriangles(xml: string): { objects: number; triangles: number; volume: number } {
  const objects = [...xml.matchAll(/<object\b/g)].length
  const vertices: [number, number, number][] = []
  for (const m of xml.matchAll(/<vertex\s+x="([^"]+)"\s+y="([^"]+)"\s+z="([^"]+)"\s*\/>/g)) {
    vertices.push([Number(m[1]), Number(m[2]), Number(m[3])])
  }
  const triangles = [...xml.matchAll(/<triangle\s+v1="(\d+)"\s+v2="(\d+)"\s+v3="(\d+)"\s*\/>/g)]
  // Offset vertex indices per mesh block if multiple objects exist.
  let volume = 0
  for (const objMatch of xml.matchAll(/<mesh>([\s\S]*?)<\/mesh>/g)) {
    const block = objMatch[1]
    const vs: [number, number, number][] = []
    for (const m of block.matchAll(/<vertex\s+x="([^"]+)"\s+y="([^"]+)"\s+z="([^"]+)"\s*\/>/g)) {
      vs.push([Number(m[1]), Number(m[2]), Number(m[3])])
    }
    for (const m of block.matchAll(/<triangle\s+v1="(\d+)"\s+v2="(\d+)"\s+v3="(\d+)"\s*\/>/g)) {
      const a = vs[Number(m[1])]
      const b = vs[Number(m[2])]
      const c = vs[Number(m[3])]
      volume += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6
    }
  }
  return { objects, triangles: triangles.length, volume: Math.abs(volume) }
}

async function downloadExport(
  page: Page,
  format: 'STL' | '3MF' | 'STEP' | 'OBJ' | 'GLB (glTF)',
  solids?: 'Selected' | 'All visible',
): Promise<{ filename: string; buffer: Buffer }> {
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Export' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('combobox', { name: 'Format' }).click()
  await page.getByRole('option', { name: format, exact: true }).click()
  if (solids) {
    await dialog.getByRole('radio', { name: new RegExp(`^${solids}`) }).click()
  }
  const [dl] = await Promise.all([
    page.waitForEvent('download'),
    dialog.getByRole('button', { name: 'Export', exact: true }).click(),
  ])
  await expect(dialog).toBeHidden()
  return { filename: dl.suggestedFilename(), buffer: readFileSync(await dl.path()) }
}

test.describe('M4 Workspace and I/O', () => {
  test('F09-H1 Measure: edge length, two faces distance & angle, solid volume, vertex position, and axe scan', async ({ page }) => {
    await newProject(page)
    await buildBox(page)
    await settle(page)
    await waitCameraStable(page)
    await page.keyboard.press('Escape') // clear Body 1 selection so Measure starts empty

    await page.getByRole('button', { name: 'Measure', exact: true }).click()
    const card = page.getByRole('dialog', { name: 'Measure' })
    await expect(card).toBeVisible()
    await expectNoA11yViolations(page, 'Measure card empty')

    // 1. Edge length (40 mm).
    await clickPickableNear(page, [20, 0, 10], 'edge')
    await expect(card.getByText('Length')).toBeVisible()
    await expect(card.getByText('40 mm')).toBeVisible()

    // 2. Second opposite edge (parallel, 20 mm away).
    await clickPickableNear(page, [20, 20, 10], 'edge')
    await expect(card.getByText('Distance')).toBeVisible()
    await expect(card.getByText('20 mm')).toBeVisible()
    await expect(card.getByText('0°')).toBeVisible()
    await expect(card.getByText('Total length')).toBeVisible()
    await expect(card.getByText('80 mm')).toBeVisible()

    // 3. Two perpendicular faces via Face filter.
    await card.getByRole('button', { name: 'Clear' }).click()
    await card.getByRole('radio', { name: 'Face' }).click()
    await clickPickableNear(page, [20, 10, 10], 'face')
    await clickPickableNear(page, [20, 0, 5], 'face')
    await expect(card.getByText('Angle')).toBeVisible()
    await expect(card.getByText('90°')).toBeVisible()
    await expect(card.getByText('0 mm', { exact: true })).toBeVisible()
    await expect(card.getByText('1200 mm²', { exact: true })).toBeVisible()

    // 4. Solid body volume and surface area via Solid filter.
    await card.getByRole('button', { name: 'Clear' }).click()
    await card.getByRole('radio', { name: 'Solid' }).click()
    await clickPickableNear(page, [20, 10, 10], 'body')
    await expect(card.getByText('Volume')).toBeVisible()
    await expect(card.getByText('8000 mm³')).toBeVisible()
    await expect(card.getByText('Surface area')).toBeVisible()
    await expect(card.getByText('2800 mm²')).toBeVisible()

    // 5. 3D vertex point coordinates via Point filter.
    await card.getByRole('button', { name: 'Clear' }).click()
    await card.getByRole('radio', { name: 'Point' }).click()
    await clickPickableNear(page, [40, 20, 10], 'vertex')
    await expect(card.getByText('Position')).toBeVisible()
    await expect(card.getByText('(40, 20, 10) mm')).toBeVisible()
    await expectNoA11yViolations(page, 'Measure card with point readout')

    await card.getByRole('button', { name: 'Close' }).last().click()
    await expect(card).toBeHidden()
  })

  test('F10-H1 Organize and export selection: 3MF (selected vs all) and STEP', async ({ page }) => {
    await newProject(page)
    await buildBox(page) // 40 x 20 x 10 = 8000 mm3
    await settle(page)
    await waitCameraStable(page)

    await addRectangleSketch(page, [-35, 0, 0], '20', '20')
    await applyExtrude(page) // 20 x 20 x 10 = 4000 mm3
    await expect.poll(() => bodyMeshes(page)).toBe(2)
    await settle(page)

    // Clear auto-selection and select only the second solid via the Items panel.
    await page.keyboard.press('Escape')
    await page.getByRole('tab', { name: 'Items' }).click()
    await page.getByRole('tree', { name: 'Solids' }).getByRole('treeitem', { name: 'Body 2' }).click()
    await expect.poll(async () => page.evaluate(() => window.__3dshaper!.store.getState().selection.length)).toBe(1)

    // Export 3MF defaults to Selected (1) = 4000 mm3.
    const one3mf = await downloadExport(page, '3MF')
    expect(one3mf.filename).toMatch(/\.3mf$/)
    const entries1 = readZipEntries(one3mf.buffer)
    expect([...entries1.keys()].sort()).toEqual(['3D/3dmodel.model', '[Content_Types].xml', '_rels/.rels'])
    const parsed1 = parse3mfTriangles(entries1.get('3D/3dmodel.model')!)
    expect(parsed1.objects).toBe(1)
    expect(parsed1.triangles).toBe(12)
    near(parsed1.volume, 4000, 1)

    // Export 3MF with All visible (2) = 12000 mm3.
    const all3mf = await downloadExport(page, '3MF', 'All visible')
    const parsed2 = parse3mfTriangles(readZipEntries(all3mf.buffer).get('3D/3dmodel.model')!)
    expect(parsed2.objects).toBe(2)
    expect(parsed2.triangles).toBe(24)
    near(parsed2.volume, 12000, 1)

    // Export STEP for Selected (1).
    const step = await downloadExport(page, 'STEP', 'Selected')
    expect(step.filename).toMatch(/\.step$/)
    const stepText = step.buffer.toString('utf8')
    expect(stepText).toContain('ISO-10303-21;')
    expect(stepText).toContain('END-ISO-10303-21;')

    // OBJ: text, one object per solid, 12 triangles each, 1-based faces with normals.
    const obj = await downloadExport(page, 'OBJ', 'All visible')
    expect(obj.filename).toMatch(/\.obj$/)
    const objLines = obj.buffer.toString('utf8').split('\n')
    expect(objLines.filter((l) => l.startsWith('o ')).sort()).toEqual(['o Body_1', 'o Body_2'])
    expect(objLines.filter((l) => l.startsWith('f ')).length).toBe(24)
    expect(objLines.filter((l) => l.startsWith('v ')).length).toBe(objLines.filter((l) => l.startsWith('vn ')).length)

    // GLB: binary glTF 2.0 with two meshes, positions in metres.
    const glb = await downloadExport(page, 'GLB (glTF)', 'Selected')
    expect(glb.filename).toMatch(/\.glb$/)
    expect(glb.buffer.toString('ascii', 0, 4)).toBe('glTF')
    expect(glb.buffer.readUInt32LE(4)).toBe(2)
    expect(glb.buffer.readUInt32LE(8)).toBe(glb.buffer.length)
    const jsonLen = glb.buffer.readUInt32LE(12)
    const gltf = JSON.parse(glb.buffer.toString('utf8', 20, 20 + jsonLen))
    expect(gltf.meshes).toHaveLength(1)
    expect(gltf.nodes[0].name).toBe('Body 2')
    const pos = gltf.accessors[gltf.meshes[0].primitives[0].attributes.POSITION]
    expect(pos.max[0] - pos.min[0]).toBeCloseTo(0.02, 4) // the 20 mm box, in metres
  })

  test('M4-H1 Box selection (enclosed vs crossing) and 3D vertex picking', async ({ page }) => {
    await newProject(page)
    await addRectangleSketch(page, [0, 0, 0], '20', '20')
    await applyExtrude(page)
    await settle(page)
    await addRectangleSketch(page, [50, 0, 0], '20', '20')
    await applyExtrude(page)
    await expect.poll(() => bodyMeshes(page)).toBe(2)
    await page.getByRole('button', { name: 'Zoom to fit' }).click()
    await waitCameraStable(page)

    const bounds = await page.evaluate(() => {
      const h = window.__3dshaper!
      const proj = (pts: [number, number, number][]) => {
        const xs = pts.map((p) => h.toClient(p)[0])
        const ys = pts.map((p) => h.toClient(p)[1])
        return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) }
      }
      const b1 = proj([
        [0, 0, 0], [20, 0, 0], [20, 20, 0], [0, 20, 0],
        [0, 0, 10], [20, 0, 10], [20, 20, 10], [0, 20, 10],
      ])
      const b2 = proj([
        [50, 0, 0], [70, 0, 0], [70, 20, 0], [50, 20, 0],
        [50, 0, 10], [70, 0, 10], [70, 20, 10], [50, 20, 10],
      ])
      return { b1, b2 }
    })

    // Left-to-right drag tightly around solid 1: encloses solid 1, excludes solid 2.
    await page.mouse.move(bounds.b1.minX - 8, bounds.b1.minY - 8)
    await page.mouse.down()
    await page.mouse.move(bounds.b1.maxX + 8, bounds.b1.maxY + 8, { steps: 6 })
    await expect(page.locator('[data-box-select="enclosed"]')).toBeVisible()
    await page.mouse.up()
    await expect
      .poll(async () => page.evaluate(() => window.__3dshaper!.store.getState().selection))
      .toEqual([{ kind: 'body', name: (await doc(page)).features.find((f) => f.name === 'Extrude 1')!.id }])

    // Right-to-left crossing drag overlapping just the edge of solid 2 (does NOT enclose solid 2).
    const cx2 = (bounds.b2.minX + bounds.b2.maxX) / 2
    const cy2 = (bounds.b2.minY + bounds.b2.maxY) / 2
    await page.mouse.move(bounds.b2.maxX + 12, cy2 + 8)
    await page.mouse.down()
    await page.mouse.move(cx2, bounds.b2.minY - 4, { steps: 6 })
    await expect(page.locator('[data-box-select="crossing"]')).toBeVisible()
    await page.mouse.up()
    await expect
      .poll(async () => page.evaluate(() => window.__3dshaper!.store.getState().selection))
      .toEqual([{ kind: 'body', name: (await doc(page)).features.find((f) => f.name === 'Extrude 2')!.id }])

    // Default 'face-edge' pick resolves a 3D vertex directly at a corner.
    await clickPickableNear(page, [20, 20, 10], 'vertex')
    await expect
      .poll(async () => page.evaluate(() => window.__3dshaper!.store.getState().selection[0]?.kind))
      .toBe('vertex')
  })

  test('M4-H2 Orientation cube 90-degree roll arrows rotate camera up and Home restores Z-up', async ({ page }) => {
    await newProject(page)
    await buildBox(page)
    await settle(page)
    await waitCameraStable(page)

    await page.getByRole('button', { name: 'View from front' }).click()
    await waitCameraStable(page)

    const up = () => page.evaluate(() => window.__3dshaper!.engine.camera.up.toArray())
    const up0 = await up()
    expect(up0[2]).toBeCloseTo(1, 3)

    await page.getByRole('button', { name: 'Rotate view 90° right' }).click()
    await expect.poll(async () => Math.abs((await up())[2])).toBeLessThan(0.05)

    await page.getByRole('button', { name: 'Rotate view 90° left' }).click()
    await expect.poll(async () => (await up())[2]).toBeCloseTo(1, 3)

    await page.getByRole('button', { name: 'Rotate view 90° left' }).click()
    await expect.poll(async () => Math.abs((await up())[2])).toBeLessThan(0.05)

    await page.getByRole('button', { name: 'Home view' }).click()
    await waitCameraStable(page)
    expect((await up())[2]).toBeCloseTo(1, 3)
  })

  test('M4-H3 Settings Decimal places updates Measure precision and persists across reload', async ({ page }) => {
    await newProject(page)
    await toolButton(page, 'Circle').click()
    await pickTopPlane(page)
    await clickWorld(page, [0, 0, 0])
    await expect(page.getByRole('group', { name: 'Shape size' })).toBeVisible()
    await page.keyboard.type('10')
    await page.keyboard.press('Enter')
    await page.getByRole('button', { name: 'Finish sketch' }).click()
    await toolButton(page, 'Extrude').click()
    await expect(extrudeCard(page)).toBeVisible()
    await extrudeCard(page).getByRole('button', { name: 'Apply' }).click()
    await expect(extrudeCard(page)).toBeHidden()
    await settle(page)
    await waitCameraStable(page)
    await page.keyboard.press('Escape') // clear Body 1 selection so Measure starts empty

    // Pick circular edge (circumference = 10 * pi = 31.4159...).
    await page.getByRole('button', { name: 'Measure', exact: true }).click()
    const card = page.getByRole('dialog', { name: 'Measure' })
    await card.getByRole('radio', { name: 'Edge' }).click()
    await clickPickableNear(page, [5, 0, 10], 'edge')
    // Default precision = 2 -> 31.42 mm.
    await expect(card.getByText('31.42 mm')).toBeVisible()

    // Change precision to 1 -> 31.4 mm.
    await page.getByRole('button', { name: 'Settings' }).click()
    const settings = page.getByRole('dialog', { name: 'Settings' })
    await settings.getByRole('radiogroup', { name: 'Decimal places' }).getByRole('radio', { name: '1', exact: true }).click()
    await settings.getByRole('button', { name: 'Done' }).click()
    await expect(card.getByText('31.4 mm')).toBeVisible()

    // Change precision to 3 -> 31.416 mm, and verify persistence after reload.
    await page.getByRole('button', { name: 'Settings' }).click()
    await settings.getByRole('radiogroup', { name: 'Decimal places' }).getByRole('radio', { name: '3', exact: true }).click()
    await settings.getByRole('button', { name: 'Done' }).click()
    await expect(card.getByText('31.416 mm')).toBeVisible()

    await page.waitForTimeout(600)
    await page.reload()
    await waitReady(page)
    await page.getByRole('button', { name: 'Settings' }).click()
    await expect(
      page.getByRole('dialog', { name: 'Settings' }).getByRole('radiogroup', { name: 'Decimal places' }).getByRole('radio', { name: '3', exact: true }),
    ).toHaveAttribute('aria-checked', 'true')
  })
})

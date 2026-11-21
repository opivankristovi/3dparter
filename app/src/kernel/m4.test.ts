// M4 kernel features: 3MF and STEP export, and geometric measurement (S09 / F09).
import { beforeAll, describe, expect, it } from 'vitest'
import type { Feature, Ref } from '../doc/types'
import { export3mf, exportBodies, exportStep, readZipEntries } from './export'
import { meshBody } from './mesh'
import { Regenerator } from './regenerate'
import {
  bodyRef,
  circle,
  docOf,
  edgeRef,
  extrudeFeature,
  faceRef,
  ready,
  rect,
  sketchFeature,
} from './testutil'

beforeAll(async () => {
  await ready()
})

const BOX_REG = 's/region:l1,l2,l3,l4'
const opts = { tolerance: 0.01, angularTolerance: 0.1, binary: true }

function boxDoc(w = 40, h = 20, dist = '10'): Feature[] {
  return [sketchFeature('s', 'XY', rect('l', 0, 0, w, h)), extrudeFeature('e', [BOX_REG], dist)]
}

function parse3mfMesh(xml: string): { vertices: [number, number, number][]; triangles: [number, number, number][]; volume: number } {
  const vertices: [number, number, number][] = []
  for (const m of xml.matchAll(/<vertex\s+x="([^"]+)"\s+y="([^"]+)"\s+z="([^"]+)"\s*\/>/g)) {
    vertices.push([Number(m[1]), Number(m[2]), Number(m[3])])
  }
  const triangles: [number, number, number][] = []
  for (const m of xml.matchAll(/<triangle\s+v1="(\d+)"\s+v2="(\d+)"\s+v3="(\d+)"\s*\/>/g)) {
    triangles.push([Number(m[1]), Number(m[2]), Number(m[3])])
  }
  let volume = 0
  for (const [i0, i1, i2] of triangles) {
    const a = vertices[i0]
    const b = vertices[i1]
    const c = vertices[i2]
    volume += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6
  }
  return { vertices, triangles, volume: Math.abs(volume) }
}

describe('M4 export: STEP & 3MF', () => {
  it('exports a single body and multiple bodies to valid ISO-10303-21 STEP files', async () => {
    const k = new Regenerator()
    k.regenerate(docOf(...boxDoc()), 1)
    const buf1 = await exportStep([k.getBody('e')!])
    const txt1 = new TextDecoder().decode(buf1)
    expect(txt1).toContain('ISO-10303-21;')
    expect(txt1).toContain('END-ISO-10303-21;')

    const k2 = new Regenerator()
    k2.regenerate(
      docOf(
        sketchFeature('s', 'XY', rect('l', 0, 0, 40, 20)),
        extrudeFeature('e', [BOX_REG], '10'),
        sketchFeature('s2', 'XY', rect('m', 60, 0, 10, 10)),
        extrudeFeature('e2', ['s2/region:m1,m2,m3,m4'], '10'),
      ),
      1,
    )
    const buf2 = await exportBodies('step', [k2.getBody('e')!, k2.getBody('e2')!], opts)
    const txt2 = new TextDecoder().decode(buf2)
    expect(txt2).toContain('ISO-10303-21;')
    expect(txt2).toContain('END-ISO-10303-21;')
    expect(txt2.length).toBeGreaterThan(txt1.length)
  })

  it('exports a 40x20x10 box to a valid 3MF archive with 12 triangles and 8000 mm3 volume', async () => {
    const k = new Regenerator()
    k.regenerate(docOf(...boxDoc()), 1)
    const buf = await export3mf([k.getBody('e')!], opts)
    const entries = readZipEntries(buf)
    expect([...entries.keys()].sort()).toEqual(['3D/3dmodel.model', '[Content_Types].xml', '_rels/.rels'])
    const model = entries.get('3D/3dmodel.model')!
    expect(model).toContain('unit="millimeter"')
    const parsed = parse3mfMesh(model)
    expect(parsed.triangles).toHaveLength(12)
    expect(parsed.volume).toBeCloseTo(8000, 4)
  })

  it('exports multiple bodies as separate objects in 3MF build', async () => {
    const k = new Regenerator()
    k.regenerate(
      docOf(
        sketchFeature('s', 'XY', rect('l', 0, 0, 40, 20)),
        extrudeFeature('e', [BOX_REG], '10'),
        sketchFeature('s2', 'XY', rect('m', 60, 0, 10, 10)),
        extrudeFeature('e2', ['s2/region:m1,m2,m3,m4'], '5'),
      ),
      1,
    )
    const buf = await exportBodies('3mf', [k.getBody('e')!, k.getBody('e2')!], opts)
    const model = readZipEntries(buf).get('3D/3dmodel.model')!
    expect(model).toContain('<object id="1"')
    expect(model).toContain('<object id="2"')
    expect(model).toContain('<item objectid="1"/>')
    expect(model).toContain('<item objectid="2"/>')
  })
})

describe('M4 measure: single and pair picks', () => {
  it('measures straight edge, circular edge, planar face, cylindrical face, solid body and vertex', () => {
    const k = new Regenerator()
    k.regenerate(docOf(...boxDoc()), 1)
    const mesh = meshBody(k.getBody('e')!, 'preview')
    expect(mesh.vertices?.length).toBe(8)

    const edgeRes = k.measure([edgeRef('e/cap:end|e/side/l1')])
    expect(edgeRes.items).toEqual([{ label: 'Length', kind: 'length', value: expect.closeTo(40, 4) }])

    const faceRes = k.measure([faceRef('e/cap:end')])
    expect(faceRes.items).toEqual([{ label: 'Area', kind: 'area', value: expect.closeTo(800, 4) }])

    const bodyRes = k.measure([bodyRef('e')])
    expect(bodyRes.items).toEqual([
      { label: 'Volume', kind: 'volume', value: expect.closeTo(8000, 4) },
      { label: 'Surface area', kind: 'area', value: expect.closeTo(2800, 4) },
    ])

    const vCorner = mesh.vertices!.find((v) => Math.abs(v.point[0] - 40) < 1e-4 && Math.abs(v.point[1] - 20) < 1e-4 && Math.abs(v.point[2] - 10) < 1e-4)!
    const vRef: Ref = { kind: 'vertex', name: vCorner.name, hint: { centroid: vCorner.point } }
    const vertRes = k.measure([vRef])
    expect(vertRes.items).toEqual([{ label: 'Position', kind: 'point', point: [40, 20, 10] }])

    const kCyl = new Regenerator()
    kCyl.regenerate(docOf(sketchFeature('sc', 'XY', [circle('c', [0, 0], 10)]), extrudeFeature('ec', ['sc/region:c'], '20')), 1)
    const cEdge = kCyl.measure([edgeRef('ec/cap:end|ec/side/c')])
    expect(cEdge.items[0].value).toBeCloseTo(Math.PI * 20, 3)
    expect(cEdge.items[1]).toEqual({ label: 'Radius', kind: 'length', value: expect.closeTo(10, 4) })
    expect(cEdge.items[2]).toEqual({ label: 'Diameter', kind: 'length', value: expect.closeTo(20, 4) })

    const cFace = kCyl.measure([faceRef('ec/side/c')])
    expect(cFace.items[0].value).toBeCloseTo(Math.PI * 20 * 20, 2)
    expect(cFace.items[1]).toEqual({ label: 'Radius', kind: 'length', value: expect.closeTo(10, 4) })
    expect(cFace.items[2]).toEqual({ label: 'Diameter', kind: 'length', value: expect.closeTo(20, 4) })
  })

  it('measures distance and angle between parallel faces, perpendicular faces, and separated solids', () => {
    const k = new Regenerator()
    k.regenerate(
      docOf(
        sketchFeature('s', 'XY', rect('l', 0, 0, 40, 20)),
        extrudeFeature('e', [BOX_REG], '10'),
        sketchFeature('s2', 'XY', rect('m', 55, 0, 10, 10)),
        extrudeFeature('e2', ['s2/region:m1,m2,m3,m4'], '10'),
      ),
      1,
    )

    const parallel = k.measure([faceRef('e/side/l1'), faceRef('e/side/l3')])
    expect(parallel.items.find((i) => i.label === 'Distance')?.value).toBeCloseTo(20, 4)
    expect(parallel.items.find((i) => i.label === 'Angle')?.value).toBeCloseTo(0, 4)
    expect(parallel.items.find((i) => i.label === 'Total area')?.value).toBeCloseTo(800, 4)
    expect(parallel.segment).toBeDefined()

    const perp = k.measure([faceRef('e/cap:end'), faceRef('e/side/l1')])
    expect(perp.items.find((i) => i.label === 'Distance')?.value).toBeCloseTo(0, 4)
    expect(perp.items.find((i) => i.label === 'Angle')?.value).toBeCloseTo(90, 4)

    const solids = k.measure([bodyRef('e'), bodyRef('e2')])
    expect(solids.items.find((i) => i.label === 'Distance')?.value).toBeCloseTo(15, 4)
    expect(solids.items.find((i) => i.label === 'Total volume')?.value).toBeCloseTo(9000, 4)
  })

  it('ignores vertex hint fallback when the owning solid is absent (BUG-021)', () => {
    const k = new Regenerator()
    k.regenerate(docOf(...boxDoc()), 1)
    const staleVertex: Ref = { kind: 'vertex', name: 'missing-body/vertex:1', hint: { centroid: [40, 20, 10] } }
    expect(k.measure([staleVertex])).toEqual({ items: [] })
  })
})

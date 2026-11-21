// STL / 3MF mesh import: triangles become a real solid you can fillet and sketch on.
import { beforeAll, describe, expect, it } from 'vitest'
import type { ImportFeature } from '../doc/types'
import { bytesToBase64, parse3mf, toBinaryStl } from './meshFile'
import { binaryStl, boxTriangles, modelXml, prismTriangles, RELS, zip } from './meshTestutil'
import { meshBody } from './mesh'
import { Regenerator } from './regenerate'
import { circle, docOf, edgeRef, extrudeFeature, faceRef, filletFeature, ready, sketchOn } from './testutil'

beforeAll(async () => {
  await ready()
})

const importFeature = (tris: number[][][], id = 'imp'): ImportFeature => ({
  id,
  name: 'Part',
  suppressed: false,
  type: 'import',
  params: { filename: 'part.stl', format: 'stl', content: bytesToBase64(binaryStl(tris as never)) },
})

function volumeOf(k: Regenerator, id: string): number {
  const b = k.getBody(id)
  if (!b) return 0
  const m = meshBody(b, 'high')
  let v = 0
  for (let i = 0; i + 2 < m.indices.length; i += 3) {
    const a = m.indices[i] * 3
    const b2 = m.indices[i + 1] * 3
    const c = m.indices[i + 2] * 3
    const p = m.positions
    v +=
      (p[a] * (p[b2 + 1] * p[c + 2] - p[b2 + 2] * p[c + 1]) -
        p[a + 1] * (p[b2] * p[c + 2] - p[b2 + 2] * p[c]) +
        p[a + 2] * (p[b2] * p[c + 1] - p[b2 + 1] * p[c])) /
      6
  }
  return v
}

/** Name of the face whose triangles sit highest (largest mean z). */
function topFace(k: Regenerator, id: string): string {
  const m = meshBody(k.getBody(id)!, 'preview')
  let best = ''
  let bestZ = -Infinity
  for (const f of m.faces) {
    let z = 0
    let n = 0
    for (let i = f.start; i < f.start + f.count; i++) {
      z += m.positions[m.indices[i] * 3 + 2]
      n++
    }
    if (n && z / n > bestZ) {
      bestZ = z / n
      best = f.name
    }
  }
  return best
}

describe('mesh import', () => {
  it('turns a cube STL into a valid solid with 6 merged faces and the right volume', () => {
    const k = new Regenerator()
    const r = k.regenerate(docOf(importFeature(boxTriangles(10, 10, 10))), 1)
    expect(r.statuses.every((s) => s.ok)).toBe(true)
    const body = k.getBody('imp')!
    expect(body.built.shape.solids.length).toBe(1)
    expect(body.built.shape.faces.length).toBe(6)
    expect(volumeOf(k, 'imp')).toBeCloseTo(1000, 1)
    k.dispose()
  })

  it('turns an inside-out cube (every triangle wound backwards) into a solid with positive volume', () => {
    const k = new Regenerator()
    const flipped = boxTriangles(10, 10, 10).map((t) => [t[0], t[2], t[1]])
    const r = k.regenerate(docOf(importFeature(flipped)), 1)
    expect(r.statuses.every((s) => s.ok)).toBe(true)
    expect(volumeOf(k, 'imp')).toBeCloseTo(1000, 1)
    k.dispose()
  })

  it('lets you fillet an edge of the imported solid', () => {
    const k = new Regenerator()
    const imp = importFeature(boxTriangles(10, 10, 10))
    k.regenerate(docOf(imp), 1)
    const edges = meshBody(k.getBody('imp')!, 'preview').edges.map((e) => e.name)
    expect(edges.length).toBe(12)
    const r = k.regenerate(docOf(imp, filletFeature('f1', [edgeRef(edges[0])], '1')), 2)
    expect(r.statuses.every((s) => s.ok)).toBe(true)
    const v = volumeOf(k, 'imp')
    expect(v).toBeLessThan(1000)
    expect(v).toBeGreaterThan(990)
    k.dispose()
  })

  it('lets you sketch on its top face and cut a hole', () => {
    const k = new Regenerator()
    const imp = importFeature(boxTriangles(20, 20, 10))
    k.regenerate(docOf(imp), 1)
    const top = topFace(k, 'imp')
    const r = k.regenerate(
      docOf(
        imp,
        sketchOn('sk', faceRef(top), [circle('c', [10, 10], 3)]),
        extrudeFeature('cut', ['sk/region:c'], '4', -1, 'subtract', ['imp']),
      ),
      2,
    )
    expect(r.statuses.every((s) => s.ok)).toBe(true)
    expect(volumeOf(k, 'imp')).toBeCloseTo(4000 - Math.PI * 9 * 4, 1)
    k.dispose()
  })

  it('explains gaps when the mesh is open', () => {
    const k = new Regenerator()
    const tris = boxTriangles(10, 10, 10).slice(1)
    const r = k.regenerate(docOf(importFeature(tris)), 1)
    expect(r.statuses[0].ok).toBe(false)
    expect(JSON.stringify(r.statuses[0])).toMatch(/has gaps/)
    k.dispose()
  })

  it('imports a 64-sided prism within 1% of the exact volume', () => {
    const k = new Regenerator()
    const r = k.regenerate(docOf(importFeature(prismTriangles(64, 10, 20))), 1)
    expect(r.statuses.every((s) => s.ok)).toBe(true)
    const exact = 0.5 * 64 * 100 * Math.sin((2 * Math.PI) / 64) * 20
    expect(Math.abs(volumeOf(k, 'imp') - exact) / exact).toBeLessThan(0.01)
    // Caps merge into single faces: 2 caps + 64 sides.
    expect(k.getBody('imp')!.built.shape.faces.length).toBe(66)
    k.dispose()
  })

  it('keeps several separate shells together as one body', () => {
    const k = new Regenerator()
    const a = boxTriangles(10, 10, 10)
    const b = boxTriangles(5, 5, 5).map((t) => t.map(([x, y, z]) => [x + 30, y, z]))
    const r = k.regenerate(docOf(importFeature([...a, ...b])), 1)
    expect(r.statuses.every((s) => s.ok)).toBe(true)
    expect(k.getBody('imp')!.built.shape.solids.length).toBe(2)
    expect(volumeOf(k, 'imp')).toBeCloseTo(1125, 1)
    k.dispose()
  })

  it('imports a 3MF in inches as a solid in millimetres', async () => {
    const file = await zip({ '_rels/.rels': RELS, '3D/3dmodel.model': modelXml(boxTriangles(1, 1, 1), { unit: 'inch' }) }, true)
    const mesh = await parse3mf(file)
    const feature: ImportFeature = {
      id: 'imp',
      name: 'Part',
      suppressed: false,
      type: 'import',
      params: { filename: 'part.3mf', format: '3mf', content: bytesToBase64(toBinaryStl(mesh.positions)) },
    }
    const k = new Regenerator()
    expect(k.regenerate(docOf(feature), 1).statuses.every((s) => s.ok)).toBe(true)
    expect(volumeOf(k, 'imp')).toBeCloseTo(25.4 ** 3, 0)
    k.dispose()
  })

  it('imports a 20,000-triangle mesh (timing)', () => {
    const k = new Regenerator()
    const t0 = performance.now()
    const r = k.regenerate(docOf(importFeature(prismTriangles(5000, 10, 20))), 1)
    const ms = performance.now() - t0
    console.log(`20,000-triangle import took ${Math.round(ms)} ms`)
    expect(r.statuses.every((s) => s.ok)).toBe(true)
    k.dispose()
  }, 120_000)
})


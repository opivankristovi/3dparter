import { beforeAll, describe, expect, it } from 'vitest'
import { measureVolume } from 'replicad'
import type { ProjectDocument } from '../doc/types'
import { exportStl } from './export'
import { meshBody, sketchRegionData } from './mesh'
import { Regenerator } from './regenerate'
import { circle, docOf, extrudeFeature, line, ready, rect, sketchFeature } from './testutil'

beforeAll(async () => {
  await ready()
})

const BOX_REGION = 's/region:l1,l2,l3,l4'

function boxDoc(plane: 'XY' | 'XZ' | 'YZ' = 'XY', direction: 1 | -1 | 0 = 1, w = 40): ProjectDocument {
  return docOf(sketchFeature('s', plane, rect('l', 0, 0, w, 20)), extrudeFeature('e', [BOX_REGION], '10', direction))
}

function boxShape(k: Regenerator) {
  return k.getBody('e')!.built.shape
}

function bbox(k: Regenerator) {
  const bb = boxShape(k).boundingBox
  const b = bb.bounds
  bb.delete()
  return b
}

describe('extrude', () => {
  it('builds a 40x20x10 box on XY with named faces and edges', () => {
    const k = new Regenerator()
    const r = k.regenerate(boxDoc(), 7)
    expect(r.generation).toBe(7)
    expect(r.statuses.every((s) => s.ok)).toBe(true)
    expect(r.bodies).toEqual(['e'])
    expect(measureVolume(boxShape(k) as never)).toBeCloseTo(8000, 3)
    const [lo, hi] = bbox(k)
    expect(lo[2]).toBeCloseTo(0, 6)
    expect(hi[2]).toBeCloseTo(10, 6)

    const mesh = meshBody(k.getBody('e')!, 'preview')
    const names = mesh.faces.map((f) => f.name).sort()
    expect(names).toEqual(
      ['e/cap:end', 'e/cap:start', 'e/side/l1', 'e/side/l2', 'e/side/l3', 'e/side/l4'].sort(),
    )
    expect(mesh.edges).toHaveLength(12)
    const edgeNames = mesh.edges.map((e) => e.name)
    expect(new Set(edgeNames).size).toBe(12)
    expect(edgeNames).toContain('e/cap:start|e/side/l1')
    expect(edgeNames).toContain('e/side/l1|e/side/l2')
    k.dispose()
  })

  it('puts the plane normal on the right side for XZ and for the directions', () => {
    const run = (dir: 1 | -1 | 0) => {
      const k = new Regenerator()
      k.regenerate(boxDoc('XZ', dir), 1)
      const [lo, hi] = bbox(k)
      k.dispose()
      return [lo[1], hi[1]]
    }
    const a = run(1)
    expect(a[0]).toBeCloseTo(-10, 6)
    expect(a[1]).toBeCloseTo(0, 6)
    const b = run(-1)
    expect(b[0]).toBeCloseTo(0, 6)
    expect(b[1]).toBeCloseTo(10, 6)
    const c = run(0)
    expect(c[0]).toBeCloseTo(-5, 6)
    expect(c[1]).toBeCloseTo(5, 6)
  })

  it('extrudes a circle into three faces', () => {
    const k = new Regenerator()
    const r = k.regenerate(docOf(sketchFeature('s', 'XY', [circle('c', [0, 0], 5)]), extrudeFeature('e', ['s/region:c'], '8')), 1)
    expect(r.statuses.every((s) => s.ok)).toBe(true)
    const vol = measureVolume(boxShape(k) as never)
    expect(Math.abs(vol - Math.PI * 25 * 8) / (Math.PI * 25 * 8)).toBeLessThan(0.005)
    const mesh = meshBody(k.getBody('e')!, 'preview')
    expect(mesh.faces.map((f) => f.name).sort()).toEqual(['e/cap:end', 'e/cap:start', 'e/side/c'])
    expect(mesh.edges.map((e) => e.name).sort()).toEqual(['e/cap:end|e/side/c', 'e/cap:start|e/side/c', 'e/side/c|e/side/c'])
    k.dispose()
  })

  it('extrudes a rectangle with a round hole', () => {
    const k = new Regenerator()
    const doc = docOf(
      sketchFeature('s', 'XY', [...rect('l', 0, 0, 60, 40), circle('h', [30, 20], 4)]),
      extrudeFeature('e', [BOX_REGION], '6'),
    )
    const r = k.regenerate(doc, 1)
    expect(r.statuses.every((s) => s.ok)).toBe(true)
    const expected = (2400 - Math.PI * 16) * 6
    const vol = measureVolume(boxShape(k) as never)
    expect(Math.abs(vol - expected) / expected).toBeLessThan(0.005)
    const names = meshBody(k.getBody('e')!, 'preview').faces.map((f) => f.name)
    expect(names).toContain('e/side/h')
    expect(names).toHaveLength(7)
    k.dispose()
  })

  it('extrudes two separate regions into one body with duplicate names suffixed', () => {
    const k = new Regenerator()
    const doc = docOf(
      sketchFeature('s', 'XY', [...rect('a', 0, 0, 10, 10), ...rect('b', 50, 0, 10, 10)]),
      extrudeFeature('e', ['s/region:a1,a2,a3,a4', 's/region:b1,b2,b3,b4'], '5'),
    )
    const r = k.regenerate(doc, 1)
    expect(r.statuses.every((s) => s.ok)).toBe(true)
    expect(r.bodies).toEqual(['e'])
    const names = meshBody(k.getBody('e')!, 'preview').faces.map((f) => f.name)
    expect(names).toContain('e/cap:start#1')
    expect(names).toContain('e/cap:start#2')
    expect(new Set(names).size).toBe(names.length)
    expect(measureVolume(boxShape(k) as never)).toBeCloseTo(1000, 3)
    k.dispose()
  })
})

describe('errors', () => {
  it('has no regions for an open polyline and reports a made-up profile without throwing', () => {
    const k = new Regenerator()
    const open = sketchFeature('s', 'XY', [line('a', [0, 0], [10, 0]), line('b', [10, 0], [10, 10])])
    const r = k.regenerate(docOf(open, extrudeFeature('e', ['s/region:nope'], '5')), 1)
    expect(k.getSketch('s')!.regions).toEqual([])
    expect(sketchRegionData(k.getSketch('s')!)).toEqual([])
    expect(r.statuses[0].ok).toBe(true)
    expect(r.statuses[1].ok).toBe(false)
    expect(r.statuses[1].message).toMatch(/gone/)
    expect(r.bodies).toEqual([])
    k.dispose()
  })

  it('reports bad distances and a missing join target', () => {
    const k = new Regenerator()
    const s = sketchFeature('s', 'XY', rect('l', 0, 0, 10, 10))
    let r = k.regenerate(docOf(s, extrudeFeature('e', [BOX_REGION], 'abc')), 1)
    expect(r.statuses[1]).toMatchObject({ ok: false, message: 'Enter a distance greater than 0.' })
    r = k.regenerate(docOf(s, extrudeFeature('e', [BOX_REGION], '0')), 1)
    expect(r.statuses[1].ok).toBe(false)
    r = k.regenerate(docOf(s, extrudeFeature('e', [BOX_REGION], '5', 1, 'union')), 1)
    expect(r.statuses[1]).toMatchObject({ ok: false, message: 'Pick the solid to join to.' })
    k.dispose()
  })

  it('fails later steps with "An earlier step failed." and rejects sketching on a missing face', () => {
    const k = new Regenerator()
    const bad = sketchFeature('s', 'XY', rect('l', 0, 0, 10, 10))
    bad.params.on = { kind: 'face', name: 'x/cap:end' }
    const r = k.regenerate(docOf(bad, extrudeFeature('e', [BOX_REGION], '5')), 1)
    expect(r.statuses[0].message).toBe('The face this sketch was on is gone.')
    expect(r.statuses[1]).toMatchObject({ ok: false, message: 'An earlier step failed.' })
    k.dispose()
  })

  it('honours suppression and rollback', () => {
    const k = new Regenerator()
    const doc = boxDoc()
    doc.features[1].suppressed = true
    expect(k.regenerate(doc, 1).bodies).toEqual([])
    doc.features[1].suppressed = false
    expect(k.regenerate(doc, 2).bodies).toEqual(['e'])
    doc.rollbackIndex = 0
    const r = k.regenerate(doc, 3)
    expect(r.bodies).toEqual([])
    expect(r.changedBodies).toEqual(['e'])
    k.dispose()
  })
})

describe('cache and naming', () => {
  it('reuses unchanged features and reports changed bodies', () => {
    const k = new Regenerator()
    const doc = boxDoc()
    k.regenerate(doc, 1)
    const first = k.getBody('e')!
    const again = k.regenerate(doc, 2)
    expect(again.changedBodies).toEqual([])
    expect(k.getBody('e')).toBe(first)

    const longer = boxDoc()
    ;(longer.features[1] as { params: { distance: string } }).params.distance = '12'
    expect(k.regenerate(longer, 3).changedBodies).toEqual(['e'])
    k.dispose()
  })

  it('does not rebuild geometry when only a feature name changes', () => {
    const k = new Regenerator()
    const doc = boxDoc()
    k.regenerate(doc, 1)
    const first = k.getBody('e')!
    const renamed = boxDoc()
    renamed.features[0].name = 'Base sketch'
    renamed.features[1].name = 'Block'
    const r = k.regenerate(renamed, 2)
    expect(r.changedBodies).toEqual([])
    expect(k.getBody('e')).toBe(first)
    k.dispose()
  })

  it('keeps the same face names after the sketch is edited', () => {
    const k = new Regenerator()
    k.regenerate(boxDoc('XY', 1, 40), 1)
    const before = meshBody(k.getBody('e')!, 'preview').faces.map((f) => f.name).sort()
    const r = k.regenerate(boxDoc('XY', 1, 55), 2)
    expect(r.changedBodies).toEqual(['e'])
    const after = meshBody(k.getBody('e')!, 'preview').faces.map((f) => f.name).sort()
    expect(after).toEqual(before)
    expect(after).toHaveLength(6)
    expect(measureVolume(boxShape(k) as never)).toBeCloseTo(55 * 20 * 10, 3)
    k.dispose()
  })

  it('frees replaced shapes (no throw on repeated edits and dispose)', () => {
    const k = new Regenerator()
    for (let i = 1; i <= 5; i++) k.regenerate(boxDoc('XY', 1, 30 + i), i)
    k.dispose()
    expect(k.regenerate(docOf(), 9).bodies).toEqual([])
  })
})

describe('mesh and export', () => {
  it('covers every index exactly once with the face ranges', () => {
    const k = new Regenerator()
    k.regenerate(boxDoc(), 1)
    for (const q of ['preview', 'high'] as const) {
      const m = meshBody(k.getBody('e')!, q)
      expect(m.positions).toBeInstanceOf(Float32Array)
      expect(m.normals).toBeInstanceOf(Float32Array)
      expect(m.indices).toBeInstanceOf(Uint32Array)
      expect(m.normals.length).toBe(m.positions.length)
      const covered = new Uint8Array(m.indices.length)
      for (const f of m.faces) {
        expect(f.start).toBeGreaterThanOrEqual(0)
        expect(f.start + f.count).toBeLessThanOrEqual(m.indices.length)
        for (let i = f.start; i < f.start + f.count; i++) covered[i]++
      }
      expect(covered.every((c) => c === 1)).toBe(true)
      expect(m.indices.every((i) => i < m.positions.length / 3)).toBe(true)
      expect(m.edges).toHaveLength(12)
      expect(m.edges.every((e) => e.points.length >= 6)).toBe(true)
    }
    k.dispose()
  })

  it('returns sketch regions with world loops and a fill', () => {
    const k = new Regenerator()
    k.regenerate(boxDoc('XZ'), 1)
    const regions = sketchRegionData(k.getSketch('s')!)
    expect(regions).toHaveLength(1)
    expect(regions[0].name).toBe(BOX_REGION)
    expect(regions[0].area).toBeCloseTo(800, 6)
    expect(regions[0].loops).toHaveLength(1)
    expect(regions[0].loops[0].length).toBe(5 * 3) // closed: 4 corners plus the first repeated
    expect(regions[0].fill.indices.length).toBe(6)
    // XZ plane: local (x, y) maps to world (x, 0, y)
    expect(Array.from(regions[0].loops[0].slice(6, 9)).map(Math.round)).toEqual([40, 0, 20])
    k.dispose()
  })

  it('exports a binary STL whose size matches its triangle count', async () => {
    const k = new Regenerator()
    k.regenerate(boxDoc(), 1)
    const buf = await exportStl([k.getBody('e')!], { tolerance: 0.1, angularTolerance: 0.5, binary: true })
    const view = new DataView(buf)
    const count = view.getUint32(80, true)
    expect(count).toBeGreaterThanOrEqual(12)
    expect(buf.byteLength).toBe(84 + 50 * count)
    const header = new TextDecoder().decode(new Uint8Array(buf, 0, 5))
    expect(header.toLowerCase()).not.toBe('solid') // binary files must not start like an ASCII STL
    k.dispose()
  })

  it('exports several bodies into one file', async () => {
    const k = new Regenerator()
    const doc = docOf(
      sketchFeature('s', 'XY', [...rect('a', 0, 0, 10, 10), ...rect('b', 50, 0, 10, 10)]),
      extrudeFeature('e1', ['s/region:a1,a2,a3,a4'], '5'),
      extrudeFeature('e2', ['s/region:b1,b2,b3,b4'], '5'),
    )
    const r = k.regenerate(doc, 1)
    expect(r.bodies).toEqual(['e1', 'e2'])
    const buf = await exportStl([k.getBody('e1')!, k.getBody('e2')!], { tolerance: 0.1, angularTolerance: 0.5, binary: true })
    const count = new DataView(buf).getUint32(80, true)
    expect(count).toBeGreaterThanOrEqual(24)
    expect(buf.byteLength).toBe(84 + 50 * count)
    k.dispose()
  })
})

// Sketch text through the kernel: emboss (new body) and engrave (subtract) from text outlines.
import { beforeAll, describe, expect, it } from 'vitest'
import type { TextEntity } from '../doc/types'
import { loadTestFont } from '../sketch/text/testFont'
import { meshBody } from './mesh'
import { Regenerator } from './regenerate'
import { docOf, extrudeFeature, faceRef, ready, rect, sketchFeature, sketchOn } from './testutil'

beforeAll(async () => {
  loadTestFont()
  await ready()
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
    const P = m.positions
    v += (P[a] * (P[b2 + 1] * P[c + 2] - P[b2 + 2] * P[c + 1]) - P[a + 1] * (P[b2] * P[c + 2] - P[b2 + 2] * P[c]) + P[a + 2] * (P[b2] * P[c + 1] - P[b2 + 1] * P[c])) / 6
  }
  return Math.abs(v)
}

const textEntity = (over: Partial<TextEntity> = {}): TextEntity => ({
  id: 't1',
  type: 'text',
  construction: false,
  position: [5, 5],
  text: 'HI',
  size: 10,
  rotation: 0,
  ...over,
})

describe('sketch text in the kernel', () => {
  it('extrudes text regions into a valid solid', () => {
    const k = new Regenerator()
    const sk = sketchFeature('s1', 'XY', [textEntity()])
    k.regenerate(docOf(sk), 1)
    const regions = k.getSketch('s1')!.regions
    expect(regions).toHaveLength(2)
    expect(regions.every((r) => /^s1\/region:t1~\d$/.test(r.name))).toBe(true)
    const res = k.regenerate(docOf(sk, extrudeFeature('e1', regions.map((r) => r.name), '2')), 2)
    expect(res.statuses.every((s) => s.ok)).toBe(true)
    const v = volumeOf(k, 'e1')
    expect(v).toBeGreaterThan(10)
    // H and I are mostly stems about 2 mm wide: nowhere near their bounding box.
    const [min, max] = k.getBody('e1')!.built.shape.boundingBox.bounds
    expect(max[2] - min[2]).toBeCloseTo(2, 3)
    expect(v).toBeLessThan((max[0] - min[0]) * (max[1] - min[1]) * 2)
  })

  it('extrudes a letter with a counter (o) as a ring', () => {
    const k = new Regenerator()
    const sk = sketchFeature('s1', 'XY', [textEntity({ text: 'o' })])
    k.regenerate(docOf(sk), 1)
    const regions = k.getSketch('s1')!.regions
    expect(regions).toHaveLength(1)
    expect(regions[0].holes).toHaveLength(1)
    const res = k.regenerate(docOf(sk, extrudeFeature('e1', [regions[0].name], '3')), 2)
    expect(res.statuses.every((s) => s.ok)).toBe(true)
    expect(volumeOf(k, 'e1')).toBeCloseTo(regions[0].area * 3, 0)
  })

  it('engraves text into the top face of a box', () => {
    const k = new Regenerator()
    const base = sketchFeature('s1', 'XY', rect('a', 0, 0, 60, 30))
    const box = extrudeFeature('b1', ['s1/region:a1,a2,a3,a4'], '10')
    const txt = sketchOn('s2', faceRef('b1/cap:end'), [textEntity({ position: [8, 10] })])
    const probe = k.regenerate(docOf(base, box, txt), 1)
    expect(probe.statuses.every((s) => s.ok)).toBe(true)
    const names = k.getSketch('s2')!.regions.map((r) => r.name)
    expect(names.length).toBe(2)
    const before = volumeOf(k, 'b1')
    expect(before).toBeCloseTo(60 * 30 * 10, 0)
    const cut = extrudeFeature('c1', names, '1', -1, 'subtract', ['b1'])
    const res = k.regenerate(docOf(base, box, txt, cut), 2)
    expect(res.statuses.every((s) => s.ok)).toBe(true)
    const after = volumeOf(k, 'b1')
    expect(after).toBeLessThan(before - 5)
    expect(after).toBeGreaterThan(before - 300)
  })

  it('has no regions for empty text', () => {
    const k = new Regenerator()
    const sk = sketchFeature('s1', 'XY', [textEntity({ text: '' })])
    k.regenerate(docOf(sk), 1)
    expect(k.getSketch('s1')!.regions).toHaveLength(0)
  })
})

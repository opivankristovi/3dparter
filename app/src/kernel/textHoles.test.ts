// M6-T-E11: text "o8" extruded keeps the holes of its letters (volume below the filled outlines).
import { beforeAll, describe, expect, it } from 'vitest'
import type { TextEntity } from '../doc/types'
import { loadTestFont } from '../sketch/text/testFont'
import { meshBody } from './mesh'
import { Regenerator } from './regenerate'
import { docOf, extrudeFeature, ready, sketchFeature } from './testutil'

beforeAll(async () => {
  loadTestFont()
  await ready()
})

function volumeOf(k: Regenerator, id: string): number {
  const b = k.getBody(id)
  if (!b) return 0
  const m = meshBody(b, 'high')
  const P = m.positions
  let v = 0
  for (let i = 0; i + 2 < m.indices.length; i += 3) {
    const a = m.indices[i] * 3
    const b2 = m.indices[i + 1] * 3
    const c = m.indices[i + 2] * 3
    v += (P[a] * (P[b2 + 1] * P[c + 2] - P[b2 + 2] * P[c + 1]) - P[a + 1] * (P[b2] * P[c + 2] - P[b2 + 2] * P[c]) + P[a + 2] * (P[b2] * P[c + 1] - P[b2 + 1] * P[c])) / 6
  }
  return Math.abs(v)
}

describe('M6-T-E11 text with holes', () => {
  it('"o8" extruded has holes: volume is below the filled outlines', () => {
    const t: TextEntity = { id: 't1', type: 'text', construction: false, position: [0, 0], text: 'o8', size: 10, rotation: 0 }
    const k = new Regenerator()
    const sk = sketchFeature('s1', 'XY', [t])
    k.regenerate(docOf(sk), 1)
    const regions = k.getSketch('s1')!.regions
    expect(regions.length).toBe(2)
    // o has one counter, 8 has two.
    expect(regions.map((r) => r.holes.length).sort()).toEqual([1, 2])
    const res = k.regenerate(docOf(sk, extrudeFeature('e1', regions.map((r) => r.name), '2')), 2)
    expect(res.statuses.every((s) => s.ok)).toBe(true)
    const filled = regions.reduce((n, r) => n + r.outer.area, 0) * 2
    const withHoles = regions.reduce((n, r) => n + r.area, 0) * 2
    const v = volumeOf(k, 'e1')
    expect(v).toBeLessThan(filled - 1)
    expect(v).toBeCloseTo(withHoles, 0)
    k.dispose()
  })
})

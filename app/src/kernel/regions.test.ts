import { describe, expect, it } from 'vitest'
import { findRegions } from './regions'
import { circle, line, rect } from './testutil'

const sk = (...entities: ReturnType<typeof rect>) => ({ entities, constraints: [] })

describe('regions', () => {
  it('finds one region in a rectangle', () => {
    const regions = findRegions('s', sk(...rect('l', 0, 0, 40, 20)))
    expect(regions).toHaveLength(1)
    expect(regions[0].name).toBe('s/region:l1,l2,l3,l4')
    expect(regions[0].holes).toHaveLength(0)
    expect(regions[0].area).toBeCloseTo(800, 6)
    expect(regions[0].outer.segments).toHaveLength(4)
  })

  it('walks a rectangle drawn clockwise and with reversed lines as one counter-clockwise loop', () => {
    const entities = [
      line('a', [0, 0], [0, 10]),
      line('b', [10, 10], [0, 10]), // drawn backwards
      line('c', [10, 10], [10, 0]),
      line('d', [10, 0], [0, 0]),
    ]
    const regions = findRegions('s', sk(...entities))
    expect(regions).toHaveLength(1)
    expect(regions[0].area).toBeCloseTo(100, 6)
    expect(regions[0].outer.segments.some((s) => s.reversed)).toBe(true)
  })

  it('treats an inner circle as a hole', () => {
    const regions = findRegions('s', sk(...rect('l', 0, 0, 60, 40), circle('c', [30, 20], 4)))
    expect(regions).toHaveLength(1)
    expect(regions[0].holes).toHaveLength(1)
    expect(regions[0].holes[0].segments[0].id).toBe('c')
    expect(regions[0].area).toBeCloseTo(2400 - Math.PI * 16, 6)
  })

  it('makes a circle alone one region', () => {
    const regions = findRegions('s', sk(circle('c', [0, 0], 5)))
    expect(regions.map((r) => r.name)).toEqual(['s/region:c'])
    expect(regions[0].area).toBeCloseTo(Math.PI * 25, 6)
  })

  it('finds two separate rectangles', () => {
    const regions = findRegions('s', sk(...rect('a', 0, 0, 10, 10), ...rect('b', 50, 50, 5, 5)))
    expect(regions).toHaveLength(2)
    expect(regions.every((r) => r.holes.length === 0)).toBe(true)
  })

  it('treats a rectangle inside a rectangle inside a rectangle as ring plus island', () => {
    const regions = findRegions('s', sk(...rect('a', 0, 0, 100, 100), ...rect('b', 10, 10, 80, 80), ...rect('c', 20, 20, 60, 60)))
    expect(regions).toHaveLength(2) // outer ring (hole b) and the innermost island
    const ring = regions.find((r) => r.holes.length === 1)!
    expect(ring.name).toBe('s/region:a1,a2,a3,a4')
    expect(regions.find((r) => r.holes.length === 0)!.name).toBe('s/region:c1,c2,c3,c4')
  })

  it('finds no region in an open polyline', () => {
    const regions = findRegions('s', sk(line('a', [0, 0], [10, 0]), line('b', [10, 0], [10, 10]), line('c', [10, 10], [0, 10])))
    expect(regions).toEqual([])
  })

  it('ignores a dangling line and construction geometry', () => {
    const entities = [...rect('l', 0, 0, 10, 10), line('d', [10, 10], [20, 20]), { ...circle('k', [5, 5], 1), construction: true }]
    const regions = findRegions('s', sk(...entities))
    expect(regions).toHaveLength(1)
    expect(regions[0].name).toBe('s/region:l1,l2,l3,l4')
    expect(regions[0].holes).toHaveLength(0)
  })

  it('does not crash on a T-junction and splits a rectangle by a line across it', () => {
    const stub = [line('a', [0, 0], [10, 0]), line('b', [5, 0], [5, 5])]
    expect(findRegions('s', sk(...stub))).toEqual([])
    const entities = [
      line('b1', [0, 0], [5, 0]),
      line('b2', [5, 0], [10, 0]),
      line('r', [10, 0], [10, 10]),
      line('t', [10, 10], [0, 10]),
      line('l', [0, 10], [0, 0]),
      line('mid', [5, 0], [5, 10]),
    ]
    // The middle line stops at the top edge without a vertex: only the bottom T exists, so the top
    // edge is not split. The graph is still walked without error and yields at least the outer shape.
    const regions = findRegions('s', sk(...entities))
    expect(regions.length).toBeGreaterThanOrEqual(1)
  })

  it('splits a rectangle with a divider that meets vertices on both sides', () => {
    const entities = [
      line('b1', [0, 0], [5, 0]),
      line('b2', [5, 0], [10, 0]),
      line('r', [10, 0], [10, 10]),
      line('t1', [10, 10], [5, 10]),
      line('t2', [5, 10], [0, 10]),
      line('l', [0, 10], [0, 0]),
      line('mid', [5, 0], [5, 10]),
    ]
    const regions = findRegions('s', sk(...entities))
    expect(regions).toHaveLength(2)
    expect(regions.map((r) => Math.round(r.area)).sort()).toEqual([50, 50])
  })
})

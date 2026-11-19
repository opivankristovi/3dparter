// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { Sketch, SketchEntity } from '../../doc/types'
import { rectangleEntities } from '../geometry'
import { applicableConstraints } from './applicable'
import { inferConstraints } from './infer'
import { formatRef, getPoint, parseRef, setPoint } from './refs'
import { arc, line } from './testutil'

const opts = { tolMm: 0.5, kind: 'line' as const }
const summary = (cs: ReturnType<typeof inferConstraints>) => cs.map((c) => `${c.type}:${c.entityIds.join('+')}`)

describe('inferConstraints', () => {
  it('snaps a new endpoint to an existing one and to the origin', () => {
    const existing = [line('e', [10, 10], [30, 25])]
    const fresh = [line('n', [10.2, 9.9], [0.1, -0.2])]
    const out = summary(inferConstraints(fresh, existing, opts))
    expect(out).toContain('coincident:n.a+e.a')
    expect(out).toContain('coincident:n.b+origin')
  })

  it('picks the nearest existing point', () => {
    const existing = [line('e', [10, 10], [10.3, 10])]
    const out = summary(inferConstraints([line('n', [10.25, 10], [40, 40])], existing, opts))
    expect(out).toContain('coincident:n.a+e.b')
    expect(out.filter((s) => s.startsWith('coincident'))).toHaveLength(1)
  })

  it('links consecutive polyline lines', () => {
    const fresh = [line('p1', [5, 5], [20, 9]), line('p2', [20, 9], [31, 30])]
    const out = summary(inferConstraints(fresh, [], opts))
    expect(out).toEqual(['coincident:p1.b+p2.a'])
  })

  it('horizontal and vertical within half a degree, nothing beyond', () => {
    const fresh = [
      line('h', [5, 5], [105, 5.5]), // 0.29 deg
      line('v', [200, 5], [200.4, 80]), // 0.31 deg
      line('d', [300, 5], [400, 7]), // 1.1 deg
    ]
    const out = summary(inferConstraints(fresh, [], { ...opts, tolMm: 1e-6 }))
    expect(out).toEqual(['horizontal:h', 'vertical:v'])
  })

  it('a rectangle gives 4 coincident, 2 horizontal, 2 vertical', () => {
    let n = 0
    const rect = rectangleEntities([10, 10], [50, 40], () => `r${n++}`)
    const out = inferConstraints(rect, [], { tolMm: 1e-3, kind: 'rectangle' })
    const count = (t: string) => out.filter((c) => c.type === t).length
    expect(count('coincident')).toBe(4)
    expect(count('horizontal')).toBe(2)
    expect(count('vertical')).toBe(2)
    expect(out).toHaveLength(8)
  })

  it('a rectangle drawn on the origin also snaps to it, without duplicates', () => {
    let n = 0
    const rect = rectangleEntities([0, 0], [50, 40], () => `r${n++}`)
    const out = inferConstraints(rect, [], { tolMm: 1e-3, kind: 'rectangle' })
    const co = out.filter((c) => c.type === 'coincident')
    expect(co).toHaveLength(5) // 4 corners + corner to origin
    const pairs = co.map((c) => [...c.entityIds].sort().join('|'))
    expect(new Set(pairs).size).toBe(pairs.length)
  })

  it('circles snap their centre only and get no h/v', () => {
    const existing = [line('e', [10, 10], [30, 25])]
    const out = summary(
      inferConstraints([{ id: 'c', type: 'circle', construction: false, center: [30.1, 25], radius: 5 }], existing, {
        tolMm: 0.5,
        kind: 'circle',
      }),
    )
    expect(out).toEqual(['coincident:c.center+e.b'])
  })

  it('an arc end can land on an existing end', () => {
    const existing = [line('e', [10, 0], [30, 0])]
    const out = summary(inferConstraints([arc('a', [0, 0], 10, 0, 1)], existing, { tolMm: 0.01, kind: 'arc' }))
    expect(out).toContain('coincident:a.center+origin')
    expect(out).toContain('coincident:a.start+e.a')
  })
})

describe('refs', () => {
  it('parses and formats', () => {
    expect(parseRef('abc')).toEqual({ kind: 'entity', entityId: 'abc' })
    expect(parseRef('abc.b')).toEqual({ kind: 'point', entityId: 'abc', slot: 'b' })
    expect(parseRef('origin')).toEqual({ kind: 'reserved', name: 'origin' })
    expect(parseRef('abc.zzz')).toBeNull()
    expect(formatRef('x', 'start')).toBe('x.start')
  })

  it('reads and writes points', () => {
    const l = line('l', [1, 2], [3, 4])
    expect(getPoint(l, 'b')).toEqual([3, 4])
    expect(setPoint(l, 'a', [9, 9])).toMatchObject({ a: [9, 9], b: [3, 4] })
    const a = arc('a', [0, 0], 2, 0, Math.PI / 2)
    const end = getPoint(a, 'end') as [number, number]
    expect(end[0]).toBeCloseTo(0, 12)
    expect(end[1]).toBeCloseTo(2, 12)
    const moved = setPoint(a, 'end', [-5, 0])
    expect(moved.type === 'arc' && moved.endAngle).toBeCloseTo(Math.PI, 12)
  })
})

describe('applicableConstraints', () => {
  const entities: SketchEntity[] = [
    line('l1', [0, 0], [10, 0]),
    line('l2', [0, 5], [10, 9]),
    { id: 'c1', type: 'circle', construction: false, center: [20, 0], radius: 4 },
    arc('a1', [30, 0], 3, 0, 1),
  ]
  const sketch: Sketch = { entities, constraints: [] }
  const at = (...sel: string[]) => applicableConstraints(sel, sketch)

  it('nothing selected', () => {
    expect(at()).toEqual([])
  })
  it('one line', () => {
    expect(at('l1')).toEqual(['horizontal', 'vertical', 'length', 'fix'])
  })
  it('two lines', () => {
    expect(at('l1', 'l2')).toEqual(['parallel', 'perpendicular', 'equal', 'angle'])
  })
  it('a point and a line', () => {
    expect(at('l1.a', 'l2')).toEqual(['pointOnEntity', 'midpoint', 'pointLineDistance'])
  })
  it('two points', () => {
    expect(at('l1.a', 'l2.b')).toEqual([
      'coincident',
      'horizontal',
      'vertical',
      'distance',
      'horizontalDistance',
      'verticalDistance',
      'tangent',
    ])
    expect(at('l1.a', 'origin')).not.toContain('tangent')
  })
  it('one point, circle, arc', () => {
    expect(at('l1.a')).toEqual(['fix'])
    expect(at('c1')).toEqual(['radius', 'diameter', 'fix'])
    expect(at('a1')).toEqual(['radius', 'diameter', 'fix'])
    expect(at('l1.a', 'c1')).toEqual(['pointOnEntity'])
  })
  it('line and circle, two round things', () => {
    expect(at('l1', 'c1')).toEqual(['tangent'])
    expect(at('c1', 'a1')).toEqual(['concentric', 'equal', 'tangent'])
  })
  it('symmetric needs three', () => {
    expect(at('l1.a', 'l2.a', 'yAxis')).toEqual(['symmetric'])
    expect(at('l1.a', 'l2.a', 'origin')).toEqual(['symmetric'])
  })
  it('unknown refs give nothing', () => {
    expect(at('ghost')).toEqual([])
  })
})

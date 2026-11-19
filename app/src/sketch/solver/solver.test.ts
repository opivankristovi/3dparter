import { beforeAll, describe, expect, it } from 'vitest'
import type { CircleEntity, Sketch, SketchEntity, Vec2 } from '../../doc/types'
import { findRegions } from '../../kernel/regions'
import { entityStates } from './defined'
import { solveSketch } from './solver'
import { arc, con, line, lineOf, readySolver, rectSketch } from './testutil'

beforeAll(async () => {
  await readySolver()
})

const dist = (p: Vec2, q: Vec2) => Math.hypot(p[0] - q[0], p[1] - q[1])
const angleDeg = (a: Vec2, b: Vec2) => (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI

describe('rectangle', () => {
  it('walks dof 4 -> 2 -> 0 and every entity ends up fully defined', () => {
    const base = rectSketch()
    expect(base.constraints.map((c) => c.type).sort()).toEqual(
      ['coincident', 'coincident', 'coincident', 'coincident', 'horizontal', 'horizontal', 'vertical', 'vertical'],
    )
    let r = solveSketch(base)
    expect(r.ok).toBe(true)
    expect(r.dof).toBe(4)
    expect(r.state).toBe('under')

    const dims = [...base.constraints, con('length', ['r0'], '40'), con('length', ['r1'], '30')]
    r = solveSketch({ ...base, constraints: dims })
    expect(r.dof).toBe(2)

    const full: Sketch = { ...base, constraints: [...dims, con('coincident', ['r0.a', 'origin'])] }
    r = solveSketch(full)
    expect(r.ok).toBe(true)
    expect(r.dof).toBe(0)
    expect(r.state).toBe('full')
    const bottom = lineOf(r.entities, 'r0')
    expect(bottom.a[0]).toBeCloseTo(0, 6)
    expect(bottom.a[1]).toBeCloseTo(0, 6)
    expect(bottom.b[0]).toBeCloseTo(40, 6)
    expect(Object.values(entityStates({ entities: r.entities, constraints: full.constraints }))).toEqual([
      'full',
      'full',
      'full',
      'full',
    ])
  })

  it('without the origin constraint every entity is under-defined', () => {
    const base = rectSketch()
    const s: Sketch = { ...base, constraints: [...base.constraints, con('length', ['r0'], '40'), con('length', ['r1'], '30')] }
    expect(Object.values(entityStates(s))).toEqual(['under', 'under', 'under', 'under'])
  })

  it('dragging a corner keeps a rectangle', () => {
    const base = rectSketch()
    const r = solveSketch(base, { drag: { ref: 'r1.b', to: [75, 62] } })
    expect(r.ok).toBe(true)
    const [bottom, right, top, left] = ['r0', 'r1', 'r2', 'r3'].map((id) => lineOf(r.entities, id))
    expect(right.b[0]).toBeCloseTo(75, 5)
    expect(right.b[1]).toBeCloseTo(62, 5)
    // opposite sides parallel (axis aligned) and corners still shared
    expect(bottom.a[1]).toBeCloseTo(bottom.b[1], 8)
    expect(top.a[1]).toBeCloseTo(top.b[1], 8)
    expect(left.a[0]).toBeCloseTo(left.b[0], 8)
    expect(right.a[0]).toBeCloseTo(right.b[0], 8)
    expect(dist(bottom.b, right.a)).toBeLessThan(1e-6)
    expect(dist(right.b, top.a)).toBeLessThan(1e-6)
    expect(dist(top.b, left.a)).toBeLessThan(1e-6)
    expect(dist(left.b, bottom.a)).toBeLessThan(1e-6)
  })

  it('an over-defined drag still returns a best-effort result', () => {
    const base = rectSketch()
    const full: Sketch = {
      ...base,
      constraints: [
        ...base.constraints,
        con('length', ['r0'], '40'),
        con('length', ['r1'], '30'),
        con('coincident', ['r0.a', 'origin']),
      ],
    }
    const solved = solveSketch(full)
    const r = solveSketch({ ...full, entities: solved.entities }, { drag: { ref: 'r1.b', to: [90, 90] } })
    expect(r.ok).toBe(true)
    const [bottom, right, top, left] = ['r0', 'r1', 'r2', 'r3'].map((id) => lineOf(r.entities, id))
    expect(dist(bottom.a, bottom.b)).toBeCloseTo(40, 5)
    expect(dist(right.a, right.b)).toBeCloseTo(30, 5)
    expect(dist(top.b, left.a)).toBeLessThan(1e-6)
  })

  it('dragging a whole line translates it by to - grab', () => {
    const entities = [line('L', [0, 0], [10, 0])]
    const r = solveSketch({ entities, constraints: [] }, { drag: { ref: 'L', to: [13, 7], grab: [5, 0] } })
    const l = lineOf(r.entities, 'L')
    expect(l.a[0]).toBeCloseTo(8, 6)
    expect(l.a[1]).toBeCloseTo(7, 6)
    expect(l.b[0]).toBeCloseTo(18, 6)
  })

  it('changing a length moves the geometry', () => {
    const base = rectSketch()
    const len = con('length', ['r0'], '40')
    const mk = (v: string): Sketch => ({
      ...base,
      constraints: [...base.constraints, { ...len, value: v }, con('coincident', ['r0.a', 'origin'])],
    })
    const a = solveSketch(mk('40'))
    const b = solveSketch(mk('60'))
    expect(lineOf(a.entities, 'r0').b[0]).toBeCloseTo(40, 6)
    expect(lineOf(b.entities, 'r0').b[0]).toBeCloseTo(60, 6)
    expect(lineOf(b.entities, 'r2').a[0]).toBeCloseTo(60, 6) // the far side followed
  })

  it('solved rectangles are still one closed region', () => {
    const base = rectSketch()
    const s: Sketch = {
      ...base,
      constraints: [...base.constraints, con('length', ['r0'], '37.5'), con('length', ['r1'], '12.25'), con('coincident', ['r0.a', 'origin'])],
    }
    const r = solveSketch(s)
    expect(r.ok).toBe(true)
    const regions = findRegions('s', { entities: r.entities, constraints: s.constraints })
    expect(regions).toHaveLength(1)
    expect(regions[0].area).toBeCloseTo(37.5 * 12.25, 5)
  })
})

describe('constraints', () => {
  it('line tangent to a circle', () => {
    const entities: SketchEntity[] = [
      { id: 'C', type: 'circle', construction: false, center: [0, 0], radius: 5 },
      line('L', [-10, 8], [10, 8.5]),
    ]
    const r = solveSketch({ entities, constraints: [con('fix', ['C']), con('tangent', ['L', 'C'])] })
    expect(r.ok).toBe(true)
    const l = lineOf(r.entities, 'L')
    const d = Math.abs(l.a[0] * l.b[1] - l.b[0] * l.a[1]) / dist(l.a, l.b)
    expect(d).toBeCloseTo(5, 6)
    expect(r.dof).toBe(3)
  })

  it('equal radii and concentric', () => {
    const entities: SketchEntity[] = [
      { id: 'A', type: 'circle', construction: false, center: [0, 0], radius: 5 },
      { id: 'B', type: 'circle', construction: false, center: [20, 3], radius: 8 },
    ]
    const r = solveSketch({
      entities,
      constraints: [con('fix', ['A']), con('equal', ['A', 'B']), con('concentric', ['A', 'B'])],
    })
    expect(r.ok).toBe(true)
    const b = r.entities[1] as CircleEntity
    expect(b.radius).toBeCloseTo(5, 6)
    expect(dist(b.center, [0, 0])).toBeLessThan(1e-6)
    expect(r.dof).toBe(0)
  })

  it('symmetric about the y axis', () => {
    const entities = [line('L1', [10, 3], [20, 5]), line('L2', [-9, 2], [-30, 40])]
    const r = solveSketch({ entities, constraints: [con('fix', ['L1']), con('symmetric', ['L1.a', 'L2.a', 'yAxis'])] })
    expect(r.ok).toBe(true)
    const l2 = lineOf(r.entities, 'L2')
    expect(l2.a[0]).toBeCloseTo(-10, 6)
    expect(l2.a[1]).toBeCloseTo(3, 6)
  })

  it('midpoint', () => {
    const entities = [line('L1', [0, 0], [10, 4]), line('L2', [3, 9], [8, 12])]
    const r = solveSketch({ entities, constraints: [con('fix', ['L1']), con('midpoint', ['L2.a', 'L1'])] })
    expect(r.ok).toBe(true)
    const l2 = lineOf(r.entities, 'L2')
    expect(l2.a[0]).toBeCloseTo(5, 6)
    expect(l2.a[1]).toBeCloseTo(2, 6)
  })

  it('30 degrees between two lines', () => {
    const entities = [line('L1', [0, 0], [10, 0]), line('L2', [0, 0], [5, 6])]
    const r = solveSketch({
      entities,
      constraints: [con('fix', ['L1']), con('coincident', ['L2.a', 'L1.a']), con('angle', ['L1', 'L2'], '30')],
    })
    expect(r.ok).toBe(true)
    const l2 = lineOf(r.entities, 'L2')
    expect(angleDeg(l2.a, l2.b)).toBeCloseTo(30, 6)
  })

  it('parallel, perpendicular, point on circle, distances', () => {
    const entities: SketchEntity[] = [
      line('A', [0, 0], [10, 1]),
      line('B', [2, 5], [9, 9]),
      line('C', [3, -4], [6, -7]),
      { id: 'K', type: 'circle', construction: false, center: [30, 30], radius: 4 },
      line('D', [20, 20], [25, 22]),
    ]
    const r = solveSketch({
      entities,
      constraints: [
        con('fix', ['A']),
        con('parallel', ['A', 'B']),
        con('perpendicular', ['A', 'C']),
        con('pointOnEntity', ['D.b', 'K']),
        con('pointLineDistance', ['B.a', 'A'], '7'),
        con('horizontalDistance', ['A.a', 'D.a'], '-12'),
        con('verticalDistance', ['A.a', 'D.a'], '6'),
        con('distance', ['D.a', 'D.b'], '9'),
      ],
    })
    expect(r.ok).toBe(true)
    const [a, b, c, , d] = ['A', 'B', 'C', 'K', 'D'].map((id) => r.entities.find((e) => e.id === id)) as ReturnType<typeof lineOf>[]
    const dir = (l: typeof a) => [l.b[0] - l.a[0], l.b[1] - l.a[1]]
    const cross = (u: number[], v: number[]) => u[0] * v[1] - u[1] * v[0]
    const dot = (u: number[], v: number[]) => u[0] * v[0] + u[1] * v[1]
    expect(cross(dir(a), dir(b))).toBeCloseTo(0, 5)
    expect(dot(dir(a), dir(c))).toBeCloseTo(0, 5)
    expect(d.a[0]).toBeCloseTo(-12, 5)
    expect(d.a[1]).toBeCloseTo(6, 5)
    expect(dist(d.a, d.b)).toBeCloseTo(9, 5)
    const k = r.entities.find((e) => e.id === 'K') as CircleEntity
    expect(dist(d.b, k.center)).toBeCloseTo(k.radius, 5)
    expect(Math.abs(cross(dir(a), [b.a[0] - a.a[0], b.a[1] - a.a[1]])) / dist(a.a, a.b)).toBeCloseTo(7, 5)
  })

  it('an arc with a radius dimension keeps its ends on the circle', () => {
    const entities = [arc('R', [2, 3], 10, 0, Math.PI / 2)]
    const r = solveSketch({
      entities,
      constraints: [con('fix', ['R.center']), con('radius', ['R'], '15')],
    })
    expect(r.ok).toBe(true)
    const a = r.entities[0]
    if (a.type !== 'arc') throw new Error('arc expected')
    expect(a.radius).toBeCloseTo(15, 6)
    const s: Vec2 = [a.center[0] + a.radius * Math.cos(a.startAngle), a.center[1] + a.radius * Math.sin(a.startAngle)]
    const e: Vec2 = [a.center[0] + a.radius * Math.cos(a.endAngle), a.center[1] + a.radius * Math.sin(a.endAngle)]
    expect(dist(s, [17, 3])).toBeLessThan(1e-6)
    expect(dist(e, [2, 18])).toBeLessThan(1e-6)
    expect(a.endAngle - a.startAngle).toBeCloseTo(Math.PI / 2, 6)
  })

  it('diameter dimension on a circle', () => {
    const entities: SketchEntity[] = [{ id: 'C', type: 'circle', construction: false, center: [0, 0], radius: 5 }]
    const r = solveSketch({ entities, constraints: [con('diameter', ['C'], '30')] })
    expect((r.entities[0] as CircleEntity).radius).toBeCloseTo(15, 6)
  })

  it('a line ending tangent on an arc start', () => {
    const entities = [arc('R', [0, 0], 10, 0, Math.PI / 2), line('L', [10, -12], [10.5, -2])]
    const r = solveSketch({
      entities,
      constraints: [con('fix', ['R']), con('tangent', ['L.b', 'R.start'])],
    })
    expect(r.ok).toBe(true)
    const l = lineOf(r.entities, 'L')
    expect(dist(l.b, [10, 0])).toBeLessThan(1e-6)
    expect(Math.abs(l.b[0] - l.a[0])).toBeLessThan(1e-6) // tangent to the circle at (10,0) = vertical
  })

  it('a reference (non-driving) dimension does not constrain', () => {
    const entities = [line('L', [0, 0], [10, 3])]
    const r = solveSketch({ entities, constraints: [{ ...con('length', ['L'], '99'), driving: false }] })
    expect(r.entities[0]).toBe(entities[0])
    expect(r.dof).toBe(4)
  })

  it('reports constraints that cannot be built instead of throwing', () => {
    const entities = [line('L', [0, 0], [10, 3])]
    const bad = con('horizontal', ['ghost'])
    const r = solveSketch({ entities, constraints: [bad] })
    expect(r.invalid[bad.id]).toBeTruthy()
    expect(r.ok).toBe(true)
  })

  it('detects conflicting constraints', () => {
    const entities = [line('L', [0, 0], [10, 0])]
    const cs = [con('horizontal', ['L']), con('length', ['L'], '10'), con('vertical', ['L'])]
    const r = solveSketch({ entities, constraints: cs })
    expect(r.ok).toBe(false)
    expect(r.state).toBe('over')
    expect(r.conflicting.length).toBeGreaterThan(0)
  })
})

describe('M0 sketches', () => {
  it('without constraints solve to exactly the same numbers', () => {
    const entities: SketchEntity[] = [
      line('l', [0.1 + 0.2, 1 / 3], [Math.PI, Math.E]),
      { id: 'c', type: 'circle', construction: false, center: [12.345678901234, -7.1], radius: 3.3333333333333335 },
      arc('a', [1 / 7, 2 / 7], 4.1, 0.3, 2.9),
    ]
    const r = solveSketch({ entities, constraints: [] })
    expect(r.ok).toBe(true)
    expect(r.dof).toBe(4 + 3 + 5)
    expect(r.state).toBe('under')
    r.entities.forEach((e, i) => {
      expect(e).toBe(entities[i])
    })
  })
})

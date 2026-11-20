// Angle between two lines that meet at a corner: measured between the two arms leaving the corner.
import { beforeAll, describe, expect, it } from 'vitest'
import type { Sketch } from '../../doc/types'
import { detectArmStarts } from './arms'
import { measureConstraint } from './measure'
import { solveSketch } from './solver'
import { con, line, lineOf, readySolver } from './testutil'

beforeAll(async () => {
  await readySolver()
})

/** Triangle drawn as a loop: base b (0,0)->(50,0), right side r, left side l back to the start. */
/** A new angle between two lines, with its arms decided now from the corner they form (as the UI does at creation). */
const angleAt = (s: Sketch, refs: string[], value: string) => {
  const arms = detectArmStarts(s, refs[0], refs[1])
  return { ...con('angle', refs, value), ...(arms ? { arms } : {}) }
}

function triangle(apex: [number, number] = [25, 43.3]): Sketch {
  return {
    entities: [line('b', [0, 0], [50, 0]), line('r', [50, 0], apex), line('l', apex, [0, 0])],
    constraints: [
      con('coincident', ['b.b', 'r.a']),
      con('coincident', ['r.b', 'l.a']),
      con('coincident', ['l.b', 'b.a']),
    ],
  }
}

describe('angle at a shared corner', () => {
  it('measures the inside angle, 60, not -120', () => {
    const s = triangle()
    expect(measureConstraint(s, angleAt(s, ['b', 'l'], '1'))).toBeCloseTo(60, 1)
    // The other order is the same angle seen from the other arm: negative (clockwise).
    expect(measureConstraint(s, angleAt(s, ['l', 'b'], '1'))).toBeCloseTo(-60, 1)
    // The base and the right side meet at (50,0); counter-clockwise from the right side to the base is 60.
    expect(measureConstraint(s, angleAt(s, ['r', 'b'], '1'))).toBeCloseTo(60, 1)
  })

  it('lines that are not joined keep their own directions', () => {
    const s: Sketch = { entities: [line('p', [0, 0], [10, 0]), line('q', [20, 0], [20, 10])], constraints: [] }
    expect(measureConstraint(s, angleAt(s, ['p', 'q'], '1'))).toBeCloseTo(90, 6)
  })

  it('an angle of 90 between two joined lines makes them perpendicular and keeps the corner', () => {
    const s: Sketch = {
      entities: [line('L1', [0, 0], [10, 0]), line('L2', [10, 0], [14, 7])],
      constraints: [con('fix', ['L1']), con('coincident', ['L2.a', 'L1.b']), con('angle', ['L1', 'L2'], '90')],
    }
    const r = solveSketch(s)
    expect(r.ok).toBe(true)
    const l1 = lineOf(r.entities, 'L1')
    const l2 = lineOf(r.entities, 'L2')
    expect(l2.a[0]).toBeCloseTo(l1.b[0], 6)
    expect(l2.a[1]).toBeCloseTo(l1.b[1], 6)
    const d1: [number, number] = [l1.a[0] - l1.b[0], l1.a[1] - l1.b[1]]
    const d2: [number, number] = [l2.b[0] - l2.a[0], l2.b[1] - l2.a[1]]
    expect(d1[0] * d2[0] + d1[1] * d2[1]).toBeCloseTo(0, 6)
    const after: Sketch = { entities: r.entities, constraints: s.constraints }
    expect(measureConstraint(after, con('angle', ['L1', 'L2'], '1'))).toBeCloseTo(90, 4)
  })

  it('an inside angle of 60 at the triangle corner is solved as 60', () => {
    const s = triangle([20, 35])
    s.constraints.push(con('fix', ['b']), angleAt(s, ['b', 'l'], '60'))
    const r = solveSketch(s)
    expect(r.ok).toBe(true)
    const after: Sketch = { entities: r.entities, constraints: s.constraints }
    expect(measureConstraint(after, s.constraints[s.constraints.length - 1])).toBeCloseTo(60, 4)
    const l = lineOf(r.entities, 'l')
    expect(l.b[0]).toBeCloseTo(0, 6)
    expect(l.b[1]).toBeCloseTo(0, 6)
    expect(l.a[1]).toBeGreaterThan(0)
  })
})

/** An angle constraint with its arm starts decided at creation. */
const angleCon = (refs: string[], value: string, arms?: ['a' | 'b', 'a' | 'b']) => ({ ...con('angle', refs, value), ...(arms ? { arms } : {}) })

describe('angle arms are decided once, at creation', () => {
  it('joining the lines with a coincident later does not move or mirror them', () => {
    // L1 (0,0)->(10,0), L2 (10,0)->(10,10), not joined: stored arms are each line's own a -> b, angle 90.
    const s: Sketch = {
      entities: [line('L1', [0, 0], [10, 0]), line('L2', [10, 0], [10, 10])],
      constraints: [con('fix', ['L1']), angleCon(['L1', 'L2'], '90', ['a', 'a'])],
    }
    const r0 = solveSketch(s)
    expect(r0.ok).toBe(true)
    s.constraints.push(con('coincident', ['L1.b', 'L2.a']))
    const r = solveSketch(s)
    expect(r.ok).toBe(true)
    const l2 = lineOf(r.entities, 'L2')
    expect(l2.a[0]).toBeCloseTo(10, 4)
    expect(l2.a[1]).toBeCloseTo(0, 4)
    expect(l2.b[0]).toBeCloseTo(10, 4)
    expect(l2.b[1]).toBeCloseTo(10, 4)
  })

  it('deleting the corner coincident of a dimensioned triangle keeps the corner angle and does not collapse it', () => {
    const cBL = con('coincident', ['l.b', 'b.a'])
    // Dimensioned while joined at b.a / l.b: both arms leave the corner (b from a, l from its b end).
    const ang = angleCon(['b', 'l'], '60', ['a', 'b'])
    const s: Sketch = {
      entities: [line('b', [0, 0], [50, 0]), line('r', [50, 0], [25, 43.30127]), line('l', [25, 43.30127], [0, 0])],
      constraints: [con('coincident', ['b.b', 'r.a']), con('coincident', ['r.b', 'l.a']), cBL, con('fix', ['b']), ang],
    }
    expect(solveSketch(s).ok).toBe(true)
    s.constraints = s.constraints.filter((c) => c !== cBL)
    expect(measureConstraint(s, angleCon(['b', 'l'], '1', ['a', 'b']))).toBeCloseTo(60, 1)
    const r = solveSketch(s)
    expect(r.ok).toBe(true)
    const b = lineOf(r.entities, 'b')
    const l = lineOf(r.entities, 'l')
    expect(Math.hypot(l.b[0] - l.a[0], l.b[1] - l.a[1])).toBeGreaterThan(40)
    expect(Math.hypot(b.b[0] - b.a[0], b.b[1] - b.a[1])).toBeCloseTo(50, 4)
    expect(measureConstraint({ entities: r.entities, constraints: s.constraints }, angleCon(['b', 'l'], '1', ['a', 'b']))).toBeCloseTo(60, 3)
  })

  it('a legacy constraint without arms solves as each line a -> b', () => {
    const s: Sketch = {
      entities: [line('L1', [0, 0], [10, 0]), line('L2', [10, 0], [14, 7])],
      constraints: [con('fix', ['L1']), con('coincident', ['L2.a', 'L1.b']), con('angle', ['L1', 'L2'], '90')],
    }
    const r = solveSketch(s)
    expect(r.ok).toBe(true)
    const l1 = lineOf(r.entities, 'L1')
    const l2 = lineOf(r.entities, 'L2')
    const d1: [number, number] = [l1.b[0] - l1.a[0], l1.b[1] - l1.a[1]]
    const d2: [number, number] = [l2.b[0] - l2.a[0], l2.b[1] - l2.a[1]]
    expect(d1[0] * d2[0] + d1[1] * d2[1]).toBeCloseTo(0, 6)
    expect(Math.atan2(d1[0] * d2[1] - d1[1] * d2[0], d1[0] * d2[0] + d1[1] * d2[1])).toBeCloseTo(Math.PI / 2, 5)
    expect(measureConstraint(s, con('angle', ['L1', 'L2'], '1'))).toBeCloseTo(Math.atan2(7, 4) * 180 / Math.PI, 4)
  })

  it('detectArmStarts reads the corner once: joined lines start at the shared end, others at a', () => {
    const joined: Sketch = {
      entities: [line('b', [0, 0], [50, 0]), line('l', [25, 43], [0, 0])],
      constraints: [con('coincident', ['l.b', 'b.a'])],
    }
    expect(detectArmStarts(joined, 'b', 'l')).toEqual(['a', 'b'])
    expect(detectArmStarts({ ...joined, constraints: [] }, 'b', 'l')).toEqual(['a', 'a'])
    expect(detectArmStarts(joined, 'b', 'xAxis')).toBeNull()
  })
})

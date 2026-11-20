import { beforeAll, describe, expect, it } from 'vitest'
import type { Sketch } from '../../doc/types'
import { entityStates } from './defined'
import { solveSketch } from './solver'
import { con, lineOf, readySolver, rectSketch } from './testutil'
import { evalValue } from './value'

beforeAll(async () => {
  await readySolver()
})

describe('evalValue', () => {
  it('keeps reading plain numbers with no scope', () => {
    expect(evalValue('40')).toBe(40)
    expect(evalValue('  2.5 ')).toBe(2.5)
    expect(evalValue(undefined)).toBeNaN()
    expect(evalValue('')).toBeNaN()
    expect(evalValue('abc')).toBeNaN()
  })
  it('evaluates expressions with a scope', () => {
    expect(evalValue('w * 2', new Map([['w', 15]]))).toBe(30)
    expect(evalValue('w * 2')).toBeNaN()
    expect(evalValue('1 in')).toBeCloseTo(25.4, 12)
  })
})

describe('solving with variables', () => {
  const base = rectSketch()
  const sketch = (value: string): Sketch => ({
    ...base,
    constraints: [...base.constraints, con('length', ['r0'], value), con('length', ['r1'], '30'), con('coincident', ['r0.a', 'origin'])],
  })

  it('a length dimension "w * 2" with w = 15 makes a line of length 30', () => {
    const r = solveSketch(sketch('w * 2'), { scope: new Map([['w', 15]]) })
    expect(r.ok).toBe(true)
    const bottom = lineOf(r.entities, 'r0')
    expect(Math.hypot(bottom.b[0] - bottom.a[0], bottom.b[1] - bottom.a[1])).toBeCloseTo(30, 6)
    expect(r.dof).toBe(0)
  })
  it('follows the scope when it changes', () => {
    const r = solveSketch(sketch('w * 2'), { scope: new Map([['w', 25]]) })
    expect(lineOf(r.entities, 'r0').b[0]).toBeCloseTo(50, 6)
  })
  it('reports an unknown name as an invalid constraint instead of throwing', () => {
    const s = sketch('w * 2')
    const r = solveSketch(s)
    expect(Object.keys(r.invalid)).toContain(s.constraints[s.constraints.length - 3].id)
  })
  it('entityStates takes the scope too', () => {
    const s = sketch('w * 2')
    const states = entityStates(s, new Map([['w', 15]]))
    expect(Object.values(states)).toEqual(['full', 'full', 'full', 'full'])
  })
})

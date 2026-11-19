import { describe, expect, it } from 'vitest'
import type { ArcEntity, CircleEntity, LineEntity, Sketch } from '../doc/types'
import { dimensionFor, orderRefs, pickRef, refsOfSelection, selectionRef, toggleRef, wholeEntityIds } from './pick'

const line = (id: string, a: [number, number], b: [number, number]): LineEntity => ({ id, type: 'line', construction: false, a, b })
const circle: CircleEntity = { id: 'c1', type: 'circle', construction: false, center: [50, 50], radius: 10 }
const arc: ArcEntity = { id: 'a1', type: 'arc', construction: false, center: [0, 30], radius: 10, startAngle: 0, endAngle: Math.PI }
const sketch: Sketch = {
  entities: [line('l1', [10, 0], [40, 0]), line('l2', [40, 0], [40, 20]), circle, arc],
  constraints: [],
}

describe('pickRef', () => {
  it('picks an end point within the radius', () => {
    expect(pickRef(sketch, [10.5, 0.3], 1)).toBe('l1.a')
    expect(pickRef(sketch, [40.2, 20], 1)).toBe('l2.b')
  })
  it('picks centres and arc ends', () => {
    expect(pickRef(sketch, [50, 50.4], 1)).toBe('c1.center')
    expect(pickRef(sketch, [10, 30.2], 1)).toBe('a1.start')
    expect(pickRef(sketch, [-10, 30], 1)).toBe('a1.end')
  })
  it('picks the origin', () => {
    expect(pickRef(sketch, [0.3, -0.2], 1)).toBe('origin')
  })
  it('falls back to the whole entity along its length', () => {
    expect(pickRef(sketch, [25, 0.4], 1)).toBe('l1')
    expect(pickRef(sketch, [60.2, 50], 1)).toBe('c1')
    expect(pickRef(sketch, [0, 40.3], 1)).toBe('a1')
  })
  it('picks nothing in empty space, and not the missing half of an arc', () => {
    expect(pickRef(sketch, [100, 100], 1)).toBeNull()
    expect(pickRef(sketch, [0, 19.8], 1)).toBeNull()
  })
  it('an entity point beats the origin when both are as near', () => {
    const s: Sketch = { entities: [line('l1', [0, 0], [10, 0])], constraints: [] }
    expect(pickRef(s, [0, 0], 1)).toBe('l1.a')
  })
})

describe('selection refs', () => {
  it('round-trips through the store format and ignores other sketches', () => {
    const sel = [selectionRef('s1', 'l1'), selectionRef('s1', 'l2.b'), selectionRef('s2', 'x'), selectionRef('s1', 'origin')]
    expect(refsOfSelection(sel, 's1')).toEqual(['l1', 'l2.b', 'origin'])
    expect(refsOfSelection([{ kind: 'body', name: 's1/l9' }], 's1')).toEqual([])
  })
  it('lists whole entities only', () => {
    expect(wholeEntityIds(['l1', 'l2.b', 'origin', 'c1'])).toEqual(['l1', 'c1'])
  })
  it('toggles', () => {
    expect(toggleRef(['a'], 'b')).toEqual(['a', 'b'])
    expect(toggleRef(['a', 'b'], 'a')).toEqual(['b'])
  })
})

describe('dimensionFor (the D key)', () => {
  it('one item', () => {
    expect(dimensionFor(['l1'], sketch)).toBe('length')
    expect(dimensionFor(['c1'], sketch)).toBe('diameter')
    expect(dimensionFor(['a1'], sketch)).toBe('radius')
  })
  it('two points', () => {
    expect(dimensionFor(['l1.a', 'l1.b'], sketch)).toBe('distance')
    expect(dimensionFor(['origin', 'l1.a'], sketch)).toBe('distance')
  })
  it('two lines', () => {
    expect(dimensionFor(['l1', 'l2'], sketch)).toBe('angle')
  })
  it('a point and a line, either order', () => {
    expect(dimensionFor(['l2.b', 'l1'], sketch)).toBe('pointLineDistance')
    expect(dimensionFor(['l1', 'l2.b'], sketch)).toBe('pointLineDistance')
  })
  it('nothing for selections with no natural dimension', () => {
    expect(dimensionFor([], sketch)).toBeNull()
    expect(dimensionFor(['l1.a'], sketch)).toBeNull()
    expect(dimensionFor(['c1', 'a1'], sketch)).toBeNull()
    expect(dimensionFor(['l1', 'l2', 'c1'], sketch)).toBeNull()
    expect(dimensionFor(['xAxis'], sketch)).toBeNull()
    expect(dimensionFor(['gone'], sketch)).toBeNull()
  })
})

describe('orderRefs', () => {
  it('puts points first', () => {
    expect(orderRefs(['l1', 'l2.b'], sketch)).toEqual(['l2.b', 'l1'])
    expect(orderRefs(['c1', 'a1'], sketch)).toEqual(['c1', 'a1'])
  })
})

import { describe, expect, it } from 'vitest'
import { emptyDocument } from './types'
import type { ExtrudeFeature, PlaneFeature, SketchFeature, TransformFeature, Variable } from './types'
import { RESERVED, evalField, evaluateVariables, exprFields, usesOf, validateVariableName } from './variables'

const v = (id: string, name: string, expression: string): Variable => ({ id, name, expression })

describe('validateVariableName', () => {
  const existing = [v('1', 'width', '10')]
  it('accepts normal names', () => {
    expect(validateVariableName('height', existing)).toEqual({ ok: true })
    expect(validateVariableName('_a1', existing)).toEqual({ ok: true })
  })
  it('refuses bad names with a plain message', () => {
    for (const bad of ['', '  ', '1a', 'a b', 'a-b', 'width', 'pi', 'sqrt', 'mm', 'deg', 'in', 'max']) {
      const r = validateVariableName(bad, existing)
      expect(r.ok, bad).toBe(false)
      if (!r.ok) expect(r.message.endsWith('.')).toBe(true)
    }
  })
  it('lets a variable keep its own name', () => {
    expect(validateVariableName('width', existing, '1')).toEqual({ ok: true })
  })
  it('reserves functions, constants and units', () => {
    for (const n of ['sqrt', 'pi', 'mm', 'cm', 'm', 'in', 'ft', 'deg', 'sin', 'atan']) expect(RESERVED.has(n)).toBe(true)
  })
})

describe('evaluateVariables', () => {
  it('evaluates in dependency order whatever the list order', () => {
    const r = evaluateVariables([v('1', 'c', 'b * 2'), v('2', 'b', 'a + 1'), v('3', 'a', '4')])
    expect(r.errors.size).toBe(0)
    expect(r.values.get('a')).toBe(4)
    expect(r.values.get('b')).toBe(5)
    expect(r.values.get('c')).toBe(10)
  })
  it('names the cycle', () => {
    const r = evaluateVariables([v('1', 'a', 'b'), v('2', 'b', 'a'), v('3', 'c', 'a + 1'), v('4', 'ok', '3')])
    expect(r.errors.get('1')).toMatch(/a → b → a/)
    expect(r.errors.get('2')).toMatch(/→/)
    expect(r.errors.get('3')).toBe('Depends on a variable that has an error.')
    expect(r.errors.has('4')).toBe(false)
    expect(r.values.has('a')).toBe(false)
    expect(r.values.get('ok')).toBe(3)
  })
  it('catches a variable that uses itself', () => {
    const r = evaluateVariables([v('1', 'a', 'a + 1')])
    expect(r.errors.get('1')).toMatch(/a → a/)
  })
  it('reports unknown names, division by zero and syntax', () => {
    const r = evaluateVariables([v('1', 'a', 'widht'), v('2', 'b', '1/0'), v('3', 'c', '2 +'), v('4', 'd', 'b + 1')])
    expect(r.errors.get('1')).toBe('There is no variable called widht.')
    expect(r.errors.get('2')).toBe('Cannot divide by zero.')
    expect(r.errors.get('3')).toMatch(/\.$/)
    expect(r.errors.get('4')).toBe('Depends on a variable that has an error.')
  })
  it('flags duplicate and invalid names', () => {
    const r = evaluateVariables([v('1', 'a', '1'), v('2', 'a', '2'), v('3', 'sqrt', '3')])
    expect(r.values.get('a')).toBe(1)
    expect(r.errors.has('2')).toBe(true)
    expect(r.errors.has('3')).toBe(true)
  })
  it('knows which names are broken', () => {
    const r = evaluateVariables([v('1', 'a', '1/0')])
    expect(r.errorNames.get('a')).toBe('Cannot divide by zero.')
  })
})

describe('evalField', () => {
  it('uses the values and explains broken variables', () => {
    const ev = evaluateVariables([v('1', 'w', '15'), v('2', 'bad', '1/0')])
    expect(evalField('w * 2', ev)).toEqual({ ok: true, value: 30 })
    const r = evalField('bad + 1', ev)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.message).toMatch(/bad/)
    const u = evalField('widht', ev)
    expect(u.ok === false && u.message).toBe('There is no variable called widht.')
  })
})

const extrude = (id: string, name: string, distance: string): ExtrudeFeature => ({
  id,
  name,
  suppressed: false,
  type: 'extrude',
  params: { profiles: [], distance, direction: 1, mode: 'new', targets: [] },
})

describe('exprFields', () => {
  it('lists every Expr field with a label and can write it back', () => {
    const t: TransformFeature = {
      id: 't',
      name: 'Move 1',
      suppressed: false,
      type: 'transform',
      params: { bodies: [], translate: ['1', 'a', '3'], rotate: { axis: [0, 0, 1], pivot: [0, 0, 0], angle: '45' }, copy: false },
    }
    const fields = exprFields(t)
    expect(fields.map((f) => f.label)).toEqual(['Move X', 'Move Y', 'Move Z', 'Rotation angle'])
    expect(fields.map((f) => f.kind)).toEqual(['length', 'length', 'length', 'angle'])
    fields[1].set('b')
    expect(t.params.translate[1]).toBe('b')
    const p: PlaneFeature = {
      id: 'p',
      name: 'Plane 1',
      suppressed: false,
      type: 'plane',
      params: { base: { kind: 'originPlane', name: 'XY' }, offset: '5', angle: '10' },
    }
    expect(exprFields(p).map((f) => f.label)).toEqual(['Offset', 'Angle'])
    expect(exprFields(extrude('e', 'E', '3')).map((f) => f.label)).toEqual(['Distance'])
  })
})

describe('usesOf', () => {
  it('finds variables, feature fields and sketch dimensions', () => {
    const doc = emptyDocument()
    doc.variables = [v('1', 'w', '10'), v('2', 'w2', 'w * 2')]
    const sk: SketchFeature = {
      id: 's',
      name: 'Sketch 1',
      suppressed: false,
      type: 'sketch',
      params: { on: { kind: 'originPlane', name: 'XY' } },
      sketch: {
        entities: [],
        constraints: [
          { id: 'c1', type: 'length', entityIds: ['l'], value: 'w * 2', driving: true },
          { id: 'c2', type: 'length', entityIds: ['m'], value: '5', driving: true },
        ],
      },
    }
    doc.features = [sk, extrude('e', 'Extrude 1', 'w / 2')]
    const uses = usesOf(doc, 'w')
    expect(uses.map((u) => u.kind).sort()).toEqual(['feature', 'sketch', 'variable'])
    expect(uses.find((u) => u.kind === 'feature')!.label).toBe('Extrude 1 (Distance)')
    expect(uses.find((u) => u.kind === 'sketch')!.label).toContain('Sketch 1')
    expect(uses.find((u) => u.kind === 'variable')!.label).toBe('w2')
    expect(usesOf(doc, 'zzz')).toEqual([])
  })
})

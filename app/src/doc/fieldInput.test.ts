import { describe, expect, it } from 'vitest'
import { applySuggestion, checkFieldText, evalStored, suggestNames, valueText } from './fieldInput'

const scope = new Map([['w', 15], ['width', 40]])
const names = [{ name: 'w' }, { name: 'width' }, { name: 'depth' }]

describe('checkFieldText', () => {
  it('stores a plain number as mm and gives no expression', () => {
    expect(checkFieldText('2', 'in', { kind: 'length', positive: true }, scope)).toEqual({
      ok: true, expr: '50.8', value: 50.8, isExpression: false, preview: '2 in',
    })
  })
  it('previews an expression in the display unit', () => {
    const r = checkFieldText('w * 2', 'mm', { kind: 'length', positive: true }, scope)
    expect(r).toEqual({ ok: true, expr: 'w * 2', value: 30, isExpression: true, preview: '30 mm' })
    const inch = checkFieldText('1 in + 5', 'mm', { kind: 'length' }, scope)
    expect(inch.ok && inch.preview).toBe('30.4 mm')
    const angle = checkFieldText('90 deg / 2', 'mm', { kind: 'angle' }, scope)
    expect(angle.ok && angle.preview).toBe('45°')
  })
  it('refuses unknown names with the engine message', () => {
    expect(checkFieldText('widht', 'mm', { kind: 'length' }, scope)).toEqual({ ok: false, message: 'There is no variable called widht.' })
  })
  it('applies the rule to plain numbers and to expressions', () => {
    expect(checkFieldText('0', 'mm', { kind: 'length', positive: true }, scope)).toEqual({ ok: false, message: 'Enter a number above zero.' })
    expect(checkFieldText('w - 15', 'mm', { kind: 'length', positive: true }, scope)).toEqual({ ok: false, message: 'The result must be above zero.' })
    expect(checkFieldText('-5', 'mm', { kind: 'length' }, scope).ok).toBe(true)
    expect(checkFieldText('361', 'mm', { kind: 'angle', upTo360: true }, scope)).toEqual({ ok: false, message: 'Enter an angle between 0 and 360.' })
    expect(checkFieldText('w * 30', 'mm', { kind: 'angle', upTo360: true }, scope).ok).toBe(false)
  })
  it('refuses units of the wrong kind', () => {
    const a = checkFieldText('45 deg', 'mm', { kind: 'length', positive: true }, scope)
    expect(a.ok).toBe(false)
    if (!a.ok) expect(a.message).toMatch(/angle/i)
    const b = checkFieldText('45°', 'mm', { kind: 'length', positive: true }, scope)
    expect(b.ok).toBe(false)
    if (!b.ok) expect(b.message).toMatch(/angle/i)
    const c = checkFieldText('5 in', 'mm', { kind: 'angle', upTo360: true }, scope)
    expect(c.ok).toBe(false)
    if (!c.ok) expect(c.message).toMatch(/length/i)
  })
})

describe('evalStored', () => {
  it('evaluates numbers and expressions, and gives null otherwise', () => {
    expect(evalStored('12.5', scope)).toBe(12.5)
    expect(evalStored('w * 2', scope)).toBe(30)
    expect(evalStored('nope', scope)).toBeNull()
    expect(evalStored('', scope)).toBeNull()
    expect(evalStored(undefined, scope)).toBeNull()
  })
})

describe('valueText', () => {
  it('uses the display unit', () => {
    expect(valueText(25.4, 'in', 'length')).toBe('1 in')
    expect(valueText(45, 'in', 'angle')).toBe('45°')
  })
})

describe('suggestNames', () => {
  it('offers names that start with the word at the caret', () => {
    const s = suggestNames('de', 2, names)
    expect(s?.items.map((i) => i.name)).toEqual(['depth'])
    expect(suggestNames('wi', 2, names)?.items.map((i) => i.name)).toEqual(['width'])
    expect(suggestNames('W', 1, names)?.items.map((i) => i.name)).toEqual(['w', 'width'])
  })
  it('offers nothing for an empty word, a finished name, a unit or no match', () => {
    expect(suggestNames('', 0, names)).toBeNull()
    expect(suggestNames('2 + ', 4, names)).toBeNull()
    expect(suggestNames('w', 1, names)).toBeNull()
    expect(suggestNames('5mm', 3, names)).toBeNull()
    expect(suggestNames('2.5in', 5, names)).toBeNull()
    expect(suggestNames('zz', 2, names)).toBeNull()
  })
  it('finds the word inside an expression and replaces the whole word', () => {
    const text = '2 * wi + 3'
    const s = suggestNames(text, 6, names)!
    expect(applySuggestion(text, s, 'width')).toEqual({ text: '2 * width + 3', caret: 9 })
    const mid = suggestNames('wi', 1, [{ name: 'width' }])!
    expect(applySuggestion('wi', mid, 'width').text).toBe('width') // the caret sits inside the word
  })
})

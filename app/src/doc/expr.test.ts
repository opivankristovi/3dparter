import { describe, expect, it } from 'vitest'
import { evalExpr, isNumberLiteral, namesIn, parseExpr, renameIn } from './expr'

const scope = (o: Record<string, number> = {}) => new Map(Object.entries(o))
const val = (t: string, o: Record<string, number> = {}) => {
  const r = evalExpr(t, scope(o))
  if (!r.ok) throw new Error(`${t}: ${r.message}`)
  return r.value
}
const err = (t: string, o: Record<string, number> = {}) => {
  const r = evalExpr(t, scope(o))
  if (r.ok) throw new Error(`${t} evaluated to ${r.value}`)
  return r.message
}

describe('numbers and operators', () => {
  it('reads plain numbers', () => {
    expect(val('12')).toBe(12)
    expect(val('1.5')).toBe(1.5)
    expect(val('.5')).toBe(0.5)
    expect(val('1e3')).toBe(1000)
    expect(val('2.5E-1')).toBe(0.25)
    expect(val('  7  ')).toBe(7)
  })
  it('has the usual precedence', () => {
    expect(val('2 + 3 * 4')).toBe(14)
    expect(val('(2 + 3) * 4')).toBe(20)
    expect(val('10 - 4 - 3')).toBe(3)
    expect(val('100 / 10 / 5')).toBe(2)
  })
  it('makes power right-associative and lower than unary on its left', () => {
    expect(val('2 ^ 3 ^ 2')).toBe(512)
    expect(val('-2 ^ 2')).toBe(-4)
    expect(val('2 ^ -1')).toBe(0.5)
  })
  it('has unary minus and plus', () => {
    expect(val('-5')).toBe(-5)
    expect(val('+5')).toBe(5)
    expect(val('--5')).toBe(5)
    expect(val('3 - -2')).toBe(5)
  })
})

describe('variables, constants and functions', () => {
  it('looks variables up', () => {
    expect(val('w * 2', { w: 15 })).toBe(30)
    expect(val('_a1 + b_2', { _a1: 1, b_2: 2 })).toBe(3)
  })
  it('knows pi', () => {
    expect(val('pi')).toBeCloseTo(Math.PI, 12)
  })
  it('has the listed functions', () => {
    expect(val('sqrt(16)')).toBe(4)
    expect(val('abs(-3)')).toBe(3)
    expect(val('min(4, 2, 9)')).toBe(2)
    expect(val('max(4, 2, 9)')).toBe(9)
    expect(val('round(2.5)')).toBe(3)
    expect(val('floor(2.9)')).toBe(2)
    expect(val('ceil(2.1)')).toBe(3)
  })
  it('does trigonometry in degrees', () => {
    expect(val('sin(30)')).toBeCloseTo(0.5, 12)
    expect(val('cos(60)')).toBeCloseTo(0.5, 12)
    expect(val('tan(45)')).toBeCloseTo(1, 12)
    expect(val('sin(180)')).toBe(0)
    expect(val('cos(90)')).toBe(0)
    expect(val('asin(1)')).toBeCloseTo(90, 9)
    expect(val('acos(0)')).toBeCloseTo(90, 9)
    expect(val('atan(1)')).toBeCloseTo(45, 9)
  })
})

describe('units', () => {
  it('converts length suffixes to mm', () => {
    expect(val('2 cm')).toBe(20)
    expect(val('2cm')).toBe(20)
    expect(val('1 m')).toBe(1000)
    expect(val('1 in')).toBeCloseTo(25.4, 12)
    expect(val('2 ft')).toBeCloseTo(609.6, 9)
    expect(val('5 mm')).toBe(5)
    expect(val('1 in + 5')).toBeCloseTo(30.4, 12)
    expect(val('3 mm * 2')).toBe(6)
  })
  it('keeps degrees as they are', () => {
    expect(val('45 deg')).toBe(45)
    expect(val('45°')).toBe(45)
    expect(val('45 °')).toBe(45)
  })
  it('says where a unit does not belong', () => {
    expect(err('w mm', { w: 1 })).toMatch(/unit/i)
  })
})

describe('errors', () => {
  it('names an unknown variable', () => {
    expect(err('widht * 2', { width: 1 })).toBe('There is no variable called widht.')
  })
  it('reports division by zero', () => {
    expect(err('1 / 0')).toBe('Cannot divide by zero.')
    expect(err('5 / (2 - 2)')).toBe('Cannot divide by zero.')
  })
  it('reports syntax errors with a hint of where', () => {
    for (const t of ['2 +', '(2 + 3', '2 + 3)', '* 4', '2 3', '2 $ 3', 'sqrt(', '1,2']) {
      const m = err(t)
      expect(m.endsWith('.')).toBe(true)
      expect(m.length).toBeGreaterThan(8)
    }
    expect(err('2 + ')).toMatch(/end|after/i)
    expect(err('(2 + 3')).toMatch(/closing|\)/i)
    expect(err('2 $ 3')).toMatch(/\$/)
  })
  it('reports an empty field', () => {
    expect(err('')).toBe('Enter a value.')
    expect(err('   ')).toBe('Enter a value.')
  })
  it('reports results that are not numbers', () => {
    expect(err('sqrt(-1)')).toMatch(/sqrt/)
    expect(err('10 ^ 1000')).toMatch(/too large|number/i)
    expect(err('tan(90)')).toMatch(/tan/)
  })
  it('checks argument counts and unknown functions', () => {
    expect(err('sqrt(1, 2)')).toBe('sqrt takes 1 value.')
    expect(err('sqrt()')).toBe('sqrt takes 1 value.')
    expect(err('min(1)')).toBe('min needs at least 2 values.')
    expect(err('foo(1)')).toBe('There is no function called foo.')
    expect(err('sqrt')).toMatch(/function/)
  })
  it('never throws, whatever the input', () => {
    for (const t of ['((((', '))))', '1e', '1e+', '..', '\u0000', 'a.b', '5 mm mm', '2 ^', '-', 'pi(2)', '🙂']) {
      expect(() => evalExpr(t, scope())).not.toThrow()
      expect(evalExpr(t, scope()).ok).toBe(false)
    }
    expect(parseExpr('2 +').ok).toBe(false)
    expect(parseExpr('2 + 3').ok).toBe(true)
  })
})

describe('namesIn, renameIn, isNumberLiteral', () => {
  it('lists variable names once, in order, without functions, pi or units', () => {
    expect(namesIn('w * 2 + min(h, w) + pi + 3 mm')).toEqual(['w', 'h'])
    expect(namesIn('sqrt(a^2 + b^2)')).toEqual(['a', 'b'])
    expect(namesIn('40')).toEqual([])
    expect(namesIn('widht +')).toEqual(['widht'])
  })
  it('renames whole names only and keeps formatting', () => {
    expect(renameIn('w*2 +  w', 'w', 'width')).toBe('width*2 +  width')
    expect(renameIn('w2 + w + ww + min(w, 3)', 'w', 'x')).toBe('w2 + x + ww + min(x, 3)')
    expect(renameIn('  40  ', 'w', 'x')).toBe('  40  ')
    expect(renameIn('sqrt(w) mm', 'w', 'x')).toBe('sqrt(x) mm')
  })
  it('does not rename a function with the same spelling', () => {
    expect(renameIn('min(min, 3)', 'min', 'k')).toBe('min(k, 3)')
  })
  it('recognises plain number literals', () => {
    for (const t of ['12', '-1.5', '.5', '+3', '1e3', ' 7 ', '2.']) expect(isNumberLiteral(t)).toBe(true)
    for (const t of ['', 'w', '2 mm', '1+2', '(3)', '--3', '1e']) expect(isNumberLiteral(t)).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import { formatDisplay, fromDisplay, parseDisplay, toDisplay, toExpr } from './units'

describe('units', () => {
  it('converts to and from every display unit', () => {
    expect(toDisplay(25.4, 'in')).toBeCloseTo(1, 10)
    expect(fromDisplay(1, 'in')).toBeCloseTo(25.4, 10)
    expect(toDisplay(100, 'cm')).toBe(10)
    expect(fromDisplay(2, 'm')).toBe(2000)
    expect(fromDisplay(1, 'ft')).toBeCloseTo(304.8, 10)
    expect(toDisplay(10, 'mm')).toBe(10)
  })

  it('round-trips', () => {
    for (const u of ['mm', 'cm', 'm', 'in', 'ft'] as const) {
      expect(fromDisplay(toDisplay(123.456, u), u)).toBeCloseTo(123.456, 9)
    }
  })

  it('formats without float noise', () => {
    expect(formatDisplay(25.4, 'in')).toBe('1')
    expect(formatDisplay(10, 'mm')).toBe('10')
    expect(formatDisplay(1 / 3, 'mm')).toBe('0.333')
  })

  it('parses plain numbers only', () => {
    expect(parseDisplay('2', 'in')).toBeCloseTo(50.8, 10)
    expect(parseDisplay(' .5 ', 'mm')).toBe(0.5)
    expect(parseDisplay('width/2', 'mm')).toBeNull()
    expect(parseDisplay('', 'mm')).toBeNull()
  })

  it('writes expressions as short text', () => {
    expect(toExpr(10)).toBe('10')
    expect(toExpr(0.1 + 0.2)).toBe('0.3')
  })
})

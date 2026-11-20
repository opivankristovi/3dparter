import { describe, expect, it } from 'vitest'
import { exprToFieldText, fieldTextToExpr } from './fieldText'

const scope = new Map([['w', 15]])

describe('fieldTextToExpr', () => {
  it('converts a plain number from the display unit to an mm literal', () => {
    expect(fieldTextToExpr('2', 'in', 'length', scope)).toEqual({ ok: true, expr: '50.8', value: 50.8 })
    expect(fieldTextToExpr('40', 'mm', 'length', scope)).toEqual({ ok: true, expr: '40', value: 40 })
    expect(fieldTextToExpr(' 1.5 ', 'cm', 'length', scope)).toEqual({ ok: true, expr: '15', value: 15 })
  })
  it('does not convert angles', () => {
    expect(fieldTextToExpr('45', 'in', 'angle', scope)).toEqual({ ok: true, expr: '45', value: 45 })
  })
  it('keeps an expression as typed, with bare numbers meaning mm', () => {
    expect(fieldTextToExpr('w * 2', 'in', 'length', scope)).toEqual({ ok: true, expr: 'w * 2', value: 30 })
    expect(fieldTextToExpr('2 + 3', 'in', 'length', scope)).toEqual({ ok: true, expr: '2 + 3', value: 5 })
    expect(fieldTextToExpr('1 in', 'mm', 'length', scope)).toMatchObject({ ok: true, expr: '1 in' })
    expect(fieldTextToExpr('90 deg', 'mm', 'angle', scope)).toEqual({ ok: true, expr: '90 deg', value: 90 })
  })
  it('explains what is wrong', () => {
    const a = fieldTextToExpr('widht', 'mm', 'length', scope)
    expect(a).toEqual({ ok: false, message: 'There is no variable called widht.' })
    expect(fieldTextToExpr('', 'mm', 'length', scope)).toEqual({ ok: false, message: 'Enter a value.' })
    expect(fieldTextToExpr('1/0', 'mm', 'length', scope).ok).toBe(false)
  })
})

describe('exprToFieldText', () => {
  it('shows a plain mm literal in the display unit', () => {
    expect(exprToFieldText('50.8', 'in')).toBe('2')
    expect(exprToFieldText('40', 'mm')).toBe('40')
    expect(exprToFieldText('15', 'cm')).toBe('1.5')
  })
  it('shows an expression as typed', () => {
    expect(exprToFieldText('w * 2', 'in')).toBe('w * 2')
    expect(exprToFieldText('2 + 3', 'in')).toBe('2 + 3')
  })
  it('shows angles untouched', () => {
    expect(exprToFieldText('45', 'in', 'angle')).toBe('45')
  })
  it('round-trips plain numbers', () => {
    const r = fieldTextToExpr('3.25', 'in', 'length', scope)
    expect(r.ok && exprToFieldText(r.expr, 'in')).toBe('3.25')
  })
})

// Field text <-> stored expression, for every number field that accepts expressions.
//
// THE UNITS RULE
//   * Stored expressions are in mm (lengths) and degrees (angles).
//   * A field that holds only a plain number is typed in the DISPLAY unit: "2" in an inch document is stored
//     as the literal "50.8" (this is what the app always did). It is shown again as "2".
//   * Anything else is an expression and is stored exactly as typed. A bare number inside an expression
//     means mm (or degrees), whatever the display unit: "2 + 3" is 5 mm. Add a suffix for another unit:
//     "2 in + 3 mm". Variables hold mm or degrees too. See the header of expr.ts.
import { evalExpr, isNumberLiteral } from './expr'
import type { Scope } from './expr'
import { useProjectStore } from './store'
import type { DisplayUnit } from './types'
import { formatDisplay, fromDisplay, toExpr } from './units'
import { scopeOf } from './variables'

export type FieldKind = 'length' | 'angle'
export type FieldTextResult = { ok: true; expr: string; value: number } | { ok: false; message: string }

/**
 * Turns what the user typed into the text to store, and its value in mm or degrees.
 * `scope` defaults to the open document's variables; pass one to evaluate against something else.
 * On failure the message is ready to show under the field. Store `expr` only when `ok`.
 */
export function fieldTextToExpr(text: string, displayUnit: DisplayUnit, kind: FieldKind, scope?: Scope): FieldTextResult {
  const t = text.trim()
  if (t === '') return { ok: false, message: 'Enter a value.' }
  if (isNumberLiteral(t)) {
    const n = parseFloat(t)
    const mm = kind === 'angle' ? n : fromDisplay(n, displayUnit)
    const expr = toExpr(mm)
    return { ok: true, expr, value: Number(expr) }
  }
  const r = evalExpr(t, scope ?? scopeOf(useProjectStore.getState().doc), kind)
  return r.ok ? { ok: true, expr: t, value: r.value } : { ok: false, message: r.message }
}

/** The text to show in a field for a stored expression: a plain mm literal in the display unit, else as typed. */
export function exprToFieldText(expr: string, displayUnit: DisplayUnit, kind: FieldKind = 'length'): string {
  if (!isNumberLiteral(expr)) return expr
  const n = Number(expr)
  if (kind === 'angle') return String(Number(n.toFixed(3)))
  return formatDisplay(n, displayUnit)
}

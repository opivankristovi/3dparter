// The one place a dimension's text becomes a number. Expressions and variables plug in here later.
import type { Expr } from '../../doc/types'

/** Value of a dimension in its stored unit (mm, or degrees for angles). NaN when it is not a number. */
export function evalValue(expr: Expr | undefined): number {
  if (expr === undefined) return NaN
  const t = expr.trim()
  if (t === '') return NaN
  return Number(t)
}

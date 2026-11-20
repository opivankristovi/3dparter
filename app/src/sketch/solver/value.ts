// The one place a dimension's text becomes a number: a plain number or an expression that may use variables.
import { evalExpr } from '../../doc/expr'
import type { Scope } from '../../doc/expr'
import type { Expr } from '../../doc/types'

export type { Scope }
/** The default scope is empty: no variables. */
const NO_VARIABLES: Scope = new Map()

/**
 * Value of a dimension in its stored unit (mm, or degrees for angles). NaN when it is not a number
 * (empty, a syntax error, an unknown name). `scope` holds the document's variable values.
 */
export function evalValue(expr: Expr | undefined, scope: Scope = NO_VARIABLES): number {
  if (expr === undefined) return NaN
  const r = evalExpr(expr, scope)
  return r.ok ? r.value : NaN
}

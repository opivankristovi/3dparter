// The pure side of an expression-aware number field: checking what was typed against the field's rule,
// the "= 25 mm" preview, evaluating a stored expression for a drag handle, and the name suggestions.
import type { Scope } from './expr'
import { evalExpr, isNumberLiteral } from './expr'
import { fieldTextToExpr } from './fieldText'
import type { FieldKind } from './fieldText'
import { useProjectStore } from './store'
import type { DisplayUnit } from './types'
import { formatDisplay } from './units'
import { scopeOf } from './variables'

/** What a field accepts besides "a number or an expression". */
export interface FieldRule {
  kind: FieldKind
  /** The value must be above zero. */
  positive?: boolean
  /** An angle field that takes 0 < angle <= 360. */
  upTo360?: boolean
}

export type FieldCheck =
  | { ok: true; expr: string; value: number; isExpression: boolean; preview: string }
  | { ok: false; message: string }

/** A value as shown next to a field: "25 mm", "0.984 in", "45°". */
export function valueText(value: number, units: DisplayUnit, kind: FieldKind): string {
  return kind === 'angle' ? `${Number(value.toFixed(3))}°` : `${formatDisplay(value, units)} ${units}`
}

/** What to say when the field is empty. */
function emptyMessage(rule: FieldRule): string {
  if (rule.upTo360) return 'Enter an angle between 0 and 360.'
  return rule.positive ? 'Enter a number above zero.' : 'Enter a number.'
}

/** The message for a value that is outside the field's rule, or null when it is fine. */
function ruleMessage(value: number, rule: FieldRule, plain: boolean): string | null {
  if (!Number.isFinite(value)) return 'This is not a number.'
  if (rule.upTo360 && (value <= 0 || value > 360)) {
    return plain ? 'Enter an angle between 0 and 360.' : 'The result must be an angle between 0 and 360.'
  }
  if (rule.positive && value <= 0) return plain ? 'Enter a number above zero.' : 'The result must be above zero.'
  return null
}

/**
 * Checks field text. On success: the text to store, its value (mm or degrees), whether it is an expression
 * and the preview text. On failure: a plain message for under the field.
 */
export function checkFieldText(text: string, units: DisplayUnit, rule: FieldRule, scope?: Scope): FieldCheck {
  if (text.trim() === '') return { ok: false, message: emptyMessage(rule) }
  const r = fieldTextToExpr(text, units, rule.kind, scope)
  if (!r.ok) return { ok: false, message: r.message }
  const isExpression = !isNumberLiteral(text.trim())
  const bad = ruleMessage(r.value, rule, !isExpression)
  if (bad) return { ok: false, message: bad }
  return { ok: true, expr: r.expr, value: r.value, isExpression, preview: valueText(r.value, units, rule.kind) }
}

/** The value of a stored expression against the open document's variables, or null when it has none. */
export function evalStored(expr: string | undefined, scope?: Scope): number | null {
  if (expr === undefined || expr.trim() === '') return null
  const r = evalExpr(expr, scope ?? scopeOf(useProjectStore.getState().doc))
  return r.ok && Number.isFinite(r.value) ? r.value : null
}

// ---- name suggestions ------------------------------------------------------------------------------

export interface Candidate {
  name: string
  /** Shown beside the name, e.g. "40 mm". */
  detail?: string
}

export interface Suggestions {
  /** The part of the text the chosen name replaces: [from, to). */
  from: number
  to: number
  items: Candidate[]
}

const NAME_START = /[A-Za-z_][A-Za-z0-9_]*$/

/**
 * Variables whose name starts with the word that ends at the caret. Nothing is offered when the word is
 * a unit suffix (it follows a number: "5 m"), when it is empty, or when it already is a name in full.
 */
export function suggestNames(text: string, caret: number, candidates: readonly Candidate[]): Suggestions | null {
  const head = text.slice(0, caret)
  const m = NAME_START.exec(head)
  if (!m) return null
  const from = m.index
  // A word glued to a digit or a point is a unit ("5mm", "2.5in"), not a name.
  if (from > 0 && /[0-9.]/.test(head[from - 1])) return null
  const word = m[0]
  const lower = word.toLowerCase()
  if (candidates.some((c) => c.name === word)) return null
  const items = candidates.filter((c) => c.name.toLowerCase().startsWith(lower))
  if (items.length === 0) return null
  // The word may continue past the caret ("wi|dth"): the replacement covers all of it.
  let to = caret
  while (to < text.length && /[A-Za-z0-9_]/.test(text[to])) to++
  return { from, to, items }
}

/** The text after choosing a name, and where the caret goes. */
export function applySuggestion(text: string, s: Suggestions, name: string): { text: string; caret: number } {
  return { text: text.slice(0, s.from) + name + text.slice(s.to), caret: s.from + name.length }
}

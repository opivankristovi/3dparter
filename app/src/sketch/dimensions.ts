// Dimension values as people read and type them: lengths in the display unit, angles in degrees.
import { checkFieldText } from '../doc/fieldInput'
import type { FieldCheck } from '../doc/fieldInput'
import { isNumberLiteral } from '../doc/expr'
import { exprToFieldText } from '../doc/fieldText'
import type { ConstraintType, DisplayUnit, Expr } from '../doc/types'
import { formatDisplay } from '../doc/units'

/** Stored value (mm, or degrees for an angle) to field text. */
export function valueToText(type: ConstraintType, value: number, units: DisplayUnit): string {
  return type === 'angle' ? String(Number(value.toFixed(3))) : formatDisplay(value, units)
}

/**
 * Checks what was typed in a dimension field: a plain number (in the display unit, degrees for an angle) or
 * an expression that may use variables. On success `expr` is what to store. Whether the value is allowed
 * (a length above zero, a solvable sketch) is decided by the command that stores it.
 */
export function checkDimensionText(type: ConstraintType, text: string, units: DisplayUnit): FieldCheck {
  return checkFieldText(text, units, { kind: type === 'angle' ? 'angle' : 'length' })
}

/** The text to open a driving dimension's field with: its expression as stored (or its number in the display unit). */
export function editText(type: ConstraintType, stored: Expr | undefined, value: number, units: DisplayUnit): string {
  if (stored !== undefined && !isNumberLiteral(stored)) return stored
  if (stored !== undefined) return exprToFieldText(stored, units, type === 'angle' ? 'angle' : 'length')
  return valueToText(type, value, units)
}

const LABEL_EXPR_MAX = 18

/**
 * The text on a dimension label. A number reads "40 mm"; an expression reads "w * 2 = 30 mm" (a long
 * expression is cut with an ellipsis; the full text is in the field and the accessible name).
 */
export function dimensionLabel(type: ConstraintType, stored: Expr | undefined, value: number, units: DisplayUnit): string {
  const shown = labelText(type, value, units)
  if (stored === undefined || isNumberLiteral(stored)) return shown
  const e = stored.trim()
  return `${e.length > LABEL_EXPR_MAX ? `${e.slice(0, LABEL_EXPR_MAX - 1)}…` : e} = ${shown}`
}

/** The text on a dimension label, e.g. "40 mm" or "90°". */
export function labelText(type: ConstraintType, value: number, units: DisplayUnit): string {
  return type === 'angle' ? `${valueToText(type, value, units)}°` : `${valueToText(type, value, units)} ${units}`
}

/** Plain words for a constraint type, for tooltips, the side list and screen readers. */
export const CONSTRAINT_NAMES: Record<ConstraintType, string> = {
  coincident: 'Coincident',
  pointOnEntity: 'Point on curve',
  horizontal: 'Horizontal',
  vertical: 'Vertical',
  parallel: 'Parallel',
  perpendicular: 'Perpendicular',
  tangent: 'Tangent',
  equal: 'Equal',
  midpoint: 'Midpoint',
  concentric: 'Concentric',
  symmetric: 'Symmetric',
  fix: 'Fixed',
  distance: 'Distance',
  length: 'Length',
  horizontalDistance: 'Horizontal distance',
  verticalDistance: 'Vertical distance',
  pointLineDistance: 'Distance to line',
  radius: 'Radius',
  diameter: 'Diameter',
  angle: 'Angle',
}

/** Shortcut keys, for the constraint types that have one. */
export const CONSTRAINT_KEYS: Partial<Record<ConstraintType, string>> = {
  horizontal: 'H',
  vertical: 'V',
}

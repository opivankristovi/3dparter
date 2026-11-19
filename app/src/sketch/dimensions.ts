// Dimension values as people read and type them: lengths in the display unit, angles in degrees.
import type { ConstraintType, DisplayUnit, Expr } from '../doc/types'
import { formatDisplay, parseDisplay, toExpr } from '../doc/units'

/** Stored value (mm, or degrees for an angle) to field text. */
export function valueToText(type: ConstraintType, value: number, units: DisplayUnit): string {
  return type === 'angle' ? String(Number(value.toFixed(3))) : formatDisplay(value, units)
}

/** Field text to a stored value, or null when it is not a plain number. */
export function textToValue(type: ConstraintType, text: string, units: DisplayUnit): Expr | null {
  if (type === 'angle') {
    const t = text.trim()
    return /^[-+]?(\d+\.?\d*|\.\d+)$/.test(t) ? toExpr(parseFloat(t)) : null
  }
  const mm = parseDisplay(text, units)
  return mm === null ? null : toExpr(mm)
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

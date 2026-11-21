// Display units. The document always stores millimetres; these helpers convert at the edge (inputs and labels).
import type { DisplayUnit } from './types'

const MM_PER_UNIT: Record<DisplayUnit, number> = { mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8 }

/** Millimetres to the number shown in the user's unit. */
export function toDisplay(mm: number, unit: DisplayUnit): number {
  return mm / MM_PER_UNIT[unit]
}

/** A number typed in the user's unit to millimetres. */
export function fromDisplay(value: number, unit: DisplayUnit): number {
  return value * MM_PER_UNIT[unit]
}

/** Millimetres as field text in the user's unit, trimmed of float noise ("25.4", not "25.400000001"). */
export function formatDisplay(mm: number, unit: DisplayUnit, digits = 3): string {
  return String(Number(toDisplay(mm, unit).toFixed(digits)))
}

/** Square millimetres as field text in the user's unit squared. */
export function formatArea(mm2: number, unit: DisplayUnit, digits = 2): string {
  const k = MM_PER_UNIT[unit]
  return String(Number((mm2 / (k * k)).toFixed(digits)))
}

/** Cubic millimetres as field text in the user's unit cubed. */
export function formatVolume(mm3: number, unit: DisplayUnit, digits = 2): string {
  const k = MM_PER_UNIT[unit]
  return String(Number((mm3 / (k * k * k)).toFixed(digits)))
}

const PLAIN_NUMBER = /^[-+]?(\d+\.?\d*|\.\d+)$/

/** Field text in the user's unit to millimetres, or null if the text is not a plain number. */
export function parseDisplay(text: string, unit: DisplayUnit): number | null {
  const t = text.trim()
  if (!PLAIN_NUMBER.test(t)) return null
  return fromDisplay(parseFloat(t), unit)
}

/** Millimetres as the text stored in an Expr: no float noise, no exponent for sane sizes. */
export function toExpr(mm: number): string {
  return String(Number(mm.toFixed(6)))
}

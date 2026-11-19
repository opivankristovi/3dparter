// Shared facts about constraint types.
import type { ConstraintType, DimensionalConstraintType } from '../../doc/types'

const DIMENSIONAL: ReadonlySet<ConstraintType> = new Set<DimensionalConstraintType>([
  'distance',
  'length',
  'horizontalDistance',
  'verticalDistance',
  'pointLineDistance',
  'radius',
  'diameter',
  'angle',
])

export const isDimensional = (t: ConstraintType): t is DimensionalConstraintType => DIMENSIONAL.has(t)

/** Dimension types whose value must be greater than zero. (Signed offsets and angles may be anything.) */
const POSITIVE: ReadonlySet<ConstraintType> = new Set<ConstraintType>([
  'distance',
  'length',
  'pointLineDistance',
  'radius',
  'diameter',
])
export const mustBePositive = (t: ConstraintType): boolean => POSITIVE.has(t)

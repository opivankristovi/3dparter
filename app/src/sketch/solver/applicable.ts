// Which constraints fit the current selection? The UI shows exactly this list.
import type { ConstraintType, Sketch } from '../../doc/types'
import { parseRef } from './refs'

type Kind = 'P' | 'L' | 'C' | 'A'

/** Classifies each selected ref as point, line, circle or arc. Null when a ref is unknown. */
function kindsOf(selection: string[], sketch: Sketch): Kind[] | null {
  const out: Kind[] = []
  for (const ref of selection) {
    const p = parseRef(ref)
    if (!p) return null
    if (p.kind === 'reserved') {
      out.push(p.name === 'origin' ? 'P' : 'L')
      continue
    }
    const e = sketch.entities.find((x) => x.id === p.entityId)
    if (!e) return null
    if (p.kind === 'point') out.push('P')
    else out.push(e.type === 'line' ? 'L' : e.type === 'circle' ? 'C' : 'A')
  }
  return out
}

/** True when the two selected points are ends of two different lines/arcs (endpoint tangency). */
function isEndpointPair(selection: string[], sketch: Sketch): boolean {
  const ents = selection.map((ref) => {
    const p = parseRef(ref)
    if (p?.kind !== 'point') return null
    const e = sketch.entities.find((x) => x.id === p.entityId)
    return e && e.type !== 'circle' && p.slot !== 'center' ? e.id : null
  })
  return ents[0] !== null && ents[1] !== null && ents[0] !== ents[1]
}

/** Constraint types that can be applied to the selection (refs), in a stable display order. */
export function applicableConstraints(selection: string[], sketch: Sketch): ConstraintType[] {
  if (selection.length === 0) return []
  const kinds = kindsOf(selection, sketch)
  if (!kinds) return []
  const count = (k: Kind) => kinds.filter((x) => x === k).length
  const P = count('P')
  const L = count('L')
  const R = count('C') + count('A') // circles and arcs
  const n = kinds.length
  const out: ConstraintType[] = []
  const add = (...t: ConstraintType[]) => out.push(...t)

  if (n === 1) {
    if (P === 1) add('fix')
    else if (L === 1) add('horizontal', 'vertical', 'length', 'fix')
    else add('radius', 'diameter', 'fix')
  } else if (n === 2) {
    if (P === 2) {
      add('coincident', 'horizontal', 'vertical', 'distance', 'horizontalDistance', 'verticalDistance')
      if (isEndpointPair(selection, sketch)) add('tangent')
    } else if (L === 2) add('parallel', 'perpendicular', 'equal', 'angle')
    else if (P === 1 && L === 1) add('pointOnEntity', 'midpoint', 'pointLineDistance')
    else if (P === 1 && R === 1) add('pointOnEntity')
    else if (L === 1 && R === 1) add('tangent')
    else if (R === 2) add('concentric', 'equal', 'tangent')
  } else if (n === 3) {
    if (P === 3 || (P === 2 && L === 1)) add('symmetric')
  }
  return out
}

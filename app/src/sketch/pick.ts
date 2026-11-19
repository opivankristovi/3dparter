// Pure helpers for choosing sketch geometry: what a click hits, how the selection is stored,
// and which dimension the D key adds. No DOM, no store.
import type { DimensionalConstraintType, Ref, Sketch, Vec2 } from '../doc/types'
import { entityAt } from './geometry'
import { applicableConstraints } from './solver/applicable'
import { formatRef, getPoint, parseRef, pointSlots } from './solver/refs'

/**
 * What lies under a point: the nearest end point or centre within `tolMm` (an "<entityId>.<slot>" ref,
 * or "origin"), otherwise the nearest whole entity (its id), otherwise null. When an entity point and the
 * origin are equally near, the entity point wins.
 */
export function pickRef(sketch: Sketch, p: Vec2, tolMm: number): string | null {
  let best: string | null = null
  let bestD = tolMm
  const consider = (ref: string, at: Vec2 | null, strict: boolean) => {
    if (!at) return
    const d = Math.hypot(at[0] - p[0], at[1] - p[1])
    if (strict ? d < bestD : d <= bestD) {
      best = ref
      bestD = d
    }
  }
  for (const e of sketch.entities) {
    for (const slot of pointSlots(e)) consider(formatRef(e.id, slot), getPoint(e, slot), false)
  }
  consider('origin', [0, 0], true)
  if (best) return best
  return entityAt(sketch.entities, p, tolMm)?.id ?? null
}

// ---- how the selection is stored in the project store ---------------------------------------------
// A selected sketch item is a Ref { kind: 'sketchEdge', name: '<sketchId>/<constraint ref>' }.

export function selectionRef(sketchId: string, ref: string): Ref {
  return { kind: 'sketchEdge', name: `${sketchId}/${ref}` }
}

/** The constraint refs ("<entityId>", "<entityId>.a", "origin", ...) selected in one sketch, in selection order. */
export function refsOfSelection(selection: Ref[], sketchId: string): string[] {
  const prefix = `${sketchId}/`
  return selection.filter((r) => r.kind === 'sketchEdge' && r.name.startsWith(prefix)).map((r) => r.name.slice(prefix.length))
}

/** Ids of the entities selected as a whole (point refs and the origin are left out). */
export function wholeEntityIds(refs: string[]): string[] {
  return refs.filter((r) => parseRef(r)?.kind === 'entity')
}

/** Shift-click: removes the ref when it is already selected, otherwise adds it. */
export function toggleRef(refs: string[], ref: string): string[] {
  return refs.includes(ref) ? refs.filter((r) => r !== ref) : [...refs, ref]
}

// ---- constraints from a selection -----------------------------------------------------------------

type Kind = 'P' | 'L' | 'C' | 'A'

function kindOf(ref: string, sketch: Sketch): Kind | null {
  const p = parseRef(ref)
  if (!p) return null
  if (p.kind === 'reserved') return p.name === 'origin' ? 'P' : 'L'
  const e = sketch.entities.find((x) => x.id === p.entityId)
  if (!e) return null
  if (p.kind === 'point') return 'P'
  return e.type === 'line' ? 'L' : e.type === 'circle' ? 'C' : 'A'
}

/**
 * The most natural dimension for the selection (what the D key adds): line -> length, circle -> diameter,
 * arc -> radius, two points -> distance, two lines -> angle, point and line -> pointLineDistance.
 */
export function dimensionFor(refs: string[], sketch: Sketch): DimensionalConstraintType | null {
  const kinds = refs.map((r) => kindOf(r, sketch))
  if (kinds.some((k) => k === null)) return null
  const k = kinds as Kind[]
  let pick: DimensionalConstraintType | null = null
  if (k.length === 1 && parseRef(refs[0])?.kind === 'reserved') return null // a fixed axis has no length
  if (k.length === 1) pick = k[0] === 'L' ? 'length' : k[0] === 'C' ? 'diameter' : k[0] === 'A' ? 'radius' : null
  else if (k.length === 2) {
    const P = k.filter((x) => x === 'P').length
    const L = k.filter((x) => x === 'L').length
    if (P === 2) pick = 'distance'
    else if (L === 2) pick = 'angle'
    else if (P === 1 && L === 1) pick = 'pointLineDistance'
  }
  // Never offer something the selection does not allow (e.g. the reserved axes as a length).
  return pick && applicableConstraints(refs, sketch).includes(pick) ? pick : null
}

/** Refs in the order the solver expects: points before curves (stable otherwise). */
export function orderRefs(refs: string[], sketch: Sketch): string[] {
  const pts = refs.filter((r) => kindOf(r, sketch) === 'P')
  return [...pts, ...refs.filter((r) => kindOf(r, sketch) !== 'P')]
}

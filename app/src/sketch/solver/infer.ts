// Auto-constraints while drawing: what the new geometry obviously means.
import { newId } from '../../doc/commands'
import type { SketchConstraint, SketchEntity, Vec2 } from '../../doc/types'
import { formatRef, getPoint, pointSlots } from './refs'

export type DrawKind = 'line' | 'rectangle' | 'circle' | 'arc' | 'polygon' | 'slot' | 'ellipse' | 'spline'

export interface InferOptions {
  /** Distance in mm under which two points count as the same point. */
  tolMm: number
  kind: DrawKind
}

/** Joins coincident endpoints among `entities` themselves (without snapping to the rest of the sketch). */
export function connectInternalEndpoints(entities: SketchEntity[], tolMm = 1e-6): SketchConstraint[] {
  const fresh: Anchor[] = []
  for (const e of entities) {
    for (const slot of pointSlots(e)) {
      const pos = getPoint(e, slot)
      if (pos) fresh.push({ ref: formatRef(e.id, slot), pos })
    }
  }
  const out: SketchConstraint[] = []
  const parent = new Map<string, string>()
  const find = (x: string): string => {
    let r = x
    while (parent.has(r) && parent.get(r) !== r) r = parent.get(r) as string
    return r
  }
  const entityOf = (ref: string) => ref.slice(0, ref.lastIndexOf('.'))
  for (let i = 0; i < fresh.length; i++) {
    for (let j = i + 1; j < fresh.length; j++) {
      const a = fresh[i]
      const b = fresh[j]
      if (entityOf(a.ref) === entityOf(b.ref)) continue
      if (Math.hypot(a.pos[0] - b.pos[0], a.pos[1] - b.pos[1]) <= tolMm) {
        const ra = find(a.ref)
        const rb = find(b.ref)
        if (ra !== rb) {
          parent.set(ra, rb)
          out.push(make('coincident', [a.ref, b.ref]))
        }
      }
    }
  }
  return out
}

/** Lines within this angle of an axis become horizontal / vertical. */
const AXIS_TOL = (0.5 * Math.PI) / 180

interface Anchor {
  ref: string
  pos: Vec2
}

function anchorsOf(entities: SketchEntity[]): Anchor[] {
  const out: Anchor[] = []
  for (const e of entities) {
    for (const slot of pointSlots(e)) {
      const pos = getPoint(e, slot)
      if (pos) out.push({ ref: formatRef(e.id, slot), pos })
    }
  }
  return out
}

const make = (type: SketchConstraint['type'], entityIds: string[]): SketchConstraint => ({
  id: newId(),
  type,
  entityIds,
  driving: true,
})

/**
 * Constraints for freshly drawn entities:
 *  - coincident: a new end/centre on an existing end/centre or the origin (nearest one within tolMm),
 *    and between ends of the new entities themselves (polyline and rectangle corners);
 *  - horizontal / vertical: a new line within 0.5 degrees of an axis.
 * Never emits two coincident constraints that say the same thing.
 */
export function inferConstraints(
  newEntities: SketchEntity[],
  existing: SketchEntity[],
  opts: InferOptions,
): SketchConstraint[] {
  const out: SketchConstraint[] = []
  const tol = opts.tolMm
  const fresh = anchorsOf(newEntities)
  const others: Anchor[] = [{ ref: 'origin', pos: [0, 0] }, ...anchorsOf(existing)]

  // Union-find over refs so a chain of coincident points yields n-1 constraints, not n(n-1)/2.
  const parent = new Map<string, string>()
  const find = (x: string): string => {
    let r = x
    while (parent.has(r) && parent.get(r) !== r) r = parent.get(r) as string
    return r
  }
  const link = (a: string, b: string): boolean => {
    const ra = find(a)
    const rb = find(b)
    if (ra === rb) return false
    parent.set(ra, rb)
    return true
  }
  const dist = (p: Vec2, q: Vec2) => Math.hypot(p[0] - q[0], p[1] - q[1])
  const entityOf = (ref: string) => ref.slice(0, ref.lastIndexOf('.'))

  // New point on an existing point: the nearest existing one.
  for (const f of fresh) {
    let best: Anchor | null = null
    let bestD = tol
    for (const o of others) {
      const d = dist(f.pos, o.pos)
      if (d <= bestD) {
        best = o
        bestD = d
      }
    }
    if (best && link(f.ref, best.ref)) out.push(make('coincident', [f.ref, best.ref]))
  }

  // New points on each other (different entities only).
  for (let i = 0; i < fresh.length; i++) {
    for (let j = i + 1; j < fresh.length; j++) {
      const a = fresh[i]
      const b = fresh[j]
      if (entityOf(a.ref) === entityOf(b.ref)) continue
      if (dist(a.pos, b.pos) <= tol && link(a.ref, b.ref)) out.push(make('coincident', [a.ref, b.ref]))
    }
  }

  if (opts.kind === 'line' || opts.kind === 'rectangle') {
    for (const e of newEntities) {
      if (e.type !== 'line') continue
      const dx = Math.abs(e.b[0] - e.a[0])
      const dy = Math.abs(e.b[1] - e.a[1])
      if (dx === 0 && dy === 0) continue
      if (Math.atan2(dy, dx) <= AXIS_TOL) out.push(make('horizontal', [e.id]))
      else if (Math.atan2(dx, dy) <= AXIS_TOL) out.push(make('vertical', [e.id]))
    }
  }
  return out
}

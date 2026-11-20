// The two arms of an angle dimension. Shared by measuring and by the solver mapping, so what is shown
// is what is solved.
//
// The arms are decided ONCE, when the dimension is created, and stored on the constraint (`arms`: for
// each line, the end its arm starts at). Two lines joined at a corner (a coincident constraint between an
// end of one and an end of the other) get arms that leave that corner. Lines that are not joined use their
// own a -> b directions. Re-deriving this from the current constraints on every solve would make an
// existing dimension change meaning when a coincident is added or deleted later, so only
// detectArmStarts looks at constraints, and only at creation. A constraint without `arms` (older
// documents) is each line's own a -> b.
import type { ArmStart, Sketch, SketchConstraint } from '../../doc/types'
import { parseRef } from './refs'

/** Point refs of an arm, from its start to its end. Refs resolve like any other point ref. */
export type Arm = [string, string]

/** The end point refs of a sketch line ref. The fixed axes have none (callers keep using the axis itself). */
function endsOf(sketch: Sketch, lineRef: string): Arm | null {
  const p = parseRef(lineRef)
  if (p?.kind !== 'entity') return null
  return sketch.entities.some((e) => e.id === p.entityId && e.type === 'line') ? [`${p.entityId}.a`, `${p.entityId}.b`] : null
}

/**
 * CREATION ONLY. The arm starts for a new angle between two lines: both leave the shared corner when a
 * coincident currently joins an end of one to an end of the other, otherwise ['a', 'a']. Null when either
 * ref is not a sketch line (an axis).
 */
export function detectArmStarts(sketch: Sketch, ref1: string, ref2: string): [ArmStart, ArmStart] | null {
  const e1 = endsOf(sketch, ref1)
  const e2 = endsOf(sketch, ref2)
  if (!e1 || !e2) return null
  for (const c of sketch.constraints) {
    if (c.type !== 'coincident' || c.entityIds.length !== 2) continue
    const [u, v] = c.entityIds
    for (const [x, y] of [[u, v], [v, u]] as const) {
      const i = e1.findIndex((p) => p === x)
      const j = e2.findIndex((p) => p === y)
      if (i >= 0 && j >= 0) return [i === 0 ? 'a' : 'b', j === 0 ? 'a' : 'b']
    }
  }
  return ['a', 'a']
}

/** The arms (point refs) of an angle constraint from its STORED arm starts, or null when a ref is an axis. */
export function angleArms(sketch: Sketch, c: Pick<SketchConstraint, 'entityIds' | 'arms'>): [Arm, Arm] | null {
  const e1 = endsOf(sketch, c.entityIds[0])
  const e2 = endsOf(sketch, c.entityIds[1])
  if (!e1 || !e2) return null
  const [s1, s2] = c.arms ?? ['a', 'a']
  return [s1 === 'a' ? e1 : [e1[1], e1[0]], s2 === 'a' ? e2 : [e2[1], e2[0]]]
}

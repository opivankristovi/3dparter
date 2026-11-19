// Which entities are fully defined? Not meant for every drag frame: it re-solves once per entity.
import type { Sketch } from '../../doc/types'
import { refEntityId } from './refs'
import { dofWithFixed, solveSketch } from './solver'

export type EntityState = 'under' | 'full' | 'conflict'

/**
 * Method: solve once for the base degrees of freedom. For each entity, solve again with that entity's
 * parameters pinned. If the dof did not drop, the constraints already determined it: 'full'.
 * Entities touched by a conflicting constraint are 'conflict'.
 */
export function entityStates(sketch: Sketch): Record<string, EntityState> {
  const base = solveSketch(sketch)
  const conflicted = new Set<string>()
  for (const cid of base.conflicting) {
    const c = sketch.constraints.find((x) => x.id === cid)
    for (const ref of c?.entityIds ?? []) {
      const id = refEntityId(ref)
      if (id) conflicted.add(id)
    }
  }
  const out: Record<string, EntityState> = {}
  for (const e of sketch.entities) {
    if (conflicted.has(e.id)) out[e.id] = 'conflict'
    else if (base.dof === 0) out[e.id] = 'full'
    else out[e.id] = dofWithFixed(sketch, new Set([e.id])).dof === base.dof ? 'full' : 'under'
  }
  return out
}

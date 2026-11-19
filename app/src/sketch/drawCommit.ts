// Turns a finished shape into one undo step: its entities, the constraints that follow from where it was
// drawn (automatic constraints), and the dimensions that were typed.
import { newId } from '../doc/commands'
import type { SketchConstraint } from '../doc/types'
import { addSketchEntities } from './commands'
import type { Built } from './shapes'
import { inferConstraints } from './solver/infer'
import { currentSketch } from './actions'

export interface CommitOptions {
  auto: boolean
  label: string
  /** The line drawn just before this one in the same chain (its end meets this line's start). */
  prevLine: string | null
  /** The first line of the chain, when this line closes the loop. */
  closeOn: string | null
}

const coincident = (a: string, b: string): SketchConstraint => ({ id: newId(), type: 'coincident', entityIds: [a, b], driving: true })

/** Adds the shape. Returns the dimensions or constraints that were dropped (for example because they conflicted). */
export function commitBuilt(sketchId: string, built: Built, opts: CommitOptions): SketchConstraint[] {
  const sketch = currentSketch()
  if (!sketch || sketch.sketchId !== sketchId) return []
  let geometric: SketchConstraint[]
  if (opts.auto) geometric = inferConstraints(built.entities, sketch.sketch.entities, { tolMm: 1e-6, kind: built.kind })
  else {
    // Without automatic constraints only the joins inside one shape are kept, so a shape stays closed.
    geometric = []
    const es = built.entities
    if (built.kind === 'rectangle') {
      es.forEach((e, i) => geometric.push(coincident(`${e.id}.b`, `${es[(i + 1) % es.length].id}.a`)))
    } else if (built.kind === 'line') {
      if (opts.prevLine) geometric.push(coincident(`${opts.prevLine}.b`, `${es[0].id}.a`))
      if (opts.closeOn) geometric.push(coincident(`${es[0].id}.b`, `${opts.closeOn}.a`))
    }
  }
  return addSketchEntities(sketchId, built.entities, opts.label, [...geometric, ...built.dims])
}

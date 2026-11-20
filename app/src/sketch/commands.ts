// Sketch edits. Each call is exactly one undo step.
import { addFeature, newId, nextFeatureName } from '../doc/commands'
import { useProjectStore } from '../doc/store'
import type { Expr, OriginPlaneName, Ref, Sketch, SketchConstraint, SketchEntity, SketchFeature } from '../doc/types'
import { mustBePositive, isDimensional } from './solver/constraints'
import { measureConstraint } from './solver/measure'
import { refEntityId } from './solver/refs'
import { ensureSolver, solveSketch } from './solver/solver'
import type { SolveResult } from './solver/solver'
import { evalValue } from './solver/value'

/** Creates an empty sketch on a plane or flat face ("Sketch N") and returns its id. */
export function createSketch(plane: OriginPlaneName | Ref): string {
  const doc = useProjectStore.getState().doc
  const on: Ref = typeof plane === 'string' ? { kind: 'originPlane', name: plane } : plane
  const feature: SketchFeature = {
    id: newId(),
    type: 'sketch',
    name: nextFeatureName(doc, 'sketch'),
    suppressed: false,
    params: { on },
    sketch: { entities: [], constraints: [] },
  }
  addFeature(feature, feature.name)
  return feature.id
}

export type ConstraintResult = { ok: true } | { ok: false; conflicting: string[]; reason: string }

type Refusal = Extract<ConstraintResult, { ok: false }>

function sketchOf(sketchId: string): Sketch | null {
  const f = useProjectStore.getState().doc.features.find((x) => x.id === sketchId)
  return f?.type === 'sketch' ? f.sketch : null
}

/** Writes solved coordinates onto the stored entities (matched by id) inside an apply() recipe. */
function writeEntities(target: SketchEntity[], solved: SketchEntity[]) {
  const byId = new Map(solved.map((e) => [e.id, e]))
  for (let i = 0; i < target.length; i++) {
    const s = byId.get(target[i].id)
    if (s && s !== target[i]) target[i] = s
  }
}

const size = (e: SketchEntity) => (e.type === 'line' ? Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1]) : e.radius)
const DEGENERATE = 1e-6

/** Entities that were real before and have collapsed to a point after. */
function collapsed(before: SketchEntity[], after: SketchEntity[]): string[] {
  const was = new Map(before.map((e) => [e.id, size(e)]))
  return after.filter((e) => size(e) < DEGENERATE && (was.get(e.id) ?? 0) >= DEGENERATE).map((e) => e.id)
}

/** Solves `trial` and decides whether it may replace `before`. */
function vet(before: Sketch, trial: Sketch, newConstraintId: string): { ok: true; entities: SketchEntity[] } | Refusal {
  const r: SolveResult = solveSketch(trial)
  const why = r.invalid[newConstraintId]
  if (why) return { ok: false, conflicting: [], reason: why }
  if (r.conflicting.length > 0) {
    return { ok: false, conflicting: r.conflicting, reason: 'This conflicts with the existing constraints.' }
  }
  if (r.redundant.length > 0) {
    return { ok: false, conflicting: r.redundant, reason: 'The existing constraints already imply this.' }
  }
  if (!r.ok) return { ok: false, conflicting: [], reason: 'The solver could not satisfy this constraint.' }
  const gone = new Set(collapsed(before.entities, r.entities))
  if (gone.size > 0) {
    const involved = trial.constraints
      .filter((c) => c.driving && c.entityIds.some((ref) => gone.has(refEntityId(ref) ?? '')))
      .map((c) => c.id)
    return { ok: false, conflicting: involved, reason: 'This would collapse a line or circle to a point.' }
  }
  return { ok: true, entities: r.entities }
}

/**
 * Adds entities (and optionally constraints for them) as one undo step. Given constraints go in one by
 * one and any that would conflict, repeat another or collapse geometry is dropped (returned), so
 * auto-inferred constraints can never break a sketch. Needs the solver only when constraints are involved.
 */
export function addSketchEntities(
  sketchId: string,
  entities: SketchEntity[],
  label: string,
  constraints: SketchConstraint[] = [],
): SketchConstraint[] {
  if (entities.length === 0) return []
  const sketch = sketchOf(sketchId)
  if (!sketch) return []
  let accepted: SketchConstraint[] = []
  let solved: SketchEntity[] = entities
  if (constraints.length > 0 || sketch.constraints.length > 0) {
    ensureSolver()
    const merged: Sketch = { entities: [...sketch.entities, ...entities], constraints: [...sketch.constraints] }
    for (const c of constraints) {
      const trial: Sketch = { entities: merged.entities, constraints: [...merged.constraints, c] }
      if (vet(merged, trial, c.id).ok) merged.constraints.push(c)
    }
    accepted = merged.constraints.slice(sketch.constraints.length)
    const r = solveSketch(merged)
    if (r.ok) solved = r.entities.slice(sketch.entities.length)
    // Existing entities may have been nudged by a new coincident constraint: keep that too.
    const moved = r.ok ? r.entities.slice(0, sketch.entities.length) : sketch.entities
    useProjectStore.getState().apply(label, (draft) => {
      const f = draft.features.find((x) => x.id === sketchId)
      if (f?.type !== 'sketch') return
      writeEntities(f.sketch.entities, moved)
      f.sketch.entities.push(...solved)
      f.sketch.constraints.push(...accepted)
    })
    return constraints.filter((c) => !accepted.includes(c))
  }
  useProjectStore.getState().apply(label, (draft) => {
    const f = draft.features.find((x) => x.id === sketchId)
    if (f?.type === 'sketch') f.sketch.entities.push(...solved)
  })
  return []
}

export function deleteSketchEntities(sketchId: string, entityIds: string[]) {
  if (entityIds.length === 0) return
  useProjectStore.getState().apply('Delete sketch line', (draft) => {
    const f = draft.features.find((x) => x.id === sketchId)
    if (f?.type !== 'sketch') return
    const gone = new Set(entityIds)
    f.sketch.entities = f.sketch.entities.filter((e) => !gone.has(e.id))
    // A constraint that mentions a deleted entity has nothing left to constrain.
    f.sketch.constraints = f.sketch.constraints.filter(
      (c) => !c.entityIds.some((ref) => gone.has(refEntityId(ref) ?? '')),
    )
  })
}

/**
 * Adds a constraint and re-solves, as one undo step. Refuses (the document is not touched) when the
 * constraint is malformed, conflicts with others, repeats what is already implied, or collapses geometry.
 */
export function addConstraint(sketchId: string, c: SketchConstraint): ConstraintResult {
  ensureSolver()
  const sketch = sketchOf(sketchId)
  if (!sketch) return { ok: false, conflicting: [], reason: 'No such sketch.' }
  if (isDimensional(c.type)) {
    const v = evalValue(c.value)
    if (!Number.isFinite(v)) return { ok: false, conflicting: [], reason: 'The value is not a number.' }
    if (mustBePositive(c.type) && v <= 0) return { ok: false, conflicting: [], reason: 'The value must be greater than zero.' }
  }
  if (!c.driving) {
    // A reference dimension never reaches the solver; it only has to point at something measurable.
    if (!isDimensional(c.type) || measureConstraint(sketch, c) === null) {
      return { ok: false, conflicting: [], reason: 'Cannot measure this selection.' }
    }
    useProjectStore.getState().apply('Add constraint', (draft) => {
      const f = draft.features.find((x) => x.id === sketchId)
      if (f?.type === 'sketch') f.sketch.constraints.push(c)
    })
    return { ok: true }
  }
  const trial: Sketch = { entities: sketch.entities, constraints: [...sketch.constraints, c] }
  const v = vet(sketch, trial, c.id)
  if (!v.ok) return v
  useProjectStore.getState().apply('Add constraint', (draft) => {
    const f = draft.features.find((x) => x.id === sketchId)
    if (f?.type !== 'sketch') return
    writeEntities(f.sketch.entities, v.entities)
    f.sketch.constraints.push(c)
  })
  return { ok: true }
}

/** Changes a dimension's value and re-solves, as one undo step. Same refusal rule as addConstraint. */
export function setConstraintValue(sketchId: string, constraintId: string, value: Expr): ConstraintResult {
  ensureSolver()
  const sketch = sketchOf(sketchId)
  const old = sketch?.constraints.find((x) => x.id === constraintId)
  if (!sketch || !old) return { ok: false, conflicting: [], reason: 'No such constraint.' }
  if (!isDimensional(old.type)) return { ok: false, conflicting: [], reason: 'This constraint has no value.' }
  const v = evalValue(value)
  if (!Number.isFinite(v)) return { ok: false, conflicting: [], reason: 'The value is not a number.' }
  if (mustBePositive(old.type) && v <= 0) return { ok: false, conflicting: [], reason: 'The value must be greater than zero.' }
  const next: SketchConstraint = { ...old, value }
  const trial: Sketch = {
    entities: sketch.entities,
    constraints: sketch.constraints.map((x) => (x.id === constraintId ? next : x)),
  }
  if (!old.driving) {
    useProjectStore.getState().apply('Edit dimension', (draft) => {
      const f = draft.features.find((x) => x.id === sketchId)
      const c = f?.type === 'sketch' ? f.sketch.constraints.find((x) => x.id === constraintId) : undefined
      if (c) c.value = value
    })
    return { ok: true }
  }
  const r = vet(sketch, trial, constraintId)
  if (!r.ok) return r
  useProjectStore.getState().apply('Edit dimension', (draft) => {
    const f = draft.features.find((x) => x.id === sketchId)
    if (f?.type !== 'sketch') return
    writeEntities(f.sketch.entities, r.entities)
    const c = f.sketch.constraints.find((x) => x.id === constraintId)
    if (c) c.value = value
  })
  return { ok: true }
}

export function deleteConstraints(sketchId: string, ids: string[]) {
  if (ids.length === 0) return
  useProjectStore.getState().apply('Delete constraint', (draft) => {
    const f = draft.features.find((x) => x.id === sketchId)
    if (f?.type !== 'sketch') return
    const gone = new Set(ids)
    f.sketch.constraints = f.sketch.constraints.filter((c) => !gone.has(c.id))
  })
}

/** Commits final positions after a drag (the UI previews with solveSketch and never touches the store). */
export function moveSketchGeometry(sketchId: string, entities: SketchEntity[]) {
  if (entities.length === 0) return
  useProjectStore.getState().apply('Move sketch geometry', (draft) => {
    const f = draft.features.find((x) => x.id === sketchId)
    if (f?.type === 'sketch') writeEntities(f.sketch.entities, entities)
  })
}

/** Makes the entities construction geometry, or back to normal when all of them already are. */
export function toggleConstruction(sketchId: string, entityIds: string[]) {
  if (entityIds.length === 0) return
  useProjectStore.getState().apply('Toggle construction', (draft) => {
    const f = draft.features.find((x) => x.id === sketchId)
    if (f?.type !== 'sketch') return
    const ids = new Set(entityIds)
    const hit = f.sketch.entities.filter((e) => ids.has(e.id))
    const next = !hit.every((e) => e.construction)
    for (const e of hit) e.construction = next
  })
}

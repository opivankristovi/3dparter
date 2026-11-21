// What the constraint buttons, the H / V / D / X keys and the command palette do. All of it works on the
// open sketch and the current selection, so any of them can call it.
import { newId } from '../doc/commands'
import { useProjectStore } from '../doc/store'
import type { ArmStart, ConstraintType, DimensionalConstraintType, Sketch, SketchConstraint, SketchFeature } from '../doc/types'
import { useToolStore } from '../screens/workspace/toolStore'
import type { ToastInput } from '../ui/Toast'
import { addConstraint, deleteConstraints, deleteSketchEntities, setConstraintValue, toggleConstruction } from './commands'
import type { ConstraintResult } from './commands'
import { CONSTRAINT_NAMES, checkDimensionText, valueToText } from './dimensions'
import { dimensionFor, orderRefs, refsOfSelection, wholeEntityIds } from './pick'
import { filletSketchCorner, mirrorSketchSelection, patternSketchSelection, trimSketchEntity } from './sketchEditOps'
import { applicableConstraints } from './solver/applicable'
import { detectArmStarts } from './solver/arms'
import { isDimensional } from './solver/constraints'
import { measureConstraint } from './solver/measure'
import { useSketchUi } from './sketchUi'

let toaster: (t: ToastInput) => void = () => {}
/** The mounted toast provider hands its function over here, so plain functions can show messages. */
export function setToaster(fn: (t: ToastInput) => void) {
  toaster = fn
}

interface Current {
  sketchId: string
  sketch: Sketch
  refs: string[]
}

export function currentSketch(): { sketchId: string; sketch: Sketch } | null {
  const sketchId = useToolStore.getState().activeSketchId
  if (!sketchId) return null
  const f = useProjectStore.getState().doc.features.find((x): x is SketchFeature => x.id === sketchId && x.type === 'sketch')
  return f ? { sketchId, sketch: f.sketch } : null
}

function current(): Current | null {
  const c = currentSketch()
  if (!c) return null
  return { ...c, refs: refsOfSelection(useProjectStore.getState().selection, c.sketchId) }
}

let flashTimer: ReturnType<typeof setTimeout> | undefined
/** Flashes constraints red for a moment, so a refusal points at what is in the way. */
export function flash(ids: string[]) {
  if (ids.length === 0) return
  useSketchUi.getState().set({ flashIds: ids })
  clearTimeout(flashTimer)
  flashTimer = setTimeout(() => useSketchUi.getState().set({ flashIds: [] }), 1400)
}

/** Says why a constraint was refused and flashes the ones in the way. */
export function reportRefusal(r: Extract<ConstraintResult, { ok: false }>) {
  toaster({ variant: 'error', title: r.reason, description: r.conflicting.length ? 'The conflicting constraints are flashing red.' : undefined })
  flash(r.conflicting)
}

const make = (type: ConstraintType, refs: string[], value?: string, arms?: [ArmStart, ArmStart]): SketchConstraint => ({
  id: newId(),
  type,
  entityIds: refs,
  value,
  driving: true,
  ...(arms ? { arms } : {}),
})

/** Applies a constraint type to the selection. Dimensions open the inline field instead. */
export function applyConstraint(type: ConstraintType) {
  const c = current()
  if (!c) return
  if (!applicableConstraints(c.refs, c.sketch).includes(type)) {
    toaster({ variant: 'error', title: `${CONSTRAINT_NAMES[type]} does not fit this selection.` })
    return
  }
  const refs = orderRefs(c.refs, c.sketch)
  if (isDimensional(type)) return startDimension(type, refs, c)
  const r = addConstraint(c.sketchId, make(type, refs))
  if (!r.ok) reportRefusal(r)
}

function startDimension(type: DimensionalConstraintType, selected: string[], c: Current) {
  let refs = selected
  // The arms of an angle are decided here, once, from the corner the lines form now (never re-derived).
  let arms = type === 'angle' ? (detectArmStarts(c.sketch, refs[0], refs[1]) ?? undefined) : undefined
  let measured = measureConstraint(c.sketch, make(type, refs, '1', arms))
  if (measured === null) {
    toaster({ variant: 'error', title: 'This selection cannot be measured.' })
    return
  }
  if (type === 'angle' && measured < 0) {
    // The angle is signed (counter-clockwise from the first line to the second). Swap the lines (and their
    // arm starts) so the stored and shown value is the positive angle inside the corner.
    refs = [refs[1], refs[0]]
    if (arms) arms = [arms[1], arms[0]]
    measured = -measured
  }
  const units = useProjectStore.getState().doc.units
  useSketchUi.getState().set({
    pending: { type, refs, arms, text: valueToText(type, measured, units) },
    editingId: null,
    selectedConstraintIds: [],
  })
}

/** The D key: the most natural dimension for the selection. */
export function addDimension() {
  const c = current()
  if (!c) return
  const type = dimensionFor(c.refs, c.sketch)
  if (!type) {
    toaster({ variant: 'info', title: 'Select a line, a circle, an arc, two points or two lines to dimension.' })
    return
  }
  applyConstraint(type)
}

/** Enter in the new-dimension field. A refusal shows on the field and nothing changes. */
export function submitPending(text: string) {
  const ui = useSketchUi.getState()
  const p = ui.pending
  const c = current()
  if (!p || !c) return
  const units = useProjectStore.getState().doc.units
  const checked = checkDimensionText(p.type, text, units)
  if (!checked.ok) {
    ui.set({ pending: { ...p, text, error: checked.message } })
    return
  }
  const r = addConstraint(c.sketchId, make(p.type, p.refs, checked.expr, p.arms))
  if (!r.ok) {
    ui.set({ pending: { ...p, text, error: r.reason } })
    flash(r.conflicting)
    return
  }
  ui.set({ pending: null })
}

/** Enter in an existing dimension's field. Returns an error message, or null when it worked. */
export function submitDimensionEdit(constraintId: string, text: string): string | null {
  const c = currentSketch()
  const old = c?.sketch.constraints.find((x) => x.id === constraintId)
  if (!c || !old) return 'This dimension is gone.'
  const units = useProjectStore.getState().doc.units
  const checked = checkDimensionText(old.type, text, units)
  if (!checked.ok) return checked.message
  const r = setConstraintValue(c.sketchId, constraintId, checked.expr)
  if (!r.ok) {
    flash(r.conflicting)
    return r.reason
  }
  useSketchUi.getState().set({ editingId: null })
  return null
}

/** The X key: construction geometry on or off for the selected lines, circles and arcs. */
export function toggleConstructionOfSelection() {
  const c = current()
  if (!c) return
  const ids = wholeEntityIds(c.refs)
  if (ids.length === 0) {
    toaster({ variant: 'info', title: 'Select a line, circle or arc first.' })
    return
  }
  toggleConstruction(c.sketchId, ids)
}

/** Delete / Backspace: selected constraints go, and so do selected entities. Returns whether anything was selected. */
export function deleteSelected(): boolean {
  const c = current()
  if (!c) return false
  const ui = useSketchUi.getState()
  const gone = ui.selectedConstraintIds.filter((id) => c.sketch.constraints.some((k) => k.id === id))
  const entities = wholeEntityIds(c.refs)
  if (gone.length === 0 && entities.length === 0) return false
  if (gone.length) deleteConstraints(c.sketchId, gone)
  if (entities.length) deleteSketchEntities(c.sketchId, entities)
  ui.set({ selectedConstraintIds: [], hoverConstraintId: null })
  useProjectStore.getState().setSelection([])
  return true
}

export function setAutoConstraints(on: boolean) {
  useSketchUi.getState().set({ autoConstraints: on })
}

/** T key or Trim button: trims the selected (or hovered) sketch entity at intersections. */
export function trimSelection() {
  const c = current()
  if (!c) return
  const ui = useSketchUi.getState()
  const ids = wholeEntityIds(c.refs)
  const targetId = ids[0] ?? (ui.hoverRef ? wholeEntityIds([ui.hoverRef])[0] : undefined)
  if (!targetId) {
    toaster({ variant: 'info', title: 'Select or point at a sketch line, circle or arc to trim.' })
    return
  }
  if (trimSketchEntity(c.sketchId, targetId)) useProjectStore.getState().setSelection([])
}

/** Rounds the corner where two selected lines (or a selected corner point) meet. */
export function filletCornerSelection(radius = 3) {
  const c = current()
  if (!c) return
  if (!filletSketchCorner(c.sketchId, c.refs, radius)) {
    toaster({ variant: 'info', title: 'Select two meeting lines or a corner point to fillet.' })
    return
  }
  useProjectStore.getState().setSelection([])
}

/** Mirrors selected sketch geometry across a selected line (prefers a construction line). */
export function mirrorSketchSelected() {
  const c = current()
  if (!c) return
  const ids = wholeEntityIds(c.refs)
  if (!mirrorSketchSelection(c.sketchId, ids)) {
    toaster({ variant: 'info', title: 'Select geometry and an axis line to mirror across.' })
    return
  }
  useProjectStore.getState().setSelection([])
}

/** Duplicates selected sketch geometry in a 3-copy linear array. */
export function patternSketchSelected() {
  const c = current()
  if (!c) return
  const ids = wholeEntityIds(c.refs)
  if (!patternSketchSelection(c.sketchId, ids)) {
    toaster({ variant: 'info', title: 'Select sketch geometry to pattern.' })
    return
  }
  useProjectStore.getState().setSelection([])
}

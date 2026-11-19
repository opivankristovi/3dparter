// What the constraint buttons, the H / V / D / X keys and the command palette do. All of it works on the
// open sketch and the current selection, so any of them can call it.
import { newId } from '../doc/commands'
import { useProjectStore } from '../doc/store'
import type { ConstraintType, DimensionalConstraintType, Sketch, SketchConstraint, SketchFeature } from '../doc/types'
import { useToolStore } from '../screens/workspace/toolStore'
import type { ToastInput } from '../ui/Toast'
import { addConstraint, deleteConstraints, deleteSketchEntities, setConstraintValue, toggleConstruction } from './commands'
import type { ConstraintResult } from './commands'
import { CONSTRAINT_NAMES, textToValue, valueToText } from './dimensions'
import { dimensionFor, orderRefs, refsOfSelection, wholeEntityIds } from './pick'
import { applicableConstraints } from './solver/applicable'
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

const make = (type: ConstraintType, refs: string[], value?: string): SketchConstraint => ({
  id: newId(),
  type,
  entityIds: refs,
  value,
  driving: true,
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

function startDimension(type: DimensionalConstraintType, refs: string[], c: Current) {
  const measured = measureConstraint(c.sketch, make(type, refs, '1'))
  if (measured === null) {
    toaster({ variant: 'error', title: 'This selection cannot be measured.' })
    return
  }
  const units = useProjectStore.getState().doc.units
  useSketchUi.getState().set({
    pending: { type, refs, text: valueToText(type, measured, units) },
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
  const value = textToValue(p.type, text, units)
  if (value === null) {
    ui.set({ pending: { ...p, text, error: 'Enter a number.' } })
    return
  }
  const r = addConstraint(c.sketchId, make(p.type, p.refs, value))
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
  const value = textToValue(old.type, text, units)
  if (value === null) return 'Enter a number.'
  const r = setConstraintValue(c.sketchId, constraintId, value)
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

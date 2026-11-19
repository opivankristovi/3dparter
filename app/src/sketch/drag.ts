// Dragging sketch geometry with a live solve. Every frame is solved and drawn through the engine from a
// copy; the document is written once, on release, as a single undo step.
import type { Sketch, SketchEntity, Vec2 } from '../doc/types'
import { moveSketchGeometry } from './commands'
import { useSketchUi } from './sketchUi'
import { solveSketch } from './solver/solver'

/** Shared between the pointer handlers: a drag that just ended must not also count as a click. */
export const dragState = { active: false, suppressClick: false }

export interface DragSession {
  sketchId: string
  /** The sketch as it was when the drag began. */
  base: Sketch
  /** A point ref ("l1.a") or a whole entity id. */
  ref: string
  /** Where the pointer went down, in sketch coordinates. */
  grab: Vec2
  /** Pixel position of the pointer-down, to tell a drag from a click. */
  startClient: [number, number]
  started: boolean
}

export function beginDrag(sketchId: string, base: Sketch, ref: string, grab: Vec2, startClient: [number, number]): DragSession {
  return { sketchId, base, ref, grab, startClient, started: false }
}

/** Solves with the pointer at `to` and shows the result. Unconstrained or fully pinned geometry stays put. */
export function updateDrag(s: DragSession, to: Vec2) {
  const r = solveSketch(s.base, { drag: { ref: s.ref, to, grab: s.grab } })
  s.started = true
  dragState.active = true
  useSketchUi.getState().set({ preview: r.entities })
}

function changed(before: SketchEntity[], after: SketchEntity[]): boolean {
  return after.some((e, i) => e !== before[i])
}

/** Ends the drag. Commits the last previewed result once, unless it is cancelled or nothing moved. */
export function endDrag(s: DragSession, commit: boolean) {
  const ui = useSketchUi.getState()
  const result = ui.preview
  ui.set({ preview: null })
  const wasDragging = s.started
  dragState.active = false
  if (wasDragging) {
    dragState.suppressClick = true
    setTimeout(() => {
      dragState.suppressClick = false
    }, 0)
  }
  if (commit && wasDragging && result && changed(s.base.entities, result)) moveSketchGeometry(s.sketchId, result)
}

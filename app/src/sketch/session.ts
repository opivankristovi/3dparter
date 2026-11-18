// Entering and leaving sketch mode. The sketch itself lives in the document; this only tracks which one is open.
import { useProjectStore } from '../doc/store'
import type { OriginPlaneName } from '../doc/types'
import { useToolStore } from '../screens/workspace/toolStore'
import { createSketch } from './commands'

/** Creates a sketch on a plane (one undo step) and opens it. */
export function startSketchOn(plane: OriginPlaneName): string {
  const id = createSketch(plane)
  enterSketch(id)
  return id
}

/** Opens an existing sketch for drawing. */
export function enterSketch(id: string) {
  const s = useProjectStore.getState()
  useToolStore.getState().clearDraft()
  useToolStore.getState().setActiveSketch(id)
  s.setSelection([])
  s.setEditingFeature(id)
}

/** Leaves sketch mode but keeps whichever tool is active. */
export function endSketch() {
  const s = useProjectStore.getState()
  useToolStore.getState().setActiveSketch(null)
  s.setEditingFeature(null)
  s.setSelection([])
}

/** The Finish sketch button and Esc: leave sketch mode and drop the tool. */
export function finishSketch() {
  endSketch()
  useProjectStore.getState().setActiveTool(null)
}

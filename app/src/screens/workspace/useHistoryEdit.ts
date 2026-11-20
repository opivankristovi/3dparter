// Clicking a History row opens that step for editing: a sketch re-enters sketch mode, a modeling step opens its card.
import { useEffect } from 'react'
import { activeCount } from '../../doc/history'
import { useProjectStore } from '../../doc/store'
import { cloneForEdit, selectionForFeature, toolForFeature } from '../../modeling/logic'
import { enterSketch } from '../../sketch/session'
import { useToolStore } from './toolStore'

export function useHistoryEdit() {
  const editingId = useProjectStore((s) => s.editingFeatureId)
  const features = useProjectStore((s) => s.doc.features)
  const draft = useToolStore((s) => s.draft)
  const activeSketchId = useToolStore((s) => s.activeSketchId)

  useEffect(() => {
    if (!editingId) return
    const at = features.findIndex((x) => x.id === editingId)
    const f = features[at]
    if (!f) return
    const s = useProjectStore.getState()
    // A step after the rollback marker is not built, so it cannot be edited.
    if (at >= activeCount(s.doc)) {
      s.setEditingFeature(null)
      return
    }
    if (f.type === 'sketch') {
      if (activeSketchId !== f.id) {
        enterSketch(f.id)
        s.setActiveTool(null)
      }
      return
    }
    const tool = toolForFeature(f.type)
    if (tool && draft?.id !== f.id) {
      useToolStore.getState().setActiveSketch(null)
      useToolStore.getState().setDraft(cloneForEdit(f), f.id)
      s.setSelection(selectionForFeature(f))
      s.setActiveTool(tool)
    }
  }, [editingId, features, draft, activeSketchId])

  // A sketch that no longer exists (undo) cannot stay open.
  useEffect(() => {
    if (activeSketchId && !features.some((f) => f.id === activeSketchId)) useToolStore.getState().setActiveSketch(null)
  }, [activeSketchId, features])
}

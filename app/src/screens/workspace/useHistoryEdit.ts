// Clicking a History row opens that step for editing: a sketch re-enters sketch mode, an extrude opens its card.
import { useEffect } from 'react'
import { useProjectStore } from '../../doc/store'
import { enterSketch } from '../../sketch/session'
import { useToolStore } from './toolStore'

export function useHistoryEdit() {
  const editingId = useProjectStore((s) => s.editingFeatureId)
  const features = useProjectStore((s) => s.doc.features)
  const draft = useToolStore((s) => s.draft)
  const activeSketchId = useToolStore((s) => s.activeSketchId)

  useEffect(() => {
    if (!editingId) return
    const f = features.find((x) => x.id === editingId)
    if (!f) return
    const s = useProjectStore.getState()
    if (f.type === 'sketch') {
      if (activeSketchId !== f.id) {
        enterSketch(f.id)
        s.setActiveTool(null)
      }
    } else if (f.type === 'extrude' && draft?.id !== f.id) {
      useToolStore.getState().setActiveSketch(null)
      useToolStore.getState().setDraft(
        { ...f, params: { ...f.params, profiles: [...f.params.profiles], targets: [...f.params.targets] } },
        f.id,
      )
      s.setSelection(f.params.profiles)
      s.setActiveTool('extrude')
    }
  }, [editingId, features, draft, activeSketchId])

  // A sketch that no longer exists (undo) cannot stay open.
  useEffect(() => {
    if (activeSketchId && !features.some((f) => f.id === activeSketchId)) useToolStore.getState().setActiveSketch(null)
  }, [activeSketchId, features])
}

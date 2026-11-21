import { useProjectStore } from '../../doc/store'
import type { TextEntity } from '../../doc/types'

/** Adds a new text entity to a sketch, or replaces the stored one, as one undo step. */
export function commitText(sketchId: string, entity: TextEntity, isNew: boolean) {
  useProjectStore.getState().apply(isNew ? 'Add text' : 'Edit text', (draft) => {
    const f = draft.features.find((x) => x.id === sketchId)
    if (f?.type !== 'sketch') return
    if (isNew) {
      f.sketch.entities.push(entity)
      return
    }
    const i = f.sketch.entities.findIndex((e) => e.id === entity.id)
    if (i >= 0) f.sketch.entities[i] = entity
  })
}

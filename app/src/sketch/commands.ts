// Sketch edits. Each call is exactly one undo step.
import { addFeature, newId, nextFeatureName } from '../doc/commands'
import { useProjectStore } from '../doc/store'
import type { OriginPlaneName, SketchEntity, SketchFeature } from '../doc/types'

/** Creates an empty sketch on an origin plane ("Sketch N") and returns its id. */
export function createSketch(plane: OriginPlaneName): string {
  const doc = useProjectStore.getState().doc
  const feature: SketchFeature = {
    id: newId(),
    type: 'sketch',
    name: nextFeatureName(doc, 'sketch'),
    suppressed: false,
    params: { on: { kind: 'originPlane', name: plane } },
    sketch: { entities: [], constraints: [] },
  }
  addFeature(feature, feature.name)
  return feature.id
}

export function addSketchEntities(sketchId: string, entities: SketchEntity[], label: string) {
  if (entities.length === 0) return
  useProjectStore.getState().apply(label, (draft) => {
    const f = draft.features.find((x) => x.id === sketchId)
    if (f?.type === 'sketch') f.sketch.entities.push(...entities)
  })
}

export function deleteSketchEntities(sketchId: string, entityIds: string[]) {
  if (entityIds.length === 0) return
  useProjectStore.getState().apply('Delete sketch line', (draft) => {
    const f = draft.features.find((x) => x.id === sketchId)
    if (f?.type !== 'sketch') return
    const gone = new Set(entityIds)
    f.sketch.entities = f.sketch.entities.filter((e) => !gone.has(e.id))
  })
}

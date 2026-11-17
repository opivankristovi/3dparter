// Document commands. Each one is exactly one undo step (one call to store.apply).
import { useProjectStore } from './store'
import type { ExtrudeFeature, Feature, ProjectDocument, SketchFeature } from './types'

export function newId(): string {
  return crypto.randomUUID()
}

const TYPE_LABEL: Record<Feature['type'], string> = { sketch: 'Sketch', extrude: 'Extrude' }

/** "Sketch 1", "Extrude 2", ... The number is one more than the highest in use for that type. */
export function nextFeatureName(doc: ProjectDocument, type: Feature['type']): string {
  const base = TYPE_LABEL[type]
  let max = 0
  for (const f of doc.features) {
    if (f.type !== type) continue
    const m = new RegExp(`^${base} (\\d+)$`).exec(f.name)
    if (m) max = Math.max(max, Number(m[1]))
  }
  return `${base} ${max + 1}`
}

function nextBodyName(doc: ProjectDocument): string {
  const used = new Set(Object.values(doc.bodies).map((b) => b.name))
  for (let n = Object.keys(doc.bodies).length + 1; ; n++) {
    if (!used.has(`Body ${n}`)) return `Body ${n}`
  }
}

/** A feature that starts a new solid owns a bodies entry keyed by its id. */
function syncBodyEntry(draft: ProjectDocument, f: Feature) {
  const makesBody = f.type === 'extrude' && f.params.mode === 'new'
  if (makesBody && !draft.bodies[f.id]) {
    draft.bodies[f.id] = { name: nextBodyName(draft), color: null, opacity: 1, visible: true, itemFolderId: null }
  } else if (!makesBody && draft.bodies[f.id]) {
    delete draft.bodies[f.id]
  }
}

export function addFeature(feature: Feature, label = `Add ${feature.name}`) {
  useProjectStore.getState().apply(label, (draft) => {
    draft.features.push(feature)
    syncBodyEntry(draft, feature)
  })
}

type ParamsPatch = Partial<SketchFeature['params']> & Partial<ExtrudeFeature['params']>

export function updateFeatureParams(id: string, partial: ParamsPatch, label = 'Edit feature') {
  useProjectStore.getState().apply(label, (draft) => {
    const f = draft.features.find((x) => x.id === id)
    if (!f) return
    Object.assign(f.params, partial)
    syncBodyEntry(draft, f)
  })
}

export function deleteFeature(id: string) {
  useProjectStore.getState().apply('Delete feature', (draft) => {
    const idx = draft.features.findIndex((x) => x.id === id)
    if (idx < 0) return
    draft.features.splice(idx, 1)
    delete draft.bodies[id]
    if (draft.rollbackIndex !== null) draft.rollbackIndex = Math.min(draft.rollbackIndex, draft.features.length)
  })
}

export function renameFeature(id: string, name: string) {
  const clean = name.trim()
  if (!clean) return
  useProjectStore.getState().apply('Rename feature', (draft) => {
    const f = draft.features.find((x) => x.id === id)
    if (f) f.name = clean
  })
}

export function setBodyVisible(bodyId: string, visible: boolean) {
  useProjectStore.getState().apply(visible ? 'Show body' : 'Hide body', (draft) => {
    const b = draft.bodies[bodyId]
    if (b) b.visible = visible
  })
}

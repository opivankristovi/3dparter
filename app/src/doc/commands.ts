// Document commands. Each one is exactly one undo step (one call to store.apply).
import { activeCount, canMove, describeMove, moveOutcome, reorder, rollbackFromCount } from './history'
import { evalExpr } from './expr'
import { expectMove } from './moveGuard'
import { useProjectStore } from './store'
import type { BodyAppearance, Feature, ProjectDocument } from './types'
import { scopeOf } from './variables'

export function newId(): string {
  return crypto.randomUUID()
}

const TYPE_LABEL: Record<Feature['type'], string> = {
  sketch: 'Sketch',
  extrude: 'Extrude',
  revolve: 'Revolve',
  sweep: 'Sweep',
  loft: 'Loft',
  fillet: 'Fillet',
  chamfer: 'Chamfer',
  shell: 'Shell',
  boolean: 'Combine',
  transform: 'Move',
  scale: 'Scale',
  split: 'Split',
  mirror: 'Mirror',
  pattern: 'Pattern',
  plane: 'Plane',
  import: 'Import',
}

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

/** A feature that starts a new solid owns a bodies entry keyed by its id (or `<id>:<n>` for multi-body outputs). */
export function syncBodyEntry(draft: ProjectDocument, f: Feature) {
  const syncCopies = (count: number) => {
    const wanted = new Set<string>()
    for (let i = 1; i <= count; i++) {
      const key = `${f.id}:${i}`
      wanted.add(key)
      if (!draft.bodies[key]) {
        draft.bodies[key] = { name: nextBodyName(draft), color: null, opacity: 1, visible: true, itemFolderId: null }
      }
    }
    const prefix = `${f.id}:`
    for (const key of Object.keys(draft.bodies)) {
      if (key.startsWith(prefix) && !wanted.has(key)) delete draft.bodies[key]
    }
  }
  if (f.type === 'transform') {
    syncCopies(f.params.copy ? f.params.bodies.length : 0)
    return
  }
  if (f.type === 'split') {
    syncCopies(1)
    return
  }
  if (f.type === 'mirror') {
    syncCopies(!f.params.merge ? f.params.bodies.length : 0)
    return
  }
  if (f.type === 'pattern') {
    const r = evalExpr(f.params.count, scopeOf(draft))
    const raw = Math.round(r.ok ? r.value : Number(f.params.count) || 2)
    const count = Math.max(2, Math.min(50, Number.isFinite(raw) ? raw : 2))
    syncCopies((count - 1) * f.params.bodies.length)
    return
  }
  if (f.type === 'import') {
    if (!draft.bodies[f.id]) {
      draft.bodies[f.id] = { name: nextBodyName(draft), color: null, opacity: 1, visible: true, itemFolderId: null }
    }
    return
  }
  const makesBody = (f.type === 'extrude' || f.type === 'revolve' || f.type === 'sweep' || f.type === 'loft') && f.params.mode === 'new'
  if (makesBody && !draft.bodies[f.id]) {
    draft.bodies[f.id] = { name: nextBodyName(draft), color: null, opacity: 1, visible: true, itemFolderId: null }
  } else if (!makesBody && draft.bodies[f.id]) {
    delete draft.bodies[f.id]
  }
}

export function addFeature(feature: Feature, label = `Add ${feature.name}`) {
  useProjectStore.getState().apply(label, (draft) => {
    // While rolled back, a new step goes right after the marker and the marker takes it in.
    const r = draft.rollbackIndex
    if (r !== null && r < draft.features.length - 1) {
      draft.features.splice(Math.max(-1, r) + 1, 0, feature)
      draft.rollbackIndex = Math.max(-1, r) + 1
    } else {
      draft.features.push(feature)
      draft.rollbackIndex = null
    }
    syncBodyEntry(draft, feature)
  })
}

/** Any of a feature's parameters; the caller knows which feature it edits. */
type ParamsPatch = Record<string, unknown>

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
    const prefix = `${id}:`
    for (const key of Object.keys(draft.bodies)) {
      if (key.startsWith(prefix)) delete draft.bodies[key]
    }
    // An active step leaves: one fewer before the marker. A step after the marker changes nothing.
    if (draft.rollbackIndex !== null) {
      const r = idx <= draft.rollbackIndex ? draft.rollbackIndex - 1 : draft.rollbackIndex
      draft.rollbackIndex = r >= draft.features.length - 1 ? null : r
    }
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

export function setBodyAppearance(bodyId: string, partial: Partial<Pick<BodyAppearance, 'color' | 'opacity'>>) {
  useProjectStore.getState().apply('Change solid appearance', (draft) => {
    const b = draft.bodies[bodyId]
    if (!b) return
    if (partial.color !== undefined) b.color = partial.color
    if (partial.opacity !== undefined) b.opacity = partial.opacity
  })
}

export type MoveResult = { ok: true; message: string } | { ok: false; message: string }

/**
 * Moves a step so that it ends up at `toIndex`. The names decide first (history.ts); an impossible move changes
 * nothing. The kernel check afterwards (moveGuard.ts) puts the move back if a step that built now fails.
 * The moved step keeps its side of the rollback marker unless it crosses a step on the other side, or `active` says.
 */
export function moveFeature(id: string, toIndex: number, opts?: { active?: boolean }): MoveResult {
  const store = useProjectStore.getState()
  const before = store.doc
  const from = before.features.findIndex((f) => f.id === id)
  if (from < 0) return { ok: false, message: 'That step is gone.' }
  const check = canMove(before, from, toIndex)
  if (!check.ok) return check
  const n = before.features.length
  const outcome = moveOutcome(n, activeCount(before), from, toIndex, opts?.active)
  const rollbackIndex = rollbackFromCount(outcome.active, n)
  if (from === toIndex && rollbackIndex === before.rollbackIndex) return { ok: true, message: describeMove(before, from, toIndex) }
  const name = before.features[from].name
  let message = describeMove(before, from, toIndex)
  const wasActive = from < activeCount(before)
  const nowActive = toIndex < outcome.active
  if (before.rollbackIndex !== null || rollbackIndex !== null) {
    if (wasActive && !nowActive) message += ' It is now after the end of history.'
    else if (!wasActive && nowActive) message += ' It is now before the end of history.'
  }
  store.apply(`Move ${name}`, (draft) => {
    draft.features = reorder(draft.features, from, toIndex)
    draft.rollbackIndex = rollbackIndex
  })
  expectMove(before, id, name)
  return { ok: true, message }
}

/**
 * Puts the rollback marker after step `index` (the last active step); null (or the last step) shows every step.
 * Nothing is deleted. -1 means no step is active.
 */
export function setRollback(index: number | null) {
  useProjectStore.getState().apply('Roll back', (draft) => {
    const n = draft.features.length
    draft.rollbackIndex = index === null || index >= n - 1 ? null : Math.max(-1, Math.trunc(index))
  })
}

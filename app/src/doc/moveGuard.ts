// The kernel half of "can this step move here?". The pure check (history.ts) catches what the names say;
// this catches what only OpenCascade can tell: after a move, any step that built before and fails now
// puts the move back. The result is read for exactly the document the move produced, never an older one.
import { create } from 'zustand'
import { newlyBroken } from './history'
import { useProjectStore } from './store'
import type { ProjectDocument } from './types'

export type StatusMap = Record<string, { ok: boolean }>

interface Settled {
  /** Ids of the steps the kernel replayed, in order. */
  order: string[]
  rollbackIndex: number | null
  statuses: StatusMap
}

interface Pending {
  doc: ProjectDocument
  order: string[]
  rollbackIndex: number | null
  movedId: string
  movedName: string
  okBefore: Set<string>
  names: Map<string, string>
}

/** The text a screen reader should hear (History live region). */
export const useHistoryNotice = create<{ announcement: string; announce(text: string): void }>()((set) => ({
  announcement: '',
  announce: (text) => set({ announcement: text }),
}))

let latest: Settled | null = null
let pending: Pending | null = null

const sameIds = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i])

/** Called by `moveFeature` right after the move was applied; `before` is the document the move started from. */
export function expectMove(before: ProjectDocument, movedId: string, movedName: string) {
  pending = null
  const after = useProjectStore.getState().doc
  const order = before.features.map((f) => f.id)
  // Without a result for the document as it was, there is no baseline to compare with.
  if (!latest || !sameIds(latest.order, order) || latest.rollbackIndex !== before.rollbackIndex) return
  const okBefore = new Set(order.filter((id) => latest!.statuses[id]?.ok))
  pending = {
    doc: after,
    order: after.features.map((f) => f.id),
    rollbackIndex: after.rollbackIndex,
    movedId,
    movedName,
    okBefore,
    names: new Map(after.features.map((f) => [f.id, f.name])),
  }
}

/**
 * Feed every finished regenerate here. Returns the message to show when it put a move back, else null.
 * `order` is the list of steps the kernel replayed (an open draft may be one more than the document has).
 */
export function reportSettled(order: string[], rollbackIndex: number | null, statuses: StatusMap): string | null {
  latest = { order, rollbackIndex, statuses }
  const p = pending
  if (!p) return null
  const store = useProjectStore.getState()
  // The document moved on (another edit, undo): the move is no longer the latest step. Stop watching.
  if (store.doc !== p.doc) {
    pending = null
    return null
  }
  const known = new Set(p.order)
  const seen = order.filter((id) => known.has(id))
  if (!sameIds(seen, p.order) || rollbackIndex !== p.rollbackIndex) return null // a result for an older document
  pending = null
  const broken = newlyBroken(p.okBefore, statuses, p.order)
  if (broken.length === 0) return null
  store.undo()
  store.discardRedo()
  const others = broken.filter((id) => id !== p.movedId)
  let message: string
  if (others.length === 0) {
    message = `${p.movedName} cannot be built here, so it was put back.`
  } else {
    const first = p.names.get(others[0]) ?? 'a later step'
    const more = others.length > 1 ? ` and ${others.length - 1} more` : ''
    message = `Moving ${p.movedName} here breaks ${first}${more}, so it was put back.`
  }
  useHistoryNotice.getState().announce(message)
  return message
}

/** Tests: forget everything. */
export function resetMoveGuard() {
  latest = null
  pending = null
  useHistoryNotice.getState().announce('')
}

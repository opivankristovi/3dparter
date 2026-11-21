// History rules that need no kernel: which earlier steps each step needs, whether a step may move, and the
// rollback marker arithmetic. Pure functions over the document, so the UI and the commands share them.
//
// Marker semantics: `rollbackIndex` is the index of the LAST ACTIVE step; null means every step is active.
// -1 means no step is active. "active count" = number of steps before the marker.
import type { Feature, ProjectDocument, Ref } from './types'

export type MoveCheck = { ok: true } | { ok: false; message: string }

/** Face, edge and region names are '/'-joined paths of feature ids and local names. */
const SEPARATORS = /[/|#,]/

function segments(name: string): string[] {
  return name.split(SEPARATORS).filter(Boolean)
}

interface RefUse {
  ref: Ref
  /** The step needs the whole body as it was (every earlier change to it), not just a piece of its shape. */
  wholeBody: boolean
}

function refUses(f: Feature): RefUse[] {
  const piece = (refs: Ref[]) => refs.map((ref) => ({ ref, wholeBody: false }))
  const whole = (refs: Ref[]) => refs.map((ref) => ({ ref, wholeBody: true }))
  switch (f.type) {
    case 'sketch':
      return piece([f.params.on])
    case 'extrude':
      return [...piece(f.params.profiles), ...whole(f.params.targets)]
    case 'revolve':
      return [...piece(f.params.profiles), ...piece([f.params.axis]), ...whole(f.params.targets)]
    case 'sweep':
      return [...piece([f.params.profile, f.params.path]), ...whole(f.params.targets)]
    case 'loft':
      return [...piece(f.params.profiles), ...whole(f.params.targets)]
    case 'fillet':
    case 'chamfer':
      return piece(f.params.edges)
    case 'shell':
      return [...whole([f.params.body]), ...piece(f.params.removeFaces)]
    case 'boolean':
      return whole([f.params.target, ...f.params.tools])
    case 'transform':
      return whole(f.params.bodies)
    case 'split':
      return [...whole([f.params.body]), ...piece([f.params.plane])]
    case 'mirror':
      return [...whole(f.params.bodies), ...piece([f.params.plane])]
    case 'pattern':
      return [...whole(f.params.bodies), ...piece([f.params.axis])]
    case 'plane':
      return piece([f.params.base])
    case 'import':
      return []
  }
}

/**
 * For every step, the ids of the EARLIER steps it needs (ordered by position).
 * - a sketch region, a sketch edge or a plane names the step that made it;
 * - a face or edge names the step that made it (the ids in its name) and the step that created its body;
 * - a body used as a whole (join, cut, combine, shell, move) also needs every earlier step that changed it.
 * A body is named after the step that created it. Conservative on purpose: the kernel has the last word.
 */
export function featureDeps(doc: ProjectDocument): Map<string, string[]> {
  const features = doc.features
  const indexOf = new Map(features.map((f, i) => [f.id, i]))
  /** body name -> indices of the steps that created or changed it */
  const changers = new Map<string, number[]>()
  /** a feature id (or '<transformId>:<n>') -> the bodies its faces live in now */
  const owners = new Map<string, Set<string>>()
  const result = new Map<string, string[]>()

  const featureOf = (seg: string): string | undefined => {
    if (indexOf.has(seg)) return seg
    const colon = seg.indexOf(':')
    if (colon > 0 && indexOf.has(seg.slice(0, colon))) return seg.slice(0, colon)
    return undefined
  }
  const bodiesOf = (ref: Ref): Set<string> => {
    const out = new Set<string>()
    if (ref.kind === 'body') out.add(ref.name)
    for (const seg of segments(ref.name)) {
      for (const b of owners.get(seg) ?? []) out.add(b)
      if (changers.has(seg)) out.add(seg)
    }
    return out
  }
  const touch = (bodies: Iterable<string>, i: number) => {
    for (const b of bodies) {
      const list = changers.get(b) ?? []
      list.push(i)
      changers.set(b, list)
    }
  }

  features.forEach((f, i) => {
    const deps = new Set<number>()
    for (const { ref, wholeBody } of refUses(f)) {
      for (const seg of segments(ref.name)) {
        const id = featureOf(seg)
        const j = id === undefined ? undefined : indexOf.get(id)
        if (j !== undefined && j < i) deps.add(j)
      }
      for (const b of bodiesOf(ref)) {
        const list = (changers.get(b) ?? []).filter((j) => j < i)
        if (wholeBody) for (const j of list) deps.add(j)
        else if (list.length > 0) deps.add(list[0])
      }
    }
    result.set(
      f.id,
      [...deps].sort((a, b) => a - b).map((j) => features[j].id),
    )

    // What this step does to the bodies, for the steps after it.
    const union = (refs: Ref[]) => {
      const out = new Set<string>()
      for (const r of refs) for (const b of bodiesOf(r)) out.add(b)
      return out
    }
    switch (f.type) {
      case 'extrude':
      case 'revolve':
      case 'sweep':
      case 'loft': {
        if (f.params.mode === 'new') {
          changers.set(f.id, [i])
          owners.set(f.id, new Set([f.id]))
        } else {
          const targets = union(f.params.targets)
          touch(targets, i)
          owners.set(f.id, targets)
        }
        break
      }
      case 'import': {
        changers.set(f.id, [i])
        owners.set(f.id, new Set([f.id]))
        break
      }
      case 'boolean': {
        const target = union([f.params.target])
        const tools = union(f.params.tools)
        touch(target, i)
        touch(tools, i)
        owners.set(f.id, target)
        for (const set of owners.values()) {
          if ([...tools].some((t) => set.has(t))) for (const t of target) set.add(t)
        }
        break
      }
      case 'fillet':
      case 'chamfer': {
        const bodies = union(f.params.edges)
        touch(bodies, i)
        owners.set(f.id, bodies)
        break
      }
      case 'shell': {
        const bodies = union([f.params.body, ...f.params.removeFaces])
        touch(bodies, i)
        owners.set(f.id, bodies)
        break
      }
      case 'transform':
      case 'mirror': {
        const bodies = union(f.params.bodies)
        touch(bodies, i)
        owners.set(f.id, bodies)
        const copy = f.type === 'transform' ? f.params.copy : !f.params.merge
        if (copy) {
          for (let n = 1; n <= f.params.bodies.length; n++) {
            const key = `${f.id}:${n}`
            changers.set(key, [i])
            owners.set(key, new Set([key]))
          }
        }
        break
      }
      case 'split': {
        const bodies = union([f.params.body])
        touch(bodies, i)
        owners.set(f.id, bodies)
        const key = `${f.id}:1`
        changers.set(key, [i])
        owners.set(key, new Set([key]))
        break
      }
      case 'pattern': {
        const bodies = union(f.params.bodies)
        touch(bodies, i)
        owners.set(f.id, bodies)
        const count = Math.max(2, Math.min(50, Math.round(Number(f.params.count) || 2)))
        const total = (count - 1) * f.params.bodies.length
        for (let n = 1; n <= total; n++) {
          const key = `${f.id}:${n}`
          changers.set(key, [i])
          owners.set(key, new Set([key]))
        }
        break
      }
      default:
        break
    }
  })
  return result
}

/** The list with the item at `from` moved so that it ends up at `to`. */
export function reorder<T>(list: readonly T[], from: number, to: number): T[] {
  const next = list.slice()
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next
}

/** Whether the step at `fromIndex` may end up at `toIndex` without a step coming before something it needs. */
export function canMove(doc: ProjectDocument, fromIndex: number, toIndex: number): MoveCheck {
  const n = doc.features.length
  const valid = (i: number) => Number.isInteger(i) && i >= 0 && i < n
  if (!valid(fromIndex) || !valid(toIndex)) return { ok: false, message: 'That place is outside the history.' }
  if (fromIndex === toIndex) return { ok: true }
  const deps = featureDeps(doc)
  const order = reorder(doc.features, fromIndex, toIndex)
  const position = new Map(order.map((f, i) => [f.id, i]))
  for (const f of order) {
    for (const d of deps.get(f.id) ?? []) {
      if ((position.get(d) ?? 0) > (position.get(f.id) ?? 0)) {
        const name = doc.features.find((x) => x.id === d)?.name ?? 'an earlier step'
        return { ok: false, message: `${f.name} uses ${name}, so it has to stay after it.` }
      }
    }
  }
  return { ok: true }
}

/** Number of steps before the marker (all of them when there is no marker). */
export function activeCount(doc: ProjectDocument): number {
  const n = doc.features.length
  if (doc.rollbackIndex === null) return n
  return Math.min(n, Math.max(0, doc.rollbackIndex + 1))
}

/** The `rollbackIndex` that leaves `count` steps active out of `n`. */
export function rollbackFromCount(count: number, n: number): number | null {
  if (count >= n) return null
  return Math.max(0, count) - 1
}

/**
 * How many steps are active after the step at `from` moves to `to`. The moved step keeps its side of the
 * marker, unless it crosses to the far side of a step that sits on the other side, or `active` says where it goes.
 */
export function moveOutcome(n: number, active: number, from: number, to: number, forceActive?: boolean): { active: number } {
  const wasActive = from < active
  const others = active - (wasActive ? 1 : 0)
  const isActive = forceActive ?? (wasActive ? to <= others : to < others)
  return { active: Math.min(n, others + (isActive ? 1 : 0)) }
}

/** "Fillet 1 moved above Chamfer 1." (`to` is where the step ended up; `before` is the document before the move.) */
export function describeMove(before: ProjectDocument, from: number, to: number): string {
  const name = before.features[from]?.name ?? 'Step'
  const other = before.features[to]?.name
  if (!other || from === to) return `${name} stays where it is.`
  return `${name} moved ${to < from ? 'above' : 'below'} ${other}.`
}

/** Steps that built before a change and fail after it. */
export function newlyBroken(
  okBefore: ReadonlySet<string>,
  statuses: Record<string, { ok: boolean }>,
  order: readonly string[],
): string[] {
  return order.filter((id) => okBefore.has(id) && statuses[id] && !statuses[id].ok)
}

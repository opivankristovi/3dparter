// @vitest-environment node
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../data/db'
import { createProject } from '../data/projects'
import { addFeature, deleteFeature, moveFeature, newId, setRollback } from './commands'
import { reportSettled, resetMoveGuard } from './moveGuard'
import { useProjectStore } from './store'
import type { Feature } from './types'

const s = () => useProjectStore.getState()
const names = () => s().doc.features.map((f) => f.name)

function sketch(name: string): Feature {
  return {
    id: newId(),
    name,
    suppressed: false,
    type: 'sketch',
    params: { on: { kind: 'originPlane', name: 'XY' } },
    sketch: { entities: [], constraints: [] },
  }
}
function extrude(name: string, sk: Feature): Feature {
  return {
    id: newId(),
    name,
    suppressed: false,
    type: 'extrude',
    params: { profiles: [{ kind: 'sketchRegion', name: `${sk.id}/region:a` }], distance: '10', direction: 1, mode: 'new', targets: [] },
  }
}
function fillet(name: string, ex: Feature, side: string): Feature {
  return {
    id: newId(),
    name,
    suppressed: false,
    type: 'fillet',
    params: { edges: [{ kind: 'edge', name: `${ex.id}/cap:end|${ex.id}/side/${side}` }], radius: '1' },
  }
}

/** Sketch 1, Extrude 1, Fillet 1, Fillet 2 (two blends on different edges). */
async function boxWithTwoBlends() {
  useProjectStore.getState().close()
  await db.projects.clear()
  resetMoveGuard()
  const p = await createProject('T')
  await s().load(p.id)
  const sk = sketch('Sketch 1')
  const ex = extrude('Extrude 1', sk)
  const f1 = fillet('Fillet 1', ex, 'a')
  const f2 = fillet('Fillet 2', ex, 'b')
  for (const f of [sk, ex, f1, f2]) addFeature(f)
  return { sk, ex, f1, f2 }
}

beforeEach(() => {
  useProjectStore.getState().close()
})

describe('setRollback', () => {
  it('sets the marker, clamps it, and is one undo step', async () => {
    await boxWithTwoBlends()
    setRollback(1)
    expect(s().doc.rollbackIndex).toBe(1)
    expect(names()).toHaveLength(4) // nothing deleted
    setRollback(-5)
    expect(s().doc.rollbackIndex).toBe(-1)
    setRollback(3)
    expect(s().doc.rollbackIndex).toBeNull()
    setRollback(99)
    expect(s().doc.rollbackIndex).toBeNull()
    setRollback(2)
    s().undo()
    expect(s().doc.rollbackIndex).toBeNull()
    setRollback(2)
    setRollback(null)
    expect(s().doc.rollbackIndex).toBeNull()
  })
})

describe('addFeature while rolled back', () => {
  it('inserts right after the marker and moves the marker to include it', async () => {
    await boxWithTwoBlends()
    setRollback(1) // Sketch 1, Extrude 1 active
    addFeature(sketch('Sketch 2'))
    expect(names()).toEqual(['Sketch 1', 'Extrude 1', 'Sketch 2', 'Fillet 1', 'Fillet 2'])
    expect(s().doc.rollbackIndex).toBe(2)
    s().undo()
    expect(names()).toEqual(['Sketch 1', 'Extrude 1', 'Fillet 1', 'Fillet 2'])
    expect(s().doc.rollbackIndex).toBe(1)
  })

  it('appends when there is no marker', async () => {
    await boxWithTwoBlends()
    addFeature(sketch('Sketch 2'))
    expect(names().at(-1)).toBe('Sketch 2')
    expect(s().doc.rollbackIndex).toBeNull()
  })
})

describe('deleteFeature and the marker', () => {
  it('deleting an active step moves the marker up, an inactive one leaves it', async () => {
    const { f1, f2 } = await boxWithTwoBlends()
    setRollback(2) // Sketch 1, Extrude 1, Fillet 1 active
    deleteFeature(f1.id)
    expect(s().doc.rollbackIndex).toBe(1)
    setRollback(0)
    deleteFeature(f2.id) // inactive
    expect(s().doc.rollbackIndex).toBe(0)
  })

  it('deleting the last inactive step ends the rollback', async () => {
    const { f2 } = await boxWithTwoBlends()
    setRollback(2)
    deleteFeature(f2.id)
    expect(s().doc.rollbackIndex).toBeNull()
  })
})

describe('moveFeature', () => {
  it('moves a step in one undo step', async () => {
    const { f1, f2 } = await boxWithTwoBlends()
    const r = moveFeature(f2.id, 2)
    expect(r.ok).toBe(true)
    expect(names()).toEqual(['Sketch 1', 'Extrude 1', 'Fillet 2', 'Fillet 1'])
    s().undo()
    expect(names()).toEqual(['Sketch 1', 'Extrude 1', 'Fillet 1', 'Fillet 2'])
    s().redo()
    expect(s().doc.features[2].id).toBe(f2.id)
    expect(s().doc.features[3].id).toBe(f1.id)
  })

  it('refuses a move that puts a step before what it uses and changes nothing', async () => {
    const { ex } = await boxWithTwoBlends()
    const before = s().doc
    const r = moveFeature(ex.id, 0)
    expect(r).toEqual({ ok: false, message: 'Extrude 1 uses Sketch 1, so it has to stay after it.' })
    expect(s().doc).toBe(before)
    s().undo()
    expect(names()).toEqual(['Sketch 1', 'Extrude 1', 'Fillet 1']) // the undo took the last add, not a move
  })

  it('keeps the marker where it is when a step moves within one side', async () => {
    const { f2 } = await boxWithTwoBlends()
    setRollback(2)
    moveFeature(f2.id, 3) // inactive stays inactive
    expect(s().doc.rollbackIndex).toBe(2)
  })

  it('a step dragged across the marker changes the active count', async () => {
    const { f1 } = await boxWithTwoBlends()
    setRollback(2) // active: Sketch 1, Extrude 1, Fillet 1
    expect(moveFeature(f1.id, 3).ok).toBe(true) // Fillet 1 goes behind Fillet 2: inactive
    expect(names()).toEqual(['Sketch 1', 'Extrude 1', 'Fillet 2', 'Fillet 1'])
    expect(s().doc.rollbackIndex).toBe(1)
  })

  it('can place a step on a chosen side of the marker', async () => {
    const { f2 } = await boxWithTwoBlends()
    setRollback(2)
    moveFeature(f2.id, 2, { active: true }) // Fillet 2 above Fillet 1, joins the active steps
    expect(names()).toEqual(['Sketch 1', 'Extrude 1', 'Fillet 2', 'Fillet 1'])
    expect(s().doc.rollbackIndex).toBeNull() // all four are active now: no marker
  })

  it('reports the move for a screen reader', async () => {
    const { f2 } = await boxWithTwoBlends()
    const r = moveFeature(f2.id, 2)
    expect(r).toEqual({ ok: true, message: 'Fillet 2 moved above Fillet 1.' })
  })
})

describe('kernel check after a move', () => {
  const ok = (ids: string[]) => Object.fromEntries(ids.map((id) => [id, { ok: true }]))

  it('puts the move back and names the broken step when a step that built now fails', async () => {
    const { sk, ex, f1, f2 } = await boxWithTwoBlends()
    const order = [sk, ex, f1, f2].map((f) => f.id)
    expect(reportSettled(order, null, ok(order))).toBeNull() // baseline: all fine
    moveFeature(f2.id, 2)
    const moved = [sk, ex, f2, f1].map((f) => f.id)
    // a stale result for the old order changes nothing
    expect(reportSettled(order, null, ok(order))).toBeNull()
    expect(names()).toEqual(['Sketch 1', 'Extrude 1', 'Fillet 2', 'Fillet 1'])
    const message = reportSettled(moved, null, { ...ok(moved), [f1.id]: { ok: false } })
    expect(message).toBe('Moving Fillet 2 here breaks Fillet 1, so it was put back.')
    expect(names()).toEqual(['Sketch 1', 'Extrude 1', 'Fillet 1', 'Fillet 2'])
  })

  it('says so when the moved step itself no longer builds', async () => {
    const { sk, ex, f1, f2 } = await boxWithTwoBlends()
    const order = [sk, ex, f1, f2].map((f) => f.id)
    reportSettled(order, null, ok(order))
    moveFeature(f2.id, 2)
    const moved = [sk, ex, f2, f1].map((f) => f.id)
    const message = reportSettled(moved, null, { ...ok(moved), [f2.id]: { ok: false } })
    expect(message).toBe('Fillet 2 cannot be built here, so it was put back.')
    expect(names()).toEqual(['Sketch 1', 'Extrude 1', 'Fillet 1', 'Fillet 2'])
  })

  it('keeps the move when everything still builds, and ignores steps that were already failing', async () => {
    const { sk, ex, f1, f2 } = await boxWithTwoBlends()
    const order = [sk, ex, f1, f2].map((f) => f.id)
    reportSettled(order, null, { ...ok(order), [f1.id]: { ok: false } }) // Fillet 1 was already broken
    moveFeature(f2.id, 2)
    const moved = [sk, ex, f2, f1].map((f) => f.id)
    expect(reportSettled(moved, null, { ...ok(moved), [f1.id]: { ok: false } })).toBeNull()
    expect(names()).toEqual(['Sketch 1', 'Extrude 1', 'Fillet 2', 'Fillet 1'])
  })

  it('does nothing when the document changed after the move', async () => {
    const { sk, ex, f1, f2 } = await boxWithTwoBlends()
    const order = [sk, ex, f1, f2].map((f) => f.id)
    reportSettled(order, null, ok(order))
    moveFeature(f2.id, 2)
    addFeature(sketch('Sketch 2'))
    const moved = [sk, ex, f2, f1].map((f) => f.id)
    expect(reportSettled(moved, null, { ...ok(moved), [f1.id]: { ok: false } })).toBeNull()
    expect(names()).toHaveLength(5)
  })

  it('has no baseline before the first result: no check, no undo', async () => {
    const { sk, ex, f1, f2 } = await boxWithTwoBlends()
    moveFeature(f2.id, 2)
    const moved = [sk, ex, f2, f1].map((f) => f.id)
    expect(reportSettled(moved, null, { ...ok(moved), [f1.id]: { ok: false } })).toBeNull()
    expect(names()).toEqual(['Sketch 1', 'Extrude 1', 'Fillet 2', 'Fillet 1'])
  })
})

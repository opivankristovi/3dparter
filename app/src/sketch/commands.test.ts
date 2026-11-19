// @vitest-environment node
import 'fake-indexeddb/auto'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../data/db'
import { createProject } from '../data/projects'
import { useProjectStore } from '../doc/store'
import type { Sketch } from '../doc/types'
import {
  addConstraint,
  addSketchEntities,
  createSketch,
  deleteConstraints,
  deleteSketchEntities,
  moveSketchGeometry,
  setConstraintValue,
  toggleConstruction,
} from './commands'
import { SolverNotReadyError, solveSketch } from './solver/solver'
import { con, lineOf, readySolver, rectSketch } from './solver/testutil'

const st = () => useProjectStore.getState()
function current(sid: string): Sketch {
  const f = st().doc.features.find((x) => x.id === sid)
  if (f?.type !== 'sketch') throw new Error('no sketch')
  return f.sketch
}

async function newSketch() {
  st().close()
  await db.projects.clear()
  const p = await createProject('T')
  await st().load(p.id)
  return createSketch('XY')
}

describe('without the solver', () => {
  it('constraint commands throw a clear error', async () => {
    const sid = await newSketch()
    expect(() => addConstraint(sid, con('horizontal', ['x']))).toThrow(SolverNotReadyError)
    expect(() => setConstraintValue(sid, 'x', '1')).toThrow(/not initialised/)
  })
  it('plain addSketchEntities still works', async () => {
    const sid = await newSketch()
    addSketchEntities(sid, rectSketch().entities, 'Add rectangle')
    expect(current(sid).entities).toHaveLength(4)
  })
})

describe('sketch commands', () => {
  beforeAll(async () => {
    await readySolver()
  })
  beforeEach(() => {
    // each test makes its own project
  })

  async function withRect() {
    const sid = await newSketch()
    const base = rectSketch()
    const dropped = addSketchEntities(sid, base.entities, 'Add rectangle', base.constraints)
    expect(dropped).toEqual([])
    return sid
  }

  it('addSketchEntities with constraints is one undo step and keeps a rectangle', async () => {
    const sid = await newSketch()
    const before = st().canUndo
    const base = rectSketch()
    addSketchEntities(sid, base.entities, 'Add rectangle', base.constraints)
    expect(current(sid).constraints).toHaveLength(8)
    expect(solveSketch(current(sid)).dof).toBe(4)
    st().undo()
    expect(current(sid).entities).toHaveLength(0)
    expect(current(sid).constraints).toHaveLength(0)
    expect(st().canUndo).toBe(before) // only createSketch is left
  })

  it('refuses a conflicting constraint and leaves the document alone', async () => {
    const sid = await withRect()
    expect(addConstraint(sid, con('length', ['r0'], '40')).ok).toBe(true)
    const snapshot = JSON.stringify(st().doc)
    const res = addConstraint(sid, con('vertical', ['r0']))
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.conflicting.length).toBeGreaterThan(0)
      expect(res.reason).toBeTruthy()
    }
    expect(JSON.stringify(st().doc)).toBe(snapshot)
  })

  it('refuses a vertical on a horizontal line even without a length', async () => {
    const sid = await withRect()
    const snapshot = JSON.stringify(st().doc)
    const res = addConstraint(sid, con('vertical', ['r0']))
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.conflicting.length).toBeGreaterThan(0)
    expect(JSON.stringify(st().doc)).toBe(snapshot)
  })

  it('refuses a redundant constraint', async () => {
    const sid = await withRect()
    expect(addConstraint(sid, con('horizontal', ['r0'])).ok).toBe(false)
  })

  it('refuses a malformed constraint', async () => {
    const sid = await withRect()
    const res = addConstraint(sid, con('radius', ['r0'], '5'))
    expect(res.ok).toBe(false)
  })

  it('changing a length value moves the geometry; 0 and -1 are refused', async () => {
    const sid = await withRect()
    const len = con('length', ['r0'], '40')
    expect(addConstraint(sid, len).ok).toBe(true)
    expect(addConstraint(sid, con('coincident', ['r0.a', 'origin'])).ok).toBe(true)
    expect(lineOf(current(sid).entities, 'r0').b[0]).toBeCloseTo(40, 6)

    expect(setConstraintValue(sid, len.id, '65').ok).toBe(true)
    const s = current(sid)
    expect(lineOf(s.entities, 'r0').b[0]).toBeCloseTo(65, 6)
    expect(s.constraints.find((c) => c.id === len.id)?.value).toBe('65')

    const snapshot = JSON.stringify(st().doc)
    expect(setConstraintValue(sid, len.id, '0').ok).toBe(false)
    expect(setConstraintValue(sid, len.id, '-1').ok).toBe(false)
    expect(setConstraintValue(sid, len.id, 'abc').ok).toBe(false)
    expect(JSON.stringify(st().doc)).toBe(snapshot)

    st().undo()
    expect(lineOf(current(sid).entities, 'r0').b[0]).toBeCloseTo(40, 6)
  })

  it('deleting an entity deletes the constraints that reference it', async () => {
    const sid = await withRect()
    deleteSketchEntities(sid, ['r0'])
    const s = current(sid)
    expect(s.entities.map((e) => e.id)).toEqual(['r1', 'r2', 'r3'])
    for (const c of s.constraints) expect(c.entityIds.every((r) => !r.startsWith('r0'))).toBe(true)
    expect(s.constraints.length).toBeGreaterThan(0)
    st().undo()
    expect(current(sid).constraints).toHaveLength(8)
  })

  it('deleteConstraints, toggleConstruction, moveSketchGeometry are single undo steps', async () => {
    const sid = await withRect()
    const first = current(sid).constraints[0].id
    deleteConstraints(sid, [first])
    expect(current(sid).constraints).toHaveLength(7)
    st().undo()
    expect(current(sid).constraints).toHaveLength(8)

    toggleConstruction(sid, ['r0', 'r1'])
    expect(current(sid).entities.filter((e) => e.construction).map((e) => e.id)).toEqual(['r0', 'r1'])
    toggleConstruction(sid, ['r0', 'r1'])
    expect(current(sid).entities.some((e) => e.construction)).toBe(false)

    const moved = solveSketch(current(sid), { drag: { ref: 'r1.b', to: [80, 70] } })
    moveSketchGeometry(sid, moved.entities)
    expect(lineOf(current(sid).entities, 'r1').b[0]).toBeCloseTo(80, 5)
    st().undo()
    expect(lineOf(current(sid).entities, 'r1').b[0]).toBeCloseTo(50, 5)
  })

  it('drops inferred constraints that would conflict instead of breaking the sketch', async () => {
    const sid = await newSketch()
    const base = rectSketch()
    // A second, vertical constraint on a line that inference already made horizontal.
    const extra = con('vertical', ['r0'])
    const dropped = addSketchEntities(sid, base.entities, 'Add rectangle', [...base.constraints, extra])
    expect(dropped.map((c) => c.id)).toEqual([extra.id])
    expect(current(sid).constraints).toHaveLength(8)
  })
})

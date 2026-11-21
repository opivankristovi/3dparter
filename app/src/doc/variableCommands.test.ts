// @vitest-environment node
import 'fake-indexeddb/auto'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../data/db'
import { createProject } from '../data/projects'
import { addConstraint, addSketchEntities, createSketch } from '../sketch/commands'
import { solveSketch } from '../sketch/solver/solver'
import { con, lineOf, readySolver, rectSketch } from '../sketch/solver/testutil'
import { addFeature, newId } from './commands'
import { useProjectStore } from './store'
import type { ExtrudeFeature, Sketch } from './types'
import { addVariable, deleteVariable, renameVariable, setVariableExpression } from './variableCommands'

const st = () => useProjectStore.getState()

beforeAll(async () => {
  await readySolver()
})

beforeEach(async () => {
  st().close()
  await db.projects.clear()
  const p = await createProject('T')
  await st().load(p.id)
})

const varId = (name: string) => st().doc.variables.find((v) => v.name === name)!.id
const sketchOf = (id: string): Sketch => {
  const f = st().doc.features.find((x) => x.id === id)
  if (f?.type !== 'sketch') throw new Error('no sketch')
  return f.sketch
}
const extrude = (distance: string): ExtrudeFeature => ({
  id: newId(),
  name: 'Extrude 1',
  suppressed: false,
  type: 'extrude',
  params: { profiles: [], distance, direction: 1, mode: 'new', targets: [] },
})

/** A rectangle whose bottom edge is driven by "w * 2" and whose right edge is 30. */
function sketchWithVariable() {
  expect(addVariable('w', '15')).toEqual({ ok: true })
  const sid = createSketch('XY')
  const base = rectSketch()
  addSketchEntities(sid, base.entities, 'Add rectangle', base.constraints)
  expect(addConstraint(sid, con('length', ['r0'], 'w * 2')).ok).toBe(true)
  expect(addConstraint(sid, con('length', ['r1'], '30')).ok).toBe(true)
  expect(addConstraint(sid, con('coincident', ['r0.a', 'origin'])).ok).toBe(true)
  return sid
}
const bottomLength = (sid: string) => {
  const l = lineOf(sketchOf(sid).entities, 'r0')
  return Math.hypot(l.b[0] - l.a[0], l.b[1] - l.a[1])
}

describe('addVariable', () => {
  it('adds one variable as one undo step', () => {
    expect(addVariable('width', '40')).toEqual({ ok: true })
    expect(st().doc.variables).toMatchObject([{ name: 'width', expression: '40' }])
    expect(st().doc.variables[0].id).toBeTruthy()
    st().undo()
    expect(st().doc.variables).toEqual([])
    st().redo()
    expect(st().doc.variables).toHaveLength(1)
  })
  it('refuses a bad name, a duplicate, and an expression with an error', () => {
    expect(addVariable('width', '40').ok).toBe(true)
    for (const [n, e] of [['width', '1'], ['sqrt', '1'], ['a b', '1'], ['x', '1/0'], ['y', 'nope'], ['z', 'z + 1'], ['q', '']] as const) {
      const r = addVariable(n, e)
      expect(r.ok, `${n} = ${e}`).toBe(false)
      if (!r.ok) expect(r.message.endsWith('.')).toBe(true)
    }
    expect(st().doc.variables).toHaveLength(1)
  })
  it('lets a new variable use an earlier one', () => {
    addVariable('a', '4')
    expect(addVariable('b', 'a * 2').ok).toBe(true)
  })
})

describe('setVariableExpression', () => {
  it('changes the expression as one undo step', () => {
    addVariable('w', '15')
    const id = varId('w')
    expect(setVariableExpression(id, '20')).toEqual({ ok: true })
    expect(st().doc.variables[0].expression).toBe('20')
    st().undo()
    expect(st().doc.variables[0].expression).toBe('15')
  })
  it('refuses an expression with an error, a cycle, or one that breaks another variable', () => {
    addVariable('a', '4')
    addVariable('b', '10 / a')
    const a = varId('a')
    expect(setVariableExpression(a, '0').ok).toBe(false) // b would divide by zero
    expect(setVariableExpression(a, 'b').ok).toBe(false) // cycle
    expect(setVariableExpression(a, 'nope').ok).toBe(false)
    expect(setVariableExpression('missing', '1').ok).toBe(false)
    expect(st().doc.variables[0].expression).toBe('4')
    const r = setVariableExpression(a, 'b')
    if (!r.ok) expect(r.message).toMatch(/→/)
  })
  it('re-solves every sketch that uses it, in the same undo step', () => {
    const sid = sketchWithVariable()
    expect(bottomLength(sid)).toBeCloseTo(30, 6)
    const undoDepthMarker = JSON.stringify(st().doc)
    expect(setVariableExpression(varId('w'), '20')).toEqual({ ok: true })
    expect(bottomLength(sid)).toBeCloseTo(40, 6)
    expect(solveSketch(sketchOf(sid), { scope: new Map([['w', 20]]) }).dof).toBe(0)
    st().undo() // ONE step restores both the variable and the geometry
    expect(JSON.stringify(st().doc)).toBe(undoDepthMarker)
    expect(bottomLength(sid)).toBeCloseTo(30, 6)
  })
  it('refuses, and changes nothing, when a sketch could not be solved', () => {
    const sid = sketchWithVariable()
    const before = JSON.stringify(st().doc)
    const r = setVariableExpression(varId('w'), '0')
    expect(r).toEqual({ ok: false, message: 'Sketch 1 can no longer be solved with this value.' })
    expect(JSON.stringify(st().doc)).toBe(before)
    expect(bottomLength(sid)).toBeCloseTo(30, 6)
  })
  it('leaves sketches alone when no dimension uses a variable', () => {
    const sid = createSketch('XY')
    const base = rectSketch()
    addSketchEntities(sid, base.entities, 'Add rectangle', base.constraints)
    addVariable('w', '15')
    const before = JSON.stringify(sketchOf(sid))
    expect(setVariableExpression(varId('w'), '20').ok).toBe(true)
    expect(JSON.stringify(sketchOf(sid))).toBe(before)
  })
  it('re-solves a sketch driven by a derived variable when the base variable changes, in one undo step', () => {
    expect(addVariable('w', '30').ok).toBe(true)
    expect(addVariable('h', 'w / 2').ok).toBe(true)
    const sid = createSketch('XY')
    const base = rectSketch()
    addSketchEntities(sid, base.entities, 'Add rectangle', base.constraints)
    expect(addConstraint(sid, con('length', ['r0'], 'h')).ok).toBe(true)
    expect(addConstraint(sid, con('length', ['r1'], '30')).ok).toBe(true)
    expect(addConstraint(sid, con('coincident', ['r0.a', 'origin'])).ok).toBe(true)
    expect(bottomLength(sid)).toBeCloseTo(15, 6)
    const before = JSON.stringify(st().doc)
    expect(setVariableExpression(varId('w'), '50')).toEqual({ ok: true })
    expect(bottomLength(sid)).toBeCloseTo(25, 6)
    st().undo()
    expect(JSON.stringify(st().doc)).toBe(before)
    expect(bottomLength(sid)).toBeCloseTo(15, 6)
  })
  it('refuses changing a base variable when a derived variable would make a sketch unsolvable', () => {
    expect(addVariable('w', '30').ok).toBe(true)
    expect(addVariable('h', 'w - 10').ok).toBe(true)
    const sid = createSketch('XY')
    const base = rectSketch()
    addSketchEntities(sid, base.entities, 'Add rectangle', base.constraints)
    expect(addConstraint(sid, con('length', ['r0'], 'h')).ok).toBe(true)
    expect(addConstraint(sid, con('length', ['r1'], '30')).ok).toBe(true)
    expect(addConstraint(sid, con('coincident', ['r0.a', 'origin'])).ok).toBe(true)
    const before = JSON.stringify(st().doc)
    const r = setVariableExpression(varId('w'), '10')
    expect(r).toEqual({ ok: false, message: 'Sketch 1 can no longer be solved with this value.' })
    expect(st().doc.variables.find((v) => v.name === 'w')?.expression).toBe('30')
    expect(JSON.stringify(st().doc)).toBe(before)
  })
})

describe('renameVariable', () => {
  it('rewrites variables, feature fields and sketch dimensions, in one undo step', () => {
    const sid = sketchWithVariable()
    addVariable('w2', 'w * 2')
    addFeature(extrude('w / 2 + 1'))
    const before = JSON.stringify(st().doc)
    expect(renameVariable(varId('w'), 'width')).toEqual({ ok: true })
    const d = st().doc
    expect(d.variables.map((v) => [v.name, v.expression])).toEqual([['width', '15'], ['w2', 'width * 2']])
    const ex = d.features.find((f) => f.type === 'extrude')!
    expect(ex.type === 'extrude' && ex.params.distance).toBe('width / 2 + 1')
    expect(sketchOf(sid).constraints.find((c) => c.type === 'length' && c.entityIds[0] === 'r0')!.value).toBe('width * 2')
    expect(bottomLength(sid)).toBeCloseTo(30, 6)
    st().undo()
    expect(JSON.stringify(st().doc)).toBe(before)
  })
  it('refuses a duplicate, a reserved or an invalid name', () => {
    addVariable('a', '1')
    addVariable('b', '2')
    for (const n of ['b', 'pi', 'mm', '1x', '']) expect(renameVariable(varId('a'), n).ok, n).toBe(false)
    expect(st().doc.variables[0].name).toBe('a')
    expect(renameVariable('missing', 'zzz').ok).toBe(false)
  })
  it('is a no-op success when the name does not change', () => {
    addVariable('a', '1')
    const depth = st().canUndo
    expect(renameVariable(varId('a'), 'a')).toEqual({ ok: true })
    expect(st().doc.variables[0].name).toBe('a')
    expect(st().canUndo).toBe(depth)
  })
})

describe('deleteVariable', () => {
  it('deletes an unused variable as one undo step', () => {
    addVariable('a', '1')
    expect(deleteVariable(varId('a'))).toEqual({ ok: true })
    expect(st().doc.variables).toEqual([])
    st().undo()
    expect(st().doc.variables).toHaveLength(1)
  })
  it('refuses while the variable is used and lists the uses', () => {
    sketchWithVariable()
    addVariable('w2', 'w + 1')
    addFeature(extrude('w'))
    const r = deleteVariable(varId('w'))
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.message).toContain('w2')
      expect(r.message).toContain('Extrude 1 (Distance)')
      expect(r.message).toContain('Sketch 1')
      expect(r.uses).toHaveLength(3)
    }
    expect(st().doc.variables.map((v) => v.name)).toEqual(['w', 'w2'])
  })
  it('refuses an unknown id', () => {
    expect(deleteVariable('missing').ok).toBe(false)
  })
})

// @vitest-environment node
// Text size and rotation that follow variables: re-evaluated in the same undo step as the variable change.
import 'fake-indexeddb/auto'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../data/db'
import { createProject } from '../data/projects'
import { addSketchEntities, createSketch } from '../sketch/commands'
import { readySolver } from '../sketch/solver/testutil'
import { useProjectStore } from './store'
import type { TextEntity } from './types'
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
const textOf = (sid: string): TextEntity => {
  const f = st().doc.features.find((x) => x.id === sid)
  if (f?.type !== 'sketch') throw new Error('no sketch')
  return f.sketch.entities.find((e): e is TextEntity => e.type === 'text')!
}
function textSketch(over: Partial<TextEntity> = {}): string {
  expect(addVariable('h', '12')).toEqual({ ok: true })
  const sid = createSketch('XY')
  addSketchEntities(
    sid,
    [{ id: 't1', type: 'text', construction: false, position: [0, 0], text: 'Hi', size: 24, sizeExpr: 'h * 2', rotation: 0, ...over }],
    'Add text',
  )
  return sid
}

describe('text size and rotation follow variables', () => {
  it('re-evaluates the size when the variable changes, in one undo step', () => {
    const sid = textSketch()
    const before = JSON.stringify(st().doc)
    expect(setVariableExpression(varId('h'), '20')).toEqual({ ok: true })
    expect(textOf(sid).size).toBe(40)
    st().undo() // ONE step restores both the variable and the text size
    expect(JSON.stringify(st().doc)).toBe(before)
    expect(textOf(sid).size).toBe(24)
  })

  it('re-evaluates the rotation (degrees) into radians', () => {
    const sid = textSketch({ sizeExpr: undefined, size: 10, rotationExpr: 'h * 5', rotation: Math.PI })
    expect(setVariableExpression(varId('h'), '18')).toEqual({ ok: true })
    expect(textOf(sid).rotation).toBeCloseTo((90 * Math.PI) / 180, 9)
  })

  it('refuses a change that makes the size zero or less and leaves the document alone', () => {
    const sid = textSketch()
    const r = setVariableExpression(varId('h'), '0')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.message).toMatch(/text/i)
    expect(textOf(sid).size).toBe(24)
    expect(st().doc.variables.find((v) => v.name === 'h')!.expression).toBe('12')
  })

  it('leaves text with a plain size alone', () => {
    const sid = textSketch({ sizeExpr: undefined, size: 7 })
    expect(setVariableExpression(varId('h'), '30')).toEqual({ ok: true })
    expect(textOf(sid).size).toBe(7)
  })

  it('renames the variable inside the text formulas and blocks deleting a used variable', () => {
    const sid = textSketch()
    expect(renameVariable(varId('h'), 'height')).toEqual({ ok: true })
    expect(textOf(sid).sizeExpr).toBe('height * 2')
    const del = deleteVariable(varId('height'))
    expect(del.ok).toBe(false)
  })
})

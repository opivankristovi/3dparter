// @vitest-environment node
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../data/db'
import { createProject, getProject } from '../data/projects'
import { addFeature, deleteFeature, newId, nextFeatureName } from './commands'
import { flushSaves, useProjectStore } from './store'
import type { ExtrudeFeature, SketchFeature } from './types'

const sketch = (name = 'Sketch 1'): SketchFeature => ({
  id: newId(),
  name,
  suppressed: false,
  type: 'sketch',
  params: { on: { kind: 'originPlane', name: 'XY' } },
  sketch: { entities: [], constraints: [] },
})

beforeEach(async () => {
  useProjectStore.getState().close()
  await db.projects.clear()
})

async function open() {
  const p = await createProject('T')
  expect(await useProjectStore.getState().load(p.id)).toBe('ok')
  return p.id
}

describe('project store', () => {
  it('returns not-found for a missing project', async () => {
    expect(await useProjectStore.getState().load('nope')).toBe('not-found')
  })

  it('apply, undo, redo round-trip', async () => {
    await open()
    const s = useProjectStore.getState
    expect(s().canUndo).toBe(false)
    addFeature(sketch())
    expect(s().doc.features).toHaveLength(1)
    expect(s().canUndo).toBe(true)
    s().undo()
    expect(s().doc.features).toHaveLength(0)
    expect(s().canRedo).toBe(true)
    s().redo()
    expect(s().doc.features).toHaveLength(1)
    expect(s().canRedo).toBe(false)
  })

  it('a new apply clears redo', async () => {
    await open()
    const s = useProjectStore.getState
    addFeature(sketch('Sketch 1'))
    s().undo()
    expect(s().canRedo).toBe(true)
    addFeature(sketch('Sketch 2'))
    expect(s().canRedo).toBe(false)
    s().redo()
    expect(s().doc.features.map((f) => f.name)).toEqual(['Sketch 2'])
  })

  it('saves after the debounce and bumps the revision', async () => {
    const id = await open()
    addFeature(sketch())
    expect(useProjectStore.getState().saveState).toBe('saving')
    await flushSaves()
    expect(useProjectStore.getState().saveState).toBe('saved')
    const row = await getProject(id)
    expect(row?.revision).toBe(2)
    expect(row?.document.features).toHaveLength(1)
  })

  it('reports a conflict when another writer saved first', async () => {
    const id = await open()
    await db.projects.update(id, { revision: 5 })
    addFeature(sketch())
    await flushSaves()
    expect(useProjectStore.getState().saveState).toBe('conflict')
  })

  it('deleting an extrude removes the body it created', async () => {
    await open()
    const sk = sketch()
    const ex: ExtrudeFeature = {
      id: newId(),
      name: 'Extrude 1',
      suppressed: false,
      type: 'extrude',
      params: { profiles: [], distance: '5', direction: 1, mode: 'new', targets: [] },
    }
    addFeature(sk)
    addFeature(ex)
    expect(Object.keys(useProjectStore.getState().doc.bodies)).toEqual([ex.id])
    deleteFeature(ex.id)
    expect(useProjectStore.getState().doc.bodies).toEqual({})
    useProjectStore.getState().undo()
    expect(Object.keys(useProjectStore.getState().doc.bodies)).toEqual([ex.id])
  })

  it('names features by type', async () => {
    await open()
    addFeature(sketch('Sketch 1'))
    const doc = useProjectStore.getState().doc
    expect(nextFeatureName(doc, 'sketch')).toBe('Sketch 2')
    expect(nextFeatureName(doc, 'extrude')).toBe('Extrude 1')
  })
})

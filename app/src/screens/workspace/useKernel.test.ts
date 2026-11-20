// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { emptyDocument } from '../../doc/types'
import type { Feature, ProjectDocument } from '../../doc/types'
import { effectiveDocument } from './useKernel'

const sketch = (id: string): Feature => ({
  id,
  name: id,
  suppressed: false,
  type: 'sketch',
  params: { on: { kind: 'originPlane', name: 'XY' } },
  sketch: { entities: [], constraints: [] },
})

const docOf = (rollbackIndex: number | null): ProjectDocument => ({
  ...emptyDocument(),
  features: [sketch('a'), sketch('b'), sketch('c')],
  rollbackIndex,
})

describe('effectiveDocument with a draft', () => {
  const draft = sketch('d')
  const ids = (d: ProjectDocument) => d.features.map((f) => f.id)

  it('appends a new draft when nothing is rolled back', () => {
    const d = effectiveDocument(docOf(null), draft, null)
    expect(ids(d)).toEqual(['a', 'b', 'c', 'd'])
    expect(d.rollbackIndex).toBeNull()
  })

  it('puts a new draft right after the marker and moves the marker over it, like the step it will become', () => {
    const d = effectiveDocument(docOf(0), draft, null)
    expect(ids(d)).toEqual(['a', 'd', 'b', 'c'])
    expect(d.rollbackIndex).toBe(1)
  })

  it('swaps a draft that edits an existing step in place', () => {
    const d = effectiveDocument(docOf(1), { ...draft, id: 'b' }, 'b')
    expect(ids(d)).toEqual(['a', 'b', 'c'])
    expect(d.rollbackIndex).toBe(1)
  })
})

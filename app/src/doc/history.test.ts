import { describe, expect, it } from 'vitest'
import { activeCount, canMove, featureDeps, moveOutcome, rollbackFromCount } from './history'
import { emptyDocument } from './types'
import type { Feature, ProjectDocument, Ref } from './types'

const plane: Ref = { kind: 'originPlane', name: 'XY' }
const base = { suppressed: false }

const sketch = (id: string, on: Ref = plane): Feature => ({
  ...base,
  id,
  name: id,
  type: 'sketch',
  params: { on },
  sketch: { entities: [], constraints: [] },
})
const extrude = (id: string, sk: string, mode: 'new' | 'union' | 'subtract' | 'intersect' = 'new', targets: string[] = []): Feature => ({
  ...base,
  id,
  name: id,
  type: 'extrude',
  params: {
    profiles: [{ kind: 'sketchRegion', name: `${sk}/region:a,b` }],
    distance: '10',
    direction: 1,
    mode,
    targets: targets.map((t) => ({ kind: 'body', name: t })),
  },
})
const edge = (a: string, b: string): Ref => ({ kind: 'edge', name: `${a}|${b}` })
const fillet = (id: string, edges: Ref[]): Feature => ({ ...base, id, name: id, type: 'fillet', params: { edges, radius: '1' } })
const chamfer = (id: string, edges: Ref[]): Feature => ({ ...base, id, name: id, type: 'chamfer', params: { edges, distance: '1' } })

const mk = (features: Feature[], rollbackIndex: number | null = null): ProjectDocument => ({ ...emptyDocument(), features, rollbackIndex })

// A box with two edges on different faces: a fillet and a chamfer, one after the other.
const box = () => [
  sketch('Sketch 1'),
  extrude('Extrude 1', 'Sketch 1'),
  fillet('Fillet 1', [edge('Extrude 1/cap:end', 'Extrude 1/side/a')]),
  chamfer('Chamfer 1', [edge('Extrude 1/cap:end', 'Extrude 1/side/b')]),
]

describe('featureDeps', () => {
  it('an extrude needs its sketch, a fillet needs its extrude', () => {
    const d = featureDeps(mk(box()))
    expect(d.get('Sketch 1')).toEqual([])
    expect(d.get('Extrude 1')).toEqual(['Sketch 1'])
    expect(d.get('Fillet 1')).toEqual(['Extrude 1'])
    expect(d.get('Chamfer 1')).toEqual(['Extrude 1'])
  })

  it('a fillet on a face made by another fillet needs that fillet', () => {
    const f = [...box().slice(0, 3), fillet('Fillet 2', [edge('Fillet 1/blend/x', 'Extrude 1/side/c')])]
    expect(featureDeps(mk(f)).get('Fillet 2')).toEqual(expect.arrayContaining(['Extrude 1', 'Fillet 1']))
  })

  it('a sketch on a face needs the step that made the face', () => {
    const f = [...box().slice(0, 2), sketch('Sketch 2', { kind: 'face', name: 'Extrude 1/cap:end' })]
    expect(featureDeps(mk(f)).get('Sketch 2')).toEqual(['Extrude 1'])
  })

  it('a join needs the body it joins and every earlier step that changed that body', () => {
    const f = [...box(), sketch('Sketch 2'), extrude('Extrude 2', 'Sketch 2', 'union', ['Extrude 1'])]
    const d = featureDeps(mk(f)).get('Extrude 2')!
    expect(d).toEqual(expect.arrayContaining(['Sketch 2', 'Extrude 1', 'Fillet 1', 'Chamfer 1']))
  })

  it('a boolean needs the creators of target and tools', () => {
    const f: Feature[] = [
      sketch('S1'),
      extrude('E1', 'S1'),
      sketch('S2'),
      extrude('E2', 'S2'),
      {
        ...base,
        id: 'B1',
        name: 'B1',
        type: 'boolean',
        params: { op: 'subtract', target: { kind: 'body', name: 'E1' }, tools: [{ kind: 'body', name: 'E2' }], keepTools: false },
      },
    ]
    expect(featureDeps(mk(f)).get('B1')).toEqual(expect.arrayContaining(['E1', 'E2']))
  })

  it('a revolve needs the sketch of its profile and axis; a plane needs its base', () => {
    const f: Feature[] = [
      sketch('S1'),
      {
        ...base,
        id: 'R1',
        name: 'R1',
        type: 'revolve',
        params: {
          profiles: [{ kind: 'sketchRegion', name: 'S1/region:a' }],
          axis: { kind: 'sketchEdge', name: 'S1/axis' },
          angle: '360',
          mode: 'new',
          targets: [],
        },
      },
      { ...base, id: 'P1', name: 'P1', type: 'plane', params: { base: { kind: 'face', name: 'R1/cap:start' }, offset: '5', angle: '0' } },
      sketch('S2', { kind: 'constructionPlane', name: 'P1' }),
    ]
    const d = featureDeps(mk(f))
    expect(d.get('R1')).toEqual(['S1'])
    expect(d.get('P1')).toEqual(['R1'])
    expect(d.get('S2')).toEqual(['P1'])
  })

  it('a transform copy is a body of its own: a fillet on its edge needs the transform', () => {
    const f: Feature[] = [
      sketch('S1'),
      extrude('E1', 'S1'),
      { ...base, id: 'T1', name: 'T1', type: 'transform', params: { bodies: [{ kind: 'body', name: 'E1' }], translate: ['10', '0', '0'], rotate: null, copy: true } },
      fillet('F1', [edge('T1:1/E1/cap:end', 'T1:1/E1/side/a')]),
    ]
    expect(featureDeps(mk(f)).get('F1')).toEqual(expect.arrayContaining(['T1']))
  })
})

describe('canMove', () => {
  it('lets a fillet and a chamfer on different edges swap', () => {
    const doc = mk(box())
    expect(canMove(doc, 3, 2)).toEqual({ ok: true })
    expect(canMove(doc, 2, 3)).toEqual({ ok: true })
  })

  it('refuses to move a step above the one it uses, with the reason', () => {
    const doc = mk(box())
    expect(canMove(doc, 1, 0)).toEqual({ ok: false, message: 'Extrude 1 uses Sketch 1, so it has to stay after it.' })
    expect(canMove(doc, 2, 0)).toEqual({ ok: false, message: 'Fillet 1 uses Extrude 1, so it has to stay after it.' })
  })

  it('refuses to move a step below one that uses it', () => {
    const doc = mk(box())
    expect(canMove(doc, 0, 3)).toMatchObject({ ok: false, message: 'Extrude 1 uses Sketch 1, so it has to stay after it.' })
  })

  it('a move to the same place is fine, an index out of range is not', () => {
    const doc = mk(box())
    expect(canMove(doc, 2, 2)).toEqual({ ok: true })
    expect(canMove(doc, 2, 9).ok).toBe(false)
    expect(canMove(doc, -1, 1).ok).toBe(false)
  })

  it('an independent sketch can move anywhere before its extrude', () => {
    const doc = mk([sketch('S1'), sketch('S2'), extrude('E1', 'S2')])
    expect(canMove(doc, 1, 0)).toEqual({ ok: true })
    expect(canMove(doc, 0, 1)).toEqual({ ok: true })
    expect(canMove(doc, 0, 2)).toEqual({ ok: true })
  })
})

describe('marker arithmetic', () => {
  it('activeCount and rollbackFromCount', () => {
    expect(activeCount(mk(box()))).toBe(4)
    expect(activeCount(mk(box(), 1))).toBe(2)
    expect(activeCount(mk(box(), -1))).toBe(0)
    expect(activeCount(mk(box(), 40))).toBe(4)
    expect(rollbackFromCount(4, 4)).toBeNull()
    expect(rollbackFromCount(2, 4)).toBe(1)
    expect(rollbackFromCount(0, 4)).toBe(-1)
  })

  it('moveOutcome keeps the side of the moved row unless told otherwise', () => {
    // 5 rows, 3 active (indices 0..2)
    expect(moveOutcome(5, 3, 0, 2)).toEqual({ active: 3 }) // inside the active zone
    expect(moveOutcome(5, 3, 3, 4)).toEqual({ active: 3 }) // inside the inactive zone
    expect(moveOutcome(5, 3, 1, 4)).toEqual({ active: 2 }) // an active row leaves
    expect(moveOutcome(5, 3, 4, 0)).toEqual({ active: 4 }) // an inactive row arrives
    expect(moveOutcome(5, 3, 3, 3)).toEqual({ active: 3 })
    expect(moveOutcome(5, 3, 0, 4, true)).toEqual({ active: 3 }) // forced to stay active
    expect(moveOutcome(5, 3, 4, 1, false)).toEqual({ active: 3 }) // forced to stay inactive
    expect(moveOutcome(5, 5, 0, 4)).toEqual({ active: 5 }) // no marker: all active
  })
})

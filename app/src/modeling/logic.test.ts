import { describe, expect, it } from 'vitest'
import type {
  BodyAppearance,
  ExtrudeFeature,
  FilletFeature,
  PlaneFeature,
  Ref,
  RevolveFeature,
  ShellFeature,
  TransformFeature,
} from '../doc/types'
import {
  bodyOfFace,
  cloneForEdit,
  combineParts,
  combineSelection,
  countLabel,
  defaultTargets,
  cutDirection,
  isPreviewable,
  meshVolume,
  sameVolume,
  newCombine,
  sameRefSet,
  sameSketchRegions,
  selectionForFeature,
  toggleRef,
  toggleTarget,
  toolForFeature,
} from './logic'

const body = (name: string): Ref => ({ kind: 'body', name })
const edge = (name: string): Ref => ({ kind: 'edge', name })
const app = (visible = true): BodyAppearance => ({ name: 'B', color: null, opacity: 1, visible, itemFolderId: null })

describe('toggleRef', () => {
  it('adds a new reference at the end and removes one that is there', () => {
    const a = edge('a|b')
    const b = edge('c|d')
    expect(toggleRef([a], b)).toEqual([a, b])
    expect(toggleRef([a, b], a)).toEqual([b])
    expect(toggleRef([], a)).toEqual([a])
  })
  it('tells kinds apart', () => {
    expect(toggleRef([edge('x')], body('x'))).toHaveLength(2)
  })
})

describe('sameRefSet / countLabel', () => {
  it('ignores order', () => {
    expect(sameRefSet([body('a'), body('b')], [body('b'), body('a')])).toBe(true)
    expect(sameRefSet([body('a')], [body('a'), body('b')])).toBe(false)
  })
  it('counts in words', () => {
    expect(countLabel(1, 'edge')).toBe('1 edge')
    expect(countLabel(3, 'edge')).toBe('3 edges')
    expect(countLabel(0, 'edge')).toBe('0 edges')
  })
})

describe('defaultTargets', () => {
  const bodies = { a: app(), b: app(false), c: app(), own: app() }
  it('is every visible live solid except the feature own one', () => {
    expect(defaultTargets(['a', 'b', 'c', 'own'], 'own', bodies)).toEqual([body('a'), body('c')])
  })
  it('skips solids the kernel no longer reports', () => {
    expect(defaultTargets(['c'], 'own', bodies)).toEqual([body('c')])
  })
  it('is empty before the kernel has answered', () => {
    expect(defaultTargets(null, 'own', bodies)).toEqual([])
  })
})

describe('toggleTarget', () => {
  const all = [body('a'), body('b'), body('c')]
  it('the first click restricts to that solid', () => {
    expect(toggleTarget(all, all, body('b'))).toEqual([body('b')])
  })
  it('a later click adds, another removes', () => {
    expect(toggleTarget([body('b')], all, body('c'))).toEqual([body('b'), body('c')])
    expect(toggleTarget([body('b'), body('c')], all, body('b'))).toEqual([body('c')])
  })
  it('removing the last one goes back to all solids', () => {
    expect(toggleTarget([body('b')], all, body('b'))).toEqual(all)
  })
  it('a click on something that is not a candidate changes nothing', () => {
    const cur = [body('a')]
    expect(toggleTarget(cur, all, body('zzz'))).toBe(cur)
  })
})

describe('combine', () => {
  it('the first solid picked is the target', () => {
    expect(combineParts([body('a'), body('b'), body('c')])).toEqual({ target: body('a'), tools: [body('b'), body('c')] })
    expect(combineParts([edge('x'), body('b')])).toEqual({ target: body('b'), tools: [] })
    expect(combineParts([])).toEqual({ target: null, tools: [] })
  })
  it('builds a feature with Join as the default and the tools consumed', () => {
    const f = newCombine('id', 'Combine 1', [body('a'), body('b')])
    expect(f.params).toEqual({ op: 'union', target: body('a'), tools: [body('b')], keepTools: false })
    expect(combineSelection(f)).toEqual([body('a'), body('b')])
  })
  it('with no target the selection is just the tools', () => {
    const f = newCombine('id', 'Combine 1', [])
    expect(f.params.target.name).toBe('')
    expect(combineSelection(f)).toEqual([])
  })
})

describe('isPreviewable', () => {
  const fillet = (edges: Ref[]): FilletFeature => ({ id: 'f', type: 'fillet', name: 'Fillet 1', suppressed: false, params: { edges, radius: '1' } })
  const extrude = (mode: ExtrudeFeature['params']['mode'], targets: Ref[]): ExtrudeFeature => ({
    id: 'e',
    type: 'extrude',
    name: 'Extrude 1',
    suppressed: false,
    params: { profiles: [{ kind: 'sketchRegion', name: 's/region:x' }], distance: '10', direction: 1, mode, targets },
  })
  it('a fillet needs edges', () => {
    expect(isPreviewable(fillet([]))).toBe(false)
    expect(isPreviewable(fillet([edge('a|b')]))).toBe(true)
  })
  it('a combine needs a target and a tool', () => {
    expect(isPreviewable(newCombine('i', 'C', [body('a')]))).toBe(false)
    expect(isPreviewable(newCombine('i', 'C', [body('a'), body('b')]))).toBe(true)
  })
  it('an extrude that joins needs something to join to', () => {
    expect(isPreviewable(extrude('new', []))).toBe(true)
    expect(isPreviewable(extrude('union', []))).toBe(false)
    expect(isPreviewable(extrude('union', [body('a')]))).toBe(true)
  })
  it('revolve, shell, transform and plane need their main inputs', () => {
    const rev = (axisName: string, mode: RevolveFeature['params']['mode'] = 'new'): RevolveFeature => ({
      id: 'r',
      type: 'revolve',
      name: 'Revolve 1',
      suppressed: false,
      params: {
        profiles: [{ kind: 'sketchRegion', name: 's/region:a' }],
        axis: { kind: 'originAxis', name: axisName },
        angle: '360',
        mode,
        targets: [],
      },
    })
    expect(isPreviewable(rev(''))).toBe(false)
    expect(isPreviewable(rev('Z'))).toBe(true)
    expect(isPreviewable(rev('Z', 'union'))).toBe(false)

    const sh = (b: string): ShellFeature => ({
      id: 'sh',
      type: 'shell',
      name: 'Shell 1',
      suppressed: false,
      params: { body: body(b), removeFaces: [], thickness: '2' },
    })
    expect(isPreviewable(sh(''))).toBe(false)
    expect(isPreviewable(sh('e'))).toBe(true)

    const tr = (bs: Ref[]): TransformFeature => ({
      id: 't',
      type: 'transform',
      name: 'Move 1',
      suppressed: false,
      params: { bodies: bs, translate: ['0', '0', '0'], rotate: null, copy: false },
    })
    expect(isPreviewable(tr([]))).toBe(false)
    expect(isPreviewable(tr([body('e')]))).toBe(true)

    const pl = (base: string): PlaneFeature => ({
      id: 'p',
      type: 'plane',
      name: 'Plane 1',
      suppressed: false,
      params: { base: { kind: 'originPlane', name: base }, offset: '10', angle: '0' },
    })
    expect(isPreviewable(pl(''))).toBe(false)
    expect(isPreviewable(pl('XY'))).toBe(true)
  })
})

describe('bodyOfFace and sameSketchRegions', () => {
  it('finds the owning solid by scanning meshes first, then by prefix', () => {
    const meshes = new Map([
      ['e1', { faces: [{ name: 'e1/cap:end' }, { name: 'u/e2/side/m1' }] }],
      ['e3', { faces: [{ name: 'sh/inner/e3/cap:start' }] }],
    ])
    expect(bodyOfFace('u/e2/side/m1', meshes)).toBe('e1')
    expect(bodyOfFace('sh/inner/e3/cap:start', meshes)).toBe('e3')
    expect(bodyOfFace('e9/cap:end', meshes)).toBe('e9')
  })

  it('keeps regions from the first picked sketch only', () => {
    const a1: Ref = { kind: 'sketchRegion', name: 's1/region:a' }
    const a2: Ref = { kind: 'sketchRegion', name: 's1/region:b' }
    const b1: Ref = { kind: 'sketchRegion', name: 's2/region:c' }
    expect(sameSketchRegions([a1, b1, a2])).toEqual([a1, a2])
    expect(sameSketchRegions([])).toEqual([])
  })
})

describe('editing a step', () => {
  it('maps feature types to tool ids', () => {
    expect(toolForFeature('boolean')).toBe('combine')
    expect(toolForFeature('fillet')).toBe('fillet')
    expect(toolForFeature('chamfer')).toBe('chamfer')
    expect(toolForFeature('revolve')).toBe('revolve')
    expect(toolForFeature('shell')).toBe('shell')
    expect(toolForFeature('transform')).toBe('move')
    expect(toolForFeature('plane')).toBe('plane')
    expect(toolForFeature('sketch')).toBeNull()
  })
  it('clones arrays so editing the draft cannot touch the document', () => {
    const f: FilletFeature = { id: 'f', type: 'fillet', name: 'Fillet 1', suppressed: false, params: { edges: [edge('a')], radius: '2' } }
    const c = cloneForEdit(f) as FilletFeature
    expect(c).toEqual(f)
    expect(c.params.edges).not.toBe(f.params.edges)
    expect(selectionForFeature(f)).toEqual([edge('a')])

    const tr: TransformFeature = {
      id: 't',
      type: 'transform',
      name: 'Move 1',
      suppressed: false,
      params: { bodies: [body('e')], translate: ['1', '2', '3'], rotate: { axis: [0, 0, 1], pivot: [0, 0, 0], angle: '45' }, copy: true },
    }
    const tc = cloneForEdit(tr) as TransformFeature
    expect(tc).toEqual(tr)
    expect(tc.params.bodies).not.toBe(tr.params.bodies)
    expect(tc.params.translate).not.toBe(tr.params.translate)
    expect(tc.params.rotate).not.toBe(tr.params.rotate)
    expect(selectionForFeature(tr)).toEqual([body('e')])

    const sh: ShellFeature = {
      id: 'sh',
      type: 'shell',
      name: 'Shell 1',
      suppressed: false,
      params: { body: body('e'), removeFaces: [], thickness: '2' },
    }
    expect(selectionForFeature(sh)).toEqual([body('e')])
  })
})

/** A closed axis-aligned box as a triangle mesh (12 triangles), corners at 0 and (x, y, z). */
function boxMesh(x: number, y: number, z: number) {
  const positions = [0, 0, 0, x, 0, 0, x, y, 0, 0, y, 0, 0, 0, z, x, 0, z, x, y, z, 0, y, z]
  const indices = [
    0, 2, 1, 0, 3, 2, // bottom
    4, 5, 6, 4, 6, 7, // top
    0, 1, 5, 0, 5, 4, // front
    1, 2, 6, 1, 6, 5, // right
    2, 3, 7, 2, 7, 6, // back
    3, 0, 4, 3, 4, 7, // left
  ]
  return { positions, indices }
}

describe('cut direction and no-effect check (BUG-015)', () => {
  it('measures the volume of a closed mesh', () => {
    const m = boxMesh(40, 20, 10)
    expect(meshVolume(m.positions, m.indices)).toBeCloseTo(8000, 6)
  })

  it('treats equal volumes as the same and a drilled one as different', () => {
    expect(sameVolume(8000, 8000)).toBe(true)
    expect(sameVolume(8000, 8000 + 1e-9)).toBe(true)
    expect(sameVolume(8000, 8000 - 282.7)).toBe(false)
  })

  it('cuts opposite to a sketch plane that faces out of the solid', () => {
    expect(cutDirection([0, 0, 1], [0, 0, 1])).toBe(-1) // sketch normal along the outward normal: cut into the solid
    expect(cutDirection([0, 0, -1], [0, 0, 1])).toBe(1) // sketch normal already points into the solid
    expect(cutDirection([0, 0, 1], [0, 0.0001, 1])).toBe(-1)
  })
})

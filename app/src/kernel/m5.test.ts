// M5 kernel & sketcher tests: Extrude offset/throughAll, Sweep, Loft, Split, Mirror, Linear/Circular Pattern,
// STEP import + fillet, sketcher polygon/slot/ellipse/spline/trim/fillet/mirror/pattern, and .3dparter.json serialization.
import { beforeAll, describe, expect, it } from 'vitest'
import { addFeature } from '../doc/commands'
import { emptyDocument } from '../doc/types'
import { setVariableExpression } from '../doc/variableCommands'
import type {
  ExtrudeFeature,
  Feature,
  ImportFeature,
  LoftFeature,
  MirrorFeature,
  PatternFeature,
  PlaneFeature,
  SketchFeature,
  SplitFeature,
  SweepFeature,
} from '../doc/types'
import { useProjectStore } from '../doc/store'
import { exportStep } from './export'
import { meshBody } from './mesh'
import { Regenerator } from './regenerate'
import { docOf, edgeRef, extrudeFeature, filletFeature, line, ready, rect, sketchFeature } from './testutil'
import { shapeFor } from '../sketch/shapes'
import { filletSketchCorner, mirrorSketchSelection, patternSketchSelection, trimSketchEntity } from '../sketch/sketchEditOps'
import { connectInternalEndpoints } from '../sketch/solver/infer'
import { readySolver } from '../sketch/solver/testutil'
import { parseProjectFile, serializeProjectFile } from '../data/projectFile'

beforeAll(async () => {
  await Promise.all([ready(), readySolver()])
})

function volumeOf(k: Regenerator, id: string): number {
  const b = k.getBody(id)
  if (!b) return 0
  const m = meshBody(b, 'high')
  let v = 0
  for (let i = 0; i + 2 < m.indices.length; i += 3) {
    const i0 = m.indices[i] * 3
    const i1 = m.indices[i + 1] * 3
    const i2 = m.indices[i + 2] * 3
    const ax = m.positions[i0], ay = m.positions[i0 + 1], az = m.positions[i0 + 2]
    const bx = m.positions[i1], by = m.positions[i1 + 1], bz = m.positions[i1 + 2]
    const cx = m.positions[i2], cy = m.positions[i2 + 1], cz = m.positions[i2 + 2]
    v += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6
  }
  return Math.abs(v)
}

describe('M5 modeling kernel operations', () => {
  it('extrudes with startOffset and throughAll extent', () => {
    const k = new Regenerator()
    const baseSk = sketchFeature('s1', 'XY', rect('a', 0, 0, 20, 20))
    const baseEx: ExtrudeFeature = {
      id: 'b1',
      name: 'Extrude 1',
      suppressed: false,
      type: 'extrude',
      params: {
        profiles: [{ kind: 'sketchRegion', name: 's1/region:a1,a2,a3,a4' }],
        distance: '20',
        direction: 1,
        startOffset: '5',
        mode: 'new',
        targets: [],
      },
    }
    const holeSk = sketchFeature('s2', 'XY', rect('h', 5, 5, 10, 10))
    const throughCut: ExtrudeFeature = {
      id: 'c1',
      name: 'Cut 1',
      suppressed: false,
      type: 'extrude',
      params: {
        profiles: [{ kind: 'sketchRegion', name: 's2/region:h1,h2,h3,h4' }],
        distance: '1',
        direction: 1,
        extent: 'throughAll',
        mode: 'subtract',
        targets: [{ kind: 'body', name: 'b1' }],
      },
    }
    const res = k.regenerate(docOf(baseSk, baseEx, holeSk, throughCut), 1)
    expect(res.statuses.every((s) => s.ok)).toBe(true)
    const bounds = k.getBody('b1')!.built.shape.boundingBox.bounds
    expect(bounds[0][2]).toBeCloseTo(5, 2)
    expect(bounds[1][2]).toBeCloseTo(25, 2)
    // Outer 20x20x20 = 8000 minus inner 10x10x20 = 2000 -> 6000
    expect(volumeOf(k, 'b1')).toBeCloseTo(6000, -1)
  })

  it('lofts between two profiles on parallel planes', () => {
    const k = new Regenerator()
    const p2: PlaneFeature = {
      id: 'pl',
      name: 'Plane 1',
      suppressed: false,
      type: 'plane',
      params: { base: { kind: 'originPlane', name: 'XY' }, offset: '30', angle: '0' },
    }
    const s1 = sketchFeature('s1', 'XY', rect('a', 0, 0, 20, 20))
    const s2: Feature = {
      id: 's2',
      name: 'Sketch 2',
      suppressed: false,
      type: 'sketch',
      params: { on: { kind: 'constructionPlane', name: 'pl' } },
      sketch: { entities: rect('b', 5, 5, 10, 10), constraints: [] },
    }
    const loft: LoftFeature = {
      id: 'lf',
      name: 'Loft 1',
      suppressed: false,
      type: 'loft',
      params: {
        profiles: [
          { kind: 'sketchRegion', name: 's1/region:a1,a2,a3,a4' },
          { kind: 'sketchRegion', name: 's2/region:b1,b2,b3,b4' },
        ],
        mode: 'new',
        targets: [],
      },
    }
    const res = k.regenerate(docOf(p2, s1, s2, loft), 1)
    expect(res.statuses.every((s) => s.ok)).toBe(true)
    // Frustum height 30, areas 400 and 100 -> V = h/3 * (A1 + A2 + sqrt(A1*A2)) = 10 * (400 + 100 + 200) = 7000
    expect(volumeOf(k, 'lf')).toBeCloseTo(7000, -1)
  })

  it('sweeps a closed profile along a perpendicular sketch path line', () => {
    const k = new Regenerator()
    const prof = sketchFeature('s1', 'XY', rect('r', -5, -5, 10, 10))
    const path = sketchFeature('s2', 'XZ', [line('p1', [0, 0], [0, 30])])
    const sweep: SweepFeature = {
      id: 'sw',
      name: 'Sweep 1',
      suppressed: false,
      type: 'sweep',
      params: {
        profile: { kind: 'sketchRegion', name: 's1/region:r1,r2,r3,r4' },
        path: { kind: 'sketchEdge', name: 's2/p1' },
        mode: 'new',
        targets: [],
      },
    }
    const res = k.regenerate(docOf(prof, path, sweep), 1)
    expect(res.statuses.every((s) => s.ok)).toBe(true)
    expect(volumeOf(k, 'sw')).toBeCloseTo(3000, -1)
  })

  it('splits a solid with a plane into two separate solids', () => {
    const k = new Regenerator()
    const sk = sketchFeature('s1', 'XY', rect('r', -10, -5, 20, 10))
    const ex = extrudeFeature('ex', ['s1/region:r1,r2,r3,r4'], '10')
    const sp: SplitFeature = {
      id: 'sp',
      name: 'Split 1',
      suppressed: false,
      type: 'split',
      params: { body: { kind: 'body', name: 'ex' }, plane: { kind: 'originPlane', name: 'YZ' } },
    }
    const res = k.regenerate(docOf(sk, ex, sp), 1)
    expect(res.statuses.every((s) => s.ok)).toBe(true)
    expect(res.bodies).toEqual(['ex', 'sp:1'])
    expect(volumeOf(k, 'ex') + volumeOf(k, 'sp:1')).toBeCloseTo(2000, -1)
  })

  it('mirrors a solid as a copy and when merged', () => {
    const k = new Regenerator()
    const sk = sketchFeature('s1', 'XY', rect('r', 10, 0, 10, 10))
    const ex = extrudeFeature('ex', ['s1/region:r1,r2,r3,r4'], '10')
    const mrCopy: MirrorFeature = {
      id: 'mr',
      name: 'Mirror 1',
      suppressed: false,
      type: 'mirror',
      params: { bodies: [{ kind: 'body', name: 'ex' }], plane: { kind: 'originPlane', name: 'YZ' }, merge: false },
    }
    const r1 = k.regenerate(docOf(sk, ex, mrCopy), 1)
    expect(r1.statuses.every((s) => s.ok)).toBe(true)
    expect(r1.bodies).toEqual(['ex', 'mr:1'])
    expect(k.getBody('mr:1')!.built.shape.boundingBox.bounds[1][0]).toBeCloseTo(-10, 2)

    const touchSk = sketchFeature('s2', 'XY', rect('t', 0, 0, 10, 10))
    const touchEx = extrudeFeature('tex', ['s2/region:t1,t2,t3,t4'], '10')
    const mrMerge: MirrorFeature = {
      id: 'mm',
      name: 'Mirror 2',
      suppressed: false,
      type: 'mirror',
      params: { bodies: [{ kind: 'body', name: 'tex' }], plane: { kind: 'originPlane', name: 'YZ' }, merge: true },
    }
    const r2 = k.regenerate(docOf(touchSk, touchEx, mrMerge), 2)
    expect(r2.statuses.every((s) => s.ok)).toBe(true)
    expect(volumeOf(k, 'tex')).toBeCloseTo(2000, -1)
  })

  it('creates linear and circular patterns of solids', () => {
    const k = new Regenerator()
    const sk = sketchFeature('s1', 'XY', rect('r', 10, 0, 10, 10))
    const ex = extrudeFeature('ex', ['s1/region:r1,r2,r3,r4'], '10')
    const lin: PatternFeature = {
      id: 'pl',
      name: 'Pattern 1',
      suppressed: false,
      type: 'pattern',
      params: {
        kind: 'linear',
        bodies: [{ kind: 'body', name: 'ex' }],
        axis: { kind: 'originAxis', name: 'X' },
        count: '3',
        spacing: '20',
      },
    }
    const r1 = k.regenerate(docOf(sk, ex, lin), 1)
    expect(r1.statuses.every((s) => s.ok)).toBe(true)
    expect(r1.bodies).toEqual(['ex', 'pl:1', 'pl:2'])
    expect(k.getBody('pl:2')!.built.shape.boundingBox.bounds[0][0]).toBeCloseTo(50, 2)

    const circ: PatternFeature = {
      id: 'pc',
      name: 'Pattern 2',
      suppressed: false,
      type: 'pattern',
      params: {
        kind: 'circular',
        bodies: [{ kind: 'body', name: 'ex' }],
        axis: { kind: 'originAxis', name: 'Z' },
        count: '4',
        spacing: '90',
      },
    }
    const r2 = k.regenerate(docOf(sk, ex, circ), 2)
    expect(r2.statuses.every((s) => s.ok)).toBe(true)
    expect(r2.bodies).toEqual(['ex', 'pc:1', 'pc:2', 'pc:3'])
    expect(volumeOf(k, 'pc:2')).toBeCloseTo(1000, -1)
  })

  it('imports a STEP file as an editable root body and allows downstream filleting', async () => {
    const k1 = new Regenerator()
    k1.regenerate(docOf(sketchFeature('s', 'XY', rect('r', 0, 0, 20, 20)), extrudeFeature('e', ['s/region:r1,r2,r3,r4'], '10')), 1)
    const stepText = new TextDecoder().decode(await exportStep([k1.getBody('e')!]))

    const k2 = new Regenerator()
    const imp: ImportFeature = {
      id: 'imp',
      name: 'Bracket',
      suppressed: false,
      type: 'import',
      params: { filename: 'bracket.step', format: 'step', content: stepText },
    }
    const r1 = k2.regenerate(docOf(imp), 1)
    expect(r1.statuses.every((s) => s.ok)).toBe(true)
    expect(volumeOf(k2, 'imp')).toBeCloseTo(4000, -1)

    const edges = meshBody(k2.getBody('imp')!, 'preview').edges.map((e) => e.name)
    expect(edges.length).toBeGreaterThan(0)
    const r2 = k2.regenerate(docOf(imp, filletFeature('f1', [edgeRef(edges[0])], '1')), 2)
    expect(r2.statuses.every((s) => s.ok)).toBe(true)
    expect(volumeOf(k2, 'imp')).toBeLessThan(4000)
  })
})

describe('M5 sketcher tools & project serialization', () => {
  it('builds polygon, slot, ellipse, and spline shapes with closed endpoints', () => {
    const poly = shapeFor('polygon', [0, 0], [10, 0], null, null).build()!
    expect(poly.entities).toHaveLength(6)
    expect(connectInternalEndpoints(poly.entities)).toHaveLength(6)

    const slot = shapeFor('slot', [0, 0], [30, 0], null, 10).build()!
    expect(slot.entities).toHaveLength(4)
    expect(connectInternalEndpoints(slot.entities)).toHaveLength(4)

    const ellipse = shapeFor('ellipse', [0, 0], [20, 10], null, null).build()!
    expect(ellipse.entities).toHaveLength(4)

    const spline = shapeFor('spline', [0, 0], [20, 0], null, null, [10, 8]).build()!
    expect(spline.entities).toHaveLength(8)
    expect(connectInternalEndpoints(spline.entities)).toHaveLength(7)
  })

  it('trims, fillets a corner, mirrors, and linear-patterns sketch entities in the store', () => {
    const doc = emptyDocument()
    const s = sketchFeature('sk', 'XY', [
      line('l1', [0, 0], [20, 0]),
      line('l2', [0, 0], [0, 20]),
      line('l3', [10, -5], [10, 15]),
      { id: 'ax', type: 'line', construction: true, a: [25, -5], b: [25, 25] },
    ])
    doc.features = [s]
    useProjectStore.setState({ projectId: 'test', doc })

    // Trim overhanging end of l3 at [10, 12] against l1 (y=0).
    expect(trimSketchEntity('sk', 'l3', [10, 12])).toBe(true)
    const afterTrim = useProjectStore.getState().doc.features[0] as SketchFeature
    expect(afterTrim.sketch.entities.some((e) => e.id === 'l3')).toBe(false)
    expect(afterTrim.sketch.entities.some((e) => e.type === 'line' && Math.abs(e.b[1]) < 1e-4 && e.a[1] < 0)).toBe(true)

    // Fillet corner between l1 and l2.
    expect(filletSketchCorner('sk', ['l1', 'l2'], 4)).toBe(true)
    const afterFillet = useProjectStore.getState().doc.features[0]
    expect(afterFillet.type === 'sketch' && afterFillet.sketch.entities.some((e) => e.type === 'arc')).toBe(true)

    // Mirror l1 across construction line ax.
    const countBeforeMirror = (useProjectStore.getState().doc.features[0] as typeof s).sketch.entities.length
    expect(mirrorSketchSelection('sk', ['l1', 'ax'])).toBe(true)
    expect((useProjectStore.getState().doc.features[0] as typeof s).sketch.entities.length).toBe(countBeforeMirror + 1)

    // Pattern l1 (3 copies total -> +2 new entities).
    const countBeforePattern = (useProjectStore.getState().doc.features[0] as typeof s).sketch.entities.length
    expect(patternSketchSelection('sk', ['l1'], 3, [15, 0])).toBe(true)
    expect((useProjectStore.getState().doc.features[0] as typeof s).sketch.entities.length).toBe(countBeforePattern + 2)
  })

  it('round-trips .3dparter.json project files and rejects corrupt JSON', () => {
    const doc = docOf(sketchFeature('s1', 'XY', rect('r', 0, 0, 10, 10)))
    const json = serializeProjectFile('My Bracket', doc)
    const parsed = parseProjectFile(json)
    expect(parsed.name).toBe('My Bracket')
    expect(parsed.document.features).toHaveLength(1)
    expect(() => parseProjectFile('{"bad":true}')).toThrow()
  })

  it('BUG-022: updates Pattern doc.bodies entries when a variable driving Count changes', () => {
    const doc = emptyDocument()
    doc.variables = [{ id: 'vn', name: 'n', expression: '3' }]
    useProjectStore.setState({ projectId: 'test', doc })

    addFeature(sketchFeature('s1', 'XY', rect('r', 0, 0, 10, 10)), 'Sketch')
    addFeature(extrudeFeature('ex', ['s1/region:r1,r2,r3,r4'], '10'), 'Extrude')
    const pat: PatternFeature = {
      id: 'pt',
      name: 'Pattern 1',
      suppressed: false,
      type: 'pattern',
      params: { kind: 'linear', bodies: [{ kind: 'body', name: 'ex' }], axis: { kind: 'originAxis', name: 'X' }, count: 'n', spacing: '20' },
    }
    addFeature(pat, 'Pattern')
    expect(Object.keys(useProjectStore.getState().doc.bodies)).toHaveLength(3)

    expect(setVariableExpression('vn', '5')).toEqual({ ok: true })
    expect(Object.keys(useProjectStore.getState().doc.bodies)).toHaveLength(5)

    expect(setVariableExpression('vn', '2')).toEqual({ ok: true })
    expect(Object.keys(useProjectStore.getState().doc.bodies)).toHaveLength(2)
  })

  it('BUG-023 & BUG-024: preserves Slot width before typing and honors Spline typed length (fixedA)', () => {
    const slotDefault = shapeFor('slot', [0, 0], [0, 0], null, null)
    const slotAfterLen = shapeFor('slot', [0, 0], [0, 0], 20, null)
    expect(slotAfterLen.dimB).toBe(slotDefault.dimB)

    const sp1 = shapeFor('spline', [0, 0], [10, 0], 40, null, [10, 8])
    expect(sp1.dimA).toBe(40)
    expect(sp1.end[0]).toBeCloseTo(40, 4)
    const built1 = sp1.build()!
    const lastSeg1 = built1.entities[built1.entities.length - 1]
    expect(lastSeg1.type === 'line' && lastSeg1.b[0]).toBeCloseTo(40, 4)

    const sp2 = shapeFor('spline', [0, 0], [0, 0], 30, null, [15, 8]).build()!
    expect(sp2.entities).toHaveLength(8)
    const lastSeg2 = sp2.entities[sp2.entities.length - 1]
    expect(lastSeg2.type === 'line' && lastSeg2.b[0]).toBeCloseTo(30, 4)
  })

  it('detects closed regions on Ellipse and Slot shapes and extrudes valid 3D solids', () => {
    const k = new Regenerator()
    const slot = shapeFor('slot', [0, 0], [20, 0], 20, 8).build()!
    const ellipse = shapeFor('ellipse', [50, 0], [60, 5], 20, 10).build()!
    const skSlot = sketchFeature('sks', 'XY', slot.entities)
    const skEll = sketchFeature('ske', 'XY', ellipse.entities)
    k.regenerate(docOf(skSlot, skEll), 1)
    const rSlot = k.getSketch('sks')!.regions
    const rEll = k.getSketch('ske')!.regions
    expect(rSlot).toHaveLength(1)
    expect(rEll).toHaveLength(1)

    const res = k.regenerate(
      docOf(skSlot, skEll, extrudeFeature('es', [rSlot[0].name], '10'), extrudeFeature('ee', [rEll[0].name], '10')),
      2,
    )
    expect(res.statuses.every((s) => s.ok)).toBe(true)
    expect(volumeOf(k, 'es')).toBeCloseTo((20 * 8 + Math.PI * 16) * 10, -1)
    expect(volumeOf(k, 'ee')).toBeGreaterThan(1000)
  })

  it('BUG-026: refuses a degenerate loft between coplanar profiles on the same plane', () => {
    const k = new Regenerator()
    const s1 = sketchFeature('s1', 'XY', rect('a', 0, 0, 20, 20))
    const s2 = sketchFeature('s2', 'XY', rect('b', 30, 0, 10, 10))
    const loft: LoftFeature = {
      id: 'lf',
      name: 'Loft 1',
      suppressed: false,
      type: 'loft',
      params: {
        profiles: [
          { kind: 'sketchRegion', name: 's1/region:a1,a2,a3,a4' },
          { kind: 'sketchRegion', name: 's2/region:b1,b2,b3,b4' },
        ],
        mode: 'new',
        targets: [],
      },
    }
    const res = k.regenerate(docOf(s1, s2, loft), 1)
    const st = res.statuses.find((s) => s.featureId === 'lf')
    expect(st?.ok).toBe(false)
    expect(st?.message).toMatch(/separate planes/i)
  })

  it('BUG-027: prunes deleted body refs from selection after undo so later tools do not start with a ghost body', () => {
    useProjectStore.setState({ projectId: 'test', doc: emptyDocument(), selection: [] })
    addFeature(sketchFeature('s1', 'XY', rect('r', 0, 0, 10, 10)), 'Sketch')
    addFeature(extrudeFeature('ex', ['s1/region:r1,r2,r3,r4'], '10'), 'Extrude')
    const mr: MirrorFeature = {
      id: 'mr',
      name: 'Mirror 1',
      suppressed: false,
      type: 'mirror',
      params: { bodies: [{ kind: 'body', name: 'ex' }], plane: { kind: 'originPlane', name: 'YZ' }, merge: false },
    }
    addFeature(mr, 'Mirror')
    useProjectStore.getState().setSelection([{ kind: 'body', name: 'mr:1' }])
    useProjectStore.getState().undo()
    expect(useProjectStore.getState().doc.bodies['mr:1']).toBeUndefined()
    expect(useProjectStore.getState().selection).toEqual([])
  })
})

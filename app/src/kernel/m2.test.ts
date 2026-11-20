// M2 kernel features: revolve, shell, transform, keepTools naming, construction planes, sketches on faces.
import { beforeAll, describe, expect, it } from 'vitest'
import { measureVolume } from 'replicad'
import type { Feature, Ref } from '../doc/types'
import { meshBody } from './mesh'
import { Regenerator } from './regenerate'
import {
  booleanFeature,
  circle,
  constructionLine,
  docOf,
  extrudeFeature,
  faceRef,
  filletFeature,
  planeFeature,
  ready,
  rect,
  revolveFeature,
  shellFeature,
  sketchFeature,
  sketchOn,
  transformFeature,
} from './testutil'

beforeAll(async () => {
  await ready()
})

const BOX = 's/region:l1,l2,l3,l4'
const vol = (k: Regenerator, body = 'e') => measureVolume(k.getBody(body)!.built.shape as never)
const faceNames = (k: Regenerator, body = 'e') => meshBody(k.getBody(body)!, 'preview').faces.map((f) => f.name)
const edgeNames = (k: Regenerator, body = 'e') => meshBody(k.getBody(body)!, 'preview').edges.map((e) => e.name)
const allOk = (r: { statuses: { ok: boolean }[] }) => r.statuses.every((s) => s.ok)
const bbox = (k: Regenerator, body = 'e') => {
  const bb = k.getBody(body)!.built.shape.boundingBox
  const [lo, hi] = bb.bounds
  bb.delete()
  return { lo, hi }
}
const near = (a: number[], b: number[], d = 4) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], d))
const BLEND_VOL = (r: number, len: number) => (r * r - (Math.PI * r * r) / 4) * len

function box(w = 40, h = 20, dist = '10'): Feature[] {
  return [sketchFeature('s', 'XY', rect('l', 0, 0, w, h)), extrudeFeature('e', [BOX], dist)]
}

// ---- 1. revolve ------------------------------------------------------------------------------

describe('1. revolve', () => {
  // rect x 10..20, y 0..20 on XY, construction axis line on the sketch's Y axis
  const sk = (x0 = 10, w = 10) => sketchFeature('s', 'XY', [...rect('l', x0, 0, w, 20), constructionLine('ax', [0, 0], [0, 1])])
  const axis: Ref = { kind: 'sketchEdge', name: 's/ax' }

  it('360 degrees about the sketch Y-axis line makes a ring', () => {
    const k = new Regenerator()
    const r = k.regenerate(docOf(sk(), revolveFeature('r', [BOX], axis, '360')), 1)
    expect(allOk(r)).toBe(true)
    expect(r.bodies).toEqual(['r'])
    expect(vol(k, 'r')).toBeCloseTo(Math.PI * (400 - 100) * 20, 2)
    const names = faceNames(k, 'r')
    for (const n of ['r/side/l1', 'r/side/l2', 'r/side/l3', 'r/side/l4']) expect(names).toContain(n)
    expect(names.some((n) => n.includes('cap:'))).toBe(false)
    expect(new Set(names).size).toBe(names.length)
    k.dispose()
  })

  it('a profile edge on the axis makes a solid cylinder', () => {
    const k = new Regenerator()
    const r = k.regenerate(docOf(sk(0, 10), revolveFeature('r', [BOX], axis, '360')), 1)
    expect(allOk(r)).toBe(true)
    expect(vol(k, 'r')).toBeCloseTo(Math.PI * 100 * 20, 2)
    const names = faceNames(k, 'r')
    expect(names).toContain('r/side/l2')
    expect(names).toContain('r/side/l1')
    expect(names).toContain('r/side/l3')
    k.dispose()
  })

  it('90 degrees is a quarter and has named caps', () => {
    const k = new Regenerator()
    const r = k.regenerate(docOf(sk(), revolveFeature('r', [BOX], axis, '90')), 1)
    expect(allOk(r)).toBe(true)
    expect(vol(k, 'r')).toBeCloseTo((Math.PI * (400 - 100) * 20) / 4, 2)
    const names = faceNames(k, 'r')
    expect(names).toContain('r/cap:start')
    expect(names).toContain('r/cap:end')
    expect(names).toContain('r/side/l2')
    k.dispose()
  })

  it('about the origin axis Z with a profile on the XZ plane', () => {
    const k = new Regenerator()
    const doc = docOf(
      sketchFeature('s', 'XZ', rect('l', 10, 0, 10, 20)),
      revolveFeature('r', [BOX], { kind: 'originAxis', name: 'Z' }, '360'),
    )
    const r = k.regenerate(doc, 1)
    expect(allOk(r)).toBe(true)
    expect(vol(k, 'r')).toBeCloseTo(Math.PI * 300 * 20, 2)
    const bb = bbox(k, 'r')
    near(bb.lo, [-20, -20, 0], 3)
    near(bb.hi, [20, 20, 20], 3)
    k.dispose()
  })

  it('a profile that crosses the axis is a readable error', () => {
    const k = new Regenerator()
    const r = k.regenerate(docOf(sk(-5, 10), revolveFeature('r', [BOX], axis, '360')), 1)
    expect(r.statuses[1].ok).toBe(false)
    expect(r.statuses[1].message).toMatch(/crosses the axis/)
    expect(r.bodies).toEqual([])
    k.dispose()
  })

  it('bad angles and a bad axis are readable errors', () => {
    const k = new Regenerator()
    for (const a of ['0', '-5', '361', 'abc']) {
      const r = k.regenerate(docOf(sk(), revolveFeature('r', [BOX], axis, a)), 1)
      expect(r.statuses[1].ok).toBe(false)
      expect(r.statuses[1].message!.endsWith('.')).toBe(true)
    }
    const r = k.regenerate(docOf(sk(), revolveFeature('r', [BOX], { kind: 'sketchEdge', name: 's/nope' }, '360')), 3)
    expect(r.statuses[1].ok).toBe(false)
    k.dispose()
  })

  it("mode 'union' joins the revolve to an existing body", () => {
    const k = new Regenerator()
    const doc = docOf(
      sketchFeature('b', 'XY', rect('q', -15, -15, 30, 30)),
      extrudeFeature('e', ['b/region:q1,q2,q3,q4'], '5'),
      sketchFeature('s', 'XZ', rect('l', 10, 5, 10, 10)),
      revolveFeature('r', [BOX], { kind: 'originAxis', name: 'Z' }, '360', 'union', ['e']),
    )
    const r = k.regenerate(doc, 1)
    expect(allOk(r)).toBe(true)
    expect(r.bodies).toEqual(['e'])
    expect(vol(k, 'e')).toBeCloseTo(4500 + Math.PI * 300 * 10, 1)
    expect(faceNames(k, 'e')).toContain('e/cap:start')
    expect(faceNames(k, 'e').some((n) => n.startsWith('r/side/'))).toBe(true)
    k.dispose()
  })
})

// ---- 2. shell --------------------------------------------------------------------------------

describe('2. shell', () => {
  const doc = (w = 40, thickness = '2', remove = ['e/cap:end']) => docOf(...box(w), shellFeature('sh', 'e', remove, thickness))

  it('a box with the top removed has the right volume and inner face names', () => {
    const k = new Regenerator()
    const r = k.regenerate(doc(), 1)
    expect(allOk(r)).toBe(true)
    expect(r.bodies).toEqual(['e'])
    expect(vol(k)).toBeCloseTo(8000 - 36 * 16 * 8, 2)
    const names = faceNames(k)
    expect(names).toContain('e/cap:start')
    expect(names).toContain('e/side/l1')
    expect(names).not.toContain('e/cap:end')
    for (const n of ['sh/inner/e/cap:start', 'sh/inner/e/side/l1', 'sh/inner/e/side/l2', 'sh/inner/e/side/l3', 'sh/inner/e/side/l4']) {
      expect(names).toContain(n)
    }
    expect(new Set(names).size).toBe(names.length)
    k.dispose()
  })

  it('no removed faces gives a closed hollow solid', () => {
    const k = new Regenerator()
    const r = k.regenerate(doc(40, '2', []), 1)
    expect(allOk(r)).toBe(true)
    expect(vol(k)).toBeCloseTo(8000 - 36 * 16 * 6, 2)
    const names = faceNames(k)
    expect(names).toHaveLength(12)
    expect(names).toContain('e/cap:end')
    expect(names).toContain('sh/inner/e/cap:end')
    expect(new Set(names).size).toBe(12)
    k.dispose()
  })

  it('survives an upstream size edit (removeFaces resolved by name)', () => {
    const k = new Regenerator()
    k.regenerate(doc(), 1)
    const r = k.regenerate(doc(50), 2)
    expect(allOk(r)).toBe(true)
    expect(vol(k)).toBeCloseTo(50 * 20 * 10 - 46 * 16 * 8, 2)
    expect(faceNames(k)).toContain('sh/inner/e/side/l2')
    k.dispose()
  })

  it('a later fillet on an inner edge still finds it', () => {
    const k = new Regenerator()
    const inner = 'sh/inner/e/cap:start|sh/inner/e/side/l1'
    const r = k.regenerate(docOf(...box(), shellFeature('sh', 'e', ['e/cap:end'], '2'), filletFeature('f', [inner], '1')), 1)
    expect(allOk(r)).toBe(true)
    expect(faceNames(k).some((n) => n.startsWith('f/blend/'))).toBe(true)
    k.dispose()
  })

  it('a thickness that is too large is a readable error and leaves the body alone', () => {
    const k = new Regenerator()
    const r = k.regenerate(doc(40, '12'), 1)
    expect(r.statuses[2].ok).toBe(false)
    expect(r.statuses[2].message!.endsWith('.')).toBe(true)
    expect(vol(k)).toBeCloseTo(8000, 3)
    k.dispose()
  })

  it('rejects a zero thickness, a missing body and a face of another body', () => {
    const k = new Regenerator()
    let r = k.regenerate(doc(40, '0'), 1)
    expect(r.statuses[2].ok).toBe(false)
    r = k.regenerate(docOf(...box(), shellFeature('sh', 'nope', [], '2')), 2)
    expect(r.statuses[2].ok).toBe(false)
    r = k.regenerate(docOf(...box(), shellFeature('sh', 'e', ['x/cap:end'], '2')), 3)
    expect(r.statuses[2].ok).toBe(false)
    k.dispose()
  })
})

// ---- 3. transform ----------------------------------------------------------------------------

describe('3. transform', () => {
  const rotZ90 = { axis: [0, 0, 1] as [number, number, number], pivot: [0, 0, 0] as [number, number, number], angle: '90' }

  it('translate moves the body and keeps every name', () => {
    const k = new Regenerator()
    k.regenerate(docOf(...box()), 1)
    const before = [faceNames(k).sort(), edgeNames(k).sort()]
    const r = k.regenerate(docOf(...box(), transformFeature('t', ['e'], { translate: ['10', '0', '0'] })), 2)
    expect(allOk(r)).toBe(true)
    expect(r.bodies).toEqual(['e'])
    const bb = bbox(k)
    near(bb.lo, [10, 0, 0], 3)
    near(bb.hi, [50, 20, 10], 3)
    expect([faceNames(k).sort(), edgeNames(k).sort()]).toEqual(before)
    expect(vol(k)).toBeCloseTo(8000, 3)
    k.dispose()
  })

  it('rotate 90 degrees about Z through the origin', () => {
    const k = new Regenerator()
    const r = k.regenerate(docOf(...box(), transformFeature('t', ['e'], { rotate: rotZ90 })), 1)
    expect(allOk(r)).toBe(true)
    const bb = bbox(k)
    near(bb.lo, [-20, 0, 0], 3)
    near(bb.hi, [0, 40, 10], 3)
    k.dispose()
  })

  it('rotation comes first, then translation', () => {
    const k = new Regenerator()
    const r = k.regenerate(docOf(...box(), transformFeature('t', ['e'], { rotate: rotZ90, translate: ['100', '0', '5'] })), 1)
    expect(allOk(r)).toBe(true)
    const bb = bbox(k)
    near(bb.lo, [80, 0, 5], 3)
    near(bb.hi, [100, 40, 15], 3)
    k.dispose()
  })

  it('copy keeps the original, names the copy t:1 and prefixes its face and edge names', () => {
    const k = new Regenerator()
    const r = k.regenerate(docOf(...box(), transformFeature('t', ['e'], { translate: ['100', '0', '0'], copy: true })), 1)
    expect(allOk(r)).toBe(true)
    expect(r.bodies).toEqual(['e', 't:1'])
    near(bbox(k, 'e').lo, [0, 0, 0], 3)
    near(bbox(k, 't:1').lo, [100, 0, 0], 3)
    const copyFaces = faceNames(k, 't:1')
    expect(copyFaces).toContain('t:1/e/cap:end')
    expect(copyFaces.every((n) => n.startsWith('t:1/'))).toBe(true)
    expect(edgeNames(k, 't:1').every((n) => n.split('|').every((p) => p.startsWith('t:1/')))).toBe(true)
    const all = [...faceNames(k, 'e'), ...copyFaces]
    expect(new Set(all).size).toBe(all.length)
    k.dispose()
  })

  it('copies of several bodies are numbered in the order of `bodies`', () => {
    const k = new Regenerator()
    const doc = docOf(
      sketchFeature('s', 'XY', [...rect('l', 0, 0, 40, 20), ...rect('m', 100, 0, 10, 10)]),
      extrudeFeature('e', [BOX], '10'),
      extrudeFeature('g', ['s/region:m1,m2,m3,m4'], '5'),
      transformFeature('t', ['g', 'e'], { translate: ['0', '0', '50'], copy: true }),
    )
    const r = k.regenerate(doc, 1)
    expect(allOk(r)).toBe(true)
    expect(r.bodies).toEqual(['e', 'g', 't:1', 't:2'])
    expect(vol(k, 't:1')).toBeCloseTo(500, 3) // g
    expect(vol(k, 't:2')).toBeCloseTo(8000, 3) // e
    k.dispose()
  })

  it('a fillet on the copy edge acts on the copy', () => {
    const k = new Regenerator()
    const edge = 't:1/e/cap:end|t:1/e/side/l1'
    const doc = docOf(
      ...box(),
      transformFeature('t', ['e'], { translate: ['100', '0', '0'], copy: true }),
      filletFeature('f', [edge], '2'),
    )
    const r = k.regenerate(doc, 1)
    expect(allOk(r)).toBe(true)
    expect(vol(k, 't:1')).toBeCloseTo(8000 - BLEND_VOL(2, 40), 3)
    expect(vol(k, 'e')).toBeCloseTo(8000, 3)
    k.dispose()
  })

  it('a missing body is a readable error', () => {
    const k = new Regenerator()
    const r = k.regenerate(docOf(...box(), transformFeature('t', ['nope'], { translate: ['1', '0', '0'] })), 1)
    expect(r.statuses[2].ok).toBe(false)
    expect(r.statuses[2].message!.endsWith('.')).toBe(true)
    k.dispose()
  })
})

// ---- 4. keepTools naming ---------------------------------------------------------------------

describe('4. boolean keepTools naming', () => {
  const doc = (more: Feature[] = [], keep = true) =>
    docOf(
      sketchFeature('sA', 'XY', rect('l', 0, 0, 40, 20)),
      extrudeFeature('eA', ['sA/region:l1,l2,l3,l4'], '10'),
      sketchFeature('sB', 'XY', rect('m', 20, 10, 40, 20)),
      extrudeFeature('eB', ['sB/region:m1,m2,m3,m4'], '10'),
      booleanFeature('u', 'union', 'eA', ['eB'], keep),
      ...more,
    )
  const TOOL_EDGE = 'eB/cap:end|eB/side/m3'
  const TARGET_EDGE = 'u/eB/cap:end|u/eB/side/m3'

  it('tool-derived faces in the target are prefixed; the kept tool keeps its names', () => {
    const k = new Regenerator()
    const r = k.regenerate(doc(), 1)
    expect(allOk(r)).toBe(true)
    expect(r.bodies).toEqual(['eA', 'eB'])
    const target = faceNames(k, 'eA')
    expect(target.some((n) => n.startsWith('eB/'))).toBe(false)
    expect(target.some((n) => n.startsWith('u/eB/'))).toBe(true)
    expect(target).toContain('eA/side/l1')
    expect(faceNames(k, 'eB')).toContain('eB/side/m3')
    k.dispose()
  })

  it('a fillet on the kept tool edge acts on the tool', () => {
    const k = new Regenerator()
    const r = k.regenerate(doc([filletFeature('f', [TOOL_EDGE], '2')]), 1)
    expect(allOk(r)).toBe(true)
    expect(vol(k, 'eB')).toBeCloseTo(8000 - BLEND_VOL(2, 40), 3)
    expect(vol(k, 'eA')).toBeCloseTo(14000, 3)
    k.dispose()
  })

  it('a fillet on the prefixed edge acts on the target', () => {
    const k = new Regenerator()
    const r = k.regenerate(doc([filletFeature('f', [TARGET_EDGE], '2')]), 1)
    expect(allOk(r)).toBe(true)
    expect(vol(k, 'eA')).toBeCloseTo(14000 - BLEND_VOL(2, 40), 3)
    expect(vol(k, 'eB')).toBeCloseTo(8000, 3)
    k.dispose()
  })

  it('without keepTools nothing is prefixed', () => {
    const k = new Regenerator()
    const r = k.regenerate(doc([], false), 1)
    expect(allOk(r)).toBe(true)
    expect(faceNames(k, 'eA').some((n) => n.startsWith('eB/'))).toBe(true)
    expect(faceNames(k, 'eA').some((n) => n.startsWith('u/'))).toBe(false)
    k.dispose()
  })
})

// ---- 5. construction planes ------------------------------------------------------------------

describe('5. construction planes', () => {
  const xy: Ref = { kind: 'originPlane', name: 'XY' }
  const cp = (name: string): Ref => ({ kind: 'constructionPlane', name })

  it('an offset plane has the right frame and makes no body', () => {
    const k = new Regenerator()
    const r = k.regenerate(docOf(planeFeature('p', xy, '15')), 1)
    expect(allOk(r)).toBe(true)
    expect(r.bodies).toEqual([])
    const lst = k.constructionPlanes()
    expect(lst.map((p) => p.name)).toEqual(['p'])
    near(lst[0].frame.origin, [0, 0, 15])
    near(lst[0].frame.normal, [0, 0, 1])
    near(lst[0].frame.xDir, [1, 0, 0])
    near(lst[0].frame.yDir, [0, 1, 0])
    near(k.planeFrame(cp('p'))!.origin, [0, 0, 15])
    expect(k.planeFrame(cp('nope'))).toBeNull()
    near(k.planeFrame(xy)!.normal, [0, 0, 1])
    k.dispose()
  })

  it('tilting 90 degrees about xDir turns XY into the XZ plane', () => {
    const k = new Regenerator()
    k.regenerate(docOf(planeFeature('p', xy, '0', '90')), 1)
    const f = k.planeFrame(cp('p'))!
    near(f.normal, [0, -1, 0])
    near(f.yDir, [0, 0, 1])
    near(f.xDir, [1, 0, 0])
    k.dispose()
  })

  it('a plane on a plane stacks the offsets', () => {
    const k = new Regenerator()
    const r = k.regenerate(docOf(planeFeature('p', xy, '10'), planeFeature('q', cp('p'), '5')), 1)
    expect(allOk(r)).toBe(true)
    near(k.planeFrame(cp('q'))!.origin, [0, 0, 15])
    expect(k.constructionPlanes().map((p) => p.name)).toEqual(['p', 'q'])
    k.dispose()
  })

  it('a plane on a flat face: stable frame; offset along the outward normal', () => {
    const k = new Regenerator()
    const r = k.regenerate(docOf(...box(), planeFeature('p', faceRef('e/cap:end'), '5')), 1)
    expect(allOk(r)).toBe(true)
    const f = k.planeFrame(cp('p'))!
    near(f.origin, [0, 0, 15])
    near(f.xDir, [1, 0, 0])
    near(f.yDir, [0, 1, 0])
    near(f.normal, [0, 0, 1])
    // a side face (y = 0, outward -Y): origin is the projection of the world origin
    const g = k.planeFrame(faceRef('e/side/l1'))!
    near(g.normal, [0, -1, 0])
    near(g.origin, [0, 0, 0])
    near(g.xDir, [1, 0, 0])
    near(g.yDir, [0, 0, 1])
    // a face whose normal is along X: world X is parallel to it, so world Y is used
    const h = k.planeFrame(faceRef('e/side/l2'))!
    near(h.normal, [1, 0, 0])
    near(h.xDir, [0, 1, 0])
    near(h.yDir, [0, 0, 1])
    near(h.origin, [40, 0, 0])
    k.dispose()
  })

  it('a plane on a curved face is a readable error', () => {
    const k = new Regenerator()
    const doc = docOf(
      sketchFeature('s', 'XY', [...rect('l', 10, 0, 10, 20), constructionLine('ax', [0, 0], [0, 1])]),
      revolveFeature('r', [BOX], { kind: 'sketchEdge', name: 's/ax' }, '360'),
      planeFeature('p', faceRef('r/side/l2'), '5'),
    )
    const r = k.regenerate(doc, 1)
    expect(r.statuses[2].ok).toBe(false)
    expect(r.statuses[2].message).toBe('This face is not flat.')
    k.dispose()
  })

  it('a plane on a face that is gone says so', () => {
    const k = new Regenerator()
    const r = k.regenerate(docOf(...box(), planeFeature('p', faceRef('e/gone'), '5')), 1)
    expect(r.statuses[2].ok).toBe(false)
    expect(r.statuses[2].message).toMatch(/gone/)
    k.dispose()
  })

  it('the plane follows an upstream edit', () => {
    const k = new Regenerator()
    const d = (dist: string) => docOf(...box(40, 20, dist), planeFeature('p', faceRef('e/cap:end'), '5'))
    k.regenerate(d('10'), 1)
    k.regenerate(d('25'), 2)
    near(k.planeFrame(cp('p'))!.origin, [0, 0, 30])
    k.dispose()
  })
})

// ---- 6. sketches on faces and construction planes --------------------------------------------

describe('6. sketch on a face or a construction plane', () => {
  const HOLE = 'sk/region:c'
  const holeDoc = (dist = '10', w = 40, on: Ref = faceRef('e/cap:end')) =>
    docOf(
      ...box(w, 20, dist),
      sketchOn('sk', on, [circle('c', [20, 10], 3)]),
      extrudeFeature('cut', [HOLE], '10', -1, 'subtract', ['e']),
    )

  it('a circle on the top cap, cut down through 10, makes a hole', () => {
    const k = new Regenerator()
    const r = k.regenerate(holeDoc(), 1)
    expect(allOk(r)).toBe(true)
    expect(r.bodies).toEqual(['e'])
    expect(vol(k)).toBeCloseTo(8000 - Math.PI * 9 * 10, 2)
    near(k.getSketch('sk')!.frame.origin, [0, 0, 10])
    k.dispose()
  })

  it('the hole re-cuts after an upstream edit (taller box, wider box)', () => {
    const k = new Regenerator()
    k.regenerate(holeDoc(), 1)
    let r = k.regenerate(holeDoc('25'), 2)
    expect(allOk(r)).toBe(true)
    expect(vol(k)).toBeCloseTo(40 * 20 * 25 - Math.PI * 9 * 10, 2)
    near(k.getSketch('sk')!.frame.origin, [0, 0, 25])
    r = k.regenerate(holeDoc('25', 60), 3)
    expect(allOk(r)).toBe(true)
    expect(vol(k)).toBeCloseTo(60 * 20 * 25 - Math.PI * 9 * 10, 2)
    k.dispose()
  })

  it('sketchFrame exposes the frame', () => {
    const k = new Regenerator()
    k.regenerate(holeDoc(), 1)
    near(k.sketchFrame('sk')!.normal, [0, 0, 1])
    expect(k.sketchFrame('nope')).toBeNull()
    k.dispose()
  })

  it('a sketch on a side face, extruded along the outward normal, adds a boss', () => {
    const k = new Regenerator()
    // side l1 is y = 0, outward -Y; frame x = X, y = Z
    const doc = docOf(
      ...box(),
      sketchOn('sk', faceRef('e/side/l1'), rect('b', 5, 2, 10, 5)),
      extrudeFeature('boss', ['sk/region:b1,b2,b3,b4'], '4', 1, 'union', ['e']),
    )
    const r = k.regenerate(doc, 1)
    expect(allOk(r)).toBe(true)
    expect(vol(k)).toBeCloseTo(8000 + 10 * 5 * 4, 2)
    near(bbox(k).lo, [0, -4, 0], 3)
    k.dispose()
  })

  it('a sketch on a curved face is a readable error', () => {
    const k = new Regenerator()
    const doc = docOf(
      sketchFeature('s', 'XY', [...rect('l', 10, 0, 10, 20), constructionLine('ax', [0, 0], [0, 1])]),
      revolveFeature('r', [BOX], { kind: 'sketchEdge', name: 's/ax' }, '360'),
      sketchOn('sk', faceRef('r/side/l2'), [circle('c', [0, 0], 1)]),
    )
    const r = k.regenerate(doc, 1)
    expect(r.statuses[2].ok).toBe(false)
    expect(r.statuses[2].message).toBe('This face is not flat.')
    k.dispose()
  })

  it('a sketch on a face that is gone says so', () => {
    const k = new Regenerator()
    const r = k.regenerate(docOf(...box(), sketchOn('sk', faceRef('e/gone'), [circle('c', [0, 0], 1)])), 1)
    expect(r.statuses[2].ok).toBe(false)
    expect(r.statuses[2].message).toBe('The face this sketch was on is gone.')
    k.dispose()
  })

  it('a sketch on a construction plane offset 15 from XY extrudes from z = 15', () => {
    const k = new Regenerator()
    const doc = docOf(
      planeFeature('p', { kind: 'originPlane', name: 'XY' }, '15'),
      sketchOn('sk', { kind: 'constructionPlane', name: 'p' }, [circle('c', [0, 0], 5)]),
      extrudeFeature('x', ['sk/region:c'], '10'),
    )
    const r = k.regenerate(doc, 1)
    expect(allOk(r)).toBe(true)
    const bb = bbox(k, 'x')
    near(bb.lo, [-5, -5, 15], 3)
    near(bb.hi, [5, 5, 25], 3)
    k.dispose()
  })

  it('moving the plane moves the extrude', () => {
    const k = new Regenerator()
    const d = (off: string) =>
      docOf(
        planeFeature('p', { kind: 'originPlane', name: 'XY' }, off),
        sketchOn('sk', { kind: 'constructionPlane', name: 'p' }, [circle('c', [0, 0], 5)]),
        extrudeFeature('x', ['sk/region:c'], '10'),
      )
    k.regenerate(d('15'), 1)
    k.regenerate(d('30'), 2)
    near(bbox(k, 'x').lo, [-5, -5, 30], 3)
    k.dispose()
  })

  it('a sketch on a plane that does not exist is an error', () => {
    const k = new Regenerator()
    const r = k.regenerate(docOf(sketchOn('sk', { kind: 'constructionPlane', name: 'zz' }, [])), 1)
    expect(r.statuses[0].ok).toBe(false)
    k.dispose()
  })
})

describe('7. memory and caching', () => {
  it('many regenerations of a doc with every new feature do not throw', () => {
    const k = new Regenerator()
    const doc = (w: number) =>
      docOf(
        ...box(w),
        shellFeature('sh', 'e', ['e/cap:end'], '2'),
        transformFeature('t', ['e'], { translate: ['5', '0', '0'], copy: true }),
        planeFeature('p', faceRef('e/cap:start'), '3'),
        sketchOn('sk', { kind: 'constructionPlane', name: 'p' }, [circle('c', [10, 10], 3)]),
        extrudeFeature('x', ['sk/region:c'], '4'),
        booleanFeature('u', 'union', 'e', ['x'], true),
      )
    for (let i = 0; i < 20; i++) {
      const r = k.regenerate(doc(i % 2 === 0 ? 40 : 55), i)
      expect(allOk(r)).toBe(true)
    }
    k.dispose()
    expect(k.regenerate(docOf(), 99).bodies).toEqual([])
    k.dispose()
  })

  it('an unchanged document is a cache hit (same body records)', () => {
    const k = new Regenerator()
    const doc = () => docOf(...box(), transformFeature('t', ['e'], { translate: ['5', '0', '0'] }))
    k.regenerate(doc(), 1)
    const before = k.getBody('e')
    const r = k.regenerate(doc(), 2)
    expect(r.changedBodies).toEqual([])
    expect(k.getBody('e')).toBe(before)
    k.dispose()
  })
})

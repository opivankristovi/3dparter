// Topological-naming regression suite: edit upstream, do later features still find their geometry?
import { beforeAll, describe, expect, it } from 'vitest'
import { measureVolume } from 'replicad'
import type { Feature } from '../doc/types'
import { meshBody } from './mesh'
import { Regenerator } from './regenerate'
import {
  booleanFeature,
  chamferFeature,
  circle,
  docOf,
  edgeRef,
  extrudeFeature,
  filletFeature,
  ready,
  rect,
  sketchFeature,
} from './testutil'

beforeAll(async () => {
  await ready()
})

const BOX = 's/region:l1,l2,l3,l4'
const E_TOP_1 = 'e/cap:end|e/side/l1' // top edge along the sketch's first line
const E_TOP_2 = 'e/cap:end|e/side/l3' // top edge along the third line
const E_BOT_3 = 'e/cap:start|e/side/l3'
// Volume a fillet of radius r removes along an edge of the given length.
const BLEND_VOL = (r: number, len: number) => (r * r - (Math.PI * r * r) / 4) * len

interface BoxOpts {
  w?: number
  h?: number
  dist?: string
  hole?: boolean
}

function boxFeatures(o: BoxOpts = {}): Feature[] {
  const { w = 40, h = 20, dist = '10', hole = false } = o
  const ents = [...rect('l', 0, 0, w, h), ...(hole ? [circle('h', [w / 2, h / 2], 3)] : [])]
  return [sketchFeature('s', 'XY', ents), extrudeFeature('e', [BOX], dist)]
}

const vol = (k: Regenerator, body = 'e') => measureVolume(k.getBody(body)!.built.shape as never)
const faceNames = (k: Regenerator, body = 'e') => meshBody(k.getBody(body)!, 'preview').faces.map((f) => f.name)
const edgeNames = (k: Regenerator, body = 'e') => meshBody(k.getBody(body)!, 'preview').edges.map((e) => e.name)
const allOk = (r: { statuses: { ok: boolean }[] }) => r.statuses.every((s) => s.ok)

describe('a. fillet on a named edge', () => {
  it('rounds the edge and names the blend face', () => {
    const k = new Regenerator()
    const r = k.regenerate(docOf(...boxFeatures(), filletFeature('f', [E_TOP_1], '2')), 1)
    expect(allOk(r)).toBe(true)
    expect(r.bodies).toEqual(['e'])
    expect(vol(k)).toBeCloseTo(8000 - BLEND_VOL(2, 40), 3)
    const names = faceNames(k)
    expect(names).toContain(`f/blend/${E_TOP_1}`)
    expect(names).toContain('e/cap:end')
    expect(names).toContain('e/side/l1')
    expect(new Set(names).size).toBe(names.length)
    k.dispose()
  })
})

describe('b/c/d. the fillet survives upstream edits', () => {
  const build = (o: BoxOpts) => docOf(...boxFeatures(o), filletFeature('f', [E_TOP_1], '2'))

  it('b. sketch resized 40x20 -> 50x30', () => {
    const k = new Regenerator()
    k.regenerate(build({}), 1)
    const r = k.regenerate(build({ w: 50, h: 30 }), 2)
    expect(allOk(r)).toBe(true)
    expect(r.statuses.every((s) => !s.warning)).toBe(true)
    expect(vol(k)).toBeCloseTo(50 * 30 * 10 - BLEND_VOL(2, 50), 3)
    expect(faceNames(k)).toContain(`f/blend/${E_TOP_1}`)
    k.dispose()
  })

  it('c. extrude distance 10 -> 25', () => {
    const k = new Regenerator()
    k.regenerate(build({}), 1)
    const r = k.regenerate(build({ dist: '25' }), 2)
    expect(allOk(r)).toBe(true)
    expect(r.statuses.every((s) => !s.warning)).toBe(true)
    expect(vol(k)).toBeCloseTo(40 * 20 * 25 - BLEND_VOL(2, 40), 3)
    k.dispose()
  })

  it('d. a hole is added to the sketch region', () => {
    const k = new Regenerator()
    k.regenerate(build({}), 1)
    const r = k.regenerate(build({ hole: true }), 2)
    expect(allOk(r)).toBe(true)
    expect(r.statuses.every((s) => !s.warning)).toBe(true)
    expect(vol(k)).toBeCloseTo((800 - Math.PI * 9) * 10 - BLEND_VOL(2, 40), 2)
    const names = faceNames(k)
    expect(names).toContain('e/side/h')
    expect(names).toContain(`f/blend/${E_TOP_1}`)
    k.dispose()
  })
})

describe('e. fillet then chamfer on an untouched edge', () => {
  it('both work and the chamfer face is named', () => {
    const k = new Regenerator()
    const doc = docOf(
      ...boxFeatures(),
      filletFeature('f', [E_TOP_1, E_TOP_2], '2'),
      chamferFeature('c', [E_BOT_3], '1'),
    )
    const r = k.regenerate(doc, 1)
    expect(allOk(r)).toBe(true)
    expect(vol(k)).toBeCloseTo(8000 - 2 * BLEND_VOL(2, 40) - 0.5 * 40, 3)
    const names = faceNames(k)
    expect(names).toContain(`f/blend/${E_TOP_1}`)
    expect(names).toContain(`f/blend/${E_TOP_2}`)
    expect(names).toContain(`c/blend/${E_BOT_3}`)
    k.dispose()
  })
})

describe('f. fillet on an edge made by an earlier fillet', () => {
  it('survives a re-run with an upstream size edit', () => {
    const doc = (w: number) => docOf(...boxFeatures({ w }), filletFeature('f1', [E_TOP_1], '2'))
    const probe = new Regenerator()
    probe.regenerate(doc(40), 1)
    const pick = edgeNames(probe).find((n) => n.includes('f1/blend') && n.includes('e/side/l2'))
    probe.dispose()
    expect(pick).toBeTruthy()

    const full = (w: number) =>
      docOf(...boxFeatures({ w }), filletFeature('f1', [E_TOP_1], '2'), filletFeature('f2', [pick!], '0.5'))
    const k = new Regenerator()
    const r1 = k.regenerate(full(40), 1)
    expect(allOk(r1)).toBe(true)
    expect(vol(k)).toBeLessThan(8000 - BLEND_VOL(2, 40))
    const r2 = k.regenerate(full(55), 2)
    expect(allOk(r2)).toBe(true)
    expect(r2.statuses.every((s) => !s.warning)).toBe(true)
    expect(vol(k)).toBeLessThan(55 * 20 * 10 - BLEND_VOL(2, 55))
    expect(faceNames(k).some((n) => n.startsWith('f2/blend/'))).toBe(true)
    k.dispose()
  })
})

describe('g/h/i. fillet problems', () => {
  it('g. a wrong name with a right hint is matched again by position, with a warning', () => {
    const k = new Regenerator()
    const ref = edgeRef('e/gone|e/gone', { centroid: [20, 0, 10], length: 40 })
    const r = k.regenerate(docOf(...boxFeatures(), filletFeature('f', [ref], '2')), 1)
    expect(r.statuses[2].ok).toBe(true)
    expect(r.statuses[2].warning).toMatch(/position/)
    expect(vol(k)).toBeCloseTo(8000 - BLEND_VOL(2, 40), 3)
    k.dispose()
  })

  it('g2. a hint that points at nothing does not match', () => {
    const k = new Regenerator()
    const ref = edgeRef('e/gone|e/gone', { centroid: [200, 200, 200], length: 40 })
    const r = k.regenerate(docOf(...boxFeatures(), filletFeature('f', [ref], '2')), 1)
    expect(r.statuses[2].ok).toBe(false)
    k.dispose()
  })

  it('h. a gone edge without a usable hint fails; the body stays as it was for later steps', () => {
    const k = new Regenerator()
    const doc = docOf(
      ...boxFeatures(),
      filletFeature('f', [edgeRef('e/gone|e/gone')], '2'),
      chamferFeature('c', [E_BOT_3], '1'),
    )
    const r = k.regenerate(doc, 1)
    expect(r.statuses[2].ok).toBe(false)
    expect(r.statuses[2].message).toMatch(/gone/)
    expect(r.statuses[2].message!.endsWith('.')).toBe(true)
    expect(r.statuses[3].ok).toBe(true)
    expect(r.bodies).toEqual(['e'])
    expect(vol(k)).toBeCloseTo(8000 - 0.5 * 40, 3)
    k.dispose()
  })

  it('i. a radius that is too large fails without throwing', () => {
    const k = new Regenerator()
    const r = k.regenerate(docOf(...boxFeatures(), filletFeature('f', [E_TOP_1], '15')), 1)
    expect(r.statuses[2].ok).toBe(false)
    expect(r.statuses[2].message).toMatch(/radius is too large/)
    expect(vol(k)).toBeCloseTo(8000, 3)
    k.dispose()
  })

  it('rejects a radius that is not positive and edges from two bodies', () => {
    const k = new Regenerator()
    let r = k.regenerate(docOf(...boxFeatures(), filletFeature('f', [E_TOP_1], '0')), 1)
    expect(r.statuses[2].ok).toBe(false)
    const two = docOf(
      sketchFeature('s', 'XY', [...rect('l', 0, 0, 40, 20), ...rect('m', 100, 0, 40, 20)]),
      extrudeFeature('e', [BOX], '10'),
      extrudeFeature('e2', ['s/region:m1,m2,m3,m4'], '10'),
      filletFeature('f', [E_TOP_1, 'e2/cap:end|e2/side/m1'], '1'),
    )
    r = k.regenerate(two, 2)
    expect(r.statuses[3].ok).toBe(false)
    expect(r.statuses[3].message).toMatch(/one solid/)
    k.dispose()
  })
})

// Two overlapping 40x20x10 boxes: A at the origin, B shifted by (20, 10). Overlap = 20 x 10 x 10.
function twoBoxes(bx = 20, by = 10): Feature[] {
  return [
    sketchFeature('sA', 'XY', rect('l', 0, 0, 40, 20)),
    extrudeFeature('eA', ['sA/region:l1,l2,l3,l4'], '10'),
    sketchFeature('sB', 'XY', rect('m', bx, by, 40, 20)),
  ]
}
const REGION_B = 'sB/region:m1,m2,m3,m4'

describe('j. extrude modes', () => {
  const run = (mode: 'union' | 'subtract' | 'intersect') => {
    const k = new Regenerator()
    const r = k.regenerate(docOf(...twoBoxes(), extrudeFeature('eB', [REGION_B], '10', 1, mode, ['eA'])), 1)
    return { k, r }
  }

  it('union: one body named eA, A faces keep names, tool faces named by the tool', () => {
    const { k, r } = run('union')
    expect(allOk(r)).toBe(true)
    expect(r.bodies).toEqual(['eA'])
    expect(vol(k, 'eA')).toBeCloseTo(14000, 3)
    const names = faceNames(k, 'eA')
    expect(names).toContain('eA/side/l1')
    expect(names.some((n) => n.startsWith('eA/side/l2'))).toBe(true)
    expect(names.some((n) => n.startsWith('eA/cap:start'))).toBe(true)
    expect(names.some((n) => n.startsWith('eB/side/m1'))).toBe(true)
    expect(names.some((n) => n.startsWith('eB/side/m3'))).toBe(true)
    expect(new Set(names).size).toBe(names.length)
    k.dispose()
  })

  it('subtract: A minus the overlap, body stays eA', () => {
    const { k, r } = run('subtract')
    expect(allOk(r)).toBe(true)
    expect(r.bodies).toEqual(['eA'])
    expect(vol(k, 'eA')).toBeCloseTo(6000, 3)
    const names = faceNames(k, 'eA')
    expect(names).toContain('eA/side/l1')
    expect(names.some((n) => n.startsWith('eB/side/m'))).toBe(true) // the new walls of the pocket
    k.dispose()
  })

  it('intersect: only the overlap', () => {
    const { k, r } = run('intersect')
    expect(allOk(r)).toBe(true)
    expect(r.bodies).toEqual(['eA'])
    expect(vol(k, 'eA')).toBeCloseTo(2000, 3)
    k.dispose()
  })

  it('a missing target is a readable error', () => {
    const k = new Regenerator()
    const r = k.regenerate(docOf(...twoBoxes(), extrudeFeature('eB', [REGION_B], '10', 1, 'subtract', [])), 1)
    expect(r.statuses[3].ok).toBe(false)
    expect(r.statuses[3].message).toBe('Pick the solid to cut from.')
    expect(r.bodies).toEqual(['eA'])
    k.dispose()
  })
})

describe('k. boolean feature', () => {
  const bothNew = (bx = 20, by = 10): Feature[] => [...twoBoxes(bx, by), extrudeFeature('eB', [REGION_B], '10')]

  it('union consumes the tool unless keepTools', () => {
    const k = new Regenerator()
    let r = k.regenerate(docOf(...bothNew(), booleanFeature('u', 'union', 'eA', ['eB'], false)), 1)
    expect(allOk(r)).toBe(true)
    expect(r.bodies).toEqual(['eA'])
    expect(vol(k, 'eA')).toBeCloseTo(14000, 3)
    r = k.regenerate(docOf(...bothNew(), booleanFeature('u', 'union', 'eA', ['eB'], true)), 2)
    expect(r.bodies).toEqual(['eA', 'eB'])
    expect(vol(k, 'eB')).toBeCloseTo(8000, 3)
    k.dispose()
  })

  it('subtract and intersect give the right volumes', () => {
    const k = new Regenerator()
    k.regenerate(docOf(...bothNew(), booleanFeature('b', 'subtract', 'eA', ['eB'])), 1)
    expect(vol(k, 'eA')).toBeCloseTo(6000, 3)
    k.regenerate(docOf(...bothNew(), booleanFeature('b', 'intersect', 'eA', ['eB'])), 2)
    expect(vol(k, 'eA')).toBeCloseTo(2000, 3)
    k.dispose()
  })

  it('re-runs after the tool sketch moves, keeping the untouched face names of A', () => {
    const k = new Regenerator()
    const doc = (bx: number, by: number) => docOf(...bothNew(bx, by), booleanFeature('u', 'union', 'eA', ['eB']))
    k.regenerate(doc(20, 10), 1)
    const r = k.regenerate(doc(25, 5), 2)
    expect(allOk(r)).toBe(true)
    // overlap is now 15 x 15 x 10
    expect(vol(k, 'eA')).toBeCloseTo(16000 - 2250, 3)
    const names = faceNames(k, 'eA')
    expect(names).toContain('eA/side/l1')
    expect(names).toContain('eA/side/l4')
    k.dispose()
  })

  it('reports a missing tool and leaves the bodies alone', () => {
    const k = new Regenerator()
    const r = k.regenerate(docOf(...bothNew(), booleanFeature('u', 'union', 'eA', ['nope'])), 1)
    expect(r.statuses[r.statuses.length - 1].ok).toBe(false)
    expect(r.bodies).toEqual(['eA', 'eB'])
    k.dispose()
  })
})

describe('l. fillet after a boolean', () => {
  it('rounds an edge of A far from B and still works after B moves', () => {
    const k = new Regenerator()
    const edge = 'eA/side/l1|eA/side/l4'
    const doc = (bx: number, by: number) =>
      docOf(
        ...twoBoxes(bx, by),
        extrudeFeature('eB', [REGION_B], '10'),
        booleanFeature('u', 'union', 'eA', ['eB']),
        filletFeature('f', [edge], '2'),
      )
    let r = k.regenerate(doc(20, 10), 1)
    expect(allOk(r)).toBe(true)
    expect(vol(k, 'eA')).toBeCloseTo(14000 - BLEND_VOL(2, 10), 3)
    r = k.regenerate(doc(25, 8), 2)
    expect(allOk(r)).toBe(true)
    expect(r.statuses.every((s) => !s.warning)).toBe(true)
    expect(faceNames(k, 'eA')).toContain(`f/blend/${edge}`)
    k.dispose()
  })
})

describe('m. memory', () => {
  it('30 regenerations of a fillet+chamfer doc do not throw', () => {
    const k = new Regenerator()
    const doc = (w: number) =>
      docOf(...boxFeatures({ w }), filletFeature('f', [E_TOP_1, E_TOP_2], '2'), chamferFeature('c', [E_BOT_3], '1'))
    for (let i = 0; i < 30; i++) {
      const r = k.regenerate(doc(i % 2 === 0 ? 40 : 55), i)
      expect(allOk(r)).toBe(true)
    }
    k.dispose()
    expect(k.regenerate(docOf(), 99).bodies).toEqual([])
    k.dispose()
  })
})

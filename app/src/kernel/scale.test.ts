// Scale feature: uniform scaling about the origin or the body's own centre, names kept, errors plain.
import { beforeAll, describe, expect, it } from 'vitest'
import { measureVolume } from 'replicad'
import type { ScaleFeature } from '../doc/types'
import { meshBody } from './mesh'
import { Regenerator } from './regenerate'
import { bodyRef, docOf, extrudeFeature, filletFeature, ready, rect, sketchFeature } from './testutil'

beforeAll(async () => {
  await ready()
})

const BOX = 's/region:l1,l2,l3,l4'
const base = () => [sketchFeature('s', 'XY', rect('l', 0, 0, 10, 20)), extrudeFeature('e', [BOX], '30')]
const vol = (k: Regenerator) => measureVolume(k.getBody('e')!.built.shape as never)
const bbox = (k: Regenerator) => {
  const bb = k.getBody('e')!.built.shape.boundingBox
  const [lo, hi] = bb.bounds
  bb.delete()
  return { lo, hi }
}
const names = (k: Regenerator) => {
  const m = meshBody(k.getBody('e')!, 'preview')
  return [m.faces.map((f) => f.name).sort(), m.edges.map((e) => e.name).sort()]
}

function scaleFeature(factor: string, center: ScaleFeature['params']['center']): ScaleFeature {
  return { id: 'sc', name: 'Scale 1', suppressed: false, type: 'scale', params: { bodies: [bodyRef('e')], factor, center } }
}

describe('scale feature', () => {
  it('scales a 10x20x30 box by 2 about the origin: volume x8, names kept', () => {
    const k = new Regenerator()
    k.regenerate(docOf(...base()), 1)
    const before = names(k)
    const v0 = vol(k)
    const r = k.regenerate(docOf(...base(), scaleFeature('2', 'origin')), 2)
    expect(r.statuses.every((s) => s.ok)).toBe(true)
    expect(r.bodies).toEqual(['e'])
    expect(vol(k)).toBeCloseTo(v0 * 8, 3)
    const { lo, hi } = bbox(k)
    expect(lo[0]).toBeCloseTo(0, 4)
    expect(hi[0]).toBeCloseTo(20, 4)
    expect(hi[1]).toBeCloseTo(40, 4)
    expect(hi[2]).toBeCloseTo(60, 4)
    expect(names(k)).toEqual(before)
    k.dispose()
  })

  it('bodyCenter keeps the centre of the bounding box where it was', () => {
    const k = new Regenerator()
    k.regenerate(docOf(...base()), 1)
    const c0 = (() => {
      const { lo, hi } = bbox(k)
      return lo.map((v, i) => (v + hi[i]) / 2)
    })()
    const r = k.regenerate(docOf(...base(), scaleFeature('0.5', 'bodyCenter')), 2)
    expect(r.statuses.every((s) => s.ok)).toBe(true)
    const { lo, hi } = bbox(k)
    lo.forEach((v, i) => expect((v + hi[i]) / 2).toBeCloseTo(c0[i], 4))
    expect(hi[0] - lo[0]).toBeCloseTo(5, 4)
    expect(hi[2] - lo[2]).toBeCloseTo(15, 4)
    k.dispose()
  })

  it('a fillet after the scale that names an edge still regenerates', () => {
    const k = new Regenerator()
    const r = k.regenerate(docOf(...base(), scaleFeature('2', 'origin'), filletFeature('f', ['e/cap:end|e/side/l1'], '3')), 1)
    expect(r.statuses.every((s) => s.ok)).toBe(true)
    expect(vol(k)).toBeLessThan(10 * 20 * 30 * 8)
    k.dispose()
  })

  it('a factor of 0 or less is an error in plain words', () => {
    const k = new Regenerator()
    for (const factor of ['0', '-2']) {
      const r = k.regenerate(docOf(...base(), scaleFeature(factor, 'origin')), 1)
      const status = r.statuses.find((s) => s.featureId === 'sc')!
      expect(status.ok).toBe(false)
      expect(status.message).toBe('Enter a scale factor greater than 0.')
    }
    k.dispose()
  })

  it('accepts a variable in the factor', () => {
    const k = new Regenerator()
    const doc = docOf(...base(), scaleFeature('k * 2', 'origin'))
    doc.variables = [{ id: 'v1', name: 'k', expression: '1.5' }]
    const r = k.regenerate(doc, 1)
    expect(r.statuses.every((s) => s.ok)).toBe(true)
    expect(bbox(k).hi[2]).toBeCloseTo(90, 4)
    k.dispose()
  })
})

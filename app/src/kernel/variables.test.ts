// Variables in the kernel: Expr fields are evaluated once per regenerate, before keying and building.
import { beforeAll, describe, expect, it } from 'vitest'
import { measureVolume } from 'replicad'
import type { ProjectDocument, Variable } from '../doc/types'
import { Regenerator } from './regenerate'
import { docOf, extrudeFeature, planeFeature, rect, ready, sketchFeature, transformFeature } from './testutil'

beforeAll(async () => {
  await ready()
})

const REGION = (s: string) => `${s}/region:${s}1,${s}2,${s}3,${s}4`
const v = (id: string, name: string, expression: string): Variable => ({ id, name, expression })

/** Two independent boxes: e1 (40x20, distance from the field) and e2 (10x10x5, fixed). */
function twoBoxes(distance: string, vars: Variable[]): ProjectDocument {
  const d = docOf(
    sketchFeature('a', 'XY', rect('a', 0, 0, 40, 20)),
    extrudeFeature('e1', [REGION('a')], distance),
    sketchFeature('b', 'XY', rect('b', 100, 0, 10, 10)),
    extrudeFeature('e2', [REGION('b')], '5'),
  )
  d.variables = vars
  return d
}

const volume = (k: Regenerator, name: string) => measureVolume(k.getBody(name)!.built.shape as never)

describe('a variable drives a feature', () => {
  it('an extrude distance can be a variable, and changing it changes the volume', () => {
    const k = new Regenerator()
    let r = k.regenerate(twoBoxes('h', [v('1', 'h', '10')]), 1)
    expect(r.statuses.every((s) => s.ok)).toBe(true)
    expect(volume(k, 'e1')).toBeCloseTo(8000, 3)
    r = k.regenerate(twoBoxes('h', [v('1', 'h', '15')]), 2)
    expect(r.statuses.every((s) => s.ok)).toBe(true)
    expect(volume(k, 'e1')).toBeCloseTo(12000, 3)
    k.dispose()
  })

  it('evaluates expressions, units and nested variables', () => {
    const k = new Regenerator()
    const r = k.regenerate(twoBoxes('base * 2 + 1 cm', [v('2', 'h', 'base * 2'), v('1', 'base', '5')]), 1)
    expect(r.statuses.every((s) => s.ok)).toBe(true)
    expect(volume(k, 'e1')).toBeCloseTo(16000, 3) // 5*2 + 10 = 20 -> 40*20*20
    k.dispose()
  })

  it('re-runs only the features whose values change', () => {
    const k = new Regenerator()
    k.regenerate(twoBoxes('h', [v('1', 'h', '10'), v('2', 'unused', '3')]), 1)
    const e1 = k.getBody('e1')!
    const e2 = k.getBody('e2')!
    const same = k.regenerate(twoBoxes('h', [v('1', 'h', '10'), v('2', 'unused', '99')]), 2)
    expect(same.changedBodies).toEqual([])
    expect(k.getBody('e1')).toBe(e1)
    expect(k.getBody('e2')).toBe(e2)

    // "10" and "5 * 2" are the same number: the cache key uses the evaluated value.
    const alsoSame = k.regenerate(twoBoxes('h', [v('1', 'h', '5 * 2')]), 3)
    expect(alsoSame.changedBodies).toEqual([])
    expect(k.getBody('e1')).toBe(e1)

    const changed = k.regenerate(twoBoxes('h', [v('1', 'h', '12')]), 4)
    expect(changed.changedBodies).toEqual(['e1'])
    expect(k.getBody('e1')).not.toBe(e1)
    expect(k.getBody('e2')).toBe(e2)
    k.dispose()
  })

  it('evaluates revolve, fillet-style numbers, transform and plane fields too', () => {
    const k = new Regenerator()
    const d = docOf(
      sketchFeature('a', 'XY', rect('a', 0, 0, 40, 20)),
      extrudeFeature('e1', [REGION('a')], '10'),
      transformFeature('t', ['e1'], { translate: ['dx', '0', '1 cm'] }),
      planeFeature('p', { kind: 'originPlane', name: 'XY' }, 'dx * 2', 'ang'),
    )
    d.variables = [v('1', 'dx', '7'), v('2', 'ang', '30')]
    const r = k.regenerate(d, 1)
    expect(r.statuses.every((s) => s.ok)).toBe(true)
    const bb = k.getBody('e1')!.built.shape.boundingBox
    const [lo] = bb.bounds
    bb.delete()
    expect(lo[0]).toBeCloseTo(7, 6)
    expect(lo[2]).toBeCloseTo(10, 6)
    const plane = k.constructionPlanes()[0].frame
    expect(plane.origin[2]).toBeCloseTo(14 * Math.cos(Math.PI / 6), 6)
    k.dispose()
  })
})

describe('problems', () => {
  it('an unknown name is the feature status, prefixed with the field', () => {
    const k = new Regenerator()
    const r = k.regenerate(twoBoxes('widht', [v('1', 'width', '10')]), 1)
    expect(r.statuses[1]).toMatchObject({ featureId: 'e1', ok: false, message: 'Distance: There is no variable called widht.' })
    expect(r.bodies).toEqual(['e2'])
    k.dispose()
  })

  it('the failure follows the variables: adding the missing one fixes it', () => {
    const k = new Regenerator()
    expect(k.regenerate(twoBoxes('widht', []), 1).statuses[1].ok).toBe(false)
    const r = k.regenerate(twoBoxes('widht', [v('1', 'widht', '10')]), 2)
    expect(r.statuses[1].ok).toBe(true)
    k.dispose()
  })

  it('a cycle in the variables gives errors on the features that use them', () => {
    const k = new Regenerator()
    const r = k.regenerate(twoBoxes('a', [v('1', 'a', 'b'), v('2', 'b', 'a')]), 1)
    expect(r.statuses[1].ok).toBe(false)
    expect(r.statuses[1].message).toMatch(/^Distance: /)
    expect(r.statuses[1].message).toMatch(/\ba\b/)
    expect(r.statuses[3].ok).toBe(true) // e2 does not use them
    k.dispose()
  })

  it('division by zero and bad syntax are reported with the field', () => {
    const k = new Regenerator()
    expect(k.regenerate(twoBoxes('1 / 0', []), 1).statuses[1].message).toBe('Distance: Cannot divide by zero.')
    expect(k.regenerate(twoBoxes('2 +', []), 2).statuses[1].message).toMatch(/^Distance: .*\.$/)
    k.dispose()
  })

  it('keeps the existing checks on the evaluated number', () => {
    const k = new Regenerator()
    const r = k.regenerate(twoBoxes('h - 10', [v('1', 'h', '10')]), 1)
    expect(r.statuses[1]).toMatchObject({ ok: false, message: 'Enter a distance greater than 0.' })
    k.dispose()
  })

  it('an empty plane angle still means 0', () => {
    const k = new Regenerator()
    const r = k.regenerate(docOf(planeFeature('p', { kind: 'originPlane', name: 'XY' }, '5', '')), 1)
    expect(r.statuses[0].ok).toBe(true)
    k.dispose()
  })
})

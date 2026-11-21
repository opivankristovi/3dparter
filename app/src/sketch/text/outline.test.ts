import { beforeAll, describe, expect, it } from 'vitest'
import type { CircleEntity, Sketch, TextEntity } from '../../doc/types'
import { findRegions } from '../../kernel/regions'
import { contourBounds, expandText, textContours } from './outline'
import { loadTestFont } from './testFont'
import type { Font } from './font'

let font: Font
beforeAll(() => {
  font = loadTestFont()
})

const text = (over: Partial<TextEntity> = {}): TextEntity => ({
  id: 't1',
  type: 'text',
  construction: false,
  position: [0, 0],
  text: 'AB',
  size: 10,
  rotation: 0,
  ...over,
})
const sketchOf = (...entities: Sketch['entities']): Sketch => ({ entities, constraints: [] })

describe('sketch text outlines', () => {
  it('parses the bundled font', () => {
    expect(font.unitsPerEm).toBeGreaterThan(0)
    expect(font.charToGlyph('A').advanceWidth).toBeGreaterThan(0)
  })

  it('gives closed contours for "AB" sized by the cap height', () => {
    const t = text()
    const contours = textContours(t, sketchOf(t), font)
    // A: outer + counter; B: outer + two counters.
    expect(contours.length).toBe(5)
    for (const c of contours) expect(c.length).toBeGreaterThanOrEqual(3)
    const b = contourBounds(contours)!
    expect(b.min[1]).toBeCloseTo(0, 1)
    expect(b.max[1]).toBeCloseTo(10, 0) // cap height = size
    expect(b.max[0]).toBeGreaterThan(10)
  })

  it('has no contours for empty text', () => {
    const t = text({ text: '' })
    expect(textContours(t, sketchOf(t), font)).toEqual([])
    expect(expandText(sketchOf(t), font).entities).toEqual([])
  })

  it('rotates and moves straight text', () => {
    const t = text({ text: 'I', position: [5, 7], rotation: Math.PI / 2 })
    const b = contourBounds(textContours(t, sketchOf(t), font))!
    // Rotated a quarter turn: the glyph height now runs along -x from the position.
    expect(b.max[0]).toBeLessThanOrEqual(5.01)
    expect(b.min[0]).toBeCloseTo(-5, 0)
    expect(b.min[1]).toBeGreaterThanOrEqual(7)
  })

  it('makes a region with a hole for "o" and names it by contour', () => {
    const t = text({ text: 'o' })
    const expanded = expandText(sketchOf(t), font)
    expect(expanded.entities.every((e) => e.type === 'line' && /^t1~\d+\.\d+$/.test(e.id))).toBe(true)
    const regions = findRegions('s1', expanded)
    expect(regions).toHaveLength(1)
    expect(regions[0].holes).toHaveLength(1)
    expect(regions[0].name).toMatch(/^s1\/region:t1~\d+$/)
    expect(regions[0].area).toBeGreaterThan(1)
    expect(regions[0].area).toBeLessThan(regions[0].outer.area)
  })

  it('names the regions of "HI" with the short form', () => {
    const t = text({ text: 'HI' })
    const regions = findRegions('s1', expandText(sketchOf(t), font))
    expect(regions).toHaveLength(2)
    for (const r of regions) expect(r.name).toMatch(/^s1\/region:t1~\d$/)
  })

  it('removes text without a font', () => {
    const t = text()
    expect(expandText(sketchOf(t), null).entities).toEqual([])
  })

  it('lays outside text on top of a circle (letters stand outwards)', () => {
    const c: CircleEntity = { id: 'c1', type: 'circle', construction: false, center: [3, -2], radius: 20 }
    const t = text({ text: 'ABC', path: { entityId: 'c1', offset: 0.25, side: 'outside' } })
    const contours = textContours(t, sketchOf(c, t), font)
    expect(contours.length).toBeGreaterThan(0)
    for (const poly of contours) {
      for (const p of poly) {
        const r = Math.hypot(p[0] - 3, p[1] + 2)
        expect(r).toBeGreaterThan(20 - 0.3)
        expect(r).toBeLessThan(30.3)
      }
    }
    // Starts at 90 degrees and reads clockwise: later letters have a smaller angle.
    const angle = (poly: number[][]) => Math.atan2(poly[0][1] + 2, poly[0][0] - 3)
    expect(angle(contours[0])).toBeGreaterThan(angle(contours[contours.length - 1]))
  })

  it('lays inside text inward, reading counter-clockwise', () => {
    const c: CircleEntity = { id: 'c1', type: 'circle', construction: false, center: [0, 0], radius: 20 }
    const t = text({ text: 'AB', path: { entityId: 'c1', offset: 0.75, side: 'inside' } })
    const contours = textContours(t, sketchOf(c, t), font)
    for (const poly of contours) {
      for (const p of poly) {
        const r = Math.hypot(p[0], p[1])
        expect(r).toBeLessThan(21) // glyphs are flat on the tangent, so their feet sit a little outside
        expect(r).toBeGreaterThan(9.7)
      }
    }
  })

  it('follows a line', () => {
    const l = { id: 'l1', type: 'line' as const, construction: false, a: [0, 0] as [number, number], b: [100, 0] as [number, number] }
    const t = text({ text: 'AB', path: { entityId: 'l1', offset: 0.1, side: 'outside' } })
    const b = contourBounds(textContours(t, sketchOf(l, t), font))!
    expect(b.min[0]).toBeGreaterThanOrEqual(9.9)
    expect(b.min[1]).toBeGreaterThanOrEqual(-0.1)
    expect(b.max[1]).toBeCloseTo(10, 0)
  })
})

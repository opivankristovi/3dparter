import { describe, expect, it } from 'vitest'
import { ORIGIN_PLANES } from '../doc/types'
import type { Vec2 } from '../doc/types'
import { circlePolyline, entityAt, localToWorld, rayPlane, rectangleEntities, rectangleLines, snapPoint, worldToLocal } from './geometry'

describe('plane frames', () => {
  it('maps XZ (Front) local to world and back', () => {
    const f = ORIGIN_PLANES.XZ
    const w = localToWorld([3, 7], f)
    expect(w).toEqual([3, 0, 7])
    expect(worldToLocal([3, 0, 7], f)).toEqual([3, 7])
  })

  it('maps YZ (Right) with u along Y', () => {
    const f = ORIGIN_PLANES.YZ
    expect(localToWorld([2, 5], f)).toEqual([0, 2, 5])
    expect(worldToLocal([9, 2, 5], f)).toEqual([2, 5]) // off-plane x is dropped
  })

  it('round-trips on every origin plane', () => {
    for (const f of Object.values(ORIGIN_PLANES)) {
      const p: Vec2 = [12.5, -4.25]
      const back = worldToLocal(localToWorld(p, f), f)
      expect(back[0]).toBeCloseTo(p[0], 12)
      expect(back[1]).toBeCloseTo(p[1], 12)
    }
  })

  it('intersects a ray with the plane', () => {
    const hit = rayPlane([5, 5, 100], [0, 0, -1], ORIGIN_PLANES.XY)
    expect(hit).toEqual([5, 5, 0])
    expect(rayPlane([0, 0, 1], [1, 0, 0], ORIGIN_PLANES.XY)).toBeNull() // parallel
    expect(rayPlane([0, 0, 1], [0, 0, 1], ORIGIN_PLANES.XY)).toBeNull() // pointing away
  })
})

describe('rectangle from corners', () => {
  it('makes 4 lines that share corner points exactly', () => {
    const lines = rectangleLines([0, 0], [40, 20])
    expect(lines).toHaveLength(4)
    for (let i = 0; i < 4; i++) {
      const end = lines[i][1]
      const nextStart = lines[(i + 1) % 4][0]
      expect(end[0]).toBe(nextStart[0])
      expect(end[1]).toBe(nextStart[1])
    }
    expect(lines[0]).toEqual([[0, 0], [40, 0]])
    expect(lines[2]).toEqual([[40, 20], [0, 20]])
  })

  it('works with the second corner below and left of the first', () => {
    const lines = rectangleLines([10, 10], [-5, 2])
    expect(lines[1][1]).toEqual([-5, 2])
    expect(lines[3][1]).toEqual([10, 10])
  })

  it('builds line entities with unique ids', () => {
    let n = 0
    const ents = rectangleEntities([0, 0], [1, 1], () => `e${n++}`)
    expect(ents.map((e) => e.id)).toEqual(['e0', 'e1', 'e2', 'e3'])
    expect(ents.every((e) => e.type === 'line' && !e.construction)).toBe(true)
  })
})

describe('snapping', () => {
  it('snaps to the 1 mm grid', () => {
    const r = snapPoint([3.4, 7.6], [], 4)
    expect(r.kind).toBe('grid')
    expect(r.point).toEqual([3, 8])
  })

  it('an endpoint within 8 px beats the grid', () => {
    // 4 px per mm: 8 px = 2 mm. The endpoint is about 1 mm away; the grid point would be (10, 5).
    const r = snapPoint([10.4, 5.3], [[11.2, 5.9]], 4)
    expect(r.kind).toBe('endpoint')
    expect(r.point).toEqual([11.2, 5.9])
  })

  it('ignores endpoints beyond the radius', () => {
    const r = snapPoint([10, 10], [[20, 20]], 4)
    expect(r.kind).toBe('grid')
  })

  it('picks the nearest of several endpoints', () => {
    const r = snapPoint([1, 1], [[1.5, 1], [1.1, 1]], 4)
    expect(r.point).toEqual([1.1, 1])
  })

  it('Alt disables the grid but not endpoints', () => {
    expect(snapPoint([3.4, 7.6], [], 4, { noGrid: true })).toEqual({ point: [3.4, 7.6], kind: 'none' })
    expect(snapPoint([3.4, 7.6], [[3.5, 7.6]], 4, { noGrid: true }).kind).toBe('endpoint')
  })
})

describe('entity hit testing', () => {
  it('finds a line and a circle rim', () => {
    const line = { id: 'l', type: 'line' as const, construction: false, a: [0, 0] as Vec2, b: [10, 0] as Vec2 }
    const circ = { id: 'c', type: 'circle' as const, construction: false, center: [0, 0] as Vec2, radius: 20 }
    expect(entityAt([line, circ], [5, 0.5], 1)?.id).toBe('l')
    expect(entityAt([line, circ], [20.3, 0], 1)?.id).toBe('c')
    expect(entityAt([line, circ], [5, 5], 1)).toBeNull()
  })

  it('circle polyline closes on itself', () => {
    const pts = circlePolyline([0, 0], 5, 8)
    expect(pts).toHaveLength(9)
    expect(pts[0][0]).toBeCloseTo(pts[8][0], 12)
    expect(pts[0][1]).toBeCloseTo(pts[8][1], 12)
  })
})

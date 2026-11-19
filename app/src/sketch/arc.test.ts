import { describe, expect, it } from 'vitest'
import type { Vec2 } from '../doc/types'
import { arcPolyline, arcThroughPoints, arcWithRadius, ccwSweep, circleThrough } from './arc'

const at = (a: { center: Vec2; radius: number }, ang: number): Vec2 => [
  a.center[0] + a.radius * Math.cos(ang),
  a.center[1] + a.radius * Math.sin(ang),
]
/** True when p lies on the arc: on the circle and inside the counter-clockwise sweep. */
function onArc(a: { center: Vec2; radius: number; startAngle: number; endAngle: number }, p: Vec2): boolean {
  const onCircle = Math.abs(Math.hypot(p[0] - a.center[0], p[1] - a.center[1]) - a.radius) < 1e-6
  const ang = Math.atan2(p[1] - a.center[1], p[0] - a.center[0])
  return onCircle && ccwSweep(a.startAngle, ang) <= ccwSweep(a.startAngle, a.endAngle) + 1e-9
}

describe('circleThrough', () => {
  it('finds the circle through three points', () => {
    const c = circleThrough([10, 0], [0, 10], [-10, 0])
    expect(c?.center[0]).toBeCloseTo(0)
    expect(c?.center[1]).toBeCloseTo(0)
    expect(c?.radius).toBeCloseTo(10)
  })
  it('refuses collinear or repeated points', () => {
    expect(circleThrough([0, 0], [1, 1], [2, 2])).toBeNull()
    expect(circleThrough([0, 0], [0, 0], [5, 5])).toBeNull()
  })
})

describe('arcThroughPoints', () => {
  it('passes through the third point when it is on the counter-clockwise side', () => {
    const a = arcThroughPoints([10, 0], [-10, 0], [0, 10])!
    expect(a.radius).toBeCloseTo(10)
    expect(onArc(a, [10, 0])).toBe(true)
    expect(onArc(a, [-10, 0])).toBe(true)
    expect(onArc(a, [0, 10])).toBe(true)
    expect(onArc(a, [0, -10])).toBe(false)
    // CCW from p1 (0 rad) to p2 (pi rad): it starts at the first point.
    expect(a.startAngle).toBeCloseTo(0)
    expect(a.endAngle).toBeCloseTo(Math.PI)
  })

  it('swaps start and end when the third point is on the clockwise side', () => {
    const a = arcThroughPoints([10, 0], [-10, 0], [0, -10])!
    expect(onArc(a, [0, -10])).toBe(true)
    expect(onArc(a, [0, 10])).toBe(false)
    // The arc is stored counter-clockwise, so it runs from the second point to the first.
    expect(ccwSweep(a.startAngle, Math.PI)).toBeCloseTo(0)
    expect(ccwSweep(a.endAngle, 0)).toBeCloseTo(0)
  })

  it('keeps all three points on the arc for any order and side', () => {
    const pts: Vec2[][] = [
      [[0, 0], [20, 0], [10, 5]],
      [[0, 0], [20, 0], [10, -5]],
      [[20, 0], [0, 0], [10, 5]],
      [[3, 4], [-4, 3], [-5, -1]],
      [[0, 0], [0, 10], [-8, 5]],
    ]
    for (const [p1, p2, p3] of pts) {
      const a = arcThroughPoints(p1, p2, p3)!
      expect(a).not.toBeNull()
      for (const p of [p1, p2, p3]) expect(onArc(a, p)).toBe(true)
    }
  })

  it('returns null for collinear points', () => {
    expect(arcThroughPoints([0, 0], [10, 0], [5, 0])).toBeNull()
  })

  it('samples a polyline from start to end', () => {
    const a = arcThroughPoints([10, 0], [-10, 0], [0, 10])!
    const pl = arcPolyline(a, 8)
    expect(pl).toHaveLength(9)
    expect(pl[0][0]).toBeCloseTo(10)
    expect(pl[8][0]).toBeCloseTo(-10)
    expect(pl[4][1]).toBeCloseTo(10)
  })
})

describe('arcWithRadius', () => {
  it('uses the typed radius and the side of the third point', () => {
    const up = arcWithRadius([0, 0], [20, 0], [10, 3], 15)!
    expect(up.radius).toBe(15)
    expect(onArc(up, [0, 0])).toBe(true)
    expect(onArc(up, [20, 0])).toBe(true)
    // The centre is below the chord, so the arc bulges up toward the third point.
    expect(up.center[1]).toBeLessThan(0)
    expect(onArc(up, at(up, Math.PI / 2))).toBe(true)

    const down = arcWithRadius([0, 0], [20, 0], [10, -3], 15)!
    expect(down.center[1]).toBeGreaterThan(0)
    expect(onArc(down, at(down, -Math.PI / 2))).toBe(true)
  })

  it('turns a radius that is too small into a half circle', () => {
    const a = arcWithRadius([0, 0], [20, 0], [10, 3], 1)!
    expect(a.radius).toBeCloseTo(10)
    expect(a.center[0]).toBeCloseTo(10)
    expect(a.center[1]).toBeCloseTo(0)
  })

  it('returns null for a zero chord or a bad radius', () => {
    expect(arcWithRadius([1, 1], [1, 1], [5, 5], 4)).toBeNull()
    expect(arcWithRadius([0, 0], [4, 0], [2, 2], 0)).toBeNull()
  })
})

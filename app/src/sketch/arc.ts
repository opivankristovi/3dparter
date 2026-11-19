// Pure maths for the three-point arc tool: the circle through the points and the counter-clockwise
// start/end angles that make the arc pass through the third point.
import type { ArcEntity, Vec2 } from '../doc/types'

export interface ArcParams {
  center: Vec2
  radius: number
  startAngle: number
  endAngle: number
}

const TWO_PI = Math.PI * 2
const EPS = 1e-9

/** Counter-clockwise angle from `from` to `to`, in [0, 2pi). */
export function ccwSweep(from: number, to: number): number {
  let d = (to - from) % TWO_PI
  if (d < 0) d += TWO_PI
  return d
}

const angleOf = (c: Vec2, p: Vec2) => Math.atan2(p[1] - c[1], p[0] - c[0])

/** The arc on a given circle that runs between p1 and p2 and covers the direction of p3. */
function arcOnCircle(center: Vec2, radius: number, p1: Vec2, p2: Vec2, p3: Vec2): ArcParams {
  const a1 = angleOf(center, p1)
  const a2 = angleOf(center, p2)
  const a3 = angleOf(center, p3)
  // Going counter-clockwise from p1, p3 comes before p2: the arc starts at p1. Otherwise it starts at p2.
  return ccwSweep(a1, a3) <= ccwSweep(a1, a2)
    ? { center, radius, startAngle: a1, endAngle: a2 }
    : { center, radius, startAngle: a2, endAngle: a1 }
}

/** The circle through three points, or null when they are on one line (or two coincide). */
export function circleThrough(p1: Vec2, p2: Vec2, p3: Vec2): { center: Vec2; radius: number } | null {
  const d = 2 * (p1[0] * (p2[1] - p3[1]) + p2[0] * (p3[1] - p1[1]) + p3[0] * (p1[1] - p2[1]))
  if (Math.abs(d) < EPS) return null
  const s1 = p1[0] * p1[0] + p1[1] * p1[1]
  const s2 = p2[0] * p2[0] + p2[1] * p2[1]
  const s3 = p3[0] * p3[0] + p3[1] * p3[1]
  const ux = (s1 * (p2[1] - p3[1]) + s2 * (p3[1] - p1[1]) + s3 * (p1[1] - p2[1])) / d
  const uy = (s1 * (p3[0] - p2[0]) + s2 * (p1[0] - p3[0]) + s3 * (p2[0] - p1[0])) / d
  const center: Vec2 = [ux, uy]
  return { center, radius: Math.hypot(p1[0] - ux, p1[1] - uy) }
}

/** Arc from p1 to p2 passing through p3. The result is always counter-clockwise (it may start at p2). */
export function arcThroughPoints(p1: Vec2, p2: Vec2, p3: Vec2): ArcParams | null {
  const c = circleThrough(p1, p2, p3)
  if (!c || !Number.isFinite(c.radius) || c.radius < EPS) return null
  return arcOnCircle(c.center, c.radius, p1, p2, p3)
}

/**
 * Arc from p1 to p2 with a typed radius. Of the two circles of that radius through both points it takes
 * the one nearest to p3, and the arc side that p3 points to. A radius below half the chord becomes a half circle.
 */
export function arcWithRadius(p1: Vec2, p2: Vec2, p3: Vec2, radius: number): ArcParams | null {
  const dx = p2[0] - p1[0]
  const dy = p2[1] - p1[1]
  const chord = Math.hypot(dx, dy)
  if (chord < EPS || !(radius > 0)) return null
  const r = Math.max(radius, chord / 2)
  const h = Math.sqrt(Math.max(0, r * r - (chord / 2) ** 2))
  const mid: Vec2 = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2]
  const nx = -dy / chord
  const ny = dx / chord
  const c1: Vec2 = [mid[0] + nx * h, mid[1] + ny * h]
  const c2: Vec2 = [mid[0] - nx * h, mid[1] - ny * h]
  const miss = (c: Vec2) => Math.abs(Math.hypot(p3[0] - c[0], p3[1] - c[1]) - r)
  const center = miss(c1) <= miss(c2) ? c1 : c2
  return arcOnCircle(center, r, p1, p2, p3)
}

/** The arc as points along it, ends included. */
export function arcPolyline(a: ArcParams, segments = 48): Vec2[] {
  const sweep = ccwSweep(a.startAngle, a.endAngle) || TWO_PI
  const out: Vec2[] = []
  for (let i = 0; i <= segments; i++) {
    const t = a.startAngle + (sweep * i) / segments
    out.push([a.center[0] + a.radius * Math.cos(t), a.center[1] + a.radius * Math.sin(t)])
  }
  return out
}

export function arcEntity(a: ArcParams, newId: () => string): ArcEntity {
  return {
    id: newId(),
    type: 'arc',
    construction: false,
    center: [a.center[0], a.center[1]],
    radius: a.radius,
    startAngle: a.startAngle,
    endAngle: a.endAngle,
  }
}

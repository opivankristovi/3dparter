// Pure sketch maths: plane frames, ray hits, shape builders and snapping. No three.js, no DOM.
import type { ArcEntity, CircleEntity, LineEntity, PlaneFrame, SketchEntity, Vec2, Vec3 } from '../doc/types'

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

/** World point to the plane's local (u, v). The point is projected onto the plane. */
export function worldToLocal(p: Vec3, f: PlaneFrame): Vec2 {
  const d: Vec3 = [p[0] - f.origin[0], p[1] - f.origin[1], p[2] - f.origin[2]]
  return [dot(d, f.xDir), dot(d, f.yDir)]
}

/** Local (u, v) to a world point: origin + u*xDir + v*yDir. */
export function localToWorld(p: Vec2, f: PlaneFrame): Vec3 {
  return [
    f.origin[0] + p[0] * f.xDir[0] + p[1] * f.yDir[0],
    f.origin[1] + p[0] * f.xDir[1] + p[1] * f.yDir[1],
    f.origin[2] + p[0] * f.xDir[2] + p[1] * f.yDir[2],
  ]
}

/** Where a ray meets the plane, or null if it is parallel to it or points away. */
export function rayPlane(origin: Vec3, dir: Vec3, f: PlaneFrame): Vec3 | null {
  const denom = dot(dir, f.normal)
  if (Math.abs(denom) < 1e-9) return null
  const t = dot([f.origin[0] - origin[0], f.origin[1] - origin[1], f.origin[2] - origin[2]], f.normal) / denom
  if (t < 0) return null
  return [origin[0] + dir[0] * t, origin[1] + dir[1] * t, origin[2] + dir[2] * t]
}

/**
 * The four sides of an axis-aligned rectangle from two opposite corners, in loop order.
 * Neighbouring sides share the SAME numbers at each corner, bit for bit, so the loop closes exactly.
 */
export function rectangleLines(a: Vec2, b: Vec2): [Vec2, Vec2][] {
  const p0: Vec2 = [a[0], a[1]]
  const p1: Vec2 = [b[0], a[1]]
  const p2: Vec2 = [b[0], b[1]]
  const p3: Vec2 = [a[0], b[1]]
  return [
    [p0, p1],
    [p1, p2],
    [p2, p3],
    [p3, p0],
  ]
}

export function rectangleEntities(a: Vec2, b: Vec2, newId: () => string): LineEntity[] {
  return rectangleLines(a, b).map(([p, q]) => ({
    id: newId(),
    type: 'line' as const,
    construction: false,
    a: [p[0], p[1]] as Vec2,
    b: [q[0], q[1]] as Vec2,
  }))
}

export function circleEntity(center: Vec2, radius: number, newId: () => string): CircleEntity {
  return { id: newId(), type: 'circle', construction: false, center: [center[0], center[1]], radius }
}

/** A circle as a closed polyline (first point repeated at the end). */
export function circlePolyline(center: Vec2, r: number, segments = 96): Vec2[] {
  const out: Vec2[] = []
  for (let i = 0; i <= segments; i++) {
    const t = (i / segments) * Math.PI * 2
    out.push([center[0] + r * Math.cos(t), center[1] + r * Math.sin(t)])
  }
  return out
}

/** Points that cursors snap to: line ends, arc/circle centres. */
export function snapTargets(entities: SketchEntity[]): Vec2[] {
  const out: Vec2[] = []
  for (const e of entities) {
    if (e.type === 'line') out.push(e.a, e.b)
    else if (e.type === 'arc') {
      out.push(e.center)
      for (const t of [e.startAngle, e.endAngle]) out.push([e.center[0] + e.radius * Math.cos(t), e.center[1] + e.radius * Math.sin(t)])
    } else out.push(e.center)
  }
  return out
}

export interface SnapOptions {
  /** Grid step in mm. Default 1. */
  grid?: number
  /** Snap radius in screen pixels. Default 8. */
  radiusPx?: number
  /** Hold Alt: no grid snap (point snap still applies). */
  noGrid?: boolean
}

export interface SnapResult {
  point: Vec2
  kind: 'endpoint' | 'grid' | 'none'
}

/**
 * Snaps a raw local point. An existing point within `radiusPx` screen pixels wins over the grid.
 * `pxPerMm` converts the distance to screen pixels at the cursor.
 */
export function snapPoint(raw: Vec2, targets: Vec2[], pxPerMm: number, opts: SnapOptions = {}): SnapResult {
  const radiusPx = opts.radiusPx ?? 8
  const grid = opts.grid ?? 1
  let best: Vec2 | null = null
  let bestD = Infinity
  for (const t of targets) {
    const d = Math.hypot(t[0] - raw[0], t[1] - raw[1]) * pxPerMm
    if (d <= radiusPx && d < bestD) {
      best = t
      bestD = d
    }
  }
  if (best) return { point: [best[0], best[1]], kind: 'endpoint' }
  if (opts.noGrid || grid <= 0) return { point: raw, kind: 'none' }
  return { point: [Math.round(raw[0] / grid) * grid, Math.round(raw[1] / grid) * grid], kind: 'grid' }
}

/** Distance from p to the segment ab. */
export function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2))
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))
}

/** Distance from p to an arc: to the curve inside its sweep, to the nearer end outside it. */
export function distToArc(p: Vec2, e: ArcEntity): number {
  const dc = Math.hypot(p[0] - e.center[0], p[1] - e.center[1])
  const TWO_PI = Math.PI * 2
  let sweep = (e.endAngle - e.startAngle) % TWO_PI
  if (sweep < 0) sweep += TWO_PI
  let rel = (Math.atan2(p[1] - e.center[1], p[0] - e.center[0]) - e.startAngle) % TWO_PI
  if (rel < 0) rel += TWO_PI
  if (rel <= sweep || sweep < 1e-9) return Math.abs(dc - e.radius)
  const end = (t: number): Vec2 => [e.center[0] + e.radius * Math.cos(t), e.center[1] + e.radius * Math.sin(t)]
  const a = end(e.startAngle)
  const b = end(e.endAngle)
  return Math.min(Math.hypot(p[0] - a[0], p[1] - a[1]), Math.hypot(p[0] - b[0], p[1] - b[1]))
}

/** The entity nearest to p within `tolMm`, or null. Lines by segment distance, circles and arcs by distance to the rim. */
export function entityAt(entities: SketchEntity[], p: Vec2, tolMm: number): SketchEntity | null {
  let best: SketchEntity | null = null
  let bestD = tolMm
  for (const e of entities) {
    let d = Infinity
    if (e.type === 'line') d = distToSegment(p, e.a, e.b)
    else if (e.type === 'circle') d = Math.abs(Math.hypot(p[0] - e.center[0], p[1] - e.center[1]) - e.radius)
    else d = distToArc(p, e)
    if (d <= bestD) {
      best = e
      bestD = d
    }
  }
  return best
}

export const samePoint = (a: Vec2, b: Vec2, eps = 1e-9) => Math.abs(a[0] - b[0]) < eps && Math.abs(a[1] - b[1]) < eps

// Geometric hints that travel with every face and edge reference the UI stores. When a name is gone after an
// upstream edit, the kernel finds the same piece of geometry again by these numbers (see kernel/naming.ts).
// Pure maths on plain arrays: no three.js, so it is unit tested without a browser.
import type { Ref, Vec3 } from '../doc/types'

export type RefHint = NonNullable<Ref['hint']>

const EPS = 1e-9

/** Faces: where the middle of the face is, which way it points, and how big it is (all area-weighted). */
export function faceHint(positions: ArrayLike<number>, indices: ArrayLike<number>, start: number, count: number): RefHint {
  let area = 0
  let cx = 0
  let cy = 0
  let cz = 0
  let nx = 0
  let ny = 0
  let nz = 0
  const end = Math.min(start + count, indices.length)
  for (let i = start; i + 2 < end; i += 3) {
    const a = indices[i] * 3
    const b = indices[i + 1] * 3
    const c = indices[i + 2] * 3
    const abx = positions[b] - positions[a]
    const aby = positions[b + 1] - positions[a + 1]
    const abz = positions[b + 2] - positions[a + 2]
    const acx = positions[c] - positions[a]
    const acy = positions[c + 1] - positions[a + 1]
    const acz = positions[c + 2] - positions[a + 2]
    // Half the cross product: its length is the triangle's area, its direction the winding normal.
    const x = (aby * acz - abz * acy) / 2
    const y = (abz * acx - abx * acz) / 2
    const z = (abx * acy - aby * acx) / 2
    const t = Math.hypot(x, y, z)
    area += t
    cx += ((positions[a] + positions[b] + positions[c]) / 3) * t
    cy += ((positions[a + 1] + positions[b + 1] + positions[c + 1]) / 3) * t
    cz += ((positions[a + 2] + positions[b + 2] + positions[c + 2]) / 3) * t
    nx += x
    ny += y
    nz += z
  }
  if (area < EPS) return { centroid: [0, 0, 0], area: 0 }
  const hint: RefHint = { centroid: [cx / area, cy / area, cz / area], area }
  const nl = Math.hypot(nx, ny, nz)
  // A face that curves all the way round (a cylinder wall) has no single outward direction.
  if (nl > area * 1e-6) hint.normal = [nx / nl, ny / nl, nz / nl]
  return hint
}

/**
 * An edge's points as segments (flat x1 y1 z1 x2 y2 z2 ...). The kernel writes segment pairs (every inner
 * point twice); a plain polyline (each point once) is accepted too.
 */
export function edgeSegments(points: ArrayLike<number>): number[] {
  const n = Math.floor(points.length / 3)
  if (n < 2) return []
  const at = (i: number): Vec3 => [points[i * 3], points[i * 3 + 1], points[i * 3 + 2]]
  const gap = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
  const pairs = n >= 4 && n % 2 === 0 && gap(at(1), at(2)) < 1e-6
  const out: number[] = []
  if (pairs || n === 2) {
    for (let i = 0; i + 1 < n; i += 2) out.push(...at(i), ...at(i + 1))
  } else {
    for (let i = 0; i + 1 < n; i++) out.push(...at(i), ...at(i + 1))
  }
  return out
}

/** Edges: the point halfway along the edge (by length), and the edge's length. */
export function edgeHint(points: ArrayLike<number>): RefHint {
  const seg = edgeSegments(points)
  let length = 0
  const lens: number[] = []
  for (let i = 0; i + 5 < seg.length; i += 6) {
    const l = Math.hypot(seg[i + 3] - seg[i], seg[i + 4] - seg[i + 1], seg[i + 5] - seg[i + 2])
    lens.push(l)
    length += l
  }
  if (length < EPS) return { centroid: seg.length >= 3 ? [seg[0], seg[1], seg[2]] : [0, 0, 0], length: 0 }
  let walk = length / 2
  let centroid: Vec3 = [seg[0], seg[1], seg[2]]
  for (let k = 0; k < lens.length; k++) {
    const o = k * 6
    if (walk <= lens[k] || k === lens.length - 1) {
      const t = lens[k] > 0 ? Math.min(1, walk / lens[k]) : 0
      centroid = [seg[o] + (seg[o + 3] - seg[o]) * t, seg[o + 1] + (seg[o + 4] - seg[o + 1]) * t, seg[o + 2] + (seg[o + 5] - seg[o + 2]) * t]
      break
    }
    walk -= lens[k]
  }
  return { centroid, length }
}

/** Closest point on the 2D segment a-b to p: the parameter t (0..1) and the distance. */
export function nearestOnSegment2D(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): { t: number; distance: number } {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  const t = len2 < EPS ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2))
  return { t, distance: Math.hypot(px - (ax + dx * t), py - (ay + dy * t)) }
}

/** Screen distance (px) under which an edge or vertex counts as under the pointer. */
export const EDGE_PICK_PX = 6
export const VERTEX_PICK_PX = 8

/** Deduplicates and orders unique edge endpoints into deterministic named vertices. */
export function extractVerticesFromEdges(
  bodyId: string,
  edges: { name: string; points: ArrayLike<number> }[],
): { name: string; point: Vec3 }[] {
  const unique: Vec3[] = []
  const addPoint = (x: number, y: number, z: number) => {
    for (const u of unique) {
      if (Math.hypot(u[0] - x, u[1] - y, u[2] - z) < 1e-4) return
    }
    unique.push([x, y, z])
  }
  for (const e of edges) {
    const n = e.points.length
    if (n < 3) continue
    addPoint(e.points[0], e.points[1], e.points[2])
    if (n >= 6) addPoint(e.points[n - 3], e.points[n - 2], e.points[n - 1])
  }
  unique.sort((a, b) => {
    for (let i = 0; i < 3; i++) {
      if (Math.abs(a[i] - b[i]) > 1e-5) return a[i] - b[i]
    }
    return 0
  })
  return unique.map((point, i) => ({ name: `${bodyId}/vertex:${i + 1}`, point }))
}

function segCrossesSeg2D(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): boolean {
  const cross = (ux: number, uy: number, vx: number, vy: number) => ux * vy - uy * vx
  const abx = bx - ax
  const aby = by - ay
  const cdx = dx - cx
  const cdy = dy - cy
  const denom = cross(abx, aby, cdx, cdy)
  if (Math.abs(denom) < EPS) return false
  const acx = cx - ax
  const acy = cy - ay
  const t = cross(acx, acy, cdx, cdy) / denom
  const u = cross(acx, acy, abx, aby) / denom
  return t >= 0 && t <= 1 && u >= 0 && u <= 1
}

/** True when the 2D segment a-b lies inside or crosses the axis-aligned rectangle [minX..maxX, minY..maxY]. */
export function segIntersectsRect2D(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): boolean {
  const inside = (x: number, y: number) => x >= minX && x <= maxX && y >= minY && y <= maxY
  if (inside(ax, ay) || inside(bx, by)) return true
  if (Math.max(ax, bx) < minX || Math.min(ax, bx) > maxX || Math.max(ay, by) < minY || Math.min(ay, by) > maxY) return false
  return (
    segCrossesSeg2D(ax, ay, bx, by, minX, minY, maxX, minY) ||
    segCrossesSeg2D(ax, ay, bx, by, maxX, minY, maxX, maxY) ||
    segCrossesSeg2D(ax, ay, bx, by, maxX, maxY, minX, maxY) ||
    segCrossesSeg2D(ax, ay, bx, by, minX, maxY, minX, minY)
  )
}

export interface EdgeCandidate {
  /** Smallest pointer distance in px over the edge's segments. */
  distance: number
  /** Where along that segment (0..1), and which segment (index into the edge's segments). */
  t: number
  segment: number
}

/** Best (closest) segment of one edge to the pointer. `screen` is flat x1 y1 x2 y2 per segment, in px. */
export function nearestOnEdge2D(px: number, py: number, screen: ArrayLike<number>): EdgeCandidate | null {
  let best: EdgeCandidate | null = null
  for (let i = 0, s = 0; i + 3 < screen.length; i += 4, s++) {
    const r = nearestOnSegment2D(px, py, screen[i], screen[i + 1], screen[i + 2], screen[i + 3])
    if (!best || r.distance < best.distance) best = { distance: r.distance, t: r.t, segment: s }
  }
  return best
}

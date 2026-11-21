// Pure 2D code, no OpenCascade: finds the closed shapes of a sketch.
//
// Method: endpoints are merged within 1e-6 mm into graph nodes, dangling edges are pruned, and the
// planar graph is walked face by face (half-edges sorted by angle). Every bounded face of the
// graph is a loop; circles (and full-turn arcs) are loops by themselves. A loop inside another
// loop is a hole of it (even depth = outer, odd depth = hole of its direct parent).
import type { ArcEntity, CircleEntity, LineEntity, Sketch, SketchEntity, Vec2 } from '../doc/types'
import type { TextSegmentEntity } from '../sketch/text/outline'

export const NODE_TOL = 1e-6
const TWO_PI = Math.PI * 2

/** One entity used by a loop, with the direction it is walked in. */
export interface LoopSegment {
  id: string
  /** Lines: walked from b to a. Arcs: walked clockwise (end to start). Circles: always false. */
  reversed: boolean
}

export interface Loop {
  /** In walking order. Counter-clockwise in sketch space. */
  segments: LoopSegment[]
  /** Closed polygon approximation (no repeated last point), for containment tests and display. */
  points: Vec2[]
  /** Exact area in mm² (arcs included). */
  area: number
}

export interface Region {
  /** '<sketchId>/region:<sorted entity ids of the outer loop joined by ",">', or '<sketchId>/region:<textId>~<c>' for a glyph (the whole text: '<textId>~*', see regenerate.ts) */
  name: string
  outer: Loop
  holes: Loop[]
  /** Outer area minus holes, mm². */
  area: number
}

// ---- entity geometry -------------------------------------------------------------------------

function arcSweep(a: ArcEntity): number {
  let s = (a.endAngle - a.startAngle) % TWO_PI
  if (s < 0) s += TWO_PI
  return s
}

function arcPoint(a: ArcEntity, ang: number): Vec2 {
  return [a.center[0] + a.radius * Math.cos(ang), a.center[1] + a.radius * Math.sin(ang)]
}

/** Samples an arc from startAngle with the given signed sweep, endpoints included. */
function sampleArc(a: ArcEntity, from: number, sweep: number): Vec2[] {
  const n = Math.max(2, Math.ceil(Math.abs(sweep) / (Math.PI / 32)))
  const out: Vec2[] = []
  for (let i = 0; i <= n; i++) out.push(arcPoint(a, from + (sweep * i) / n))
  return out
}

function samplePolyline(e: LineEntity | ArcEntity, reversed: boolean): Vec2[] {
  if (e.type === 'line') return reversed ? [e.b, e.a] : [e.a, e.b]
  const sweep = arcSweep(e)
  return reversed ? sampleArc(e, e.endAngle, -sweep) : sampleArc(e, e.startAngle, sweep)
}

function sameLength(a: number, b: number): boolean {
  return Math.abs(a - b) <= NODE_TOL
}

function isFullArc(a: ArcEntity): boolean {
  const s = arcSweep(a)
  return s < NODE_TOL / Math.max(a.radius, 1e-9) || TWO_PI - s < NODE_TOL / Math.max(a.radius, 1e-9)
}

/** Signed area contributed by one walked segment (shoelace chord term plus circular segment). */
function segmentArea(e: LineEntity | ArcEntity, reversed: boolean): number {
  const pts = samplePolyline(e, reversed)
  const p = pts[0]
  const q = pts[pts.length - 1]
  let area = 0.5 * (p[0] * q[1] - q[0] * p[1])
  if (e.type === 'arc') {
    const sweep = arcSweep(e) * (reversed ? -1 : 1)
    area += 0.5 * e.radius * e.radius * (sweep - Math.sin(sweep))
  }
  return area
}

function pointInPolygon(pt: Vec2, poly: Vec2[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]
    const [xj, yj] = poly[j]
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const l2 = dx * dx + dy * dy
  let t = l2 === 0 ? 0 : ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))
}

function onBoundary(pt: Vec2, poly: Vec2[], tol: number): boolean {
  for (let i = 0; i < poly.length; i++) {
    if (distToSegment(pt, poly[i], poly[(i + 1) % poly.length]) <= tol) return true
  }
  return false
}

/** True when `inner` lies inside `outer` (boundary contact allowed, but not entirely on it). */
function loopInside(inner: Loop, outer: Loop): boolean {
  if (outer.area <= inner.area + 1e-12) return false
  let strictlyInside = 0
  for (const p of inner.points) {
    if (onBoundary(p, outer.points, 1e-6)) continue
    if (!pointInPolygon(p, outer.points)) return false
    strictlyInside++
  }
  if (strictlyInside > 0) return true
  // Every vertex touches the outer boundary: test an interior sample (midpoint of the first chord).
  const a = inner.points[0]
  const b = inner.points[1]
  const mid: Vec2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
  const cx = inner.points.reduce((s, p) => s + p[0], 0) / inner.points.length
  const cy = inner.points.reduce((s, p) => s + p[1], 0) / inner.points.length
  const probe: Vec2 = [(mid[0] + cx) / 2, (mid[1] + cy) / 2]
  return pointInPolygon(probe, outer.points)
}

// ---- graph -----------------------------------------------------------------------------------

interface GraphEdge {
  entity: LineEntity | ArcEntity
  from: number // node index at the entity's start (a / startAngle)
  to: number
}

interface HalfEdge {
  edge: number // index into GraphEdge[]
  reversed: boolean
  from: number
  to: number
  angle: number // direction of travel when leaving `from`
}

function entityTangentAngle(e: LineEntity | ArcEntity, reversed: boolean): number {
  if (e.type === 'line') {
    const dx = e.b[0] - e.a[0]
    const dy = e.b[1] - e.a[1]
    return Math.atan2(reversed ? -dy : dy, reversed ? -dx : dx)
  }
  // Counter-clockwise tangent at the start is perpendicular to the radius; reversed leaves the end clockwise.
  const ang = reversed ? e.endAngle - Math.PI / 2 : e.startAngle + Math.PI / 2
  return Math.atan2(Math.sin(ang), Math.cos(ang))
}

function makeLoop(entities: Map<string, SketchEntity>, segs: LoopSegment[]): Loop {
  const points: Vec2[] = []
  let area = 0
  for (const s of segs) {
    const e = entities.get(s.id) as LineEntity | ArcEntity
    const pts = samplePolyline(e, s.reversed)
    for (let i = 0; i < pts.length - 1; i++) points.push(pts[i])
    area += segmentArea(e, s.reversed)
  }
  return { segments: segs, points, area }
}

function circleLoop(c: CircleEntity): Loop {
  const n = 96
  const points: Vec2[] = []
  for (let i = 0; i < n; i++) {
    const a = (TWO_PI * i) / n
    points.push([c.center[0] + c.radius * Math.cos(a), c.center[1] + c.radius * Math.sin(a)])
  }
  return { segments: [{ id: c.id, reversed: false }], points, area: Math.PI * c.radius * c.radius }
}

function fullArcLoop(a: ArcEntity): Loop {
  const pts = sampleArc(a, a.startAngle, TWO_PI)
  pts.pop()
  return { segments: [{ id: a.id, reversed: false }], points: pts, area: Math.PI * a.radius * a.radius }
}

const TEXT_SEGMENT = /^(.+~\d+)\.\d+$/

/** Points along a Bezier curve (de Casteljau), start included, end excluded. */
function sampleBezier(pts: Vec2[], n: number): Vec2[] {
  const out: Vec2[] = []
  for (let i = 0; i < n; i++) {
    const t = i / n
    let cur = pts
    while (cur.length > 1) {
      const next: Vec2[] = []
      for (let j = 0; j + 1 < cur.length; j++) {
        next.push([cur[j][0] + (cur[j + 1][0] - cur[j][0]) * t, cur[j][1] + (cur[j + 1][1] - cur[j][1]) * t])
      }
      cur = next
    }
    out.push(cur[0])
  }
  return out
}

function shoelace(points: Vec2[]): number {
  let a2 = 0
  for (let i = 0; i < points.length; i++) {
    const p = points[i]
    const q = points[(i + 1) % points.length]
    a2 += p[0] * q[1] - q[0] * p[1]
  }
  return a2 / 2
}

/**
 * A glyph contour is already a closed, counter-clockwise loop in walking order (see sketch/text/outline.ts),
 * so text segments become loops directly and never enter the line graph. Containment uses the polyline.
 */
function textLoops(segments: TextSegmentEntity[]): Loop[] {
  const groups = new Map<string, TextSegmentEntity[]>()
  for (const s of segments) {
    const key = TEXT_SEGMENT.exec(s.id)?.[1] ?? s.id
    const list = groups.get(key)
    if (list) list.push(s)
    else groups.set(key, [s])
  }
  const loops: Loop[] = []
  for (const list of groups.values()) {
    const points = list.flatMap((s) => s.curve?.poly ?? [s.a])
    // The area follows the true curves (a fine sampling), not the coarser display polyline.
    const area = shoelace(list.flatMap((s) => (s.curve && s.curve.kind !== 'line' ? sampleBezier(s.curve.pts, 64) : [s.a])))
    if (points.length >= 3 && area > 1e-9) {
      loops.push({ segments: list.map((s) => ({ id: s.id, reversed: false })), points, area })
    }
  }
  return loops
}

/** Closed loops of the sketch's real (non-construction) geometry, counter-clockwise. */
export function findLoops(sketch: Sketch): Loop[] {
  const entities = new Map<string, SketchEntity>()
  const textSegments: TextSegmentEntity[] = []
  for (const e of sketch.entities) {
    if (e.construction || e.type === 'text') continue // text is expanded to segments first
    if (e.type === 'line' && e.id.includes('~')) textSegments.push(e)
    else entities.set(e.id, e)
  }

  const loops: Loop[] = textLoops(textSegments)
  const nodes: Vec2[] = []
  const nodeOf = (p: Vec2): number => {
    for (let i = 0; i < nodes.length; i++) {
      if (sameLength(nodes[i][0], p[0]) && sameLength(nodes[i][1], p[1])) return i
    }
    nodes.push([p[0], p[1]])
    return nodes.length - 1
  }

  const edges: GraphEdge[] = []
  for (const e of entities.values()) {
    if (e.type === 'circle') {
      if (e.radius > NODE_TOL) loops.push(circleLoop(e))
    } else if (e.type === 'arc') {
      if (e.radius <= NODE_TOL) continue
      if (isFullArc(e)) {
        loops.push(fullArcLoop(e))
        continue
      }
      edges.push({ entity: e, from: nodeOf(arcPoint(e, e.startAngle)), to: nodeOf(arcPoint(e, e.endAngle)) })
    } else if (e.type === 'line') {
      const from = nodeOf(e.a)
      const to = nodeOf(e.b)
      if (from !== to) edges.push({ entity: e, from, to })
    }
  }

  // Prune dangling edges until every remaining node has at least two edges.
  const alive = edges.map(() => true)
  for (let changed = true; changed; ) {
    changed = false
    const degree = new Array<number>(nodes.length).fill(0)
    edges.forEach((ed, i) => {
      if (!alive[i]) return
      degree[ed.from]++
      degree[ed.to]++
    })
    edges.forEach((ed, i) => {
      if (alive[i] && (degree[ed.from] < 2 || degree[ed.to] < 2)) {
        alive[i] = false
        changed = true
      }
    })
  }

  // Half-edges, grouped by the node they leave, sorted counter-clockwise by direction.
  const half: HalfEdge[] = []
  edges.forEach((ed, i) => {
    if (!alive[i]) return
    half.push({ edge: i, reversed: false, from: ed.from, to: ed.to, angle: entityTangentAngle(ed.entity, false) })
    half.push({ edge: i, reversed: true, from: ed.to, to: ed.from, angle: entityTangentAngle(ed.entity, true) })
  })
  const outgoing: HalfEdge[][] = nodes.map(() => [])
  for (const h of half) outgoing[h.from].push(h)
  for (const list of outgoing) list.sort((p, q) => p.angle - q.angle)

  const twin = (h: HalfEdge): HalfEdge => outgoing[h.to].find((t) => t.edge === h.edge && t.reversed !== h.reversed)!
  const nextOf = (h: HalfEdge): HalfEdge => {
    const t = twin(h)
    const list = outgoing[h.to]
    const idx = list.indexOf(t)
    // Rotate clockwise from the way we came: the previous entry in counter-clockwise order.
    return list[(idx - 1 + list.length) % list.length]
  }

  const used = new Set<HalfEdge>()
  for (const start of half) {
    if (used.has(start)) continue
    const walk: HalfEdge[] = []
    let h = start
    let guard = half.length + 1
    while (!used.has(h) && guard-- > 0) {
      used.add(h)
      walk.push(h)
      h = nextOf(h)
      if (h === start) break
    }
    if (h !== start || walk.length < 2) continue
    // A face walk that uses an entity twice is a bridge or dangling piece, not a simple loop.
    const ids = walk.map((w) => edges[w.edge].entity.id)
    if (new Set(ids).size !== ids.length) continue
    const segs: LoopSegment[] = walk.map((w) => ({ id: edges[w.edge].entity.id, reversed: w.reversed }))
    const loop = makeLoop(entities, segs)
    if (loop.area > 1e-9) loops.push(loop) // negative area = the unbounded outside of a cluster
  }
  return loops
}

/** '<textId>~<c>' when every id is a segment of the same text contour ('<textId>~<c>.<k>'), else null. */
function glyphName(ids: string[]): string | null {
  let key: string | null = null
  for (const id of ids) {
    const m = /^(.+~\d+)\.\d+$/.exec(id)
    if (!m || (key !== null && m[1] !== key)) return null
    key = m[1]
  }
  return key
}

/** Closed regions of a sketch: each outer loop with its direct holes. */
export function findRegions(sketchId: string, sketch: Sketch): Region[] {
  const loops = findLoops(sketch)
  const containers = loops.map((l, i) => {
    const inside: number[] = []
    loops.forEach((o, j) => {
      if (i !== j && loopInside(l, o)) inside.push(j)
    })
    return inside
  })
  const depth = containers.map((c) => c.length)
  const regions: Region[] = []
  loops.forEach((loop, i) => {
    if (depth[i] % 2 !== 0) return
    const holes: Loop[] = []
    loops.forEach((cand, j) => {
      if (depth[j] !== depth[i] + 1) return
      // Direct parent = the smallest container, i.e. the one of depth[j] - 1 (that is `i` when it contains j).
      if (containers[j].includes(i)) holes.push(cand)
    })
    const ids = loop.segments.map((s) => s.id).sort()
    regions.push({
      name: `${sketchId}/region:${glyphName(ids) ?? ids.join(',')}`,
      outer: loop,
      holes,
      area: loop.area - holes.reduce((s, h) => s + h.area, 0),
    })
  })
  regions.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  return regions
}

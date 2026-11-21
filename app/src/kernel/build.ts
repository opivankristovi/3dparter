// OpenCascade side of an extrude: sketch regions to faces, faces to prisms, and the topological names.
//
// Naming comes from OCCT's own prism history (BRepPrimAPI_MakePrism Generated / FirstShape / LastShape).
// Only the link "profile edge -> sketch entity id" is geometric: the edge midpoint is matched against
// the sketch entities, which is exact here because every profile edge is built from one entity.
import {
  addHolesInFace,
  assembleWire,
  cast,
  getOC,
  makeCircle,
  makeBezierCurve,
  makeCompound,
  makeFace,
  makeLine,
  makeThreePointArc,
  type AnyShape,
  type Deletable,
  type Edge,
  type Face,
} from 'replicad'
import type { PlaneFrame, SketchEntity, Vec2, Vec3 } from '../doc/types'
import type { TextSegmentEntity } from '../sketch/text/outline'
import type { Loop, Region } from './regions'

export interface BuiltBody {
  shape: AnyShape
  /** hashCode of each face -> its topological name */
  faceNames: Map<number, string>
  /** hashCode of each edge -> its topological name */
  edgeNames: Map<number, string>
}

/** Collects temporary OpenCascade objects so they can all be freed, success or not. */
export class Scope {
  private items: Deletable[] = []
  track<T extends Deletable>(item: T): T {
    this.items.push(item)
    return item
  }
  free(): void {
    for (const it of this.items.reverse()) safeDelete(it)
    this.items = []
  }
}

export function safeDelete(o: Deletable | null | undefined): void {
  if (!o) return
  try {
    o.delete()
  } catch {
    // already freed
  }
}

const TWO_PI = Math.PI * 2

function toWorld(frame: PlaneFrame, shift: number, p: Vec2): Vec3 {
  const { origin: o, xDir: x, yDir: y, normal: n } = frame
  return [
    o[0] + p[0] * x[0] + p[1] * y[0] + shift * n[0],
    o[1] + p[0] * x[1] + p[1] * y[1] + shift * n[1],
    o[2] + p[0] * x[2] + p[1] * y[2] + shift * n[2],
  ]
}

export function loopEdges(
  loop: Loop,
  entities: Map<string, SketchEntity>,
  frame: PlaneFrame,
  shift: number,
  scope: Scope,
): Edge[] {
  const P = (p: Vec2) => toWorld(frame, shift, p)
  const edges: Edge[] = []
  for (const seg of loop.segments) {
    const e = entities.get(seg.id)
    if (!e || e.type === 'text') throw new Error('A sketch line this shape used is gone.')
    if (e.type === 'line') {
      // A glyph segment that is a curve carries its control points: one true Bezier edge, not facets.
      const curve = (e as TextSegmentEntity).curve
      if (curve && curve.kind !== 'line') {
        const pts = seg.reversed ? [...curve.pts].reverse() : curve.pts
        edges.push(scope.track(makeBezierCurve(pts.map(P))))
      } else {
        edges.push(scope.track(seg.reversed ? makeLine(P(e.b), P(e.a)) : makeLine(P(e.a), P(e.b))))
      }
    } else if (e.type === 'circle') {
      edges.push(scope.track(makeCircle(e.radius, P(e.center), frame.normal)))
    } else {
      let sweep = (e.endAngle - e.startAngle) % TWO_PI
      if (sweep < 0) sweep += TWO_PI
      const at = (a: number): Vec2 => [e.center[0] + e.radius * Math.cos(a), e.center[1] + e.radius * Math.sin(a)]
      if (sweep < 1e-9 || TWO_PI - sweep < 1e-9) {
        edges.push(scope.track(makeCircle(e.radius, P(e.center), frame.normal)))
      } else {
        const s = at(e.startAngle)
        const m = at(e.startAngle + sweep / 2)
        const t = at(e.endAngle)
        edges.push(scope.track(seg.reversed ? makeThreePointArc(P(t), P(m), P(s)) : makeThreePointArc(P(s), P(m), P(t))))
      }
    }
  }
  return edges
}

/** A planar face (with holes) for a region, lying in the sketch plane shifted along its normal. */
export function buildRegionFace(
  region: Region,
  entities: Map<string, SketchEntity>,
  frame: PlaneFrame,
  shift: number,
  scope: Scope,
): Face {
  const outerWire = scope.track(assembleWire(loopEdges(region.outer, entities, frame, shift, scope)))
  const outerFace = makeFace(outerWire)
  if (region.holes.length === 0) return outerFace
  scope.track(outerFace)
  const holeWires = region.holes.map((h) => scope.track(assembleWire(loopEdges(h, entities, frame, shift, scope))))
  return addHolesInFace(outerFace, holeWires)
}

// ---- entity matching ---------------------------------------------------------------------------

function bezierAt(pts: Vec2[], t: number): Vec2 {
  let cur = pts
  while (cur.length > 1) {
    const next: Vec2[] = []
    for (let i = 0; i + 1 < cur.length; i++) {
      next.push([cur[i][0] + (cur[i + 1][0] - cur[i][0]) * t, cur[i][1] + (cur[i + 1][1] - cur[i][1]) * t])
    }
    cur = next
  }
  return cur[0]
}

/** Distance from a point to a Bezier curve: coarse samples, then a ternary search around the best one. */
function distToBezier(p: Vec2, pts: Vec2[]): number {
  const d = (t: number) => {
    const q = bezierAt(pts, t)
    return Math.hypot(p[0] - q[0], p[1] - q[1])
  }
  const N = 48
  let bi = 0
  let bd = Infinity
  for (let i = 0; i <= N; i++) {
    const v = d(i / N)
    if (v < bd) {
      bd = v
      bi = i
    }
  }
  let lo = Math.max(0, (bi - 1) / N)
  let hi = Math.min(1, (bi + 1) / N)
  for (let i = 0; i < 50; i++) {
    const m1 = lo + (hi - lo) / 3
    const m2 = hi - (hi - lo) / 3
    if (d(m1) < d(m2)) hi = m2
    else lo = m1
  }
  return Math.min(bd, d((lo + hi) / 2))
}

function distToEntity(p: Vec2, e: SketchEntity): number {
  if (e.type === 'text') return Infinity
  if (e.type === 'line') {
    const curve = (e as TextSegmentEntity).curve
    if (curve && curve.kind !== 'line') return distToBezier(p, curve.pts)
    const dx = e.b[0] - e.a[0]
    const dy = e.b[1] - e.a[1]
    const l2 = dx * dx + dy * dy
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - e.a[0]) * dx + (p[1] - e.a[1]) * dy) / l2))
    return Math.hypot(p[0] - (e.a[0] + t * dx), p[1] - (e.a[1] + t * dy))
  }
  const dc = Math.hypot(p[0] - e.center[0], p[1] - e.center[1])
  if (e.type === 'circle') return Math.abs(dc - e.radius)
  let sweep = (e.endAngle - e.startAngle) % TWO_PI
  if (sweep < 0) sweep += TWO_PI
  let rel = (Math.atan2(p[1] - e.center[1], p[0] - e.center[0]) - e.startAngle) % TWO_PI
  if (rel < 0) rel += TWO_PI
  if (rel <= sweep || sweep < 1e-9) return Math.abs(dc - e.radius)
  const a = [e.center[0] + e.radius * Math.cos(e.startAngle), e.center[1] + e.radius * Math.sin(e.startAngle)]
  const b = [e.center[0] + e.radius * Math.cos(e.endAngle), e.center[1] + e.radius * Math.sin(e.endAngle)]
  return Math.min(Math.hypot(p[0] - a[0], p[1] - a[1]), Math.hypot(p[0] - b[0], p[1] - b[1]))
}

export function matchEntity(
  edge: Edge,
  ids: string[],
  entities: Map<string, SketchEntity>,
  frame: PlaneFrame,
  shift: number,
): string | null {
  const m = edge.pointAt(0.5)
  const [mx, my, mz] = m.toTuple()
  m.delete()
  const { origin: o, xDir: x, yDir: y, normal: n } = frame
  const d: Vec3 = [mx - o[0] - shift * n[0], my - o[1] - shift * n[1], mz - o[2] - shift * n[2]]
  const local: Vec2 = [d[0] * x[0] + d[1] * x[1] + d[2] * x[2], d[0] * y[0] + d[1] * y[1] + d[2] * y[2]]
  let best: string | null = null
  let bestD = 1e-5
  for (const id of ids) {
    const e = entities.get(id)
    if (!e) continue
    const dist = distToEntity(local, e)
    if (dist < bestD) {
      bestD = dist
      best = id
    }
  }
  return best
}

// ---- extrude -----------------------------------------------------------------------------------

export interface ExtrudeInput {
  extrudeId: string
  regions: Region[]
  entities: Map<string, SketchEntity>
  frame: PlaneFrame
  distance: number
  /** 1 along the plane normal, -1 against it, 0 symmetric */
  direction: 1 | -1 | 0
  /** Shift along `frame.normal` before extruding (mm). */
  startOffset?: number
}

export function groupByName<T extends { name: string }>(items: T[]): T[][] {
  const m = new Map<string, T[]>()
  for (const it of items) {
    const list = m.get(it.name)
    if (list) list.push(it)
    else m.set(it.name, [it])
  }
  return [...m.values()]
}

function tuple(v: { toTuple(): [number, number, number]; delete(): void }): Vec3 {
  const t = v.toTuple()
  v.delete()
  return t
}

function cmpVec(a: Vec3, b: Vec3): number {
  const eps = 1e-6
  for (let i = 0; i < 3; i++) {
    if (Math.abs(a[i] - b[i]) > eps) return a[i] - b[i]
  }
  return 0
}

/**
 * Final names for a shape: faces get the name given for their hash (else '<prefix>/face:<i>'), faces that end
 * up with the same name get '#1', '#2' ... in a stable geometric order, and each edge is named after its two
 * adjacent face names (sorted), with the same '#n' rule. Shared by extrude and by naming.ts.
 */
export function assignNames(
  shape: AnyShape,
  nameOfHash: Map<number, string>,
  fallbackPrefix: string,
): { faceNames: Map<number, string>; edgeNames: Map<number, string> } {
  const faces = shape.faces
  const faceEntries = faces.map((f, i) => ({
    hash: f.hashCode,
    name: nameOfHash.get(f.hashCode) ?? `${fallbackPrefix}/face:${i}`,
    center: tuple(f.center),
  }))
  const faceNames = new Map<number, string>()
  for (const group of groupByName(faceEntries)) {
    if (group.length > 1) group.sort((a, b) => cmpVec(a.center, b.center))
    group.forEach((g, i) => {
      const nm = group.length > 1 ? `${g.name}#${i + 1}` : g.name
      faceNames.set(g.hash, nm)
    })
  }

  // edge names: the two adjacent face names, sorted
  const edgeInfo = new Map<number, { mid: Vec3; faces: string[] }>()
  for (const f of faces) {
    const fname = faceNames.get(f.hashCode)!
    for (const e of f.edges) {
      const h = e.hashCode
      const info = edgeInfo.get(h)
      if (info) info.faces.push(fname)
      else edgeInfo.set(h, { mid: tuple(e.pointAt(0.5)), faces: [fname] })
      e.delete()
    }
  }
  const edgeEntries = [...edgeInfo.entries()].map(([hash, info]) => {
    const pair = info.faces.length === 1 ? [info.faces[0], info.faces[0]] : info.faces.slice(0, 2)
    return { hash, mid: info.mid, name: [...pair].sort().join('|') }
  })
  const edgeNames = new Map<number, string>()
  for (const group of groupByName(edgeEntries)) {
    if (group.length > 1) group.sort((a, b) => cmpVec(a.mid, b.mid))
    group.forEach((g, i) => edgeNames.set(g.hash, group.length > 1 ? `${g.name}#${i + 1}` : g.name))
  }
  for (const f of faces) f.delete()
  return { faceNames, edgeNames }
}

export function buildExtrusion(input: ExtrudeInput): BuiltBody {
  const oc = getOC()
  const { extrudeId, regions, entities, frame, distance, direction, startOffset = 0 } = input
  const scope = new Scope()
  const solids: AnyShape[] = []
  let result: AnyShape | null = null
  try {
    const shift = startOffset + (direction === 0 ? -distance / 2 : 0)
    const sign = direction === -1 ? -1 : 1
    const n = frame.normal
    const vec = scope.track(new oc.gp_Vec(n[0] * distance * sign, n[1] * distance * sign, n[2] * distance * sign))

    const faceHashToName: { hash: number; name: string }[] = []

    for (const region of regions) {
      const face = scope.track(buildRegionFace(region, entities, frame, shift, scope))
      const prism = scope.track(new oc.BRepPrimAPI_MakePrism(face.wrapped, vec, false, true))
      if (!prism.IsDone()) throw new Error('OpenCascade could not extrude this shape.')
      solids.push(cast(prism.Shape()))

      const startCap = cast(prism.FirstShape())
      const endCap = cast(prism.LastShape())
      faceHashToName.push({ hash: startCap.hashCode, name: `${extrudeId}/cap:start` })
      faceHashToName.push({ hash: endCap.hashCode, name: `${extrudeId}/cap:end` })
      startCap.delete()
      endCap.delete()

      const loopIds = [region.outer, ...region.holes].flatMap((l) => l.segments.map((s) => s.id))
      for (const edge of face.edges) {
        const entityId = matchEntity(edge, loopIds, entities, frame, shift)
        if (entityId !== null) {
          const generated = scope.track(new oc.NCollection_List_TopoDS_Shape(prism.Generated(edge.wrapped)))
          while (!generated.IsEmpty()) {
            const f = cast(generated.First())
            faceHashToName.push({ hash: f.hashCode, name: `${extrudeId}/side/${entityId}` })
            f.delete()
            generated.RemoveFirst()
          }
        }
        edge.delete()
      }
    }

    result = solids.length === 1 ? solids[0] : makeCompound(solids)
    const shape = result

    const nameOfHash = new Map<number, string>()
    for (const { hash, name } of faceHashToName) nameOfHash.set(hash, name)
    const { faceNames, edgeNames } = assignNames(shape, nameOfHash, extrudeId)

    // The compound holds its own reference to the solids, so the wrappers can go.
    if (solids.length > 1) for (const s of solids) safeDelete(s)
    return { shape, faceNames, edgeNames }
  } catch (err) {
    safeDelete(result)
    for (const s of solids) safeDelete(s)
    throw err
  } finally {
    scope.free()
  }
}

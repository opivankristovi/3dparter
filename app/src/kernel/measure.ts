// Kernel-side geometry measurement (S09 / F09): edge length, radius/diameter, face area, solid volume,
// vertex coordinates, and minimum distance + angle between any two picked shapes.
import {
  getOC,
  isShape3D,
  makeVertex,
  measureShapeLinearProperties,
  measureShapeSurfaceProperties,
  measureShapeVolumeProperties,
  type AnyShape,
  type Edge,
  type Face,
  type Vertex,
} from 'replicad'
import type { Ref, Vec3 } from '../doc/types'
import { extractVerticesFromEdges } from '../viewport/hints'
import type { MeasureResult, MeasureValue } from './api'
import { Scope } from './build'
import { QUALITY } from './mesh'
import { pickSubShapes, resolveSubRef } from './naming'
import type { BodyRecord } from './regenerate'

interface ResolvedMeasure {
  kind: 'body' | 'face' | 'edge' | 'vertex'
  shape: AnyShape
  items: MeasureValue[]
  dir?: Vec3
  length?: number
  area?: number
  volume?: number
}

const unitVec = (v: Vec3): Vec3 | undefined => {
  const len = Math.hypot(v[0], v[1], v[2])
  return len > 1e-9 ? [v[0] / len, v[1] / len, v[2] / len] : undefined
}

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

function resolveVertexPoint(ref: Ref, bodies: Map<string, BodyRecord>, scope: Scope): Vec3 | null {
  const [bodyName] = ref.name.split('/vertex:')
  const body = bodies.get(bodyName)
  if (!body) return null
  const edgeMesh = body.built.shape.meshEdges(QUALITY.preview)
  const edges = edgeMesh.edgeGroups.map((g) => ({
    name: body.built.edgeNames.get(g.edgeId) ?? `${body.name}/edge:${g.edgeId}`,
    points: edgeMesh.lines.slice(g.start * 3, (g.start + g.count) * 3),
  }))
  const list = extractVerticesFromEdges(body.name, edges)
  const exact = list.find((v) => v.name === ref.name)
  if (exact) return exact.point

  // Fallback to exact topological vertices by centroid hint if edge tessellation differs.
  const rawVertices = (body.built.shape as { vertices?: Vertex[] }).vertices
  if (ref.hint && Array.isArray(rawVertices)) {
    let best: Vec3 | null = null
    let bestDist = 0.5
    for (const v of rawVertices) {
      scope.track(v)
      const pt = v.asTuple()
      const d = Math.hypot(pt[0] - ref.hint.centroid[0], pt[1] - ref.hint.centroid[1], pt[2] - ref.hint.centroid[2])
      if (d < bestDist) {
        bestDist = d
        best = pt
      }
    }
    if (best) return best
  }
  return ref.hint ? [...ref.hint.centroid] : null
}

function resolveOne(ref: Ref, bodies: Map<string, BodyRecord>, scope: Scope): ResolvedMeasure | null {
  const oc = getOC()
  if (ref.kind === 'body') {
    const b = bodies.get(ref.name)
    if (!b || !isShape3D(b.built.shape)) return null
    const shape = b.built.shape
    const volume = scope.track(measureShapeVolumeProperties(shape)).volume
    const area = scope.track(measureShapeSurfaceProperties(shape)).area
    return {
      kind: 'body',
      shape,
      volume,
      area,
      items: [
        { label: 'Volume', kind: 'volume', value: volume },
        { label: 'Surface area', kind: 'area', value: area },
      ],
    }
  }

  if (ref.kind === 'face') {
    const r = resolveSubRef(ref, bodies.values())
    if (!r) return null
    const [face] = pickSubShapes(r.body, 'face', [r.hash], scope) as Face[]
    if (!face) return null
    const area = scope.track(measureShapeSurfaceProperties(face)).area
    const items: MeasureValue[] = [{ label: 'Area', kind: 'area', value: area }]
    let dir: Vec3 | undefined
    const type = face.geomType
    if (type === 'PLANE') {
      const n = scope.track(face.normalAt())
      dir = unitVec(n.toTuple())
    } else if (type === 'CYLINDRE') {
      const adaptor = scope.track(new oc.BRepAdaptor_Surface(face.wrapped, false))
      const cyl = scope.track(adaptor.Cylinder())
      const radius = cyl.Radius()
      items.push({ label: 'Radius', kind: 'length', value: radius }, { label: 'Diameter', kind: 'length', value: radius * 2 })
    } else if (type === 'SPHERE') {
      const adaptor = scope.track(new oc.BRepAdaptor_Surface(face.wrapped, false))
      const sph = scope.track(adaptor.Sphere())
      const radius = sph.Radius()
      items.push({ label: 'Radius', kind: 'length', value: radius }, { label: 'Diameter', kind: 'length', value: radius * 2 })
    }
    return { kind: 'face', shape: face, items, dir, area }
  }

  if (ref.kind === 'edge') {
    const r = resolveSubRef(ref, bodies.values())
    if (!r) return null
    const [edge] = pickSubShapes(r.body, 'edge', [r.hash], scope) as Edge[]
    if (!edge) return null
    const length = scope.track(measureShapeLinearProperties(edge)).length
    const items: MeasureValue[] = [{ label: 'Length', kind: 'length', value: length }]
    let dir: Vec3 | undefined
    const type = edge.geomType
    if (type === 'CIRCLE') {
      const adaptor = scope.track(new oc.BRepAdaptor_Curve(edge.wrapped))
      const circ = scope.track(adaptor.Circle())
      const radius = circ.Radius()
      items.push({ label: 'Radius', kind: 'length', value: radius }, { label: 'Diameter', kind: 'length', value: radius * 2 })
    } else if (type === 'LINE') {
      const adaptor = scope.track(new oc.BRepAdaptor_Curve(edge.wrapped))
      const p0 = scope.track(adaptor.Value(adaptor.FirstParameter()))
      const p1 = scope.track(adaptor.Value(adaptor.LastParameter()))
      dir = unitVec([p1.X() - p0.X(), p1.Y() - p0.Y(), p1.Z() - p0.Z()])
    }
    return { kind: 'edge', shape: edge, items, dir, length }
  }

  if (ref.kind === 'vertex') {
    const pt = resolveVertexPoint(ref, bodies, scope)
    if (!pt) return null
    const shape = scope.track(makeVertex(pt))
    return {
      kind: 'vertex',
      shape,
      items: [{ label: 'Position', kind: 'point', point: pt }],
    }
  }

  return null
}

/** Measures 1 or 2 picked shapes (edge, face, body, or vertex). Never throws on missing shapes. */
export function measureRefs(refs: Ref[], bodies: Map<string, BodyRecord>): MeasureResult {
  if (refs.length === 0) return { items: [] }
  const oc = getOC()
  const scope = new Scope()
  try {
    const resolved = refs
      .slice(0, 2)
      .map((r) => resolveOne(r, bodies, scope))
      .filter((x): x is ResolvedMeasure => x !== null)

    if (resolved.length === 0) return { items: [] }
    if (resolved.length === 1) return { items: resolved[0].items }

    const [a, b] = resolved
    const items: MeasureValue[] = []
    let segment: [Vec3, Vec3] | undefined

    const ext = scope.track(new oc.BRepExtrema_DistShapeShape())
    ext.LoadS1(a.shape.wrapped)
    ext.LoadS2(b.shape.wrapped)
    ext.Perform()
    if (ext.IsDone() && ext.NbSolution() > 0) {
      const dist = ext.Value()
      const p1 = scope.track(ext.PointOnShape1(1))
      const p2 = scope.track(ext.PointOnShape2(1))
      segment = [
        [p1.X(), p1.Y(), p1.Z()],
        [p2.X(), p2.Y(), p2.Z()],
      ]
      items.push({ label: 'Distance', kind: 'length', value: dist })
    }

    if (a.dir && b.dir) {
      const cos = Math.min(1, Math.abs(dot(a.dir, b.dir)))
      const oneFaceOneEdge = (a.kind === 'face' && b.kind === 'edge') || (a.kind === 'edge' && b.kind === 'face')
      const angle = ((oneFaceOneEdge ? Math.asin(cos) : Math.acos(cos)) * 180) / Math.PI
      items.push({ label: 'Angle', kind: 'angle', value: angle })
    }

    if (a.kind === 'edge' && b.kind === 'edge' && a.length !== undefined && b.length !== undefined) {
      items.push({ label: 'Total length', kind: 'length', value: a.length + b.length })
    } else if (a.kind === 'face' && b.kind === 'face' && a.area !== undefined && b.area !== undefined) {
      items.push({ label: 'Total area', kind: 'area', value: a.area + b.area })
    } else if (a.kind === 'body' && b.kind === 'body' && a.volume !== undefined && b.volume !== undefined) {
      items.push({ label: 'Total volume', kind: 'volume', value: a.volume + b.volume })
    }

    return segment ? { items, segment } : { items }
  } finally {
    scope.free()
  }
}

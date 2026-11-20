// OpenCascade side of a revolve: sketch regions turned around an axis, named from the sweep history.
//
// Same naming idea as the extrude (build.ts): a face Generated from a profile edge is '<id>/side/<entityId>';
// FirstShape / LastShape are the end caps, named only when the turn is partial (a full turn has no caps).
import { cast, getOC, makeCompound, makeVertex, measureDistanceBetween, type AnyShape } from 'replicad'
import type { PlaneFrame, SketchEntity, Vec2, Vec3 } from '../doc/types'
import { assignNames, buildRegionFace, matchEntity, safeDelete, Scope, type BuiltBody } from './build'
import type { Region } from './regions'

const TWO_PI = Math.PI * 2

export interface RevolveInput {
  revolveId: string
  regions: Region[]
  entities: Map<string, SketchEntity>
  frame: PlaneFrame
  /** The axis in world space. */
  axisPoint: Vec3
  axisDir: Vec3
  /** Radians, 0 < angle <= 2 PI. */
  angle: number
}

/** The axis as a line in the sketch's own (u, v) coordinates: a point on it and a direction. */
export interface LocalAxis {
  p: Vec2
  d: Vec2
}

/** True when the region outlines have points clearly on both sides of the axis line. */
export function profilesCrossAxis(regions: Region[], axis: LocalAxis): boolean {
  const len = Math.hypot(axis.d[0], axis.d[1]) || 1
  let left = false
  let right = false
  for (const r of regions) {
    for (const pt of r.outer.points) {
      const s = (axis.d[0] * (pt[1] - axis.p[1]) - axis.d[1] * (pt[0] - axis.p[0])) / len
      if (s > 1e-6) left = true
      else if (s < -1e-6) right = true
    }
  }
  return left && right
}

export function buildRevolution(input: RevolveInput): BuiltBody {
  const oc = getOC()
  const { revolveId, regions, entities, frame, axisPoint, axisDir, angle } = input
  const full = angle >= TWO_PI - 1e-9
  const scope = new Scope()
  const solids: AnyShape[] = []
  let result: AnyShape | null = null
  try {
    const pnt = scope.track(new oc.gp_Pnt(axisPoint[0], axisPoint[1], axisPoint[2]))
    const dir = scope.track(new oc.gp_Dir(axisDir[0], axisDir[1], axisDir[2]))
    const ax = scope.track(new oc.gp_Ax1(pnt, dir))

    const faceHashToName: { hash: number; name: string }[] = []
    // Profile edges the sweep reports no face for (OpenCascade drops some planar faces of a full turn).
    const pending: { id: string; mid: Vec3 }[] = []
    for (const region of regions) {
      const face = scope.track(buildRegionFace(region, entities, frame, 0, scope))
      const revol = scope.track(new oc.BRepPrimAPI_MakeRevol(face.wrapped, ax, angle, false))
      if (!revol.IsDone()) throw new Error('OpenCascade could not revolve this shape.')
      solids.push(cast(revol.Shape()))

      if (!full) {
        const startCap = cast(revol.FirstShape())
        const endCap = cast(revol.LastShape())
        faceHashToName.push({ hash: startCap.hashCode, name: `${revolveId}/cap:start` })
        faceHashToName.push({ hash: endCap.hashCode, name: `${revolveId}/cap:end` })
        startCap.delete()
        endCap.delete()
      }

      const loopIds = [region.outer, ...region.holes].flatMap((l) => l.segments.map((s) => s.id))
      for (const edge of face.edges) {
        const entityId = matchEntity(edge, loopIds, entities, frame, 0)
        if (entityId !== null) {
          const generated = scope.track(new oc.NCollection_List_TopoDS_Shape(revol.Generated(edge.wrapped)))
          if (generated.IsEmpty()) {
            const m = edge.pointAt(0.5)
            pending.push({ id: entityId, mid: m.toTuple() })
            m.delete()
          }
          while (!generated.IsEmpty()) {
            const f = cast(generated.First())
            faceHashToName.push({ hash: f.hashCode, name: `${revolveId}/side/${entityId}` })
            f.delete()
            generated.RemoveFirst()
          }
        }
        edge.delete()
      }
    }

    result = solids.length === 1 ? solids[0] : makeCompound(solids)
    const shape = result

    const check = new oc.BRepCheck_Analyzer(shape.wrapped, true, false, false)
    const valid = check.IsValid()
    check.delete()
    if (!valid) throw new Error('The shape crosses the axis it turns around.')

    const nameOfHash = new Map<number, string>()
    for (const { hash, name } of faceHashToName) nameOfHash.set(hash, name)
    // The swept face of an edge contains the edge itself (at angle 0): find it among the faces still unnamed.
    if (pending.length > 0) {
      const faces = shape.faces
      try {
        for (const { id, mid } of pending) {
          const v = makeVertex(mid)
          try {
            for (const f of faces) {
              if (nameOfHash.has(f.hashCode)) continue
              if (measureDistanceBetween(v as never, f as never) < 1e-6) {
                nameOfHash.set(f.hashCode, `${revolveId}/side/${id}`)
                break
              }
            }
          } finally {
            v.delete()
          }
        }
      } finally {
        for (const f of faces) f.delete()
      }
    }
    const { faceNames, edgeNames } = assignNames(shape, nameOfHash, revolveId)

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

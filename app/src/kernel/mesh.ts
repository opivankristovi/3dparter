// Tessellation: bodies to MeshData, sketch regions to display data.
import type { Vec2, Vec3 } from '../doc/types'
import type { MeshData, SketchRegionData } from './api'
import { buildRegionFace, Scope } from './build'
import type { BodyRecord, SketchRecord } from './regenerate'

export type Quality = 'preview' | 'high'

export const QUALITY: Record<Quality, { tolerance: number; angularTolerance: number }> = {
  preview: { tolerance: 0.1, angularTolerance: 0.5 },
  high: { tolerance: 0.01, angularTolerance: 0.1 },
}

export function meshBody(body: BodyRecord, quality: Quality): MeshData {
  const shape = body.built.shape
  const opts = QUALITY[quality]
  const m = shape.mesh(opts)
  const e = shape.meshEdges(opts)

  const faces = m.faceGroups.map((g) => ({
    name: body.built.faceNames.get(g.faceId) ?? `${body.name}/face:${g.faceId}`,
    start: g.start,
    count: g.count,
  }))
  const lines = Float32Array.from(e.lines)
  const edges = e.edgeGroups.map((g) => ({
    name: body.built.edgeNames.get(g.edgeId) ?? `${body.name}/edge:${g.edgeId}`,
    points: lines.slice(g.start * 3, (g.start + g.count) * 3),
  }))

  return {
    bodyId: body.name,
    positions: Float32Array.from(m.vertices),
    normals: Float32Array.from(m.normals),
    indices: Uint32Array.from(m.triangles),
    faces,
    edges,
  }
}

function toWorld(sk: SketchRecord, p: Vec2): Vec3 {
  const { origin: o, xDir: x, yDir: y } = sk.frame
  return [
    o[0] + p[0] * x[0] + p[1] * y[0],
    o[1] + p[0] * x[1] + p[1] * y[1],
    o[2] + p[0] * x[2] + p[1] * y[2],
  ]
}

/** Closed polyline: the first point is repeated at the end. */
function closedWorldLoop(sk: SketchRecord, pts: Vec2[]): Float32Array {
  const out = new Float32Array((pts.length + 1) * 3)
  const all = [...pts, pts[0]]
  all.forEach((p, i) => out.set(toWorld(sk, p), i * 3))
  return out
}

export function sketchRegionData(sk: SketchRecord): SketchRegionData[] {
  return sk.regions.map((r) => {
    const scope = new Scope()
    const loops = [r.outer, ...r.holes].map((l) => closedWorldLoop(sk, l.points))
    try {
      const face = scope.track(buildRegionFace(r, sk.entities, sk.frame, 0, scope))
      const m = face.mesh({ tolerance: 0.05, angularTolerance: 0.2 })
      return {
        name: r.name,
        loops,
        fill: { positions: Float32Array.from(m.vertices), indices: Uint32Array.from(m.triangles) },
        area: r.area,
      }
    } catch {
      // The face could not be built: still report the outline so the region can be drawn.
      return {
        name: r.name,
        loops,
        fill: { positions: new Float32Array(0), indices: new Uint32Array(0) },
        area: r.area,
      }
    } finally {
      scope.free()
    }
  })
}

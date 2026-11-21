// OpenCascade operations for M5 features: loft, sweep, split by plane, mirror across plane,
// and STEP solid import (S10 / F08).
import { assembleWire, cast, getOC, isShape3D, makeCircle, makeLine, makeThreePointArc, type AnyShape, type Edge } from 'replicad'
import type { PlaneFrame, SketchEntity, Vec2, Vec3 } from '../doc/types'
import { localToWorld } from '../sketch/geometry'
import { Scope, assignNames, buildRegionFace, loopEdges, safeDelete, type BuiltBody } from './build'
import { combine, discard, isValid } from './modify'
import type { Region } from './regions'
import type { SketchRecord } from './regenerate'

const encoder = new TextEncoder()
const HALF_SPACE = 10_000
const TWO_PI = Math.PI * 2

function prefixEdgeName(name: string, prefix: string): string {
  return name
    .split('|')
    .map((p) => prefix + p)
    .join('|')
}

export interface ProfileSection {
  region: Region
  sketch: SketchRecord
}

/** Lofts a solid across 2 or more ordered closed profile sections. */
export function buildLoft(featureId: string, sections: ProfileSection[]): BuiltBody {
  if (sections.length < 2) throw new Error('Pick at least two closed shapes to loft between.')
  for (let i = 1; i < sections.length; i++) {
    const a = sections[i - 1].sketch.frame
    const b = sections[i].sketch.frame
    const dotN = Math.abs(a.normal[0] * b.normal[0] + a.normal[1] * b.normal[1] + a.normal[2] * b.normal[2])
    const sep = Math.abs(
      (b.origin[0] - a.origin[0]) * a.normal[0] +
        (b.origin[1] - a.origin[1]) * a.normal[1] +
        (b.origin[2] - a.origin[2]) * a.normal[2],
    )
    if (dotN > 1 - 1e-4 && sep < 1e-3) {
      throw new Error('Could not loft between shapes on the same plane. Place profiles on separate planes.')
    }
  }
  const oc = getOC()
  const scope = new Scope()
  let result: AnyShape | null = null
  try {
    const loft = scope.track(new oc.BRepOffsetAPI_ThruSections(true, true, 1e-6))
    for (const { region, sketch } of sections) {
      const wire = scope.track(assembleWire(loopEdges(region.outer, sketch.entities, sketch.frame, 0, scope)))
      loft.AddWire(wire.wrapped)
    }
    loft.Build()
    if (!loft.IsDone()) throw new Error('Could not loft between these shapes.')
    result = cast(loft.Shape())
    if (!isShape3D(result) || result.solids.length === 0 || !isValid(result)) {
      throw new Error('Could not loft between these shapes. Make sure they lie on separate planes.')
    }
    const nameOfHash = new Map<number, string>()
    try {
      const first = cast(loft.FirstShape())
      nameOfHash.set(first.hashCode, `${featureId}/cap:start`)
      first.delete()
    } catch {
      /* ignore optional cap history */
    }
    try {
      const last = cast(loft.LastShape())
      nameOfHash.set(last.hashCode, `${featureId}/cap:end`)
      last.delete()
    } catch {
      /* ignore optional cap history */
    }
    const names = assignNames(result, nameOfHash, featureId)
    const built: BuiltBody = { shape: result, ...names }
    result = null
    return built
  } catch (err) {
    safeDelete(result)
    if (err instanceof Error && /^[A-Z]/.test(err.message)) throw err
    throw new Error('Could not loft between these shapes.')
  } finally {
    scope.free()
  }
}

/** Converts a sketch entity (or existing edges) into an OCCT Edge for sweeping. */
export function edgeFromSketchEntity(entity: SketchEntity, frame: PlaneFrame): Edge {
  const P = (p: Vec2): Vec3 => localToWorld(p, frame)
  if (entity.type === 'line') return makeLine(P(entity.a), P(entity.b))
  if (entity.type === 'circle') return makeCircle(entity.radius, P(entity.center), frame.normal)
  let sweep = (entity.endAngle - entity.startAngle) % TWO_PI
  if (sweep < 0) sweep += TWO_PI
  const at = (a: number): Vec2 => [entity.center[0] + entity.radius * Math.cos(a), entity.center[1] + entity.radius * Math.sin(a)]
  if (sweep < 1e-9 || TWO_PI - sweep < 1e-9) return makeCircle(entity.radius, P(entity.center), frame.normal)
  return makeThreePointArc(P(at(entity.startAngle)), P(at(entity.startAngle + sweep / 2)), P(at(entity.endAngle)))
}

/** Sweeps a profile section along one or more connected path edges. */
export function buildSweep(featureId: string, profile: ProfileSection, pathEdges: Edge[]): BuiltBody {
  if (pathEdges.length === 0) throw new Error('Pick a line or curve path to sweep along.')
  const oc = getOC()
  const scope = new Scope()
  let result: AnyShape | null = null
  try {
    const spine = scope.track(assembleWire(pathEdges))
    const face = scope.track(buildRegionFace(profile.region, profile.sketch.entities, profile.sketch.frame, 0, scope))
    const pipe = scope.track(new oc.BRepOffsetAPI_MakePipe(spine.wrapped, face.wrapped))
    pipe.Build()
    if (!pipe.IsDone()) throw new Error('Could not sweep this profile along the path.')
    result = cast(pipe.Shape())
    if (!isShape3D(result) || result.solids.length === 0 || !isValid(result)) {
      throw new Error('Could not sweep this profile along the path.')
    }
    const nameOfHash = new Map<number, string>()
    try {
      const first = cast(pipe.FirstShape())
      nameOfHash.set(first.hashCode, `${featureId}/cap:start`)
      first.delete()
    } catch {
      /* ignore optional cap history */
    }
    try {
      const last = cast(pipe.LastShape())
      nameOfHash.set(last.hashCode, `${featureId}/cap:end`)
      last.delete()
    } catch {
      /* ignore optional cap history */
    }
    const names = assignNames(result, nameOfHash, featureId)
    const built: BuiltBody = { shape: result, ...names }
    result = null
    return built
  } catch (err) {
    safeDelete(result)
    if (err instanceof Error && /^[A-Z]/.test(err.message)) throw err
    throw new Error('Could not sweep this profile along the path.')
  } finally {
    scope.free()
  }
}

function halfSpaceBox(featureId: string, plane: PlaneFrame, sign: 1 | -1, scope: Scope): BuiltBody {
  const oc = getOC()
  const P = (u: number, v: number) => localToWorld([u, v], plane)
  const pts: Vec3[] = [
    P(-HALF_SPACE, -HALF_SPACE),
    P(HALF_SPACE, -HALF_SPACE),
    P(HALF_SPACE, HALF_SPACE),
    P(-HALF_SPACE, HALF_SPACE),
  ]
  const edges = [
    scope.track(makeLine(pts[0], pts[1])),
    scope.track(makeLine(pts[1], pts[2])),
    scope.track(makeLine(pts[2], pts[3])),
    scope.track(makeLine(pts[3], pts[0])),
  ]
  const wire = scope.track(assembleWire(edges))
  const faceMk = scope.track(new oc.BRepBuilderAPI_MakeFace(wire.wrapped, true))
  const face = cast(faceMk.Face())
  scope.track(face)
  const vec = scope.track(new oc.gp_Vec(plane.normal[0] * HALF_SPACE * sign, plane.normal[1] * HALF_SPACE * sign, plane.normal[2] * HALF_SPACE * sign))
  const prism = scope.track(new oc.BRepPrimAPI_MakePrism(face.wrapped, vec, false, true))
  const shape = cast(prism.Shape())
  const faceNames = new Map<number, string>()
  for (const f of shape.faces) {
    faceNames.set(f.hashCode, `${featureId}/cut`)
    f.delete()
  }
  return { shape, faceNames, edgeNames: new Map() }
}

/** Splits `body` into two halves along `plane`. Throws if the plane misses the solid. */
export function splitBody(featureId: string, body: BuiltBody, plane: PlaneFrame): { kept: BuiltBody; splitOff: BuiltBody } {
  const scope = new Scope()
  let neg: BuiltBody | null = null
  let pos: BuiltBody | null = null
  let kept: BuiltBody | null = null
  let splitOff: BuiltBody | null = null
  try {
    neg = halfSpaceBox(featureId, plane, -1, scope)
    pos = halfSpaceBox(`${featureId}:1`, plane, 1, scope)
    try {
      kept = combine(featureId, 'intersect', body, neg)
      splitOff = combine(`${featureId}:1`, 'intersect', body, pos, `${featureId}:1/`)
    } catch {
      throw new Error('The splitting plane does not pass through this solid.')
    }
    const done = { kept, splitOff }
    kept = null
    splitOff = null
    return done
  } finally {
    if (kept) discard(kept)
    if (splitOff) discard(splitOff)
    if (neg) discard(neg)
    if (pos) discard(pos)
    scope.free()
  }
}

/** Mirrors `body` across `plane`. When `merge` is true, unions the mirror back onto `body`. */
export function mirrorBody(featureId: string, body: BuiltBody, plane: PlaneFrame, merge: boolean, prefix: string): BuiltBody {
  const oc = getOC()
  const scope = new Scope()
  let result: AnyShape | null = null
  let mirrored: BuiltBody | null = null
  try {
    const tr = scope.track(new oc.gp_Trsf())
    const pnt = scope.track(new oc.gp_Pnt(plane.origin[0], plane.origin[1], plane.origin[2]))
    const norm = scope.track(new oc.gp_Dir(plane.normal[0], plane.normal[1], plane.normal[2]))
    const vx = scope.track(new oc.gp_Dir(plane.xDir[0], plane.xDir[1], plane.xDir[2]))
    const ax2 = scope.track(new oc.gp_Ax2(pnt, norm, vx))
    tr.SetMirror(ax2)

    const op = scope.track(new oc.BRepBuilderAPI_Transform(body.shape.wrapped, tr, true, false))
    result = cast(op.Shape())

    const faceNames = new Map<number, string>()
    for (const face of body.shape.faces) {
      const name = body.faceNames.get(face.hashCode)
      if (name !== undefined) {
        const moved = cast(op.ModifiedShape(face.wrapped))
        faceNames.set(moved.hashCode, prefix + name)
        moved.delete()
      }
      face.delete()
    }
    const edgeNames = new Map<number, string>()
    for (const edge of body.shape.edges) {
      const name = body.edgeNames.get(edge.hashCode)
      if (name !== undefined) {
        const moved = cast(op.ModifiedShape(edge.wrapped))
        edgeNames.set(moved.hashCode, prefix ? prefixEdgeName(name, prefix) : name)
        moved.delete()
      }
      edge.delete()
    }
    mirrored = { shape: result, faceNames, edgeNames }
    result = null

    if (!merge) {
      const out = mirrored
      mirrored = null
      return out
    }
    const joined = combine(featureId, 'union', body, mirrored, `${featureId}/mirror/`)
    discard(mirrored)
    mirrored = null
    return joined
  } catch (err) {
    safeDelete(result)
    if (mirrored) discard(mirrored)
    throw err
  } finally {
    scope.free()
  }
}

/** Imports solids from a STEP file string into an editable BuiltBody. */
export function importStepBody(featureId: string, content: string): BuiltBody {
  if (!content.trim()) throw new Error('The imported STEP file is empty.')
  const oc = getOC()
  const scope = new Scope()
  const fileName = `imp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}.step`
  let shape: AnyShape | null = null
  try {
    oc.FS.writeFile(`/${fileName}`, encoder.encode(content))
    const reader = scope.track(new oc.STEPControl_Reader())
    const status = reader.ReadFile(fileName)
    if (status !== oc.IFSelect_ReturnStatus.IFSelect_RetDone) {
      throw new Error('Could not read this STEP file.')
    }
    reader.TransferRoots()
    shape = cast(reader.OneShape())
    if (shape.solids.length === 0 && shape.faces.length === 0) {
      throw new Error('This STEP file does not contain any solids or faces.')
    }
    const { faceNames, edgeNames } = assignNames(shape, new Map(), featureId)
    const built: BuiltBody = { shape, faceNames, edgeNames }
    shape = null
    return built
  } finally {
    try {
      oc.FS.unlink(`/${fileName}`)
    } catch {
      /* ignore missing temp file */
    }
    safeDelete(shape)
    scope.free()
  }
}

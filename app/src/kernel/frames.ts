// Plane frames: the frame of a flat face (stable under edits), and tilting / offsetting a frame.
//
// A face frame has to come out the same for the same face geometry, whatever order OpenCascade lists things in,
// so it is derived from the face's plane only: normal = the face's outward normal, origin = the world origin
// projected onto the plane, xDir = world X projected onto the plane (world Y when X is nearly along the
// normal), yDir = normal x xDir.
import type { Face } from 'replicad'
import type { PlaneFrame, Vec3 } from '../doc/types'

const tidy = (v: number): number => {
  const r = Math.round(v * 1e9) / 1e9
  return r === 0 ? 0 : r // no -0
}
const tidyVec = (v: Vec3): Vec3 => [tidy(v[0]), tidy(v[1]), tidy(v[2])]
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s]
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const unit = (a: Vec3): Vec3 => scale(a, 1 / (Math.hypot(a[0], a[1], a[2]) || 1))

function tuple(v: { toTuple(): [number, number, number]; delete(): void }): Vec3 {
  const t = v.toTuple()
  v.delete()
  return t
}

/** The frame of a flat face, or null if the face is not planar. Does not free `face`. */
export function faceFrame(face: Face): PlaneFrame | null {
  if (face.geomType !== 'PLANE') return null
  const normal = unit(tuple(face.normalAt()))
  const centre = tuple(face.center)
  const origin = scale(normal, dot(centre, normal)) // world origin projected onto the plane
  let x: Vec3 = sub([1, 0, 0], scale(normal, normal[0]))
  if (Math.hypot(...x) < 0.1) x = sub([0, 1, 0], scale(normal, normal[1]))
  const xDir = unit(x)
  const yDir = unit(cross(normal, xDir))
  return {
    origin: tidyVec(origin),
    xDir: tidyVec(xDir),
    yDir: tidyVec(yDir),
    normal: tidyVec(normal),
  }
}

/** Local (u, v) in a frame to world space. */
export function localToWorld(frame: PlaneFrame, p: [number, number]): Vec3 {
  return add(frame.origin, add(scale(frame.xDir, p[0]), scale(frame.yDir, p[1])))
}

/** A world point to the frame's local (u, v) coordinates (the part along the normal is dropped). */
export function worldToLocal(frame: PlaneFrame, p: Vec3): [number, number] {
  const d = sub(p, frame.origin)
  return [dot(d, frame.xDir), dot(d, frame.yDir)]
}

/** A world direction to local (u, v) components. */
export function dirToLocal(frame: PlaneFrame, d: Vec3): [number, number] {
  return [dot(d, frame.xDir), dot(d, frame.yDir)]
}

export { dot as dotVec, sub as subVec }

/** Tilts a frame by `angleDeg` about its own xDir through its origin, then moves it `offset` along the new normal. */
export function tiltAndOffset(base: PlaneFrame, angleDeg: number, offset: number): PlaneFrame {
  const a = (angleDeg * Math.PI) / 180
  const c = Math.cos(a)
  const s = Math.sin(a)
  const yDir = add(scale(base.yDir, c), scale(base.normal, s))
  const normal = sub(scale(base.normal, c), scale(base.yDir, s))
  return {
    origin: tidyVec(add(base.origin, scale(normal, offset))),
    xDir: tidyVec(base.xDir),
    yDir: tidyVec(yDir),
    normal: tidyVec(normal),
  }
}

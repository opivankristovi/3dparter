// Topological naming, the part that keeps later steps attached to the right geometry.
//
//   carryNames   after an OpenCascade algorithm with history (fillet, chamfer, boolean) has changed a body, give
//                the result's faces and edges names built from the old ones.
//   resolveSubRef  find the face or edge a Ref points at: by exact name, else by the stored position hint.
//
// Naming rules (see doc/types.ts, Ref):
//   - a face Modified() from an old face keeps the old name; several faces from one old face get '#1', '#2' ...
//     in a stable geometric order (assignNames in build.ts);
//   - a face Generated() from an edge is '<featureId>/blend/<edge name>';
//   - a face the history says nothing about is '<featureId>/face:<i>' (last resort);
//   - edges are named from their two adjacent face names, recomputed from scratch every time.
import { cast, getOC, measureArea, type AnyShape, type Face } from 'replicad'
import type { NCollection_List_TopoDS_Shape, TopoDS_Shape } from 'replicad-opencascadejs'
import type { Ref, Vec3 } from '../doc/types'
import { assignNames, Scope, safeDelete, type BuiltBody } from './build'

/** The part of a body record that naming needs. */
export interface NamedBody {
  name: string
  built: BuiltBody
}

// ---- history helpers -----------------------------------------------------------------------------

/** What every algorithm we use (MakeFillet, MakeChamfer, BRepAlgoAPI_*) can tell about its changes. */
export interface ShapeHistory {
  Modified(s: TopoDS_Shape): NCollection_List_TopoDS_Shape
  Generated(s: TopoDS_Shape): NCollection_List_TopoDS_Shape
  IsDeleted(s: TopoDS_Shape): boolean
}

/** hashCodes of the shapes in an OpenCascade list. Frees the list. */
function hashesOf(raw: NCollection_List_TopoDS_Shape): number[] {
  const oc = getOC()
  const copy = new oc.NCollection_List_TopoDS_Shape(raw)
  const out: number[] = []
  try {
    while (!copy.IsEmpty()) {
      const sh = copy.First()
      const wrapped = cast(sh)
      out.push(wrapped.hashCode)
      wrapped.delete()
      safeDelete(sh)
      copy.RemoveFirst()
    }
  } finally {
    safeDelete(copy)
    safeDelete(raw)
  }
  return out
}

export interface CarryInput {
  featureId: string
  algo: ShapeHistory
  /** The bodies the algorithm read, in priority order (the first one wins a name conflict). */
  sources: BuiltBody[]
  /** The shape the algorithm produced (already reduced to a single solid where possible). */
  result: AnyShape
  /** Name faces made from an edge '<featureId>/blend/<edge name>' (fillet, chamfer). */
  blend?: boolean
  /**
   * Shell: a face Generated from an old face is its inner wall '<featureId>/inner/<old name>'; a removed face
   * that leaves a rim behind names the rim '<featureId>/rim/<old name>'.
   */
  shell?: boolean
  /** Prefix for the names carried over from each source (same order as `sources`); default none. */
  prefixes?: string[]
  /** Applied to every name carried over from a source (not for shell). Used to turn an opened face into a rim. */
  rename?: (name: string) => string
}

/** Faces and edges names of `result`, carried over from `sources` through the algorithm's history. */
export function carryNames(input: CarryInput): { faceNames: Map<number, string>; edgeNames: Map<number, string> } {
  const { featureId, algo, sources, result, blend, shell, prefixes, rename } = input
  const resultFaces = result.faces
  const inResult = new Set(resultFaces.map((f) => f.hashCode))
  for (const f of resultFaces) f.delete()

  const nameOfHash = new Map<number, string>()
  const give = (hash: number, name: string) => {
    if (inResult.has(hash) && !nameOfHash.has(hash)) nameOfHash.set(hash, name)
  }

  sources.forEach((src, si) => {
    const prefix = prefixes?.[si] ?? ''
    for (const face of src.shape.faces) {
      const base = src.faceNames.get(face.hashCode)
      const old = base === undefined ? undefined : rename ? rename(prefix + base) : prefix + base
      if (old !== undefined && shell) {
        const stays = inResult.has(face.hashCode)
        if (stays) give(face.hashCode, old)
        for (const h of hashesOf(algo.Modified(face.wrapped))) give(h, stays ? old : `${featureId}/rim/${old}`)
        for (const h of hashesOf(algo.Generated(face.wrapped))) give(h, `${featureId}/inner/${old}`)
      } else if (old !== undefined) {
        const modified = hashesOf(algo.Modified(face.wrapped))
        if (modified.length === 0) {
          // Left alone (the algorithm may hand back the very same face): keep the name unless it is gone.
          if (!algo.IsDeleted(face.wrapped)) give(face.hashCode, old)
        } else {
          for (const h of modified) give(h, old)
        }
      }
      face.delete()
    }
  })

  if (blend) {
    for (const src of sources) {
      for (const edge of src.shape.edges) {
        const ename = src.edgeNames.get(edge.hashCode)
        if (ename !== undefined) {
          for (const h of hashesOf(algo.Generated(edge.wrapped))) give(h, `${featureId}/blend/${ename}`)
        }
        edge.delete()
      }
    }
  }

  return assignNames(result, nameOfHash, featureId)
}

// ---- reference resolution -------------------------------------------------------------------------

export type SubKind = 'face' | 'edge'

export interface Resolved {
  body: NamedBody
  hash: number
  /** True when the name was gone and the hint found the geometry again. */
  byHint: boolean
}

export const HINT_WARNING = 'Something you picked was matched again by its position, because its name changed.'

const MIN_TOL = 0.5 // mm
const REL_TOL = 0.02 // of the body's bounding-box diagonal
const SIZE_TOL = 0.05 // 5 % on length and area
const NORMAL_COS = Math.cos((5 * Math.PI) / 180)

function tuple(v: { toTuple(): [number, number, number]; delete(): void }): Vec3 {
  const t = v.toTuple()
  v.delete()
  return t
}

function dist(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
}

function diagonal(shape: AnyShape): number {
  const bb = shape.boundingBox
  const [lo, hi] = bb.bounds
  bb.delete()
  return dist(lo as Vec3, hi as Vec3)
}

function nameMap(body: NamedBody, kind: SubKind): Map<number, string> {
  return kind === 'face' ? body.built.faceNames : body.built.edgeNames
}

/** The names of every face or edge of a body, for pickers and tests. */
export function namesOf(body: NamedBody, kind: SubKind): string[] {
  return [...nameMap(body, kind).values()]
}

/**
 * Finds the face or edge a Ref names among `bodies`: exact name first; else the nearest shape of the same kind
 * within max(0.5 mm, 2 % of the body's bounding-box diagonal) that also agrees with the hint (edge length within
 * 5 %; face area within 5 %, normal within about 5 degrees). Returns null if neither works.
 */
export function resolveSubRef(ref: Ref, bodies: Iterable<NamedBody>): Resolved | null {
  if (ref.kind !== 'face' && ref.kind !== 'edge') return null
  const kind: SubKind = ref.kind
  const list = [...bodies]

  for (const body of list) {
    for (const [hash, name] of nameMap(body, kind)) {
      if (name === ref.name) return { body, hash, byHint: false }
    }
  }

  const hint = ref.hint
  if (!hint) return null
  let best: Resolved | null = null
  let bestD = Infinity
  for (const body of list) {
    const tol = Math.max(MIN_TOL, REL_TOL * diagonal(body.built.shape))
    const subs: (AnyShape & { hashCode: number })[] = kind === 'face' ? body.built.shape.faces : body.built.shape.edges
    for (const s of subs) {
      try {
        let center: Vec3
        if (kind === 'face') center = tuple((s as Face).center)
        else center = tuple((s as unknown as { pointAt(p: number): { toTuple(): Vec3; delete(): void } }).pointAt(0.5))
        const d = dist(center, hint.centroid)
        if (d > tol || d >= bestD) continue
        if (kind === 'edge') {
          if (hint.length !== undefined) {
            const len = (s as unknown as { length: number }).length
            if (Math.abs(len - hint.length) > SIZE_TOL * hint.length) continue
          }
        } else {
          if (hint.area !== undefined) {
            const a = measureArea(s as Face)
            if (Math.abs(a - hint.area) > SIZE_TOL * hint.area) continue
          }
          if (hint.normal) {
            const n = tuple((s as Face).normalAt())
            const dot = n[0] * hint.normal[0] + n[1] * hint.normal[1] + n[2] * hint.normal[2]
            const mag = Math.hypot(...hint.normal) || 1
            if (dot / mag < NORMAL_COS) continue
          }
        }
        bestD = d
        best = { body, hash: s.hashCode, byHint: true }
      } finally {
        s.delete()
      }
    }
  }
  return best
}

/** Live wrappers for the faces or edges of `body` with the given hashes. Tracked in `scope`. */
export function pickSubShapes(body: NamedBody, kind: SubKind, hashes: number[], scope: Scope): AnyShape[] {
  const want = new Set(hashes)
  const subs: AnyShape[] = kind === 'face' ? body.built.shape.faces : body.built.shape.edges
  const out: AnyShape[] = []
  for (const s of subs) {
    if (want.has(s.hashCode)) out.push(scope.track(s))
    else s.delete()
  }
  return out
}

/** A body ref names a body (the id of the feature that made it). */
export function resolveBodyRef<T>(ref: Ref, bodies: Map<string, T>): T | undefined {
  if (ref.kind !== 'body') return undefined
  return bodies.get(ref.name)
}

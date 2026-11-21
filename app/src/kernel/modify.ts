// OpenCascade side of the body-changing features: fillet, chamfer, the three booleans, shell and transform.
// Each function reads body shapes, never changes them, and returns a NEW BuiltBody whose names were carried
// over from the inputs with OpenCascade's history (naming.ts). Failures throw an Error with a plain message.
import { cast, getOC, measureVolume, type AnyShape } from 'replicad'
import type { BooleanMode, Vec3 } from '../doc/types'
import { Scope, safeDelete, type BuiltBody } from './build'
import { carryNames, type ShapeHistory } from './naming'

export type BoolOp = Exclude<BooleanMode, 'new'>

/** If the shape is a compound holding exactly one solid, that solid; throws if no solid is left. */
function singleSolid(shape: AnyShape, emptyMessage: string): AnyShape {
  const solids = shape.solids
  if (solids.length === 0) {
    for (const s of solids) s.delete()
    safeDelete(shape)
    throw new Error(emptyMessage)
  }
  if (solids.length === 1) {
    safeDelete(shape)
    return solids[0]
  }
  for (const s of solids) s.delete()
  return shape
}

export function isValid(shape: AnyShape): boolean {
  const oc = getOC()
  const check = new oc.BRepCheck_Analyzer(shape.wrapped, true, false, false)
  try {
    return check.IsValid()
  } finally {
    check.delete()
  }
}

// ---- fillet and chamfer ---------------------------------------------------------------------------

type EdgeOpKind = 'fillet' | 'chamfer'

function edgeOp(
  kind: EdgeOpKind,
  featureId: string,
  body: BuiltBody,
  edges: AnyShape[],
  size: number,
  failMessage: string,
): BuiltBody {
  const oc = getOC()
  const scope = new Scope()
  let result: AnyShape | null = null
  try {
    let algo: ShapeHistory & { Build(): void; IsDone(): boolean; Shape(): never; delete(): void }
    try {
      if (kind === 'fillet') {
        const mk = scope.track(new oc.BRepFilletAPI_MakeFillet(body.shape.wrapped, oc.ChFi3d_FilletShape.ChFi3d_Rational))
        for (const e of edges) mk.Add(size, e.wrapped as never)
        algo = mk as never
      } else {
        const mk = scope.track(new oc.BRepFilletAPI_MakeChamfer(body.shape.wrapped))
        for (const e of edges) mk.Add(size, e.wrapped as never)
        algo = mk as never
      }
      algo.Build()
      if (!algo.IsDone()) throw new Error('not done')
      result = cast(algo.Shape())
    } catch {
      // OpenCascade reports a failed fillet as an exception or an unfinished build; both mean the same here.
      throw new Error(failMessage)
    }
    if (!isValid(result)) throw new Error(failMessage)
    const solid = singleSolid(result, failMessage)
    result = solid
    const names = carryNames({ featureId, algo, sources: [body], result: solid, blend: true })
    const done: BuiltBody = { shape: solid, ...names }
    result = null
    return done
  } catch (err) {
    safeDelete(result)
    throw err
  } finally {
    scope.free()
  }
}

export function filletBody(featureId: string, body: BuiltBody, edges: AnyShape[], radius: number): BuiltBody {
  return edgeOp('fillet', featureId, body, edges, radius, 'The radius is too large for this edge, or the edge cannot be rounded.')
}

export function chamferBody(featureId: string, body: BuiltBody, edges: AnyShape[], distance: number): BuiltBody {
  return edgeOp('chamfer', featureId, body, edges, distance, 'The distance is too large for this edge, or the edge cannot be bevelled.')
}

// ---- booleans -------------------------------------------------------------------------------------

const EMPTY: Record<BoolOp, string> = {
  union: 'OpenCascade could not join these solids.',
  subtract: 'Nothing would be left after this cut.',
  intersect: 'These solids do not overlap.',
}

/**
 * `a` op `b` as a new body. Neither input is changed; faces keep the names they had in `a` and `b`.
 * `toolPrefix` is put in front of the names that come from `b` (used when the tool body is kept, so that the
 * target's names stay unique across bodies).
 */
export function combine(featureId: string, op: BoolOp, a: BuiltBody, b: BuiltBody, toolPrefix = ''): BuiltBody {
  const oc = getOC()
  const scope = new Scope()
  let result: AnyShape | null = null
  try {
    const algo =
      op === 'union'
        ? scope.track(new oc.BRepAlgoAPI_Fuse())
        : op === 'subtract'
          ? scope.track(new oc.BRepAlgoAPI_Cut())
          : scope.track(new oc.BRepAlgoAPI_Common())
    const args = scope.track(new oc.NCollection_List_TopoDS_Shape())
    const tools = scope.track(new oc.NCollection_List_TopoDS_Shape())
    scope.track(args.Append(a.shape.wrapped))
    scope.track(tools.Append(b.shape.wrapped))
    algo.SetArguments(args)
    algo.SetTools(tools)
    algo.SetNonDestructive(true) // never touch the inputs: other features still use them
    algo.Build()
    if (!algo.IsDone() || algo.HasErrors()) throw new Error('OpenCascade could not combine these solids.')
    result = cast(algo.Shape())
    const solid = singleSolid(result, EMPTY[op])
    result = solid
    const names = carryNames({ featureId, algo, sources: [a, b], result: solid, prefixes: ['', toolPrefix] })
    const done: BuiltBody = { shape: solid, ...names }
    result = null
    return done
  } catch (err) {
    safeDelete(result)
    throw err
  } finally {
    scope.free()
  }
}

/** Frees the shape of a body that was only an intermediate result. */
export function discard(body: BuiltBody): void {
  safeDelete(body.shape)
}

// ---- shell ----------------------------------------------------------------------------------------

const SHELL_FAIL = 'The wall is too thick for this shape, or the shape cannot be hollowed.'

/**
 * With no face to open, OpenCascade hands back only the inward offset of the solid. A closed hollow solid is that
 * offset turned inside out and used as the void of the original. Frees `inner`; the faces of both stay shared.
 */
function hollow(outer: AnyShape, inner: AnyShape): AnyShape {
  const oc = getOC()
  const scope = new Scope()
  try {
    if (outer.solids.length !== 1) throw new Error(SHELL_FAIL)
    const firstShell = (shape: AnyShape) => {
      const ex = scope.track(new oc.TopExp_Explorer(shape.wrapped, oc.TopAbs_ShapeEnum.TopAbs_SHELL, oc.TopAbs_ShapeEnum.TopAbs_SHAPE))
      if (!ex.More()) throw new Error(SHELL_FAIL)
      return ex.Current()
    }
    const outerShell = oc.TopoDS.Shell(firstShell(outer))
    const innerShell = oc.TopoDS.Shell(scope.track(firstShell(inner).Reversed()))
    const mk = scope.track(new oc.BRepBuilderAPI_MakeSolid(outerShell, innerShell))
    return cast(mk.Solid())
  } finally {
    scope.free()
    safeDelete(inner)
  }
}

/** The direct OpenCascade shell. Throws when the algorithm fails or hands back a body that is not hollowed. */
function shellDirect(featureId: string, body: BuiltBody, removeFaces: AnyShape[], thickness: number): BuiltBody {
  const oc = getOC()
  const scope = new Scope()
  let result: AnyShape | null = null
  try {
    let mk: (ShapeHistory & { Shape(): never }) | null = null
    try {
      const closing = scope.track(new oc.NCollection_List_TopoDS_Shape())
      for (const f of removeFaces) closing.Append(f.wrapped)
      const algo = scope.track(new oc.BRepOffsetAPI_MakeThickSolid())
      algo.MakeThickSolidByJoin(
        body.shape.wrapped,
        closing,
        -thickness,
        1e-3,
        oc.BRepOffset_Mode.BRepOffset_Skin,
        false,
        false,
        oc.GeomAbs_JoinType.GeomAbs_Intersection,
        false,
      )
      mk = algo as never
      result = cast((mk as { Shape(): never }).Shape())
      if (removeFaces.length === 0) result = hollow(body.shape, result)
    } catch {
      throw new Error(SHELL_FAIL)
    }
    if (!result || !isValid(result)) throw new Error(SHELL_FAIL)
    const solid = singleSolid(result, SHELL_FAIL)
    result = solid
    // An inward wall can only remove material; anything else is a failed offset.
    const before = measureVolume(body.shape as never)
    const after = measureVolume(solid as never)
    if (!(after > 1e-6) || after >= before - 1e-9) throw new Error(SHELL_FAIL)
    const names = carryNames({ featureId, algo: mk!, sources: [body], result: solid, shell: true })
    const done: BuiltBody = { shape: solid, ...names }
    result = null
    return done
  } catch (err) {
    safeDelete(result)
    throw err
  } finally {
    scope.free()
  }
}

const SHELL_FAIL_OPEN = 'The shell can only open flat faces here. Pick a flat face, or hollow the solid without opening it.'

/** The faces OpenCascade's history lists as made from `shape` (caller frees them). */
function generatedFaces(algo: ShapeHistory, shape: AnyShape): AnyShape[] {
  const oc = getOC()
  const copy = new oc.NCollection_List_TopoDS_Shape(algo.Generated(shape.wrapped))
  const out: AnyShape[] = []
  try {
    while (!copy.IsEmpty()) {
      const sh = copy.First()
      out.push(cast(sh))
      copy.RemoveFirst()
    }
  } finally {
    safeDelete(copy)
  }
  return out
}

/**
 * Shell for an opened face that the direct algorithm cannot handle (OpenCascade hands back the body unchanged when
 * the opened face is tangent to a fillet). Builds the closed hollow solid, then cuts away the slab above the
 * inner copy of each opened face: a prism of that inner face, pushed out through the opened face. Only flat opened
 * faces work. The cut-away faces get rim names; the rest are named as in the direct shell.
 */
function shellByCut(featureId: string, body: BuiltBody, removeFaces: AnyShape[], thickness: number): BuiltBody {
  const oc = getOC()
  const scope = new Scope()
  let hollowShape: AnyShape | null = null
  let current: AnyShape | null = null
  let pending: BuiltBody | null = null
  try {
    const none = scope.track(new oc.NCollection_List_TopoDS_Shape())
    const offset = scope.track(new oc.BRepOffsetAPI_MakeThickSolid())
    // Intersection=true: a blend thinner than the wall collapses to a sharp inner corner instead of an invalid offset.
    offset.MakeThickSolidByJoin(
      body.shape.wrapped,
      none,
      -thickness,
      1e-3,
      oc.BRepOffset_Mode.BRepOffset_Skin,
      true,
      false,
      oc.GeomAbs_JoinType.GeomAbs_Intersection,
      false,
    )
    hollowShape = hollow(body.shape, cast((offset as unknown as { Shape(): never }).Shape()))
    hollowShape = singleSolid(hollowShape, SHELL_FAIL)
    const hollowNames = carryNames({ featureId, algo: offset as never, sources: [body], result: hollowShape, shell: true })
    let hollowBody: BuiltBody = { shape: hollowShape, ...hollowNames }
    pending = hollowBody
    hollowShape = null

    const removedNames = new Set<string>()
    for (const f of removeFaces) {
      const n = body.faceNames.get(f.hashCode)
      if (n !== undefined) removedNames.add(n)
    }
    const rename = (n: string) => (removedNames.has(n) ? `${featureId}/rim/${n}` : n)

    for (const face of removeFaces) {
      const planar = (face as unknown as { geomType: string }).geomType === 'PLANE'
      if (!planar) throw new Error(SHELL_FAIL_OPEN)
      const normal = (face as unknown as { normalAt(): { toTuple(): Vec3; delete(): void } }).normalAt()
      const [nx, ny, nz] = normal.toTuple()
      normal.delete()
      const inner = generatedFaces(offset as never, face)
      if (inner.length !== 1) {
        for (const i of inner) i.delete()
        throw new Error(SHELL_FAIL)
      }
      const len = thickness * 3
      const vec = scope.track(new oc.gp_Vec(nx * len, ny * len, nz * len))
      const prism = scope.track(new oc.BRepPrimAPI_MakePrism(inner[0].wrapped, vec, false, true))
      inner[0].delete()
      if (!prism.IsDone()) throw new Error(SHELL_FAIL)
      const tool = cast(prism.Shape())
      const rimName = `${featureId}/rim/${body.faceNames.get(face.hashCode) ?? 'face'}`
      const toolNames = new Map<number, string>()
      for (const f of tool.faces) toolNames.set(f.hashCode, rimName)
      const toolBody: BuiltBody = { shape: tool, faceNames: toolNames, edgeNames: new Map() }

      const cut = scope.track(new oc.BRepAlgoAPI_Cut())
      const args = scope.track(new oc.NCollection_List_TopoDS_Shape())
      const tools = scope.track(new oc.NCollection_List_TopoDS_Shape())
      args.Append(hollowBody.shape.wrapped)
      tools.Append(tool.wrapped)
      cut.SetArguments(args)
      cut.SetTools(tools)
      cut.SetNonDestructive(true)
      cut.Build()
      if (!cut.IsDone() || cut.HasErrors()) {
        tool.delete()
        throw new Error(SHELL_FAIL)
      }
      current = singleSolid(cast(cut.Shape()), SHELL_FAIL)
      if (current.solids.length !== 1 && !isValid(current)) throw new Error(SHELL_FAIL)
      const names = carryNames({ featureId, algo: cut as never, sources: [hollowBody, toolBody], result: current, rename })
      tool.delete()
      discard(hollowBody)
      hollowBody = { shape: current, ...names }
      pending = hollowBody
      current = null
    }
    if (!isValid(hollowBody.shape)) throw new Error(SHELL_FAIL)
    pending = null
    return hollowBody
  } finally {
    if (pending) discard(pending)
    safeDelete(hollowShape)
    safeDelete(current)
    scope.free()
  }
}

/** Hollows `body` inwards to a wall `thickness`, opening `removeFaces` (live faces of the body). */
export function shellBody(featureId: string, body: BuiltBody, removeFaces: AnyShape[], thickness: number): BuiltBody {
  try {
    return shellDirect(featureId, body, removeFaces, thickness)
  } catch (err) {
    if (removeFaces.length === 0) throw err
    // OpenCascade cannot open a face that is tangent to a fillet; try the cut-away construction.
    try {
      const built = shellByCut(featureId, body, removeFaces, thickness)
      const before = measureVolume(body.shape as never)
      const after = measureVolume(built.shape as never)
      if (!(after > 1e-6) || after >= before - 1e-9) {
        discard(built)
        throw new Error(SHELL_FAIL)
      }
      return built
    } catch (inner) {
      throw inner instanceof Error && inner.message === SHELL_FAIL_OPEN ? inner : err
    }
  }
}

// ---- transform ------------------------------------------------------------------------------------

export interface TransformSpec {
  /** Radians, about `axis` through `pivot`. Applied first. */
  rotate: { axis: Vec3; pivot: Vec3; angle: number } | null
  /** Applied after the rotation. */
  translate: Vec3
}

function prefixEdgeName(name: string, prefix: string): string {
  return name
    .split('|')
    .map((p) => prefix + p)
    .join('|')
}

/**
 * A moved copy of `body`. The topology is the same, so every face and edge keeps its name (found through the
 * transform's own history); `prefix` goes in front of every name (used for copies, so names stay unique).
 */
export function transformBody(body: BuiltBody, spec: TransformSpec, prefix: string): BuiltBody {
  return mapBody(body, prefix, (oc, scope) => {
    const move = scope.track(new oc.gp_Trsf())
    move.SetTranslation(scope.track(new oc.gp_Vec(spec.translate[0], spec.translate[1], spec.translate[2])))
    let total = move
    if (spec.rotate) {
      const { axis, pivot, angle } = spec.rotate
      const pnt = scope.track(new oc.gp_Pnt(pivot[0], pivot[1], pivot[2]))
      const dir = scope.track(new oc.gp_Dir(axis[0], axis[1], axis[2]))
      const ax = scope.track(new oc.gp_Ax1(pnt, dir))
      const rot = scope.track(new oc.gp_Trsf())
      rot.SetRotation(ax, angle)
      rot.PreMultiply(move) // rotation first, then the translation
      total = rot
    }
    return total
  })
}

/** A body scaled uniformly by `factor` about `center`. Every face and edge keeps its name (same topology). */
export function scaleBody(body: BuiltBody, factor: number, center: Vec3): BuiltBody {
  return mapBody(body, '', (oc, scope) => {
    const trsf = scope.track(new oc.gp_Trsf())
    trsf.SetScale(scope.track(new oc.gp_Pnt(center[0], center[1], center[2])), factor)
    return trsf
  })
}

/** Applies the transformation `build` makes and carries every face and edge name over (with `prefix` in front). */
function mapBody(body: BuiltBody, prefix: string, build: (oc: ReturnType<typeof getOC>, scope: Scope) => unknown): BuiltBody {
  const oc = getOC()
  const scope = new Scope()
  let result: AnyShape | null = null
  try {
    const total = build(oc, scope)
    const tr = scope.track(new oc.BRepBuilderAPI_Transform(body.shape.wrapped, total as never, true, false))
    result = cast(tr.Shape())

    const faceNames = new Map<number, string>()
    for (const face of body.shape.faces) {
      const name = body.faceNames.get(face.hashCode)
      if (name !== undefined) {
        const moved = cast(tr.ModifiedShape(face.wrapped))
        faceNames.set(moved.hashCode, prefix + name)
        moved.delete()
      }
      face.delete()
    }
    const edgeNames = new Map<number, string>()
    for (const edge of body.shape.edges) {
      const name = body.edgeNames.get(edge.hashCode)
      if (name !== undefined) {
        const moved = cast(tr.ModifiedShape(edge.wrapped))
        edgeNames.set(moved.hashCode, prefix ? prefixEdgeName(name, prefix) : name)
        moved.delete()
      }
      edge.delete()
    }
    const done: BuiltBody = { shape: result, faceNames, edgeNames }
    result = null
    return done
  } catch (err) {
    safeDelete(result)
    throw err
  } finally {
    scope.free()
  }
}

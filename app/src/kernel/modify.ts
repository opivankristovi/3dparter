// OpenCascade side of the body-changing features: fillet, chamfer and the three booleans.
// Each function reads body shapes, never changes them, and returns a NEW BuiltBody whose names were carried
// over from the inputs with OpenCascade's history (naming.ts). Failures throw an Error with a plain message.
import { cast, getOC, type AnyShape } from 'replicad'
import type { BooleanMode } from '../doc/types'
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

function isValid(shape: AnyShape): boolean {
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

/** `a` op `b` as a new body. Neither input is changed; faces keep the names they had in `a` and `b`. */
export function combine(featureId: string, op: BoolOp, a: BuiltBody, b: BuiltBody): BuiltBody {
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
    const names = carryNames({ featureId, algo, sources: [a, b], result: solid })
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

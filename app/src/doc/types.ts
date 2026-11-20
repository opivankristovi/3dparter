// The project document: the single source of truth for a design.
// Solids are never stored. The kernel worker rebuilds them by replaying `features`.
// See replica/architecture.md, "Document model". Units: millimetres and radians, always.
// SHARED CONTRACT between the UI (store, screens) and the kernel worker. Change with care.

export type Expr = string // "40", later "width/2 + 3". Stored as text, evaluated at regeneration.
export type Vec2 = [number, number]
export type Vec3 = [number, number, number]

export type DisplayUnit = 'mm' | 'cm' | 'm' | 'in' | 'ft'

/** The three origin planes. Z is up. XY = Top, XZ = Front, YZ = Right. */
export type OriginPlaneName = 'XY' | 'XZ' | 'YZ'

export type RefKind =
  | 'body'
  | 'face'
  | 'edge'
  | 'vertex'
  | 'sketchRegion'
  | 'sketchEdge'
  | 'originPlane'
  | 'originAxis'
  | 'constructionPlane'

/**
 * A reference to geometry made by an earlier feature, by topological NAME, never by index.
 * Naming scheme (M0):
 *   originPlane   'XY' | 'XZ' | 'YZ'
 *   body          '<featureId that created it>'
 *   face          '<extrudeId>/side/<sketchEntityId>'  |  '<extrudeId>/cap:start'  |  '<extrudeId>/cap:end'
 *   edge          '<faceName>|<faceName>' (the two adjacent face names, sorted), plus '#<n>' if several share a pair
 *   sketchRegion  '<sketchId>/region:<sorted entity ids of the outer loop, joined by ",">'
 *   sketchEdge    '<sketchId>/<entityId>'
 * Added in M2:
 *   originAxis         'X' | 'Y' | 'Z'
 *   constructionPlane  '<planeFeatureId>'
 *   face (revolve)     '<revolveId>/side/<entityId>' | '<revolveId>/cap:start|end'
 *   face (fillet, chamfer)  '<featureId>/blend/<edge name>'
 *   face (shell)       '<shellId>/inner/<original face name>', the rim at an opened face '<shellId>/rim/<name>'
 *   body (transform copy)  '<transformId>:<n>'; its face names get the prefix '<transformId>:<n>/'
 *   face (boolean with keepTools)  a target face that came from a kept tool: '<booleanId>/<tool face name>'
 *   A face split by a boolean keeps its name plus '#<n>' (stable geometric order). Faces a change
 *   leaves alone keep their names. A ref whose name is gone is matched again by `hint` (with a warning).
 */
export interface Ref {
  kind: RefKind
  name: string
  /** Geometric fallback for re-matching when a name disappears (M2). */
  hint?: { centroid: Vec3; normal?: Vec3; area?: number; length?: number }
}

// ---- Sketch -------------------------------------------------------------------------------

interface EntityBase {
  id: string
  construction: boolean
}
/** All sketch coordinates are 2D, in mm, in the sketch plane's local frame (see PlaneFrame). */
export interface LineEntity extends EntityBase {
  type: 'line'
  a: Vec2
  b: Vec2
}
export interface CircleEntity extends EntityBase {
  type: 'circle'
  center: Vec2
  radius: number
}
/** Counter-clockwise arc from startAngle to endAngle (radians). Used from M1. */
export interface ArcEntity extends EntityBase {
  type: 'arc'
  center: Vec2
  radius: number
  startAngle: number
  endAngle: number
}
export type SketchEntity = LineEntity | CircleEntity | ArcEntity

/**
 * Sketch constraints. `entityIds` holds REFS, in the order the constraint type expects:
 *   "<entityId>"                    the whole entity
 *   "<entityId>.<a|b|center|start|end>"  a point of it (line a/b, circle center, arc center/start/end)
 *   "origin"                        the fixed point (0, 0)
 *   "xAxis" | "yAxis"               fixed lines through the origin
 * Geometric types take refs only; dimensional types also carry `value` (mm for lengths, DEGREES for
 * angles). `driving: false` is a reference dimension: measured, never sent to the solver.
 *   coincident (pt,pt)  pointOnEntity (pt, line|circle|arc)  horizontal/vertical (line | pt,pt)
 *   parallel, perpendicular (line,line)  tangent (line|circle|arc pairs, or two endpoints)
 *   equal (line,line | circle/arc,circle/arc)  midpoint (pt,line)  concentric (c/a,c/a)
 *   symmetric (pt,pt,line)  fix (pt or entity)
 *   distance (pt,pt)  length (line)  horizontalDistance/verticalDistance (pt,pt, signed p2 - p1)
 *   pointLineDistance (pt,line)  radius/diameter (circle|arc)  angle (line,line)
 */
export type GeometricConstraintType =
  | 'coincident'
  | 'pointOnEntity'
  | 'horizontal'
  | 'vertical'
  | 'parallel'
  | 'perpendicular'
  | 'tangent'
  | 'equal'
  | 'midpoint'
  | 'concentric'
  | 'symmetric'
  | 'fix'
export type DimensionalConstraintType =
  | 'distance'
  | 'length'
  | 'horizontalDistance'
  | 'verticalDistance'
  | 'pointLineDistance'
  | 'radius'
  | 'diameter'
  | 'angle'
export type ConstraintType = GeometricConstraintType | DimensionalConstraintType

/** Which end of a line an angle arm starts at: its `a` end or its `b` end. */
export type ArmStart = 'a' | 'b'

export interface SketchConstraint {
  id: string
  type: ConstraintType
  entityIds: string[]
  value?: Expr
  driving: boolean
  /**
   * Only for `angle`: for each line (in entityIds order), the end where its arm STARTS; the arm runs from
   * that end to the other end. Decided once when the dimension is created (a shared corner makes both arms
   * leave it) and never re-derived, so adding or deleting a coincident later does not change what the angle
   * means. Absent (older documents) = each line's own a -> b, the same as ['a', 'a'].
   */
  arms?: [ArmStart, ArmStart]
}

export interface Sketch {
  entities: SketchEntity[]
  constraints: SketchConstraint[]
}

// ---- Features (history steps) -------------------------------------------------------------

interface FeatureBase {
  id: string
  name: string
  suppressed: boolean
}

export interface SketchFeature extends FeatureBase {
  type: 'sketch'
  params: { on: Ref } // M0: originPlane only. M2: a flat face.
  sketch: Sketch
}

export type BooleanMode = 'new' | 'union' | 'subtract' | 'intersect'

export interface ExtrudeFeature extends FeatureBase {
  type: 'extrude'
  params: {
    profiles: Ref[] // sketchRegion refs (all from one sketch in M0)
    distance: Expr // mm
    direction: 1 | -1 | 0 // 1 along the plane normal, -1 against it, 0 = symmetric both sides
    mode: BooleanMode // M0: 'new' only
    targets: Ref[] // bodies for union/subtract/intersect (M2)
  }
}

// ---- M2 modelling features ----------------------------------------------------------------
// Bodies are named after the feature that created them. A feature that changes a body (join, cut,
// intersect, fillet, chamfer, shell, transform) replaces that body under the SAME name. Face and edge
// names are carried through each change with OpenCascade's history (see kernel/naming.ts).
// Lengths are mm; ANGLES IN EXPRESSIONS ARE DEGREES (like sketch angle dimensions).

/** Rounds edges. Faces made by the fillet are named '<featureId>/blend/<edge name>'. */
export interface FilletFeature extends FeatureBase {
  type: 'fillet'
  params: { edges: Ref[]; radius: Expr }
}

/** Bevels edges at an equal distance. Faces made are named '<featureId>/blend/<edge name>'. */
export interface ChamferFeature extends FeatureBase {
  type: 'chamfer'
  params: { edges: Ref[]; distance: Expr }
}

/**
 * Body-to-body boolean. `target` (a body ref) keeps its name; `tools` are consumed unless `keepTools`.
 * union: target ∪ tools; subtract: target − tools; intersect: target ∩ tools.
 */
export interface BooleanFeature extends FeatureBase {
  type: 'boolean'
  params: { op: 'union' | 'subtract' | 'intersect'; target: Ref; tools: Ref[]; keepTools: boolean }
}

/**
 * Revolves sketch regions around an axis: a line of the same sketch (sketchEdge ref, construction lines
 * allowed) or an origin axis (originAxis ref 'X' | 'Y' | 'Z'). `angle` in degrees, 0 < angle <= 360.
 * `mode` / `targets` work as for extrude. Faces: '<id>/side/<entityId>', '<id>/cap:start|end'.
 */
export interface RevolveFeature extends FeatureBase {
  type: 'revolve'
  params: { profiles: Ref[]; axis: Ref; angle: Expr; mode: BooleanMode; targets: Ref[] }
}

/** Hollows a body to a wall `thickness` (inwards), opening the `removeFaces`. */
export interface ShellFeature extends FeatureBase {
  type: 'shell'
  params: { body: Ref; removeFaces: Ref[]; thickness: Expr }
}

/**
 * Moves and/or rotates bodies: rotation (degrees, about `axis` through `pivot`) first, then translation.
 * With `copy`, the originals stay and the copies are new bodies named '<featureId>:<n>' (n from 1).
 */
export interface TransformFeature extends FeatureBase {
  type: 'transform'
  params: {
    bodies: Ref[]
    translate: [Expr, Expr, Expr]
    rotate: { axis: Vec3; pivot: Vec3; angle: Expr } | null
    copy: boolean
  }
}

/**
 * A construction plane, offset along the base's normal and optionally tilted by `angle` (degrees) about
 * the base frame's xDir through its origin. `base` is an originPlane, a flat face, or another plane.
 * Referenced as { kind: 'constructionPlane', name: '<featureId>' }.
 */
export interface PlaneFeature extends FeatureBase {
  type: 'plane'
  params: { base: Ref; offset: Expr; angle: Expr }
}

export type Feature =
  | SketchFeature
  | ExtrudeFeature
  | RevolveFeature
  | FilletFeature
  | ChamferFeature
  | ShellFeature
  | BooleanFeature
  | TransformFeature
  | PlaneFeature

export interface Variable {
  id: string
  name: string
  expression: Expr
}

export interface BodyAppearance {
  name: string
  color: string | null // null = the theme's `body` token
  opacity: number // 0..1
  visible: boolean
  itemFolderId: string | null
}

export interface ProjectDocument {
  schemaVersion: 1
  units: DisplayUnit
  variables: Variable[]
  features: Feature[]
  rollbackIndex: number | null
  bodies: Record<string, BodyAppearance> // keyed by body name (= creating feature id)
  itemFolders: { id: string; name: string; itemIds: string[] }[]
}

export function emptyDocument(units: DisplayUnit = 'mm'): ProjectDocument {
  return {
    schemaVersion: 1,
    units,
    variables: [],
    features: [],
    rollbackIndex: null,
    bodies: {},
    itemFolders: [],
  }
}

// ---- Plane frames -------------------------------------------------------------------------

/** A sketch plane in world space. local (u, v) -> world = origin + u*xDir + v*yDir. normal = xDir × yDir. */
export interface PlaneFrame {
  origin: Vec3
  xDir: Vec3
  yDir: Vec3
  normal: Vec3
}

export const ORIGIN_PLANES: Record<OriginPlaneName, PlaneFrame> = {
  XY: { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] },
  XZ: { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 0, 1], normal: [0, -1, 0] },
  YZ: { origin: [0, 0, 0], xDir: [0, 1, 0], yDir: [0, 0, 1], normal: [1, 0, 0] },
}

export const ORIGIN_PLANE_LABELS: Record<OriginPlaneName, string> = {
  XY: 'Top',
  XZ: 'Front',
  YZ: 'Right',
}

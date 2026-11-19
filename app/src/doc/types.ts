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

/**
 * A reference to geometry made by an earlier feature, by topological NAME, never by index.
 * Naming scheme (M0):
 *   originPlane   'XY' | 'XZ' | 'YZ'
 *   body          '<featureId that created it>'
 *   face          '<extrudeId>/side/<sketchEntityId>'  |  '<extrudeId>/cap:start'  |  '<extrudeId>/cap:end'
 *   edge          '<faceName>|<faceName>' (the two adjacent face names, sorted), plus '#<n>' if several share a pair
 *   sketchRegion  '<sketchId>/region:<sorted entity ids of the outer loop, joined by ",">'
 *   sketchEdge    '<sketchId>/<entityId>'
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

export interface SketchConstraint {
  id: string
  type: ConstraintType
  entityIds: string[]
  value?: Expr
  driving: boolean
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

export type Feature = SketchFeature | ExtrudeFeature

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

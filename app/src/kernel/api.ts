// SHARED CONTRACT: the kernel worker's API, called from the UI through Comlink.
// The worker owns all B-rep geometry (OpenCascade via replicad). The UI only ever sees
// documents going in and meshes/outlines/files coming out.
import type { PlaneFrame, ProjectDocument, Ref, Vec3 } from '../doc/types'

export interface FeatureStatus {
  featureId: string
  ok: boolean
  /** Human-readable, written for the user, e.g. "This sketch has no closed shape to extrude." */
  message?: string
  /** Set when the step worked but something was matched again by position (a name was gone). */
  warning?: string
}

export interface RegenResult {
  /** Echo of the request's generation counter. The UI drops results older than its latest request. */
  generation: number
  statuses: FeatureStatus[]
  /** Names of the bodies that exist after the last non-suppressed feature. */
  bodies: string[]
  /** Bodies whose geometry changed since the previous regenerate (re-fetch their meshes). */
  changedBodies: string[]
  ms: number
}

/** Index ranges are in units of `indices` entries (3 per triangle). Transferable buffers. */
export interface MeshData {
  bodyId: string
  positions: Float32Array // xyz per vertex, world mm
  normals: Float32Array
  indices: Uint32Array
  faces: { name: string; start: number; count: number }[]
  edges: { name: string; points: Float32Array }[] // polyline per edge, xyz
  vertices?: { name: string; point: Vec3 }[]
}

/** A closed region of a solved sketch that can be extruded. */
export interface SketchRegionData {
  name: string // '<sketchId>/region:<ids>'
  /** Outer loop then hole loops, each a closed polyline in WORLD coordinates (xyz). */
  loops: Float32Array[]
  /** Triangulated fill for picking and display, world coordinates. */
  fill: { positions: Float32Array; indices: Uint32Array }
  area: number // mm²
}

export type ExportFormat = 'stl' | '3mf' | 'step' | 'obj' | 'glb'

export interface ExportOptions {
  /** Chordal tolerance in mm. "high" = 0.01, "low" = 0.1 (see architecture.md). */
  tolerance: number
  /** Angular tolerance in radians. */
  angularTolerance: number
  binary: boolean
  /** Display names for the bodies (body id to name), used to label objects in OBJ and GLB files. */
  bodyNames?: Record<string, string>
}

export interface MeasureValue {
  label: string
  kind: 'length' | 'area' | 'volume' | 'angle' | 'point'
  value?: number
  point?: Vec3
}

export interface MeasureResult {
  items: MeasureValue[]
  segment?: [Vec3, Vec3]
}

export interface KernelApi {
  /** Loads the WASM (about 23 MB). Safe to call more than once. */
  init(): Promise<{ version: string; ms: number }>
  /** Replays the document. Results are cached per feature; only changed features rerun. */
  regenerate(doc: ProjectDocument, generation: number): Promise<RegenResult>
  getMesh(bodyId: string, quality: 'preview' | 'high'): Promise<MeshData>
  /** Regions of a sketch feature as of the last regenerate. Empty array if it has no closed loops. */
  sketchRegions(sketchFeatureId: string): Promise<SketchRegionData[]>
  /** The plane a sketch was drawn in (its face or construction plane resolved), as of the last regenerate. null if the sketch failed. */
  sketchFrame(sketchFeatureId: string): Promise<PlaneFrame | null>
  /** The frame of an origin plane, a construction plane or a flat face as of the last regenerate; null if it is gone or not flat. */
  planeFrame(ref: Ref): Promise<PlaneFrame | null>
  /** Every working construction plane, in feature order, for drawing them. */
  constructionPlanes(): Promise<{ name: string; frame: PlaneFrame }[]>
  /** Bounding box of all visible bodies, for "zoom to fit". null if there are none. */
  bounds(): Promise<{ min: Vec3; max: Vec3 } | null>
  /** Measures 1 or 2 picked refs (length, radius, area, volume, coordinates, distance, angle). */
  measure(refs: Ref[]): Promise<MeasureResult>
  exportFile(format: ExportFormat, bodyIds: string[], opts: ExportOptions): Promise<ArrayBuffer>
  /** Frees every OpenCascade object. Call when closing a project. */
  dispose(): Promise<void>
}

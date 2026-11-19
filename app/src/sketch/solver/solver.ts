// The sketch solver: planegcs (FreeCAD's solver, as wasm) behind a small synchronous API.
// Call `await initSolver()` once; after that `solveSketch` is synchronous and allocation-clean
// (the wasm system is cleared after every solve).
import { GcsWrapper, SolveStatus, init_planegcs_module } from '@salusoft89/planegcs'
import type { ArcEntity, CircleEntity, LineEntity, Sketch, SketchEntity, Vec2 } from '../../doc/types'
import { buildSystem, pointId } from './toPrimitives'
import type { BuildOptions, BuiltSystem, DragSpec } from './toPrimitives'

export type SolveState = 'under' | 'full' | 'over'

export interface SolveResult {
  /** False when the solve failed or constraints conflict. `entities` is then the unsolved input. */
  ok: boolean
  entities: SketchEntity[]
  dof: number
  state: SolveState
  /** Ids of SketchConstraints the solver found in conflict. */
  conflicting: string[]
  /** Ids of SketchConstraints that repeat what others already say. */
  redundant: string[]
  /** Constraints that could not be handed to the solver (missing entity, wrong refs, bad value), with why. */
  invalid: Record<string, string>
}

export interface SolveOptions {
  drag?: DragSpec
}

export interface InitOptions {
  /** Absolute file path of planegcs.wasm. Node/tests only; in the browser leave it out (Vite serves the url). */
  wasmPath?: string
}

export class SolverNotReadyError extends Error {
  constructor() {
    super('The sketch solver is not initialised yet. Await initSolver() first.')
    this.name = 'SolverNotReadyError'
  }
}

let wrapper: GcsWrapper | null = null
let loading: Promise<void> | null = null

/** Loads the solver wasm. Idempotent and lazy: the first call loads, later calls share the result. */
export function initSolver(opts: InitOptions = {}): Promise<void> {
  if (wrapper) return Promise.resolve()
  loading ??= (async () => {
    const location = opts.wasmPath ?? (await import('./wasmUrl')).default
    const mod = await init_planegcs_module({ locateFile: () => location })
    wrapper = new GcsWrapper(new mod.GcsSystem(), mod)
  })().catch((err) => {
    loading = null // allow a retry
    throw err
  })
  return loading
}

export const isSolverReady = (): boolean => wrapper !== null

/** Throws a clear error when `initSolver()` has not finished. Commands call this first. */
export function ensureSolver(): void {
  if (!wrapper) throw new SolverNotReadyError()
}

// ---- running the system ------------------------------------------------------------------------

const SNAP = 1e-9 // a solved value this close to the input keeps the exact input number

interface RawRun {
  status: SolveStatus
  dof: number
  conflicting: string[]
  redundant: string[]
  entities: SketchEntity[] | null
  invalid: Record<string, string>
}

function mapIds(built: BuiltSystem, ids: string[]): string[] {
  const out = new Set<string>()
  for (const id of ids) {
    const c = built.constraintOf.get(id)
    if (c) out.add(c)
  }
  return [...out]
}

function near(a: number, b: number): boolean {
  return Math.abs(a - b) <= SNAP
}

function readPoint(w: GcsWrapper, id: string): Vec2 {
  const p = w.sketch_index.get_sketch_point(id)
  return [p.x, p.y]
}

/** Entity coordinates after the solve. An entity that did not really move keeps its exact numbers. */
function readEntity(w: GcsWrapper, e: SketchEntity): SketchEntity {
  if (e.type === 'line') {
    const a = readPoint(w, pointId(e.id, 'a'))
    const b = readPoint(w, pointId(e.id, 'b'))
    if (near(a[0], e.a[0]) && near(a[1], e.a[1]) && near(b[0], e.b[0]) && near(b[1], e.b[1])) return e
    return { ...e, a, b } satisfies LineEntity
  }
  if (e.type === 'circle') {
    const c = readPoint(w, pointId(e.id, 'center'))
    const r = w.sketch_index.get_sketch_circle(e.id).radius
    if (near(c[0], e.center[0]) && near(c[1], e.center[1]) && near(r, e.radius)) return e
    return { ...e, center: c, radius: r } satisfies CircleEntity
  }
  const c = readPoint(w, pointId(e.id, 'center'))
  const arc = w.sketch_index.get_sketch_arc(e.id)
  if (
    near(c[0], e.center[0]) &&
    near(c[1], e.center[1]) &&
    near(arc.radius, e.radius) &&
    near(arc.start_angle, e.startAngle) &&
    near(arc.end_angle, e.endAngle)
  ) {
    return e
  }
  return { ...e, center: c, radius: arc.radius, startAngle: arc.start_angle, endAngle: arc.end_angle } satisfies ArcEntity
}

function run(sketch: Sketch, opts: BuildOptions, read: boolean): RawRun {
  ensureSolver()
  const w = wrapper as GcsWrapper
  const built = buildSystem(sketch, opts)
  w.clear_data()
  try {
    w.push_primitives_and_params(built.primitives)
    for (const f of built.fixes) {
      const at = w.p_param_index.get(f.prim)
      if (at !== undefined) w.gcs.set_p_param(at + f.offset, f.value, true)
    }
    const status = w.solve()
    const dof = w.gcs.dof()
    const conflicting = mapIds(built, w.get_gcs_conflicting_constraints())
    const redundant = mapIds(built, w.get_gcs_redundant_constraints())
    let entities: SketchEntity[] | null = null
    if (read && (status === SolveStatus.Success || status === SolveStatus.Converged)) {
      w.apply_solution()
      const solved = sketch.entities.map((e) => readEntity(w, e))
      entities = solved.every((e) => Number.isFinite(entityChecksum(e))) ? solved : null
    }
    return { status, dof, conflicting, redundant, entities, invalid: Object.fromEntries(built.invalid) }
  } finally {
    w.clear_data()
  }
}

/** Sum of an entity's numbers: NaN or Infinity anywhere makes it non-finite. */
function entityChecksum(e: SketchEntity): number {
  if (e.type === 'line') return e.a[0] + e.a[1] + e.b[0] + e.b[1]
  if (e.type === 'circle') return e.center[0] + e.center[1] + e.radius
  return e.center[0] + e.center[1] + e.radius + e.startAngle + e.endAngle
}

/**
 * Solves the sketch. Unconstrained geometry never moves. With `drag`, the dragged point (or entity)
 * is pulled with temporary constraints, so an over-defined drag gives a best-effort result.
 */
export function solveSketch(sketch: Sketch, opts: SolveOptions = {}): SolveResult {
  const r = run(sketch, { drag: opts.drag }, true)
  const solved = r.status === SolveStatus.Success || r.status === SolveStatus.Converged
  const over = r.conflicting.length > 0 || r.redundant.length > 0
  return {
    ok: solved && r.entities !== null && r.conflicting.length === 0,
    entities: r.entities ?? sketch.entities,
    dof: r.dof,
    state: over ? 'over' : r.dof === 0 ? 'full' : 'under',
    conflicting: r.conflicting,
    redundant: r.redundant,
    invalid: r.invalid,
  }
}

/** Degrees of freedom of the sketch with the given entities fully pinned (no geometry is read back). */
export function dofWithFixed(sketch: Sketch, fixed: ReadonlySet<string>): { dof: number; conflicting: string[] } {
  const r = run(sketch, { fixedEntities: fixed }, false)
  return { dof: r.dof, conflicting: r.conflicting }
}

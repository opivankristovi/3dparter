// Replays the document's feature list with replicad / OpenCascade.
// Runs in a worker in the browser and directly in Node for tests. Never throws: every problem
// becomes a per-feature status with a message written for the user.
//
// State model: features replay over a running map of CURRENT bodies (name -> BodyRecord). A feature can add
// bodies, replace bodies under the same name (join, cut, intersect, fillet, chamfer, boolean target) and remove
// bodies (boolean tools, extra join targets). Each FeatureRecord keeps what its feature did (`set` and `removed`)
// so a cache hit can apply the same changes again without touching OpenCascade.
//
// A failed step changes nothing: its input bodies stay exactly as they were, so later steps still see them.
// (Steps that read the failed step's own names fail with "An earlier step failed.".)
import {
  ORIGIN_PLANES,
  type BooleanFeature,
  type ChamferFeature,
  type ExtrudeFeature,
  type Feature,
  type FilletFeature,
  type ImportFeature,
  type LineEntity,
  type LoftFeature,
  type MirrorFeature,
  type OriginPlaneName,
  type PatternFeature,
  type PlaneFeature,
  type PlaneFrame,
  type ProjectDocument,
  type Ref,
  type RevolveFeature,
  type ShellFeature,
  type SketchEntity,
  type SketchFeature,
  type SplitFeature,
  type SweepFeature,
  type TransformFeature,
  type Vec3,
} from '../doc/types'
import { evalField, evaluateVariables, exprFields } from '../doc/variables'
import type { Evaluated } from '../doc/variables'
import type { FeatureStatus, MeasureResult, RegenResult } from './api'
import { buildExtrusion, safeDelete, Scope, type BuiltBody } from './build'
import type { Edge, Face } from 'replicad'
import { dirToLocal, dotVec, faceFrame, localToWorld, subVec, tiltAndOffset, worldToLocal } from './frames'
import { buildLoft, buildSweep, edgeFromSketchEntity, importStepBody, mirrorBody, splitBody } from './m5Ops'
import { measureRefs } from './measure'
import { chamferBody, combine, discard, filletBody, shellBody, transformBody, type BoolOp } from './modify'
import { HINT_WARNING, pickSubShapes, resolveBodyRef, resolveSubRef, type Resolved } from './naming'
import { findRegions, type Region } from './regions'
import { buildRevolution, profilesCrossAxis, type LocalAxis } from './revolve'

export interface SketchRecord {
  sketchId: string
  frame: PlaneFrame
  /** The real (non-construction) entities: what regions and solids are built from. */
  entities: Map<string, SketchEntity>
  /** Every line, construction lines included: a revolve can turn around any of them. */
  lines: Map<string, LineEntity>
  regions: Region[]
}

export interface BodyRecord {
  name: string
  /** Cache key of the feature that made this version of the body. A different key means different geometry. */
  key: string
  built: BuiltBody
}

/** What a feature did to the body map. Cached with the record and applied again on a cache hit. */
interface FeatureRecord {
  key: string
  status: FeatureStatus
  sketch?: SketchRecord
  /** The frame of a construction plane (plane features only). */
  plane?: PlaneFrame
  /** Bodies added, or replaced under the same name. */
  set: BodyRecord[]
  /** Names of bodies this feature consumed. */
  removed: string[]
}

/** What a feature handler sees: the records of earlier features and the bodies as they are right now. */
interface Ctx {
  done: Map<string, FeatureRecord>
  bodies: Map<string, BodyRecord>
}

const ERR_EARLIER = 'An earlier step failed.'
const ERR_GONE = 'The shape this extrusion used is gone. Pick a new profile.'
const ERR_BODY_GONE = 'The solid this step used is gone. Pick it again.'
const ERR_LATER = 'This kind of step arrives in a later version.'
const PICK_TARGET: Record<Exclude<ExtrudeFeature['params']['mode'], 'new'>, string> = {
  union: 'Pick the solid to join to.',
  subtract: 'Pick the solid to cut from.',
  intersect: 'Pick the solid to intersect with.',
}

// ---- keys --------------------------------------------------------------------------------------

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    return `{${Object.keys(obj)
      .sort()
      .filter((k) => obj[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

/** cyrb53: small, fast, stable 53-bit string hash. */
function hash(str: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

/** Every ref a feature holds. Add a case when a new feature type reads refs. */
function refsOf(f: Feature): Ref[] {
  switch (f.type) {
    case 'sketch':
      return [f.params.on]
    case 'extrude':
      return [...f.params.profiles, ...f.params.targets]
    case 'revolve':
      return [...f.params.profiles, f.params.axis, ...f.params.targets]
    case 'sweep':
      return [f.params.profile, f.params.path, ...f.params.targets]
    case 'loft':
      return [...f.params.profiles, ...f.params.targets]
    case 'shell':
      return [f.params.body, ...f.params.removeFaces]
    case 'transform':
      return f.params.bodies
    case 'split':
      return [f.params.body, f.params.plane]
    case 'mirror':
      return [...f.params.bodies, f.params.plane]
    case 'pattern':
      return [...f.params.bodies, f.params.axis]
    case 'plane':
      return [f.params.base]
    case 'fillet':
    case 'chamfer':
      return f.params.edges
    case 'boolean':
      return [f.params.target, ...f.params.tools]
    case 'import':
      return []
  }
}

/** Feature ids a feature reads from, taken from the names of the refs it holds. */
function dependencies(f: Feature): string[] {
  const ids = new Set<string>()
  for (const r of refsOf(f)) {
    if (!r || r.kind === 'originPlane' || r.kind === 'originAxis') continue
    for (const part of r.name.split('|')) {
      const id = part.split('/')[0]
      if (id) ids.add(id)
    }
  }
  return [...ids]
}

/** Does this feature read the current bodies (so that its result depends on them)? */
function readsBodies(f: Feature): boolean {
  switch (f.type) {
    case 'sketch':
      return f.params.on.kind === 'face'
    case 'plane':
      return f.params.base.kind === 'face'
    case 'extrude':
      return f.params.mode !== 'new' || f.params.extent === 'throughAll'
    case 'revolve':
    case 'sweep':
    case 'loft':
      return f.params.mode !== 'new'
    case 'import':
      return false
    default:
      return true
  }
}

/**
 * Cache key = hash of the feature (without name and suppressed flag) + the keys of the earlier features it
 * names through its refs (sketches, mostly) + the keys of ALL current bodies, when the feature reads bodies at
 * all. Using every body, not only the ones it names, is deliberately simple: a body key changes whenever a
 * feature changed that body, so an edit upstream always reaches every later body-reading step, and a step that
 * does not read bodies (sketch, extrude 'new') is not invalidated by edits to other bodies.
 */
function featureKey(f: Feature, depKeys: string[], bodyKeys: string[]): string {
  return hash(canonical({ ...f, name: undefined, suppressed: undefined }) + '|' + depKeys.join(',') + '|' + bodyKeys.join(','))
}

// ---- expressions --------------------------------------------------------------------------------------

/**
 * Evaluates the Expr fields of a feature against the document's variables. Returns a COPY of the feature in
 * which every Expr field holds the evaluated number as text (so the cache key sees numbers, not text: "5 * 2"
 * and "10" are the same key), plus the first field error ("Distance: There is no variable called widht.").
 * A field with an error holds its message instead, so the key changes when the error does. Sketches have no
 * Expr fields here: their dimension values are solved into entity coordinates when edited.
 */
function resolveFeature(f: Feature, ev: Evaluated): { feature: Feature; error?: string } {
  if (f.type === 'sketch') return { feature: f }
  const copy = structuredClone(f)
  let error: string | undefined
  for (const field of exprFields(copy)) {
    const text = String(field.value ?? '')
    if (field.emptyIsZero && text.trim() === '') continue
    const r = evalField(text, ev, field.kind)
    if (r.ok) {
      field.set(String(r.value))
    } else {
      const message = `${field.label}: ${r.message}`
      error ??= message
      field.set(`#error ${message}`)
    }
  }
  return { feature: copy, ...(error ? { error } : {}) }
}

// ---- errors ------------------------------------------------------------------------------------

function plainError(err: unknown): string {
  if (err instanceof Error && err.message) {
    // Messages we raise ourselves are already plain; OpenCascade's are not, so keep them generic.
    if (/^[A-Z][^\n]{0,160}\.$/.test(err.message)) return err.message
    return 'OpenCascade could not build this shape. Try a different size or shape.'
  }
  return 'OpenCascade could not build this shape. Try a different size or shape.'
}

// ---- the kernel state --------------------------------------------------------------------------

export class Regenerator {
  private records = new Map<string, FeatureRecord>()
  private bodies = new Map<string, BodyRecord>()
  private visibility = new Map<string, boolean>()

  regenerate(doc: ProjectDocument, generation: number): RegenResult {
    const t0 = performance.now()
    const statuses: FeatureStatus[] = []
    const next = new Map<string, FeatureRecord>()
    const state = new Map<string, BodyRecord>()
    const ev = evaluateVariables(doc.variables ?? [])
    try {
      const last = doc.rollbackIndex === null ? doc.features.length - 1 : Math.min(doc.rollbackIndex, doc.features.length - 1)
      for (let i = 0; i <= last; i++) {
        const source = doc.features[i]
        if (source.suppressed) continue
        const { feature: f, error } = resolveFeature(source, ev)
        const depKeys = dependencies(f).map((d) => next.get(d)?.key ?? 'missing')
        const bodyKeys = readsBodies(f) ? [...state].map(([n, b]) => `${n}:${b.key}`) : []
        const key = featureKey(f, depKeys, bodyKeys)
        const cached = this.records.get(f.id)
        const rec = cached && cached.key === key ? cached : this.evaluate(f, key, { done: next, bodies: state }, error)
        next.set(f.id, rec)
        statuses.push(rec.status)
        if (rec.status.ok) {
          for (const name of rec.removed) state.delete(name)
          for (const b of rec.set) state.set(b.name, b)
        }
      }
    } catch (err) {
      // Safety net: report the failure on a status instead of throwing out of the worker.
      statuses.push({ featureId: '', ok: false, message: plainError(err) })
    }

    // Free the OpenCascade shapes of every body version that no kept record refers to any more.
    const live = new Set<BodyRecord>()
    for (const rec of next.values()) for (const b of rec.set) live.add(b)
    for (const old of this.records.values()) {
      for (const b of old.set) if (!live.has(b)) safeDelete(b.built.shape)
    }

    const changed = new Set<string>()
    for (const [name, b] of state) if (this.bodies.get(name)?.key !== b.key) changed.add(name)
    for (const name of this.bodies.keys()) if (!state.has(name)) changed.add(name)

    this.records = next
    this.bodies = state
    this.visibility = new Map(Object.entries(doc.bodies ?? {}).map(([k, v]) => [k, v.visible]))

    return {
      generation,
      statuses,
      bodies: [...state.keys()],
      changedBodies: [...changed],
      ms: performance.now() - t0,
    }
  }

  getBody(name: string): BodyRecord | undefined {
    return this.bodies.get(name)
  }

  getSketch(featureId: string): SketchRecord | undefined {
    const rec = this.records.get(featureId)
    return rec?.status.ok ? rec.sketch : undefined
  }

  /** The frame a sketch was drawn in, as of the last regenerate. */
  sketchFrame(featureId: string): PlaneFrame | null {
    return this.getSketch(featureId)?.frame ?? null
  }

  /** The frame of an origin plane, a construction plane or a flat face, as of the last regenerate. */
  planeFrame(ref: Ref): PlaneFrame | null {
    try {
      const r = this.frameOf(ref, { done: this.records, bodies: this.bodies }, 'plane')
      return 'frame' in r ? r.frame : null
    } catch {
      return null
    }
  }

  /** Every working construction plane, in feature order. */
  constructionPlanes(): { name: string; frame: PlaneFrame }[] {
    const out: { name: string; frame: PlaneFrame }[] = []
    for (const [id, rec] of this.records) if (rec.status.ok && rec.plane) out.push({ name: id, frame: rec.plane })
    return out
  }

  /** All current bodies that are not hidden in the document. */
  visibleBodies(): BodyRecord[] {
    return [...this.bodies.values()].filter((b) => this.visibility.get(b.name) !== false)
  }

  allBodies(): BodyRecord[] {
    return [...this.bodies.values()]
  }

  measure(refs: Ref[]): MeasureResult {
    return measureRefs(refs, this.bodies)
  }

  dispose(): void {
    const freed = new Set<BodyRecord>()
    for (const rec of this.records.values()) {
      for (const b of rec.set) {
        if (freed.has(b)) continue
        freed.add(b)
        safeDelete(b.built.shape)
      }
    }
    this.records.clear()
    this.bodies.clear()
    this.visibility.clear()
  }

  // ---- one feature: dispatch -------------------------------------------------------------------

  private evaluate(f: Feature, key: string, ctx: Ctx, error?: string): FeatureRecord {
    const fail = (message: string): FeatureRecord => ({
      key,
      status: { featureId: f.id, ok: false, message },
      set: [],
      removed: [],
    })
    try {
      if (error) return fail(error)
      for (const dep of dependencies(f)) {
        const d = ctx.done.get(dep)
        if (d && !d.status.ok) return fail(ERR_EARLIER)
      }
      // One case per feature type. A new type: add a handler and a case (and its refs in `refsOf`).
      switch (f.type) {
        case 'sketch':
          return this.evalSketch(f, key, ctx)
        case 'extrude':
          return this.evalExtrude(f, key, ctx)
        case 'revolve':
          return this.evalRevolve(f, key, ctx)
        case 'sweep':
          return this.evalSweep(f, key, ctx)
        case 'loft':
          return this.evalLoft(f, key, ctx)
        case 'shell':
          return this.evalShell(f, key, ctx)
        case 'transform':
          return this.evalTransform(f, key, ctx)
        case 'split':
          return this.evalSplit(f, key, ctx)
        case 'mirror':
          return this.evalMirror(f, key, ctx)
        case 'pattern':
          return this.evalPattern(f, key, ctx)
        case 'plane':
          return this.evalPlane(f, key, ctx)
        case 'fillet':
          return this.evalEdgeOp(f, key, ctx)
        case 'chamfer':
          return this.evalEdgeOp(f, key, ctx)
        case 'boolean':
          return this.evalBoolean(f, key, ctx)
        case 'import':
          return this.evalImport(f, key)
        default:
          return fail(ERR_LATER)
      }
    } catch (err) {
      return fail(plainError(err))
    }
  }

  /** The frame of a ref that stands for a plane: an origin plane, a construction plane or a flat face. */
  private frameOf(ref: Ref, ctx: Ctx, what: 'sketch' | 'plane'): { frame: PlaneFrame; warning?: string } | { error: string } {
    const on = what === 'sketch' ? 'was on' : 'was based on'
    if (ref.kind === 'originPlane') {
      const frame = ORIGIN_PLANES[ref.name as OriginPlaneName]
      if (frame) return { frame }
      return { error: what === 'sketch' ? 'This sketch is on a plane that does not exist.' : 'This plane is based on a plane that does not exist.' }
    }
    if (ref.kind === 'constructionPlane') {
      const rec = ctx.done.get(ref.name)
      if (!rec?.plane || !rec.status.ok) return { error: `The plane this ${what} ${on} is gone.` }
      return { frame: rec.plane }
    }
    if (ref.kind === 'face') {
      const r = resolveSubRef(ref, ctx.bodies.values())
      if (!r) return { error: `The face this ${what} ${on} is gone.` }
      const scope = new Scope()
      try {
        const [face] = pickSubShapes(r.body, 'face', [r.hash], scope) as Face[]
        const frame = face ? faceFrame(face) : null
        if (!frame) return { error: 'This face is not flat.' }
        return { frame, ...(r.byHint ? { warning: HINT_WARNING } : {}) }
      } finally {
        scope.free()
      }
    }
    return { error: `Pick a plane or a flat face for this ${what}.` }
  }

  private evalSketch(f: SketchFeature, key: string, ctx: Ctx): FeatureRecord {
    const placed = this.frameOf(f.params.on, ctx, 'sketch')
    if ('error' in placed) {
      return { key, status: { featureId: f.id, ok: false, message: placed.error }, set: [], removed: [] }
    }
    const entities = new Map<string, SketchEntity>()
    const lines = new Map<string, LineEntity>()
    for (const e of f.sketch.entities) {
      if (e.type === 'line') lines.set(e.id, e)
      if (!e.construction) entities.set(e.id, e)
    }
    const regions = findRegions(f.id, f.sketch)
    return {
      key,
      status: { featureId: f.id, ok: true, ...(placed.warning ? { warning: placed.warning } : {}) },
      sketch: { sketchId: f.id, frame: placed.frame, entities, lines, regions },
      set: [],
      removed: [],
    }
  }

  // ---- plane -----------------------------------------------------------------------------------

  private evalPlane(f: PlaneFeature, key: string, ctx: Ctx): FeatureRecord {
    const fail = (message: string): FeatureRecord => ({ key, status: { featureId: f.id, ok: false, message }, set: [], removed: [] })
    const offset = Number(f.params.offset)
    if (!Number.isFinite(offset)) return fail('Enter a number for the offset.')
    const angle = Number(f.params.angle === '' || f.params.angle === undefined ? '0' : f.params.angle)
    if (!Number.isFinite(angle)) return fail('Enter a number for the angle.')
    if (!f.params.base || !f.params.base.name) return fail('Pick a plane or a flat face to build this plane on.')
    const base = this.frameOf(f.params.base, ctx, 'plane')
    if ('error' in base) return fail(base.error)
    return {
      key,
      status: { featureId: f.id, ok: true, ...(base.warning ? { warning: base.warning } : {}) },
      plane: tiltAndOffset(base.frame, angle, offset),
      set: [],
      removed: [],
    }
  }

  // ---- extrude and revolve (new, union, subtract, intersect) ------------------------------------

  /** The regions the profile refs point at (all from one sketch), or a message. */
  private pickRegions(profiles: Ref[], ctx: Ctx, gone: string): { regions: Region[]; sketch: SketchRecord } | { error: string } {
    const regions: Region[] = []
    let sketch: SketchRecord | undefined
    for (const ref of profiles) {
      const sketchId = ref.name.split('/region:')[0]
      const sk = ctx.done.get(sketchId)?.sketch
      if (!sk) return { error: gone }
      if (sketch && sketch !== sk) return { error: 'Pick shapes from one sketch at a time.' }
      sketch = sk
      const region = sk.regions.find((r) => r.name === ref.name)
      if (!region) return { error: gone }
      regions.push(region)
    }
    if (!sketch) return { error: gone }
    return { regions, sketch }
  }

  /** The target bodies of a non-'new' mode, or a message. Targets first: no point building a solid without them. */
  private pickTargets(mode: ExtrudeFeature['params']['mode'], refs: Ref[], ctx: Ctx): { targets: BodyRecord[] } | { error: string } {
    const targets: BodyRecord[] = []
    if (mode === 'new') return { targets }
    if (refs.length === 0) return { error: PICK_TARGET[mode] }
    for (const ref of refs) {
      const t = resolveBodyRef(ref, ctx.bodies)
      if (!t) return { error: ERR_BODY_GONE }
      if (!targets.includes(t)) targets.push(t)
    }
    return { targets }
  }

  /** Puts a freshly built tool solid into the model: as a new body, or combined with the targets. Frees the tool. */
  private applyTool(id: string, key: string, mode: ExtrudeFeature['params']['mode'], targets: BodyRecord[], tool: BuiltBody): FeatureRecord {
    if (mode === 'new') {
      return { key, status: { featureId: id, ok: true }, set: [{ name: id, key, built: tool }], removed: [] }
    }
    try {
      const op: BoolOp = mode
      const set: BodyRecord[] = []
      let removed: string[] = []
      if (op === 'union') {
        // The tool joins the first target; any further targets are merged in and disappear as bodies.
        const [first, ...rest] = targets
        let acc = combine(id, 'union', first.built, tool)
        try {
          for (const t of rest) {
            const merged = combine(id, 'union', acc, t.built)
            discard(acc)
            acc = merged
          }
        } catch (err) {
          discard(acc)
          throw err
        }
        set.push({ name: first.name, key, built: acc })
        removed = rest.map((t) => t.name)
      } else {
        try {
          for (const t of targets) set.push({ name: t.name, key, built: combine(id, op, t.built, tool) })
        } catch (err) {
          for (const b of set) discard(b.built)
          throw err
        }
      }
      return { key, status: { featureId: id, ok: true }, set, removed }
    } finally {
      discard(tool) // the tool body is never kept: its faces live on in the result under their names
    }
  }

  private throughAllDistance(bodies: Iterable<BodyRecord>, frame: PlaneFrame, startOffset: number, direction: 1 | -1 | 0): number {
    const sign = direction === -1 ? -1 : 1
    const ox = frame.origin[0] + frame.normal[0] * startOffset
    const oy = frame.origin[1] + frame.normal[1] * startOffset
    const oz = frame.origin[2] + frame.normal[2] * startOffset
    let maxSpan = 0
    let any = false
    for (const b of bodies) {
      any = true
      const bb = b.built.shape.boundingBox
      const [lo, hi] = bb.bounds
      bb.delete()
      for (const x of [lo[0], hi[0]]) {
        for (const y of [lo[1], hi[1]]) {
          for (const z of [lo[2], hi[2]]) {
            const proj = (x - ox) * frame.normal[0] * sign + (y - oy) * frame.normal[1] * sign + (z - oz) * frame.normal[2] * sign
            maxSpan = Math.max(maxSpan, direction === 0 ? Math.abs(proj) * 2 : proj)
          }
        }
      }
    }
    return any ? Math.max(10, maxSpan + 2) : 200
  }

  private evalExtrude(f: ExtrudeFeature, key: string, ctx: Ctx): FeatureRecord {
    const p = f.params
    const fail = (message: string): FeatureRecord => ({ key, status: { featureId: f.id, ok: false, message }, set: [], removed: [] })
    const startOffset = Number(p.startOffset === '' || p.startOffset === undefined ? '0' : p.startOffset)
    if (!Number.isFinite(startOffset)) return fail('Enter a number for the start offset.')
    if (p.profiles.length === 0) return fail('Pick a shape to extrude.')

    const picked = this.pickRegions(p.profiles, ctx, ERR_GONE)
    if ('error' in picked) return fail(picked.error)
    const targets = this.pickTargets(p.mode, p.targets, ctx)
    if ('error' in targets) return fail(targets.error)

    let distance = Number(p.distance)
    if (p.extent === 'throughAll') {
      const spanTargets = targets.targets.length > 0 ? targets.targets : ctx.bodies.values()
      distance = this.throughAllDistance(spanTargets, picked.sketch.frame, startOffset, p.direction)
    } else if (!Number.isFinite(distance) || distance <= 0) {
      return fail('Enter a distance greater than 0.')
    }

    const tool = buildExtrusion({
      extrudeId: f.id,
      regions: picked.regions,
      entities: picked.sketch.entities,
      frame: picked.sketch.frame,
      distance,
      direction: p.direction,
      startOffset,
    })
    return this.applyTool(f.id, key, p.mode, targets.targets, tool)
  }

  private evalRevolve(f: RevolveFeature, key: string, ctx: Ctx): FeatureRecord {
    const p = f.params
    const fail = (message: string): FeatureRecord => ({ key, status: { featureId: f.id, ok: false, message }, set: [], removed: [] })
    const angle = Number(p.angle)
    if (!Number.isFinite(angle) || angle <= 0 || angle > 360) return fail('Enter an angle above 0 and up to 360 degrees.')
    if (p.profiles.length === 0) return fail('Pick a shape to revolve.')
    if (!p.axis || !p.axis.name) return fail('Pick the line or axis to revolve around.')

    const picked = this.pickRegions(p.profiles, ctx, 'The shape this revolve used is gone. Pick a new profile.')
    if ('error' in picked) return fail(picked.error)
    const { regions, sketch } = picked

    // The axis, in world space and in the sketch's own coordinates.
    let axisPoint: Vec3
    let axisDir: Vec3
    if (p.axis.kind === 'originAxis') {
      const dir = ({ X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] } as Record<string, Vec3>)[p.axis.name]
      if (!dir) return fail('This revolve turns around an axis that does not exist.')
      axisPoint = [0, 0, 0]
      axisDir = dir
      const n = sketch.frame.normal
      if (Math.abs(dotVec(dir, n)) > 1e-6 || Math.abs(dotVec(subVec(axisPoint, sketch.frame.origin), n)) > 1e-6) {
        return fail('The axis has to lie in the plane of the sketch.')
      }
    } else if (p.axis.kind === 'sketchEdge') {
      const slash = p.axis.name.indexOf('/')
      const sketchId = slash < 0 ? '' : p.axis.name.slice(0, slash)
      if (sketchId !== sketch.sketchId) return fail('Pick an axis line from the same sketch as the shape.')
      const line = sketch.lines.get(p.axis.name.slice(slash + 1))
      if (!line) return fail('The line this revolve turns around is gone.')
      axisPoint = localToWorld(sketch.frame, line.a)
      axisDir = subVec(localToWorld(sketch.frame, line.b), axisPoint)
      if (Math.hypot(...axisDir) < 1e-9) return fail('The axis line has no length.')
    } else {
      return fail('Pick a line or an axis to revolve around.')
    }
    const local: LocalAxis = { p: worldToLocal(sketch.frame, axisPoint), d: dirToLocal(sketch.frame, axisDir) }
    if (profilesCrossAxis(regions, local)) return fail('The shape crosses the axis it turns around.')

    const targets = this.pickTargets(p.mode, p.targets, ctx)
    if ('error' in targets) return fail(targets.error)

    const tool = buildRevolution({
      revolveId: f.id,
      regions,
      entities: sketch.entities,
      frame: sketch.frame,
      axisPoint,
      axisDir,
      angle: (angle * Math.PI) / 180,
    })
    return this.applyTool(f.id, key, p.mode, targets.targets, tool)
  }

  // ---- shell -----------------------------------------------------------------------------------

  private evalShell(f: ShellFeature, key: string, ctx: Ctx): FeatureRecord {
    const p = f.params
    const fail = (message: string): FeatureRecord => ({ key, status: { featureId: f.id, ok: false, message }, set: [], removed: [] })
    const thickness = Number(p.thickness)
    if (!Number.isFinite(thickness) || thickness <= 0) return fail('Enter a wall thickness greater than 0.')
    if (!p.body || !p.body.name) return fail('Pick the solid to hollow out.')
    const body = resolveBodyRef(p.body, ctx.bodies)
    if (!body) return fail(ERR_BODY_GONE)

    const hashes: number[] = []
    let byHint = false
    for (const ref of p.removeFaces) {
      const r = ref.kind === 'face' ? resolveSubRef(ref, [body]) : null
      if (!r) return fail('A face this shell opened is gone. Pick it again.')
      if (!hashes.includes(r.hash)) hashes.push(r.hash)
      byHint = byHint || r.byHint
    }

    const scope = new Scope()
    try {
      const faces = pickSubShapes(body, 'face', hashes, scope)
      const built = shellBody(f.id, body.built, faces, thickness)
      return {
        key,
        status: { featureId: f.id, ok: true, ...(byHint ? { warning: HINT_WARNING } : {}) },
        set: [{ name: body.name, key, built }],
        removed: [],
      }
    } finally {
      scope.free()
    }
  }

  // ---- transform -------------------------------------------------------------------------------

  private evalTransform(f: TransformFeature, key: string, ctx: Ctx): FeatureRecord {
    const p = f.params
    const fail = (message: string): FeatureRecord => ({ key, status: { featureId: f.id, ok: false, message }, set: [], removed: [] })
    if (p.bodies.length === 0) return fail('Pick at least one solid to move.')
    const bodies: BodyRecord[] = []
    for (const ref of p.bodies) {
      const b = resolveBodyRef(ref, ctx.bodies)
      if (!b) return fail(ERR_BODY_GONE)
      if (!bodies.includes(b)) bodies.push(b)
    }
    const translate = p.translate.map((e) => Number(e))
    if (translate.length !== 3 || translate.some((v) => !Number.isFinite(v))) return fail('Enter numbers for the move.')
    let rotate: { axis: Vec3; pivot: Vec3; angle: number } | null = null
    if (p.rotate) {
      const angle = Number(p.rotate.angle)
      if (!Number.isFinite(angle)) return fail('Enter a number for the rotation angle.')
      if (Math.hypot(...p.rotate.axis) < 1e-9) return fail('The rotation axis needs a direction.')
      rotate = { axis: p.rotate.axis, pivot: p.rotate.pivot, angle: (angle * Math.PI) / 180 }
    }

    const set: BodyRecord[] = []
    try {
      bodies.forEach((b, i) => {
        const name = p.copy ? `${f.id}:${i + 1}` : b.name
        const prefix = p.copy ? `${name}/` : ''
        set.push({ name, key, built: transformBody(b.built, { rotate, translate: translate as Vec3 }, prefix) })
      })
    } catch (err) {
      for (const b of set) discard(b.built)
      throw err
    }
    return { key, status: { featureId: f.id, ok: true }, set, removed: [] }
  }

  // ---- fillet and chamfer ----------------------------------------------------------------------

  private evalEdgeOp(f: FilletFeature | ChamferFeature, key: string, ctx: Ctx): FeatureRecord {
    const fail = (message: string): FeatureRecord => ({ key, status: { featureId: f.id, ok: false, message }, set: [], removed: [] })
    const isFillet = f.type === 'fillet'
    const size = Number(f.type === 'fillet' ? f.params.radius : f.params.distance)
    if (!Number.isFinite(size) || size <= 0) {
      return fail(isFillet ? 'Enter a radius greater than 0.' : 'Enter a distance greater than 0.')
    }
    if (f.params.edges.length === 0) return fail(isFillet ? 'Pick at least one edge to round.' : 'Pick at least one edge to bevel.')

    const found: Resolved[] = []
    for (const ref of f.params.edges) {
      const r = resolveSubRef(ref, ctx.bodies.values())
      if (!r || ref.kind !== 'edge') {
        return fail(`An edge this ${isFillet ? 'fillet' : 'chamfer'} used is gone. Pick it again.`)
      }
      found.push(r)
    }
    const body = found[0].body
    if (found.some((r) => r.body !== body)) return fail('Pick edges from one solid at a time.')
    const hashes = [...new Set(found.map((r) => r.hash))]
    const warning = found.some((r) => r.byHint) ? HINT_WARNING : undefined

    const source = ctx.bodies.get(body.name)!
    const scope = new Scope()
    try {
      const edges = pickSubShapes(source, 'edge', hashes, scope)
      const built = isFillet ? filletBody(f.id, source.built, edges, size) : chamferBody(f.id, source.built, edges, size)
      return {
        key,
        status: { featureId: f.id, ok: true, ...(warning ? { warning } : {}) },
        set: [{ name: source.name, key, built }],
        removed: [],
      }
    } finally {
      scope.free()
    }
  }

  // ---- boolean ---------------------------------------------------------------------------------

  private evalBoolean(f: BooleanFeature, key: string, ctx: Ctx): FeatureRecord {
    const p = f.params
    const fail = (message: string): FeatureRecord => ({ key, status: { featureId: f.id, ok: false, message }, set: [], removed: [] })
    if (!p.target || !p.target.name) return fail('Pick the solid to work on.')
    if (p.tools.length === 0) return fail('Pick at least one more solid to combine with.')
    const target = resolveBodyRef(p.target, ctx.bodies)
    if (!target) return fail(ERR_BODY_GONE)
    const tools: BodyRecord[] = []
    for (const ref of p.tools) {
      const t = resolveBodyRef(ref, ctx.bodies)
      if (!t) return fail(ERR_BODY_GONE)
      if (t === target) return fail('A solid cannot be combined with itself.')
      if (!tools.includes(t)) tools.push(t)
    }

    // Tools go in one by one; the running result is a temporary body until the last one is done.
    let acc: BuiltBody = target.built
    try {
      for (const t of tools) {
        const next = combine(f.id, p.op, acc, t.built, p.keepTools ? `${f.id}/` : '')
        if (acc !== target.built) discard(acc)
        acc = next
      }
    } catch (err) {
      if (acc !== target.built) discard(acc)
      throw err
    }
    return {
      key,
      status: { featureId: f.id, ok: true },
      set: [{ name: target.name, key, built: acc }],
      removed: p.keepTools ? [] : tools.map((t) => t.name),
    }
  }

  // ---- sweep, loft, split, mirror, pattern, import (M5) --------------------------------------

  private evalSweep(f: SweepFeature, key: string, ctx: Ctx): FeatureRecord {
    const p = f.params
    const fail = (message: string): FeatureRecord => ({ key, status: { featureId: f.id, ok: false, message }, set: [], removed: [] })
    if (!p.profile?.name) return fail('Pick a closed shape to sweep.')
    if (!p.path?.name) return fail('Pick a sketch line or edge path to sweep along.')

    const picked = this.pickRegions([p.profile], ctx, 'The shape this sweep used is gone. Pick a new profile.')
    if ('error' in picked) return fail(picked.error)
    const targets = this.pickTargets(p.mode, p.targets, ctx)
    if ('error' in targets) return fail(targets.error)

    const scope = new Scope()
    try {
      const pathEdges: Edge[] = []
      if (p.path.kind === 'sketchEdge') {
        const slash = p.path.name.indexOf('/')
        const skId = slash < 0 ? '' : p.path.name.slice(0, slash)
        const eid = slash < 0 ? '' : p.path.name.slice(slash + 1)
        const sk = ctx.done.get(skId)?.sketch
        const ent = sk?.entities.get(eid) ?? sk?.lines.get(eid)
        if (!sk || !ent) return fail('The path this sweep used is gone. Pick a new path.')
        pathEdges.push(scope.track(edgeFromSketchEntity(ent, sk.frame)))
      } else if (p.path.kind === 'edge') {
        const r = resolveSubRef(p.path, ctx.bodies.values())
        if (!r) return fail('The edge path this sweep used is gone. Pick it again.')
        const [edge] = pickSubShapes(r.body, 'edge', [r.hash], scope) as Edge[]
        if (!edge) return fail('The edge path this sweep used is gone. Pick it again.')
        pathEdges.push(edge)
      } else {
        return fail('Pick a sketch line, arc, or solid edge as the sweep path.')
      }
      const tool = buildSweep(f.id, { region: picked.regions[0], sketch: picked.sketch }, pathEdges)
      return this.applyTool(f.id, key, p.mode, targets.targets, tool)
    } finally {
      scope.free()
    }
  }

  private evalLoft(f: LoftFeature, key: string, ctx: Ctx): FeatureRecord {
    const p = f.params
    const fail = (message: string): FeatureRecord => ({ key, status: { featureId: f.id, ok: false, message }, set: [], removed: [] })
    if (p.profiles.length < 2) return fail('Pick at least two closed shapes to loft between.')
    const sections: { region: Region; sketch: SketchRecord }[] = []
    for (const ref of p.profiles) {
      const skId = ref.name.split('/region:')[0]
      const sk = ctx.done.get(skId)?.sketch
      const reg = sk?.regions.find((r) => r.name === ref.name)
      if (!sk || !reg) return fail('A profile this loft used is gone. Pick the profiles again.')
      sections.push({ region: reg, sketch: sk })
    }
    const targets = this.pickTargets(p.mode, p.targets, ctx)
    if ('error' in targets) return fail(targets.error)
    const tool = buildLoft(f.id, sections)
    return this.applyTool(f.id, key, p.mode, targets.targets, tool)
  }

  private evalSplit(f: SplitFeature, key: string, ctx: Ctx): FeatureRecord {
    const fail = (message: string): FeatureRecord => ({ key, status: { featureId: f.id, ok: false, message }, set: [], removed: [] })
    if (!f.params.body?.name) return fail('Pick a solid to split.')
    if (!f.params.plane?.name) return fail('Pick a plane or flat face to split with.')
    const body = resolveBodyRef(f.params.body, ctx.bodies)
    if (!body) return fail(ERR_BODY_GONE)
    const plane = this.frameOf(f.params.plane, ctx, 'plane')
    if ('error' in plane) return fail(plane.error)
    const { kept, splitOff } = splitBody(f.id, body.built, plane.frame)
    return {
      key,
      status: { featureId: f.id, ok: true, ...(plane.warning ? { warning: plane.warning } : {}) },
      set: [
        { name: body.name, key, built: kept },
        { name: `${f.id}:1`, key, built: splitOff },
      ],
      removed: [],
    }
  }

  private evalMirror(f: MirrorFeature, key: string, ctx: Ctx): FeatureRecord {
    const p = f.params
    const fail = (message: string): FeatureRecord => ({ key, status: { featureId: f.id, ok: false, message }, set: [], removed: [] })
    if (p.bodies.length === 0) return fail('Pick at least one solid to mirror.')
    if (!p.plane?.name) return fail('Pick a plane or flat face to mirror across.')
    const bodies: BodyRecord[] = []
    for (const ref of p.bodies) {
      const b = resolveBodyRef(ref, ctx.bodies)
      if (!b) return fail(ERR_BODY_GONE)
      if (!bodies.includes(b)) bodies.push(b)
    }
    const plane = this.frameOf(p.plane, ctx, 'plane')
    if ('error' in plane) return fail(plane.error)
    const set: BodyRecord[] = []
    try {
      bodies.forEach((b, i) => {
        const name = p.merge ? b.name : `${f.id}:${i + 1}`
        const prefix = p.merge ? '' : `${name}/`
        set.push({ name, key, built: mirrorBody(f.id, b.built, plane.frame, p.merge, prefix) })
      })
    } catch (err) {
      for (const s of set) discard(s.built)
      throw err
    }
    return { key, status: { featureId: f.id, ok: true, ...(plane.warning ? { warning: plane.warning } : {}) }, set, removed: [] }
  }

  private resolvePatternAxis(axis: Ref, ctx: Ctx): { point: Vec3; dir: Vec3 } | { error: string } {
    if (axis.kind === 'originAxis') {
      const dir = ({ X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] } as Record<string, Vec3>)[axis.name]
      if (!dir) return { error: 'Pick a valid axis or direction.' }
      return { point: [0, 0, 0], dir }
    }
    if (axis.kind === 'sketchEdge') {
      const slash = axis.name.indexOf('/')
      const sk = slash < 0 ? undefined : ctx.done.get(axis.name.slice(0, slash))?.sketch
      const line = sk?.lines.get(axis.name.slice(slash + 1))
      if (!sk || !line) return { error: 'The axis line this pattern used is gone.' }
      const p0 = localToWorld(sk.frame, line.a)
      const p1 = localToWorld(sk.frame, line.b)
      const d = subVec(p1, p0)
      const len = Math.hypot(...d)
      if (len < 1e-9) return { error: 'The axis line has zero length.' }
      return { point: p0, dir: [d[0] / len, d[1] / len, d[2] / len] }
    }
    if (axis.kind === 'face' || axis.kind === 'constructionPlane' || axis.kind === 'originPlane') {
      const pl = this.frameOf(axis, ctx, 'plane')
      if ('error' in pl) return pl
      return { point: pl.frame.origin, dir: pl.frame.normal }
    }
    if (axis.kind === 'edge') {
      const r = resolveSubRef(axis, ctx.bodies.values())
      if (!r) return { error: 'The edge this pattern used is gone.' }
      const scope = new Scope()
      try {
        const [edge] = pickSubShapes(r.body, 'edge', [r.hash], scope) as Edge[]
        if (!edge) return { error: 'The edge this pattern used is gone.' }
        const p0 = edge.pointAt(0)
        const p1 = edge.pointAt(1)
        const a = p0.toTuple()
        const b = p1.toTuple()
        p0.delete()
        p1.delete()
        const d = subVec(b, a)
        const len = Math.hypot(...d)
        if (len < 1e-9) return { error: 'The picked edge has zero length.' }
        return { point: a, dir: [d[0] / len, d[1] / len, d[2] / len] }
      } finally {
        scope.free()
      }
    }
    return { error: 'Pick an axis, edge, or flat face.' }
  }

  private evalPattern(f: PatternFeature, key: string, ctx: Ctx): FeatureRecord {
    const p = f.params
    const fail = (message: string): FeatureRecord => ({ key, status: { featureId: f.id, ok: false, message }, set: [], removed: [] })
    if (p.bodies.length === 0) return fail('Pick at least one solid to pattern.')
    if (!p.axis?.name) return fail('Pick a direction axis for this pattern.')
    const rawCount = Number(p.count)
    if (!Number.isFinite(rawCount) || rawCount < 2 || rawCount > 50) return fail('Enter a copy count between 2 and 50.')
    const count = Math.round(rawCount)
    const spacing = Number(p.spacing)
    if (!Number.isFinite(spacing) || spacing === 0) {
      return fail(p.kind === 'circular' ? 'Enter a non-zero step angle.' : 'Enter a non-zero spacing.')
    }
    const bodies: BodyRecord[] = []
    for (const ref of p.bodies) {
      const b = resolveBodyRef(ref, ctx.bodies)
      if (!b) return fail(ERR_BODY_GONE)
      if (!bodies.includes(b)) bodies.push(b)
    }
    const ax = this.resolvePatternAxis(p.axis, ctx)
    if ('error' in ax) return fail(ax.error)

    const set: BodyRecord[] = []
    try {
      for (let k = 1; k < count; k++) {
        bodies.forEach((b, i) => {
          const idx = (k - 1) * bodies.length + i + 1
          const name = `${f.id}:${idx}`
          const spec =
            p.kind === 'circular'
              ? { rotate: { axis: ax.dir, pivot: ax.point, angle: (spacing * k * Math.PI) / 180 }, translate: [0, 0, 0] as Vec3 }
              : {
                  rotate: null,
                  translate: [ax.dir[0] * spacing * k, ax.dir[1] * spacing * k, ax.dir[2] * spacing * k] as Vec3,
                }
          set.push({ name, key, built: transformBody(b.built, spec, `${name}/`) })
        })
      }
    } catch (err) {
      for (const s of set) discard(s.built)
      throw err
    }
    return { key, status: { featureId: f.id, ok: true }, set, removed: [] }
  }

  private evalImport(f: ImportFeature, key: string): FeatureRecord {
    const built = importStepBody(f.id, f.params.content)
    return { key, status: { featureId: f.id, ok: true }, set: [{ name: f.id, key, built }], removed: [] }
  }
}

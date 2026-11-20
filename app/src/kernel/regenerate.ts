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
  type OriginPlaneName,
  type PlaneFrame,
  type ProjectDocument,
  type Ref,
  type SketchEntity,
  type SketchFeature,
} from '../doc/types'
import type { FeatureStatus, RegenResult } from './api'
import { buildExtrusion, safeDelete, Scope, type BuiltBody } from './build'
import { chamferBody, combine, discard, filletBody, type BoolOp } from './modify'
import { HINT_WARNING, pickSubShapes, resolveBodyRef, resolveSubRef, type Resolved } from './naming'
import { findRegions, type Region } from './regions'

export interface SketchRecord {
  sketchId: string
  frame: PlaneFrame
  entities: Map<string, SketchEntity>
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
    case 'extrude':
      return [...f.params.profiles, ...f.params.targets]
    case 'fillet':
    case 'chamfer':
      return f.params.edges
    case 'boolean':
      return [f.params.target, ...f.params.tools]
    default:
      return []
  }
}

/** Feature ids a feature reads from, taken from the names of the refs it holds. */
function dependencies(f: Feature): string[] {
  const ids = new Set<string>()
  for (const r of refsOf(f)) {
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
    case 'revolve':
      return f.params.mode !== 'new'
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
    try {
      const last = doc.rollbackIndex === null ? doc.features.length - 1 : Math.min(doc.rollbackIndex, doc.features.length - 1)
      for (let i = 0; i <= last; i++) {
        const f = doc.features[i]
        if (f.suppressed) continue
        const depKeys = dependencies(f).map((d) => next.get(d)?.key ?? 'missing')
        const bodyKeys = readsBodies(f) ? [...state].map(([n, b]) => `${n}:${b.key}`) : []
        const key = featureKey(f, depKeys, bodyKeys)
        const cached = this.records.get(f.id)
        const rec = cached && cached.key === key ? cached : this.evaluate(f, key, { done: next, bodies: state })
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

  /** All current bodies that are not hidden in the document. */
  visibleBodies(): BodyRecord[] {
    return [...this.bodies.values()].filter((b) => this.visibility.get(b.name) !== false)
  }

  allBodies(): BodyRecord[] {
    return [...this.bodies.values()]
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

  private evaluate(f: Feature, key: string, ctx: Ctx): FeatureRecord {
    const fail = (message: string): FeatureRecord => ({
      key,
      status: { featureId: f.id, ok: false, message },
      set: [],
      removed: [],
    })
    try {
      for (const dep of dependencies(f)) {
        const d = ctx.done.get(dep)
        if (d && !d.status.ok) return fail(ERR_EARLIER)
      }
      // One case per feature type. A new type: add a handler and a case (and its refs in `refsOf`).
      switch (f.type) {
        case 'sketch':
          return this.evalSketch(f, key)
        case 'extrude':
          return this.evalExtrude(f, key, ctx)
        case 'fillet':
          return this.evalEdgeOp(f, key, ctx)
        case 'chamfer':
          return this.evalEdgeOp(f, key, ctx)
        case 'boolean':
          return this.evalBoolean(f, key, ctx)
        default:
          return fail(ERR_LATER)
      }
    } catch (err) {
      return fail(plainError(err))
    }
  }

  private evalSketch(f: SketchFeature, key: string): FeatureRecord {
    const bad = (message: string): FeatureRecord => ({
      key,
      status: { featureId: f.id, ok: false, message },
      set: [],
      removed: [],
    })
    const on = f.params.on
    if (on.kind !== 'originPlane') return bad('Sketching on faces arrives in a later version.')
    const frame = ORIGIN_PLANES[on.name as OriginPlaneName]
    if (!frame) return bad('This sketch is on a plane that does not exist.')
    const entities = new Map<string, SketchEntity>()
    for (const e of f.sketch.entities) if (!e.construction) entities.set(e.id, e)
    const regions = findRegions(f.id, f.sketch)
    return {
      key,
      status: { featureId: f.id, ok: true },
      sketch: { sketchId: f.id, frame, entities, regions },
      set: [],
      removed: [],
    }
  }

  // ---- extrude (new, union, subtract, intersect) ------------------------------------------------

  private evalExtrude(f: ExtrudeFeature, key: string, ctx: Ctx): FeatureRecord {
    const p = f.params
    const fail = (message: string): FeatureRecord => ({ key, status: { featureId: f.id, ok: false, message }, set: [], removed: [] })
    const distance = Number(p.distance)
    if (!Number.isFinite(distance) || distance <= 0) return fail('Enter a distance greater than 0.')
    if (p.profiles.length === 0) return fail('Pick a shape to extrude.')

    const regions: Region[] = []
    let sketch: SketchRecord | undefined
    for (const ref of p.profiles) {
      const sketchId = ref.name.split('/region:')[0]
      const sk = ctx.done.get(sketchId)?.sketch
      if (!sk) return fail(ERR_GONE)
      if (sketch && sketch !== sk) return fail('Pick shapes from one sketch at a time.')
      sketch = sk
      const region = sk.regions.find((r) => r.name === ref.name)
      if (!region) return fail(ERR_GONE)
      regions.push(region)
    }
    if (!sketch) return fail(ERR_GONE)

    // targets first: no point building a solid when the thing to join to is missing
    let targets: BodyRecord[] = []
    if (p.mode !== 'new') {
      if (p.targets.length === 0) return fail(PICK_TARGET[p.mode])
      targets = []
      for (const ref of p.targets) {
        const t = resolveBodyRef(ref, ctx.bodies)
        if (!t) return fail(ERR_BODY_GONE)
        if (!targets.includes(t)) targets.push(t)
      }
    }

    const tool = buildExtrusion({
      extrudeId: f.id,
      regions,
      entities: sketch.entities,
      frame: sketch.frame,
      distance,
      direction: p.direction,
    })
    if (p.mode === 'new') {
      return { key, status: { featureId: f.id, ok: true }, set: [{ name: f.id, key, built: tool }], removed: [] }
    }
    try {
      const mode: BoolOp = p.mode
      const set: BodyRecord[] = []
      let removed: string[] = []
      if (mode === 'union') {
        // The tool joins the first target; any further targets are merged in and disappear as bodies.
        const [first, ...rest] = targets
        let acc = combine(f.id, 'union', first.built, tool)
        try {
          for (const t of rest) {
            const merged = combine(f.id, 'union', acc, t.built)
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
          for (const t of targets) set.push({ name: t.name, key, built: combine(f.id, mode, t.built, tool) })
        } catch (err) {
          for (const b of set) discard(b.built)
          throw err
        }
      }
      return { key, status: { featureId: f.id, ok: true }, set, removed }
    } finally {
      discard(tool) // the tool body is never kept: its faces live on in the result under their names
    }
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
        const next = combine(f.id, p.op, acc, t.built)
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
}

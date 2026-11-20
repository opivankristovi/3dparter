// Replays the document's feature list with replicad / OpenCascade.
// Runs in a worker in the browser and directly in Node for tests. Never throws: every problem
// becomes a per-feature status with a message written for the user.
import {
  ORIGIN_PLANES,
  type ExtrudeFeature,
  type Feature,
  type OriginPlaneName,
  type PlaneFrame,
  type ProjectDocument,
  type SketchEntity,
  type SketchFeature,
} from '../doc/types'
import type { FeatureStatus, RegenResult } from './api'
import { buildExtrusion, safeDelete, type BuiltBody } from './build'
import { findRegions, type Region } from './regions'

export interface SketchRecord {
  sketchId: string
  frame: PlaneFrame
  entities: Map<string, SketchEntity>
  regions: Region[]
}

export interface BodyRecord {
  name: string
  /** Cache key of the feature that made it. A different key means different geometry. */
  key: string
  built: BuiltBody
}

interface FeatureRecord {
  key: string
  status: FeatureStatus
  sketch?: SketchRecord
  bodies: BodyRecord[]
}

const ERR_EARLIER = 'An earlier step failed.'
const ERR_GONE = 'The shape this extrusion used is gone. Pick a new profile.'

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

/** Feature ids a feature reads from, taken from the names of the refs it holds. */
function dependencies(f: Feature): string[] {
  const names: string[] = []
  if (f.type === 'extrude') {
    for (const r of f.params.profiles) names.push(r.name)
    for (const r of f.params.targets) names.push(r.name)
  }
  const ids = new Set<string>()
  for (const n of names) {
    for (const part of n.split('|')) {
      const id = part.split('/')[0]
      if (id) ids.add(id)
    }
  }
  return [...ids]
}

function featureKey(f: Feature, depKeys: string[]): string {
  // Names and the suppressed flag do not change geometry, so they stay out of the key.
  return hash(canonical({ ...f, name: undefined, suppressed: undefined }) + '|' + depKeys.join(','))
}

// ---- errors ------------------------------------------------------------------------------------

function plainError(err: unknown): string {
  if (err instanceof Error && err.message) {
    // Messages we raise ourselves are already plain; OpenCascade's are not, so keep them generic.
    if (/^[A-Z][^\n]{0,140}\.$/.test(err.message)) return err.message
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
    const nextBodies = new Map<string, BodyRecord>()
    try {
      const last = doc.rollbackIndex === null ? doc.features.length - 1 : Math.min(doc.rollbackIndex, doc.features.length - 1)
      for (let i = 0; i <= last; i++) {
        const f = doc.features[i]
        if (f.suppressed) continue
        const depKeys = dependencies(f).map((d) => next.get(d)?.key ?? 'missing')
        const key = featureKey(f, depKeys)
        const cached = this.records.get(f.id)
        let rec: FeatureRecord
        if (cached && cached.key === key) {
          rec = cached
        } else {
          rec = this.evaluate(f, key, next)
        }
        next.set(f.id, rec)
        statuses.push(rec.status)
        if (rec.status.ok) for (const b of rec.bodies) nextBodies.set(b.name, b)
      }
    } catch (err) {
      // Safety net: report the failure on a status instead of throwing out of the worker.
      statuses.push({ featureId: '', ok: false, message: plainError(err) })
    }

    // Free the OpenCascade shapes of every record that was replaced or dropped.
    for (const [id, old] of this.records) {
      if (next.get(id) !== old) for (const b of old.bodies) safeDelete(b.built.shape)
    }

    const changed = new Set<string>()
    for (const [name, b] of nextBodies) if (this.bodies.get(name)?.key !== b.key) changed.add(name)
    for (const name of this.bodies.keys()) if (!nextBodies.has(name)) changed.add(name)

    this.records = next
    this.bodies = nextBodies
    this.visibility = new Map(Object.entries(doc.bodies ?? {}).map(([k, v]) => [k, v.visible]))

    return {
      generation,
      statuses,
      bodies: [...nextBodies.keys()],
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
    for (const rec of this.records.values()) for (const b of rec.bodies) safeDelete(b.built.shape)
    this.records.clear()
    this.bodies.clear()
    this.visibility.clear()
  }

  // ---- one feature -----------------------------------------------------------------------------

  private evaluate(f: Feature, key: string, done: Map<string, FeatureRecord>): FeatureRecord {
    const fail = (message: string): FeatureRecord => ({
      key,
      status: { featureId: f.id, ok: false, message },
      bodies: [],
    })
    try {
      for (const dep of dependencies(f)) {
        const d = done.get(dep)
        if (d && !d.status.ok) return fail(ERR_EARLIER)
      }
      if (f.type === 'sketch') return this.evalSketch(f, key)
      if (f.type === 'extrude') return this.evalExtrude(f, key, done)
      return fail('This kind of step arrives in a later version.')
    } catch (err) {
      return fail(plainError(err))
    }
  }

  private evalSketch(f: SketchFeature, key: string): FeatureRecord {
    const on = f.params.on
    if (on.kind !== 'originPlane') {
      return {
        key,
        status: { featureId: f.id, ok: false, message: 'Sketching on faces arrives in a later version.' },
        bodies: [],
      }
    }
    const frame = ORIGIN_PLANES[on.name as OriginPlaneName]
    if (!frame) {
      return { key, status: { featureId: f.id, ok: false, message: 'This sketch is on a plane that does not exist.' }, bodies: [] }
    }
    const entities = new Map<string, SketchEntity>()
    for (const e of f.sketch.entities) if (!e.construction) entities.set(e.id, e)
    const regions = findRegions(f.id, f.sketch)
    return { key, status: { featureId: f.id, ok: true }, sketch: { sketchId: f.id, frame, entities, regions }, bodies: [] }
  }

  private evalExtrude(f: ExtrudeFeature, key: string, done: Map<string, FeatureRecord>): FeatureRecord {
    const fail = (message: string): FeatureRecord => ({ key, status: { featureId: f.id, ok: false, message }, bodies: [] })
    const p = f.params
    if (p.mode !== 'new') return fail('Join, Cut and Intersect arrive in a later version.')
    const distance = Number(p.distance)
    if (!Number.isFinite(distance) || distance <= 0) return fail('Enter a distance greater than 0.')
    if (p.profiles.length === 0) return fail('Pick a shape to extrude.')

    const regions: Region[] = []
    let sketch: SketchRecord | undefined
    for (const ref of p.profiles) {
      const sketchId = ref.name.split('/region:')[0]
      const rec = done.get(sketchId)
      const sk = rec?.sketch
      if (!sk) return fail(ERR_GONE)
      if (sketch && sketch !== sk) return fail('Pick shapes from one sketch at a time.')
      sketch = sk
      const region = sk.regions.find((r) => r.name === ref.name)
      if (!region) return fail(ERR_GONE)
      regions.push(region)
    }
    if (!sketch) return fail(ERR_GONE)

    const built = buildExtrusion({
      extrudeId: f.id,
      regions,
      entities: sketch.entities,
      frame: sketch.frame,
      distance,
      direction: p.direction,
    })
    return { key, status: { featureId: f.id, ok: true }, bodies: [{ name: f.id, key, built }] }
  }
}

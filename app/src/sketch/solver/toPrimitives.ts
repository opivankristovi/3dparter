// Sketch -> planegcs primitives. Pure: no wasm is touched here, so it is unit-testable on its own.
//
// Naming of planegcs ids (all strings, pushed in dependency order: points, curves, rules, constraints):
//   point   the ref itself        "<entityId>.<slot>", "origin", "xAxis.1", "yAxis.1"
//   curve   the entity id         line / circle / arc;  "xAxis" and "yAxis" for the fixed axes
//   rules   "<entityId>#rules"    arc_rules of an arc
//   constraint "k:<constraintId>" (+ "#<n>" when one constraint becomes several planegcs ones)
import type { Constraint, SketchPrimitive } from '@salusoft89/planegcs'
import type { Sketch, SketchConstraint, SketchEntity, Vec2 } from '../../doc/types'
import { isDimensional } from './constraints'
import { getPoint, parseRef, pointSlots } from './refs'
import type { PointSlot } from './refs'
import { evalValue } from './value'

const DEG = Math.PI / 180

export interface DragSpec {
  /** A point ref (that point is pulled to `to`) or a whole entity id (translated by `to - grab`). */
  ref: string
  to: Vec2
  /** Where the drag started, in sketch coordinates. Needed for entity drags. */
  grab?: Vec2
}

export interface BuildOptions {
  drag?: DragSpec
  /** Entities whose independent parameters are all fixed (used to test whether they are fully defined). */
  fixedEntities?: ReadonlySet<string>
}

/** A planegcs parameter pinned after the primitives are pushed (arc angles, radii). */
export interface ParamFix {
  /** Id of the curve primitive that owns the parameter. */
  prim: string
  /** Offset inside the primitive's parameters (planegcs property_offsets). */
  offset: number
  value: number
}

export interface BuiltSystem {
  primitives: SketchPrimitive[]
  fixes: ParamFix[]
  /** planegcs constraint id -> SketchConstraint id (dragging constraints and arc rules are absent). */
  constraintOf: Map<string, string>
  /** Constraints that could not be built (missing entity, wrong refs, bad value) and were left out. */
  invalid: Map<string, string>
}

type Pt = { k: 'pt'; id: string; pos: Vec2; entityId: string | null; slot: PointSlot | null }
type Ln = { k: 'line'; id: string; a: string; b: string }
type Ci = { k: 'circle'; id: string; center: string }
type Ar = { k: 'arc'; id: string; center: string }
type Res = Pt | Ln | Ci | Ar

/** Offsets inside a curve's parameter block (planegcs property_offsets). */
export const PARAM_OFFSET = { circleRadius: 0, arcStart: 0, arcEnd: 1, arcRadius: 2 }

type Maker = (id: string) => Constraint

export function pointId(entityId: string, slot: PointSlot): string {
  return `${entityId}.${slot}`
}

function makeResolver(entities: Map<string, SketchEntity>) {
  return function resolve(ref: string): Res | null {
    const p = parseRef(ref)
    if (!p) return null
    if (p.kind === 'reserved') {
      if (p.name === 'origin') return { k: 'pt', id: 'origin', pos: [0, 0], entityId: null, slot: null }
      return { k: 'line', id: p.name, a: 'origin', b: `${p.name}.1` }
    }
    const e = entities.get(p.entityId)
    if (!e) return null
    if (p.kind === 'point') {
      const pos = getPoint(e, p.slot)
      if (!pos) return null
      return { k: 'pt', id: pointId(e.id, p.slot), pos, entityId: e.id, slot: p.slot }
    }
    if (e.type === 'line') return { k: 'line', id: e.id, a: pointId(e.id, 'a'), b: pointId(e.id, 'b') }
    if (e.type === 'circle') return { k: 'circle', id: e.id, center: pointId(e.id, 'center') }
    return { k: 'arc', id: e.id, center: pointId(e.id, 'center') }
  }
}

/** Direction of travel of a line / CCW arc at one of its ends. */
function tangentDir(e: SketchEntity, slot: PointSlot): Vec2 | null {
  if (e.type === 'line') return [e.b[0] - e.a[0], e.b[1] - e.a[1]]
  if (e.type === 'arc' && (slot === 'start' || slot === 'end')) {
    const t = slot === 'start' ? e.startAngle : e.endAngle
    return [-Math.sin(t), Math.cos(t)]
  }
  return null
}

/** Turns one SketchConstraint into planegcs constraint makers, or explains why it cannot. */
function mapConstraint(
  c: SketchConstraint,
  resolve: (ref: string) => Res | null,
  entities: Map<string, SketchEntity>,
): Maker[] | string {
  const refs = c.entityIds.map(resolve)
  if (refs.some((r) => r === null)) return 'Refers to something that no longer exists'
  const r = refs as Res[]
  const n = r.length
  let value = 0
  if (isDimensional(c.type)) {
    value = evalValue(c.value)
    if (!Number.isFinite(value)) return 'The value is not a number'
  }
  const bad = (): string => `Wrong selection for ${c.type}`
  const pts = r.every((x) => x.k === 'pt')

  switch (c.type) {
    case 'coincident': {
      if (n !== 2 || !pts) return bad()
      const [p1, p2] = r as Pt[]
      return [(id) => ({ id, type: 'p2p_coincident', p1_id: p1.id, p2_id: p2.id })]
    }
    case 'pointOnEntity': {
      if (n !== 2 || r[0].k !== 'pt') return bad()
      const p = r[0]
      const t = r[1]
      if (t.k === 'line') return [(id) => ({ id, type: 'point_on_line_pl', p_id: p.id, l_id: t.id })]
      if (t.k === 'circle') return [(id) => ({ id, type: 'point_on_circle', p_id: p.id, c_id: t.id })]
      if (t.k === 'arc') return [(id) => ({ id, type: 'point_on_arc', p_id: p.id, a_id: t.id })]
      return bad()
    }
    case 'horizontal':
    case 'vertical': {
      const h = c.type === 'horizontal'
      if (n === 1 && r[0].k === 'line') {
        const l = r[0]
        return [(id) => ({ id, type: h ? 'horizontal_l' : 'vertical_l', l_id: l.id })]
      }
      if (n === 2 && pts) {
        const [p1, p2] = r as Pt[]
        return [(id) => ({ id, type: h ? 'horizontal_pp' : 'vertical_pp', p1_id: p1.id, p2_id: p2.id })]
      }
      return bad()
    }
    case 'parallel':
    case 'perpendicular': {
      if (n !== 2 || r[0].k !== 'line' || r[1].k !== 'line') return bad()
      const [l1, l2] = [r[0], r[1]]
      const par = c.type === 'parallel'
      return [(id) => ({ id, type: par ? 'parallel' : 'perpendicular_ll', l1_id: l1.id, l2_id: l2.id })]
    }
    case 'tangent': {
      if (n !== 2) return bad()
      const [x, y] = r
      if (x.k === 'pt' && y.k === 'pt') return mapEndpointTangent(x, y, entities, bad())
      const kinds = [x.k, y.k].sort().join('+')
      const line = x.k === 'line' ? x : y.k === 'line' ? y : null
      const arc = x.k === 'arc' ? x : y.k === 'arc' ? y : null
      const circ = x.k === 'circle' ? x : y.k === 'circle' ? y : null
      if (kinds === 'circle+line' && line && circ) return [(id) => ({ id, type: 'tangent_lc', l_id: line.id, c_id: circ.id })]
      if (kinds === 'arc+line' && line && arc) return [(id) => ({ id, type: 'tangent_la', l_id: line.id, a_id: arc.id })]
      if (kinds === 'circle+circle') return [(id) => ({ id, type: 'tangent_cc', c1_id: x.id, c2_id: y.id })]
      if (kinds === 'arc+circle' && arc && circ) return [(id) => ({ id, type: 'tangent_ca', c_id: circ.id, a_id: arc.id })]
      if (kinds === 'arc+arc') return [(id) => ({ id, type: 'tangent_aa', a1_id: x.id, a2_id: y.id })]
      return bad()
    }
    case 'equal': {
      if (n !== 2) return bad()
      const [x, y] = r
      const kinds = [x.k, y.k].sort().join('+')
      const arc = x.k === 'arc' ? x : y.k === 'arc' ? y : null
      const circ = x.k === 'circle' ? x : y.k === 'circle' ? y : null
      if (kinds === 'line+line') return [(id) => ({ id, type: 'equal_length', l1_id: x.id, l2_id: y.id })]
      if (kinds === 'circle+circle') return [(id) => ({ id, type: 'equal_radius_cc', c1_id: x.id, c2_id: y.id })]
      if (kinds === 'arc+circle' && arc && circ) return [(id) => ({ id, type: 'equal_radius_ca', c1_id: circ.id, a2_id: arc.id })]
      if (kinds === 'arc+arc') return [(id) => ({ id, type: 'equal_radius_aa', a1_id: x.id, a2_id: y.id })]
      return bad()
    }
    case 'midpoint': {
      if (n !== 2 || r[0].k !== 'pt' || r[1].k !== 'line') return bad()
      const [p, l] = [r[0], r[1]]
      // On the line AND on its perpendicular bisector = the midpoint.
      return [
        (id) => ({ id, type: 'point_on_line_pl', p_id: p.id, l_id: l.id }),
        (id) => ({ id, type: 'point_on_perp_bisector_pl', p_id: p.id, l_id: l.id }),
      ]
    }
    case 'concentric': {
      if (n !== 2 || !r.every((x) => x.k === 'circle' || x.k === 'arc')) return bad()
      const [x, y] = r as (Ci | Ar)[]
      return [(id) => ({ id, type: 'p2p_coincident', p1_id: x.center, p2_id: y.center })]
    }
    case 'symmetric': {
      if (n !== 3 || r[0].k !== 'pt' || r[1].k !== 'pt') return bad()
      const [p1, p2, t] = [r[0], r[1], r[2]]
      if (t.k === 'line') return [(id) => ({ id, type: 'p2p_symmetric_ppl', p1_id: p1.id, p2_id: p2.id, l_id: t.id })]
      if (t.k === 'pt') return [(id) => ({ id, type: 'p2p_symmetric_ppp', p1_id: p1.id, p2_id: p2.id, p_id: t.id })]
      return bad()
    }
    case 'fix':
      return [] // handled by the point / parameter fixing in buildSystem
    case 'distance': {
      if (n !== 2 || !pts) return bad()
      const [p1, p2] = r as Pt[]
      return [(id) => ({ id, type: 'p2p_distance', p1_id: p1.id, p2_id: p2.id, distance: value })]
    }
    case 'length': {
      if (n !== 1 || r[0].k !== 'line') return bad()
      const l = r[0]
      return [(id) => ({ id, type: 'p2p_distance', p1_id: l.a, p2_id: l.b, distance: value })]
    }
    case 'horizontalDistance':
    case 'verticalDistance': {
      if (n !== 2 || !pts) return bad()
      const [p1, p2] = r as Pt[]
      const prop = c.type === 'horizontalDistance' ? 'x' : 'y'
      return [
        (id) => ({
          id,
          type: 'difference',
          param1: { o_id: p1.id, prop },
          param2: { o_id: p2.id, prop },
          difference: value,
        }),
      ]
    }
    case 'pointLineDistance': {
      if (n !== 2 || r[0].k !== 'pt' || r[1].k !== 'line') return bad()
      const [p, l] = [r[0], r[1]]
      return [(id) => ({ id, type: 'p2l_distance', p_id: p.id, l_id: l.id, distance: value })]
    }
    case 'radius':
    case 'diameter': {
      if (n !== 1 || (r[0].k !== 'circle' && r[0].k !== 'arc')) return bad()
      const t = r[0]
      const rad = c.type === 'radius'
      if (t.k === 'circle') {
        return [
          (id) =>
            rad
              ? { id, type: 'circle_radius', c_id: t.id, radius: value }
              : { id, type: 'circle_diameter', c_id: t.id, diameter: value },
        ]
      }
      return [
        (id) =>
          rad
            ? { id, type: 'arc_radius', a_id: t.id, radius: value }
            : { id, type: 'arc_diameter', a_id: t.id, diameter: value },
      ]
    }
    case 'angle': {
      if (n !== 2 || r[0].k !== 'line' || r[1].k !== 'line') return bad()
      const [l1, l2] = [r[0], r[1]]
      return [(id) => ({ id, type: 'l2l_angle_ll', l1_id: l1.id, l2_id: l2.id, angle: value * DEG })]
    }
  }
}

/** Two ends meeting tangentially: coincident, plus the curves' angle at that point is 0 or 180 degrees. */
function mapEndpointTangent(x: Pt, y: Pt, entities: Map<string, SketchEntity>, fail: string): Maker[] | string {
  if (!x.entityId || !y.entityId || !x.slot || !y.slot || x.entityId === y.entityId) return fail
  const e1 = entities.get(x.entityId)
  const e2 = entities.get(y.entityId)
  if (!e1 || !e2) return fail
  const d1 = tangentDir(e1, x.slot)
  const d2 = tangentDir(e2, y.slot)
  if (!d1 || !d2) return fail
  const theta = Math.atan2(d1[0] * d2[1] - d1[1] * d2[0], d1[0] * d2[0] + d1[1] * d2[1])
  const angle = Math.abs(theta) > Math.PI / 2 ? Math.PI : 0
  return [
    (id) => ({ id, type: 'p2p_coincident', p1_id: x.id, p2_id: y.id }),
    (id) => ({ id, type: 'angle_via_point', crv1_id: e1.id, crv2_id: e2.id, p_id: x.id, angle }),
  ]
}

export function buildSystem(sketch: Sketch, opts: BuildOptions = {}): BuiltSystem {
  const entities = new Map(sketch.entities.map((e) => [e.id, e]))
  const resolve = makeResolver(entities)
  const primitives: SketchPrimitive[] = []
  const fixes: ParamFix[] = []
  const constraintOf = new Map<string, string>()
  const invalid = new Map<string, string>()

  // What is pinned: points by ref, entities as a whole.
  const fixedPoints = new Set<string>()
  const fixedEntities = new Set<string>(opts.fixedEntities ?? [])
  for (const c of sketch.constraints) {
    if (c.type !== 'fix' || !c.driving) continue
    if (c.entityIds.length !== 1) {
      invalid.set(c.id, 'Wrong selection for fix')
      continue
    }
    const p = parseRef(c.entityIds[0])
    if (!p || (p.kind !== 'reserved' && !entities.has(p.entityId))) {
      invalid.set(c.id, 'Refers to something that no longer exists')
    } else if (p.kind === 'point') fixedPoints.add(c.entityIds[0])
    else if (p.kind === 'entity') fixedEntities.add(p.entityId)
  }

  // Points
  primitives.push({ id: 'origin', type: 'point', x: 0, y: 0, fixed: true })
  primitives.push({ id: 'xAxis.1', type: 'point', x: 1, y: 0, fixed: true })
  primitives.push({ id: 'yAxis.1', type: 'point', x: 0, y: 1, fixed: true })
  for (const e of sketch.entities) {
    for (const slot of pointSlots(e)) {
      const pos = getPoint(e, slot) as Vec2
      // A fixed arc keeps its centre, radius and angles pinned; its end points follow from those.
      const entityPins = fixedEntities.has(e.id) && (e.type !== 'arc' || slot === 'center')
      primitives.push({
        id: pointId(e.id, slot),
        type: 'point',
        x: pos[0],
        y: pos[1],
        fixed: entityPins || fixedPoints.has(pointId(e.id, slot)),
      })
    }
  }

  // Curves
  primitives.push({ id: 'xAxis', type: 'line', p1_id: 'origin', p2_id: 'xAxis.1' })
  primitives.push({ id: 'yAxis', type: 'line', p1_id: 'origin', p2_id: 'yAxis.1' })
  for (const e of sketch.entities) {
    if (e.type === 'line') {
      primitives.push({ id: e.id, type: 'line', p1_id: pointId(e.id, 'a'), p2_id: pointId(e.id, 'b') })
    } else if (e.type === 'circle') {
      primitives.push({ id: e.id, type: 'circle', c_id: pointId(e.id, 'center'), radius: e.radius })
      if (fixedEntities.has(e.id)) fixes.push({ prim: e.id, offset: PARAM_OFFSET.circleRadius, value: e.radius })
    } else {
      primitives.push({
        id: e.id,
        type: 'arc',
        c_id: pointId(e.id, 'center'),
        radius: e.radius,
        start_angle: e.startAngle,
        end_angle: e.endAngle,
        start_id: pointId(e.id, 'start'),
        end_id: pointId(e.id, 'end'),
      })
      primitives.push({ id: `${e.id}#rules`, type: 'arc_rules', a_id: e.id })
      if (fixedEntities.has(e.id)) {
        fixes.push({ prim: e.id, offset: PARAM_OFFSET.arcStart, value: e.startAngle })
        fixes.push({ prim: e.id, offset: PARAM_OFFSET.arcEnd, value: e.endAngle })
        fixes.push({ prim: e.id, offset: PARAM_OFFSET.arcRadius, value: e.radius })
      }
    }
  }

  // Constraints
  for (const c of sketch.constraints) {
    if (!c.driving || c.type === 'fix') continue
    const made = mapConstraint(c, resolve, entities)
    if (typeof made === 'string') {
      invalid.set(c.id, made)
      continue
    }
    made.forEach((mk, i) => {
      const id = made.length > 1 ? `k:${c.id}#${i + 1}` : `k:${c.id}`
      constraintOf.set(id, c.id)
      primitives.push(mk(id))
    })
  }

  // Dragging: temporary constraints are only honoured as far as the real ones allow.
  if (opts.drag) {
    const { ref, to, grab } = opts.drag
    const p = parseRef(ref)
    const pull = (pid: string, target: Vec2) => {
      primitives.push({ id: `drag:${pid}:x`, type: 'coordinate_x', p_id: pid, x: target[0], temporary: true })
      primitives.push({ id: `drag:${pid}:y`, type: 'coordinate_y', p_id: pid, y: target[1], temporary: true })
    }
    if (p?.kind === 'point') {
      const e = entities.get(p.entityId)
      if (e && getPoint(e, p.slot)) pull(pointId(e.id, p.slot), to)
    } else if (p?.kind === 'entity') {
      const e = entities.get(p.entityId)
      if (e) {
        const dx = grab ? to[0] - grab[0] : 0
        const dy = grab ? to[1] - grab[1] : 0
        for (const slot of pointSlots(e)) {
          const at = getPoint(e, slot) as Vec2
          pull(pointId(e.id, slot), [at[0] + dx, at[1] + dy])
        }
      }
    }
  }

  return { primitives, fixes, constraintOf, invalid }
}

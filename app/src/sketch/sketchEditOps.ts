// Sketch modification operations (M5): trim, corner fillet, sketch mirror, and sketch pattern.
import { newId } from '../doc/commands'
import { useProjectStore } from '../doc/store'
import type { ArcEntity, LineEntity, SketchEntity, Vec2 } from '../doc/types'
import { arcThroughPoints } from './arc'
import { addSketchEntities, deleteSketchEntities } from './commands'
import { getPoint, parseRef, refEntityId } from './solver/refs'

const EPS = 1e-6
const TWO_PI = Math.PI * 2

const normAngle = (a: number) => ((a % TWO_PI) + TWO_PI) % TWO_PI

function angleOnArc(a: number, arc: ArcEntity): boolean {
  const sweep = normAngle(arc.endAngle - arc.startAngle) || TWO_PI
  const rel = normAngle(a - arc.startAngle)
  return rel <= sweep + 1e-4 || rel >= TWO_PI - 1e-4
}

function lineLineParam(a1: Vec2, b1: Vec2, a2: Vec2, b2: Vec2): number | null {
  const d1x = b1[0] - a1[0]
  const d1y = b1[1] - a1[1]
  const d2x = b2[0] - a2[0]
  const d2y = b2[1] - a2[1]
  const denom = d1x * d2y - d1y * d2x
  if (Math.abs(denom) < EPS) return null
  const dx = a2[0] - a1[0]
  const dy = a2[1] - a1[1]
  const t = (dx * d2y - dy * d2x) / denom
  const u = (dx * d1y - dy * d1x) / denom
  if (u < -1e-4 || u > 1 + 1e-4) return null
  return t
}

function lineCircleParams(a: Vec2, b: Vec2, center: Vec2, radius: number, arc?: ArcEntity): number[] {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const fx = a[0] - center[0]
  const fy = a[1] - center[1]
  const A = dx * dx + dy * dy
  if (A < EPS) return []
  const B = 2 * (fx * dx + fy * dy)
  const C = fx * fx + fy * fy - radius * radius
  const disc = B * B - 4 * A * C
  if (disc < -1e-6) return []
  const sq = Math.sqrt(Math.max(0, disc))
  const ts = sq < 1e-7 ? [-B / (2 * A)] : [(-B - sq) / (2 * A), (-B + sq) / (2 * A)]
  if (!arc) return ts
  return ts.filter((t) => {
    const px = a[0] + t * dx
    const py = a[1] + t * dy
    return angleOnArc(Math.atan2(py - center[1], px - center[0]), arc)
  })
}

function circleCirclePoints(c1: Vec2, r1: number, c2: Vec2, r2: number): Vec2[] {
  const dx = c2[0] - c1[0]
  const dy = c2[1] - c1[1]
  const d = Math.hypot(dx, dy)
  if (d < EPS || d > r1 + r2 + 1e-5 || d < Math.abs(r1 - r2) - 1e-5) return []
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d)
  const h2 = Math.max(0, r1 * r1 - a * a)
  const h = Math.sqrt(h2)
  const mx = c1[0] + (a * dx) / d
  const my = c1[1] + (a * dy) / d
  const ox = (-dy * h) / d
  const oy = (dx * h) / d
  if (h < 1e-5) return [[mx, my]]
  return [
    [mx + ox, my + oy],
    [mx - ox, my - oy],
  ]
}

function uniqueSorted(values: number[], minGap = 1e-4): number[] {
  const sorted = [...values].sort((a, b) => a - b)
  const out: number[] = []
  for (const v of sorted) {
    if (out.length === 0 || v - out[out.length - 1] > minGap) out.push(v)
  }
  return out
}

/**
 * Trims `entityId` at intersections with other entities, removing the segment nearest `clickPoint`
 * (or deleting the entire entity if no interior intersections exist).
 */
export function trimSketchEntity(sketchId: string, entityId: string, clickPoint?: Vec2): boolean {
  const f = useProjectStore.getState().doc.features.find((x) => x.id === sketchId)
  if (f?.type !== 'sketch') return false
  const target = f.sketch.entities.find((e) => e.id === entityId)
  if (!target) return false
  const others = f.sketch.entities.filter((e) => e.id !== entityId)

  if (target.type === 'line') {
    const raw: number[] = []
    for (const o of others) {
      if (o.type === 'line') {
        const t = lineLineParam(target.a, target.b, o.a, o.b)
        if (t !== null && t > 1e-4 && t < 1 - 1e-4) raw.push(t)
      } else {
        for (const t of lineCircleParams(target.a, target.b, o.center, o.radius, o.type === 'arc' ? o : undefined)) {
          if (t > 1e-4 && t < 1 - 1e-4) raw.push(t)
        }
      }
    }
    const ts = uniqueSorted(raw)
    if (ts.length === 0) {
      deleteSketchEntities(sketchId, [entityId])
      return true
    }
    const cuts = [0, ...ts, 1]
    const pt = (t: number): Vec2 => [target.a[0] + (target.b[0] - target.a[0]) * t, target.a[1] + (target.b[1] - target.a[1]) * t]
    const ref = clickPoint ?? pt(0.5)
    let drop = 0
    let bestD = Infinity
    for (let i = 0; i < cuts.length - 1; i++) {
      const mid = pt((cuts[i] + cuts[i + 1]) / 2)
      const d = Math.hypot(mid[0] - ref[0], mid[1] - ref[1])
      if (d < bestD) {
        bestD = d
        drop = i
      }
    }
    const replacement: LineEntity[] = []
    for (let i = 0; i < cuts.length - 1; i++) {
      if (i === drop) continue
      replacement.push({
        id: newId(),
        type: 'line',
        construction: target.construction,
        a: pt(cuts[i]),
        b: pt(cuts[i + 1]),
      })
    }
    useProjectStore.getState().apply('Trim sketch', (draft) => {
      const sf = draft.features.find((x) => x.id === sketchId)
      if (sf?.type !== 'sketch') return
      const idx = sf.sketch.entities.findIndex((e) => e.id === entityId)
      if (idx < 0) return
      sf.sketch.entities.splice(idx, 1, ...replacement)
      sf.sketch.constraints = sf.sketch.constraints.filter((c) => !c.entityIds.some((r) => refEntityId(r) === entityId))
    })
    return true
  }

  // Circle or arc: collect crossing points along the curve.
  const pts: Vec2[] = []
  for (const o of others) {
    if (o.type === 'line') {
      for (const t of lineCircleParams(o.a, o.b, target.center, target.radius, target.type === 'arc' ? target : undefined)) {
        if (t >= -1e-4 && t <= 1 + 1e-4) {
          pts.push([o.a[0] + (o.b[0] - o.a[0]) * t, o.a[1] + (o.b[1] - o.a[1]) * t])
        }
      }
    } else {
      for (const p of circleCirclePoints(target.center, target.radius, o.center, o.radius)) {
        if (o.type === 'arc' && !angleOnArc(Math.atan2(p[1] - o.center[1], p[0] - o.center[0]), o)) continue
        if (target.type === 'arc' && !angleOnArc(Math.atan2(p[1] - target.center[1], p[0] - target.center[0]), target)) continue
        pts.push(p)
      }
    }
  }

  if (target.type === 'circle') {
    const angles = uniqueSorted(pts.map((p) => normAngle(Math.atan2(p[1] - target.center[1], p[0] - target.center[0]))))
    if (angles.length < 2) {
      deleteSketchEntities(sketchId, [entityId])
      return true
    }
    const refAngle = clickPoint
      ? normAngle(Math.atan2(clickPoint[1] - target.center[1], clickPoint[0] - target.center[0]))
      : normAngle((angles[0] + angles[1]) / 2)
    let drop = 0
    for (let i = 0; i < angles.length; i++) {
      const start = angles[i]
      const end = i + 1 < angles.length ? angles[i + 1] : angles[0] + TWO_PI
      const span = end - start
      const rel = normAngle(refAngle - start)
      if (rel <= span) {
        drop = i
        break
      }
    }
    const replacement: ArcEntity[] = []
    for (let i = 0; i < angles.length; i++) {
      if (i === drop) continue
      const start = angles[i]
      const end = i + 1 < angles.length ? angles[i + 1] : angles[0]
      replacement.push({
        id: newId(),
        type: 'arc',
        construction: target.construction,
        center: [...target.center],
        radius: target.radius,
        startAngle: start,
        endAngle: end,
      })
    }
    useProjectStore.getState().apply('Trim sketch', (draft) => {
      const sf = draft.features.find((x) => x.id === sketchId)
      if (sf?.type !== 'sketch') return
      const idx = sf.sketch.entities.findIndex((e) => e.id === entityId)
      if (idx < 0) return
      sf.sketch.entities.splice(idx, 1, ...replacement)
      sf.sketch.constraints = sf.sketch.constraints.filter((c) => !c.entityIds.some((r) => refEntityId(r) === entityId))
    })
    return true
  }

  // Arc target
  const sweep = normAngle(target.endAngle - target.startAngle) || TWO_PI
  const rels = uniqueSorted(
    pts
      .map((p) => normAngle(Math.atan2(p[1] - target.center[1], p[0] - target.center[0]) - target.startAngle))
      .filter((a) => a > 1e-4 && a < sweep - 1e-4),
  )
  if (rels.length === 0) {
    deleteSketchEntities(sketchId, [entityId])
    return true
  }
  const cuts = [0, ...rels, sweep]
  const ref = clickPoint ?? [
    target.center[0] + target.radius * Math.cos(target.startAngle + sweep / 2),
    target.center[1] + target.radius * Math.sin(target.startAngle + sweep / 2),
  ]
  let drop = 0
  let bestD = Infinity
  for (let i = 0; i < cuts.length - 1; i++) {
    const midA = target.startAngle + (cuts[i] + cuts[i + 1]) / 2
    const mx = target.center[0] + target.radius * Math.cos(midA)
    const my = target.center[1] + target.radius * Math.sin(midA)
    const d = Math.hypot(mx - ref[0], my - ref[1])
    if (d < bestD) {
      bestD = d
      drop = i
    }
  }
  const replacement: ArcEntity[] = []
  for (let i = 0; i < cuts.length - 1; i++) {
    if (i === drop) continue
    replacement.push({
      id: newId(),
      type: 'arc',
      construction: target.construction,
      center: [...target.center],
      radius: target.radius,
      startAngle: target.startAngle + cuts[i],
      endAngle: target.startAngle + cuts[i + 1],
    })
  }
  useProjectStore.getState().apply('Trim sketch', (draft) => {
    const sf = draft.features.find((x) => x.id === sketchId)
    if (sf?.type !== 'sketch') return
    const idx = sf.sketch.entities.findIndex((e) => e.id === entityId)
    if (idx < 0) return
    sf.sketch.entities.splice(idx, 1, ...replacement)
    sf.sketch.constraints = sf.sketch.constraints.filter((c) => !c.entityIds.some((r) => refEntityId(r) === entityId))
  })
  return true
}

/** Rounds the corner where two selected lines (or lines meeting at a selected corner point) meet. */
export function filletSketchCorner(sketchId: string, selectedRefs: string[], radius = 3): boolean {
  const f = useProjectStore.getState().doc.features.find((x) => x.id === sketchId)
  if (f?.type !== 'sketch') return false
  const lines = f.sketch.entities.filter((e): e is LineEntity => e.type === 'line')

  let pair: [LineEntity, LineEntity] | null = null
  const wholeIds = selectedRefs.map(parseRef).filter((p): p is { kind: 'entity'; entityId: string } => p?.kind === 'entity').map((p) => p.entityId)
  if (wholeIds.length === 2) {
    const l1 = lines.find((l) => l.id === wholeIds[0])
    const l2 = lines.find((l) => l.id === wholeIds[1])
    if (l1 && l2) pair = [l1, l2]
  } else if (selectedRefs.length === 1) {
    const p = parseRef(selectedRefs[0])
    if (p?.kind === 'point') {
      const owner = f.sketch.entities.find((e) => e.id === p.entityId)
      const pt = owner ? getPoint(owner, p.slot) : null
      if (pt) {
        const near = lines.filter((l) => Math.hypot(l.a[0] - pt[0], l.a[1] - pt[1]) < 1e-3 || Math.hypot(l.b[0] - pt[0], l.b[1] - pt[1]) < 1e-3)
        if (near.length >= 2) pair = [near[0], near[1]]
      }
    }
  }
  if (!pair) return false

  const [l1, l2] = pair
  const dx1 = l1.b[0] - l1.a[0]
  const dy1 = l1.b[1] - l1.a[1]
  const dx2 = l2.b[0] - l2.a[0]
  const dy2 = l2.b[1] - l2.a[1]
  const denom = dx1 * dy2 - dy1 * dx2
  if (Math.abs(denom) < EPS) return false
  const rx = l2.a[0] - l1.a[0]
  const ry = l2.a[1] - l1.a[1]
  const t1 = (rx * dy2 - ry * dx2) / denom
  const corner: Vec2 = [l1.a[0] + t1 * dx1, l1.a[1] + t1 * dy1]

  const endAway = (l: LineEntity): { slot: 'a' | 'b'; far: Vec2 } => {
    const da = Math.hypot(l.a[0] - corner[0], l.a[1] - corner[1])
    const db = Math.hypot(l.b[0] - corner[0], l.b[1] - corner[1])
    return da <= db ? { slot: 'a', far: l.b } : { slot: 'b', far: l.a }
  }
  const e1 = endAway(l1)
  const e2 = endAway(l2)
  const v1: Vec2 = [e1.far[0] - corner[0], e1.far[1] - corner[1]]
  const v2: Vec2 = [e2.far[0] - corner[0], e2.far[1] - corner[1]]
  const len1 = Math.hypot(v1[0], v1[1])
  const len2 = Math.hypot(v2[0], v2[1])
  if (len1 < 1e-4 || len2 < 1e-4) return false

  const u1: Vec2 = [v1[0] / len1, v1[1] / len1]
  const u2: Vec2 = [v2[0] / len2, v2[1] / len2]
  const dot = Math.max(-1, Math.min(1, u1[0] * u2[0] + u1[1] * u2[1]))
  const half = Math.acos(dot) / 2
  const tanHalf = Math.tan(half)
  const sinHalf = Math.sin(half)
  if (tanHalf < 1e-4 || sinHalf < 1e-4) return false

  let r = Math.max(0.1, radius)
  const maxD = Math.min(len1, len2) * 0.85
  if (r / tanHalf > maxD) r = maxD * tanHalf
  const dist = r / tanHalf
  const tPt1: Vec2 = [corner[0] + u1[0] * dist, corner[1] + u1[1] * dist]
  const tPt2: Vec2 = [corner[0] + u2[0] * dist, corner[1] + u2[1] * dist]

  const bx = u1[0] + u2[0]
  const by = u1[1] + u2[1]
  const blen = Math.hypot(bx, by)
  if (blen < EPS) return false
  const cDist = r / sinHalf
  const center: Vec2 = [corner[0] + (bx / blen) * cDist, corner[1] + (by / blen) * cDist]
  const a1 = normAngle(Math.atan2(tPt1[1] - center[1], tPt1[0] - center[0]))
  const a2 = normAngle(Math.atan2(tPt2[1] - center[1], tPt2[0] - center[0]))
  const ccw12 = normAngle(a2 - a1)
  const arc: ArcEntity = {
    id: newId(),
    type: 'arc',
    construction: false,
    center,
    radius: r,
    startAngle: ccw12 <= Math.PI ? a1 : a2,
    endAngle: ccw12 <= Math.PI ? a2 : a1,
  }
  const slot1Ref = ccw12 <= Math.PI ? 'start' : 'end'
  const slot2Ref = ccw12 <= Math.PI ? 'end' : 'start'

  useProjectStore.getState().apply('Fillet sketch corner', (draft) => {
    const sf = draft.features.find((x) => x.id === sketchId)
    if (sf?.type !== 'sketch') return
    const dl1 = sf.sketch.entities.find((x) => x.id === l1.id)
    const dl2 = sf.sketch.entities.find((x) => x.id === l2.id)
    if (dl1?.type !== 'line' || dl2?.type !== 'line') return
    dl1[e1.slot] = tPt1
    dl2[e2.slot] = tPt2
    sf.sketch.entities.push(arc)
    // Remove old corner coincident/length constraints that locked the trimmed lines, and join the new arc endpoints.
    const oldRefs = new Set([`${l1.id}.${e1.slot}`, `${l2.id}.${e2.slot}`])
    sf.sketch.constraints = sf.sketch.constraints.filter((c) => !(c.type === 'coincident' && c.entityIds.some((id) => oldRefs.has(id))))
    sf.sketch.constraints.push(
      { id: newId(), type: 'coincident', entityIds: [`${l1.id}.${e1.slot}`, `${arc.id}.${slot1Ref}`], driving: true },
      { id: newId(), type: 'coincident', entityIds: [`${l2.id}.${e2.slot}`, `${arc.id}.${slot2Ref}`], driving: true },
    )
  })
  return true
}

function reflectPoint(p: Vec2, a: Vec2, b: Vec2): Vec2 {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const len2 = dx * dx + dy * dy
  if (len2 < EPS) return [...p]
  const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2
  const fx = a[0] + t * dx
  const fy = a[1] + t * dy
  return [2 * fx - p[0], 2 * fy - p[1]]
}

/** Mirrors selected sketch entities across the selected mirror axis line (prefers construction lines). */
export function mirrorSketchSelection(sketchId: string, selectedEntityIds: string[]): boolean {
  const f = useProjectStore.getState().doc.features.find((x) => x.id === sketchId)
  if (f?.type !== 'sketch') return false
  const selected = f.sketch.entities.filter((e) => selectedEntityIds.includes(e.id))
  if (selected.length < 2) return false
  const axis =
    selected.find((e): e is LineEntity => e.type === 'line' && e.construction) ??
    [...selected].reverse().find((e): e is LineEntity => e.type === 'line')
  if (!axis) return false

  const created: SketchEntity[] = []
  for (const e of selected) {
    if (e.id === axis.id) continue
    if (e.type === 'line') {
      created.push({
        id: newId(),
        type: 'line',
        construction: e.construction,
        a: reflectPoint(e.a, axis.a, axis.b),
        b: reflectPoint(e.b, axis.a, axis.b),
      })
    } else if (e.type === 'circle') {
      created.push({
        id: newId(),
        type: 'circle',
        construction: e.construction,
        center: reflectPoint(e.center, axis.a, axis.b),
        radius: e.radius,
      })
    } else {
      const sweep = normAngle(e.endAngle - e.startAngle) || TWO_PI
      const pt = (ang: number): Vec2 => [e.center[0] + e.radius * Math.cos(ang), e.center[1] + e.radius * Math.sin(ang)]
      const ra = reflectPoint(pt(e.startAngle), axis.a, axis.b)
      const rb = reflectPoint(pt(e.endAngle), axis.a, axis.b)
      const rm = reflectPoint(pt(e.startAngle + sweep / 2), axis.a, axis.b)
      const params = arcThroughPoints(ra, rb, rm)
      if (params) {
        created.push({ id: newId(), type: 'arc', construction: e.construction, ...params })
      }
    }
  }
  if (created.length === 0) return false
  addSketchEntities(sketchId, created, 'Mirror sketch', [])
  return true
}

/** Duplicates selected sketch entities in a linear array. */
export function patternSketchSelection(sketchId: string, selectedEntityIds: string[], count = 3, step: Vec2 = [20, 0]): boolean {
  const f = useProjectStore.getState().doc.features.find((x) => x.id === sketchId)
  if (f?.type !== 'sketch') return false
  const selected = f.sketch.entities.filter((e) => selectedEntityIds.includes(e.id))
  if (selected.length === 0 || count < 2) return false

  const created: SketchEntity[] = []
  for (let k = 1; k < count; k++) {
    const ox = step[0] * k
    const oy = step[1] * k
    for (const e of selected) {
      if (e.type === 'line') {
        created.push({ id: newId(), type: 'line', construction: e.construction, a: [e.a[0] + ox, e.a[1] + oy], b: [e.b[0] + ox, e.b[1] + oy] })
      } else if (e.type === 'circle') {
        created.push({ id: newId(), type: 'circle', construction: e.construction, center: [e.center[0] + ox, e.center[1] + oy], radius: e.radius })
      } else {
        created.push({ ...e, id: newId(), center: [e.center[0] + ox, e.center[1] + oy] })
      }
    }
  }
  addSketchEntities(sketchId, created, 'Pattern sketch', [])
  return true
}

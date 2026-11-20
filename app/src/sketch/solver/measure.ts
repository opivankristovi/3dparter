// Current value of a dimension, measured on the geometry. Used to show reference dimensions
// (driving: false) and to prefill a new dimension. Lengths in mm, angles in degrees; null if not measurable.
import type { Sketch, SketchConstraint, SketchEntity, Vec2 } from '../../doc/types'
import { angleArms } from './arms'
import { getPoint, parseRef } from './refs'

function pointOf(ref: string, ents: Map<string, SketchEntity>): Vec2 | null {
  const p = parseRef(ref)
  if (!p) return null
  if (p.kind === 'reserved') return p.name === 'origin' ? [0, 0] : null
  if (p.kind !== 'point') return null
  const e = ents.get(p.entityId)
  return e ? getPoint(e, p.slot) : null
}

function lineOf(ref: string, ents: Map<string, SketchEntity>): [Vec2, Vec2] | null {
  const p = parseRef(ref)
  if (!p) return null
  if (p.kind === 'reserved') {
    if (p.name === 'xAxis') return [[0, 0], [1, 0]]
    if (p.name === 'yAxis') return [[0, 0], [0, 1]]
    return null
  }
  if (p.kind !== 'entity') return null
  const e = ents.get(p.entityId)
  return e?.type === 'line' ? [e.a, e.b] : null
}

export function measureConstraint(sketch: Sketch, c: SketchConstraint): number | null {
  const ents = new Map(sketch.entities.map((e) => [e.id, e]))
  const [r0, r1] = c.entityIds
  switch (c.type) {
    case 'distance':
    case 'horizontalDistance':
    case 'verticalDistance': {
      const p = pointOf(r0, ents)
      const q = r1 ? pointOf(r1, ents) : null
      if (!p || !q) return null
      if (c.type === 'distance') return Math.hypot(q[0] - p[0], q[1] - p[1])
      return c.type === 'horizontalDistance' ? q[0] - p[0] : q[1] - p[1]
    }
    case 'length': {
      const l = lineOf(r0, ents)
      return l ? Math.hypot(l[1][0] - l[0][0], l[1][1] - l[0][1]) : null
    }
    case 'pointLineDistance': {
      const p = pointOf(r0, ents)
      const l = r1 ? lineOf(r1, ents) : null
      if (!p || !l) return null
      const dx = l[1][0] - l[0][0]
      const dy = l[1][1] - l[0][1]
      const len = Math.hypot(dx, dy)
      return len === 0 ? null : Math.abs(dx * (p[1] - l[0][1]) - dy * (p[0] - l[0][0])) / len
    }
    case 'radius':
    case 'diameter': {
      const e = ents.get(r0)
      if (!e || e.type === 'line') return null
      return c.type === 'radius' ? e.radius : e.radius * 2
    }
    case 'angle': {
      // The arms stored on the constraint at creation (legacy: each line's own a -> b); axes use their direction.
      const arms = r1 ? angleArms(sketch, c) : null
      let d1: Vec2 | null = null
      let d2: Vec2 | null = null
      if (arms) {
        const [p1, q1, p2, q2] = [...arms[0], ...arms[1]].map((r) => pointOf(r, ents))
        if (p1 && q1 && p2 && q2) {
          d1 = [q1[0] - p1[0], q1[1] - p1[1]]
          d2 = [q2[0] - p2[0], q2[1] - p2[1]]
        }
      } else {
        const l1 = lineOf(r0, ents)
        const l2 = r1 ? lineOf(r1, ents) : null
        if (l1 && l2) {
          d1 = [l1[1][0] - l1[0][0], l1[1][1] - l1[0][1]]
          d2 = [l2[1][0] - l2[0][0], l2[1][1] - l2[0][1]]
        }
      }
      if (!d1 || !d2) return null
      let d = ((Math.atan2(d2[1], d2[0]) - Math.atan2(d1[1], d1[0])) * 180) / Math.PI
      while (d > 180) d -= 360
      while (d <= -180) d += 360
      return d
    }
    default:
      return null
  }
}

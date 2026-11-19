// Where a constraint ref sits in sketch coordinates (used to place glyphs, labels and the constraint bar).
import type { SketchEntity, Vec2 } from '../doc/types'
import { getPoint, parseRef } from './solver/refs'

/** Where a ref sits in sketch coordinates: a point as it is, a line at its middle, a circle or arc on its rim. */
export function refPoint(ref: string, ents: Map<string, SketchEntity>): Vec2 | null {
  const p = parseRef(ref)
  if (!p) return null
  if (p.kind === 'reserved') return p.name === 'origin' ? [0, 0] : null
  const e = ents.get(p.entityId)
  if (!e) return null
  if (p.kind === 'point') return getPoint(e, p.slot)
  if (e.type === 'line') return [(e.a[0] + e.b[0]) / 2, (e.a[1] + e.b[1]) / 2]
  const mid = e.type === 'arc' ? e.startAngle + ((((e.endAngle - e.startAngle) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) / 2 : Math.PI / 4
  return [e.center[0] + e.radius * Math.cos(mid), e.center[1] + e.radius * Math.sin(mid)]
}

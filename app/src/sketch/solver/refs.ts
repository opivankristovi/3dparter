// Constraint refs: "<entityId>", "<entityId>.<slot>", or the reserved "origin" | "xAxis" | "yAxis".
import type { ArcEntity, SketchEntity, Vec2 } from '../../doc/types'

export type PointSlot = 'a' | 'b' | 'center' | 'start' | 'end'
export type ReservedRef = 'origin' | 'xAxis' | 'yAxis'

const SLOTS: readonly PointSlot[] = ['a', 'b', 'center', 'start', 'end']
const RESERVED: readonly ReservedRef[] = ['origin', 'xAxis', 'yAxis']

export type ParsedRef =
  | { kind: 'reserved'; name: ReservedRef }
  | { kind: 'entity'; entityId: string }
  | { kind: 'point'; entityId: string; slot: PointSlot }

export function parseRef(ref: string): ParsedRef | null {
  if (!ref) return null
  if ((RESERVED as readonly string[]).includes(ref)) return { kind: 'reserved', name: ref as ReservedRef }
  const i = ref.lastIndexOf('.')
  if (i > 0) {
    const slot = ref.slice(i + 1)
    if ((SLOTS as readonly string[]).includes(slot)) {
      return { kind: 'point', entityId: ref.slice(0, i), slot: slot as PointSlot }
    }
    return null
  }
  return { kind: 'entity', entityId: ref }
}

export function formatRef(entityId: string, slot?: PointSlot): string {
  return slot ? `${entityId}.${slot}` : entityId
}

/** The sketch entity a ref belongs to, or null for reserved refs and malformed refs. */
export function refEntityId(ref: string): string | null {
  const p = parseRef(ref)
  return p && p.kind !== 'reserved' ? p.entityId : null
}

/** The point slots an entity has. */
export function pointSlots(e: SketchEntity): PointSlot[] {
  if (e.type === 'line') return ['a', 'b']
  if (e.type === 'circle') return ['center']
  if (e.type === 'text') return []
  return ['center', 'start', 'end']
}

export function arcPoint(a: ArcEntity, angle: number): Vec2 {
  return [a.center[0] + a.radius * Math.cos(angle), a.center[1] + a.radius * Math.sin(angle)]
}

/** Coordinates of a point of an entity, or null if the entity has no such slot. */
export function getPoint(e: SketchEntity, slot: PointSlot): Vec2 | null {
  if (e.type === 'line') return slot === 'a' ? e.a : slot === 'b' ? e.b : null
  if (e.type === 'circle') return slot === 'center' ? e.center : null
  if (e.type === 'text') return null
  if (slot === 'center') return e.center
  if (slot === 'start') return arcPoint(e, e.startAngle)
  if (slot === 'end') return arcPoint(e, e.endAngle)
  return null
}

/**
 * Returns a copy of the entity with one point moved. Arc start/end only change the matching angle
 * (the radius and the other end stay), moving an arc centre moves the whole arc.
 */
export function setPoint(e: SketchEntity, slot: PointSlot, p: Vec2): SketchEntity {
  if (e.type === 'line') {
    if (slot === 'a') return { ...e, a: [p[0], p[1]] }
    if (slot === 'b') return { ...e, b: [p[0], p[1]] }
    return e
  }
  if (e.type === 'text') return e
  if (slot === 'center') return { ...e, center: [p[0], p[1]] }
  if (e.type === 'circle') return e
  const ang = Math.atan2(p[1] - e.center[1], p[0] - e.center[0])
  if (slot === 'start') return { ...e, startAngle: ang }
  if (slot === 'end') return { ...e, endAngle: ang }
  return e
}

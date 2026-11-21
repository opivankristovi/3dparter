// The shape being rubber-banded while a drawing tool is in use: its preview outline and the entities
// (plus the dimensions typed for it) that it turns into on commit. Pure: no store, no DOM.
import { newId } from '../doc/commands'
import type { SketchConstraint, SketchEntity, Vec2 } from '../doc/types'
import { toExpr } from '../doc/units'
import { arcEntity, arcPolyline, arcThroughPoints, arcWithRadius } from './arc'
import { circleEntity, circlePolyline, rectangleEntities, rectangleLines } from './geometry'
import type { DrawKind } from './solver/infer'

export type Tool = 'rectangle' | 'circle' | 'line' | 'arc' | 'polygon' | 'slot' | 'ellipse' | 'spline'

/** What a finished shape adds: its entities, and a dimension for every size the user typed. */
export interface Built {
  kind: DrawKind
  entities: SketchEntity[]
  dims: SketchConstraint[]
}

export interface Shape {
  polylines: Vec2[][]
  /** Primary size in mm: width, diameter, length or radius. */
  dimA: number
  /** Secondary size in mm (rectangle/ellipse height or slot width). */
  dimB: number
  /** The line's end point (for chaining). */
  end: Vec2
  build: () => Built | null
}

const EPS = 1e-6

const dim = (type: SketchConstraint['type'], ref: string, mm: number): SketchConstraint => ({
  id: newId(),
  type,
  entityIds: [ref],
  value: toExpr(mm),
  driving: true,
})

function arcPts(center: Vec2, radius: number, startAngle: number, endAngle: number): Vec2[] {
  return arcPolyline({ center, radius, startAngle, endAngle })
}

function ovalEntities(center: Vec2, rx: number, ry: number): { entities: SketchEntity[]; polylines: Vec2[][] } {
  const [cx, cy] = center
  if (Math.abs(rx - ry) < 1e-4) {
    const c = circleEntity(center, (rx + ry) / 2, newId)
    return { entities: [c], polylines: [circlePolyline(center, c.radius)] }
  }
  const swapped = ry > rx
  const a = Math.max(rx, ry)
  const b = Math.min(rx, ry)
  const r = (b * b) / a
  const R = (a * a + b * b - 2 * a * r) / (2 * (b - r))
  const xc = a - r
  const yc = R - b
  const alpha = Math.atan2(yc, xc)
  const specs: { c: Vec2; rad: number; s: number; e: number }[] = [
    { c: [xc, 0], rad: r, s: -alpha, e: alpha },
    { c: [0, -yc], rad: R, s: alpha, e: Math.PI - alpha },
    { c: [-xc, 0], rad: r, s: Math.PI - alpha, e: Math.PI + alpha },
    { c: [0, yc], rad: R, s: Math.PI + alpha, e: Math.PI * 2 - alpha },
  ]
  const mapPt = (p: Vec2): Vec2 => (swapped ? [cx - p[1], cy + p[0]] : [cx + p[0], cy + p[1]])
  const shiftA = swapped ? Math.PI / 2 : 0
  const entities: SketchEntity[] = specs.map((sp) => ({
    id: newId(),
    type: 'arc',
    construction: false,
    center: mapPt(sp.c),
    radius: sp.rad,
    startAngle: sp.s + shiftA,
    endAngle: sp.e + shiftA,
  }))
  const polylines = entities.map((e) => (e.type === 'arc' ? arcPts(e.center, e.radius, e.startAngle, e.endAngle) : []))
  return { entities, polylines }
}

function splinePoints(p0: Vec2, mid: Vec2, p2: Vec2, steps = 8): Vec2[] {
  // Quadratic Bezier passing through `mid` at t = 0.5: ctrl = 2*mid - 0.5*(p0 + p2).
  const ctrl: Vec2 = [2 * mid[0] - 0.5 * (p0[0] + p2[0]), 2 * mid[1] - 0.5 * (p0[1] + p2[1])]
  const out: Vec2[] = []
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const u = 1 - t
    out.push([
      u * u * p0[0] + 2 * u * t * ctrl[0] + t * t * p2[0],
      u * u * p0[1] + 2 * u * t * ctrl[1] + t * t * p2[1],
    ])
  }
  return out
}

/**
 * `anchor` is the first click. For `arc` and `spline`, `second` is the second click and `cursor` is the third.
 * Typed sizes (`fixedA`, `fixedB`) become dimensions.
 */
export function shapeFor(
  tool: Tool,
  anchor: Vec2,
  cursor: Vec2,
  fixedA: number | null,
  fixedB: number | null,
  second: Vec2 | null = null,
): Shape {
  const dx = cursor[0] - anchor[0]
  const dy = cursor[1] - anchor[1]
  if (tool === 'rectangle') {
    const w = fixedA ?? Math.abs(dx)
    const h = fixedB ?? Math.abs(dy)
    const b: Vec2 = [anchor[0] + (dx < 0 ? -w : w), anchor[1] + (dy < 0 ? -h : h)]
    const pts = rectangleLines(anchor, b)
    return {
      polylines: [[...pts.map((l) => l[0]), pts[0][0]]],
      dimA: w,
      dimB: h,
      end: b,
      build: () => {
        if (w < EPS || h < EPS) return null
        const entities = rectangleEntities(anchor, b, newId)
        const dims: SketchConstraint[] = []
        if (fixedA !== null) dims.push(dim('length', entities[0].id, w))
        if (fixedB !== null) dims.push(dim('length', entities[1].id, h))
        return { kind: 'rectangle', entities, dims }
      },
    }
  }
  if (tool === 'circle') {
    const r = fixedA !== null ? fixedA / 2 : Math.hypot(dx, dy)
    return {
      polylines: r < EPS ? [] : [circlePolyline(anchor, r)],
      dimA: r * 2,
      dimB: 0,
      end: anchor,
      build: () => {
        if (r < EPS) return null
        const c = circleEntity(anchor, r, newId)
        return { kind: 'circle', entities: [c], dims: fixedA !== null ? [dim('diameter', c.id, r * 2)] : [] }
      },
    }
  }
  if (tool === 'polygon') {
    const r = fixedA !== null ? fixedA / 2 : Math.hypot(dx, dy)
    const a0 = Math.hypot(dx, dy) > EPS ? Math.atan2(dy, dx) : 0
    const verts: Vec2[] = Array.from({ length: 6 }, (_, i) => {
      const a = a0 + (i * Math.PI) / 3
      return [anchor[0] + r * Math.cos(a), anchor[1] + r * Math.sin(a)]
    })
    return {
      polylines: r < EPS ? [] : [[...verts, verts[0]]],
      dimA: r * 2,
      dimB: 0,
      end: anchor,
      build: () => {
        if (r < EPS) return null
        const entities: SketchEntity[] = verts.map((v, i) => ({
          id: newId(),
          type: 'line',
          construction: false,
          a: [...v],
          b: [...verts[(i + 1) % 6]],
        }))
        return { kind: 'polygon', entities, dims: fixedA !== null ? [dim('length', entities[0].id, r)] : [] }
      },
    }
  }
  if (tool === 'slot') {
    const len0 = Math.hypot(dx, dy)
    const ux = len0 > EPS ? dx / len0 : 1
    const uy = len0 > EPS ? dy / len0 : 0
    const nx = -uy
    const ny = ux
    const L = fixedA ?? len0
    // Derive untouched default width from the dragged chord, never from fixedA, so typing Length then Tab keeps Width intact.
    const W = fixedB ?? Math.max(4, len0 * 0.4)
    const hr = W / 2
    const c2: Vec2 = [anchor[0] + ux * L, anchor[1] + uy * L]
    const theta = Math.atan2(uy, ux)
    const p1: Vec2 = [anchor[0] + nx * hr, anchor[1] + ny * hr]
    const p2: Vec2 = [c2[0] + nx * hr, c2[1] + ny * hr]
    const p3: Vec2 = [c2[0] - nx * hr, c2[1] - ny * hr]
    const p4: Vec2 = [anchor[0] - nx * hr, anchor[1] - ny * hr]
    const valid = L >= EPS && hr >= EPS
    return {
      polylines: valid
        ? [
            [p1, p2],
            arcPts(c2, hr, theta - Math.PI / 2, theta + Math.PI / 2),
            [p3, p4],
            arcPts(anchor, hr, theta + Math.PI / 2, theta + (3 * Math.PI) / 2),
          ]
        : [],
      dimA: L,
      dimB: W,
      end: c2,
      build: () => {
        if (!valid) return null
        const top: SketchEntity = { id: newId(), type: 'line', construction: false, a: p1, b: p2 }
        const right: SketchEntity = { id: newId(), type: 'arc', construction: false, center: c2, radius: hr, startAngle: theta - Math.PI / 2, endAngle: theta + Math.PI / 2 }
        const bottom: SketchEntity = { id: newId(), type: 'line', construction: false, a: p3, b: p4 }
        const left: SketchEntity = { id: newId(), type: 'arc', construction: false, center: anchor, radius: hr, startAngle: theta + Math.PI / 2, endAngle: theta + (3 * Math.PI) / 2 }
        const dims: SketchConstraint[] = []
        if (fixedA !== null) dims.push(dim('length', top.id, L))
        if (fixedB !== null) dims.push(dim('radius', right.id, hr))
        return { kind: 'slot', entities: [top, right, bottom, left], dims }
      },
    }
  }
  if (tool === 'ellipse') {
    const w = fixedA ?? Math.abs(dx) * 2
    const h = fixedB ?? Math.abs(dy) * 2
    const valid = w >= EPS && h >= EPS
    const built = valid ? ovalEntities(anchor, w / 2, h / 2) : null
    return {
      polylines: built ? built.polylines : [],
      dimA: w,
      dimB: h,
      end: anchor,
      build: () => {
        if (!built) return null
        return { kind: 'ellipse', entities: built.entities, dims: [] }
      },
    }
  }
  if (tool === 'spline') {
    if (!second) {
      return { polylines: [[anchor, cursor]], dimA: 0, dimB: 0, end: anchor, build: () => null }
    }
    const len0 = Math.hypot(dx, dy)
    const len = fixedA ?? len0
    const end: Vec2 =
      fixedA !== null
        ? len0 < EPS
          ? [anchor[0] + len, anchor[1]]
          : [anchor[0] + (dx / len0) * len, anchor[1] + (dy / len0) * len]
        : cursor
    const pts = splinePoints(anchor, second, end)
    return {
      polylines: [pts],
      dimA: len,
      dimB: 0,
      end,
      build: () => {
        if (len < EPS) return null
        const entities: SketchEntity[] = []
        for (let i = 0; i + 1 < pts.length; i++) {
          entities.push({ id: newId(), type: 'line', construction: false, a: pts[i], b: pts[i + 1] })
        }
        return { kind: 'spline', entities, dims: [] }
      },
    }
  }
  if (tool === 'arc') {
    if (!second) {
      return { polylines: [[anchor, cursor]], dimA: 0, dimB: 0, end: anchor, build: () => null }
    }
    const params =
      fixedA !== null ? arcWithRadius(anchor, second, cursor, fixedA) : arcThroughPoints(anchor, second, cursor)
    return {
      polylines: params ? [arcPolyline(params)] : [[anchor, second]],
      dimA: params?.radius ?? 0,
      dimB: 0,
      end: second,
      build: () => {
        if (!params) return null
        const a = arcEntity(params, newId)
        return { kind: 'arc', entities: [a], dims: fixedA !== null ? [dim('radius', a.id, params.radius)] : [] }
      },
    }
  }
  const len0 = Math.hypot(dx, dy)
  const len = fixedA ?? len0
  const end: Vec2 =
    fixedA !== null
      ? len0 < EPS
        ? [anchor[0] + len, anchor[1]]
        : [anchor[0] + (dx / len0) * len, anchor[1] + (dy / len0) * len]
      : cursor
  return {
    polylines: [[anchor, end]],
    dimA: len,
    dimB: 0,
    end,
    build: () => {
      if (len < EPS) return null
      const l: SketchEntity = { id: newId(), type: 'line', construction: false, a: [anchor[0], anchor[1]], b: [end[0], end[1]] }
      return { kind: 'line', entities: [l], dims: fixedA !== null ? [dim('length', l.id, len)] : [] }
    },
  }
}

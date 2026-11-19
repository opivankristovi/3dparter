// The shape being rubber-banded while a drawing tool is in use: its preview outline and the entities
// (plus the dimensions typed for it) that it turns into on commit. Pure: no store, no DOM.
import { newId } from '../doc/commands'
import type { SketchConstraint, SketchEntity, Vec2 } from '../doc/types'
import { toExpr } from '../doc/units'
import { arcEntity, arcPolyline, arcThroughPoints, arcWithRadius } from './arc'
import { circleEntity, circlePolyline, rectangleEntities, rectangleLines } from './geometry'
import type { DrawKind } from './solver/infer'

export type Tool = 'rectangle' | 'circle' | 'line' | 'arc'

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
  /** Secondary size in mm (rectangle height). */
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

/**
 * `anchor` is the first click. For the arc tool, `second` is the second click (the end point) and the
 * cursor is the point the arc passes through. Typed sizes (`fixedA`, `fixedB`) become dimensions.
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
        // Sides run bottom, right, top, left: the typed width is the first, the typed height the second.
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
  if (tool === 'arc') {
    if (!second) {
      return { polylines: [[anchor, cursor]], dimA: 0, dimB: 0, end: anchor, build: () => null }
    }
    const params =
      fixedA !== null ? arcWithRadius(anchor, second, cursor, fixedA) : arcThroughPoints(anchor, second, cursor)
    return {
      // Before the arc is defined (the cursor is in line with the two points) show the chord.
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

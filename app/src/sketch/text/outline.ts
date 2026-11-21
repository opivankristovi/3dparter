// Pure geometry of sketch text (no OpenCascade, no DOM): glyph outlines as closed polylines, and the
// expansion of text entities into plain line entities so regions, extrusion and cuts need no special case.
import type { ArcEntity, CircleEntity, LineEntity, Sketch, SketchEntity, TextEntity, Vec2 } from '../../doc/types'
import { capHeight, type Font, type FontCommand } from './font'

const TWO_PI = Math.PI * 2
const MIN_STEP = 1e-5 // mm; closer points are merged

// ---- glyph flattening --------------------------------------------------------------------------

function area2(poly: Vec2[]): number {
  let a = 0
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]
    const q = poly[(i + 1) % poly.length]
    a += p[0] * q[1] - q[0] * p[1]
  }
  return a
}

function cleanContour(raw: Vec2[]): Vec2[] | null {
  const pts: Vec2[] = []
  for (const p of raw) {
    const last = pts[pts.length - 1]
    if (last && Math.hypot(p[0] - last[0], p[1] - last[1]) < MIN_STEP) continue
    pts.push(p)
  }
  while (pts.length > 1 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < MIN_STEP) pts.pop()
  if (pts.length < 3) return null
  if (Math.abs(area2(pts)) < 1e-9) return null
  return pts
}

/** One glyph as closed contours in mm, baseline at y = 0, origin at the pen position, y up. */
function glyphContours(font: Font, ch: string, scale: number, tol: number): { contours: Vec2[][]; advance: number } {
  const glyph = font.charToGlyph(ch)
  const advance = (glyph.advanceWidth ?? font.unitsPerEm * 0.5) * scale
  const cmds: FontCommand[] = glyph.getPath(0, 0, font.unitsPerEm).commands
  const contours: Vec2[][] = []
  let cur: Vec2[] = []
  let pen: Vec2 = [0, 0]
  const P = (x: number, y: number): Vec2 => [x * scale, -y * scale]
  const close = () => {
    const c = cleanContour(cur)
    if (c) contours.push(c)
    cur = []
  }
  for (const c of cmds) {
    if (c.type === 'M') {
      if (cur.length) close()
      pen = P(c.x!, c.y!)
      cur = [pen]
    } else if (c.type === 'L') {
      pen = P(c.x!, c.y!)
      cur.push(pen)
    } else if (c.type === 'Q') {
      const p0 = pen
      const p1 = P(c.x1!, c.y1!)
      const p2 = P(c.x!, c.y!)
      const dev = Math.hypot(p0[0] - 2 * p1[0] + p2[0], p0[1] - 2 * p1[1] + p2[1]) / 4
      const n = Math.max(2, Math.ceil(Math.sqrt(dev / tol)))
      for (let i = 1; i <= n; i++) {
        const t = i / n
        const u = 1 - t
        cur.push([u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]])
      }
      pen = p2
    } else if (c.type === 'C') {
      const p0 = pen
      const p1 = P(c.x1!, c.y1!)
      const p2 = P(c.x2!, c.y2!)
      const p3 = P(c.x!, c.y!)
      const d1 = Math.hypot(p0[0] - 2 * p1[0] + p2[0], p0[1] - 2 * p1[1] + p2[1])
      const d2 = Math.hypot(p1[0] - 2 * p2[0] + p3[0], p1[1] - 2 * p2[1] + p3[1])
      const n = Math.max(2, Math.ceil(Math.sqrt((0.75 * Math.max(d1, d2)) / tol / 2)))
      for (let i = 1; i <= n; i++) {
        const t = i / n
        const u = 1 - t
        const a = u * u * u
        const b = 3 * u * u * t
        const cc = 3 * u * t * t
        const d = t * t * t
        cur.push([a * p0[0] + b * p1[0] + cc * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + cc * p2[1] + d * p3[1]])
      }
      pen = p3
    } else if (c.type === 'Z') {
      close()
    }
  }
  if (cur.length) close()
  return { contours, advance }
}

// ---- layout ------------------------------------------------------------------------------------

type Placement = (local: Vec2) => Vec2

/** Where one glyph goes: maps glyph-local points (x from the glyph left edge, y up from the baseline). */
function pathPlacement(
  path: NonNullable<TextEntity['path']>,
  target: SketchEntity,
): ((arcLenCentre: number, advance: number) => Placement) | null {
  const side = path.side
  if (target.type === 'circle' || target.type === 'arc') {
    const t = target as CircleEntity | ArcEntity
    const r = t.radius
    if (r <= 1e-9) return null
    let theta0: number
    if (t.type === 'circle') {
      theta0 = path.offset * TWO_PI
    } else {
      let sweep = (t.endAngle - t.startAngle) % TWO_PI
      if (sweep <= 0) sweep += TWO_PI
      // The offset runs in the reading direction: clockwise reading starts at the end of the arc.
      theta0 = side === 'outside' ? t.endAngle - path.offset * sweep : t.startAngle + path.offset * sweep
    }
    const dir = side === 'outside' ? -1 : 1
    return (centre, advance) => {
      const theta = theta0 + (dir * centre) / r
      const c = Math.cos(theta)
      const s = Math.sin(theta)
      const tx = dir === -1 ? s : -s
      const ty = dir === -1 ? -c : c
      const nx = dir === -1 ? c : -c // up: outward for outside, inward for inside
      const ny = dir === -1 ? s : -s
      const ox = t.center[0] + r * c
      const oy = t.center[1] + r * s
      return (p) => {
        const dx = p[0] - advance / 2
        return [ox + dx * tx + p[1] * nx, oy + dx * ty + p[1] * ny]
      }
    }
  }
  if (target.type === 'line') {
    const l = target
    const len = Math.hypot(l.b[0] - l.a[0], l.b[1] - l.a[1])
    if (len <= 1e-9) return null
    const inside = side === 'inside'
    const from = inside ? l.b : l.a
    const to = inside ? l.a : l.b
    const tx = (to[0] - from[0]) / len
    const ty = (to[1] - from[1]) / len
    const nx = -ty // left of the reading direction
    const ny = tx
    return (centre, advance) => {
      const d = path.offset * len + centre
      const ox = from[0] + d * tx
      const oy = from[1] + d * ty
      return (p) => {
        const dx = p[0] - advance / 2
        return [ox + dx * tx + p[1] * nx, oy + dx * ty + p[1] * ny]
      }
    }
  }
  return null
}

/** Closed polylines (no repeated last point) for every glyph contour of a text entity, in sketch mm. */
export function textContours(entity: TextEntity, sketch: Sketch, font: Font): Vec2[][] {
  if (!entity.text || !(entity.size > 0)) return []
  const scale = entity.size / capHeight(font)
  const tol = entity.size / 150
  const target = entity.path ? sketch.entities.find((e) => e.id === entity.path!.entityId) : undefined
  const along = entity.path && target ? pathPlacement(entity.path, target) : null
  const cos = Math.cos(entity.rotation)
  const sin = Math.sin(entity.rotation)
  const out: Vec2[][] = []
  let pen = 0
  for (const ch of entity.text) {
    const { contours, advance } = glyphContours(font, ch, scale, tol)
    if (contours.length) {
      const place: Placement = along
        ? along(pen + advance / 2, advance)
        : (p) => [
            entity.position[0] + (p[0] + pen) * cos - p[1] * sin,
            entity.position[1] + (p[0] + pen) * sin + p[1] * cos,
          ]
      for (const c of contours) {
        const placed = cleanContour(c.map(place))
        if (placed) out.push(placed)
      }
    }
    pen += advance
  }
  return out
}

/** Bounding box of a set of contours, or null when empty. */
export function contourBounds(contours: Vec2[][]): { min: Vec2; max: Vec2 } | null {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const c of contours) {
    for (const p of c) {
      if (p[0] < minX) minX = p[0]
      if (p[1] < minY) minY = p[1]
      if (p[0] > maxX) maxX = p[0]
      if (p[1] > maxY) maxY = p[1]
    }
  }
  return minX > maxX ? null : { min: [minX, minY], max: [maxX, maxY] }
}

export function hasText(sketch: Sketch): boolean {
  return sketch.entities.some((e) => e.type === 'text')
}

/**
 * The sketch with every text entity replaced by line segments '<textId>~<c>.<k>' (c = contour index across
 * the whole text, k = segment index). Constraints are untouched. With no font the text is just removed.
 * Returns the same object when there is no text.
 */
export function expandText(sketch: Sketch, font: Font | null): Sketch {
  if (!hasText(sketch)) return sketch
  const entities: SketchEntity[] = []
  for (const e of sketch.entities) {
    if (e.type !== 'text') {
      entities.push(e)
      continue
    }
    if (!font) continue
    textContours(e, sketch, font).forEach((poly, c) => {
      poly.forEach((p, k) => {
        const line: LineEntity = {
          id: `${e.id}~${c}.${k}`,
          type: 'line',
          construction: false,
          a: p,
          b: poly[(k + 1) % poly.length],
        }
        entities.push(line)
      })
    })
  }
  return { entities, constraints: sketch.constraints }
}

// Pure geometry of sketch text (no OpenCascade, no DOM): glyph outlines, and the expansion of text
// entities into plain line entities so regions, extrusion and cuts need no special case.
//
// Every glyph contour keeps its REAL path commands: each line, quadratic or cubic command is one segment
// '<textId>~<c>.<k>' (k = the command's index in the contour). Polylines are made from them for display,
// picking and containment only; the kernel builds true curve edges from the commands (see kernel/build.ts).
import type { ArcEntity, CircleEntity, LineEntity, Sketch, SketchEntity, TextEntity, Vec2 } from '../../doc/types'
import { capHeight, type Font, type FontCommand, type FontGlyph } from './font'

const TWO_PI = Math.PI * 2
const MIN_STEP = 1e-5 // mm; closer points are merged

export type TextCurveKind = 'line' | 'quad' | 'cubic'

/** The exact shape of one text segment: control points in sketch mm, in walking order, plus its flattening. */
export interface TextCurve {
  kind: TextCurveKind
  /** line: [start, end]; quad: [start, control, end]; cubic: [start, control 1, control 2, end]. */
  pts: Vec2[]
  /** Points from the start up to (not including) the end: the segment as a polyline. */
  poly: Vec2[]
}

/** A text segment as a line entity (its chord) that also carries its exact curve. */
export type TextSegmentEntity = LineEntity & { curve?: TextCurve }

export interface TextContourSeg extends TextCurve {
  /** Index of the font command inside the contour. */
  k: number
}

/** One closed glyph contour, counter-clockwise, as segments in walking order. */
export interface TextContour {
  segs: TextContourSeg[]
  /** The whole contour as a closed polyline (no repeated last point). */
  points: Vec2[]
}

// ---- glyph paths -------------------------------------------------------------------------------

function area2(poly: Vec2[]): number {
  let a = 0
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]
    const q = poly[(i + 1) % poly.length]
    a += p[0] * q[1] - q[0] * p[1]
  }
  return a
}

const dist = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1])

interface RawSeg {
  k: number
  kind: TextCurveKind
  pts: Vec2[]
}

/** One glyph as contours of path commands in mm, baseline at y = 0, origin at the pen position, y up. */
function glyphSegments(font: Font, glyph: FontGlyph, scale: number): RawSeg[][] {
  const cmds: FontCommand[] = glyph.getPath(0, 0, font.unitsPerEm).commands
  const contours: RawSeg[][] = []
  let segs: RawSeg[] = []
  let start: Vec2 | null = null
  let pen: Vec2 = [0, 0]
  let k = 0
  const P = (x: number, y: number): Vec2 => [x * scale, -y * scale]
  const close = () => {
    if (start && segs.length > 0) {
      if (dist(pen, start) >= MIN_STEP) segs.push({ k: k++, kind: 'line', pts: [pen, start] })
      else segs[segs.length - 1].pts[segs[segs.length - 1].pts.length - 1] = start
      contours.push(segs)
    }
    segs = []
    start = null
  }
  const add = (kind: TextCurveKind, ...rest: Vec2[]) => {
    const pts = [pen, ...rest]
    if (pts.every((p) => dist(p, pen) < MIN_STEP)) {
      k++
      return
    }
    segs.push({ k: k++, kind, pts })
    pen = pts[pts.length - 1]
  }
  for (const c of cmds) {
    if (c.type === 'M') {
      if (start) close()
      pen = P(c.x!, c.y!)
      start = pen
      k = 1
    } else if (!start) {
      continue
    } else if (c.type === 'L') {
      const p = P(c.x!, c.y!)
      if (dist(pen, p) < MIN_STEP) k++
      else add('line', p)
    } else if (c.type === 'Q') {
      add('quad', P(c.x1!, c.y1!), P(c.x!, c.y!))
    } else if (c.type === 'C') {
      add('cubic', P(c.x1!, c.y1!), P(c.x2!, c.y2!), P(c.x!, c.y!))
    } else if (c.type === 'Z') {
      close()
    }
  }
  if (start) close()
  return contours
}

/** A segment as a polyline from its start up to (not including) its end. */
function flatten(kind: TextCurveKind, pts: Vec2[], tol: number): Vec2[] {
  if (kind === 'line') return [pts[0]]
  const out: Vec2[] = []
  if (kind === 'quad') {
    const [p0, p1, p2] = pts
    const dev = Math.hypot(p0[0] - 2 * p1[0] + p2[0], p0[1] - 2 * p1[1] + p2[1]) / 4
    const n = Math.max(2, Math.ceil(Math.sqrt(dev / tol)))
    for (let i = 0; i < n; i++) {
      const t = i / n
      const u = 1 - t
      out.push([u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]])
    }
    return out
  }
  const [p0, p1, p2, p3] = pts
  const d1 = Math.hypot(p0[0] - 2 * p1[0] + p2[0], p0[1] - 2 * p1[1] + p2[1])
  const d2 = Math.hypot(p1[0] - 2 * p2[0] + p3[0], p1[1] - 2 * p2[1] + p3[1])
  const n = Math.max(2, Math.ceil(Math.sqrt((0.75 * Math.max(d1, d2)) / tol / 2)))
  for (let i = 0; i < n; i++) {
    const t = i / n
    const u = 1 - t
    const a = u * u * u
    const b = 3 * u * u * t
    const c = 3 * u * t * t
    const d = t * t * t
    out.push([a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]])
  }
  return out
}

/** Places a raw contour and makes it counter-clockwise; null when it is degenerate. */
function placeContour(raw: RawSeg[], place: Placement, tol: number): TextContour | null {
  let segs = raw.map((s) => ({ k: s.k, kind: s.kind, pts: s.pts.map(place) }))
  const flat = segs.flatMap((s) => flatten(s.kind, s.pts, tol))
  if (flat.length < 3 || Math.abs(area2(flat)) < 1e-9) return null
  if (area2(flat) < 0) segs = segs.reverse().map((s) => ({ ...s, pts: [...s.pts].reverse() }))
  const full = segs.map((s) => ({ ...s, poly: flatten(s.kind, s.pts, tol) }))
  return { segs: full, points: full.flatMap((s) => s.poly) }
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

/** Kerning between two glyphs in mm (0 when the font has none). */
function kerning(font: Font, left: FontGlyph, right: FontGlyph, scale: number): number {
  try {
    const v = font.getKerningValue?.(left, right) ?? 0
    return Number.isFinite(v) ? v * scale : 0
  } catch {
    return 0
  }
}

/** Every glyph contour of a text entity, counter-clockwise, in sketch mm. */
export function textShapes(entity: TextEntity, sketch: Sketch, font: Font): TextContour[] {
  if (!entity.text || !(entity.size > 0)) return []
  const scale = entity.size / capHeight(font)
  const tol = entity.size / 150
  const target = entity.path ? sketch.entities.find((e) => e.id === entity.path!.entityId) : undefined
  const along = entity.path && target ? pathPlacement(entity.path, target) : null
  const cos = Math.cos(entity.rotation)
  const sin = Math.sin(entity.rotation)
  const out: TextContour[] = []
  let pen = 0
  let prev: FontGlyph | null = null
  for (const ch of Array.from(entity.text)) {
    const glyph = font.charToGlyph(ch)
    if (prev) pen += kerning(font, prev, glyph, scale)
    const advance = (glyph.advanceWidth ?? font.unitsPerEm * 0.5) * scale
    const raw = glyphSegments(font, glyph, scale)
    if (raw.length) {
      const here = pen
      const place: Placement = along
        ? along(here + advance / 2, advance)
        : (p) => [
            entity.position[0] + (p[0] + here) * cos - p[1] * sin,
            entity.position[1] + (p[0] + here) * sin + p[1] * cos,
          ]
      for (const c of raw) {
        const placed = placeContour(c, place, tol)
        if (placed) out.push(placed)
      }
    }
    pen += advance
    prev = glyph
  }
  return out
}

/** Closed polylines (no repeated last point) for every glyph contour of a text entity, in sketch mm. */
export function textContours(entity: TextEntity, sketch: Sketch, font: Font): Vec2[][] {
  return textShapes(entity, sketch, font).map((c) => c.points)
}

/** The id of one text segment: '<textId>~<c>.<k>'. */
export const textSegmentId = (textId: string, c: number, k: number): string => `${textId}~${c}.${k}`

/** The exact curve of every text segment of a sketch, by segment id, in sketch coordinates. */
export function textCurves(sketch: Sketch, font: Font): Map<string, TextCurve> {
  const out = new Map<string, TextCurve>()
  for (const e of sketch.entities) {
    if (e.type !== 'text') continue
    textShapes(e, sketch, font).forEach((c, ci) => {
      for (const s of c.segs) out.set(textSegmentId(e.id, ci, s.k), { kind: s.kind, pts: s.pts, poly: s.poly })
    })
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
 * The sketch with every text entity replaced by one line entity per glyph path command, ids
 * '<textId>~<c>.<k>' (c = contour index across the whole text, k = command index). Each carries its chord
 * (a to b, in walking order, contours counter-clockwise) and its exact `curve`. Constraints are untouched.
 * With no font the text is just removed. Returns the same object when there is no text.
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
    textShapes(e, sketch, font).forEach((contour, c) => {
      for (const s of contour.segs) {
        const seg: TextSegmentEntity = {
          id: textSegmentId(e.id, c, s.k),
          type: 'line',
          construction: false,
          a: s.pts[0],
          b: s.pts[s.pts.length - 1],
          curve: { kind: s.kind, pts: s.pts, poly: s.poly },
        }
        entities.push(seg)
      }
    })
  }
  return { entities, constraints: sketch.constraints }
}

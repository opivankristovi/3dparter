// Constraint glyphs and dimension labels drawn over the canvas, positioned from the engine's projection
// and kept in step with the camera. Everything here can be reached with the keyboard and is also listed
// in the side panel.
import { useEffect, useMemo, useRef } from 'react'
import { useProjectStore } from '../doc/store'
import type { PlaneFrame, Sketch, SketchConstraint, SketchEntity, Vec2 } from '../doc/types'
import { scopeOf } from '../doc/variables'
import { isTypingTarget } from '../screens/workspace/hooks'
import { ConstraintGlyph } from '../ui/ConstraintGlyph'
import type { ConstraintKind } from '../ui/ConstraintGlyph'
import { cn } from '../ui/cn'
import type { ViewportEngine } from '../viewport/engine'
import { submitDimensionEdit, submitPending } from './actions'
import { DimensionField } from './DimensionField'
import { CONSTRAINT_NAMES, dimensionLabel, editText } from './dimensions'
import { localToWorld } from './geometry'
import { refsOfSelection } from './pick'
import { isDimensional } from './solver/constraints'
import { measureConstraint } from './solver/measure'
import { parseRef } from './solver/refs'
import { refPoint } from './refPoint'
import { evalValue } from './solver/value'
import { useSketchUi } from './sketchUi'
import { useViewSync } from './useViewSync'

type P = [number, number]

const GLYPH_OF: Partial<Record<SketchConstraint['type'], ConstraintKind>> = {
  coincident: 'coincident',
  pointOnEntity: 'coincident',
  horizontal: 'horizontal',
  vertical: 'vertical',
  parallel: 'parallel',
  perpendicular: 'perpendicular',
  tangent: 'tangent',
  equal: 'equal',
  midpoint: 'midpoint',
  concentric: 'concentric',
  symmetric: 'symmetric',
  fix: 'fixed',
}

/** A constraint joining two end points of different lines or arcs: the corner of a shape. Not worth a glyph. */
function isCorner(c: SketchConstraint): boolean {
  if (c.type !== 'coincident') return false
  const ps = c.entityIds.map(parseRef)
  return ps.every((p) => p?.kind === 'point' && p.slot !== 'center')
}

interface Layout {
  /** Label centre, and optional leader lines (screen px, relative to the overlay). */
  at: P
  lines: [P, P][]
}

const OFFSET = 24
const unit = (v: P): P => {
  const l = Math.hypot(v[0], v[1]) || 1
  return [v[0] / l, v[1] / l]
}
const add = (a: P, b: P, k = 1): P => [a[0] + b[0] * k, a[1] + b[1] * k]

/** Screen-space leader lines and label position for a dimension. */
/** Screen centre of the whole sketch: linear dimensions are placed on the side facing away from it. */
function sketchCentre(ents: Map<string, SketchEntity>, s: (p: Vec2) => P): P | null {
  const pts: P[] = []
  for (const e of ents.values()) {
    if (e.type === 'line') pts.push(s(e.a), s(e.b))
    else pts.push(s(e.center))
  }
  if (pts.length === 0) return null
  return [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length]
}

function layoutDimension(c: SketchConstraint, ents: Map<string, SketchEntity>, s: (p: Vec2) => P, centre: P | null): Layout | null {
  const [r0, r1] = c.entityIds
  const pt = (r?: string) => {
    const v = r ? refPoint(r, ents) : null
    return v ? s(v) : null
  }
  const lineEnds = (r?: string): [P, P] | null => {
    const p = r ? parseRef(r) : null
    const e = p?.kind === 'entity' ? ents.get(p.entityId) : undefined
    return e?.type === 'line' ? [s(e.a), s(e.b)] : null
  }
  switch (c.type) {
    case 'length':
    case 'distance': {
      const ends = c.type === 'length' ? lineEnds(r0) : ([pt(r0), pt(r1)] as [P | null, P | null])
      if (!ends || !ends[0] || !ends[1]) return null
      const [p, q] = ends as [P, P]
      const d = unit([q[0] - p[0], q[1] - p[1]])
      let n: P = [-d[1], d[0]]
      const mid: P = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]
      const away = centre ? n[0] * (mid[0] - centre[0]) + n[1] * (mid[1] - centre[1]) : 0
      if (Math.abs(away) > 1) {
        if (away < 0) n = [-n[0], -n[1]] // outside the shape, away from the sketch's centre
      } else if (n[1] > 0 || (n[1] === 0 && n[0] > 0)) n = [-n[0], -n[1]] // no clear outside: above the line
      const p2 = add(p, n, OFFSET)
      const q2 = add(q, n, OFFSET)
      return { at: [(p2[0] + q2[0]) / 2, (p2[1] + q2[1]) / 2], lines: [[p, p2], [q, q2], [p2, q2]] }
    }
    case 'horizontalDistance':
    case 'verticalDistance': {
      const p = pt(r0)
      const q = pt(r1)
      if (!p || !q) return null
      if (c.type === 'horizontalDistance') {
        const y = Math.min(p[1], q[1]) - OFFSET
        return { at: [(p[0] + q[0]) / 2, y], lines: [[p, [p[0], y]], [q, [q[0], y]], [[p[0], y], [q[0], y]]] }
      }
      const x = Math.max(p[0], q[0]) + OFFSET
      return { at: [x, (p[1] + q[1]) / 2], lines: [[p, [x, p[1]]], [q, [x, q[1]]], [[x, p[1]], [x, q[1]]]] }
    }
    case 'pointLineDistance': {
      const p = pt(r0)
      const l = lineEnds(r1)
      if (!p || !l) return null
      const d = unit([l[1][0] - l[0][0], l[1][1] - l[0][1]])
      const t = (p[0] - l[0][0]) * d[0] + (p[1] - l[0][1]) * d[1]
      const foot = add(l[0], d, t)
      return { at: [(p[0] + foot[0]) / 2 + 14, (p[1] + foot[1]) / 2], lines: [[p, foot]] }
    }
    case 'radius':
    case 'diameter': {
      const pr = r0 ? parseRef(r0) : null
      const e = pr?.kind === 'entity' ? ents.get(pr.entityId) : undefined
      if (!e || e.type === 'line') return null
      const centre = s(e.center)
      const rim = s([e.center[0] + e.radius * Math.SQRT1_2, e.center[1] + e.radius * Math.SQRT1_2])
      const out = unit([rim[0] - centre[0], rim[1] - centre[1]])
      const far = c.type === 'diameter' ? add(centre, [centre[0] - rim[0], centre[1] - rim[1]]) : centre
      return { at: add(rim, out, 26), lines: [[far, rim]] }
    }
    case 'angle': {
      const a = lineEnds(r0)
      const b = lineEnds(r1)
      if (!a || !b) return null
      const ma: P = [(a[0][0] + a[1][0]) / 2, (a[0][1] + a[1][1]) / 2]
      const mb: P = [(b[0][0] + b[1][0]) / 2, (b[0][1] + b[1][1]) / 2]
      const at: P = [(ma[0] + mb[0]) / 2, (ma[1] + mb[1]) / 2 - 12]
      return { at, lines: [[ma, at], [mb, at]] }
    }
    default:
      return null
  }
}

const DIM_PREFIX: Partial<Record<SketchConstraint['type'], string>> = { radius: 'R ', diameter: 'Ø ' }

export interface SketchOverlayProps {
  engine: ViewportEngine
  frame: PlaneFrame
  sketchId: string
  entities: SketchEntity[]
  constraints: SketchConstraint[]
}

export function SketchOverlay({ engine, frame, sketchId, entities, constraints }: SketchOverlayProps) {
  const root = useRef<HTMLDivElement>(null)
  const units = useProjectStore((s) => s.doc.units)
  const selection = useProjectStore((s) => s.selection)
  const ui = useSketchUi()

  useViewSync(engine)

  const ents = useMemo(() => new Map(entities.map((e) => [e.id, e])), [entities])
  const sketch: Sketch = useMemo(() => ({ entities, constraints }), [entities, constraints])
  const rect = root.current?.getBoundingClientRect()
  const toScreen = (p: Vec2): P => {
    const [x, y] = engine.worldToClient(localToWorld(p, frame))
    return [x - (rect?.left ?? 0), y - (rect?.top ?? 0)]
  }

  // Enter on a selected dimension opens its field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || isTypingTarget(e.target) || e.ctrlKey || e.metaKey || e.altKey) return
      const st = useSketchUi.getState()
      if (st.selectedConstraintIds.length !== 1 || st.editingId) return
      const c = constraints.find((x) => x.id === st.selectedConstraintIds[0])
      if (!c || !isDimensional(c.type)) return
      e.preventDefault()
      st.set({ editingId: c.id })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [constraints])

  const conflictIds = new Set([...(ui.defined?.sketchId === sketchId ? ui.defined.conflicting : []), ...ui.flashIds])

  const choose = (id: string, shift: boolean) => {
    const st = useSketchUi.getState()
    useProjectStore.getState().setSelection([])
    st.set({
      selectedConstraintIds: shift ? (st.selectedConstraintIds.includes(id) ? st.selectedConstraintIds.filter((x) => x !== id) : [...st.selectedConstraintIds, id]) : [id],
      pending: null,
      editingId: null,
    })
  }
  const hover = (id: string | null) => useSketchUi.getState().set({ hoverConstraintId: id })

  // ---- geometric glyphs, spread out where several share a spot -------------------------------------
  const slots = new Map<string, number>()
  const glyphs = constraints.flatMap((c) => {
    const kind = GLYPH_OF[c.type]
    if (!kind || isDimensional(c.type) || isCorner(c)) return []
    // Equal and Parallel tie two lines, so each line gets a marker; both belong to the same constraint.
    const refs = c.type === 'equal' || c.type === 'parallel' ? c.entityIds : c.entityIds.slice(0, 1)
    return refs.flatMap((ref, i) => {
      const where = refPoint(ref, ents)
      if (!where) return []
      const n = slots.get(ref) ?? 0
      slots.set(ref, n + 1)
      const [x, y] = toScreen(where)
      const dot = c.type === 'coincident'
      // Glyphs sit beside their geometry, never on it, so points stay clickable.
      return [{ key: `${c.id}:${i}`, c, kind, x: x + (dot ? 11 : n * 20), y: y - (dot ? 11 : 20) }]
    })
  })

  // ---- dimensions ----------------------------------------------------------------------------------
  const centre = sketchCentre(ents, toScreen)
  const dims = constraints.flatMap((c) => {
    if (!isDimensional(c.type)) return []
    const layout = layoutDimension(c, ents, toScreen, centre)
    if (!layout) return []
    const value = c.driving ? evalValue(c.value, scopeOf(useProjectStore.getState().doc)) : (measureConstraint(sketch, c) ?? NaN)
    if (!Number.isFinite(value)) return []
    return [{ c, layout, text: `${DIM_PREFIX[c.type] ?? ''}${dimensionLabel(c.type, c.driving ? c.value : undefined, value, units)}`, value }]
  })

  // Selected points get a ring (the entity itself is highlighted in the viewport).
  const pointRefs = refsOfSelection(selection, sketchId).filter((r) => parseRef(r)?.kind !== 'entity')
  const rings = [...pointRefs, ...(ui.hoverRef && !pointRefs.includes(ui.hoverRef) && parseRef(ui.hoverRef)?.kind !== 'entity' ? [ui.hoverRef] : [])]
    .map((r) => ({ ref: r, at: refPoint(r, ents), selected: pointRefs.includes(r) }))
    .filter((r): r is { ref: string; at: Vec2; selected: boolean } => r.at !== null)

  const pending = ui.pending
  const pendingAt: P | null = (() => {
    if (!pending) return null
    const ps = pending.refs.map((r) => refPoint(r, ents)).filter((p): p is Vec2 => p !== null).map(toScreen)
    if (ps.length === 0) return null
    const x = ps.reduce((a, p) => a + p[0], 0) / ps.length
    const y = ps.reduce((a, p) => a + p[1], 0) / ps.length
    return [x, y]
  })()

  return (
    <div ref={root} className="pointer-events-none absolute inset-0">
      <svg aria-hidden="true" className="absolute inset-0 size-full overflow-visible" fill="none" strokeWidth={1}>
        {dims.map(({ c, layout }) => (
          <g key={c.id} className={conflictIds.has(c.id) ? 'stroke-sketch-conflict' : 'stroke-dimension'}>
            {layout.lines.map(([p, q], i) => (
              <line key={i} x1={p[0]} y1={p[1]} x2={q[0]} y2={q[1]} />
            ))}
          </g>
        ))}
      </svg>

      {rings.map((r) => {
        const [x, y] = toScreen(r.at)
        return (
          <span
            key={r.ref}
            aria-hidden="true"
            style={{ left: x, top: y }}
            className={cn(
              'absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-pill border-2',
              r.selected ? 'border-selection bg-accent-subtle' : 'border-preselect',
            )}
          />
        )
      })}

      {glyphs.map(({ key, c, kind, x, y }) => {
        const selected = ui.selectedConstraintIds.includes(c.id)
        const state = conflictIds.has(c.id) ? 'conflict' : selected ? 'selected' : ui.hoverConstraintId === c.id ? 'hover' : 'default'
        return (
          <button
            key={key}
            type="button"
            aria-label={`${CONSTRAINT_NAMES[c.type]} constraint`}
            aria-pressed={selected}
            style={{ left: x, top: y }}
            onClick={(e) => choose(c.id, e.shiftKey)}
            onPointerEnter={() => hover(c.id)}
            onPointerLeave={() => hover(null)}
            onFocus={() => hover(c.id)}
            onBlur={() => hover(null)}
            className="touch-hit pointer-events-auto absolute flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-pill focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
          >
            <ConstraintGlyph kind={kind} state={state} size={c.type === 'coincident' ? 12 : 16} />
          </button>
        )
      })}

      {dims.map(({ c, layout, text, value }) => {
        const [x, y] = layout.at
        const selected = ui.selectedConstraintIds.includes(c.id)
        const conflict = conflictIds.has(c.id)
        const shown = c.driving ? text : `(${text})`
        if (ui.editingId === c.id) {
          return (
            <DimensionField
              key={c.id}
              label={CONSTRAINT_NAMES[c.type]}
              type={c.type}
              unit={c.type === 'angle' ? '°' : units}
              initial={editText(c.type, c.driving ? c.value : undefined, value, units)}
              onSubmit={(t) => submitDimensionEdit(c.id, t)}
              onCancel={() => useSketchUi.getState().set({ editingId: null })}
              style={{ left: x, top: y }}
              className="absolute z-10 -translate-x-1/2 -translate-y-1/2"
            />
          )
        }
        return (
          <button
            key={c.id}
            type="button"
            data-sketch-dim=""
            aria-label={`${CONSTRAINT_NAMES[c.type]} dimension ${shown}${c.driving ? '' : ', reference'}`}
            aria-pressed={selected}
            style={{ left: x, top: y }}
            onClick={(e) => choose(c.id, e.shiftKey)}
            onDoubleClick={() => useSketchUi.getState().set({ editingId: c.id, selectedConstraintIds: [c.id] })}
            onPointerEnter={() => hover(c.id)}
            onPointerLeave={() => hover(null)}
            onFocus={() => hover(c.id)}
            onBlur={() => hover(null)}
            className={cn(
              'pointer-events-auto absolute flex h-6 -translate-x-1/2 -translate-y-1/2 items-center rounded-pill border bg-surface-raised px-2 text-sm tnum whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus',
              conflict ? 'border-sketch-conflict text-sketch-conflict' : selected ? 'border-accent text-text' : 'border-border',
              !conflict && !c.driving ? 'text-text-muted' : !conflict && 'text-text',
            )}
          >
            {shown}
          </button>
        )
      })}

      {pending && pendingAt ? (
        <DimensionField
          label={CONSTRAINT_NAMES[pending.type]}
          type={pending.type}
          unit={pending.type === 'angle' ? '°' : units}
          initial={pending.text}
          error={pending.error}
          onSubmit={(t) => {
            submitPending(t)
            return useSketchUi.getState().pending?.error ?? null
          }}
          onCancel={() => useSketchUi.getState().set({ pending: null })}
          style={{ left: pendingAt[0], top: pendingAt[1] - 40 }}
          className="absolute z-10 -translate-x-1/2 -translate-y-full"
        />
      ) : null}
    </div>
  )
}

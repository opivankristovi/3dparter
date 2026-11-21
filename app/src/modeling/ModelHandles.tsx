// On-model drag handles and the 3-axis move gizmo, projected over the canvas with ViewportEngine.
// Pure tokens; keyboard-accessible (arrow keys nudge the value).
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent } from 'react'
import { useSettings } from '../app/useSettings'
import { evalStored } from '../doc/fieldInput'
import type { DisplayUnit, Ref, Vec3 } from '../doc/types'
import { formatDisplay } from '../doc/units'
import type { MeshData } from '../kernel/api'
import { useViewSync } from '../sketch/useViewSync'
import { cn } from '../ui/cn'
import { layoutPx } from '../ui/layout'
import type { ViewportEngine } from '../viewport/engine'

export interface AxisDragHandleProps {
  engine: ViewportEngine | null
  origin: Vec3
  dir: Vec3
  /** Current numeric value in mm. */
  value: number
  /** World-space mm moved per 1 mm of `value` (0.5 for symmetric both-sides extrude). Default 1. */
  scale?: number
  units: DisplayUnit
  label: string
  tone?: 'accent' | 'x' | 'y' | 'z'
  min?: number
  /** When true, keeps the arrow at a constant screen length from `origin` (for move gizmos where `origin` moves with the solid). */
  fixedShaft?: boolean
  onChange: (nextMm: number) => void
}

const TONE_STROKE = {
  accent: 'stroke-accent',
  x: 'stroke-axis-x',
  y: 'stroke-axis-y',
  z: 'stroke-axis-z',
} as const

const TONE_FILL = {
  accent: 'fill-accent',
  x: 'fill-axis-x',
  y: 'fill-axis-y',
  z: 'fill-axis-z',
} as const

/** Screen sizes of a move-gizmo arrow, from the layout tokens (px). */
const GIZMO_ARROW_PX = () => layoutPx('gizmo-arrow', 90)
const GIZMO_HEAD_PX = () => layoutPx('gizmo-head', 10)
const GIZMO_GAP_PX = () => layoutPx('gizmo-gap', 8)

const TONE_DOT = {
  accent: 'bg-accent',
  x: 'bg-axis-x',
  y: 'bg-axis-y',
  z: 'bg-axis-z',
} as const

export function AxisDragHandle(props: AxisDragHandleProps) {
  if (!props.engine) return null
  return <AxisDragHandleInner {...props} engine={props.engine} />
}

function unitVec(v: Vec3): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / len, v[1] / len, v[2] / len]
}

function addScaled(o: Vec3, d: Vec3, s: number): Vec3 {
  return [o[0] + d[0] * s, o[1] + d[1] * s, o[2] + d[2] * s]
}

/** Triangle with its point at `tip`, opening backwards along the unit direction `d`. */
function arrowHead(tip: [number, number], d: [number, number], size: number): string {
  const bx = tip[0] - d[0] * size
  const by = tip[1] - d[1] * size
  const hx = (-d[1] * size) / 2
  const hy = (d[0] * size) / 2
  return `${tip[0]},${tip[1]} ${bx + hx},${by + hy} ${bx - hx},${by - hy}`
}

function AxisDragHandleInner({
  engine,
  origin,
  dir,
  value,
  scale = 1,
  units,
  label,
  tone = 'accent',
  min,
  fixedShaft = false,
  onChange,
}: Omit<AxisDragHandleProps, 'engine'> & { engine: ViewportEngine }) {
  useViewSync(engine)
  const precision = useSettings((s) => s.settings.precision)

  const drag = useRef<{
    startX: number
    startY: number
    startVal: number
    sx: number
    sy: number
    last: number
  } | null>(null)

  const u = unitVec(dir)
  const rect = engine.canvas.getBoundingClientRect()
  const toOverlay = (world: Vec3): [number, number] => {
    const [cx, cy] = engine.worldToClient(world)
    return [cx - rect.left, cy - rect.top]
  }

  const chip = useRef<HTMLButtonElement>(null)
  const [chipSize, setChipSize] = useState<[number, number]>([0, 0])
  useLayoutEffect(() => {
    const el = chip.current
    if (el && (el.offsetWidth !== chipSize[0] || el.offsetHeight !== chipSize[1])) setChipSize([el.offsetWidth, el.offsetHeight])
  })

  const ppm = engine.pixelsPerMmAt(origin)
  const fallbackMm = 40 / Math.max(0.15, ppm)
  const tipMm = fixedShaft ? fallbackMm : Math.abs(value) < 1e-3 ? fallbackMm : value * scale

  const base = toOverlay(origin)
  let tip = toOverlay(addScaled(origin, u, tipMm))
  /** Screen direction of the arrow (unit), used by the fixed-length gizmo arrow. */
  let screenDir: [number, number] = [0, -1]
  /** Where the value chip sits: on the tip, or for a fixed arrow just beyond it. */
  let chipAt = tip

  // Keep the handle away from the exact base pixel if the extrusion is very thin on screen.
  const dx = tip[0] - base[0]
  const dy = tip[1] - base[1]
  const distPx = Math.hypot(dx, dy)
  if (fixedShaft) {
    // A fixed-length arrow in the axis colour; the chip goes past the tip, pushed out along the arrow by half its
    // own size in that direction plus a gap, so neighbouring axes cannot sit on each other or on the shafts.
    if (distPx > 1e-3) screenDir = [dx / distPx, dy / distPx]
    const len = GIZMO_ARROW_PX()
    tip = [base[0] + screenDir[0] * len, base[1] + screenDir[1] * len]
    const reach = (Math.abs(screenDir[0]) * chipSize[0] + Math.abs(screenDir[1]) * chipSize[1]) / 2 + GIZMO_GAP_PX()
    chipAt = [tip[0] + screenDir[0] * reach, tip[1] + screenDir[1] * reach]
  } else {
    if (distPx > 0.5 && distPx < 24) {
      const k = 24 / distPx
      tip = [base[0] + dx * k, base[1] + dy * k]
    }
    chipAt = tip
  }

  // Skip handles projected off canvas.
  const inBounds =
    chipAt[0] >= -40 && chipAt[0] <= rect.width + 40 && chipAt[1] >= -40 && chipAt[1] <= rect.height + 40

  const commitValue = (raw: number) => {
    const clamped = min !== undefined ? Math.max(min, raw) : raw
    const clean = Number(clamped.toFixed(6))
    onChange(clean)
  }

  const onPointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    const p0 = engine.worldToClient(addScaled(origin, u, value * scale))
    const p1 = engine.worldToClient(addScaled(origin, u, (value + 1) * scale))
    drag.current = {
      startX: e.clientX,
      startY: e.clientY,
      startVal: value,
      sx: p1[0] - p0[0],
      sy: p1[1] - p0[1],
      last: value,
    }
  }

  const onPointerMove = (e: PointerEvent<HTMLButtonElement>) => {
    const d = drag.current
    if (!d) return
    e.stopPropagation()
    const denom = d.sx * d.sx + d.sy * d.sy
    if (denom < 1e-6) return
    const deltaMm = ((e.clientX - d.startX) * d.sx + (e.clientY - d.startY) * d.sy) / denom
    const step = e.shiftKey ? 5 : e.altKey ? 0.1 : 0.5
    const nextRaw = Math.round((d.startVal + deltaMm) / step) * step
    const clamped = min !== undefined ? Math.max(min, nextRaw) : nextRaw
    const clean = Number(clamped.toFixed(6))
    if (clean !== d.last) {
      d.last = clean
      onChange(clean)
    }
  }

  const onPointerUp = (e: PointerEvent<HTMLButtonElement>) => {
    if (!drag.current) return
    e.stopPropagation()
    drag.current = null
  }

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const step = e.shiftKey ? 10 : e.altKey ? 0.1 : 1
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
      e.preventDefault()
      e.stopPropagation()
      commitValue(value + step)
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
      e.preventDefault()
      e.stopPropagation()
      commitValue(value - step)
    }
  }

  if (!inBounds) return null

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <svg aria-hidden="true" className="absolute inset-0 size-full overflow-visible">
        <line
          x1={base[0]}
          y1={base[1]}
          x2={tip[0]}
          y2={tip[1]}
          className={cn(TONE_STROKE[tone], 'stroke-[2.5]')}
          strokeLinecap="round"
        />
        {fixedShaft ? (
          <polygon
            points={arrowHead(tip, screenDir, GIZMO_HEAD_PX())}
            className={TONE_FILL[tone]}
          />
        ) : null}
        <circle cx={base[0]} cy={base[1]} r={3} className="fill-surface-raised stroke-border stroke-[1.5]" />
      </svg>
      <button
        ref={chip}
        type="button"
        title={label}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
        style={{ left: chipAt[0], top: chipAt[1] }}
        className="pointer-events-auto absolute inline-flex h-7 -translate-x-1/2 -translate-y-1/2 cursor-grab items-center gap-1.5 rounded-pill border border-border bg-surface-raised px-2 text-xs font-medium text-text shadow-panel select-none active:cursor-grabbing hover:border-text-muted focus-visible:outline-2 focus-visible:outline-focus tnum"
      >
        <span aria-hidden="true" className={cn('size-2 rounded-pill', TONE_DOT[tone])} />
        <span className="sr-only">{label} </span>
        <span>
          {formatDisplay(value, units, precision)} {units}
        </span>
      </button>
    </div>
  )
}

export interface TransformGizmoProps {
  engine: ViewportEngine | null
  bodies: Ref[]
  meshes: Map<string, MeshData>
  translate: [string, string, string]
  units: DisplayUnit
  onChange: (axis: 0 | 1 | 2, nextMm: number) => void
}

/** 3-axis move handles anchored at the bounding-box centre of the selected solids. */
export function TransformGizmo({ engine, bodies, meshes, translate, units, onChange }: TransformGizmoProps) {
  const center = useMemo<Vec3 | null>(() => {
    let minX = Infinity
    let minY = Infinity
    let minZ = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    let maxZ = -Infinity
    let found = false
    for (const r of bodies) {
      const m = meshes.get(r.name)
      if (!m) continue
      const pos = m.positions
      for (let i = 0; i + 2 < pos.length; i += 3) {
        found = true
        const x = pos[i]
        const y = pos[i + 1]
        const z = pos[i + 2]
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (z < minZ) minZ = z
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
        if (z > maxZ) maxZ = z
      }
    }
    return found ? [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2] : null
  }, [bodies, meshes])

  if (!engine || !center) return null

  const axes: { idx: 0 | 1 | 2; dir: Vec3; tone: 'x' | 'y' | 'z'; label: string }[] = [
    { idx: 0, dir: [1, 0, 0], tone: 'x', label: 'Move X handle' },
    { idx: 1, dir: [0, 1, 0], tone: 'y', label: 'Move Y handle' },
    { idx: 2, dir: [0, 0, 1], tone: 'z', label: 'Move Z handle' },
  ]

  return (
    <>
      {axes.map((a) => {
        const val = evalStored(translate[a.idx]) ?? NaN
        return (
          <AxisDragHandle
            key={a.tone}
            engine={engine}
            origin={center}
            dir={a.dir}
            value={Number.isFinite(val) ? val : 0}
            units={units}
            label={a.label}
            tone={a.tone}
            fixedShaft
            onChange={(next) => onChange(a.idx, next)}
          />
        )
      })}
    </>
  )
}

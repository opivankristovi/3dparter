// Sketch mode: draws the document's sketches, handles rectangle / circle / line input with typed sizes,
// and lets you pick and delete lines. All geometry here is in the sketch plane's local mm.
import { useEffect, useMemo, useReducer, useRef } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { newId } from '../doc/commands'
import { useProjectStore } from '../doc/store'
import { ORIGIN_PLANES } from '../doc/types'
import type { PlaneFrame, SketchEntity, SketchFeature, Vec2 } from '../doc/types'
import { formatDisplay, parseDisplay } from '../doc/units'
import { isTypingTarget } from '../screens/workspace/hooks'
import { useToolStore } from '../screens/workspace/toolStore'
import { NumericInput } from '../ui/NumericInput'
import type { ViewportEngine } from '../viewport/engine'
import { addSketchEntities, deleteSketchEntities } from './commands'
import {
  circleEntity,
  circlePolyline,
  entityAt,
  localToWorld,
  rectangleEntities,
  rectangleLines,
  samePoint,
  snapPoint,
  snapTargets,
} from './geometry'
import { finishSketch } from './session'

type Tool = 'rectangle' | 'circle' | 'line'

/** The shape being rubber-banded, derived from the anchor, the cursor and any typed sizes. */
interface Shape {
  polylines: Vec2[][]
  /** Primary dimension in mm: width, diameter or length. */
  dimA: number
  /** Secondary dimension in mm (rectangle height). */
  dimB: number
  /** The line's end point (for chaining). */
  end: Vec2
  build: () => SketchEntity[] | null
}

const EPS = 1e-6

export function shapeFor(
  tool: Tool,
  anchor: Vec2,
  cursor: Vec2,
  fixedA: number | null,
  fixedB: number | null,
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
      build: () => (w < EPS || h < EPS ? null : rectangleEntities(anchor, b, newId)),
    }
  }
  if (tool === 'circle') {
    const r = fixedA !== null ? fixedA / 2 : Math.hypot(dx, dy)
    return {
      polylines: r < EPS ? [] : [circlePolyline(anchor, r)],
      dimA: r * 2,
      dimB: 0,
      end: anchor,
      build: () => (r < EPS ? null : [circleEntity(anchor, r, newId)]),
    }
  }
  const len0 = Math.hypot(dx, dy)
  const len = fixedA ?? len0
  const end: Vec2 = fixedA !== null ? (len0 < EPS ? [anchor[0] + len, anchor[1]] : [anchor[0] + (dx / len0) * len, anchor[1] + (dy / len0) * len]) : cursor
  return {
    polylines: [[anchor, end]],
    dimA: len,
    dimB: 0,
    end,
    build: () =>
      len < EPS
        ? null
        : [{ id: newId(), type: 'line', construction: false, a: [anchor[0], anchor[1]], b: [end[0], end[1]] }],
  }
}

interface Work {
  anchor: Vec2 | null
  /** First point of the current polyline, so clicking it closes the loop. */
  start: Vec2 | null
  segments: number
  cursor: Vec2 | null
  /** Pointer position in the overlay, for placing the size fields. */
  screen: [number, number]
  fixedA: number | null
  fixedB: number | null
  typedA: string
  typedB: string
  editing: boolean
  hover: SketchEntity | null
}

const fresh = (): Work => ({
  anchor: null,
  start: null,
  segments: 0,
  cursor: null,
  screen: [0, 0],
  fixedA: null,
  fixedB: null,
  typedA: '',
  typedB: '',
  editing: false,
  hover: null,
})

const TOOL_OF: Record<string, Tool> = {
  'sketch.rectangle': 'rectangle',
  'sketch.circle': 'circle',
  'sketch.line': 'line',
}

const LABELS: Record<Tool, [string, string?]> = {
  rectangle: ['Width', 'Height'],
  circle: ['Diameter'],
  line: ['Length'],
}

export interface SketchLayerProps {
  engine: ViewportEngine
}

export function SketchLayer({ engine }: SketchLayerProps) {
  const sketchId = useToolStore((s) => s.activeSketchId)
  const activeTool = useProjectStore((s) => s.activeTool)
  const units = useProjectStore((s) => s.doc.units)
  const features = useProjectStore((s) => s.doc.features)
  const selection = useProjectStore((s) => s.selection)
  const tool = activeTool ? (TOOL_OF[activeTool] ?? null) : null

  const sketch = useMemo(
    () => features.find((f): f is SketchFeature => f.id === sketchId && f.type === 'sketch'),
    [features, sketchId],
  )
  const frame: PlaneFrame | null = sketch ? (ORIGIN_PLANES[sketch.params.on.name as keyof typeof ORIGIN_PLANES] ?? null) : null

  const [, rerender] = useReducer((n: number) => n + 1, 0)
  const work = useRef<Work>(fresh())
  const root = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const commitRef = useRef<(shape: Shape, tl: Tool) => void>(() => {})
  const selectedRef = useRef<string[]>([])
  /** When the current sketch/tool became active. The click that picked the plane must not also place a point. */
  const enteredAt = useRef(0)

  // The latest props, for the long-lived listeners below.
  const live = useRef({ sketchId, tool, frame, units, engine })
  live.current = { sketchId, tool, frame, units, engine }

  const selectedIds = useMemo(
    () =>
      sketchId
        ? selection.filter((r) => r.kind === 'sketchEdge' && r.name.startsWith(`${sketchId}/`)).map((r) => r.name.slice(sketchId.length + 1))
        : [],
    [selection, sketchId],
  )

  selectedRef.current = selectedIds

  // ---- drawing the document's sketches ----------------------------------------------------------
  useEffect(() => {
    const used = new Set<string>()
    for (const f of features) if (f.type === 'extrude') for (const p of f.params.profiles) used.add(p.name.split('/region:')[0])
    const groups = features.flatMap((f) => {
      if (f.type !== 'sketch' || f.suppressed) return []
      const fr = ORIGIN_PLANES[f.params.on.name as keyof typeof ORIGIN_PLANES]
      if (!fr) return []
      const active = f.id === sketchId
      if (!active && used.has(f.id)) return []
      return [{ id: f.id, frame: fr, entities: f.sketch.entities, active }]
    })
    engine.setSketches(groups)
  }, [engine, features, sketchId])

  // ---- camera on entering a sketch ----------------------------------------------------------------
  const planeName = sketch?.params.on.name
  useEffect(() => {
    if (sketchId && frame) engine.lookAtPlane(frame)
    else if (!sketchId) engine.leavePlaneView()
    // Only when a different sketch (or plane) opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, sketchId, planeName])

  // ---- preview, marks and cursor ------------------------------------------------------------------
  const refreshPreview = () => {
    const { frame: fr, tool: tl, engine: en } = live.current
    const w = work.current
    if (!fr || !tl) {
      en.setPreview(null, [], null)
      return
    }
    const shape = w.anchor && w.cursor ? shapeFor(tl, w.anchor, w.cursor, w.fixedA, w.fixedB) : null
    en.setPreview(fr, shape?.polylines ?? [], w.cursor)
  }

  const refreshMarks = () => {
    const { frame: fr, sketchId: sid, tool: tl, engine: en } = live.current
    if (!fr || !sid) {
      en.setSketchMarks(null, null, [])
      return
    }
    const ents = (useProjectStore.getState().doc.features.find((f) => f.id === sid) as SketchFeature | undefined)?.sketch.entities ?? []
    const ids = new Set(selectedRef.current)
    en.setSketchMarks(fr, tl ? null : work.current.hover, ents.filter((e) => ids.has(e.id)))
  }
  useEffect(refreshMarks)

  // Tool changes and leaving the sketch reset anything half drawn.
  useEffect(() => {
    work.current = fresh()
    enteredAt.current = performance.now()
    engine.setCursor(sketchId && tool ? 'crosshair' : '')
    refreshPreview()
    refreshMarks()
    rerender()
    return () => engine.setCursor('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, tool, sketchId])

  useEffect(
    () => () => {
      engine.setPreview(null, [], null)
      engine.setSketchMarks(null, null, [])
    },
    [engine],
  )

  // ---- pointer ------------------------------------------------------------------------------------
  useEffect(() => {
    const canvas = engine.canvas

    const entitiesNow = (): SketchEntity[] => {
      const sid = live.current.sketchId
      const f = useProjectStore.getState().doc.features.find((x) => x.id === sid)
      return f?.type === 'sketch' ? f.sketch.entities : []
    }

    /** Snapped local point under the pointer. */
    const cursorAt = (e: { clientX: number; clientY: number; altKey: boolean }) => {
      const { frame: fr } = live.current
      if (!fr) return null
      const raw = engine.localPointAt(e.clientX, e.clientY, fr)
      if (!raw) return null
      const ppm = engine.pixelsPerMmAt(localToWorld(raw, fr))
      const targets = snapTargets(entitiesNow())
      const w = work.current
      if (w.start) targets.push(w.start)
      return { raw, ppm, ...snapPoint(raw, targets, ppm, { noGrid: e.altKey }) }
    }

    const onMove = (e: PointerEvent) => {
      const { sketchId: sid, tool: tl } = live.current
      if (!sid || e.buttons !== 0) return
      const w = work.current
      if (w.editing) return
      const c = cursorAt(e)
      if (!c) return
      if (tl) {
        const rect = root.current?.getBoundingClientRect()
        w.cursor = c.point
        w.screen = [e.clientX - (rect?.left ?? 0), e.clientY - (rect?.top ?? 0)]
        refreshPreview()
        if (w.anchor) rerender()
      } else {
        const hit = entityAt(entitiesNow(), c.raw, 8 / c.ppm)
        if ((hit?.id ?? null) !== (w.hover?.id ?? null)) {
          w.hover = hit
          canvas.style.cursor = hit ? 'pointer' : ''
          refreshMarks()
        }
      }
    }

    const commit = (shape: Shape, tl: Tool) => {
      const w = work.current
      const sid = live.current.sketchId
      const ents = shape.build()
      if (!sid || !ents) return
      const label = tl === 'rectangle' ? 'Rectangle' : tl === 'circle' ? 'Circle' : 'Line'
      let closing = false
      if (tl === 'line' && w.start) {
        closing = w.segments >= 2 && samePoint(shape.end, w.start)
        // Ending exactly on the start point with fewer than 3 sides would make a flat loop.
        if (!closing && w.segments < 2 && samePoint(shape.end, w.start)) return
      }
      addSketchEntities(sid, ents, label)
      const keep = w.cursor
      work.current = fresh()
      work.current.cursor = keep
      if (tl === 'line' && !closing) {
        work.current.anchor = shape.end
        work.current.start = w.start
        work.current.segments = w.segments + 1
      }
      if (document.activeElement instanceof HTMLElement && panel.current?.contains(document.activeElement)) {
        document.activeElement.blur()
      }
      refreshPreview()
      rerender()
    }
    commitRef.current = commit

    const onClick = (e: MouseEvent) => {
      const { sketchId: sid, tool: tl } = live.current
      if (!sid || e.button !== 0) return
      // The same click may have just opened this sketch (plane pick); it is not a drawing click.
      if (e.timeStamp <= enteredAt.current) return
      const c = cursorAt(e)
      if (!c) return
      const w = work.current
      if (!tl) {
        // Idle: pick a line or circle.
        const hit = entityAt(entitiesNow(), c.raw, 8 / c.ppm)
        const store = useProjectStore.getState()
        if (!hit) store.setSelection([])
        else {
          const ref = { kind: 'sketchEdge' as const, name: `${sid}/${hit.id}` }
          if (e.shiftKey) {
            const has = store.selection.some((r) => r.name === ref.name)
            store.setSelection(has ? store.selection.filter((r) => r.name !== ref.name) : [...store.selection, ref])
          } else store.setSelection([ref])
        }
        return
      }
      w.cursor = c.point
      if (!w.anchor) {
        w.anchor = c.point
        w.start = c.point
        w.segments = 0
        refreshPreview()
        rerender()
        return
      }
      commit(shapeFor(tl, w.anchor, c.point, w.fixedA, w.fixedB), tl)
    }

    const onDouble = () => {
      const { tool: tl } = live.current
      if (tl === 'line' && work.current.anchor) {
        work.current = { ...fresh(), cursor: work.current.cursor }
        refreshPreview()
        rerender()
      }
    }

    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('click', onClick)
    canvas.addEventListener('dblclick', onDouble)
    return () => {
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('click', onClick)
      canvas.removeEventListener('dblclick', onDouble)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine])

  // ---- keyboard -----------------------------------------------------------------------------------
  useEffect(() => {
    const cancelShape = () => {
      work.current = { ...fresh(), cursor: work.current.cursor }
      if (document.activeElement instanceof HTMLElement && panel.current?.contains(document.activeElement)) {
        document.activeElement.blur()
      }
      refreshPreview()
      rerender()
    }

    // Capture phase, so Esc is handled here before anything else sees it.
    const onKey = (e: KeyboardEvent) => {
      const { sketchId: sid, tool: tl } = live.current
      if (!sid) return
      const w = work.current
      const typing = isTypingTarget(e.target)
      const inPanel = e.target instanceof Node && !!panel.current?.contains(e.target)

      if (e.key === 'Escape') {
        if (w.anchor) {
          e.preventDefault()
          e.stopPropagation()
          cancelShape()
        } else if (!typing) {
          e.preventDefault()
          finishSketch()
        }
        return
      }
      if (typing && !inPanel) return

      if (e.key === 'Enter' && !typing && tl === 'line' && w.anchor) {
        e.preventDefault()
        work.current = { ...fresh(), cursor: w.cursor }
        refreshPreview()
        rerender()
        return
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && !typing && !tl) {
        const ids = selectedRef.current
        if (ids.length) {
          e.preventDefault()
          deleteSketchEntities(sid, ids)
          useProjectStore.getState().setSelection([])
          work.current.hover = null
        }
        return
      }
      // A digit with a shape in progress starts typing the first size.
      // Focus the field synchronously and let the browser deliver this very key into it, so fast typing
      // ("40") never loses or overwrites a digit.
      if (!typing && tl && w.anchor && !e.ctrlKey && !e.metaKey && !e.altKey && /^[0-9.]$/.test(e.key)) {
        const el = panel.current?.querySelector('input')
        if (el) {
          w.editing = true
          el.focus()
          el.select()
        }
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const focusField = (i: number, caretAtEnd = false) => {
    const el = panel.current?.querySelectorAll('input')[i]
    if (!el) return
    el.focus()
    if (caretAtEnd) el.setSelectionRange(el.value.length, el.value.length)
  }

  // ---- size fields --------------------------------------------------------------------------------
  const w = work.current
  const labels = tool ? LABELS[tool] : null
  const shape = tool && w.anchor && w.cursor ? shapeFor(tool, w.anchor, w.cursor, w.fixedA, w.fixedB) : null

  const fix = (index: 0 | 1, text: string): boolean => {
    const mm = parseDisplay(text, live.current.units)
    if (mm === null || mm <= 0) return false
    const cur = work.current
    if (index === 0) {
      cur.fixedA = mm
      cur.typedA = text
    } else {
      cur.fixedB = mm
      cur.typedB = text
    }
    refreshPreview()
    rerender()
    return true
  }

  const finishFields = () => {
    const cur = work.current
    const tl = live.current.tool
    if (!tl || !cur.anchor || !cur.cursor) return
    const s = shapeFor(tl, cur.anchor, cur.cursor, cur.fixedA, cur.fixedB)
    commitRef.current(s, tl)
  }

  const onPanelKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Enter' || !(e.target instanceof HTMLInputElement)) return
    e.preventDefault()
    e.stopPropagation()
    const inputs = [...(panel.current?.querySelectorAll('input') ?? [])]
    const idx = inputs.indexOf(e.target) as 0 | 1
    if (!fix(idx, e.target.value)) return
    const cur = work.current
    const two = tool === 'rectangle'
    if (two && idx === 0 && cur.fixedB === null) {
      requestAnimationFrame(() => focusField(1))
      return
    }
    if (two && idx === 1 && cur.fixedA === null) {
      requestAnimationFrame(() => focusField(0))
      return
    }
    finishFields()
  }

  if (!sketchId || !tool || !w.anchor || !labels) return <div ref={root} className="absolute inset-0" />

  const textA = w.typedA !== '' ? w.typedA : formatDisplay(shape?.dimA ?? 0, units, 2)
  const textB = w.typedB !== '' ? w.typedB : formatDisplay(shape?.dimB ?? 0, units, 2)
  const bad = (text: string) => (text.trim() !== '' && parseDisplay(text, units) === null ? 'Enter a number.' : undefined)

  return (
    <div ref={root} className="absolute inset-0">
      <div
        ref={panel}
        role="group"
        aria-label="Shape size"
        onKeyDown={onPanelKey}
        onFocusCapture={() => {
          work.current.editing = true
        }}
        onBlurCapture={(e) => {
          if (!panel.current?.contains(e.relatedTarget as Node | null)) work.current.editing = false
        }}
        style={{
          // Next to the cursor, but kept inside the viewport (the panel is about 208 x 90 px).
          left: Math.max(8, Math.min(w.screen[0] + 18, (root.current?.clientWidth ?? 4000) - 216)),
          top: Math.max(8, Math.min(w.screen[1] + 18, (root.current?.clientHeight ?? 4000) - 98)),
        }}
        className="pointer-events-auto absolute z-10 flex w-52 flex-col gap-1.5 rounded-md bg-surface-raised p-2 shadow-panel"
      >
        <NumericInput
          layout="inline"
          label={labels[0]}
          unit={units}
          value={textA}
          error={bad(textA)}
          onValueChange={(t) => fix(0, t)}
        />
        {labels[1] ? (
          <NumericInput
            layout="inline"
            label={labels[1]}
            unit={units}
            value={textB}
            error={bad(textB)}
            onValueChange={(t) => fix(1, t)}
          />
        ) : null}
      </div>
    </div>
  )
}

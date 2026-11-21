// The drawing tools (rectangle, circle, line, arc): rubber-band preview, snapping, clicks, and the typed
// size fields. The shape is only built on commit, and goes through automatic constraints into one undo step.
import { useEffect, useReducer, useRef } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, MutableRefObject, ReactElement, RefObject } from 'react'
import { useSettings } from '../app/useSettings'
import { useProjectStore } from '../doc/store'
import type { DisplayUnit, PlaneFrame, Vec2 } from '../doc/types'
import { formatDisplay, parseDisplay } from '../doc/units'
import { isTypingTarget } from '../screens/workspace/hooks'
import { NumericInput } from '../ui/NumericInput'
import type { ViewportEngine } from '../viewport/engine'
import { commitBuilt } from './drawCommit'
import { dragState } from './drag'
import { localToWorld, noGridFor, samePoint, snapPoint, snapTargets } from './geometry'
import { finishSketch } from './session'
import { shapeFor } from './shapes'
import type { Shape, Tool } from './shapes'
import { useSketchUi } from './sketchUi'
import { initSolver, isSolverReady } from './solver/solver'

/** The latest props, for long-lived listeners. */
export interface LiveRefs {
  sketchId: string | null
  tool: Tool | null
  frame: PlaneFrame | null
  units: DisplayUnit
}

interface Work {
  anchor: Vec2 | null
  /** Arc tool: the second click (the arc's end point). */
  second: Vec2 | null
  /** First point of the current polyline, so clicking it closes the loop. */
  start: Vec2 | null
  segments: number
  prevLine: string | null
  firstLine: string | null
  cursor: Vec2 | null
  /** Pointer position in the overlay, for placing the size fields. */
  screen: [number, number]
  fixedA: number | null
  fixedB: number | null
  typedA: string
  typedB: string
  lastA: string
  lastB: string
  editing: boolean
}

const fresh = (cursor: Vec2 | null = null): Work => ({
  anchor: null,
  second: null,
  start: null,
  segments: 0,
  prevLine: null,
  firstLine: null,
  cursor,
  screen: [0, 0],
  fixedA: null,
  fixedB: null,
  typedA: '',
  typedB: '',
  lastA: '0',
  lastB: '0',
  editing: false,
})

export const TOOL_OF: Record<string, Tool> = {
  'sketch.rectangle': 'rectangle',
  'sketch.circle': 'circle',
  'sketch.line': 'line',
  'sketch.arc': 'arc',
  'sketch.polygon': 'polygon',
  'sketch.slot': 'slot',
  'sketch.ellipse': 'ellipse',
  'sketch.spline': 'spline',
}

const LABELS: Record<Tool, [string, string?]> = {
  rectangle: ['Width', 'Height'],
  circle: ['Diameter'],
  line: ['Length'],
  arc: ['Radius'],
  polygon: ['Diameter'],
  slot: ['Length', 'Width'],
  ellipse: ['Width', 'Height'],
  spline: ['Length'],
}
const NAMES: Record<Tool, string> = {
  rectangle: 'Rectangle',
  circle: 'Circle',
  line: 'Line',
  arc: 'Arc',
  polygon: 'Polygon',
  slot: 'Slot',
  ellipse: 'Ellipse',
  spline: 'Spline',
}
const NEEDS_SECOND = (t: Tool | null | undefined) => t === 'arc' || t === 'spline'
const HAS_TWO_FIELDS = (t: Tool) => t === 'rectangle' || t === 'slot' || t === 'ellipse'

export interface DrawTool {
  /** The typed-size panel, or null when no shape is in progress. */
  panel: ReactElement | null
  /** True while a shape is half drawn. */
  busy: boolean
}

export function useDrawTool(engine: ViewportEngine, live: MutableRefObject<LiveRefs>, root: RefObject<HTMLDivElement | null>): DrawTool {
  const [, rerender] = useReducer((n: number) => n + 1, 0)
  const precision = useSettings((s) => s.settings.precision)
  const work = useRef<Work>(fresh())
  const panel = useRef<HTMLDivElement>(null)
  const commitRef = useRef<(shape: Shape, tl: Tool) => void>(() => {})
  /** When the current sketch/tool became active. The click that picked the plane must not also place a point. */
  const enteredAt = useRef(0)
  const { sketchId, tool } = live.current

  const refreshPreview = () => {
    const { frame: fr, tool: tl } = live.current
    const w = work.current
    if (!fr || !tl) {
      engine.setPreview(null, [], null)
      return
    }
    const shape = w.anchor && w.cursor ? shapeFor(tl, w.anchor, w.cursor, w.fixedA, w.fixedB, w.second) : null
    engine.setPreview(fr, shape?.polylines ?? [], w.cursor)
  }

  const reset = (keepCursor = true) => {
    work.current = fresh(keepCursor ? work.current.cursor : null)
    if (document.activeElement instanceof HTMLElement && panel.current?.contains(document.activeElement)) {
      document.activeElement.blur()
    }
    refreshPreview()
    rerender()
  }

  // Tool changes and leaving the sketch reset anything half drawn.
  useEffect(() => {
    work.current = fresh()
    enteredAt.current = performance.now()
    engine.setCursor(sketchId && tool ? 'crosshair' : '')
    refreshPreview()
    rerender()
    return () => engine.setCursor('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, tool, sketchId])

  useEffect(() => () => engine.setPreview(null, [], null), [engine])

  // ---- pointer ------------------------------------------------------------------------------------
  useEffect(() => {
    const canvas = engine.canvas
    const entitiesNow = () => {
      const f = useProjectStore.getState().doc.features.find((x) => x.id === live.current.sketchId)
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
      if (work.current.start) targets.push(work.current.start)
      return snapPoint(raw, targets, ppm, { noGrid: noGridFor(useSettings.getState().settings.gridSnap, e.altKey) })
    }

    const onMove = (e: PointerEvent) => {
      const { sketchId: sid, tool: tl } = live.current
      if (!sid || !tl || e.buttons !== 0) return
      const w = work.current
      if (w.editing) return
      const c = cursorAt(e)
      if (!c) return
      const rect = root.current?.getBoundingClientRect()
      w.cursor = c.point
      w.screen = [e.clientX - (rect?.left ?? 0), e.clientY - (rect?.top ?? 0)]
      refreshPreview()
      if (w.anchor) rerender()
    }

    const commit = (shape: Shape, tl: Tool) => {
      const w = work.current
      const sid = live.current.sketchId
      const built = shape.build()
      if (!sid || !built) return
      if (!isSolverReady()) {
        // The solver is small and quick; finish the shape as soon as it has loaded.
        void initSolver().then(() => commitRef.current(shape, tl))
        return
      }
      let closing = false
      if (tl === 'line' && w.start) {
        closing = w.segments >= 2 && samePoint(shape.end, w.start)
        // Ending exactly on the start point with fewer than 3 sides would make a flat loop.
        if (!closing && w.segments < 2 && samePoint(shape.end, w.start)) return
      }
      commitBuilt(sid, built, {
        auto: useSketchUi.getState().autoConstraints,
        label: NAMES[tl],
        prevLine: tl === 'line' ? w.prevLine : null,
        closeOn: closing ? w.firstLine : null,
      })
      const keep = w.cursor
      work.current = fresh(keep)
      if (tl === 'line' && !closing) {
        const id = built.entities[0].id
        Object.assign(work.current, { anchor: shape.end, start: w.start, segments: w.segments + 1, prevLine: id, firstLine: w.firstLine ?? id })
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
      if (!sid || !tl || e.button !== 0) return
      if (dragState.suppressClick) return
      // The same click may have just opened this sketch (plane pick); it is not a drawing click.
      if (e.timeStamp <= enteredAt.current) return
      const c = cursorAt(e)
      if (!c) return
      const w = work.current
      w.cursor = c.point
      // A tap has no pointer move before it, so the size fields are placed from the click itself.
      const box = root.current?.getBoundingClientRect()
      w.screen = [e.clientX - (box?.left ?? 0), e.clientY - (box?.top ?? 0)]
      if (!w.anchor) {
        Object.assign(w, { anchor: c.point, start: c.point, segments: 0 })
        refreshPreview()
        rerender()
        return
      }
      if (NEEDS_SECOND(tl) && !w.second) {
        if (samePoint(c.point, w.anchor)) return
        w.second = c.point
        refreshPreview()
        rerender()
        return
      }
      commit(shapeFor(tl, w.anchor, c.point, w.fixedA, w.fixedB, w.second), tl)
    }

    const onDouble = () => {
      if (live.current.tool === 'line' && work.current.anchor) reset()
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
    // Capture phase, so Esc is handled here before anything else sees it.
    const onKey = (e: KeyboardEvent) => {
      const { sketchId: sid, tool: tl } = live.current
      if (!sid) return
      const w = work.current
      const typing = isTypingTarget(e.target)
      const inPanel = e.target instanceof Node && !!panel.current?.contains(e.target)
      const sizing = w.anchor !== null && (!NEEDS_SECOND(tl) || w.second !== null)

      if (e.key === 'Escape') {
        if (w.anchor) {
          e.preventDefault()
          e.stopPropagation()
          reset()
        } else if (!typing && !dragState.active) {
          // First clear what is selected, then leave the sketch.
          const ui = useSketchUi.getState()
          const store = useProjectStore.getState()
          e.preventDefault()
          if (store.selection.length || ui.selectedConstraintIds.length || ui.pending || ui.editingId) {
            store.setSelection([])
            ui.set({ selectedConstraintIds: [], pending: null, editingId: null })
          } else finishSketch()
        }
        return
      }
      if (typing && !inPanel) return

      if (e.key === 'Enter' && !typing && tl === 'line' && w.anchor) {
        e.preventDefault()
        reset()
        return
      }
      // A digit with a shape in progress starts typing the first size.
      // Focus the field synchronously and let the browser deliver this very key into it, so fast typing
      // ("40") never loses or overwrites a digit.
      if (!typing && tl && sizing && !e.ctrlKey && !e.metaKey && !e.altKey && /^[0-9.]$/.test(e.key)) {
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

  // ---- size fields --------------------------------------------------------------------------------
  const w = work.current
  const labels = tool ? LABELS[tool] : null
  const sizing = !!sketchId && !!tool && !!w.anchor && !!labels && (!NEEDS_SECOND(tool) || w.second !== null)
  if (!sizing || !tool || !labels || !w.anchor) return { panel: null, busy: w.anchor !== null }
  const units = live.current.units
  const shape = w.cursor ? shapeFor(tool, w.anchor, w.cursor, w.fixedA, w.fixedB, w.second) : null

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

  const focusField = (i: number) => panel.current?.querySelectorAll('input')[i]?.focus()

  const onPanelKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Enter' || !(e.target instanceof HTMLInputElement)) return
    e.preventDefault()
    e.stopPropagation()
    const inputs = [...(panel.current?.querySelectorAll('input') ?? [])]
    const idx = inputs.indexOf(e.target) as 0 | 1
    if (!fix(idx, e.target.value)) return
    const cur = work.current
    const two = HAS_TWO_FIELDS(tool)
    if (two && idx === 0 && cur.fixedB === null) {
      requestAnimationFrame(() => focusField(1))
      return
    }
    if (two && idx === 1 && cur.fixedA === null) {
      requestAnimationFrame(() => focusField(0))
      return
    }
    if (cur.cursor && cur.anchor) commitRef.current(shapeFor(tool, cur.anchor, cur.cursor, cur.fixedA, cur.fixedB, cur.second), tool)
  }

  if (!w.editing) {
    w.lastA = formatDisplay(shape?.dimA ?? 0, units, precision)
    w.lastB = formatDisplay(shape?.dimB ?? 0, units, precision)
  }
  const textA = w.typedA !== '' ? w.typedA : w.lastA
  const textB = w.typedB !== '' ? w.typedB : w.lastB
  const bad = (text: string) => (text.trim() !== '' && parseDisplay(text, units) === null ? 'Enter a number.' : undefined)

  return {
    busy: true,
    panel: (
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
        <NumericInput layout="inline" label={labels[0]} unit={units} value={textA} error={bad(textA)} onValueChange={(t) => fix(0, t)} />
        {labels[1] ? (
          <NumericInput layout="inline" label={labels[1]} unit={units} value={textB} error={bad(textB)} onValueChange={(t) => fix(1, t)} />
        ) : null}
      </div>
    ),
  }
}


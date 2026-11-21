// Sketch mode on top of the viewport: draws the document's sketches, hosts the drawing tools and the
// selection / drag handling, and mounts the constraint bar and the glyph + dimension overlay.
import { useEffect, useRef } from 'react'
import { useProjectStore } from '../doc/store'
import { useToast } from '../ui/Toast'
import type { ViewportEngine } from '../viewport/engine'
import { setToaster } from './actions'
import { ConstraintBar } from './ConstraintBar'
import { SketchOverlay } from './SketchOverlay'
import { useSketchUi } from './sketchUi'
import { useDefinedInfo } from './useSketchSolve'
import { TOOL_OF, useDrawTool } from './useDrawTool'
import type { LiveRefs } from './useDrawTool'
import { useLiveEntities, useSketchDrawing, useSketchFeature } from './useSketchDrawing'
import { useSelectDrag } from './useSelectDrag'
import { useTextUi } from './text/textUi'
import { TEXT_TOOL, useTextTool } from './text/useTextTool'

export interface SketchLayerProps {
  engine: ViewportEngine
}

export function SketchLayer({ engine }: SketchLayerProps) {
  const { sketchId, sketch, frame } = useSketchFeature()
  const activeTool = useProjectStore((s) => s.activeTool)
  const units = useProjectStore((s) => s.doc.units)
  const tool = activeTool ? (TOOL_OF[activeTool] ?? null) : null
  const toast = useToast()
  const root = useRef<HTMLDivElement>(null)
  const drawBusy = useRef(false)
  const entities = useLiveEntities(sketch)

  // The latest props, for the long-lived listeners in the hooks below.
  const live = useRef<LiveRefs>({ sketchId, tool, frame, units })
  live.current = { sketchId, tool, frame, units }

  useEffect(() => setToaster(toast), [toast])
  useDefinedInfo(sketch)
  useSketchDrawing(engine, sketchId, tool)

  // Camera on entering a sketch: look straight at its plane; on leaving, back to the 3D view.
  const planeName = sketch?.params.on.name
  const hasFrame = frame !== null
  useEffect(() => {
    if (sketchId && frame) engine.lookAtPlane(frame, sketch?.sketch.entities ?? [])
    else if (!sketchId) engine.leavePlaneView()
    // Only when a different sketch (or plane) opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, sketchId, planeName, hasFrame])

  // Selection and drag listeners come first, so their Esc handling runs before the drawing tools'.
  useSelectDrag(engine, live, drawBusy)
  const draw = useDrawTool(engine, live, root)
  // Placing or editing text takes the clicks: no selecting or dragging while the Text tool or its card is open.
  const textBusy = useTextUi((s) => s.session !== null) || activeTool === TEXT_TOOL
  drawBusy.current = draw.busy || textBusy
  useTextTool(engine, live)

  // Opening or leaving a sketch drops the sketch-only UI state of the previous one.
  useEffect(() => {
    useSketchUi.getState().set({
      selectedConstraintIds: [],
      hoverConstraintId: null,
      hoverRef: null,
      pending: null,
      editingId: null,
      preview: null,
      flashIds: [],
      ...(sketchId ? {} : { defined: null }),
    })
  }, [sketchId])

  return (
    <div ref={root} className="absolute inset-0">
      {sketch && frame ? (
        <>
          <SketchOverlay
            engine={engine}
            frame={frame}
            sketchId={sketch.id}
            entities={entities}
            constraints={sketch.sketch.constraints}
          />
          <ConstraintBar
            engine={engine}
            frame={frame}
            sketchId={sketch.id}
            entities={entities}
            constraints={sketch.sketch.constraints}
          />
        </>
      ) : null}
      {draw.panel}
    </div>
  )
}

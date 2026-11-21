// The Text tool in sketch mode: a click on the sketch plane starts a new text (the card opens), a click on
// existing text edits it, and Enter or a double click on selected text reopens the card. While the card is
// open the text is drawn live through the sketch preview; the document changes only when the card applies.
import { useEffect, useRef } from 'react'
import type { MutableRefObject } from 'react'
import { useSettings } from '../../app/useSettings'
import { newId } from '../../doc/commands'
import { useProjectStore } from '../../doc/store'
import type { SketchEntity, TextEntity, Vec2 } from '../../doc/types'
import { isTypingTarget } from '../../screens/workspace/hooks'
import type { ViewportEngine } from '../../viewport/engine'
import { currentSketch } from '../actions'
import { dragState } from '../drag'
import { entityAt, localToWorld, noGridFor, snapPoint, snapTargets } from '../geometry'
import { refsOfSelection, wholeEntityIds } from '../pick'
import { useSketchUi } from '../sketchUi'
import type { LiveRefs } from '../useDrawTool'
import { DEFAULT_SIZE_MM, DEFAULT_TEXT, useTextUi } from './textUi'

export const TEXT_TOOL = 'sketch.text'
const PICK_RADIUS_PX = 8

/** Circles, arcs and lines a text can follow. */
export const isPathTarget = (e: SketchEntity): boolean => e.type === 'circle' || e.type === 'arc' || e.type === 'line'

export function useTextTool(engine: ViewportEngine, live: MutableRefObject<LiveRefs>) {
  const enteredAt = useRef(0)
  const activeTool = useProjectStore((s) => s.activeTool)
  const session = useTextUi((s) => s.session)
  const features = useProjectStore((s) => s.doc.features)
  const sketchId = live.current.sketchId
  const textTool = activeTool === TEXT_TOOL

  // The click that picked the tool (or opened the sketch) does not place text.
  useEffect(() => {
    enteredAt.current = performance.now()
    if (!textTool) return
    engine.setCursor(sketchId ? 'crosshair' : '')
    return () => engine.setCursor('')
  }, [engine, textTool, sketchId])

  // Leaving the sketch (or switching sketch) drops an open card.
  useEffect(() => {
    const s = useTextUi.getState().session
    if (s && s.sketchId !== sketchId) useTextUi.getState().close()
  }, [sketchId])
  useEffect(() => () => useTextUi.getState().close(), [])

  // Live preview: the sketch with the draft in it.
  useEffect(() => {
    const ui = useSketchUi.getState()
    if (!session) {
      return
    }
    const f = features.find((x) => x.id === session.sketchId)
    if (f?.type !== 'sketch') return
    const base = f.sketch.entities
    const next = session.isNew
      ? [...base, session.draft]
      : base.map((e) => (e.id === session.draft.id ? session.draft : e))
    ui.set({ preview: next })
    return () => {
      if (useSketchUi.getState().preview === next) useSketchUi.getState().set({ preview: null })
    }
  }, [session, features])

  useEffect(() => {
    const canvas = engine.canvas

    const locate = (e: { clientX: number; clientY: number }) => {
      const { frame } = live.current
      if (!frame) return null
      const raw = engine.localPointAt(e.clientX, e.clientY, frame)
      if (!raw) return null
      const ppm = engine.pixelsPerMmAt(localToWorld(raw, frame))
      return { raw, ppm, tol: PICK_RADIUS_PX / ppm }
    }

    const open = (sketchId: string, text: TextEntity, isNew: boolean) => {
      useTextUi.getState().open({ sketchId, draft: text, isNew })
      if (!isNew) useProjectStore.getState().setSelection([])
    }

    const onClick = (e: MouseEvent) => {
      if (e.button !== 0 || dragState.suppressClick) return
      const sk = currentSketch()
      if (!sk || sk.sketchId !== live.current.sketchId) return
      const ui = useTextUi.getState()
      const tool = useProjectStore.getState().activeTool
      if (ui.pickingPath && ui.session) {
        const at = locate(e)
        if (!at) return
        const candidates = sk.sketch.entities.filter((x) => isPathTarget(x))
        const hit = entityAt(candidates, at.raw, at.tol)
        if (hit) {
          ui.change({ path: { entityId: hit.id, offset: ui.session.draft.path?.offset ?? 0, side: ui.session.draft.path?.side ?? 'outside' } })
          ui.setPicking(false)
        }
        return
      }
      if (tool !== TEXT_TOOL || ui.session) return
      if (e.timeStamp <= enteredAt.current) return
      const at = locate(e)
      if (!at) return
      const hit = entityAt(sk.sketch.entities, at.raw, at.tol)
      if (hit?.type === 'text') {
        open(sk.sketchId, hit, false)
        return
      }
      const p = snapPoint(at.raw, snapTargets(sk.sketch.entities), at.ppm, { noGrid: noGridFor(useSettings.getState().settings.gridSnap, e.altKey) })
      open(
        sk.sketchId,
        {
          id: newId(),
          type: 'text',
          construction: false,
          position: [p.point[0], p.point[1]] as Vec2,
          text: DEFAULT_TEXT,
          size: DEFAULT_SIZE_MM,
          rotation: 0,
        },
        true,
      )
    }

    const onDouble = (e: MouseEvent) => {
      const sk = currentSketch()
      if (!sk || useTextUi.getState().session || useProjectStore.getState().activeTool) return
      const at = locate(e)
      if (!at) return
      const hit = entityAt(sk.sketch.entities, at.raw, at.tol)
      if (hit?.type === 'text') open(sk.sketchId, hit, false)
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return
      if (isTypingTarget(e.target) || useTextUi.getState().session) return
      if (document.querySelector('[role="dialog"][data-state="open"]')) return
      const sk = currentSketch()
      if (!sk || sk.sketchId !== live.current.sketchId) return
      const ids = wholeEntityIds(refsOfSelection(useProjectStore.getState().selection, sk.sketchId))
      if (ids.length !== 1) return
      const t = sk.sketch.entities.find((x) => x.id === ids[0])
      if (t?.type !== 'text') return
      e.preventDefault()
      open(sk.sketchId, t, false)
    }

    canvas.addEventListener('click', onClick)
    canvas.addEventListener('dblclick', onDouble)
    window.addEventListener('keydown', onKey)
    return () => {
      canvas.removeEventListener('click', onClick)
      canvas.removeEventListener('dblclick', onDouble)
      window.removeEventListener('keydown', onKey)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine])
}

// Selection mode: hover, click-to-select points and entities, drag with a live solve, and the sketch keys
// (Delete, H, V, D, X, Esc during a drag).
import { useEffect, useRef } from 'react'
import type { MutableRefObject } from 'react'
import { useProjectStore } from '../doc/store'
import { isTypingTarget } from '../screens/workspace/hooks'
import type { ViewportEngine } from '../viewport/engine'
import { addDimension, applyConstraint, currentSketch, deleteSelected, toggleConstructionOfSelection } from './actions'
import { beginDrag, dragState, endDrag, updateDrag } from './drag'
import type { DragSession } from './drag'
import { localToWorld } from './geometry'
import { pickRef, refsOfSelection, selectionRef, toggleRef } from './pick'
import { useSketchUi } from './sketchUi'
import type { LiveRefs } from './useDrawTool'

const DRAG_START_PX = 4
const PICK_RADIUS_PX = 8

export function useSelectDrag(engine: ViewportEngine, live: MutableRefObject<LiveRefs>, drawBusy: MutableRefObject<boolean>) {
  const enteredAt = useRef(0)
  const session = useRef<DragSession | null>(null)

  // The click that opened the sketch (or picked the tool) is not a selection click.
  useEffect(() => {
    enteredAt.current = performance.now()
    useSketchUi.getState().set({ hoverRef: null })
  }, [live.current.sketchId, live.current.tool])

  useEffect(() => {
    const canvas = engine.canvas

    const locate = (e: { clientX: number; clientY: number }) => {
      const { frame } = live.current
      if (!frame) return null
      const raw = engine.localPointAt(e.clientX, e.clientY, frame)
      if (!raw) return null
      return { raw, tol: PICK_RADIUS_PX / engine.pixelsPerMmAt(localToWorld(raw, frame)) }
    }

    const picking = () => !!live.current.sketchId && !drawBusy.current

    const onMove = (e: PointerEvent) => {
      const s = session.current
      if (s) {
        if (!s.started && Math.hypot(e.clientX - s.startClient[0], e.clientY - s.startClient[1]) < DRAG_START_PX) return
        const at = locate(e)
        if (!at) return
        if (!s.started) canvas.setPointerCapture?.(e.pointerId)
        updateDrag(s, at.raw)
        return
      }
      if (e.buttons !== 0 || !picking() || live.current.tool) return
      const sk = currentSketch()
      const at = locate(e)
      if (!sk || !at) return
      const ref = pickRef(sk.sketch, at.raw, at.tol)
      if (ref !== useSketchUi.getState().hoverRef) {
        useSketchUi.getState().set({ hoverRef: ref })
        canvas.style.cursor = ref ? 'pointer' : ''
      }
    }

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || !picking()) return
      const sk = currentSketch()
      const at = locate(e)
      if (!sk || !at) return
      const ref = pickRef(sk.sketch, at.raw, at.tol)
      // The origin and the fixed axes do not move.
      if (!ref || ref === 'origin') return
      session.current = beginDrag(sk.sketchId, sk.sketch, ref, at.raw, [e.clientX, e.clientY])
    }

    const finish = (commit: boolean) => {
      const s = session.current
      session.current = null
      if (s) endDrag(s, commit)
    }
    const onUp = () => finish(true)
    const onCancel = () => finish(false)

    const onClick = (e: MouseEvent) => {
      const { sketchId: sid, tool } = live.current
      if (!sid || tool || e.button !== 0 || dragState.suppressClick) return
      if (e.timeStamp <= enteredAt.current) return
      const sk = currentSketch()
      const at = locate(e)
      if (!sk || !at) return
      const store = useProjectStore.getState()
      const ref = pickRef(sk.sketch, at.raw, at.tol)
      useSketchUi.getState().set({ selectedConstraintIds: [], pending: null, editingId: null })
      if (!ref) {
        if (!e.shiftKey) store.setSelection([])
        return
      }
      const current = refsOfSelection(store.selection, sid)
      const next = e.shiftKey ? toggleRef(current, ref) : [ref]
      store.setSelection(next.map((r) => selectionRef(sid, r)))
    }

    // Esc during a drag puts everything back. Capture phase and first in line, before the sketch Esc handling.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && session.current) {
        e.preventDefault()
        e.stopImmediatePropagation()
        finish(false)
        return
      }
      if (!live.current.sketchId || drawBusy.current || isTypingTarget(e.target) || e.ctrlKey || e.metaKey || e.altKey) return
      if (document.querySelector('[role="dialog"][data-state="open"]')) return
      const key = e.key.toLowerCase()
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (deleteSelected()) e.preventDefault()
      } else if (key === 'h' || key === 'v') {
        if (useProjectStore.getState().selection.length === 0) return
        e.preventDefault()
        e.stopPropagation()
        applyConstraint(key === 'h' ? 'horizontal' : 'vertical')
      } else if (key === 'd') {
        e.preventDefault()
        e.stopPropagation()
        addDimension()
      } else if (key === 'x') {
        e.preventDefault()
        e.stopPropagation()
        toggleConstructionOfSelection()
      }
    }

    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointerup', onUp)
    canvas.addEventListener('pointercancel', onCancel)
    canvas.addEventListener('click', onClick)
    window.addEventListener('keydown', onKey, true)
    return () => {
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('pointercancel', onCancel)
      canvas.removeEventListener('click', onClick)
      window.removeEventListener('keydown', onKey, true)
      session.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine])
}

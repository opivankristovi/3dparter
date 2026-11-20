// The History list: the steps of the design, the "End of history" marker and everything that moves them.
// Rows reorder by dragging (mouse, pen, or the grip with a finger), Alt+ArrowUp / Alt+ArrowDown, or the row menu.
// The marker is a bar between the rows; steps after it are not built and show dimmed.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { History, MoreHorizontal } from 'lucide-react'
import { deleteFeature, moveFeature, renameFeature, setRollback } from '../../doc/commands'
import { canMove } from '../../doc/history'
import { useHistoryNotice } from '../../doc/moveGuard'
import { useProjectStore } from '../../doc/store'
import type { Feature } from '../../doc/types'
import { ConstraintList } from '../../sketch/ConstraintList'
import { Button } from '../../ui/Button'
import { ContextMenu } from '../../ui/ContextMenu'
import { DropdownMenu } from '../../ui/DropdownMenu'
import type { MenuEntry } from '../../ui/DropdownMenu'
import { EmptyState } from '../../ui/EmptyState'
import { IconButton } from '../../ui/IconButton'
import { useToast } from '../../ui/Toast'
import { Tree } from '../../ui/Tree'
import type { TreeNode } from '../../ui/Tree'
import { cn } from '../../ui/cn'

/** A History row is one `h-7` tall: 1.75rem. The marker bar sits in a gap of the same height. */
const ROW_REM = 1.75
/** Pointer travel before a press becomes a drag. */
const DRAG_START = 4
/** Distance from the edge of the scrolling panel where dragging scrolls it, and the fastest step. */
const SCROLL_EDGE = 32
const SCROLL_MAX = 14

function scrollParent(el: HTMLElement | null): HTMLElement | null {
  for (let p = el?.parentElement ?? null; p; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY
    if ((oy === 'auto' || oy === 'scroll') && p.scrollHeight > p.clientHeight) return p
  }
  return null
}

/** Scrolls the panel while the pointer is near its top or bottom edge. Returns the stop function. */
function autoScroll(host: HTMLElement | null, getY: () => number, onScrolled: () => void): () => void {
  const panel = scrollParent(host)
  if (!panel) return () => {}
  let live = true
  let raf = 0
  const tick = () => {
    if (!live) return
    const r = panel.getBoundingClientRect()
    const y = getY()
    let dy = 0
    if (y < r.top + SCROLL_EDGE) dy = -Math.ceil(SCROLL_MAX * Math.min(1, (r.top + SCROLL_EDGE - y) / SCROLL_EDGE))
    else if (y > r.bottom - SCROLL_EDGE) dy = Math.ceil(SCROLL_MAX * Math.min(1, (y - (r.bottom - SCROLL_EDGE)) / SCROLL_EDGE))
    if (dy !== 0) {
      const before = panel.scrollTop
      panel.scrollTop += dy
      if (panel.scrollTop !== before) onScrolled()
    }
    raf = requestAnimationFrame(tick)
  }
  raf = requestAnimationFrame(tick)
  return () => {
    live = false
    cancelAnimationFrame(raf)
  }
}

interface Drop {
  toIndex: number
  /** Whether the step ends up before the marker. */
  active: boolean
  /** Where the insertion line goes, in px from the top of the list. */
  top: number
  /** The step ends up where it already is. */
  same: boolean
}

interface HistoryTabProps {
  statuses?: Record<string, { ok: boolean; message?: string; warning?: string }>
  icons: (type: Feature['type']) => ReactNode
}

export function HistoryList({ statuses, icons }: HistoryTabProps) {
  const features = useProjectStore((s) => s.doc.features)
  const rollbackIndex = useProjectStore((s) => s.doc.rollbackIndex)
  const editingId = useProjectStore((s) => s.editingFeatureId)
  const setEditing = useProjectStore((s) => s.setEditingFeature)
  const announcement = useHistoryNotice((s) => s.announcement)
  const announce = useHistoryNotice((s) => s.announce)
  const toast = useToast()

  const n = features.length
  const committed = rollbackIndex === null ? n : Math.min(n, Math.max(0, rollbackIndex + 1))
  const [markerDrag, setMarkerDrag] = useState<number | null>(null)
  const shown = markerDrag ?? committed
  const [dragId, setDragId] = useState<string | null>(null)
  const [line, setLine] = useState<{ top: number; ok: boolean } | null>(null)
  const [menuId, setMenuId] = useState<string | null>(null)

  const wrapRef = useRef<HTMLDivElement>(null)
  const markerRef = useRef<HTMLDivElement>(null)
  const suppressClick = useRef(false)
  const live = useRef({ n, committed })
  live.current = { n, committed }

  // ---- what the user is told ---------------------------------------------------------------------------

  const refuse = useCallback(
    (message: string) => {
      toast({ title: message })
      announce(message)
    },
    [toast, announce],
  )

  const focusRow = (id: string) => {
    requestAnimationFrame(() => wrapRef.current?.querySelector<HTMLElement>(`[data-tree-id="${CSS.escape(id)}"]`)?.focus())
  }

  const moveTo = useCallback(
    (id: string, toIndex: number, active?: boolean) => {
      const r = moveFeature(id, toIndex, active === undefined ? undefined : { active })
      if (r.ok) announce(r.message)
      else refuse(r.message)
      return r.ok
    },
    [announce, refuse],
  )

  const moveBy = useCallback(
    (id: string, delta: -1 | 1) => {
      const from = useProjectStore.getState().doc.features.findIndex((f) => f.id === id)
      const to = from + delta
      if (from < 0 || to < 0 || to >= useProjectStore.getState().doc.features.length) return
      moveTo(id, to)
      focusRow(id)
    },
    [moveTo],
  )

  const rollBackTo = useCallback(
    (index: number | null) => {
      setRollback(index)
      const f = useProjectStore.getState().doc.features
      if (index === null || index >= f.length - 1) announce('Showing all steps.')
      else if (index < 0) announce('No steps are active.')
      else announce(`Steps after ${f[index].name} are inactive.`)
    },
    [announce],
  )

  // ---- dragging a row ----------------------------------------------------------------------------------

  const computeDrop = useCallback((y: number, from: number): Drop | null => {
    const wrap = wrapRef.current
    const marker = markerRef.current
    if (!wrap || !marker) return null
    const { n: count, committed: p } = live.current
    const wr = wrap.getBoundingClientRect()
    const rects = [...wrap.querySelectorAll<HTMLElement>('[data-tree-id]')].map((r) => r.getBoundingClientRect())
    let gap = 0
    for (const r of rects) if (y > r.top + r.height / 2) gap++
    const m = marker.getBoundingClientRect()
    let active: boolean
    let top: number
    if (gap === p) {
      active = p === count ? true : y < m.top + m.height / 2
      top = (active ? m.top : m.bottom) - wr.top
    } else {
      active = gap < p
      top = gap < count ? rects[gap].top - wr.top : rects[count - 1].bottom - wr.top
    }
    const toIndex = gap > from ? gap - 1 : gap
    return { toIndex, active, top, same: toIndex === from && active === from < p }
  }, [])

  const startRowDrag = useCallback(
    (id: string, e: ReactPointerEvent) => {
      const from = useProjectStore.getState().doc.features.findIndex((f) => f.id === id)
      if (from < 0) return
      const pointerId = e.pointerId
      const sx = e.clientX
      const sy = e.clientY
      let y = e.clientY
      let started = false
      let stopScroll = () => {}

      const refresh = () => {
        const d = computeDrop(y, from)
        if (!d || d.same) return setLine(null)
        setLine({ top: d.top, ok: canMove(useProjectStore.getState().doc, from, d.toIndex).ok })
      }
      const cleanup = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onCancel)
        window.removeEventListener('keydown', onKey, true)
        stopScroll()
      }
      const finish = (drop: boolean) => {
        cleanup()
        if (!started) return
        // The click that ends a drag must not open the row.
        suppressClick.current = true
        setTimeout(() => (suppressClick.current = false), 0)
        setDragId(null)
        setLine(null)
        if (!drop) return
        const d = computeDrop(y, from)
        if (d && !d.same) moveTo(id, d.toIndex, d.active)
      }
      const onMove = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return
        y = ev.clientY
        if (!started) {
          if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < DRAG_START) return
          started = true
          setDragId(id)
          window.getSelection()?.removeAllRanges()
          stopScroll = autoScroll(wrapRef.current, () => y, refresh)
        }
        ev.preventDefault()
        refresh()
      }
      const onUp = (ev: PointerEvent) => {
        if (ev.pointerId === pointerId) finish(true)
      }
      const onCancel = (ev: PointerEvent) => {
        if (ev.pointerId === pointerId) finish(false)
      }
      const onKey = (ev: globalThis.KeyboardEvent) => {
        if (ev.key !== 'Escape' || !started) return
        ev.stopPropagation()
        finish(false)
      }
      window.addEventListener('pointermove', onMove, { passive: false })
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onCancel)
      window.addEventListener('keydown', onKey, true)
    },
    [computeDrop, moveTo],
  )

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !e.isPrimary) return
    const t = e.target as HTMLElement
    const row = t.closest<HTMLElement>('[data-tree-id]')
    if (!row || t.closest('input')) return
    const grip = t.closest('[data-grip]')
    // A finger scrolls the panel: only the grip starts a drag. A mouse or pen can take the whole row.
    if (e.pointerType === 'touch' && !grip) return
    if (!grip && t.closest('button')) return
    startRowDrag(row.dataset.treeId!, e)
  }

  // ---- dragging and keying the marker -------------------------------------------------------------------

  const markerGrab = useRef<{ pointerId: number; grab: number; stop: () => void; lastY: number } | null>(null)
  const countFromY = (clientY: number, grab: number) => {
    const wrap = wrapRef.current
    if (!wrap) return live.current.committed
    const first = wrap.querySelector<HTMLElement>('[data-tree-id]')
    const rowPx = first ? first.getBoundingClientRect().height : 28
    const top = clientY - grab - wrap.getBoundingClientRect().top
    return Math.min(live.current.n, Math.max(0, Math.round(top / rowPx)))
  }
  const onMarkerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const grab = e.clientY - e.currentTarget.getBoundingClientRect().top
    const g = { pointerId: e.pointerId, grab, lastY: e.clientY, stop: () => {} }
    g.stop = autoScroll(wrapRef.current, () => g.lastY, () => setMarkerDrag(countFromY(g.lastY, g.grab)))
    markerGrab.current = g
  }
  const onMarkerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const g = markerGrab.current
    if (!g || g.pointerId !== e.pointerId) return
    g.lastY = e.clientY
    const c = countFromY(e.clientY, g.grab)
    setMarkerDrag((cur) => (cur === c ? cur : c))
  }
  const endMarkerDrag = (e: ReactPointerEvent<HTMLDivElement>, commit: boolean) => {
    const g = markerGrab.current
    if (!g || g.pointerId !== e.pointerId) return
    markerGrab.current = null
    g.stop()
    const c = countFromY(e.clientY, g.grab)
    setMarkerDrag(null)
    if (commit && c !== live.current.committed) rollBackTo(c - 1)
  }
  const onMarkerKey = (e: KeyboardEvent<HTMLDivElement>) => {
    let c: number
    if (e.key === 'ArrowUp') c = committed - 1
    else if (e.key === 'ArrowDown') c = committed + 1
    else if (e.key === 'Home') c = 0
    else if (e.key === 'End') c = n
    else return
    e.preventDefault()
    c = Math.min(n, Math.max(0, c))
    if (c !== committed) rollBackTo(c - 1)
  }

  // ---- rows ----------------------------------------------------------------------------------------------

  const open = useCallback(
    (id: string) => {
      const at = useProjectStore.getState().doc.features.findIndex((f) => f.id === id)
      if (at >= live.current.committed) {
        refuse('That step is after the end of history. Show all steps to edit it.')
        return
      }
      setEditing(id)
    },
    [setEditing, refuse],
  )

  // The menu closes itself after an item runs. Changing the list in the same turn moves the row that owns the menu
  // while it is closing, which can leave it open, so the change waits one turn.
  const later = (fn: () => void) => () => void setTimeout(fn, 0)
  const rowItems = (id: string | null): MenuEntry[] => {
    const idx = features.findIndex((f) => f.id === id)
    if (!id || idx < 0) return []
    return [
      { label: 'Edit', disabled: idx >= committed, onSelect: later(() => open(id)) },
      { type: 'separator' },
      { label: 'Move up', shortcut: 'Alt+Up', disabled: idx === 0, onSelect: later(() => moveBy(id, -1)) },
      { label: 'Move down', shortcut: 'Alt+Down', disabled: idx === n - 1, onSelect: later(() => moveBy(id, 1)) },
      { label: 'Roll back to here', disabled: committed === idx + 1, onSelect: later(() => rollBackTo(idx)) },
      { type: 'separator' },
      { label: 'Delete', shortcut: 'Del', danger: true, onSelect: later(() => deleteFeature(id)) },
    ]
  }

  const nodes: TreeNode[] = features.map((f, idx) => {
    const st = idx < shown ? statuses?.[f.id] : undefined
    return {
      id: f.id,
      label: f.name,
      icon: icons(f.type),
      suppressed: f.suppressed,
      beyondRollback: idx >= shown,
      spaceBefore: idx === shown,
      dragging: dragId === f.id,
      error: st && !st.ok ? (st.message ?? 'This step could not be built.') : undefined,
      warning: st?.ok ? st.warning : undefined,
      trailing: (
        <span onClick={(e) => e.stopPropagation()} className="flex">
          <DropdownMenu
            align="end"
            items={rowItems(f.id)}
            trigger={
              <IconButton
                label={`Actions for ${f.name}`}
                size={28}
                tabIndex={-1}
                icon={<MoreHorizontal size={16} strokeWidth={1.75} />}
                className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 pointer-coarse:opacity-100"
              />
            }
          />
        </span>
      ),
    }
  })

  // The click that ends a drag, and rows after the marker, do not open anything.
  const onClickCapture = (e: React.MouseEvent) => {
    if (suppressClick.current) {
      e.stopPropagation()
      e.preventDefault()
    }
  }

  // Escape-free cleanup if the list goes away mid-drag is handled by the window listeners' own removal on finish.
  useEffect(() => () => markerGrab.current?.stop(), [])

  if (n === 0) {
    return (
      <EmptyState
        icon={<History strokeWidth={1.75} />}
        title="Nothing here yet"
        description="Every sketch and solid you make shows up here, ready to edit."
      />
    )
  }

  const markerText =
    shown >= n ? 'After the last step: every step is shown' : shown === 0 ? 'Before the first step' : `After ${features[shown - 1].name}`

  return (
    <>
      <ContextMenu items={rowItems(menuId)}>
        <div
          onContextMenuCapture={(e) => {
            const row = (e.target as HTMLElement).closest<HTMLElement>('[data-tree-id]')
            setMenuId(row?.dataset.treeId ?? null)
          }}
        >
          <div
            ref={wrapRef}
            onPointerDown={onPointerDown}
            onClickCapture={onClickCapture}
            className={cn('relative', shown >= n && 'pb-7', dragId && 'select-none')}
          >
            <Tree
              label="History"
              nodes={nodes}
              selectedId={editingId ?? undefined}
              onSelect={open}
              onRename={renameFeature}
              onDelete={deleteFeature}
              onMoveRow={moveBy}
              reorderable
            />
            <div
              ref={markerRef}
              style={{ top: `${shown * ROW_REM}rem` }}
              className="absolute inset-x-0 z-10 flex h-7 items-center gap-1 border-y border-accent bg-accent-subtle"
            >
              <div
                role="slider"
                tabIndex={0}
                aria-label="End of history"
                aria-orientation="vertical"
                aria-valuemin={0}
                aria-valuemax={n}
                aria-valuenow={shown}
                aria-valuetext={markerText}
                onKeyDown={onMarkerKey}
                onPointerDown={onMarkerDown}
                onPointerMove={onMarkerMove}
                onPointerUp={(e) => endMarkerDrag(e, true)}
                onPointerCancel={(e) => endMarkerDrag(e, false)}
                className="flex h-full min-w-0 flex-1 cursor-grab touch-none items-center px-2 text-sm font-medium text-accent select-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus active:cursor-grabbing"
              >
                <span className="truncate">End of history</span>
              </div>
              {committed < n ? (
                <Button size="sm" variant="ghost" className="mr-1 shrink-0" onClick={() => rollBackTo(null)}>
                  Show all steps
                </Button>
              ) : null}
            </div>
            {line ? (
              <span
                aria-hidden="true"
                data-drop-line={line.ok ? 'ok' : 'blocked'}
                style={{ top: line.top - 1 }}
                className={cn('pointer-events-none absolute inset-x-0 z-20 h-0.5', line.ok ? 'bg-accent' : 'bg-danger')}
              />
            ) : null}
          </div>
        </div>
      </ContextMenu>
      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>
      <ConstraintList />
    </>
  )
}

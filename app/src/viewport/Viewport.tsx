import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Check } from 'lucide-react'
import { ViewportEngine } from './engine'
import type { BoxFrame } from './engine'
import { cn } from '../ui/cn'
import { KbdChip } from '../ui/KbdChip'

export interface ViewportMenuItem {
  label: string
  shortcut?: string
  checked?: boolean
  disabled?: boolean
  onSelect: () => void
}

export interface ViewportProps {
  /** Receives the engine once the canvas is ready, and null when it is torn down. */
  onEngine: (engine: ViewportEngine | null) => void
  /** Items shown in the floating menu on stationary right-click in the viewport. */
  contextMenuItems?: ViewportMenuItem[]
  /** Overlay content (sketch inputs and the like), drawn above the canvas. It must opt in to pointer events. */
  children?: ReactNode
}

/** One canvas. The three.js scene lives in ViewportEngine and is driven from outside. */
export function Viewport({ onEngine, contextMenuItems, children }: ViewportProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const rightDown = useRef<{ x: number; y: number; dragged: boolean } | null>(null)
  const [failed, setFailed] = useState(false)
  const [boxFrame, setBoxFrame] = useState<BoxFrame | null>(null)
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null)
  const report = useRef(onEngine)
  report.current = onEngine

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let engine: ViewportEngine
    try {
      engine = new ViewportEngine(canvas)
    } catch {
      setFailed(true)
      return
    }
    engine.onBoxFrame = setBoxFrame
    report.current(engine)
    return () => {
      engine.onBoxFrame = null
      report.current(null)
      engine.dispose()
    }
  }, [])

  useEffect(() => {
    if (!menuPos) return
    const first = menuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')
    first?.focus()
    const onDown = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuPos(null)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        setMenuPos(null)
        canvasRef.current?.focus()
      }
    }
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [menuPos])

  const openMenuAt = (clientX: number, clientY: number) => {
    if (!contextMenuItems?.length || !rootRef.current) return
    const rect = rootRef.current.getBoundingClientRect()
    const x = Math.max(8, Math.min(clientX - rect.left, Math.max(8, rect.width - 216)))
    const y = Math.max(8, Math.min(clientY - rect.top, Math.max(8, rect.height - 260)))
    setMenuPos({ x, y })
  }

  return (
    <div ref={rootRef} className="absolute inset-0 overflow-hidden">
      <canvas
        ref={canvasRef}
        aria-label="3D view of the model"
        tabIndex={0}
        className="block size-full touch-none outline-none"
        onPointerDownCapture={(e) => {
          if (e.button === 2) {
            rightDown.current = { x: e.clientX, y: e.clientY, dragged: false }
          } else {
            setMenuPos(null)
          }
        }}
        onPointerMoveCapture={(e) => {
          if (rightDown.current && Math.hypot(e.clientX - rightDown.current.x, e.clientY - rightDown.current.y) > 4) {
            rightDown.current.dragged = true
          }
        }}
        onPointerUpCapture={(e) => {
          if (e.button === 2 && rightDown.current) {
            const dragged = rightDown.current.dragged
            rightDown.current = null
            if (!dragged) openMenuAt(e.clientX, e.clientY)
          }
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          if (e.clientX === 0 && e.clientY === 0 && rootRef.current) {
            const rect = rootRef.current.getBoundingClientRect()
            openMenuAt(rect.left + rect.width / 2, rect.top + rect.height / 2)
          }
        }}
      />
      {failed ? (
        <p role="alert" className="absolute inset-0 flex items-center justify-center p-8 text-center text-text-muted">
          The 3D view could not start. Check that hardware acceleration is turned on in your browser.
        </p>
      ) : null}
      {boxFrame ? (
        <div
          aria-hidden="true"
          data-box-select={boxFrame.crossing ? 'crossing' : 'enclosed'}
          style={{ left: boxFrame.left, top: boxFrame.top, width: boxFrame.width, height: boxFrame.height }}
          className={cn(
            'pointer-events-none absolute z-10 border border-accent bg-accent-subtle/20',
            boxFrame.crossing ? 'border-dashed' : 'border-solid',
          )}
        />
      ) : null}
      {menuPos && contextMenuItems?.length ? (
        <div
          ref={menuRef}
          role="menu"
          aria-label="Viewport menu"
          style={{ left: menuPos.x, top: menuPos.y }}
          className="absolute z-40 min-w-48 rounded-md border border-border bg-surface-raised p-1 text-base shadow-pop"
        >
          {contextMenuItems.map((item) => (
            <button
              key={item.label}
              type="button"
              role={item.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
              aria-checked={item.checked}
              disabled={item.disabled}
              onClick={() => {
                setMenuPos(null)
                item.onSelect()
              }}
              className="touch-hit-h flex h-7 w-full items-center gap-2 rounded-sm px-2 text-left text-text outline-none hover:bg-surface-sunken focus-visible:bg-surface-sunken disabled:text-text-disabled"
            >
              <span className="inline-flex size-4 shrink-0 items-center justify-center">
                {item.checked ? <Check size={14} strokeWidth={2} aria-hidden="true" /> : null}
              </span>
              <span className="flex-1 truncate">{item.label}</span>
              {item.shortcut ? <KbdChip>{item.shortcut}</KbdChip> : null}
            </button>
          ))}
        </div>
      ) : null}
      <div className="pointer-events-none absolute inset-0">{children}</div>
    </div>
  )
}

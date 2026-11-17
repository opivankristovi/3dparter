import { useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent, ReactNode } from 'react'
import { Tabs } from 'radix-ui'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { IconButton } from './IconButton'
import { cn } from './cn'
import { layoutPx } from './layout'

export interface SidebarTab {
  value: string
  label: string
  content: ReactNode
}

export interface SidebarPanelProps {
  tabs: SidebarTab[]
  value: string
  onValueChange: (value: string) => void
  /** Collapsed to the tab strip when false. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  className?: string
}

const STEP = 16

export function SidebarPanel({ tabs, value, onValueChange, open = true, onOpenChange, className }: SidebarPanelProps) {
  const min = layoutPx('sidebar-min', 220)
  const max = layoutPx('sidebar-max', 480)
  const [width, setWidth] = useState(() => layoutPx('sidebar-w', 280))
  const [dragging, setDragging] = useState(false)
  const start = useRef({ x: 0, w: 0 })

  const clamp = (w: number) => Math.min(max, Math.max(min, w))

  // The panel sits on the right, so dragging the edge left makes it wider.
  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    start.current = { x: e.clientX, w: width }
    setDragging(true)
  }
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (dragging) setWidth(clamp(start.current.w + (start.current.x - e.clientX)))
  }
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowLeft') setWidth((w) => clamp(w + STEP))
    else if (e.key === 'ArrowRight') setWidth((w) => clamp(w - STEP))
    else return
    e.preventDefault()
  }

  return (
    <Tabs.Root
      value={value}
      onValueChange={(v) => {
        onValueChange(v)
        if (!open) onOpenChange?.(true)
      }}
      style={{ width }}
      className={cn('relative flex flex-col overflow-hidden rounded-lg bg-surface-raised shadow-panel', className)}
    >
      {open ? (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          aria-valuenow={width}
          aria-valuemin={min}
          aria-valuemax={max}
          tabIndex={0}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={() => setDragging(false)}
          onKeyDown={onKey}
          className={cn(
            'absolute inset-y-0 left-0 z-10 w-1.5 cursor-col-resize touch-none transition-colors duration-(--motion-fast) hover:bg-accent/40',
            dragging && 'bg-accent',
          )}
        />
      ) : null}
      <div className="flex items-center border-b border-border pr-1">
        <Tabs.List aria-label="Sidebar" className="flex flex-1">
          {tabs.map((t) => (
            <Tabs.Trigger
              key={t.value}
              value={t.value}
              className="touch-hit-h h-10 border-b-2 border-transparent px-3 text-base font-medium text-text-muted hover:text-text data-[state=active]:border-accent data-[state=active]:text-text"
            >
              {t.label}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        <IconButton
          label={open ? 'Collapse sidebar' : 'Expand sidebar'}
          size={28}
          icon={open ? <ChevronUp size={16} strokeWidth={1.75} /> : <ChevronDown size={16} strokeWidth={1.75} />}
          onClick={() => onOpenChange?.(!open)}
        />
      </div>
      {open
        ? tabs.map((t) => (
            <Tabs.Content key={t.value} value={t.value} className="min-h-0 flex-1 overflow-auto p-1">
              {t.content}
            </Tabs.Content>
          ))
        : null}
    </Tabs.Root>
  )
}

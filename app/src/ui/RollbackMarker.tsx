import { useRef } from 'react'
import type { KeyboardEvent, PointerEvent } from 'react'
import { cn } from './cn'

export interface RollbackMarkerProps {
  /** Rows above the marker (0..max): "edit as of step N". */
  value: number
  max: number
  onChange: (value: number) => void
  /** Row height in px; the marker is positioned absolutely at value * rowHeight in a relative parent. */
  rowHeight?: number
  className?: string
}

export function RollbackMarker({ value, max, onChange, rowHeight = 28, className }: RollbackMarkerProps) {
  const drag = useRef<{ y: number; v: number } | null>(null)

  const clamp = (v: number) => Math.min(max, Math.max(0, v))
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowUp') onChange(clamp(value - 1))
    else if (e.key === 'ArrowDown') onChange(clamp(value + 1))
    else return
    e.preventDefault()
  }
  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { y: e.clientY, v: value }
  }
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return
    const next = clamp(drag.current.v + Math.round((e.clientY - drag.current.y) / rowHeight))
    if (next !== value) onChange(next)
  }

  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label="Edit as of step"
      aria-orientation="vertical"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={value === max ? 'Latest step' : `After step ${value}`}
      onKeyDown={onKey}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={() => (drag.current = null)}
      style={{ top: value * rowHeight - 5 }}
      className={cn('absolute inset-x-0 z-10 flex h-2.5 cursor-grab touch-none items-center active:cursor-grabbing', className)}
    >
      <span className="h-0.5 flex-1 bg-accent" />
      <span className="mr-1 h-2.5 w-5 rounded-pill bg-accent" />
    </div>
  )
}

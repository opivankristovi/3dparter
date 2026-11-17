import { useEffect, useId, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent } from 'react'
import { cn } from './cn'

const PLAIN_NUMBER = /^[-+]?(\d+\.?\d*|\.\d+)$/

export function isPlainNumber(text: string): boolean {
  return PLAIN_NUMBER.test(text.trim())
}

function fmt(n: number): string {
  return String(Number(n.toFixed(10)))
}

export interface NumericInputProps {
  label: string
  /** Stored as text (a number or, later, an expression). */
  value: string
  onValueChange?: (value: string) => void
  unit?: string
  step?: number
  /** Shown as "= …" below the field when the value is an expression. */
  resolvedValue?: string
  /** External error message (e.g. unknown variable). */
  error?: string
  disabled?: boolean
  /** Driven dimension. */
  readOnly?: boolean
  layout?: 'stacked' | 'inline'
  className?: string
}

export function NumericInput({
  label,
  value,
  onValueChange,
  unit,
  step = 1,
  resolvedValue,
  error,
  disabled,
  readOnly,
  layout = 'stacked',
  className,
}: NumericInputProps) {
  const id = useId()
  const hintId = `${id}-hint`
  const errId = `${id}-err`
  const [draft, setDraft] = useState(value)
  const drag = useRef<{ x: number; start: number } | null>(null)

  useEffect(() => setDraft(value), [value])

  const isExpr = draft.trim() !== '' && !isPlainNumber(draft)
  const showHint = isExpr && resolvedValue !== undefined && !error
  const describedBy = [error ? errId : null, showHint ? hintId : null].filter(Boolean).join(' ') || undefined

  const commit = (text: string) => {
    if (text !== value) onValueChange?.(text)
  }

  const nudge = (dir: 1 | -1, e: { shiftKey: boolean; altKey: boolean }) => {
    if (!isPlainNumber(draft)) return
    const mult = e.shiftKey ? 10 : e.altKey ? 0.1 : 1
    const next = fmt(parseFloat(draft) + dir * step * mult)
    setDraft(next)
    commit(next)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      commit(draft)
      e.currentTarget.select()
    } else if (e.key === 'Escape') {
      setDraft(value)
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault()
      nudge(e.key === 'ArrowUp' ? 1 : -1, e)
    }
  }

  // Scrub by dragging the label: 1 step per 4px.
  const onLabelDown = (e: PointerEvent<HTMLLabelElement>) => {
    if (disabled || readOnly || !isPlainNumber(draft)) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { x: e.clientX, start: parseFloat(draft) }
  }
  const onLabelMove = (e: PointerEvent<HTMLLabelElement>) => {
    if (!drag.current) return
    const mult = e.shiftKey ? 10 : e.altKey ? 0.1 : 1
    const steps = Math.trunc((e.clientX - drag.current.x) / 4)
    setDraft(fmt(drag.current.start + steps * step * mult))
  }
  const onLabelUp = () => {
    if (!drag.current) return
    drag.current = null
    commit(draft)
  }

  return (
    <div className={cn(layout === 'inline' ? 'grid grid-cols-[88px_1fr] items-start gap-2' : 'flex flex-col gap-1', className)}>
      <label
        htmlFor={id}
        onPointerDown={onLabelDown}
        onPointerMove={onLabelMove}
        onPointerUp={onLabelUp}
        className={cn(
          'select-none text-xs text-text-muted',
          layout === 'inline' && 'pt-1.5',
          !disabled && !readOnly && 'cursor-ew-resize',
        )}
      >
        {label}
      </label>
      <div className="flex flex-col gap-1">
        <div
          className={cn(
            'touch-hit-h flex h-7 items-center gap-1.5 rounded-sm border px-2 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-focus',
            error ? 'border-danger' : 'border-border-input hover:border-text-muted',
            disabled ? 'bg-surface-sunken text-text-disabled' : readOnly ? 'bg-surface-sunken' : 'bg-bg',
          )}
        >
          {isExpr ? (
            <span aria-hidden="true" className="text-xs italic text-accent">
              fx
            </span>
          ) : null}
          <input
            id={id}
            inputMode="decimal"
            autoComplete="off"
            spellCheck={false}
            value={draft}
            disabled={disabled}
            readOnly={readOnly}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            onFocus={(e) => e.currentTarget.select()}
            onBlur={() => commit(draft)}
            className="min-w-0 flex-1 bg-transparent text-base tnum outline-none disabled:cursor-not-allowed"
          />
          {unit ? <span className="text-sm text-text-muted">{unit}</span> : null}
        </div>
        {showHint ? (
          <p id={hintId} className="text-xs text-text-muted tnum">
            = {resolvedValue}
          </p>
        ) : null}
        {error ? (
          <p id={errId} className="text-xs text-danger">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  )
}

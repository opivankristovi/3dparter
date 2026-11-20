import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent } from 'react'
import { applySuggestion, suggestNames } from '../doc/fieldInput'
import type { Candidate } from '../doc/fieldInput'
import { cn } from './cn'

const PLAIN_NUMBER = /^[-+]?(\d+\.?\d*|\.\d+)$/

export function isPlainNumber(text: string): boolean {
  return PLAIN_NUMBER.test(text.trim())
}

function fmt(n: number): string {
  return String(Number(n.toFixed(10)))
}

/** What the field says about the text being typed: a preview ("25 mm") or an error. */
export interface FieldFeedback {
  preview?: string
  error?: string
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
  /** Looks at the text while it is typed (before it is committed) and gives a preview or an error. */
  check?: (text: string) => FieldFeedback
  /** Variable names offered while a name is being typed. Turns on the suggestion list. */
  suggestions?: readonly Candidate[]
  /** Called on every keystroke with the text now in the field. */
  onDraftChange?: (text: string) => void
  /** The label is read by screen readers but not shown (the field sits under a heading or in a row). */
  hideLabel?: boolean
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
  check,
  suggestions,
  onDraftChange,
  hideLabel,
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

  const input = useRef<HTMLInputElement>(null)
  const listId = `${id}-list`
  const [caret, setCaret] = useState(0)
  const [listOpen, setListOpen] = useState(false)
  const [active, setActive] = useState(0)
  /** Where the caret goes after a suggestion replaced a word. */
  const nextCaret = useRef<number | null>(null)

  useEffect(() => setDraft(value), [value])
  useLayoutEffect(() => {
    if (nextCaret.current === null) return
    input.current?.setSelectionRange(nextCaret.current, nextCaret.current)
    nextCaret.current = null
  })

  const isExpr = draft.trim() !== '' && !isPlainNumber(draft)
  const feedback = check && draft.trim() !== '' ? check(draft) : undefined
  const shownError = error ?? feedback?.error
  const preview = feedback?.preview ?? (isExpr ? resolvedValue : undefined)
  const showHint = isExpr && preview !== undefined && !shownError
  const describedBy = [shownError ? errId : null, showHint ? hintId : null].filter(Boolean).join(' ') || undefined

  const found = suggestions && listOpen ? suggestNames(draft, caret, suggestions) : null
  const items = found?.items ?? []
  const open = items.length > 0
  const activeIndex = Math.min(active, items.length - 1)
  const accept = (name: string) => {
    if (!found) return
    const r = applySuggestion(draft, found, name)
    nextCaret.current = r.caret
    setDraft(r.text)
    setCaret(r.caret)
    setListOpen(false)
    setActive(0)
    input.current?.focus()
  }

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
    if (open) {
      // The suggestion list owns these keys while it is open.
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        e.stopPropagation()
        setActive((activeIndex + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        e.stopPropagation()
        accept(items[activeIndex].name)
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        setListOpen(false)
        return
      }
    }
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
          hideLabel ? 'sr-only' : 'select-none text-xs text-text-muted',
          layout === 'inline' && 'pt-1.5',
          !hideLabel && !disabled && !readOnly && 'cursor-ew-resize',
        )}
      >
        {label}
      </label>
      <div className="flex flex-col gap-1">
        <div
          className={cn(
            'touch-hit-h flex h-7 items-center gap-1.5 rounded-sm border px-2 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-focus',
            'relative',
            shownError ? 'border-danger' : 'border-border-input hover:border-text-muted',
            disabled ? 'bg-surface-sunken text-text-disabled' : readOnly ? 'bg-surface-sunken' : 'bg-bg',
          )}
        >
          {isExpr ? (
            <span aria-hidden="true" className="text-xs italic text-accent">
              fx
            </span>
          ) : null}
          <input
            ref={input}
            id={id}
            // Names need letters, so a field that takes expressions gets the full keyboard.
            inputMode={check || suggestions ? 'text' : 'decimal'}
            autoComplete="off"
            spellCheck={false}
            value={draft}
            disabled={disabled}
            readOnly={readOnly}
            {...(open
              ? {
                  role: 'combobox',
                  'aria-expanded': true,
                  'aria-controls': listId,
                  'aria-autocomplete': 'list' as const,
                  'aria-activedescendant': `${id}-opt-${activeIndex}`,
                }
              : {})}
            aria-invalid={shownError ? true : undefined}
            aria-describedby={describedBy}
            onChange={(e) => {
              setDraft(e.target.value)
              onDraftChange?.(e.target.value)
              setCaret(e.target.selectionStart ?? e.target.value.length)
              setListOpen(true)
              setActive(0)
            }}
            onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? draft.length)}
            onKeyDown={onKeyDown}
            onFocus={(e) => e.currentTarget.select()}
            onBlur={() => {
              setListOpen(false)
              commit(draft)
            }}
            className="min-w-0 flex-1 bg-transparent text-base tnum outline-none disabled:cursor-not-allowed"
          />
          {unit ? <span className="text-sm text-text-muted">{unit}</span> : null}
          {open ? (
            <ul
              id={listId}
              role="listbox"
              aria-label="Variables"
              className="absolute inset-x-0 top-full z-30 mt-1 max-h-40 overflow-auto rounded-md border border-border bg-surface-raised p-1 shadow-pop"
            >
              {items.map((c, i) => (
                <li
                  key={c.name}
                  id={`${id}-opt-${i}`}
                  role="option"
                  aria-selected={i === activeIndex}
                  // Keep the focus in the field: picking must not blur (and so commit) the text.
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={() => accept(c.name)}
                  className={cn(
                    'touch-hit-h flex h-7 cursor-default select-none items-center justify-between gap-2 rounded-sm px-2 text-base',
                    i === activeIndex && 'bg-surface-sunken',
                  )}
                >
                  <span>{c.name}</span>
                  {c.detail ? <span className="text-xs text-text-muted tnum">{c.detail}</span> : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        {showHint ? (
          <p id={hintId} className="text-xs text-text-muted tnum">
            = {preview}
          </p>
        ) : null}
        {shownError ? (
          <p id={errId} className="text-xs text-danger">
            {shownError}
          </p>
        ) : null}
      </div>
    </div>
  )
}

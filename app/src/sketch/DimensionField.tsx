// The inline field for typing a dimension's value. Enter confirms (a refusal shows as an error on the
// field and nothing changes), Esc closes it.
import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent } from 'react'
import { useProjectStore } from '../doc/store'
import type { ConstraintType } from '../doc/types'
import { useVariableSuggestions } from '../doc/useVariableSuggestions'
import { NumericInput } from '../ui/NumericInput'
import type { FieldFeedback } from '../ui/NumericInput'
import { checkDimensionText } from './dimensions'
import { cn } from '../ui/cn'

export interface DimensionFieldProps {
  /** Accessible name for the field and its group, e.g. "Length". */
  label: string
  /** Decides how the text is checked (a length or an angle). */
  type: ConstraintType
  /** Shown after the number, e.g. "mm" or "°". */
  unit: string
  initial: string
  /** Returns an error message, or null when the value was accepted. */
  onSubmit: (text: string) => string | null
  onCancel: () => void
  /** Error to show from the start (the new-dimension field keeps its own). */
  error?: string
  className?: string
  style?: CSSProperties
}

export function DimensionField({ label, type, unit, initial, onSubmit, onCancel, error, className, style }: DimensionFieldProps) {
  const root = useRef<HTMLDivElement>(null)
  const [failure, setFailure] = useState<string | undefined>(error)
  const units = useProjectStore((s) => s.doc.units)
  const suggestions = useVariableSuggestions(units)
  const check = (text: string): FieldFeedback => {
    const r = checkDimensionText(type, text, units)
    if (!r.ok) return { error: r.message }
    return r.isExpression ? { preview: r.preview } : {}
  }

  useEffect(() => {
    const input = root.current?.querySelector('input')
    input?.focus()
    input?.select()
  }, [])
  useEffect(() => setFailure(error), [error])

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onCancel()
    } else if (e.key === 'Enter' && e.target instanceof HTMLInputElement) {
      e.preventDefault()
      e.stopPropagation()
      setFailure(onSubmit(e.target.value) ?? undefined)
    }
  }

  return (
    <div
      ref={root}
      role="group"
      aria-label={`${label} value`}
      onKeyDown={onKeyDown}
      style={style}
      className={cn('pointer-events-auto w-48 rounded-md bg-surface-raised p-2 shadow-panel', className)}
    >
      <NumericInput layout="inline" label={label} unit={unit} value={initial} error={failure} check={check} suggestions={suggestions} />
    </div>
  )
}

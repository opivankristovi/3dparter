// The inline field for typing a dimension's value. Enter confirms (a refusal shows as an error on the
// field and nothing changes), Esc closes it.
import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent } from 'react'
import { NumericInput } from '../ui/NumericInput'
import { cn } from '../ui/cn'

export interface DimensionFieldProps {
  /** Accessible name for the field and its group, e.g. "Length". */
  label: string
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

export function DimensionField({ label, unit, initial, onSubmit, onCancel, error, className, style }: DimensionFieldProps) {
  const root = useRef<HTMLDivElement>(null)
  const [failure, setFailure] = useState<string | undefined>(error)

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
      <NumericInput layout="inline" label={label} unit={unit} value={initial} error={failure} />
    </div>
  )
}

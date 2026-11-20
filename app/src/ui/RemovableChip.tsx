import { X } from 'lucide-react'
import { cn } from './cn'

export interface RemovableChipProps {
  label: string
  /** Accessible name of the remove button, e.g. "Remove Body 2". */
  removeLabel: string
  onRemove: () => void
  className?: string
}

/** A small pill naming something a tool has picked, with a button to take it out again. */
export function RemovableChip({ label, removeLabel, onRemove, className }: RemovableChipProps) {
  return (
    <span
      className={cn(
        'inline-flex h-7 max-w-full items-center gap-1 rounded-pill bg-accent-subtle pr-1 pl-2.5 text-sm text-accent',
        className,
      )}
    >
      <span className="truncate">{label}</span>
      <button
        type="button"
        aria-label={removeLabel}
        onClick={onRemove}
        className="touch-hit flex size-5 shrink-0 items-center justify-center rounded-pill hover:bg-surface-sunken focus-visible:outline-2 focus-visible:outline-focus"
      >
        <X size={14} strokeWidth={1.75} aria-hidden="true" />
      </button>
    </span>
  )
}

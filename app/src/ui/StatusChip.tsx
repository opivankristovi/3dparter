import { cn } from './cn'
import { Spinner } from './ProgressIndicator'

export type StatusChipVariant = 'under-defined' | 'fully-defined' | 'conflict' | 'saving' | 'saved' | 'offline'

export interface StatusChipProps {
  variant: StatusChipVariant
  /** under-defined: number of remaining degrees of freedom. */
  degreesOfFreedom?: number
  className?: string
}

const dot: Record<StatusChipVariant, string> = {
  'under-defined': 'bg-sketch-under',
  'fully-defined': 'bg-sketch-full',
  conflict: 'bg-sketch-conflict',
  saving: '',
  saved: 'bg-success',
  offline: 'bg-warning',
}

function text(v: StatusChipVariant, dof: number): string {
  switch (v) {
    case 'under-defined':
      return `Under-defined: ${dof} degree${dof === 1 ? '' : 's'} of freedom`
    case 'fully-defined':
      return 'Fully defined'
    case 'conflict':
      return 'Conflicting constraints: remove one'
    case 'saving':
      return 'Saving…'
    case 'saved':
      return 'Saved'
    case 'offline':
      return 'Offline, saved on this device'
  }
}

/** The state is always in the text; the dot is decoration. Changes are announced politely. */
export function StatusChip({ variant, degreesOfFreedom = 2, className }: StatusChipProps) {
  return (
    <span
      role="status"
      aria-live="polite"
      className={cn(
        'inline-flex h-7 items-center gap-2 rounded-pill border border-border bg-surface-raised px-3 text-sm shadow-panel',
        className,
      )}
    >
      {variant === 'saving' ? (
        <Spinner size={16} className="size-3 text-text-muted" />
      ) : (
        <span aria-hidden="true" className={cn('size-2 rounded-pill', dot[variant])} />
      )}
      {text(variant, degreesOfFreedom)}
    </span>
  )
}

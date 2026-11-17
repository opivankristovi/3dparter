import { cn } from './cn'

export function Spinner({ size = 16, className }: { size?: 16 | 20; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={cn('animate-spin', className)}
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

export interface ProgressIndicatorProps {
  variant?: 'linear' | 'spinner' | 'determinate'
  /** determinate: 0..max */
  value?: number
  max?: number
  /** accessible name; for determinate also shown as text */
  label: string
  size?: 16 | 20
  className?: string
}

export function ProgressIndicator({
  variant = 'linear',
  value,
  max = 100,
  label,
  size = 16,
  className,
}: ProgressIndicatorProps) {
  if (variant === 'spinner') {
    return (
      <span role="progressbar" aria-label={label} className={cn('inline-flex text-accent', className)}>
        <Spinner size={size} />
      </span>
    )
  }
  if (variant === 'determinate') {
    const pct = Math.max(0, Math.min(100, ((value ?? 0) / max) * 100))
    return (
      <div className={cn('flex flex-col gap-1', className)}>
        <div className="text-sm text-text-muted tnum">{label}</div>
        <div
          role="progressbar"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={max}
          aria-valuenow={value ?? 0}
          className="h-1.5 w-full overflow-hidden rounded-pill bg-surface-sunken"
        >
          <div
            className="h-full rounded-pill bg-accent transition-[width] duration-(--motion-base)"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    )
  }
  return (
    <div
      role="progressbar"
      aria-label={label}
      className={cn('relative h-0.5 w-full overflow-hidden bg-surface-sunken', className)}
    >
      <div className="absolute inset-y-0 left-0 w-2/5 animate-[indeterminate_1.2s_linear_infinite] bg-accent motion-reduce:w-full motion-reduce:animate-none motion-reduce:opacity-60" />
    </div>
  )
}

import { cn } from './cn'

export interface KbdChipProps {
  children: string
  /** Transparent chip with a 40% border, for use inside a tooltip. */
  onTooltip?: boolean
  className?: string
}

export function KbdChip({ children, onTooltip = false, className }: KbdChipProps) {
  return (
    <kbd
      className={cn(
        'inline-flex items-center rounded-sm border px-1 font-sans text-xs tnum',
        onTooltip
          ? 'border-on-tooltip/40 bg-transparent text-on-tooltip'
          : 'border-border bg-surface-sunken text-text-muted',
        className,
      )}
    >
      {children}
    </kbd>
  )
}

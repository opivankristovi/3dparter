import type { ReactNode } from 'react'
import { ToggleGroup } from 'radix-ui'
import { cn } from './cn'

export interface SegmentOption {
  value: string
  label?: string
  icon?: ReactNode
  disabled?: boolean
}

export interface SegmentedControlProps {
  options: SegmentOption[]
  value: string
  onValueChange: (value: string) => void
  /** Accessible name for the group. */
  label: string
  disabled?: boolean
  className?: string
}

export function SegmentedControl({ options, value, onValueChange, label, disabled, className }: SegmentedControlProps) {
  return (
    <ToggleGroup.Root
      type="single"
      value={value}
      aria-label={label}
      disabled={disabled}
      // A single-select control cannot be emptied.
      onValueChange={(v) => v && onValueChange(v)}
      className={cn('inline-flex rounded-md bg-surface-sunken p-0.5', className)}
    >
      {options.map((o) => (
        <ToggleGroup.Item
          key={o.value}
          value={o.value}
          disabled={o.disabled}
          aria-label={o.label ? undefined : o.value}
          className="touch-hit-h inline-flex h-7 items-center justify-center gap-1.5 rounded-sm px-3 text-sm font-medium text-text-muted transition-colors duration-(--motion-fast) enabled:hover:text-text disabled:cursor-not-allowed disabled:text-text-disabled data-[state=on]:bg-surface-raised data-[state=on]:text-text data-[state=on]:shadow-panel"
        >
          {o.icon}
          {o.label}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  )
}

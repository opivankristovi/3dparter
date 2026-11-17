import type { ComponentProps, ReactNode } from 'react'
import { cn } from './cn'
import { Tooltip } from './Tooltip'

export interface IconButtonProps extends Omit<ComponentProps<'button'>, 'aria-label'> {
  /** Required: accessible name and tooltip text. */
  label: string
  icon: ReactNode
  shortcut?: string
  /** Toggle button: sets aria-pressed. */
  pressed?: boolean
  size?: 28 | 32
  tooltipSide?: 'top' | 'right' | 'bottom' | 'left'
}

export function IconButton({
  label,
  icon,
  shortcut,
  pressed,
  size = 32,
  tooltipSide,
  className,
  type = 'button',
  ...rest
}: IconButtonProps) {
  const button = (
    <button
      type={type}
      aria-label={label}
      aria-pressed={pressed}
      aria-keyshortcuts={shortcut}
      className={cn(
        'touch-hit inline-flex shrink-0 items-center justify-center rounded-md transition-colors duration-(--motion-fast) active:translate-y-px disabled:cursor-not-allowed disabled:text-text-disabled disabled:active:translate-y-0',
        size === 28 ? 'size-7' : 'size-8',
        pressed
          ? 'bg-accent-subtle text-accent'
          : 'text-text-muted enabled:hover:bg-surface-sunken enabled:hover:text-text',
        className,
      )}
      {...rest}
    >
      {icon}
    </button>
  )
  return (
    <Tooltip label={label} shortcut={shortcut} side={tooltipSide}>
      {button}
    </Tooltip>
  )
}

import type { ReactNode } from 'react'
import { Toolbar as T } from 'radix-ui'
import { cn } from './cn'
import { Tooltip } from './Tooltip'

export interface ToolButtonProps {
  label: string
  icon: ReactNode
  /** 11px caption under the icon. */
  caption?: string
  shortcut?: string
  active?: boolean
  disabled?: boolean
  kind?: 'sketch' | 'solid' | 'boolean'
  onClick?: () => void
  tooltipSide?: 'top' | 'right' | 'bottom' | 'left'
}

/** Must be rendered inside <Toolbar>. "Not applicable" tools are not rendered at all (hidden, not disabled). */
export function ToolButton({
  label,
  icon,
  caption,
  shortcut,
  active = false,
  disabled,
  kind = 'solid',
  onClick,
  tooltipSide = 'right',
}: ToolButtonProps) {
  return (
    <Tooltip label={label} shortcut={shortcut} side={tooltipSide}>
      <T.Button
        aria-label={caption ? undefined : label}
        aria-pressed={active}
        aria-keyshortcuts={shortcut}
        data-kind={kind}
        disabled={disabled}
        onClick={onClick}
        className={cn(
          'relative flex w-12 flex-col items-center rounded-md py-0.5 transition-colors duration-(--motion-fast) touch:min-h-12 touch:min-w-12 disabled:cursor-not-allowed disabled:text-text-disabled',
          active
            ? 'bg-accent-subtle text-accent before:absolute before:inset-y-1.5 before:-left-1 before:w-0.5 before:rounded-pill before:bg-accent'
            : 'text-text-muted enabled:hover:bg-surface-sunken enabled:hover:text-text',
        )}
      >
        <span className="flex size-10 items-center justify-center">{icon}</span>
        {caption ? <span className="-mt-1 text-xs">{caption}</span> : null}
      </T.Button>
    </Tooltip>
  )
}

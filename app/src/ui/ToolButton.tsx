import type { ReactNode } from 'react'
import { Toolbar as T } from 'radix-ui'
import { KbdChip } from './KbdChip'
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
  /** 'row': icon, the name and the key hint side by side (a labelled rail). Default 'icon': icon only, with a tooltip. */
  layout?: 'icon' | 'row'
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
  layout = 'icon',
}: ToolButtonProps) {
  const row = layout === 'row'
  const button = (
      <T.Button
        aria-label={caption || row ? undefined : label}
        aria-pressed={active}
        aria-keyshortcuts={shortcut}
        data-kind={kind}
        disabled={disabled}
        onClick={onClick}
        className={cn(
          'relative flex rounded-md transition-colors duration-(--motion-fast) touch:min-h-12 touch:min-w-12 disabled:cursor-not-allowed disabled:text-text-disabled',
          row ? 'w-full flex-row items-center gap-1 py-0.5 pr-2 pl-1' : 'w-12 shrink-0 flex-col items-center py-0.5',
          active
            ? 'bg-accent-subtle text-accent before:absolute before:inset-y-1.5 before:-left-1 before:w-0.5 before:rounded-pill before:bg-accent'
            : 'text-text-muted enabled:hover:bg-surface-sunken enabled:hover:text-text',
        )}
      >
        <span className={cn('flex items-center justify-center', row ? 'size-8 shrink-0' : 'size-10')}>{icon}</span>
        {row ? (
          <>
            <span className="flex-1 truncate text-left text-base">{label}</span>
            {shortcut ? (
              <span aria-hidden="true">
                <KbdChip>{shortcut}</KbdChip>
              </span>
            ) : null}
          </>
        ) : caption ? (
          <span className="-mt-1 text-xs">{caption}</span>
        ) : null}
      </T.Button>
  )
  // A labelled row already shows its name and key, so it needs no tooltip.
  return row ? (
    button
  ) : (
    <Tooltip label={label} shortcut={shortcut} side={tooltipSide}>
      {button}
    </Tooltip>
  )
}

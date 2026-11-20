import type { ReactNode } from 'react'
import { Toolbar as T } from 'radix-ui'
import { cn } from './cn'

export interface ToolbarProps {
  label: string
  orientation?: 'horizontal' | 'vertical'
  className?: string
  children: ReactNode
}

/** role="toolbar" with roving tabindex (Radix Toolbar): arrows move, Enter/Space activate. */
export function Toolbar({ label, orientation = 'horizontal', className, children }: ToolbarProps) {
  return (
    <T.Root
      aria-label={label}
      orientation={orientation}
      className={cn('flex', orientation === 'vertical' ? 'flex-col items-center' : 'flex-row items-center', className)}
    >
      {children}
    </T.Root>
  )
}

export function ToolbarSeparator({
  orientation = 'horizontal',
  wide = false,
}: {
  orientation?: 'horizontal' | 'vertical'
  /** Vertical toolbar only: the rule spans the full width of a labelled rail. */
  wide?: boolean
}) {
  // The separator runs across the toolbar, so a vertical toolbar gets a horizontal rule.
  return (
    <T.Separator
      className={orientation === 'vertical' ? cn('my-1 h-px bg-border', wide ? 'w-full' : 'w-8') : 'mx-1 h-6 w-px bg-border'}
    />
  )
}

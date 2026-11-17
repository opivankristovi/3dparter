import type { ReactNode } from 'react'
import { Link } from 'wouter'
import { cn } from '../ui/cn'

/** A router link that looks like a Button (the Button primitive is not polymorphic). */
export function LinkButton({
  href,
  children,
  variant = 'secondary',
  className,
}: {
  href: string
  children: ReactNode
  variant?: 'primary' | 'secondary'
  className?: string
}) {
  return (
    <Link
      href={href}
      className={cn(
        'touch-hit inline-flex h-8 items-center justify-center gap-2 whitespace-nowrap rounded-md px-3 text-base font-medium transition-colors duration-(--motion-fast)',
        variant === 'primary'
          ? 'bg-accent text-on-accent hover:bg-accent-hover'
          : 'border border-border bg-surface-raised text-text hover:bg-surface-sunken',
        className,
      )}
    >
      {children}
    </Link>
  )
}

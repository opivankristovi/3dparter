import type { ReactNode } from 'react'
import { cn } from './cn'

export interface EmptyStateProps {
  /** A Lucide icon element; rendered at 40px in text-muted. */
  icon: ReactNode
  title: string
  description?: string
  action?: ReactNode
  className?: string
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center gap-2 px-6 py-8 text-center', className)}>
      <span aria-hidden="true" className="text-text-muted [&>svg]:size-10">
        {icon}
      </span>
      <h3 className="text-lg">{title}</h3>
      {description ? <p className="max-w-64 text-sm text-text-muted">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  )
}

import { useEffect, useId, useRef } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import { X } from 'lucide-react'
import { Button } from './Button'
import { IconButton } from './IconButton'
import { ProgressIndicator } from './ProgressIndicator'
import { cn } from './cn'

export function ParameterRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-text-muted">{label}</span>
      {children}
    </div>
  )
}

export interface ParameterCardProps {
  title: string
  icon: ReactNode
  children: ReactNode
  onApply: () => void
  onCancel: () => void
  applyDisabled?: boolean
  /** Thin progress line under the header while the kernel works. */
  busy?: boolean
  /** Operation failed: kernel message plus a hint. */
  failure?: { message: string; hint?: string }
  /** "Editing step 7" badge. */
  editingStep?: number
  className?: string
}

/** Key hint inside an action button; desktop only, and not part of the button's name. */
function ActionKey({ children }: { children: string }) {
  return (
    <span aria-hidden="true" className="max-lg:hidden">
      <kbd className="inline-flex items-center rounded-sm border border-current/40 px-1 font-sans text-xs tnum">{children}</kbd>
    </span>
  )
}

/** Non-modal dialog. Focus goes to the first field on open; Esc cancels; Enter in the last field applies. */
export function ParameterCard({
  title,
  icon,
  children,
  onApply,
  onCancel,
  applyDisabled,
  busy,
  failure,
  editingStep,
  className,
}: ParameterCardProps) {
  const titleId = useId()
  const body = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // The first field, or else the first button.
    const el = body.current?.querySelector<HTMLElement>('input:not([disabled])') ?? body.current?.querySelector<HTMLElement>('button:not([disabled])')
    el?.focus()
  }, [])

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      onCancel()
    } else if (e.key === 'Enter' && e.target instanceof HTMLInputElement && !applyDisabled) {
      const inputs = body.current?.querySelectorAll('input')
      if (inputs && inputs[inputs.length - 1] === e.target) onApply()
    }
  }

  return (
    <section
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      aria-busy={busy || undefined}
      onKeyDown={onKeyDown}
      className={cn('w-(--layout-card-w) rounded-lg bg-surface-raised shadow-panel', className)}
    >
      <div className="flex items-center gap-2 px-3 pt-3 pb-2">
        <span aria-hidden="true" className="text-text-muted">
          {icon}
        </span>
        <h2 id={titleId} className="flex-1 text-lg">
          {title}
        </h2>
        {editingStep !== undefined ? (
          <span className="rounded-pill bg-accent-subtle px-2 text-xs text-accent">Editing step {editingStep}</span>
        ) : null}
        <IconButton label="Close" icon={<X size={16} strokeWidth={1.75} />} size={28} onClick={onCancel} />
      </div>
      {busy ? <ProgressIndicator label="Updating preview" /> : <div className="h-0.5" />}
      <div ref={body} className="flex flex-col gap-2 p-3">
        {failure ? (
          <div role="alert" className="rounded-md bg-danger-subtle p-2 text-sm text-danger">
            <p>{failure.message}</p>
            {failure.hint ? <p className="mt-0.5">{failure.hint}</p> : null}
          </div>
        ) : null}
        {children}
      </div>
      {/* Desktop: Cancel and Apply leave the card for an action bar at the bottom centre of the screen (still
          inside the dialog, so Esc, Enter and the accessible tree stay as they are). */}
      <footer className="flex justify-end gap-2 px-3 pb-3 lg:fixed lg:bottom-2 lg:left-1/2 lg:z-10 lg:-translate-x-1/2 lg:rounded-lg lg:bg-surface-raised lg:p-2 lg:shadow-panel">
        <Button variant="secondary" onClick={onCancel}>
          Cancel
          <ActionKey>Esc</ActionKey>
        </Button>
        <Button variant="primary" onClick={onApply} disabled={applyDisabled}>
          Apply
          <ActionKey>Enter</ActionKey>
        </Button>
      </footer>
    </section>
  )
}

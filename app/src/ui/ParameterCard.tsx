import { useEffect, useId, useRef, useState } from 'react'
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
  onApply?: () => void
  onCancel?: () => void
  onClose?: () => void
  footer?: ReactNode
  applyDisabled?: boolean
  /** Thin progress line under the header while the kernel works. */
  busy?: boolean
  /**
   * True when the preview on screen is for what the card holds right now. Enter right after typing a value waits
   * for this before it applies. Leave out for a card that has no preview to wait for.
   */
  isCurrent?: () => boolean
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

/** Non-modal dialog. Focus goes to the first field on open; Esc cancels; Enter in any text field applies. */
export function ParameterCard({
  title,
  icon,
  children,
  onApply,
  onCancel,
  onClose,
  footer,
  applyDisabled,
  busy,
  isCurrent,
  failure,
  editingStep,
  className,
}: ParameterCardProps) {
  const titleId = useId()
  const body = useRef<HTMLDivElement>(null)
  /** Enter was pressed and the apply is waiting for the preview of what was typed. */
  const [queued, setQueued] = useState(false)
  const latest = useRef({ onApply, isCurrent })
  latest.current = { onApply, isCurrent }

  // Enter commits the field first (the field's own handler runs before this card's), which starts a new preview.
  // The props of this render are still the old ones, so the apply runs from here once the preview has caught up:
  // by then `busy`, `applyDisabled` and any failure describe the value that was typed.
  // `recheck` re-runs this while an apply waits: the preview of the typed value can start and finish within one batch
  // of updates, so `busy` alone may never change and the queued apply would wait forever (BUG-038, seen in Firefox).
  const [recheck, setRecheck] = useState(0)
  useEffect(() => {
    if (!queued || busy) return
    if (latest.current.isCurrent && !latest.current.isCurrent()) {
      const t = window.setTimeout(() => setRecheck((n) => n + 1), 50)
      return () => window.clearTimeout(t)
    }
    setQueued(false)
    if (!applyDisabled) latest.current.onApply?.()
  }, [queued, busy, applyDisabled, recheck])

  useEffect(() => {
    // The first field, or else the first button.
    const el = body.current?.querySelector<HTMLElement>('input:not([disabled])') ?? body.current?.querySelector<HTMLElement>('button:not([disabled])')
    el?.focus()
  }, [])

  const close = onClose ?? onCancel

  // A click on Apply goes through the same queue as Enter. Commit what is still typed in the focused field first:
  // browsers differ in whether pressing the button blurs the field before the click, and a click that ran before the
  // value was committed used to be dropped by the field's guard (seen in Firefox).
  const applyClicked = () => {
    const active = document.activeElement
    if (active instanceof HTMLInputElement && body.current?.contains(active)) active.blur()
    setQueued(true)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      close?.()
    } else if (e.key === 'Enter' && onApply && e.target instanceof HTMLInputElement && e.target.type === 'text') {
      setQueued(true)
    } else if (queued) {
      setQueued(false)
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
        <IconButton label="Close" icon={<X size={16} strokeWidth={1.75} />} size={28} onClick={close} />
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
      {footer !== undefined ? (
        <footer className="flex justify-end gap-2 px-3 pb-3">{footer}</footer>
      ) : (
        /* Desktop: Cancel and Apply leave the card for an action bar at the bottom centre of the screen (still
           inside the dialog, so Esc, Enter and the accessible tree stay as they are). */
        <footer className="flex justify-end gap-2 px-3 pb-3 lg:fixed lg:bottom-2 lg:left-1/2 lg:z-10 lg:-translate-x-1/2 lg:rounded-lg lg:bg-surface-raised lg:p-2 lg:shadow-panel">
          <Button variant="secondary" onClick={onCancel}>
            Cancel
            <ActionKey>Esc</ActionKey>
          </Button>
          <Button variant="primary" onClick={applyClicked} disabled={applyDisabled}>
            Apply
            <ActionKey>Enter</ActionKey>
          </Button>
        </footer>
      )}
    </section>
  )
}

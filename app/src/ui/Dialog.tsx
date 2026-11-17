import { useRef, type ReactNode } from 'react'
import { Dialog as D } from 'radix-ui'
import { X } from 'lucide-react'
import { IconButton } from './IconButton'
import { cn } from './cn'

export type DialogSize = 'sm' | 'md' | 'lg'

const widths: Record<DialogSize, string> = {
  sm: 'max-w-[400px]',
  md: 'max-w-[520px]',
  lg: 'max-w-[720px]',
}

export interface DialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  size?: DialogSize
  /** Content below the description. */
  children?: ReactNode
  /** Footer buttons (use <Button>). */
  footer?: ReactNode
  /** Danger banner above the footer. */
  error?: string
  /** Element that opens the dialog; focus returns to it on close. */
  trigger?: ReactNode
  /** Marks the dialog busy (the primary button shows its own loading state). */
  busy?: boolean
}

export function Dialog({ open, onOpenChange, title, description, size = 'md', children, footer, error, trigger, busy }: DialogProps) {
  // Without a Radix Trigger, Radix cannot return focus on close, so remember the opener ourselves.
  const opener = useRef<HTMLElement | null>(null)
  if (open && !opener.current && typeof document !== 'undefined') {
    opener.current = document.activeElement as HTMLElement | null
  }
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      {trigger ? <D.Trigger asChild>{trigger}</D.Trigger> : null}
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-(--backdrop)" />
        <D.Content
          aria-busy={busy || undefined}
          aria-describedby={description ? undefined : undefined}
          onOpenAutoFocus={(e) => {
            // Focus [data-autofocus] (e.g. the first field), else the first footer button (Cancel),
            // never the close icon: its tooltip would open and swallow the first Escape.
            const root = e.currentTarget as HTMLElement
            const target =
              root.querySelector<HTMLElement>('[data-autofocus]') ??
              root.querySelector<HTMLElement>('[data-dialog-footer] button:not(:disabled)')
            if (target) {
              e.preventDefault()
              target.focus()
            }
          }}
          onCloseAutoFocus={(e) => {
            if (!trigger && opener.current?.isConnected) {
              e.preventDefault()
              opener.current.focus()
            }
            opener.current = null
          }}
          className={cn(
            'fixed top-1/2 left-1/2 z-50 flex max-h-[85vh] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col gap-3 rounded-lg bg-surface-raised p-4 shadow-pop',
            widths[size],
          )}
        >
          <div className="flex items-start gap-2">
            <D.Title className="flex-1 text-lg">{title}</D.Title>
            <D.Close asChild>
              <IconButton label="Close" size={28} icon={<X size={16} strokeWidth={1.75} />} />
            </D.Close>
          </div>
          {description ? <D.Description className="text-base text-text-muted">{description}</D.Description> : null}
          {children ? <div className="min-h-0 overflow-auto">{children}</div> : null}
          {error ? (
            <div role="alert" className="rounded-md bg-danger-subtle p-2 text-sm text-danger">
              {error}
            </div>
          ) : null}
          {footer ? <div data-dialog-footer className="flex justify-end gap-2">{footer}</div> : null}
        </D.Content>
      </D.Portal>
    </D.Root>
  )
}

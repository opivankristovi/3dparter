import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Toast as T } from 'radix-ui'
import { CircleAlert, CircleCheck, Info, X } from 'lucide-react'
import { cn } from './cn'

export type ToastVariant = 'info' | 'success' | 'error'

export interface ToastInput {
  variant?: ToastVariant
  title: string
  description?: string
  action?: { label: string; onClick: () => void }
}

interface ToastItem extends ToastInput {
  id: number
}

const Ctx = createContext<(t: ToastInput) => void>(() => {})

/** `const toast = useToast(); toast({ title: 'Saved', action: { label: 'Undo', onClick } })` */
export function useToast() {
  return useContext(Ctx)
}

const icons: Record<ToastVariant, ReactNode> = {
  info: <Info size={20} strokeWidth={1.75} />,
  success: <CircleCheck size={20} strokeWidth={1.75} />,
  error: <CircleAlert size={20} strokeWidth={1.75} />,
}

/** Mount once. Stacks up to 3 at bottom-centre; F8 focuses the region. Errors stay until dismissed. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const push = useCallback((t: ToastInput) => {
    setItems((s) => [...s, { ...t, id: Date.now() + Math.random() }].slice(-3))
  }, [])
  const value = useMemo(() => push, [push])
  const remove = (id: number) => setItems((s) => s.filter((x) => x.id !== id))

  return (
    <Ctx.Provider value={value}>
      <T.Provider label="Notifications" swipeDirection="down">
        {children}
        {items.map((t) => {
          const variant = t.variant ?? 'info'
          return (
            <T.Root
              key={t.id}
              role={variant === 'error' ? 'alert' : 'status'}
              type={variant === 'error' ? 'foreground' : 'background'}
              duration={variant === 'error' ? Infinity : 5000}
              onOpenChange={(open) => {
                if (!open) remove(t.id)
              }}
              className={cn(
                'flex w-96 max-w-[calc(100vw-2rem)] items-start gap-3 rounded-md bg-tooltip-bg p-3 text-on-tooltip shadow-pop',
                variant === 'error' && 'border-l-[3px] border-danger',
              )}
            >
              <span aria-hidden="true" className="mt-0.5">
                {icons[variant]}
              </span>
              <div className="min-w-0 flex-1">
                <T.Title className="text-base font-medium">{t.title}</T.Title>
                {t.description ? <T.Description className="text-sm opacity-80">{t.description}</T.Description> : null}
              </div>
              {t.action ? (
                <T.Action altText={t.action.label} asChild>
                  <button type="button" onClick={t.action.onClick} className="touch-hit-h rounded-sm px-2 text-base font-medium underline">
                    {t.action.label}
                  </button>
                </T.Action>
              ) : null}
              <T.Close aria-label="Dismiss" className="touch-hit flex size-6 items-center justify-center rounded-sm">
                <X size={16} strokeWidth={1.75} />
              </T.Close>
            </T.Root>
          )
        })}
        <T.Viewport className="fixed bottom-4 left-1/2 z-50 flex w-96 max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-col gap-2 outline-none" />
      </T.Provider>
    </Ctx.Provider>
  )
}

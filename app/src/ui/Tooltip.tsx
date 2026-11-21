import { createContext, useContext, useState } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { Tooltip as T } from 'radix-ui'
import { KbdChip } from './KbdChip'

const PortalHost = createContext<HTMLDivElement | null>(null)

/** Mount once near the root. 500ms in, no delay out. */
export function TooltipProvider({ children }: { children: ReactNode }) {
  const [host, setHost] = useState<HTMLDivElement | null>(null)
  return (
    <PortalHost.Provider value={host}>
      <T.Provider delayDuration={500} skipDelayDuration={0}>
        {children}
      </T.Provider>
      <div ref={setHost} role="region" aria-label="Tooltips" />
    </PortalHost.Provider>
  )
}

export interface TooltipProps {
  label: string
  shortcut?: string
  side?: 'top' | 'right' | 'bottom' | 'left'
  children: ReactElement
}

export function Tooltip({ label, shortcut, side = 'bottom', children }: TooltipProps) {
  const container = useContext(PortalHost)
  return (
    <T.Root>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal container={container ?? undefined}>
        <T.Content
          side={side}
          sideOffset={6}
          className="z-50 flex items-center gap-2 rounded-sm bg-tooltip-bg px-2 py-1 text-xs text-on-tooltip shadow-pop"
        >
          {label}
          {shortcut ? <KbdChip onTooltip>{shortcut}</KbdChip> : null}
        </T.Content>
      </T.Portal>
    </T.Root>
  )
}

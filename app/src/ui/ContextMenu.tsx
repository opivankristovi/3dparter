import { useState } from 'react'
import type { ReactNode } from 'react'
import { ContextMenu as C } from 'radix-ui'
import { menuContentClass, renderMenu } from './menu'
import type { MenuEntry } from './menu'

export type { MenuEntry }

export interface ContextMenuProps {
  /** The region that opens the menu on right-click, long-press, Shift+F10 or the Menu key. */
  children: ReactNode
  items: MenuEntry[]
  className?: string
}

export function ContextMenu({ children, items, className }: ContextMenuProps) {
  const [open, setOpen] = useState(false)
  const active = open && items.length > 0
  return (
    <C.Root open={active} onOpenChange={(next) => setOpen(next && items.length > 0)}>
      <C.Trigger asChild>
        <div className={className}>{children}</div>
      </C.Trigger>
      <C.Portal>
        <C.Content className={menuContentClass}>{renderMenu(C, items)}</C.Content>
      </C.Portal>
    </C.Root>
  )
}

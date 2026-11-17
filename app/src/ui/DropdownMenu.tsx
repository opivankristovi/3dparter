import type { ReactElement } from 'react'
import { DropdownMenu as D } from 'radix-ui'
import { menuContentClass, renderMenu } from './menu'
import type { MenuEntry } from './menu'

export type { MenuEntry }

export interface DropdownMenuProps {
  /** A single focusable element (usually an IconButton or Button). */
  trigger: ReactElement
  items: MenuEntry[]
  align?: 'start' | 'center' | 'end'
}

export function DropdownMenu({ trigger, items, align = 'start' }: DropdownMenuProps) {
  return (
    <D.Root>
      <D.Trigger asChild>{trigger}</D.Trigger>
      <D.Portal>
        <D.Content align={align} sideOffset={4} className={menuContentClass}>
          {renderMenu(D, items)}
        </D.Content>
      </D.Portal>
    </D.Root>
  )
}

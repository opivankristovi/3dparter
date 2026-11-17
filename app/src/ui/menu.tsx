import type { ElementType, ReactNode } from 'react'
import { Check } from 'lucide-react'

/** Shared item model for DropdownMenu and ContextMenu. */
export type MenuEntry =
  | { type: 'separator' }
  | { type: 'label'; label: string }
  | {
      type?: 'item'
      label: string
      shortcut?: string
      icon?: ReactNode
      disabled?: boolean
      danger?: boolean
      onSelect?: () => void
    }
  | {
      type: 'checkbox'
      label: string
      checked: boolean
      disabled?: boolean
      onCheckedChange?: (checked: boolean) => void
    }

export interface MenuParts {
  Item: ElementType
  CheckboxItem: ElementType
  Separator: ElementType
  Label: ElementType
  ItemIndicator: ElementType
}

export const menuContentClass =
  'z-50 min-w-48 rounded-md border border-border bg-surface-raised p-1 text-base shadow-pop'
const itemClass =
  'touch-hit-h relative flex h-7 cursor-default select-none items-center gap-2 rounded-sm px-2 outline-none data-[disabled]:text-text-disabled data-[highlighted]:bg-surface-sunken'

export function renderMenu(P: MenuParts, entries: MenuEntry[]): ReactNode {
  return entries.map((e, i) => {
    if (e.type === 'separator') return <P.Separator key={i} className="my-1 h-px bg-border" />
    if (e.type === 'label')
      return (
        <P.Label key={i} className="px-2 py-1 text-xs text-text-muted">
          {e.label}
        </P.Label>
      )
    if (e.type === 'checkbox')
      return (
        <P.CheckboxItem
          key={i}
          checked={e.checked}
          disabled={e.disabled}
          onCheckedChange={e.onCheckedChange}
          className={`${itemClass} pl-7`}
        >
          <P.ItemIndicator className="absolute left-2">
            <Check size={16} strokeWidth={1.75} />
          </P.ItemIndicator>
          {e.label}
        </P.CheckboxItem>
      )
    return (
      <P.Item
        key={i}
        disabled={e.disabled}
        onSelect={e.onSelect}
        className={`${itemClass} ${e.danger ? 'text-danger' : ''}`}
      >
        {e.icon}
        <span className="flex-1">{e.label}</span>
        {e.shortcut ? <span className="text-xs text-text-muted tnum">{e.shortcut}</span> : null}
      </P.Item>
    )
  })
}

import type { ReactNode } from 'react'
import { Box, Ellipsis } from 'lucide-react'
import { Button } from './Button'
import { ContextMenu } from './ContextMenu'
import { DropdownMenu } from './DropdownMenu'
import type { MenuEntry } from './menu'
import { IconButton } from './IconButton'
import { cn } from './cn'

export interface ProjectCardProps {
  name: string
  /** e.g. "Edited 2 h ago" */
  edited: string
  href?: string
  variant?: 'grid' | 'list'
  selected?: boolean
  renaming?: boolean
  onRenameCommit?: (name: string) => void
  /** Surface-sunken shimmer in place of the thumbnail. */
  loadingThumbnail?: boolean
  thumbnail?: ReactNode
  inTrash?: boolean
  onRestore?: () => void
  menu?: MenuEntry[]
}

function NameOrInput({ name, renaming, onCommit }: { name: string; renaming?: boolean; onCommit?: (n: string) => void }) {
  if (!renaming)
    return (
      <span title={name} className="truncate text-base font-medium">
        {name}
      </span>
    )
  return (
    <input
      autoFocus
      aria-label="Project name"
      defaultValue={name}
      onFocus={(e) => e.currentTarget.select()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur()
      }}
      onBlur={(e) => onCommit?.(e.currentTarget.value)}
      className="relative z-20 h-6 min-w-0 flex-1 rounded-sm border border-border-input bg-bg px-1 text-base focus:outline-2 focus:outline-focus"
    />
  )
}

export function ProjectCard({
  name,
  edited,
  href = '#design',
  variant = 'grid',
  selected,
  renaming,
  onRenameCommit,
  loadingThumbnail,
  thumbnail,
  inTrash,
  onRestore,
  menu = [],
}: ProjectCardProps) {
  const thumb = loadingThumbnail ? (
    <div className="size-full animate-[shimmer_1.4s_ease-in-out_infinite] bg-surface-sunken" />
  ) : (
    (thumbnail ?? (
      <div className="flex size-full items-center justify-center bg-viewport-bg text-text-muted">
        <Box size={variant === 'grid' ? 40 : 20} strokeWidth={1.75} aria-hidden="true" />
      </div>
    ))
  )

  const overflow = menu.length ? (
    <DropdownMenu
      align="end"
      trigger={<IconButton label={`More actions for ${name}`} size={28} icon={<Ellipsis size={16} strokeWidth={1.75} />} />}
      items={menu}
    />
  ) : null

  const link = (
    <a
      href={href}
      title={name}
      aria-label={renaming ? undefined : `${name}, ${edited}`}
      className="absolute inset-0 z-10 rounded-[inherit]"
      tabIndex={renaming ? -1 : 0}
    />
  )

  const body =
    variant === 'grid' ? (
      <div
        className={cn(
          'group relative flex flex-col overflow-hidden rounded-lg border bg-surface-raised transition-[border-color,box-shadow] duration-(--motion-fast) hover:border-border-input hover:shadow-panel',
          selected ? 'border-accent ring-2 ring-accent' : 'border-border',
          inTrash && 'opacity-70',
        )}
      >
        {link}
        <div className="aspect-[4/3] w-full overflow-hidden">{thumb}</div>
        <div className="flex items-start gap-1 p-3">
          <div className="flex min-w-0 flex-1 flex-col">
            <NameOrInput name={name} renaming={renaming} onCommit={onRenameCommit} />
            <span className="text-xs text-text-muted">{inTrash ? `Deleted · ${edited}` : edited}</span>
          </div>
          <div className="relative z-20 flex items-center gap-1">
            {inTrash ? (
              <Button size="sm" variant="secondary" onClick={onRestore}>
                Restore
              </Button>
            ) : (
              overflow
            )}
          </div>
        </div>
      </div>
    ) : (
      <div
        className={cn(
          'group relative flex h-10 items-center gap-3 rounded-md border bg-surface-raised pr-2 transition-[border-color,box-shadow] duration-(--motion-fast) hover:border-border-input hover:shadow-panel',
          selected ? 'border-accent ring-2 ring-accent' : 'border-border',
          inTrash && 'opacity-70',
        )}
      >
        {link}
        <div className="h-full w-14 shrink-0 overflow-hidden rounded-l-md">{thumb}</div>
        <div className="flex min-w-0 flex-1 items-center">
          <NameOrInput name={name} renaming={renaming} onCommit={onRenameCommit} />
        </div>
        <span className="text-xs text-text-muted">{inTrash ? `Deleted · ${edited}` : edited}</span>
        <div className="relative z-20 flex items-center gap-1">
          {inTrash ? (
            <Button size="sm" variant="secondary" onClick={onRestore}>
              Restore
            </Button>
          ) : (
            overflow
          )}
        </div>
      </div>
    )

  return menu.length ? <ContextMenu items={menu}>{body}</ContextMenu> : body
}

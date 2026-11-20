import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import { ChevronDown, ChevronRight, CircleAlert, Eye, EyeOff, TriangleAlert } from 'lucide-react'
import { Tooltip } from './Tooltip'
import { cn } from './cn'

export interface TreeNode {
  id: string
  label: string
  icon?: ReactNode
  children?: TreeNode[]
  hidden?: boolean
  suppressed?: boolean
  /** Rows after the rollback marker. */
  beyondRollback?: boolean
  /** Reason shown in a tooltip next to the error glyph. */
  error?: string
  /** Non-fatal warning shown next to the warning glyph when there is no error. */
  warning?: string
}

interface FlatNode {
  node: TreeNode
  level: number
  parentId: string | null
  setSize: number
  posInSet: number
}

function flatten(nodes: TreeNode[], expanded: Set<string>, level = 1, parentId: string | null = null): FlatNode[] {
  return nodes.flatMap((node, idx) => {
    const self: FlatNode = { node, level, parentId, setSize: nodes.length, posInSet: idx + 1 }
    return node.children?.length && expanded.has(node.id)
      ? [self, ...flatten(node.children, expanded, level + 1, node.id)]
      : [self]
  })
}

export interface TreeRowProps {
  node: TreeNode
  level: number
  setSize: number
  posInSet: number
  expanded?: boolean
  selected: boolean
  /** Roving tabindex target. */
  focusable: boolean
  renaming: boolean
  /** Drag-reorder insertion line (visual only). */
  insertion?: 'before' | 'after'
  onSelect: () => void
  onToggleExpand: () => void
  onToggleHidden?: () => void
  onRenameCommit: (name: string) => void
  onRenameCancel: () => void
}

export function TreeRow({
  node,
  level,
  setSize,
  posInSet,
  expanded,
  selected,
  focusable,
  renaming,
  insertion,
  onSelect,
  onToggleExpand,
  onToggleHidden,
  onRenameCommit,
  onRenameCancel,
}: TreeRowProps) {
  const hasChildren = !!node.children?.length
  return (
    <div
      role="treeitem"
      id={`tree-${node.id}`}
      data-tree-id={node.id}
      aria-level={level}
      aria-setsize={setSize}
      aria-posinset={posInSet}
      aria-selected={selected}
      aria-expanded={hasChildren ? !!expanded : undefined}
      tabIndex={focusable ? 0 : -1}
      onClick={onSelect}
      style={{ paddingLeft: (level - 1) * 16 + 4 }}
      className={cn(
        'group relative flex h-7 cursor-default items-center gap-1 rounded-sm pr-1 text-base',
        selected ? 'bg-accent-subtle text-accent' : 'hover:bg-surface-sunken',
        node.beyondRollback && 'opacity-50',
      )}
    >
      {insertion ? (
        <span
          aria-hidden="true"
          className={cn('absolute inset-x-0 h-0.5 bg-accent', insertion === 'before' ? '-top-px' : '-bottom-px')}
        />
      ) : null}
      {hasChildren ? (
        <button
          type="button"
          tabIndex={-1}
          aria-hidden="true"
          onClick={(e) => {
            e.stopPropagation()
            onToggleExpand()
          }}
          className="flex size-4 items-center justify-center rounded-sm text-text-muted hover:text-text"
        >
          {expanded ? <ChevronDown size={16} strokeWidth={1.75} /> : <ChevronRight size={16} strokeWidth={1.75} />}
        </button>
      ) : (
        <span className="size-4" />
      )}
      {node.icon ? (
        <span aria-hidden="true" className={cn('flex size-4 items-center justify-center', !selected && 'text-text-muted')}>
          {node.icon}
        </span>
      ) : null}
      {renaming ? (
        <input
          autoFocus
          aria-label="Rename"
          defaultValue={node.label}
          onFocus={(e) => e.currentTarget.select()}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter') onRenameCommit(e.currentTarget.value)
            if (e.key === 'Escape') onRenameCancel()
          }}
          onBlur={(e) => onRenameCommit(e.currentTarget.value)}
          className="h-6 min-w-0 flex-1 rounded-sm border border-border-input bg-bg px-1 text-base text-text focus:outline-2 focus:outline-focus"
        />
      ) : (
        <span
          className={cn(
            'flex-1 truncate',
            node.hidden && 'text-text-disabled',
            node.suppressed && 'text-text-muted line-through',
          )}
        >
          {node.label}
        </span>
      )}
      {node.error ? (
        <Tooltip label={node.error} side="left">
          <span className="flex text-danger">
            <CircleAlert size={16} strokeWidth={1.75} aria-hidden="true" />
            <span className="sr-only">Error: {node.error}</span>
          </span>
        </Tooltip>
      ) : node.warning ? (
        <Tooltip label={node.warning} side="left">
          <span className="flex text-warning">
            <TriangleAlert size={16} strokeWidth={1.75} aria-hidden="true" />
            <span className="sr-only">Warning: {node.warning}</span>
          </span>
        </Tooltip>
      ) : null}
      {onToggleHidden ? (
        <button
          type="button"
          tabIndex={-1}
          aria-label={node.hidden ? `Show ${node.label}` : `Hide ${node.label}`}
          aria-pressed={!!node.hidden}
          onClick={(e) => {
            e.stopPropagation()
            onToggleHidden()
          }}
          className={cn(
            'flex size-5 items-center justify-center rounded-sm text-text-muted hover:text-text',
            !node.hidden && 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100',
            selected && '!text-accent',
          )}
        >
          {node.hidden ? <EyeOff size={16} strokeWidth={1.75} /> : <Eye size={16} strokeWidth={1.75} />}
        </button>
      ) : null}
    </div>
  )
}

export interface TreeProps {
  nodes: TreeNode[]
  label: string
  selectedId?: string
  selectedIds?: string[]
  onSelect?: (id: string) => void
  defaultExpanded?: string[]
  onToggleHidden?: (id: string) => void
  onRename?: (id: string, name: string) => void
  onDelete?: (id: string) => void
  className?: string
}

/** role="tree": arrows move/expand, Home/End, F2 rename, Delete deletes, H toggles visibility. */
export function Tree({
  nodes,
  label,
  selectedId,
  selectedIds,
  onSelect,
  defaultExpanded = [],
  onToggleHidden,
  onRename,
  onDelete,
  className,
}: TreeProps) {
  const [expanded, setExpanded] = useState(() => new Set(defaultExpanded))
  const [focusId, setFocusId] = useState<string | undefined>(selectedId ?? selectedIds?.[0] ?? nodes[0]?.id)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const flat = useMemo(() => flatten(nodes, expanded), [nodes, expanded])
  const selectedSet = useMemo(() => new Set(selectedIds ?? (selectedId ? [selectedId] : [])), [selectedId, selectedIds])

  useEffect(() => {
    if (focusId && !flat.some((f) => f.node.id === focusId)) setFocusId(flat[0]?.node.id)
  }, [flat, focusId])

  const moveFocus = (id: string | undefined) => {
    if (!id) return
    setFocusId(id)
    root.current?.querySelector<HTMLElement>(`[data-tree-id="${CSS.escape(id)}"]`)?.focus()
  }
  const toggle = (id: string, open?: boolean) =>
    setExpanded((s) => {
      const n = new Set(s)
      if (open ?? !n.has(id)) n.add(id)
      else n.delete(id)
      return n
    })

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (renamingId) return
    const idx = flat.findIndex((f) => f.node.id === focusId)
    const cur = flat[idx]
    if (!cur) return
    const has = !!cur.node.children?.length
    switch (e.key) {
      case 'ArrowDown':
        moveFocus(flat[Math.min(idx + 1, flat.length - 1)]?.node.id)
        break
      case 'ArrowUp':
        moveFocus(flat[Math.max(idx - 1, 0)]?.node.id)
        break
      case 'Home':
        moveFocus(flat[0]?.node.id)
        break
      case 'End':
        moveFocus(flat[flat.length - 1]?.node.id)
        break
      case 'ArrowRight':
        if (has && !expanded.has(cur.node.id)) toggle(cur.node.id, true)
        else if (has) moveFocus(flat[idx + 1]?.node.id)
        break
      case 'ArrowLeft':
        if (has && expanded.has(cur.node.id)) toggle(cur.node.id, false)
        else if (cur.parentId) moveFocus(cur.parentId)
        break
      case 'Enter':
      case ' ':
        onSelect?.(cur.node.id)
        break
      case 'F2':
        if (onRename) setRenamingId(cur.node.id)
        break
      case 'Delete':
        onDelete?.(cur.node.id)
        break
      case 'h':
      case 'H':
        onToggleHidden?.(cur.node.id)
        break
      default:
        return
    }
    e.preventDefault()
  }

  return (
    <div ref={root} role="tree" aria-label={label} onKeyDown={onKeyDown} className={cn('flex flex-col', className)}>
      {flat.map((f) => (
        <TreeRow
          key={f.node.id}
          node={f.node}
          level={f.level}
          setSize={f.setSize}
          posInSet={f.posInSet}
          expanded={expanded.has(f.node.id)}
          selected={selectedSet.has(f.node.id)}
          focusable={focusId === f.node.id}
          renaming={renamingId === f.node.id}
          onSelect={() => {
            setFocusId(f.node.id)
            onSelect?.(f.node.id)
          }}
          onToggleExpand={() => toggle(f.node.id)}
          onToggleHidden={onToggleHidden ? () => onToggleHidden(f.node.id) : undefined}
          onRenameCommit={(name) => {
            setRenamingId(null)
            if (name.trim() && name !== f.node.label) onRename?.(f.node.id, name.trim())
            moveFocus(f.node.id)
          }}
          onRenameCancel={() => {
            setRenamingId(null)
            moveFocus(f.node.id)
          }}
        />
      ))}
    </div>
  )
}

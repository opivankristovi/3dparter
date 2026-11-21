import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ArrowLeft, Download, Moon, Redo2, Ruler, Settings, Undo2, Upload } from 'lucide-react'
import { IconButton } from './IconButton'
import { ProgressIndicator } from './ProgressIndicator'
import { StatusChip } from './StatusChip'
import type { StatusChipVariant } from './StatusChip'
import { cn } from './cn'

export interface TopBarProps {
  projectName: string
  onRename?: (name: string) => void
  saveState?: Extract<StatusChipVariant, 'saving' | 'saved' | 'offline'>
  /** Kernel is regenerating: thin progress line along the bar. */
  busy?: boolean
  canUndo?: boolean
  canRedo?: boolean
  onBack?: () => void
  onUndo?: () => void
  onRedo?: () => void
  measureActive?: boolean
  onMeasure?: () => void
  onImport?: () => void
  onExport?: () => void
  onSettings?: () => void
  onThemeToggle?: () => void
  /** Icon for the theme button (defaults to a moon). */
  themeIcon?: ReactNode
  /** Replaces the default save chip (e.g. for error and conflict states). */
  saveSlot?: ReactNode
  /** Extra buttons at the right end (e.g. a sidebar toggle on small screens). */
  actions?: ReactNode
  /** Hide the Measure button until the tool exists. */
  hideMeasure?: boolean
  /** Phones: one flex row, and Settings and Theme are left to `actions` (an overflow menu). */
  compact?: boolean
  /** Floating panel look (inset, rounded, shadow) vs. full-width. */
  floating?: boolean
  className?: string
}

function ProjectName({ name, onRename }: { name: string; onRename?: (n: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(name)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) input.current?.select()
  }, [editing])

  const finish = (save: boolean) => {
    setEditing(false)
    if (save && draft.trim() && draft !== name) onRename?.(draft.trim())
    else setDraft(name)
  }

  if (editing)
    return (
      <input
        ref={input}
        aria-label="Project name"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => finish(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') finish(true)
          if (e.key === 'Escape') finish(false)
        }}
        className="h-7 w-48 rounded-sm border border-border-input bg-bg px-2 text-base focus:outline-2 focus:outline-offset-2 focus:outline-focus"
      />
    )
  return (
    <button
      type="button"
      title={`${name} (double-click or press F2 to rename)`}
      onDoubleClick={() => {
        setDraft(name)
        setEditing(true)
      }}
      onKeyDown={(e) => {
        if (e.key === 'F2' || e.key === 'Enter') {
          setDraft(name)
          setEditing(true)
        }
      }}
      className="touch-hit-h h-7 max-w-48 truncate rounded-sm px-2 text-base font-medium hover:bg-surface-sunken"
    >
      {name}
    </button>
  )
}

export function TopBar({
  projectName,
  onRename,
  saveState = 'saved',
  busy,
  canUndo = true,
  canRedo = false,
  floating = true,
  className,
  onBack,
  onUndo,
  onRedo,
  measureActive,
  onMeasure,
  onImport,
  onExport,
  onSettings,
  onThemeToggle,
  themeIcon,
  saveSlot,
  actions,
  hideMeasure,
  compact,
}: TopBarProps) {
  return (
    <header
      aria-busy={busy || undefined}
      className={cn(
        'relative h-(--layout-topbar-h) items-center gap-2 bg-surface-raised px-2',
        compact ? 'flex' : 'grid grid-cols-[1fr_auto_1fr]',
        floating ? 'rounded-lg shadow-panel' : 'border-b border-border',
        className,
      )}
    >
      <div className={cn('flex min-w-0 items-center gap-1', compact && 'flex-1')}>
        <IconButton label="Back to projects" onClick={onBack} icon={<ArrowLeft size={20} strokeWidth={1.75} />} />
        <ProjectName name={projectName} onRename={onRename} />
        {saveSlot ?? (
          <StatusChip variant={saveState} className="ml-1 border-transparent bg-transparent text-text-muted shadow-none" />
        )}
      </div>
      <div className="flex items-center gap-1">
        <IconButton label="Undo" shortcut="Ctrl Z" icon={<Undo2 size={20} strokeWidth={1.75} />} disabled={!canUndo} onClick={onUndo} />
        <IconButton label="Redo" shortcut="Ctrl Y" icon={<Redo2 size={20} strokeWidth={1.75} />} disabled={!canRedo} onClick={onRedo} />
      </div>
      <div className="flex items-center justify-end gap-1">
        {hideMeasure ? null : (
          <IconButton label="Measure" shortcut="U" icon={<Ruler size={20} strokeWidth={1.75} />} pressed={measureActive} onClick={onMeasure} />
        )}
        {compact || !onImport ? null : (
          <IconButton label="Import" icon={<Upload size={20} strokeWidth={1.75} />} onClick={onImport} />
        )}
        <IconButton label="Export" icon={<Download size={20} strokeWidth={1.75} />} onClick={onExport} />
        {compact ? null : (
          <>
            <IconButton label="Settings" icon={<Settings size={20} strokeWidth={1.75} />} onClick={onSettings} />
            <IconButton label="Theme" icon={themeIcon ?? <Moon size={20} strokeWidth={1.75} />} onClick={onThemeToggle} />
          </>
        )}
        {actions}
      </div>
      {busy ? (
        <div className="absolute inset-x-2 bottom-0 overflow-hidden rounded-pill">
          <ProgressIndicator label="Rebuilding model" />
        </div>
      ) : null}
    </header>
  )
}

import type { ReactNode } from 'react'
import { ArrowUpFromLine, Circle, RectangleHorizontal, Slash, Spline } from 'lucide-react'
import { ChamferIcon, CombineIcon, FilletIcon, MoveIcon, PlaneIcon, RevolveIcon, ShellIcon } from '../../ui/ModelIcons'
import { Toolbar, ToolbarSeparator } from '../../ui/Toolbar'
import { ToolButton } from '../../ui/ToolButton'
import { cn } from '../../ui/cn'

export interface ToolDef {
  id: string
  label: string
  icon: ReactNode
  shortcut: string
  kind: 'sketch' | 'solid'
}

const i = { size: 20, strokeWidth: 1.75 } as const

export const SKETCH_TOOLS: ToolDef[] = [
  { id: 'sketch.rectangle', label: 'Rectangle', icon: <RectangleHorizontal {...i} />, shortcut: 'R', kind: 'sketch' },
  { id: 'sketch.circle', label: 'Circle', icon: <Circle {...i} />, shortcut: 'C', kind: 'sketch' },
  { id: 'sketch.line', label: 'Line', icon: <Slash {...i} />, shortcut: 'L', kind: 'sketch' },
  { id: 'sketch.arc', label: 'Arc', icon: <Spline {...i} />, shortcut: 'A', kind: 'sketch' },
]
export const SOLID_TOOLS: ToolDef[] = [
  { id: 'extrude', label: 'Extrude', icon: <ArrowUpFromLine {...i} />, shortcut: 'E', kind: 'solid' },
  { id: 'revolve', label: 'Revolve', icon: <RevolveIcon {...i} />, shortcut: 'O', kind: 'solid' },
  { id: 'fillet', label: 'Fillet', icon: <FilletIcon {...i} />, shortcut: 'G', kind: 'solid' },
  { id: 'chamfer', label: 'Chamfer', icon: <ChamferIcon {...i} />, shortcut: 'K', kind: 'solid' },
  { id: 'shell', label: 'Shell', icon: <ShellIcon {...i} />, shortcut: 'S', kind: 'solid' },
  { id: 'combine', label: 'Combine', icon: <CombineIcon {...i} />, shortcut: 'J', kind: 'solid' },
  { id: 'move', label: 'Move', icon: <MoveIcon {...i} />, shortcut: 'M', kind: 'solid' },
  { id: 'plane', label: 'Plane', icon: <PlaneIcon {...i} />, shortcut: 'P', kind: 'solid' },
]
export const ALL_TOOLS = [...SKETCH_TOOLS, ...SOLID_TOOLS]

/** key (lower case) -> tool id */
export const TOOL_KEYS: Record<string, string> = Object.fromEntries(ALL_TOOLS.map((t) => [t.shortcut.toLowerCase(), t.id]))

export interface WorkspaceToolRailProps {
  activeTool: string | null
  onToolChange: (id: string | null) => void
  /** Vertical rail at the left, or a horizontal bar along the bottom on phones. */
  orientation: 'vertical' | 'horizontal'
  /** Vertical rail only: show each tool's name and key next to its icon, with the groups named. */
  labelled?: boolean
  className?: string
}

export function WorkspaceToolRail({ activeTool, onToolChange, orientation, labelled = false, className }: WorkspaceToolRailProps) {
  const vertical = orientation === 'vertical'
  const rows = vertical && labelled
  const render = (t: ToolDef) => (
    <ToolButton
      key={t.id}
      label={t.label}
      icon={t.icon}
      shortcut={t.shortcut}
      kind={t.kind}
      active={activeTool === t.id}
      tooltipSide={vertical ? 'right' : 'top'}
      layout={rows ? 'row' : 'icon'}
      onClick={() => onToolChange(activeTool === t.id ? null : t.id)}
    />
  )
  const caption = (text: string) => (
    <span aria-hidden="true" className="px-1 pt-1 pb-0.5 text-xs text-text-muted">
      {text}
    </span>
  )
  return (
    <div
      className={cn(
        'bg-surface-raised shadow-panel',
        vertical
          ? cn(
              'flex max-h-[calc(100dvh-var(--layout-topbar-h)-1.5rem)] flex-col items-center overflow-y-auto rounded-lg py-2',
              rows ? 'w-(--layout-toolrail-labelled-w) px-2' : 'w-(--layout-toolrail-w)',
            )
          : 'flex max-w-full justify-center rounded-lg px-2 py-1',
        className,
      )}
    >
      <Toolbar
        label="Tools"
        orientation={orientation}
        className={cn('gap-1', rows && 'w-full items-stretch', !vertical && 'max-w-full flex-wrap justify-center')}
      >
        {rows ? caption('Draw') : null}
        {SKETCH_TOOLS.map(render)}
        <ToolbarSeparator orientation={orientation} wide={rows} />
        {rows ? caption('Build') : null}
        {SOLID_TOOLS.map(render)}
      </Toolbar>
    </div>
  )
}

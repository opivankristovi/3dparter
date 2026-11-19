import type { ReactNode } from 'react'
import { ArrowUpFromLine, Circle, RectangleHorizontal, Slash, Spline } from 'lucide-react'
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
]
export const ALL_TOOLS = [...SKETCH_TOOLS, ...SOLID_TOOLS]

/** key (lower case) -> tool id */
export const TOOL_KEYS: Record<string, string> = Object.fromEntries(ALL_TOOLS.map((t) => [t.shortcut.toLowerCase(), t.id]))

export interface WorkspaceToolRailProps {
  activeTool: string | null
  onToolChange: (id: string | null) => void
  /** Vertical rail at the left, or a horizontal bar along the bottom on phones. */
  orientation: 'vertical' | 'horizontal'
  className?: string
}

export function WorkspaceToolRail({ activeTool, onToolChange, orientation, className }: WorkspaceToolRailProps) {
  const vertical = orientation === 'vertical'
  const render = (t: ToolDef) => (
    <ToolButton
      key={t.id}
      label={t.label}
      icon={t.icon}
      shortcut={t.shortcut}
      kind={t.kind}
      active={activeTool === t.id}
      tooltipSide={vertical ? 'right' : 'top'}
      onClick={() => onToolChange(activeTool === t.id ? null : t.id)}
    />
  )
  return (
    <div
      className={cn(
        'bg-surface-raised shadow-panel',
        vertical ? 'flex w-(--layout-toolrail-w) flex-col items-center rounded-lg py-2' : 'flex justify-center rounded-lg px-2 py-1',
        className,
      )}
    >
      <Toolbar label="Tools" orientation={orientation} className="gap-1">
        {SKETCH_TOOLS.map(render)}
        <ToolbarSeparator orientation={orientation} />
        {SOLID_TOOLS.map(render)}
      </Toolbar>
    </div>
  )
}

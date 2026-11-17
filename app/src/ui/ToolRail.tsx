import type { ReactNode } from 'react'
import {
  Box,
  Check,
  Circle,
  Combine,
  CornerUpRight,
  Ellipsis,
  RectangleHorizontal,
  RotateCw,
  Shell,
  Slash,
  Spline,
  ArrowUpFromLine,
  Hexagon,
} from 'lucide-react'
import { Button } from './Button'
import { DropdownMenu } from './DropdownMenu'
import { IconButton } from './IconButton'
import { Toolbar, ToolbarSeparator } from './Toolbar'
import { ToolButton } from './ToolButton'
import { cn } from './cn'

interface ToolDef {
  id: string
  label: string
  icon: ReactNode
  shortcut?: string
  kind: 'sketch' | 'solid' | 'boolean'
}

const i = { size: 20, strokeWidth: 1.75 } as const

const sketchTools: ToolDef[] = [
  { id: 'line', label: 'Line', icon: <Slash {...i} />, shortcut: 'L', kind: 'sketch' },
  { id: 'arc', label: 'Arc', icon: <Spline {...i} />, shortcut: 'A', kind: 'sketch' },
  { id: 'circle', label: 'Circle', icon: <Circle {...i} />, shortcut: 'C', kind: 'sketch' },
  { id: 'rectangle', label: 'Rectangle', icon: <RectangleHorizontal {...i} />, shortcut: 'R', kind: 'sketch' },
]
const solidTools: ToolDef[] = [
  { id: 'extrude', label: 'Extrude', icon: <ArrowUpFromLine {...i} />, shortcut: 'E', kind: 'solid' },
  { id: 'revolve', label: 'Revolve', icon: <RotateCw {...i} />, kind: 'solid' },
  { id: 'box', label: 'Box', icon: <Box {...i} />, kind: 'solid' },
]
const editTools: ToolDef[] = [
  { id: 'fillet', label: 'Fillet', icon: <CornerUpRight {...i} />, shortcut: 'F', kind: 'solid' },
  { id: 'chamfer', label: 'Chamfer', icon: <Hexagon {...i} />, kind: 'solid' },
  { id: 'shell', label: 'Shell', icon: <Shell {...i} />, kind: 'solid' },
  { id: 'boolean', label: 'Combine', icon: <Combine {...i} />, kind: 'boolean' },
]

export interface ToolRailProps {
  mode?: 'solid' | 'sketch'
  activeTool?: string
  onToolChange?: (id: string) => void
  onFinishSketch?: () => void
  /** Short viewport: Edit tools beyond the first two move into a "More" menu. */
  compact?: boolean
  className?: string
}

export function ToolRail({ mode = 'solid', activeTool, onToolChange, onFinishSketch, compact, className }: ToolRailProps) {
  const render = (t: ToolDef) => (
    <ToolButton
      key={t.id}
      label={t.label}
      icon={t.icon}
      shortcut={t.shortcut}
      kind={t.kind}
      active={activeTool === t.id}
      onClick={() => onToolChange?.(t.id)}
    />
  )
  const visibleEdit = compact ? editTools.slice(0, 2) : editTools
  const overflow = compact ? editTools.slice(2) : []

  return (
    <div
      className={cn(
        'flex w-(--layout-toolrail-w) flex-col items-center rounded-lg bg-surface-raised py-2 shadow-panel',
        className,
      )}
    >
      <Toolbar label="Tools" orientation="vertical" className="gap-1">
        {mode === 'sketch' ? (
          sketchTools.map(render)
        ) : (
          <>
            {solidTools.map(render)}
            <ToolbarSeparator orientation="vertical" />
            {visibleEdit.map(render)}
            {overflow.length ? (
              <DropdownMenu
                align="start"
                trigger={<IconButton label="More tools" icon={<Ellipsis size={20} strokeWidth={1.75} />} />}
                items={overflow.map((t) => ({ label: t.label, icon: t.icon, onSelect: () => onToolChange?.(t.id) }))}
              />
            ) : null}
          </>
        )}
      </Toolbar>
      {mode === 'sketch' ? (
        <Button
          variant="primary"
          size="sm"
          icon={<Check size={16} strokeWidth={1.75} />}
          onClick={onFinishSketch}
          className="mt-2 w-12 flex-col !h-auto gap-0 py-1 text-xs"
        >
          Finish
          <span className="sr-only"> sketch</span>
        </Button>
      ) : null}
    </div>
  )
}

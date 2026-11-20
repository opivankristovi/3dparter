// The column of view controls at the right edge: the orientation cube, zoom to fit, home view, and the
// buttons that open the side panel on one of its tabs.
import { Box, History, House, Scan, Variable } from 'lucide-react'
import { IconButton } from '../../ui/IconButton'
import { OrientationCube } from '../../viewport/OrientationCube'
import type { ViewportEngine } from '../../viewport/engine'

const ic = { size: 20, strokeWidth: 1.75 } as const

const PANELS = [
  { value: 'history', label: 'Show History', icon: <History {...ic} /> },
  { value: 'items', label: 'Show Items', icon: <Box {...ic} /> },
  { value: 'variables', label: 'Show Variables', icon: <Variable {...ic} /> },
] as const

export interface ViewColumnProps {
  engine: ViewportEngine | null
  onFit: () => void
  /** The side panel's current tab, and whether the panel is open. */
  panelTab: string
  panelOpen: boolean
  onOpenPanel: (tab: string) => void
}

export function ViewColumn({ engine, onFit, panelTab, panelOpen, onOpenPanel }: ViewColumnProps) {
  const rule = <div role="separator" className="my-1 h-px w-8 bg-border" />
  return (
    <div role="group" aria-label="View controls" className="flex w-(--layout-viewcol-w) flex-col items-center rounded-lg bg-surface-raised pb-2 shadow-panel">
      <OrientationCube engine={engine} />
      {rule}
      <IconButton label="Zoom to fit" shortcut="F" icon={<Scan {...ic} />} disabled={!engine} onClick={onFit} tooltipSide="left" />
      <IconButton label="Home view" icon={<House {...ic} />} disabled={!engine} onClick={() => engine?.resetView()} tooltipSide="left" />
      {rule}
      {PANELS.map((p) => (
        <IconButton
          key={p.value}
          label={p.label}
          icon={p.icon}
          pressed={panelOpen && panelTab === p.value}
          onClick={() => onOpenPanel(p.value)}
          tooltipSide="left"
        />
      ))}
    </div>
  )
}

// The column of view controls at the right edge: the orientation cube, zoom to fit, home view, display toggles,
// and the buttons that open the side panel on one of its tabs.
import { Box, Grid3x3, History, House, Scan, Slice, Variable } from 'lucide-react'
import { IconButton } from '../../ui/IconButton'
import { OrientationCube } from '../../viewport/OrientationCube'
import type { ViewportEngine } from '../../viewport/engine'
import { useToolStore } from './toolStore'

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
  const sectionView = useToolStore((s) => s.sectionView)
  const displayMode = useToolStore((s) => s.displayMode)
  const setSectionView = useToolStore((s) => s.setSectionView)
  const setDisplayMode = useToolStore((s) => s.setDisplayMode)
  const rule = <div role="separator" className="my-1 h-px w-8 bg-border" />
  return (
    <div role="group" aria-label="View controls" className="flex w-(--layout-viewcol-w) flex-col items-center rounded-lg bg-surface-raised pb-2 shadow-panel">
      <OrientationCube engine={engine} />
      {rule}
      <IconButton label="Zoom to fit" shortcut="F" icon={<Scan {...ic} />} disabled={!engine} onClick={onFit} tooltipSide="left" />
      <IconButton label="Home view" shortcut="Ctrl 1" icon={<House {...ic} />} disabled={!engine} onClick={() => engine?.resetView()} tooltipSide="left" />
      <IconButton
        label="Section view"
        icon={<Slice {...ic} />}
        pressed={sectionView}
        disabled={!engine}
        onClick={() => setSectionView(!sectionView)}
        tooltipSide="left"
      />
      <IconButton
        label="Wireframe"
        icon={<Grid3x3 {...ic} />}
        pressed={displayMode === 'wireframe'}
        disabled={!engine}
        onClick={() => setDisplayMode(displayMode === 'wireframe' ? 'shaded' : 'wireframe')}
        tooltipSide="left"
      />
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

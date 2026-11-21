// While sketching: the grid spacing the cursor snaps to, and the switch that turns grid snapping on and off.
import { useSettings } from '../../app/useSettings'
import { useProjectStore } from '../../doc/store'
import { formatDisplay } from '../../doc/units'
import { GRID_SNAP_MM } from '../../sketch/geometry'
import { Button } from '../../ui/Button'

export function SnapControl() {
  const gridSnap = useSettings((s) => s.settings.gridSnap)
  const units = useProjectStore((s) => s.doc.units)
  return (
    <div
      role="group"
      aria-label="Grid snapping"
      className="pointer-events-auto inline-flex h-8 items-center gap-2 rounded-pill border border-border bg-surface-raised pr-1 pl-3 text-sm shadow-panel"
    >
      <span data-testid="grid-size" className="text-text-muted">
        Grid {formatDisplay(GRID_SNAP_MM, units)} {units}
      </span>
      <Button
        size="sm"
        variant={gridSnap ? 'primary' : 'secondary'}
        aria-pressed={gridSnap}
        onClick={() => void useSettings.getState().update({ gridSnap: !gridSnap })}
      >
        Snap to grid
      </Button>
    </div>
  )
}

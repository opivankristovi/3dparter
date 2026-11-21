// Measure tool (S09 / F09): measures 1 or 2 picked items (length, radius/diameter, area, volume,
// coordinates, distance and angle) and lets the user narrow viewport picks with a selection filter.
import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Ruler } from 'lucide-react'
import { useSettings } from '../app/useSettings'
import { useProjectStore } from '../doc/store'
import type { DisplayUnit, Ref } from '../doc/types'
import { formatArea, formatDisplay, formatVolume } from '../doc/units'
import type { MeasureResult, MeasureValue } from '../kernel/api'
import { getKernel } from '../kernel/client'
import { useToolStore } from '../screens/workspace/toolStore'
import type { SelectionFilter } from '../screens/workspace/toolStore'
import type { KernelState } from '../screens/workspace/useKernel'
import { Button } from '../ui/Button'
import { ParameterCard, ParameterRow } from '../ui/ParameterCard'
import { RemovableChip } from '../ui/RemovableChip'
import { SegmentedControl } from '../ui/SegmentedControl'
import type { ViewportEngine } from '../viewport/engine'
import { sameRef } from './logic'

function formatMeasureItem(item: MeasureValue, units: DisplayUnit, precision: number): string {
  if (item.kind === 'point' && item.point) {
    const [x, y, z] = item.point
    return `(${formatDisplay(x, units, precision)}, ${formatDisplay(y, units, precision)}, ${formatDisplay(z, units, precision)}) ${units}`
  }
  const v = item.value ?? 0
  switch (item.kind) {
    case 'length':
      return `${formatDisplay(v, units, precision)} ${units}`
    case 'area':
      return `${formatArea(v, units, precision)} ${units}²`
    case 'volume':
      return `${formatVolume(v, units, precision)} ${units}³`
    case 'angle':
      return `${Number(v.toFixed(precision))}°`
    default:
      return String(v)
  }
}

export function useMeasureTool(kernel: KernelState, engine: ViewportEngine | null): { card: ReactNode } {
  const activeTool = useProjectStore((s) => s.activeTool)
  const selection = useProjectStore((s) => s.selection)
  const units = useProjectStore((s) => s.doc.units)
  const bodies = useProjectStore((s) => s.doc.bodies)
  const precision = useSettings((s) => s.settings.precision)
  const selectionFilter = useToolStore((s) => s.selectionFilter)
  const setSelectionFilter = useToolStore((s) => s.setSelectionFilter)

  const open = activeTool === 'measure'
  const picks = useMemo(
    () =>
      selection
        .filter((r) => r.kind === 'body' || r.kind === 'face' || r.kind === 'edge' || r.kind === 'vertex')
        .slice(0, 2),
    [selection],
  )
  const [result, setResult] = useState<MeasureResult>({ items: [] })

  useEffect(() => {
    if (!open) {
      engine?.setMeasureSegment(null)
      setResult({ items: [] })
      return
    }
    if (picks.length === 0) {
      engine?.setMeasureSegment(null)
      setResult({ items: [] })
      return
    }
    let live = true
    void getKernel()
      .measure(picks)
      .then((res) => {
        if (!live) return
        setResult(res)
        engine?.setMeasureSegment(res.segment ?? null)
      })
      .catch(() => {
        if (!live) return
        setResult({ items: [] })
        engine?.setMeasureSegment(null)
      })
    return () => {
      live = false
    }
  }, [open, picks, kernel.settled, engine])

  useEffect(() => {
    if (!open) return
    return () => {
      useToolStore.getState().setSelectionFilter('all')
    }
  }, [open])

  if (!open) return { card: null }

  const closeMeasure = () => {
    engine?.setMeasureSegment(null)
    useToolStore.getState().setSelectionFilter('all')
    useProjectStore.getState().setActiveTool(null)
  }

  const labelForRef = (r: Ref, index: number): string => {
    if (r.kind === 'body') return bodies[r.name]?.name ?? `Solid ${index + 1}`
    if (r.kind === 'face') return `Face ${index + 1}`
    if (r.kind === 'edge') return `Edge ${index + 1}`
    return `Point ${index + 1}`
  }

  const removePick = (target: Ref) => {
    const s = useProjectStore.getState()
    s.setSelection(s.selection.filter((r) => !sameRef(r, target)))
  }

  return {
    card: (
      <ParameterCard
        title="Measure"
        icon={<Ruler size={18} strokeWidth={1.75} />}
        onClose={closeMeasure}
        footer={
          <Button variant="secondary" onClick={closeMeasure}>
            Close
          </Button>
        }
      >
        <ParameterRow label="Filter">
          <SegmentedControl
            label="Selection filter"
            value={selectionFilter}
            onValueChange={(v) => setSelectionFilter(v as SelectionFilter)}
            className="w-full [&>button]:flex-1 [&>button]:px-1.5"
            options={[
              { value: 'all', label: 'All' },
              { value: 'body', label: 'Solid' },
              { value: 'face', label: 'Face' },
              { value: 'edge', label: 'Edge' },
              { value: 'vertex', label: 'Point' },
            ]}
          />
        </ParameterRow>
        <ParameterRow label="Picked">
          {picks.length === 0 ? (
            <p className="text-sm text-text-muted">
              Pick an edge, face, solid or point to measure — or pick two for distance and angle.
            </p>
          ) : (
            <div className="flex flex-wrap items-center gap-1.5">
              {picks.map((r, i) => {
                const lbl = labelForRef(r, i)
                return (
                  <RemovableChip
                    key={`${r.kind}:${r.name}`}
                    label={lbl}
                    removeLabel={`Remove ${lbl}`}
                    onRemove={() => removePick(r)}
                  />
                )
              })}
              <Button size="sm" variant="ghost" onClick={() => useProjectStore.getState().setSelection([])}>
                Clear
              </Button>
            </div>
          )}
        </ParameterRow>
        {result.items.length > 0 ? (
          <dl className="flex flex-col divide-y divide-border rounded-md border border-border bg-bg px-3 py-1">
            {result.items.map((item) => (
              <div key={item.label} className="flex items-center justify-between gap-2 py-1.5 text-base">
                <dt className="text-text-muted">{item.label}</dt>
                <dd className="font-medium tnum">{formatMeasureItem(item, units, precision)}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </ParameterCard>
    ),
  }
}

import type { ReactNode } from 'react'
import { useSettings } from '../../app/useSettings'
import { useProjectStore } from '../../doc/store'
import type { DisplayUnit } from '../../doc/types'
import { Button } from '../../ui/Button'
import { Dialog } from '../../ui/Dialog'
import { SegmentedControl } from '../../ui/SegmentedControl'
import { Select } from '../../ui/Select'

const UNITS: { value: DisplayUnit; label: string }[] = [
  { value: 'mm', label: 'Millimetres (mm)' },
  { value: 'cm', label: 'Centimetres (cm)' },
  { value: 'm', label: 'Metres (m)' },
  { value: 'in', label: 'Inches (in)' },
  { value: 'ft', label: 'Feet (ft)' },
]

function Row({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-2">
      <div className="min-w-0">
        <div className="text-base">{title}</div>
        {hint ? <div className="text-xs text-text-muted">{hint}</div> : null}
      </div>
      {children}
    </div>
  )
}

/** S12. Changes apply at once and are saved to this browser. */
export function SettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const settings = useSettings((s) => s.settings)
  const update = useSettings((s) => s.update)

  const setUnits = (units: DisplayUnit) => {
    void update({ units })
    // With a project open, its display units follow (one undo step).
    const store = useProjectStore.getState()
    if (store.projectId && store.doc.units !== units) {
      store.apply('Change units', (draft) => {
        draft.units = units
      })
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Settings"
      size="md"
      footer={
        <Button variant="primary" onClick={() => onOpenChange(false)}>
          Done
        </Button>
      }
    >
      <div className="flex flex-col divide-y divide-border">
        <Row title="Theme">
          <SegmentedControl
            label="Theme"
            value={settings.theme}
            onValueChange={(v) => void update({ theme: v as typeof settings.theme })}
            options={[
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
              { value: 'system', label: 'System' },
            ]}
          />
        </Row>
        <Row title="Units" hint="Shown in dimensions. Models are stored in millimetres.">
          <Select
            label="Units"
            value={settings.units}
            onValueChange={(v) => setUnits(v as DisplayUnit)}
            options={UNITS}
          />
        </Row>
        <Row title="Decimal places" hint="How many digits dimensions show.">
          <SegmentedControl
            label="Decimal places"
            value={String(settings.precision)}
            onValueChange={(v) => void update({ precision: Number(v) })}
            options={[0, 1, 2, 3, 4].map((n) => ({ value: String(n), label: String(n) }))}
          />
        </Row>
      </div>
    </Dialog>
  )
}

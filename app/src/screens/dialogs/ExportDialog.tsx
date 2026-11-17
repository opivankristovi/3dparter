import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Box } from 'lucide-react'
import { Button } from '../../ui/Button'
import { Dialog } from '../../ui/Dialog'
import { EmptyState } from '../../ui/EmptyState'
import { SegmentedControl } from '../../ui/SegmentedControl'
import { Select } from '../../ui/Select'
import { Switch } from '../../ui/Switch'

export interface ExportOptions {
  format: 'stl'
  quality: 'high' | 'low'
  binary: boolean
}

export interface ExportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onExport: (opts: ExportOptions) => Promise<void>
  bodyCount: number
}

function Field({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-2">
      <span className="text-base">{title}</span>
      {children}
    </div>
  )
}

/** S11. STL only for now; 3MF and STEP are listed so people know they are coming. */
export function ExportDialog({ open, onOpenChange, onExport, bodyCount }: ExportDialogProps) {
  const [quality, setQuality] = useState<'high' | 'low'>('high')
  const [binary, setBinary] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const closed = useRef(false)

  useEffect(() => {
    closed.current = !open
    if (open) {
      setError(undefined)
      setBusy(false)
    }
  }, [open])

  const run = async () => {
    setBusy(true)
    setError(undefined)
    try {
      await onExport({ format: 'stl', quality, binary })
      if (!closed.current) onOpenChange(false)
    } catch (e) {
      if (!closed.current) setError(e instanceof Error ? e.message : 'Export failed. Try again.')
    } finally {
      if (!closed.current) setBusy(false)
    }
  }

  const empty = bodyCount === 0

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Export"
      size="md"
      busy={busy}
      error={error}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {empty ? 'Close' : 'Cancel'}
          </Button>
          {empty ? null : (
            <Button variant="primary" loading={busy} onClick={run}>
              Export
            </Button>
          )}
        </>
      }
    >
      {empty ? (
        <EmptyState icon={<Box strokeWidth={1.75} />} title="Nothing to export yet" description="Make a solid first." />
      ) : (
        <div className="flex flex-col divide-y divide-border">
          <Field title="Format">
            <Select
              label="Format"
              value="stl"
              onValueChange={() => {}}
              options={[
                { value: 'stl', label: 'STL' },
                { value: '3mf', label: '3MF (coming soon)', disabled: true },
                { value: 'step', label: 'STEP (coming soon)', disabled: true },
              ]}
            />
          </Field>
          <Field title="Quality">
            <SegmentedControl
              label="Quality"
              value={quality}
              onValueChange={(v) => setQuality(v as 'high' | 'low')}
              options={[
                { value: 'high', label: 'High' },
                { value: 'low', label: 'Low' },
              ]}
            />
          </Field>
          <Field title="File type">
            <Switch label="Binary (smaller file)" checked={binary} onCheckedChange={setBinary} />
          </Field>
        </div>
      )}
    </Dialog>
  )
}

import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Box } from 'lucide-react'
import { Button } from '../../ui/Button'
import { Dialog } from '../../ui/Dialog'
import { EmptyState } from '../../ui/EmptyState'
import { SegmentedControl } from '../../ui/SegmentedControl'
import { Select } from '../../ui/Select'
import { Switch } from '../../ui/Switch'

export type ExportFormat = 'stl' | '3mf' | 'step' | 'obj' | 'glb'

export interface ExportOptions {
  format: ExportFormat
  quality: 'high' | 'low'
  binary: boolean
  onlySelected?: boolean
}

export interface ExportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onExport: (opts: ExportOptions) => Promise<void>
  bodyCount: number
  selectedBodyCount?: number
}

function Field({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-2">
      <span className="text-base">{title}</span>
      {children}
    </div>
  )
}

/** S11. Exports visible or selected solids as STL, 3MF, STEP, OBJ or GLB. */
export function ExportDialog({ open, onOpenChange, onExport, bodyCount, selectedBodyCount = 0 }: ExportDialogProps) {
  const [format, setFormat] = useState<ExportFormat>('stl')
  const [quality, setQuality] = useState<'high' | 'low'>('high')
  const [binary, setBinary] = useState(true)
  const [onlySelected, setOnlySelected] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const closed = useRef(false)

  const hasPartialSelection = selectedBodyCount > 0 && selectedBodyCount < bodyCount

  useEffect(() => {
    closed.current = !open
    if (open) {
      setError(undefined)
      setBusy(false)
      setOnlySelected(selectedBodyCount > 0 && selectedBodyCount < bodyCount)
    }
  }, [open, selectedBodyCount, bodyCount])

  const run = async () => {
    setBusy(true)
    setError(undefined)
    try {
      await onExport({ format, quality, binary, onlySelected: hasPartialSelection ? onlySelected : false })
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
              value={format}
              onValueChange={(v) => setFormat(v as ExportFormat)}
              options={[
                { value: 'stl', label: 'STL' },
                { value: '3mf', label: '3MF' },
                { value: 'step', label: 'STEP' },
                { value: 'obj', label: 'OBJ' },
                { value: 'glb', label: 'GLB (glTF)' },
              ]}
            />
          </Field>
          {hasPartialSelection ? (
            <Field title="Solids">
              <SegmentedControl
                label="Solids"
                value={onlySelected ? 'selected' : 'all'}
                onValueChange={(v) => setOnlySelected(v === 'selected')}
                options={[
                  { value: 'selected', label: `Selected (${selectedBodyCount})` },
                  { value: 'all', label: `All visible (${bodyCount})` },
                ]}
              />
            </Field>
          ) : null}
          {format !== 'step' ? (
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
          ) : null}
          {format === 'stl' ? (
            <Field title="File type">
              <Switch label="Binary (smaller file)" checked={binary} onCheckedChange={setBinary} />
            </Field>
          ) : null}
        </div>
      )}
    </Dialog>
  )
}

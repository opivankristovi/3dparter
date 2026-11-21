import { useEffect, useRef, useState } from 'react'
import { Upload } from 'lucide-react'
import { Button } from '../../ui/Button'
import { Dialog } from '../../ui/Dialog'

export interface ImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onImport: (filename: string, content: string) => Promise<void> | void
}

/** S10. Imports a STEP CAD file (.step / .stp) as a root editable solid step in History. */
export function ImportDialog({ open, onOpenChange, onImport }: ImportDialogProps) {
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const closed = useRef(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    closed.current = !open
    if (open) {
      setFile(null)
      setBusy(false)
      setError(undefined)
      if (inputRef.current) inputRef.current.value = ''
    }
  }, [open])

  const run = async () => {
    if (!file) {
      setError('Choose a .step or .stp file first.')
      return
    }
    if (!/\.(step|stp)$/i.test(file.name)) {
      setError('Unsupported file format. Only .step and .stp files can be imported.')
      return
    }
    setBusy(true)
    setError(undefined)
    try {
      const text = await file.text()
      if (!text.trim() || !text.includes('ISO-10303-21')) {
        throw new Error('This file does not look like a valid STEP (.step / .stp) model.')
      }
      await onImport(file.name, text)
      if (!closed.current) onOpenChange(false)
    } catch (e) {
      if (!closed.current) setError(e instanceof Error ? e.message : 'Could not import that file.')
    } finally {
      if (!closed.current) setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Import"
      description="Add a STEP file (.step, .stp) as a root solid in this model's history."
      size="md"
      busy={busy}
      error={error}
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            icon={<Upload size={16} strokeWidth={1.75} />}
            loading={busy}
            disabled={!file}
            onClick={run}
          >
            {busy ? 'Importing…' : 'Import'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <label className="flex cursor-pointer flex-col gap-2 rounded-md border border-border bg-surface-sunken p-4 text-sm text-text-muted hover:border-border-input">
          <span className="font-medium text-text">STEP CAD file</span>
          <input
            ref={inputRef}
            data-autofocus=""
            type="file"
            aria-label="CAD file"
            accept=".step,.stp"
            disabled={busy}
            onChange={(e) => {
              setError(undefined)
              setFile(e.target.files?.[0] ?? null)
            }}
            className="block w-full text-sm text-text file:mr-3 file:rounded-sm file:border file:border-border file:bg-surface-raised file:px-2.5 file:py-1 file:text-sm file:text-text"
          />
          <span>
            {file ? `Selected: ${file.name} (${Math.max(1, Math.round(file.size / 1024))} KB)` : 'Choose a .step or .stp file from your computer.'}
          </span>
        </label>
      </div>
    </Dialog>
  )
}

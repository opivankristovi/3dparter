import { useEffect, useRef, useState } from 'react'
import { Upload } from 'lucide-react'
import { Button } from '../../ui/Button'
import { Dialog } from '../../ui/Dialog'
import { bytesToBase64, readMeshFile } from '../../kernel/meshFile'

/** What the dialog hands back: STEP text, or a mesh normalised to a base64 binary STL. */
export interface ImportPayload {
  filename: string
  format: 'step' | 'stl' | '3mf'
  content: string
  /** Triangle count, for meshes only. */
  triangles?: number
}

const MAX_FILE_BYTES = 60 * 1024 * 1024

export interface ImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onImport: (payload: ImportPayload) => Promise<void> | void
}

/** S10. Imports a STEP file or an STL / 3MF mesh as a root editable solid step in History. */
export function ImportDialog({ open, onOpenChange, onImport }: ImportDialogProps) {
  const [file, setFile] = useState<File | null>(null)
  const [payload, setPayload] = useState<ImportPayload | null>(null)
  const [busy, setBusy] = useState(false)
  const [preparing, setPreparing] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const closed = useRef(false)
  const token = useRef(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    closed.current = !open
    if (open) {
      token.current++
      setFile(null)
      setPayload(null)
      setBusy(false)
      setPreparing(false)
      setError(undefined)
      if (inputRef.current) inputRef.current.value = ''
    }
  }, [open])

  /** Reads the chosen file and, for meshes, converts it to a solid-ready STL before the Import button is enabled. */
  const prepare = async (f: File | null) => {
    const mine = ++token.current
    setFile(f)
    setPayload(null)
    setError(undefined)
    if (!f) return
    if (!/\.(step|stp|stl|3mf)$/i.test(f.name)) {
      setError('Unsupported file format. You can import .step, .stp, .stl and .3mf files.')
      return
    }
    if (f.size > MAX_FILE_BYTES) {
      setError('This file is too large to import. Simplify it first.')
      return
    }
    setPreparing(true)
    try {
      let next: ImportPayload
      if (/\.(step|stp)$/i.test(f.name)) {
        const text = await f.text()
        if (!text.trim() || !text.includes('ISO-10303-21')) {
          throw new Error('This file does not look like a valid STEP (.step / .stp) model.')
        }
        next = { filename: f.name, format: 'step', content: text }
      } else {
        const { stl, triangles } = await readMeshFile(f.name, new Uint8Array(await f.arrayBuffer()))
        next = {
          filename: f.name,
          format: /\.3mf$/i.test(f.name) ? '3mf' : 'stl',
          content: bytesToBase64(stl),
          triangles,
        }
      }
      if (mine === token.current && !closed.current) setPayload(next)
    } catch (e) {
      if (mine === token.current && !closed.current) setError(e instanceof Error ? e.message : 'Could not read that file.')
    } finally {
      if (mine === token.current && !closed.current) setPreparing(false)
    }
  }

  const run = async () => {
    if (!file || !payload) {
      setError('Choose a .step, .stp, .stl or .3mf file first.')
      return
    }
    setBusy(true)
    setError(undefined)
    try {
      await onImport(payload)
      if (!closed.current) onOpenChange(false)
    } catch (e) {
      if (!closed.current) setError(e instanceof Error ? e.message : 'Could not import that file.')
    } finally {
      if (!closed.current) setBusy(false)
    }
  }

  const status = preparing
    ? `Reading ${file?.name ?? 'file'}…`
    : payload?.triangles !== undefined
      ? `Selected: ${payload.filename}, ${payload.triangles.toLocaleString('en-US')} triangles (read in millimetres).`
      : file
        ? `Selected: ${file.name} (${Math.max(1, Math.round(file.size / 1024))} KB)`
        : 'Choose a .step, .stp, .stl or .3mf file from your computer.'

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Import"
      description="Add a STEP file or an STL / 3MF mesh as a root solid in this model's history."
      size="md"
      busy={busy || preparing}
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
            disabled={!payload || preparing}
            onClick={run}
          >
            {busy ? 'Importing…' : 'Import'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <label className="flex cursor-pointer flex-col gap-2 rounded-md border border-border bg-surface-sunken p-4 text-sm text-text-muted hover:border-border-input">
          <span className="font-medium text-text">CAD or mesh file</span>
          <input
            ref={inputRef}
            data-autofocus=""
            type="file"
            aria-label="CAD file"
            accept=".step,.stp,.stl,.3mf"
            disabled={busy}
            onChange={(e) => {
              void prepare(e.target.files?.[0] ?? null)
            }}
            className="block w-full text-sm text-text file:mr-3 file:rounded-sm file:border file:border-border file:bg-surface-raised file:px-2.5 file:py-1 file:text-sm file:text-text"
          />
          <span role="status">{status}</span>
        </label>
      </div>
    </Dialog>
  )
}

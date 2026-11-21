import { useState, useSyncExternalStore } from 'react'
import { Button } from '../ui/Button'
import { Dialog } from '../ui/Dialog'
import { useToast } from '../ui/Toast'
import { getSupportUrl } from './config'
import { clearLog, getEntries, subscribe } from './errorLog'
import { buildIssueUrl, buildReport } from './report'

/** Shows exactly what a report contains. Nothing is sent unless the person presses the GitHub button. */
export function ReportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const toast = useToast()
  const entries = useSyncExternalStore(subscribe, getEntries)
  const [note, setNote] = useState('')
  const supportUrl = getSupportUrl()

  const report = buildReport(entries, note)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(report)
      toast({ variant: 'success', title: 'Report copied' })
    } catch {
      toast({ variant: 'error', title: "Couldn't copy the report", description: 'Select the text in the box and copy it by hand.' })
    }
  }

  const openIssue = () => {
    if (!supportUrl) return
    window.open(buildIssueUrl(supportUrl, '3DParter problem report', report), '_blank', 'noopener,noreferrer')
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setNote('')
        onOpenChange(o)
      }}
      title="Report a problem"
      description="Nothing is sent automatically. Read the report below, then choose what to do with it."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={clearLog} disabled={entries.length === 0}>
            Clear log
          </Button>
          <Button variant="secondary" onClick={() => void copy()}>
            Copy report
          </Button>
          <Button variant="primary" onClick={openIssue} disabled={!supportUrl}>
            Open a GitHub issue
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-base">
          What happened?
          <textarea
            data-autofocus
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={4}
            placeholder="What were you doing, and what did you expect?"
            className="w-full resize-y rounded-md border border-border-input bg-bg p-2 text-base placeholder:text-text-muted"
          />
        </label>
        {supportUrl ? (
          <p className="text-sm text-text-muted">
            The GitHub button opens a new issue in your browser with this report filled in. You can edit it before you submit. GitHub's own terms apply to anything you post there.
          </p>
        ) : (
          <p role="status" className="rounded-md bg-surface-sunken p-2 text-sm text-text">
            The support link is not set up yet, so the GitHub button is off. You can still copy the report.
          </p>
        )}
        <div className="flex flex-col gap-1">
          <div id="report-preview-label" className="text-sm font-medium">
            This is what the report contains
          </div>
          <pre
            role="region"
            aria-labelledby="report-preview-label"
            tabIndex={0}
            className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-surface-sunken p-2 text-xs"
          >
            {report}
          </pre>
          <p className="text-xs text-text-muted">
            No project content, file names or models are included. The log stays in this browser until you send it.
          </p>
        </div>
      </div>
    </Dialog>
  )
}

import type { SaveState } from '../../doc/store'
import { Spinner } from '../../ui/ProgressIndicator'
import { cn } from '../../ui/cn'

const text: Record<SaveState, string> = {
  saved: 'Saved',
  saving: 'Saving…',
  error: "Couldn't save",
  conflict: 'Changed in another tab',
}
const dot: Record<SaveState, string> = {
  saved: 'bg-success',
  saving: '',
  error: 'bg-danger',
  conflict: 'bg-warning',
}

/** Save state in the top bar. The words hide on phones but stay in the accessibility tree. */
export function SaveChip({ state }: { state: SaveState }) {
  return (
    <span
      role="status"
      aria-live="polite"
      className={cn('ml-1 inline-flex h-7 shrink-0 items-center gap-2 text-sm', state === 'saved' || state === 'saving' ? 'text-text-muted' : 'text-text')}
    >
      {state === 'saving' ? (
        <Spinner size={16} className="size-3" />
      ) : (
        <span aria-hidden="true" className={cn('size-2 rounded-pill', dot[state])} />
      )}
      <span className="max-md:sr-only">{text[state]}</span>
    </span>
  )
}

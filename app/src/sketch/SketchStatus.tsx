// Bottom-centre chips while sketching: how well the sketch is defined (always in words), and the solver loading.
import { Button } from '../ui/Button'
import { ProgressIndicator } from '../ui/ProgressIndicator'
import { StatusChip } from '../ui/StatusChip'
import { useSketchUi } from './sketchUi'
import { startSolver } from './useSketchSolve'

export function SketchStatus() {
  const solver = useSketchUi((s) => s.solver)
  const defined = useSketchUi((s) => s.defined)

  if (solver === 'loading' || solver === 'idle') {
    return (
      <span
        role="status"
        aria-live="polite"
        className="inline-flex h-7 items-center gap-2 rounded-pill border border-border bg-surface-raised px-3 text-sm shadow-panel"
      >
        Loading sketch solver…
        <ProgressIndicator label="Loading sketch solver" className="w-20 rounded-pill" />
      </span>
    )
  }
  if (solver === 'error') {
    return (
      <div role="alert" className="flex items-center gap-3 rounded-lg border border-border bg-surface-raised py-2 pr-2 pl-4 text-base shadow-panel">
        The sketch solver failed to load.
        <Button size="sm" variant="primary" onClick={() => void startSolver()}>
          Retry
        </Button>
      </div>
    )
  }
  if (!defined) return null
  return (
    <StatusChip
      variant={defined.state === 'over' ? 'conflict' : defined.state === 'full' ? 'fully-defined' : 'under-defined'}
      degreesOfFreedom={defined.dof}
    />
  )
}

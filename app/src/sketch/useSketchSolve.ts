// Solver start-up and the defined-state of the open sketch.
import { useEffect } from 'react'
import { useProjectStore } from '../doc/store'
import type { SketchFeature } from '../doc/types'
import { scopeOf } from '../doc/variables'
import { entityStates } from './solver/defined'
import { initSolver, isSolverReady, solveSketch } from './solver/solver'
import { useSketchUi } from './sketchUi'

/** Loads the solver once (lazy, shared). Safe to call again to retry after an error. */
export function startSolver(): Promise<void> {
  const ui = useSketchUi.getState()
  if (isSolverReady()) {
    ui.set({ solver: 'ready' })
    return Promise.resolve()
  }
  ui.set({ solver: 'loading' })
  return initSolver().then(
    () => useSketchUi.getState().set({ solver: 'ready' }),
    () => useSketchUi.getState().set({ solver: 'error' }),
  )
}

/** Starts loading the solver when a project's workspace opens. */
export function useSolverInit() {
  useEffect(() => {
    void startSolver()
  }, [])
}

/**
 * Recomputes which entities are fully defined after each document change (not per drag frame).
 * An empty sketch has no state to report.
 */
export function useDefinedInfo(sketch: SketchFeature | undefined) {
  const ready = useSketchUi((s) => s.solver === 'ready')
  const sketchId = sketch?.id
  const data = sketch?.sketch
  useEffect(() => {
    const ui = useSketchUi.getState()
    if (!ready || !sketchId || !data || data.entities.length === 0) {
      ui.set({ defined: null })
      return
    }
    try {
      const scope = scopeOf(useProjectStore.getState().doc)
      const base = solveSketch(data, { scope })
      ui.set({
        defined: {
          sketchId,
          states: entityStates(data, scope),
          dof: base.dof,
          state: base.state,
          conflicting: [...base.conflicting, ...base.redundant],
        },
      })
    } catch {
      ui.set({ defined: null })
    }
  }, [ready, sketchId, data])
}

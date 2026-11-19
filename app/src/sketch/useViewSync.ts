// Re-renders a component whenever the camera or the canvas size changes, so overlays follow the view.
import { useEffect, useReducer, useRef } from 'react'
import type { ViewportEngine } from '../viewport/engine'

export function useViewSync(engine: ViewportEngine) {
  const [, bump] = useReducer((n: number) => n + 1, 0)
  const last = useRef('')
  useEffect(() => {
    last.current = engine.viewKey()
    return engine.onFrame(() => {
      const k = engine.viewKey()
      if (k !== last.current) {
        last.current = k
        bump()
      }
    })
  }, [engine])
}

import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ViewportEngine } from './engine'

export interface ViewportProps {
  /** Receives the engine once the canvas is ready, and null when it is torn down. */
  onEngine: (engine: ViewportEngine | null) => void
  /** Overlay content (sketch inputs and the like), drawn above the canvas. It must opt in to pointer events. */
  children?: ReactNode
}

/** One canvas. The three.js scene lives in ViewportEngine and is driven from outside. */
export function Viewport({ onEngine, children }: ViewportProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [failed, setFailed] = useState(false)
  const report = useRef(onEngine)
  report.current = onEngine

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let engine: ViewportEngine
    try {
      engine = new ViewportEngine(canvas)
    } catch {
      setFailed(true)
      return
    }
    report.current(engine)
    return () => {
      report.current(null)
      engine.dispose()
    }
  }, [])

  return (
    <div className="absolute inset-0 overflow-hidden">
      <canvas
        ref={canvasRef}
        aria-label="3D view of the model"
        tabIndex={0}
        className="block size-full touch-none outline-none"
      />
      {failed ? (
        <p role="alert" className="absolute inset-0 flex items-center justify-center p-8 text-center text-text-muted">
          The 3D view could not start. Check that hardware acceleration is turned on in your browser.
        </p>
      ) : null}
      <div className="pointer-events-none absolute inset-0">{children}</div>
    </div>
  )
}

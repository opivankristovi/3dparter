// Dev-only handle for the Playwright suite: exact click positions and document state. Never set in production builds.
import { useProjectStore } from '../doc/store'
import type { Vec3 } from '../doc/types'
import type { ViewportEngine } from '../viewport/engine'

export interface ParterTestHook {
  store: typeof useProjectStore
  engine: ViewportEngine
  toClient: (world: Vec3) => [number, number]
  kernelReady: () => boolean
}

declare global {
  interface Window {
    __3dparter?: ParterTestHook
  }
}

export function installTestHook(engine: ViewportEngine, kernelReady: () => boolean): () => void {
  if (!import.meta.env.DEV) return () => {}
  const hook: ParterTestHook = {
    store: useProjectStore,
    engine,
    toClient: (world) => engine.worldToClient(world),
    kernelReady,
  }
  window.__3dparter = hook
  return () => {
    if (window.__3dparter === hook) delete window.__3dparter
  }
}

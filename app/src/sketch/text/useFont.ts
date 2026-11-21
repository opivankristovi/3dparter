import { useEffect, useSyncExternalStore } from 'react'
import { ensureFont, getLoadedFont, subscribeFont, type Font } from './font'

/** The text font, or null until it has loaded (re-renders when it does). Starts the load. */
export function useFont(): Font | null {
  useEffect(() => {
    void ensureFont().catch(() => undefined)
  }, [])
  return useSyncExternalStore(subscribeFont, getLoadedFont, () => null)
}

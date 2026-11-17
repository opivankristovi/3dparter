import { useEffect, useState } from 'react'
import { flushSaves, useProjectStore } from '../../doc/store'
import { layoutPx } from '../../ui/layout'

/** Live match of a CSS media query. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => matchMedia(query).matches)
  useEffect(() => {
    const mq = matchMedia(query)
    const h = () => setMatches(mq.matches)
    h()
    mq.addEventListener('change', h)
    return () => mq.removeEventListener('change', h)
  }, [query])
  return matches
}

/** Sidebar is docked from the desktop breakpoint up; the tool rail is vertical from the tablet breakpoint up. */
export function useBreakpoints() {
  const desktop = useMediaQuery(`(min-width: ${layoutPx('breakpoint-desktop', 1024)}px)`)
  const tablet = useMediaQuery(`(min-width: ${layoutPx('breakpoint-tablet', 768)}px)`)
  return { desktop, tablet }
}

export function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false
  return t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)
}

/** Ctrl/Cmd+Z undo, Ctrl/Cmd+Shift+Z and Ctrl+Y redo, and the single-letter tool keys. */
export function useWorkspaceHotkeys(toolKeys: Record<string, string>) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return
      const s = useProjectStore.getState()
      const mod = e.ctrlKey || e.metaKey
      const key = e.key.toLowerCase()
      if (mod && key === 'z') {
        e.preventDefault()
        if (e.shiftKey) s.redo()
        else s.undo()
      } else if (mod && key === 'y') {
        e.preventDefault()
        s.redo()
      } else if (!mod && !e.altKey && !e.shiftKey && toolKeys[key]) {
        e.preventDefault()
        s.setActiveTool(s.activeTool === toolKeys[key] ? null : toolKeys[key])
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toolKeys])
}

/** Writes a pending edit out when the tab is hidden or closed. */
export function useSaveOnLeave() {
  useEffect(() => {
    const h = () => void flushSaves()
    window.addEventListener('pagehide', h)
    document.addEventListener('visibilitychange', h)
    return () => {
      window.removeEventListener('pagehide', h)
      document.removeEventListener('visibilitychange', h)
    }
  }, [])
}

// Keeps the viewport engine told how much of the canvas the panels cover, so framing centres the model in the
// part you can see. Panels mark themselves with data-cover="left" | "right" | "top" | "bottom".
import { useEffect } from 'react'
import type { ScreenInsets, ViewportEngine } from '../../viewport/engine'

const SIDES: (keyof ScreenInsets)[] = ['left', 'right', 'top', 'bottom']

export function useCoverInsets(engine: ViewportEngine | null) {
  useEffect(() => {
    if (!engine) return
    const root = engine.canvas.closest('[data-viewport-host]')?.parentElement ?? document.body
    const watched = new Set<Element>()

    const measure = () => {
      const c = engine.canvas.getBoundingClientRect()
      const next: ScreenInsets = { left: 0, right: 0, top: 0, bottom: 0 }
      for (const el of root.querySelectorAll<HTMLElement>('[data-cover]')) {
        const side = el.dataset.cover as keyof ScreenInsets
        if (!SIDES.includes(side)) continue
        const r = el.getBoundingClientRect()
        if (r.width === 0 || r.height === 0) continue
        const depth =
          side === 'left' ? r.right - c.left : side === 'right' ? c.right - r.left : side === 'top' ? r.bottom - c.top : c.bottom - r.top
        next[side] = Math.max(next[side], Math.round(Math.max(0, depth)))
      }
      engine.setScreenInsets(next)
    }

    const ro = new ResizeObserver(measure)
    const watch = () => {
      const now = new Set<Element>(root.querySelectorAll('[data-cover]'))
      for (const el of watched) {
        if (!now.has(el)) {
          ro.unobserve(el)
          watched.delete(el)
        }
      }
      for (const el of now) {
        if (!watched.has(el)) {
          ro.observe(el)
          watched.add(el)
        }
      }
      measure()
    }

    // Panels come and go with the breakpoint, the drawer and the tool in use.
    const mo = new MutationObserver(watch)
    mo.observe(root, { childList: true, subtree: true })
    ro.observe(engine.canvas)
    watch()
    return () => {
      mo.disconnect()
      ro.disconnect()
    }
  }, [engine])
}

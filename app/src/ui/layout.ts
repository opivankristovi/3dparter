/** Reads a `--layout-*` token (px) from the generated tokens.css so numbers live in one place. */
export function layoutPx(name: string, fallback: number): number {
  if (typeof document === 'undefined') return fallback
  const raw = getComputedStyle(document.documentElement).getPropertyValue(`--layout-${name}`)
  const n = parseFloat(raw)
  return Number.isFinite(n) ? n : fallback
}

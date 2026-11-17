const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto', style: 'short' })

/** "2 hr. ago", "yesterday", "3 days ago"; older than a month falls back to a date. */
export function relativeTime(then: number, now = Date.now()): string {
  const sec = Math.round((then - now) / 1000)
  const abs = Math.abs(sec)
  if (abs < 45) return 'just now'
  if (abs < 3600) return rtf.format(Math.round(sec / 60), 'minute')
  if (abs < 86400) return rtf.format(Math.round(sec / 3600), 'hour')
  if (abs < 86400 * 30) return rtf.format(Math.round(sec / 86400), 'day')
  return new Date(then).toLocaleDateString('en', { year: 'numeric', month: 'short', day: 'numeric' })
}

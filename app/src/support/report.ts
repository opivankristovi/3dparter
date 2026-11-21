import { APP_VERSION } from './config'
import type { LogEntry } from './errorLog'

/** Longest URL we hand to GitHub; browsers and GitHub both refuse much more than this. */
const MAX_URL_CHARS = 6000

export function describeBrowser(): string {
  return typeof navigator === 'undefined' ? 'unknown' : navigator.userAgent
}

/** The exact text that "Copy report" and "Open a GitHub issue" send. Nothing else leaves the device. */
export function buildReport(entries: LogEntry[], note: string): string {
  const lines = [
    '### What happened',
    note.trim() || '(not described)',
    '',
    '### App',
    `3DParter ${APP_VERSION}`,
    `Browser: ${describeBrowser()}`,
    '',
    `### Error log (${entries.length} ${entries.length === 1 ? 'entry' : 'entries'})`,
  ]
  if (entries.length === 0) lines.push('No errors logged.')
  for (const e of [...entries].reverse()) {
    lines.push('', `${new Date(e.t).toISOString()} [${e.source}] ${e.message}`)
    if (e.stack) lines.push('```', e.stack, '```')
  }
  return lines.join('\n')
}

/** `<issues url>/new?title=...&body=...`, with the body cut so the whole address stays under MAX_URL_CHARS. */
export function buildIssueUrl(supportUrl: string, title: string, body: string): string {
  const base = `${supportUrl.replace(/\/+$/, '')}/new?title=${encodeURIComponent(title)}&body=`
  const note = '\n\n[report shortened; use Copy report for the full text]'
  const budget = MAX_URL_CHARS - base.length
  if (encodeURIComponent(body).length <= budget) return base + encodeURIComponent(body)
  let cut = Math.min(body.length, budget)
  let text = body.slice(0, cut) + note
  while (encodeURIComponent(text).length > budget && cut > 0) {
    cut = Math.floor(cut * 0.9)
    text = body.slice(0, cut) + note
  }
  return base + encodeURIComponent(text)
}

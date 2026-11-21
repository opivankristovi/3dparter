// Local error log. The last MAX_ENTRIES errors are kept in this browser's localStorage and nowhere else.
// Only the error message, a trimmed stack, the time, the app version and the browser are stored: never project
// content, file names or geometry. Nothing here sends anything; the user chooses to send a report.
import { APP_VERSION } from './config'

export type ErrorSource = 'window' | 'promise' | 'react' | 'kernel'

export interface LogEntry {
  /** Epoch milliseconds. */
  t: number
  source: ErrorSource
  message: string
  stack?: string
  version: string
  ua: string
}

export const LOG_KEY = '3dparter.errorlog'
export const MAX_ENTRIES = 50
const MAX_MESSAGE = 300
const MAX_STACK_LINES = 8
const MAX_STACK_CHARS = 1500
/** Cap on the stored JSON, so a burst of long entries cannot fill the quota. */
const MAX_STORED_CHARS = 60_000

const FILE_NAME = /[^\s/\\"`()<>']+\.(?:stl|3mf|step|stp|obj|glb|gltf|json|svg|dxf|iges|igs|png|jpe?g)\b/gi

/** Removes things that could identify a file or a page: file names, query strings and hash fragments of URLs. */
export function scrub(text: string): string {
  return text
    .replace(/(https?:\/\/[^\s)'"]+?)[?#][^\s)'"]*/g, '$1')
    .replace(FILE_NAME, '[file]')
}

export function trimStack(stack: string | undefined): string | undefined {
  if (!stack) return undefined
  const lines = scrub(stack).split('\n').slice(0, MAX_STACK_LINES).map((l) => l.trimEnd())
  const out = lines.join('\n')
  return out.length > MAX_STACK_CHARS ? `${out.slice(0, MAX_STACK_CHARS)}\n[trimmed]` : out
}

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message || err.name
  if (typeof err === 'string') return err
  if (err && typeof err === 'object' && 'message' in err && typeof (err as { message: unknown }).message === 'string') {
    return (err as { message: string }).message
  }
  return 'Unknown error'
}

function clampMessage(m: string): string {
  const s = scrub(m)
  return s.length > MAX_MESSAGE ? `${s.slice(0, MAX_MESSAGE)}...` : s
}

let memory: LogEntry[] | null = null
const listeners = new Set<() => void>()

function readStored(): LogEntry[] {
  try {
    const raw = localStorage.getItem(LOG_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((e): e is LogEntry => !!e && typeof e === 'object' && typeof (e as LogEntry).message === 'string' && typeof (e as LogEntry).t === 'number')
  } catch {
    return []
  }
}

function write(entries: LogEntry[]) {
  memory = entries
  try {
    let list = entries
    let json = JSON.stringify(list)
    while (json.length > MAX_STORED_CHARS && list.length > 1) {
      list = list.slice(1)
      json = JSON.stringify(list)
    }
    localStorage.setItem(LOG_KEY, json)
  } catch {
    // Storage full, blocked or missing: keep the in-memory copy for this session.
  }
  listeners.forEach((l) => l())
}

/** Newest last. */
export function getEntries(): LogEntry[] {
  memory ??= readStored()
  return memory
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function recordError(source: ErrorSource, err: unknown): void {
  try {
    const entry: LogEntry = {
      t: Date.now(),
      source,
      message: clampMessage(messageOf(err)),
      stack: err instanceof Error ? trimStack(err.stack) : undefined,
      version: APP_VERSION,
      ua: typeof navigator === 'undefined' ? 'unknown' : navigator.userAgent,
    }
    write(mergeIn(entry))
  } catch {
    // Logging must never raise an error of its own.
  }
}

function mergeIn(entry: LogEntry): LogEntry[] {
  // Storage is the truth (other tabs write too); the in-memory copy covers storage that is blocked or full.
  const stored = readStored()
  const current = stored.length > 0 ? stored : getEntries()
  return [...current, entry].slice(-MAX_ENTRIES)
}

export function clearLog(): void {
  write([])
  try {
    localStorage.removeItem(LOG_KEY)
  } catch {
    // ignore
  }
}

/** Test seam: forget the in-memory copy so the next read goes to storage. */
export function resetMemory(): void {
  memory = null
}

let installed = false

/** Hooks window errors and unhandled promise rejections. Safe to call twice. */
export function installErrorCapture(): () => void {
  if (installed || typeof window === 'undefined') return () => {}
  installed = true
  const onError = (e: ErrorEvent) => recordError('window', e.error ?? e.message)
  const onRejection = (e: PromiseRejectionEvent) => recordError('promise', e.reason)
  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onRejection)
  return () => {
    window.removeEventListener('error', onError)
    window.removeEventListener('unhandledrejection', onRejection)
    installed = false
  }
}

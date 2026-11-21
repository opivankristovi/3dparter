import { beforeEach, describe, expect, it, vi } from 'vitest'

// Node has no browser storage: stand in a Map-backed localStorage.
function installStorage(opts: { throws?: boolean } = {}) {
  const map = new Map<string, string>()
  const storage = {
    getItem: (k: string) => {
      if (opts.throws) throw new Error('blocked')
      return map.get(k) ?? null
    },
    setItem: (k: string, v: string) => {
      if (opts.throws) throw new Error('blocked')
      map.set(k, v)
    },
    removeItem: (k: string) => {
      if (opts.throws) throw new Error('blocked')
      map.delete(k)
    },
  }
  vi.stubGlobal('localStorage', storage)
  vi.stubGlobal('navigator', { userAgent: 'TestAgent/1.0' })
  return map
}

async function load() {
  vi.resetModules()
  return import('./errorLog')
}

describe('errorLog', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  it('records time, message, stack, version and browser, and persists them', async () => {
    const map = installStorage()
    const log = await load()
    log.recordError('window', new Error('boom'))
    const [e] = log.getEntries()
    expect(e.message).toBe('boom')
    expect(e.source).toBe('window')
    expect(e.stack).toContain('boom')
    expect(e.ua).toBe('TestAgent/1.0')
    expect(e.version).toMatch(/\d/)
    expect(typeof e.t).toBe('number')
    expect(JSON.parse(map.get(log.LOG_KEY)!)).toHaveLength(1)
  })

  it('accepts strings and plain objects as errors', async () => {
    installStorage()
    const log = await load()
    log.recordError('promise', 'just text')
    log.recordError('promise', { message: 'object message' })
    log.recordError('promise', 42)
    expect(log.getEntries().map((e) => e.message)).toEqual(['just text', 'object message', 'Unknown error'])
  })

  it('keeps only the last 50 entries', async () => {
    const map = installStorage()
    const log = await load()
    for (let i = 0; i < 60; i++) log.recordError('window', `error ${i}`)
    const entries = log.getEntries()
    expect(entries).toHaveLength(log.MAX_ENTRIES)
    expect(entries[0].message).toBe('error 10')
    expect(entries.at(-1)!.message).toBe('error 59')
    expect(JSON.parse(map.get(log.LOG_KEY)!)).toHaveLength(50)
  })

  it('does not throw when localStorage throws, and still keeps entries for the session', async () => {
    installStorage({ throws: true })
    const log = await load()
    expect(() => log.recordError('react', new Error('still fine'))).not.toThrow()
    expect(log.getEntries().map((e) => e.message)).toEqual(['still fine'])
    expect(() => log.clearLog()).not.toThrow()
    expect(log.getEntries()).toEqual([])
  })

  it('trims long stacks and messages', async () => {
    installStorage()
    const log = await load()
    const err = new Error('x'.repeat(2000))
    err.stack = Array.from({ length: 100 }, (_, i) => `    at fn${i} (https://example.test/a.js:${i}:1)`).join('\n')
    log.recordError('kernel', err)
    const [e] = log.getEntries()
    expect(e.message.length).toBeLessThanOrEqual(310)
    expect(e.stack!.split('\n').length).toBeLessThanOrEqual(8)
    expect(e.stack!.length).toBeLessThanOrEqual(1520)
  })

  it('caps one very long stack line', async () => {
    installStorage()
    const log = await load()
    const err = new Error('long')
    err.stack = `Error: long\n    at ${'a'.repeat(10_000)}`
    log.recordError('window', err)
    expect(log.getEntries()[0].stack!.length).toBeLessThanOrEqual(1520)
  })

  it('removes file names and URL queries from messages and stacks', async () => {
    installStorage()
    const log = await load()
    const err = new Error('Could not read my-secret-part.stl at https://app.test/x?token=abc#frag')
    err.stack = 'Error\n    at load (https://app.test/assets/index.js?v=1:1:1)'
    log.recordError('kernel', err)
    const [e] = log.getEntries()
    expect(e.message).not.toContain('my-secret-part')
    expect(e.message).not.toContain('token')
    expect(e.stack).not.toContain('v=1')
  })

  it('clearLog empties memory and storage, and notifies subscribers', async () => {
    const map = installStorage()
    const log = await load()
    const seen = vi.fn()
    log.subscribe(seen)
    log.recordError('window', 'a')
    log.clearLog()
    expect(log.getEntries()).toEqual([])
    expect(map.has(log.LOG_KEY)).toBe(false)
    expect(seen).toHaveBeenCalled()
  })

  it('ignores a corrupt stored value', async () => {
    const map = installStorage()
    map.set('3dparter.errorlog', '{not json')
    const log = await load()
    expect(log.getEntries()).toEqual([])
    log.recordError('window', 'ok')
    expect(log.getEntries()).toHaveLength(1)
  })
})

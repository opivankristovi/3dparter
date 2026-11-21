import { describe, expect, it, vi } from 'vitest'
import { buildIssueUrl, buildReport } from './report'
import type { LogEntry } from './errorLog'

vi.stubGlobal('navigator', { userAgent: 'TestAgent/1.0' })

const entry = (message: string, stack?: string): LogEntry => ({ t: 0, source: 'window', message, stack, version: '1.2.3', ua: 'x' })

describe('report', () => {
  it('lists what happened, the app and the log', () => {
    const text = buildReport([entry('boom', 'at a')], 'It froze')
    expect(text).toContain('It froze')
    expect(text).toContain('TestAgent/1.0')
    expect(text).toContain('[window] boom')
    expect(text).toContain('Error log (1 entry)')
  })

  it('says so when the log is empty', () => {
    expect(buildReport([], '')).toContain('No errors logged.')
  })

  it('builds an issue URL and keeps it under 6000 characters', () => {
    const big = buildReport(Array.from({ length: 50 }, (_, i) => entry(`error ${i} ${'é&?#'.repeat(80)}`, 'x\n'.repeat(400))), 'note')
    const url = buildIssueUrl('https://github.com/o/r/issues/', 'T', big)
    expect(url.startsWith('https://github.com/o/r/issues/new?title=T&body=')).toBe(true)
    expect(url.length).toBeLessThanOrEqual(6000)
    expect(url).toContain(encodeURIComponent('[report shortened'))
  })

  it('does not shorten a small report', () => {
    const url = buildIssueUrl('https://github.com/o/r/issues', 'T', 'short')
    expect(url).toBe('https://github.com/o/r/issues/new?title=T&body=short')
  })
});

import { useEffect, useId, useMemo, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { Dialog as D } from 'radix-ui'
import { SearchX, Search } from 'lucide-react'
import { EmptyState } from './EmptyState'
import { KbdChip } from './KbdChip'
import { cn } from './cn'

export interface Command {
  id: string
  label: string
  group: string
  shortcut?: string
  onRun?: () => void
}

export interface CommandPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  commands: Command[]
}

/** Ctrl/Cmd+K opens the palette. */
export function useCommandPaletteHotkey(onOpen: () => void) {
  useEffect(() => {
    const h = (e: globalThis.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        onOpen()
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onOpen])
}

export function CommandPalette({ open, onOpenChange, commands }: CommandPaletteProps) {
  const uid = useId()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? commands.filter((c) => `${c.label} ${c.group}`.toLowerCase().includes(q)) : commands
  }, [commands, query])

  const groups = useMemo(() => {
    const m = new Map<string, Command[]>()
    results.forEach((c) => m.set(c.group, [...(m.get(c.group) ?? []), c]))
    return [...m.entries()]
  }, [results])

  const optionId = (c: Command) => `${uid}-opt-${c.id}`
  const current = results[Math.min(active, results.length - 1)]

  const run = (c: Command | undefined) => {
    if (!c) return
    onOpenChange(false)
    c.onRun?.()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') setActive((a) => (results.length ? (a + 1) % results.length : 0))
    else if (e.key === 'ArrowUp') setActive((a) => (results.length ? (a - 1 + results.length) % results.length : 0))
    else if (e.key === 'Enter') run(current)
    else return
    e.preventDefault()
  }

  useEffect(() => {
    if (open) {
      setQuery('')
      setActive(0)
    }
  }, [open])

  useEffect(() => {
    if (current) document.getElementById(optionId(current))?.scrollIntoView({ block: 'nearest' })
  })

  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-(--backdrop)" />
        <D.Content
          aria-describedby={undefined}
          className="fixed top-[20%] left-1/2 z-50 flex max-h-[60vh] w-[calc(100vw-2rem)] max-w-[520px] -translate-x-1/2 flex-col overflow-hidden rounded-lg bg-surface-raised shadow-pop"
        >
          <D.Title className="sr-only">Command palette</D.Title>
          <div className="flex items-center gap-2 border-b border-border px-3">
            <Search size={20} strokeWidth={1.75} className="text-text-muted" aria-hidden="true" />
            <input
              role="combobox"
              aria-expanded="true"
              aria-controls={`${uid}-list`}
              aria-activedescendant={current ? optionId(current) : undefined}
              aria-autocomplete="list"
              aria-label="Search commands"
              placeholder="Type a command"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setActive(0)
              }}
              onKeyDown={onKeyDown}
              className="h-12 flex-1 bg-transparent text-base outline-none placeholder:text-text-muted"
            />
          </div>
          <div id={`${uid}-list`} role="listbox" aria-label="Commands" className="min-h-0 flex-1 overflow-auto p-1">
            {groups.map(([group, cmds]) => (
              <div key={group} role="group" aria-labelledby={`${uid}-g-${group}`}>
                <div id={`${uid}-g-${group}`} className="px-2 py-1 text-xs text-text-muted">
                  {group}
                </div>
                {cmds.map((c) => (
                  <div
                    key={c.id}
                    id={optionId(c)}
                    role="option"
                    aria-selected={c === current}
                    onMouseMove={() => setActive(results.indexOf(c))}
                    onClick={() => run(c)}
                    className={cn(
                      'touch-hit-h flex h-8 cursor-default items-center gap-2 rounded-sm px-2 text-base',
                      c === current && 'bg-accent-subtle text-accent',
                    )}
                  >
                    <span className="flex-1">{c.label}</span>
                    {c.shortcut ? <KbdChip>{c.shortcut}</KbdChip> : null}
                  </div>
                ))}
              </div>
            ))}
            {results.length === 0 ? (
              <EmptyState icon={<SearchX strokeWidth={1.75} />} title={`No matches for '${query}'`} />
            ) : null}
          </div>
        </D.Content>
      </D.Portal>
    </D.Root>
  )
}

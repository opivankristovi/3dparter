import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation } from 'wouter'
import { Box, Download, FolderOpen, LayoutGrid, List, Monitor, Moon, Plus, Search, SearchX, Settings, Sun, Trash2, Upload } from 'lucide-react'
import { relativeTime } from '../app/relativeTime'
import { useSettings } from '../app/useSettings'
import { exportProjectJson, parseProjectFile } from '../data/projectFile'
import {
  createProject,
  deleteProject,
  getProject,
  listProjects,
  purgeProject,
  renameProject,
  restoreProject,
} from '../data/projects'
import type { ProjectRow } from '../data/projects'
import { Button } from '../ui/Button'
import { Dialog } from '../ui/Dialog'
import { DropdownMenu } from '../ui/DropdownMenu'
import { EmptyState } from '../ui/EmptyState'
import { IconButton } from '../ui/IconButton'
import { ProjectCard } from '../ui/ProjectCard'
import { SegmentedControl } from '../ui/SegmentedControl'
import { Select } from '../ui/Select'
import { useToast } from '../ui/Toast'
import type { MenuEntry } from '../ui/menu'
import { cn } from '../ui/cn'
import { SettingsDialog } from './dialogs/SettingsDialog'

type Sort = 'updated' | 'name'
type View = 'projects' | 'trash'
type Layout = 'grid' | 'list'

const ic = { size: 16, strokeWidth: 1.75 } as const

function Thumbnail({ blob }: { blob: Blob }) {
  const [url, setUrl] = useState<string>()
  useEffect(() => {
    const u = URL.createObjectURL(blob)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [blob])
  return url ? <img src={url} alt="" className="size-full object-cover" /> : null
}

function Skeleton({ layout }: { layout: Layout }) {
  const block = 'animate-[shimmer_1.4s_ease-in-out_infinite] bg-surface-sunken'
  if (layout === 'list') return <div className={cn('h-10 rounded-md', block)} />
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface-raised">
      <div className={cn('aspect-[4/3] w-full', block)} />
      <div className="flex flex-col gap-2 p-3">
        <div className={cn('h-4 w-3/4 rounded-sm', block)} />
        <div className={cn('h-3 w-1/3 rounded-sm', block)} />
      </div>
    </div>
  )
}

function ThemeMenu() {
  const theme = useSettings((s) => s.settings.theme)
  const update = useSettings((s) => s.update)
  const entry = (value: 'light' | 'dark' | 'system', label: string): MenuEntry => ({
    type: 'checkbox',
    label,
    checked: theme === value,
    onCheckedChange: () => void update({ theme: value }),
  })
  const Icon = theme === 'dark' ? Moon : theme === 'light' ? Sun : Monitor
  return (
    <DropdownMenu
      align="end"
      trigger={<IconButton label="Theme" icon={<Icon size={20} strokeWidth={1.75} />} />}
      items={[entry('light', 'Light'), entry('dark', 'Dark'), entry('system', 'System')]}
    />
  )
}

export function Dashboard() {
  const [, navigate] = useLocation()
  const toast = useToast()

  const [view, setView] = useState<View>('projects')
  const [layout, setLayout] = useState<Layout>('grid')
  const [sort, setSort] = useState<Sort>('updated')
  const [query, setQuery] = useState('')
  const [rows, setRows] = useState<ProjectRow[] | null>(null)
  const [trashCount, setTrashCount] = useState(0)
  const [failed, setFailed] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [purging, setPurging] = useState<ProjectRow | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const request = useRef(0)
  const importInputRef = useRef<HTMLInputElement>(null)

  const reload = useCallback(async () => {
    const mine = ++request.current
    try {
      const [list, trash] = await Promise.all([
        listProjects({ sort, query, onlyDeleted: view === 'trash' }),
        listProjects({ sort: 'updated', onlyDeleted: true }),
      ])
      if (mine !== request.current) return // a newer request is in flight
      setRows(list)
      setTrashCount(trash.length)
      setFailed(false)
    } catch {
      if (mine === request.current) setFailed(true)
    }
  }, [sort, query, view])

  useEffect(() => {
    void reload()
  }, [reload])

  const create = async () => {
    try {
      const p = await createProject()
      navigate(`/p/${p.id}`)
    } catch {
      toast({ variant: 'error', title: "Couldn't create the project", description: 'Browser storage is not available.' })
    }
  }

  const remove = async (p: ProjectRow) => {
    await deleteProject(p.id)
    void reload()
    toast({
      title: `Moved '${p.name}' to Trash`,
      action: {
        label: 'Undo',
        onClick: () => {
          void restoreProject(p.id).then(reload)
        },
      },
    })
  }

  const importProject = async (file: File) => {
    try {
      const parsed = parseProjectFile(await file.text())
      const p = await createProject(parsed.name, parsed.document)
      await reload()
      toast({ title: `Imported '${p.name}'` })
    } catch (e) {
      toast({
        variant: 'error',
        title: "Couldn't import the project",
        description: e instanceof Error ? e.message : 'Check that it is a valid .3dparter.json file.',
      })
    }
  }

  const menuFor = (p: ProjectRow): MenuEntry[] => [
    { label: 'Open', onSelect: () => navigate(`/p/${p.id}`) },
    { label: 'Rename', onSelect: () => setRenamingId(p.id) },
    {
      label: 'Export project',
      icon: <Download {...ic} />,
      onSelect: () => void getProject(p.id).then((row) => row && exportProjectJson(row.name, row.document)),
    },
    { type: 'separator' },
    { label: 'Delete', danger: true, onSelect: () => void remove(p) },
  ]

  const inTrash = view === 'trash'
  const searching = query.trim().length > 0

  let body
  if (failed) {
    body = (
      <EmptyState
        icon={<FolderOpen strokeWidth={1.75} />}
        title="Couldn't open your projects"
        description="Browser storage isn't available. Check that site data isn't blocked."
        action={<Button onClick={() => void reload()}>Try again</Button>}
      />
    )
  } else if (rows === null) {
    body = (
      <div
        role="status"
        aria-busy="true"
        aria-label="Loading projects"
        className={layout === 'grid' ? 'grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4' : 'flex flex-col gap-2'}
      >
        {Array.from({ length: layout === 'grid' ? 8 : 5 }, (_, i) => (
          <Skeleton key={i} layout={layout} />
        ))}
      </div>
    )
  } else if (rows.length === 0) {
    if (searching) {
      body = <EmptyState icon={<SearchX strokeWidth={1.75} />} title={`No matches for '${query.trim()}'`} />
    } else if (inTrash) {
      body = (
        <EmptyState
          icon={<Trash2 strokeWidth={1.75} />}
          title="Trash is empty"
          description="Deleted projects wait here until you remove them for good."
        />
      )
    } else {
      body = (
        <EmptyState
          icon={<Box strokeWidth={1.75} />}
          title="No projects yet"
          description="Start with a sketch on a plane, then pull it into 3D."
          action={
            <Button variant="primary" icon={<Plus {...ic} />} onClick={() => void create()}>
              New project
            </Button>
          }
        />
      )
    }
  } else {
    body = (
      <ul className={layout === 'grid' ? 'grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4' : 'flex flex-col gap-2'}>
        {rows.map((p) => {
          const card = (
            <ProjectCard
              key={p.id}
              variant={layout}
              name={p.name}
              href={inTrash ? '#/' : `#/p/${p.id}`}
              edited={inTrash ? relativeTime(p.deletedAt ?? p.updatedAt) : `Edited ${relativeTime(p.updatedAt)}`}
              thumbnail={p.thumbnail ? <Thumbnail blob={p.thumbnail} /> : undefined}
              renaming={renamingId === p.id}
              onRenameCommit={(name) => {
                setRenamingId(null)
                if (name.trim() && name.trim() !== p.name) void renameProject(p.id, name).then(reload)
              }}
              inTrash={inTrash}
              onRestore={() => void restoreProject(p.id).then(reload)}
              menu={inTrash ? undefined : menuFor(p)}
            />
          )
          return (
            <li key={p.id} className="min-w-0">
              {inTrash ? (
                <div className={layout === 'grid' ? 'flex flex-col gap-1' : 'flex items-center gap-2'}>
                  <div className="min-w-0 flex-1">{card}</div>
                  <Button variant="ghost" size="sm" className="text-danger" onClick={() => setPurging(p)}>
                    Delete forever
                  </Button>
                </div>
              ) : (
                card
              )}
            </li>
          )
        })}
      </ul>
    )
  }

  return (
    <div className="min-h-dvh bg-bg">
      <header className="border-b border-border bg-surface-raised">
        <div className="mx-auto flex h-(--layout-topbar-h) w-full max-w-(--layout-dashboard-max) items-center gap-2 px-4">
          <a href="#/" className="flex items-center gap-2 rounded-sm text-lg font-semibold">
            <Box size={20} strokeWidth={1.75} className="text-accent" aria-hidden="true" />
            3DParter
          </a>
          <div className="flex-1" />
          <ThemeMenu />
          <IconButton label="Settings" icon={<Settings size={20} strokeWidth={1.75} />} onClick={() => setSettingsOpen(true)} />
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-(--layout-dashboard-max) flex-col gap-4 px-4 py-6">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="flex-1 text-xl">{inTrash ? 'Trash' : 'Projects'}</h1>
          {/* .3dshaper / .3dshaper.json are the pre-rename extensions; still accepted so old exports import. */}
          <input
            ref={importInputRef}
            type="file"
            aria-label="Import project file"
            accept=".json,.3dparter,.3dparter.json,.3dshaper,.3dshaper.json"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (f) void importProject(f)
            }}
          />
          <Button variant="secondary" size="lg" icon={<Upload size={20} strokeWidth={1.75} />} onClick={() => importInputRef.current?.click()}>
            Import project
          </Button>
          <Button variant="primary" size="lg" icon={<Plus size={20} strokeWidth={1.75} />} onClick={() => void create()}>
            New project
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-64">
            <Search
              size={16}
              strokeWidth={1.75}
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-text-muted"
            />
            <input
              type="search"
              aria-label="Search projects"
              placeholder="Search projects"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="touch-hit-h h-8 w-full rounded-md border border-border-input bg-bg pr-3 pl-8 text-base placeholder:text-text-muted"
            />
          </div>
          <Select
            label="Sort by"
            value={sort}
            onValueChange={(v) => setSort(v as Sort)}
            options={[
              { value: 'updated', label: 'Last edited' },
              { value: 'name', label: 'Name' },
            ]}
          />
          <div className="flex-1" />
          <SegmentedControl
            label="Show"
            value={view}
            onValueChange={(v) => setView(v as View)}
            options={[
              { value: 'projects', label: 'Projects' },
              { value: 'trash', label: trashCount ? `Trash (${trashCount})` : 'Trash' },
            ]}
          />
          <SegmentedControl
            label="Layout"
            value={layout}
            onValueChange={(v) => setLayout(v as Layout)}
            options={[
              { value: 'grid', icon: <LayoutGrid {...ic} />, label: undefined },
              { value: 'list', icon: <List {...ic} />, label: undefined },
            ]}
          />
        </div>

        {body}
      </main>

      <Dialog
        open={purging !== null}
        onOpenChange={(o) => !o && setPurging(null)}
        title="Delete forever?"
        description={purging ? `Delete '${purging.name}' forever? This can't be undone.` : undefined}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setPurging(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                const p = purging
                setPurging(null)
                if (p) void purgeProject(p.id).then(reload)
              }}
            >
              Delete forever
            </Button>
          </>
        }
      />
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  )
}

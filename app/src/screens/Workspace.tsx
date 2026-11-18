import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useLocation, useParams } from 'wouter'
import { Ellipsis, Moon, PanelRight, Sun } from 'lucide-react'
import { useIsDark, useSettings } from '../app/useSettings'
import { createProject } from '../data/projects'
import { useProjectStore } from '../doc/store'
import { Button } from '../ui/Button'
import { CommandPalette, useCommandPaletteHotkey } from '../ui/CommandPalette'
import type { Command } from '../ui/CommandPalette'
import { DropdownMenu } from '../ui/DropdownMenu'
import { IconButton } from '../ui/IconButton'
import { ProgressIndicator } from '../ui/ProgressIndicator'
import { SidebarPanel } from '../ui/SidebarPanel'
import { TopBar } from '../ui/TopBar'
import { cn } from '../ui/cn'
import { ExportDialog } from './dialogs/ExportDialog'
import type { ExportOptions } from './dialogs/ExportDialog'
import { SettingsDialog } from './dialogs/SettingsDialog'
import { NotFound } from './NotFound'
import { SaveChip } from './workspace/SaveChip'
import { WorkspaceView } from './workspace/WorkspaceView'
import { HistoryTab, ItemsTab, VariablesTab } from './workspace/SidebarTabs'
import type { FeatureStatuses } from './workspace/SidebarTabs'
import { ALL_TOOLS, TOOL_KEYS, WorkspaceToolRail } from './workspace/WorkspaceToolRail'
import { useBreakpoints, useSaveOnLeave, useWorkspaceHotkeys } from './workspace/hooks'

export interface WorkspaceProps {
  /** The 3D viewport, mounted inside the full-bleed host behind the panels. */
  viewport?: ReactNode
  /** Floating card(s) left of the sidebar (parameter card, status chip). Bottom sheet on phones. */
  overlay?: ReactNode
  /** Per-feature build results, shown as error rows in History. */
  statuses?: FeatureStatuses
  /** Extra content for the bottom-centre slot (e.g. a sketch status chip). */
  status?: ReactNode
  /** The kernel is regenerating: thin progress line along the top bar. */
  busy?: boolean
  /** Extra top-bar buttons (e.g. zoom to fit), shown from the desktop breakpoint up. */
  topBarActions?: ReactNode
  /** Writes the file for the Export dialog. Without it, Export reports that it is not connected. */
  onExport?: (opts: ExportOptions) => Promise<void>
}

// Space below the floating top bar: bar height plus two gaps.
const BELOW_TOPBAR = 'top-[calc(var(--layout-topbar-h)+1rem)]'

/** The route entry. WorkspaceView owns the kernel, the viewport and the tools, and renders <Workspace>. */
export function WorkspaceRoute() {
  const { id } = useParams<{ id: string }>()
  return <WorkspaceView key={id} />
}

export function Workspace({ viewport, overlay, statuses, status, busy, topBarActions, onExport }: WorkspaceProps) {
  const { id } = useParams<{ id: string }>()
  const [, navigate] = useLocation()
  const [load, setLoad] = useState<'loading' | 'ok' | 'not-found'>('loading')

  useEffect(() => {
    let live = true
    setLoad('loading')
    useProjectStore
      .getState()
      .load(id)
      .then((r) => live && setLoad(r))
      .catch(() => live && setLoad('not-found'))
    return () => {
      live = false
      useProjectStore.getState().close()
    }
  }, [id])

  if (load === 'not-found') {
    return <NotFound title="Project not found" description="It may have been deleted, or the link is wrong." />
  }
  if (load === 'loading') {
    return (
      <div className="relative h-dvh bg-viewport-bg" aria-busy="true">
        <ProgressIndicator label="Opening project" className="absolute inset-x-0 top-0" />
      </div>
    )
  }
  return (
    <Shell
      viewport={viewport}
      overlay={overlay}
      statuses={statuses}
      status={status}
      busy={busy}
      topBarActions={topBarActions}
      onExport={onExport}
      goHome={() => navigate('/')}
      navigate={navigate}
    />
  )
}

function Shell({
  viewport,
  overlay,
  statuses,
  status,
  busy,
  topBarActions,
  onExport,
  goHome,
  navigate,
}: WorkspaceProps & { goHome: () => void; navigate: (to: string) => void }) {
  const name = useProjectStore((s) => s.name)
  const saveState = useProjectStore((s) => s.saveState)
  const canUndo = useProjectStore((s) => s.canUndo)
  const canRedo = useProjectStore((s) => s.canRedo)
  const activeTool = useProjectStore((s) => s.activeTool)
  const bodyCount = useProjectStore((s) => Object.values(s.doc.bodies).filter((b) => b.visible).length)
  const rename = useProjectStore((s) => s.rename)
  const undo = useProjectStore((s) => s.undo)
  const redo = useProjectStore((s) => s.redo)
  const setActiveTool = useProjectStore((s) => s.setActiveTool)
  const toggleTheme = useSettings((s) => s.toggleTheme)
  const dark = useIsDark()
  const { desktop, tablet } = useBreakpoints()

  const [tab, setTab] = useState('history')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)

  useWorkspaceHotkeys(TOOL_KEYS)
  useSaveOnLeave()
  useCommandPaletteHotkey(() => setPaletteOpen(true))

  const commands: Command[] = useMemo(
    () => [
      {
        id: 'new',
        label: 'New project',
        group: 'Navigation',
        onRun: () => void createProject().then((p) => navigate(`/p/${p.id}`)),
      },
      { id: 'home', label: 'Go to dashboard', group: 'Navigation', onRun: goHome },
      { id: 'undo', label: 'Undo', group: 'Edit', shortcut: 'Ctrl Z', onRun: () => useProjectStore.getState().undo() },
      { id: 'redo', label: 'Redo', group: 'Edit', shortcut: 'Ctrl Y', onRun: () => useProjectStore.getState().redo() },
      ...ALL_TOOLS.map((t) => ({
        id: t.id,
        label: t.label,
        group: t.kind === 'sketch' ? 'Sketch' : 'Modeling',
        shortcut: t.shortcut,
        onRun: () => useProjectStore.getState().setActiveTool(t.id),
      })),
      { id: 'export', label: 'Export STL', group: 'File', onRun: () => setExportOpen(true) },
      { id: 'theme', label: 'Toggle theme', group: 'View', onRun: () => useSettings.getState().toggleTheme() },
    ],
    [goHome, navigate],
  )

  const sidebar = (
    <SidebarPanel
      value={tab}
      onValueChange={setTab}
      open={sidebarOpen}
      onOpenChange={setSidebarOpen}
      className={sidebarOpen ? 'h-full' : 'h-auto'}
      tabs={[
        { value: 'history', label: 'History', content: <HistoryTab statuses={statuses} /> },
        { value: 'items', label: 'Items', content: <ItemsTab /> },
        { value: 'variables', label: 'Variables', content: <VariablesTab /> },
      ]}
    />
  )

  const panelToggle = (
    <IconButton
      label={drawerOpen ? 'Hide panel' : 'Show panel'}
      pressed={drawerOpen}
      icon={<PanelRight size={20} strokeWidth={1.75} />}
      onClick={() => setDrawerOpen((o) => !o)}
    />
  )

  const problem = saveState === 'conflict' || saveState === 'error'

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-viewport-bg">
      <div data-viewport-host className="absolute inset-0">
        {viewport}
      </div>

      <div className="absolute inset-x-2 top-2 z-10">
        <TopBar
          projectName={name}
          onRename={(n) => void rename(n)}
          canUndo={canUndo}
          canRedo={canRedo}
          onBack={goHome}
          onUndo={undo}
          onRedo={redo}
          onExport={() => setExportOpen(true)}
          onSettings={() => setSettingsOpen(true)}
          onThemeToggle={toggleTheme}
          themeIcon={dark ? <Sun size={20} strokeWidth={1.75} /> : <Moon size={20} strokeWidth={1.75} />}
          saveSlot={<SaveChip state={saveState} />}
          busy={busy}
          hideMeasure
          compact={!tablet}
          actions={
            desktop ? (
              topBarActions
            ) : tablet ? (
              <>
                {topBarActions}
                {panelToggle}
              </>
            ) : (
              <DropdownMenu
                align="end"
                trigger={<IconButton label="More" icon={<Ellipsis size={20} strokeWidth={1.75} />} />}
                items={[
                  { label: drawerOpen ? 'Hide panel' : 'Show panel', onSelect: () => setDrawerOpen((o) => !o) },
                  { label: 'Settings', onSelect: () => setSettingsOpen(true) },
                  { label: dark ? 'Light theme' : 'Dark theme', onSelect: toggleTheme },
                ]}
              />
            )
          }
        />
      </div>

      {tablet ? (
        <WorkspaceToolRail
          orientation="vertical"
          activeTool={activeTool}
          onToolChange={setActiveTool}
          className={cn('absolute left-2 z-10', BELOW_TOPBAR)}
        />
      ) : (
        <WorkspaceToolRail
          orientation="horizontal"
          activeTool={activeTool}
          onToolChange={setActiveTool}
          className="absolute inset-x-2 bottom-2 z-10"
        />
      )}

      {desktop ? (
        <div className={cn('absolute right-2 bottom-2 z-10 flex', BELOW_TOPBAR)}>{sidebar}</div>
      ) : drawerOpen ? (
        <div className={cn('absolute right-2 z-20 flex', BELOW_TOPBAR, tablet ? 'bottom-2' : 'bottom-16')}>{sidebar}</div>
      ) : null}

      {overlay ? (
        <div
          className={cn(
            'pointer-events-none absolute z-10 flex',
            desktop
              ? cn(BELOW_TOPBAR, 'right-[calc(var(--layout-sidebar-w)+1.5rem)]')
              : tablet
                ? cn(BELOW_TOPBAR, 'right-2')
                : 'inset-x-2 bottom-16 justify-center',
          )}
        >
          <div className="pointer-events-auto max-w-full">{overlay}</div>
        </div>
      ) : null}

      {problem || status ? (
        <div
          className={cn(
            'absolute left-1/2 z-10 flex -translate-x-1/2 flex-col items-center gap-2',
            tablet ? 'bottom-4' : 'bottom-16',
          )}
        >
          {problem ? (
            <div
              role="alert"
              className="flex items-center gap-3 rounded-lg border border-border bg-surface-raised py-2 pr-2 pl-4 text-base shadow-panel"
            >
              {saveState === 'conflict' ? 'Changed in another tab. Reload to continue.' : "Couldn't save your changes. They are still on screen."}
              {saveState === 'conflict' ? (
                <Button size="sm" variant="primary" onClick={() => location.reload()}>
                  Reload
                </Button>
              ) : null}
            </div>
          ) : null}
          {status}
        </div>
      ) : null}

      <ExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        bodyCount={bodyCount}
        onExport={
          onExport ??
          (async () => {
            throw new Error("Export isn't connected yet.")
          })
        }
      />
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} commands={commands} />
    </div>
  )
}

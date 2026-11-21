import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useLocation, useParams } from 'wouter'
import { Ellipsis, Moon, PanelRight, Sun } from 'lucide-react'
import { useIsDark, useSettings } from '../app/useSettings'
import { exportProjectJson } from '../data/projectFile'
import { createProject } from '../data/projects'
import { addFeature, newId, nextFeatureName } from '../doc/commands'
import { useProjectStore } from '../doc/store'
import type { ImportFeature } from '../doc/types'
import { addDimension, applyConstraint, setAutoConstraints, toggleConstructionOfSelection } from '../sketch/actions'
import { useSketchUi } from '../sketch/sketchUi'
import { Button } from '../ui/Button'
import { CommandPalette, useCommandPaletteHotkey } from '../ui/CommandPalette'
import type { Command } from '../ui/CommandPalette'
import { DropdownMenu } from '../ui/DropdownMenu'
import { IconButton } from '../ui/IconButton'
import { ProgressIndicator } from '../ui/ProgressIndicator'
import { ShortcutSheetDialog } from '../ui/ShortcutSheetDialog'
import { SidebarPanel } from '../ui/SidebarPanel'
import { TopBar } from '../ui/TopBar'
import { cn } from '../ui/cn'
import type { ViewportEngine } from '../viewport/engine'
import { ExportDialog } from './dialogs/ExportDialog'
import type { ExportOptions } from './dialogs/ExportDialog'
import { ImportDialog } from './dialogs/ImportDialog'
import { SettingsDialog } from './dialogs/SettingsDialog'
import { NotFound } from './NotFound'
import { SaveChip } from './workspace/SaveChip'
import { WorkspaceView } from './workspace/WorkspaceView'
import { HistoryTab, ItemsTab } from './workspace/SidebarTabs'
import { VariablesPanel } from './workspace/VariablesPanel'
import { ViewColumn } from './workspace/ViewColumn'
import type { FeatureStatuses } from './workspace/SidebarTabs'
import { useToolStore } from './workspace/toolStore'
import type { SelectionFilter } from './workspace/toolStore'
import { ALL_TOOLS, TOOL_KEYS, WorkspaceToolRail } from './workspace/WorkspaceToolRail'
import { isTypingTarget, useBreakpoints, useSaveOnLeave, useWorkspaceHotkeys } from './workspace/hooks'
import { useCoverInsets } from './workspace/useCoverInsets'

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
  /** Extra top-bar buttons (e.g. zoom to fit), shown on tablets; on desktop the view column has them. */
  topBarActions?: ReactNode
  /** What the right-hand view column (desktop) needs: the camera, and zoom to fit. */
  view?: { engine: ViewportEngine | null; onFit: () => void; onSaveImage?: () => void }
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

export function Workspace({ viewport, overlay, statuses, status, busy, topBarActions, view, onExport }: WorkspaceProps) {
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
      view={view}
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
  view,
  onExport,
  goHome,
  navigate,
}: WorkspaceProps & { goHome: () => void; navigate: (to: string) => void }) {
  const name = useProjectStore((s) => s.name)
  const saveState = useProjectStore((s) => s.saveState)
  const canUndo = useProjectStore((s) => s.canUndo)
  const canRedo = useProjectStore((s) => s.canRedo)
  const activeTool = useProjectStore((s) => s.activeTool)
  const selection = useProjectStore((s) => s.selection)
  const docBodies = useProjectStore((s) => s.doc.bodies)
  const liveBodies = useToolStore((s) => s.liveBodies)
  const visibleLiveBodyIds = useMemo(
    () => new Set(Object.entries(docBodies).filter(([id, b]) => b.visible && (liveBodies === null || liveBodies.includes(id))).map(([id]) => id)),
    [docBodies, liveBodies],
  )
  const bodyCount = visibleLiveBodyIds.size
  const selectedBodyCount = useMemo(
    () => new Set(selection.filter((r) => r.kind === 'body' && visibleLiveBodyIds.has(r.name)).map((r) => r.name)).size,
    [selection, visibleLiveBodyIds],
  )
  const rename = useProjectStore((s) => s.rename)
  const undo = useProjectStore((s) => s.undo)
  const redo = useProjectStore((s) => s.redo)
  const setActiveTool = useProjectStore((s) => s.setActiveTool)
  const toggleTheme = useSettings((s) => s.toggleTheme)
  const dark = useIsDark()
  const { desktop, tablet } = useBreakpoints()
  const sketching = useToolStore((s) => s.activeSketchId !== null)
  const autoOn = useSketchUi((s) => s.autoConstraints)

  const [tab, setTab] = useState('history')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)

  const saveImage = view?.onSaveImage

  useWorkspaceHotkeys(TOOL_KEYS)
  useSaveOnLeave()
  useCommandPaletteHotkey(() => setPaletteOpen(true))
  useCoverInsets(view?.engine ?? null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isTypingTarget(e.target)) return
      if (document.querySelector('[role="dialog"][data-state="open"]')) return
      if (e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault()
        setShortcutsOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

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
      ...(sketching
        ? [
            { id: 'sketch.horizontal', label: 'Horizontal', group: 'Sketch', shortcut: 'H', onRun: () => applyConstraint('horizontal') },
            { id: 'sketch.vertical', label: 'Vertical', group: 'Sketch', shortcut: 'V', onRun: () => applyConstraint('vertical') },
            { id: 'sketch.dimension', label: 'Dimension', group: 'Sketch', shortcut: 'D', onRun: addDimension },
            { id: 'sketch.construction', label: 'Construction', group: 'Sketch', shortcut: 'X', onRun: toggleConstructionOfSelection },
            {
              id: 'sketch.auto',
              label: autoOn ? 'Turn off automatic constraints' : 'Turn on automatic constraints',
              group: 'Sketch',
              onRun: () => setAutoConstraints(!autoOn),
            },
          ]
        : []),
      { id: 'measure', label: 'Measure', group: 'Inspect', shortcut: 'U', onRun: () => useProjectStore.getState().setActiveTool(useProjectStore.getState().activeTool === 'measure' ? null : 'measure') },
      ...(
        [
          ['all', 'Filter: All'],
          ['body', 'Filter: Solids'],
          ['face', 'Filter: Faces'],
          ['edge', 'Filter: Edges'],
          ['vertex', 'Filter: Points'],
        ] as [SelectionFilter, string][]
      ).map(([filter, label]) => ({
        id: `filter.${filter}`,
        label,
        group: 'Selection',
        onRun: () => useToolStore.getState().setSelectionFilter(filter),
      })),
      { id: 'import', label: 'Import STEP', group: 'File', onRun: () => setImportOpen(true) },
      { id: 'export', label: 'Export (STL / 3MF / STEP / OBJ / GLB)', group: 'File', onRun: () => setExportOpen(true) },
      {
        id: 'export.project',
        label: 'Export project (.3dparter.json)',
        group: 'File',
        onRun: () => {
          const s = useProjectStore.getState()
          exportProjectJson(s.name, s.doc)
        },
      },
      {
        id: 'view.section',
        label: 'Toggle section view',
        group: 'View',
        onRun: () => {
          const ts = useToolStore.getState()
          ts.setSectionView(!ts.sectionView)
        },
      },
      {
        id: 'view.wireframe',
        label: 'Toggle wireframe',
        group: 'View',
        onRun: () => {
          const ts = useToolStore.getState()
          ts.setDisplayMode(ts.displayMode === 'wireframe' ? 'shaded' : 'wireframe')
        },
      },
      { id: 'view.image', label: 'Save view as image', group: 'File', onRun: () => saveImage?.() },
      { id: 'shortcuts', label: 'Keyboard shortcuts', group: 'Help', shortcut: '?', onRun: () => setShortcutsOpen(true) },
      { id: 'theme', label: 'Toggle theme', group: 'View', onRun: () => useSettings.getState().toggleTheme() },
    ],
    [goHome, navigate, sketching, autoOn, saveImage],
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
        { value: 'variables', label: 'Variables', content: <VariablesPanel /> },
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
      <main data-viewport-host aria-label="3D view" className="absolute inset-0">
        {viewport}
      </main>

      <div data-cover="top" className="absolute inset-x-2 top-2 z-10">
        <TopBar
          projectName={name}
          onRename={(n) => void rename(n)}
          canUndo={canUndo}
          canRedo={canRedo}
          onBack={goHome}
          onUndo={undo}
          onRedo={redo}
          measureActive={activeTool === 'measure'}
          onMeasure={() => setActiveTool(activeTool === 'measure' ? null : 'measure')}
          onImport={() => setImportOpen(true)}
          onExport={() => setExportOpen(true)}
          onSettings={() => setSettingsOpen(true)}
          onThemeToggle={toggleTheme}
          themeIcon={dark ? <Sun size={20} strokeWidth={1.75} /> : <Moon size={20} strokeWidth={1.75} />}
          saveSlot={<SaveChip state={saveState} />}
          busy={busy}
          compact={!tablet}
          actions={
            desktop ? undefined : tablet ? (
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
                  { label: activeTool === 'measure' ? 'Close Measure' : 'Measure', onSelect: () => setActiveTool(activeTool === 'measure' ? null : 'measure') },
                  { label: 'Import STEP', onSelect: () => setImportOpen(true) },
                  { label: 'Keyboard shortcuts', onSelect: () => setShortcutsOpen(true) },
                  { label: 'Settings', onSelect: () => setSettingsOpen(true) },
                  { label: dark ? 'Light theme' : 'Dark theme', onSelect: toggleTheme },
                ]}
              />
            )
          }
        />
      </div>

      <nav aria-label="Tools" className="contents">
        {tablet ? (
          <WorkspaceToolRail
            orientation="vertical"
            labelled={desktop}
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
      </nav>

      {desktop ? (
        <>
          <aside
            aria-label="Project panels"
            data-cover="right"
            className={cn('absolute right-[calc(var(--layout-viewcol-w)+1rem)] bottom-2 z-10 flex', BELOW_TOPBAR)}
          >
            {sidebar}
          </aside>
          <nav aria-label="View" data-cover="right" className={cn('absolute right-2 z-10', BELOW_TOPBAR)}>
            <ViewColumn
              engine={view?.engine ?? null}
              onFit={view?.onFit ?? (() => {})}
              onSaveImage={view?.onSaveImage}
              panelTab={tab}
              panelOpen={sidebarOpen}
              onOpenPanel={(t) => {
                setTab(t)
                setSidebarOpen(true)
              }}
            />
          </nav>
        </>
      ) : drawerOpen ? (
        <aside aria-label="Project panels" data-cover="right" className={cn('absolute right-2 z-20 flex', BELOW_TOPBAR, tablet ? 'bottom-2' : 'bottom-30')}>
          {sidebar}
        </aside>
      ) : null}

      {overlay ? (
        <section
          aria-label="Tool options"
          className={cn(
            'pointer-events-none absolute z-10 flex',
            desktop
              ? 'bottom-2 left-[calc(var(--layout-toolrail-labelled-w)+1rem)] items-end'
              : tablet
                ? cn(BELOW_TOPBAR, 'right-2')
                : 'inset-x-2 bottom-30 justify-center',
          )}
        >
          <div className="pointer-events-auto max-w-full">{overlay}</div>
        </section>
      ) : null}

      {problem || status ? (
        <section
          aria-label="Messages"
          className={cn(
            'absolute left-1/2 z-10 flex -translate-x-1/2 flex-col items-center gap-2',
            // On desktop an open tool card has its Cancel / Apply bar at the bottom centre: sit above it.
            desktop && overlay ? 'bottom-20' : tablet ? 'bottom-4' : 'bottom-30',
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
        </section>
      ) : null}

      <ExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        bodyCount={bodyCount}
        selectedBodyCount={selectedBodyCount}
        onExport={
          onExport ??
          (async () => {
            throw new Error("Export isn't connected yet.")
          })
        }
      />
      <ImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onImport={(filename, content) => {
          const doc = useProjectStore.getState().doc
          const cleanName = filename.replace(/\.[^.]+$/, '').trim()
          const f: ImportFeature = {
            id: newId(),
            type: 'import',
            name: cleanName || nextFeatureName(doc, 'import'),
            suppressed: false,
            params: { filename, format: 'step', content },
          }
          addFeature(f, 'Import STEP')
          useProjectStore.getState().setSelection([{ kind: 'body', name: f.id }])
        }}
      />
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      <ShortcutSheetDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} commands={commands} />
    </div>
  )
}

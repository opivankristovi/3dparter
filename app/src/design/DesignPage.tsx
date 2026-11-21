import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import {
  Box,
  Copy,
  FolderOpen,
  History,
  Layers,
  Plus,
  Scissors,
  Search,
  Shapes,
  Trash2,
  Variable,
  ArrowUpFromLine,
} from 'lucide-react'
import { Button } from '../ui/Button'
import { Checkbox } from '../ui/Checkbox'
import { CommandPalette, useCommandPaletteHotkey } from '../ui/CommandPalette'
import type { Command } from '../ui/CommandPalette'
import { ConstraintGlyph } from '../ui/ConstraintGlyph'
import type { ConstraintKind, ConstraintState } from '../ui/ConstraintGlyph'
import { ContextMenu } from '../ui/ContextMenu'
import { DimensionLabel } from '../ui/DimensionLabel'
import type { DimensionKind } from '../ui/DimensionLabel'
import { Dialog } from '../ui/Dialog'
import { DropdownMenu } from '../ui/DropdownMenu'
import type { MenuEntry } from '../ui/menu'
import { EmptyState } from '../ui/EmptyState'
import { IconButton } from '../ui/IconButton'
import { KbdChip } from '../ui/KbdChip'
import { NumericInput } from '../ui/NumericInput'
import { ParameterCard, ParameterRow } from '../ui/ParameterCard'
import { ProgressIndicator } from '../ui/ProgressIndicator'
import { ProjectCard } from '../ui/ProjectCard'
import { RollbackMarker } from '../ui/RollbackMarker'
import { SegmentedControl } from '../ui/SegmentedControl'
import { Select } from '../ui/Select'
import { SidebarPanel } from '../ui/SidebarPanel'
import { StatusChip } from '../ui/StatusChip'
import type { StatusChipVariant } from '../ui/StatusChip'
import { Switch } from '../ui/Switch'
import { ToastProvider, useToast } from '../ui/Toast'
import { Toolbar } from '../ui/Toolbar'
import { ToolButton } from '../ui/ToolButton'
import { ToolRail } from '../ui/ToolRail'
import { TopBar } from '../ui/TopBar'
import { Tooltip, TooltipProvider } from '../ui/Tooltip'
import { Tree } from '../ui/Tree'
import type { TreeNode } from '../ui/Tree'
import { cn } from '../ui/cn'


type ThemeChoice = 'light' | 'dark' | 'system'
const ic = { size: 16, strokeWidth: 1.75 } as const

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="flex flex-col gap-3 border-t border-border py-6">
      <h2 id={`${id}-h`} className="text-xl">
        {title}
      </h2>
      {children}
    </section>
  )
}

function Row({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      {label ? <h3 className="text-xs text-text-muted">{label}</h3> : null}
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </div>
  )
}

const menuItems: MenuEntry[] = [
  { label: 'Open', shortcut: 'Enter', icon: <FolderOpen {...ic} /> },
  { label: 'Duplicate', shortcut: 'Ctrl D', icon: <Copy {...ic} /> },
  { type: 'checkbox', label: 'Show in grid', checked: true },
  { type: 'separator' },
  { label: 'Disabled item', disabled: true },
  { label: 'Move to Trash', icon: <Trash2 {...ic} />, danger: true },
]

const historyNodes: TreeNode[] = [
  { id: 'plane', label: 'Front plane', icon: <Layers {...ic} /> },
  { id: 's1', label: 'Sketch 1', icon: <Shapes {...ic} /> },
  { id: 'b1', label: 'Extrude 1', icon: <ArrowUpFromLine {...ic} /> },
  { id: 'b2', label: 'Fillet 1', icon: <Box {...ic} />, error: 'The radius is larger than the adjacent face.' },
  { id: 'b3', label: 'Cut 1 (suppressed)', icon: <Scissors {...ic} />, suppressed: true, beyondRollback: true },
  { id: 'b4', label: 'Hidden body', icon: <Box {...ic} />, hidden: true, beyondRollback: true },
]

const stateTree: TreeNode[] = [
  {
    id: 'folder',
    label: 'Folder (expand me)',
    icon: <FolderOpen {...ic} />,
    children: [
      { id: 'c1', label: 'Default row', icon: <Box {...ic} /> },
      { id: 'c2', label: 'Hidden row', icon: <Box {...ic} />, hidden: true },
      { id: 'c3', label: 'Error row', icon: <Box {...ic} />, error: 'Missing reference: Sketch 4' },
      { id: 'c4', label: 'Suppressed row', icon: <Box {...ic} />, suppressed: true },
      { id: 'c5', label: 'Beyond rollback', icon: <Box {...ic} />, beyondRollback: true },
    ],
  },
  { id: 'sel', label: 'Selected row (click)', icon: <Box {...ic} /> },
]

function HistoryList({ rollback, setRollback }: { rollback: number; setRollback: (n: number) => void }) {
  const [nodes, setNodes] = useState(historyNodes)
  const [sel, setSel] = useState('b1')
  const marked = nodes.map((n, i) => ({ ...n, beyondRollback: i >= rollback }))
  return (
    <div className="relative">
      <Tree
        label="History"
        nodes={marked}
        selectedId={sel}
        onSelect={setSel}
        onToggleHidden={(id) => setNodes((s) => s.map((n) => (n.id === id ? { ...n, hidden: !n.hidden } : n)))}
        onRename={(id, label) => setNodes((s) => s.map((n) => (n.id === id ? { ...n, label } : n)))}
        onDelete={(id) => setNodes((s) => s.filter((n) => n.id !== id))}
      />
      <RollbackMarker value={rollback} max={nodes.length} onChange={setRollback} />
    </div>
  )
}

function ToastDemo() {
  const toast = useToast()
  return (
    <Row>
      <Button onClick={() => toast({ title: 'Project saved' })}>Info</Button>
      <Button onClick={() => toast({ variant: 'success', title: 'Exported Bracket v2.step', action: { label: 'Undo', onClick: () => {} } })}>
        Success with action
      </Button>
      <Button onClick={() => toast({ variant: 'error', title: 'Export failed', description: 'The file could not be written. Try again.' })}>
        Error (sticky)
      </Button>
    </Row>
  )
}

const commands: Command[] = [
  { id: 'home', label: 'Back to projects', group: 'Navigation', shortcut: 'G H' },
  { id: 'line', label: 'Line', group: 'Sketch', shortcut: 'L' },
  { id: 'circle', label: 'Circle', group: 'Sketch', shortcut: 'C' },
  { id: 'extrude', label: 'Extrude', group: 'Modeling', shortcut: 'E' },
  { id: 'revolve', label: 'Revolve', group: 'Modeling' },
  { id: 'fillet', label: 'Fillet', group: 'Edit', shortcut: 'F' },
  { id: 'all', label: 'Select all', group: 'Selection', shortcut: 'Ctrl A' },
]

function MockWorkspace() {
  const [tab, setTab] = useState('history')
  const [rollback, setRollback] = useState(5)
  const [tool, setTool] = useState('extrude')
  const [bool, setBool] = useState('new')
  const [keep, setKeep] = useState(false)
  const [dist, setDist] = useState('20')
  return (
    <div className="relative h-[520px] w-[900px] overflow-hidden rounded-lg bg-viewport-bg">
      <TopBar projectName="Bracket v2" className="absolute inset-x-2 top-2" />
      <div className="absolute top-[64px] left-2">
        <ToolRail activeTool={tool} onToolChange={setTool} />
      </div>
      <div className="absolute top-[64px] right-2 bottom-2 flex">
        <SidebarPanel
          value={tab}
          onValueChange={setTab}
          tabs={[
            { value: 'history', label: 'History', content: <HistoryList rollback={rollback} setRollback={setRollback} /> },
            {
              value: 'items',
              label: 'Items',
              content: <EmptyState icon={<Box strokeWidth={1.75} />} title="Nothing here yet" description="Every sketch and solid you make shows up here, ready to edit." />,
            },
            {
              value: 'vars',
              label: 'Variables',
              content: (
                <EmptyState
                  icon={<Variable strokeWidth={1.75} />}
                  title="No variables"
                  description="Name a number once, use it in any dimension."
                  action={<Button variant="primary" icon={<Plus {...ic} />}>Add variable</Button>}
                />
              ),
            },
          ]}
          className="h-full"
        />
      </div>
      <ParameterCard
        title="Extrude"
        icon={<ArrowUpFromLine size={20} strokeWidth={1.75} />}
        className="absolute top-[64px] right-[300px]"
        onApply={() => {}}
        onCancel={() => {}}
      >
        <NumericInput label="Distance" value={dist} onValueChange={setDist} unit="mm" layout="inline" />
        <ParameterRow label="Operation">
          <SegmentedControl
            label="Operation"
            value={bool}
            onValueChange={setBool}
            options={[
              { value: 'new', label: 'New' },
              { value: 'join', label: 'Join' },
              { value: 'cut', label: 'Cut' },
              { value: 'intersect', label: 'Intersect' },
            ]}
          />
        </ParameterRow>
        <Switch label="Keep originals" checked={keep} onCheckedChange={setKeep} />
      </ParameterCard>
      <StatusChip variant="under-defined" className="absolute bottom-3 left-1/2 -translate-x-1/2" />
    </div>
  )
}

export function DesignPage() {
  const [theme, setTheme] = useState<ThemeChoice>('system')
  const [touch, setTouch] = useState(false)
  const [seg, setSeg] = useState('one')
  const [sw, setSw] = useState(true)
  const [cb, setCb] = useState<boolean>(true)
  const [sel, setSel] = useState('mm')
  const [val, setVal] = useState('42.5')
  const [expr, setExpr] = useState('width * 2')
  const [dlg, setDlg] = useState<null | 'sm' | 'md' | 'lg'>(null)
  const [busyDlg, setBusyDlg] = useState(false)
  const [palette, setPalette] = useState(false)
  const [tool, setTool] = useState('a')
  const [lastCancelled, setCancelled] = useState(false)
  const [rollback, setRollback] = useState(2)
  const [treeSel, setTreeSel] = useState('sel')
  const [det, setDet] = useState(12)
  const [side, setSide] = useState(true)

  useCommandPaletteHotkey(() => setPalette(true))

  useEffect(() => {
    const root = document.documentElement
    if (theme === 'system') root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', theme)
  }, [theme])

  useEffect(() => {
    document.documentElement.classList.toggle('force-touch', touch)
    return () => document.documentElement.classList.remove('force-touch')
  }, [touch])

  const chips: StatusChipVariant[] = ['under-defined', 'fully-defined', 'conflict', 'saving', 'saved', 'offline']
  const constraints: ConstraintKind[] = [
    'coincident', 'horizontal', 'vertical', 'parallel', 'perpendicular', 'tangent', 'equal', 'midpoint', 'concentric', 'symmetric', 'fixed',
  ]
  const cStates: ConstraintState[] = ['default', 'hover', 'selected', 'conflict']
  const dims: DimensionKind[] = ['linear', 'horizontal', 'vertical', 'radius', 'diameter', 'angle']

  return (
    <TooltipProvider>
      <ToastProvider>
        <div className="mx-auto max-w-[1100px] px-4 pb-24">
          <header className="sticky top-0 z-30 -mx-4 flex flex-wrap items-center gap-4 border-b border-border bg-bg px-4 py-3">
            <h1 className="flex-1 text-xl">3DParter design system</h1>
            <SegmentedControl
              label="Theme"
              value={theme}
              onValueChange={(v) => setTheme(v as ThemeChoice)}
              options={[
                { value: 'light', label: 'Light' },
                { value: 'dark', label: 'Dark' },
                { value: 'system', label: 'System' },
              ]}
            />
            <Switch label="Touch preview" checked={touch} onCheckedChange={setTouch} />
          </header>

          <Section id="buttons" title="Button">
            {(['primary', 'secondary', 'ghost', 'danger'] as const).map((v) => (
              <Row key={v} label={v}>
                {(['sm', 'md', 'lg'] as const).map((s) => (
                  <Button key={s} variant={v} size={s} icon={<Plus {...ic} />}>
                    {v} {s}
                  </Button>
                ))}
                <Button variant={v} disabled>
                  Disabled
                </Button>
                <Button variant={v} loading>
                  Loading
                </Button>
              </Row>
            ))}
          </Section>

          <Section id="iconbuttons" title="IconButton">
            <Row label="ghost 28 / 32, toggle off / on, disabled (hover for tooltip)">
              <IconButton label="Search" size={28} icon={<Search {...ic} />} />
              <IconButton label="Search" shortcut="Ctrl K" icon={<Search size={20} strokeWidth={1.75} />} />
              <IconButton label="Show grid" pressed={side} onClick={() => setSide((s) => !s)} icon={<Layers size={20} strokeWidth={1.75} />} />
              <IconButton label="Show grid" pressed={!side} onClick={() => setSide((s) => !s)} icon={<Layers size={20} strokeWidth={1.75} />} />
              <IconButton label="History" disabled icon={<History size={20} strokeWidth={1.75} />} />
            </Row>
          </Section>

          <Section id="tooltip" title="Tooltip and KbdChip">
            <Row>
              <Tooltip label="Extrude" shortcut="E">
                <Button>Hover or focus me</Button>
              </Tooltip>
              <KbdChip>E</KbdChip>
              <KbdChip>Ctrl K</KbdChip>
              <span className="rounded-sm bg-tooltip-bg p-2">
                <KbdChip onTooltip>Shift</KbdChip>
              </span>
            </Row>
          </Section>

          <Section id="toolbar" title="Toolbar and ToolButton">
            <Row label="horizontal, roving tabindex (arrow keys); active, default, disabled">
              <Toolbar label="Demo tools">
                {['a', 'b', 'c'].map((t) => (
                  <ToolButton key={t} label={`Tool ${t.toUpperCase()}`} caption={`Tool ${t.toUpperCase()}`} icon={<Box size={20} strokeWidth={1.75} />} active={tool === t} onClick={() => setTool(t)} tooltipSide="bottom" />
                ))}
                <ToolButton label="Disabled" caption="Off" disabled icon={<Box size={20} strokeWidth={1.75} />} tooltipSide="bottom" />
              </Toolbar>
            </Row>
          </Section>

          <Section id="numeric" title="NumericInput">
            <div className="grid max-w-[640px] grid-cols-2 gap-4">
              <NumericInput label="Default" value={val} onValueChange={setVal} unit="mm" />
              <NumericInput label="Expression" value={expr} onValueChange={setExpr} unit="mm" resolvedValue="42.5 mm" />
              <NumericInput label="Invalid" value="widht" error="Unknown variable 'widht'" unit="mm" />
              <NumericInput label="Disabled" value="10" unit="mm" disabled />
              <NumericInput label="Driven (read-only)" value="31.2" unit="mm" readOnly />
              <NumericInput label="Angle" value="45" unit="°" step={5} />
            </div>
            <p className="text-sm text-text-muted">Enter commits, Esc reverts, ArrowUp/Down steps (Shift ×10, Alt ×0.1), drag a label to scrub.</p>
          </Section>

          <Section id="param" title="ParameterCard">
            <Row>
              <ParameterCard title="Fillet" icon={<Box size={20} strokeWidth={1.75} />} onApply={() => {}} onCancel={() => setCancelled((c) => !c)}>
                <NumericInput label="Radius" value="2" unit="mm" layout="inline" />
              </ParameterCard>
              <ParameterCard title="Fillet" icon={<Box size={20} strokeWidth={1.75} />} busy editingStep={7} onApply={() => {}} onCancel={() => {}}>
                <NumericInput label="Radius" value="2" unit="mm" layout="inline" />
              </ParameterCard>
              <ParameterCard
                title="Fillet"
                icon={<Box size={20} strokeWidth={1.75} />}
                failure={{ message: 'The fillet could not be built on this edge.', hint: 'Try a smaller radius.' }}
                applyDisabled
                onApply={() => {}}
                onCancel={() => {}}
              >
                <NumericInput label="Radius" value="40" unit="mm" layout="inline" error="Too large for this edge" />
              </ParameterCard>
            </Row>
            <p className="text-sm text-text-muted" aria-live="polite">{lastCancelled ? 'Cancel pressed (toggle).' : 'Press Esc inside a card to cancel.'}</p>
          </Section>

          <Section id="controls" title="SegmentedControl, Switch, Checkbox, Select">
            <Row label="text, icon, icon + text">
              <SegmentedControl label="Text" value={seg} onValueChange={setSeg} options={[{ value: 'one', label: 'One side' }, { value: 'both', label: 'Both' }, { value: 'flip', label: 'Flip' }, { value: 'off', label: 'Disabled', disabled: true }]} />
              <SegmentedControl label="Icon" value={seg} onValueChange={setSeg} options={[{ value: 'one', icon: <Box {...ic} /> }, { value: 'both', icon: <Layers {...ic} /> }]} />
              <SegmentedControl label="Icon and text" value={seg} onValueChange={setSeg} options={[{ value: 'one', label: 'Box', icon: <Box {...ic} /> }, { value: 'both', label: 'Layers', icon: <Layers {...ic} /> }]} />
            </Row>
            <Row label="switch on / off / disabled; checkbox checked / unchecked / indeterminate / disabled">
              <Switch label="Keep originals" checked={sw} onCheckedChange={setSw} />
              <Switch label="Off" checked={false} onCheckedChange={() => {}} />
              <Switch label="Disabled" checked disabled onCheckedChange={() => {}} />
              <Checkbox label="Snap to grid" checked={cb} onCheckedChange={setCb} />
              <Checkbox label="Unchecked" checked={false} onCheckedChange={() => {}} />
              <Checkbox label="Mixed" checked="indeterminate" onCheckedChange={() => {}} />
              <Checkbox label="Disabled" checked={false} disabled onCheckedChange={() => {}} />
            </Row>
            <Row label="select, disabled select">
              <Select label="Units" value={sel} onValueChange={setSel} options={[{ value: 'mm', label: 'Millimetres' }, { value: 'cm', label: 'Centimetres' }, { value: 'in', label: 'Inches' }, { value: 'ft', label: 'Feet', disabled: true }]} />
              <Select label="Units" value="mm" onValueChange={() => {}} disabled options={[{ value: 'mm', label: 'Millimetres' }]} />
            </Row>
          </Section>

          <Section id="menus" title="DropdownMenu and ContextMenu">
            <Row>
              <DropdownMenu trigger={<Button>Open menu</Button>} items={menuItems} />
              <ContextMenu items={menuItems} className="rounded-md border border-dashed border-border-input p-6 text-sm text-text-muted">
                Right-click, long-press or press Shift+F10 here
              </ContextMenu>
            </Row>
          </Section>

          <Section id="topbar" title="TopBar">
            <TopBar projectName="Bracket v2" floating={false} saveState="saved" />
            <TopBar projectName="Bracket v2" saveState="saving" busy canRedo />
            <TopBar projectName="Bracket v2" saveState="offline" />
          </Section>

          <Section id="toolrail" title="ToolRail">
            <Row>
              <ToolRail activeTool="extrude" />
              <ToolRail activeTool="circle" mode="sketch" />
              <ToolRail activeTool="fillet" compact />
            </Row>
          </Section>

          <Section id="tree" title="Tree, TreeRow and RollbackMarker">
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              <div className="max-w-[320px] rounded-lg bg-surface-raised p-1 shadow-panel">
                <Tree label="States" nodes={stateTree} defaultExpanded={['folder']} selectedId={treeSel} onSelect={setTreeSel} onToggleHidden={() => {}} onRename={() => {}} />
              </div>
              <div className="max-w-[320px] rounded-lg bg-surface-raised p-1 shadow-panel">
                <HistoryList rollback={rollback} setRollback={setRollback} />
              </div>
            </div>
          </Section>

          <Section id="sidebar" title="SidebarPanel">
            <p className="text-sm text-text-muted">Drag the left edge, or focus it and use the arrow keys (16px steps). Collapse with the chevron.</p>
            <div className="flex justify-end">
              <SidebarDemo />
            </div>
          </Section>

          <Section id="cards" title="ProjectCard">
            <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-6">
              <ProjectCard name="Bracket v2" edited="Edited 2 h ago" menu={menuItems} />
              <ProjectCard name="Selected" edited="Edited yesterday" selected menu={menuItems} />
              <ProjectCard name="Loading thumbnail" edited="Edited just now" loadingThumbnail menu={menuItems} />
              <ProjectCard name="Renaming" edited="Edited 3 d ago" renaming />
              <ProjectCard name="Old bracket" edited="5 d ago" inTrash />
            </div>
            <div className="flex max-w-[640px] flex-col gap-2">
              <ProjectCard variant="list" name="Bracket v2" edited="Edited 2 h ago" menu={menuItems} />
              <ProjectCard variant="list" name="Selected" edited="Edited yesterday" selected menu={menuItems} />
              <ProjectCard variant="list" name="Old bracket" edited="5 d ago" inTrash />
            </div>
          </Section>

          <Section id="empty" title="EmptyState">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <EmptyState icon={<FolderOpen strokeWidth={1.75} />} title="No projects yet" description="Start with a sketch on a plane, then pull it into 3D." action={<Button variant="primary" size="lg">New project</Button>} />
              <EmptyState icon={<History strokeWidth={1.75} />} title="Nothing here yet" description="Every sketch and solid you make shows up here, ready to edit." />
              <EmptyState icon={<Variable strokeWidth={1.75} />} title="No variables" description="Name a number once, use it in any dimension." action={<Button variant="primary">Add variable</Button>} />
              <EmptyState icon={<Search strokeWidth={1.75} />} title="No matches for 'flange'" />
            </div>
          </Section>

          <Section id="dialog" title="Dialog">
            <Row>
              <Button onClick={() => setDlg('sm')}>Confirm (sm)</Button>
              <Button onClick={() => setDlg('md')}>Export (md, busy)</Button>
              <Button onClick={() => setDlg('lg')}>Settings (lg, error)</Button>
            </Row>
            <Dialog
              open={dlg === 'sm'}
              onOpenChange={(o) => !o && setDlg(null)}
              size="sm"
              title="Delete 'Bracket v2'?"
              description="You can restore it from Trash for 30 days."
              footer={
                <>
                  <Button onClick={() => setDlg(null)}>Cancel</Button>
                  <Button variant="danger" onClick={() => setDlg(null)}>Delete</Button>
                </>
              }
            />
            <Dialog
              open={dlg === 'md'}
              onOpenChange={(o) => {
                if (!o) {
                  setDlg(null)
                  setBusyDlg(false)
                }
              }}
              size="md"
              busy={busyDlg}
              title="Export project"
              description="Choose a format for the whole model."
              footer={
                <>
                  <Button onClick={() => setDlg(null)}>Cancel</Button>
                  <Button variant="primary" loading={busyDlg} onClick={() => setBusyDlg(true)}>Export</Button>
                </>
              }
            >
              <Select label="Format" value="step" onValueChange={() => {}} options={[{ value: 'step', label: 'STEP' }, { value: 'stl', label: 'STL' }]} />
              {busyDlg ? <ProgressIndicator variant="determinate" label="Exporting…" value={40} /> : null}
            </Dialog>
            <Dialog
              open={dlg === 'lg'}
              onOpenChange={(o) => !o && setDlg(null)}
              size="lg"
              title="Settings"
              error="Your changes could not be saved. Check your connection and try again."
              footer={<Button variant="primary" onClick={() => setDlg(null)}>Done</Button>}
            >
              <NumericInput label="Grid spacing" value="10" unit="mm" />
            </Dialog>
          </Section>

          <Section id="toast" title="Toast">
            <ToastDemo />
          </Section>

          <Section id="palette" title="CommandPalette">
            <Row>
              <Button onClick={() => setPalette(true)}>
                Open <KbdChip>Ctrl K</KbdChip>
              </Button>
            </Row>
            <CommandPalette open={palette} onOpenChange={setPalette} commands={commands} />
          </Section>

          <Section id="progress" title="ProgressIndicator">
            <Row>
              <div className="w-64">
                <ProgressIndicator label="Updating preview" />
              </div>
              <ProgressIndicator variant="spinner" size={16} label="Working" />
              <ProgressIndicator variant="spinner" size={20} label="Working" />
              <div className="w-72">
                <ProgressIndicator variant="determinate" label={`Loading geometry engine… ${det} / 23 MB`} value={det} max={23} />
              </div>
              <Button size="sm" onClick={() => setDet((d) => (d >= 23 ? 0 : d + 4))}>Advance</Button>
            </Row>
          </Section>

          <Section id="status" title="StatusChip">
            <Row>
              {chips.map((c) => (
                <StatusChip key={c} variant={c} />
              ))}
              <StatusChip variant="under-defined" degreesOfFreedom={1} />
            </Row>
          </Section>

          <Section id="glyphs" title="ConstraintGlyph and DimensionLabel">
            {cStates.map((s) => (
              <Row key={s} label={`constraints: ${s}`}>
                {constraints.map((k) => (
                  <ConstraintGlyph key={k} kind={k} state={s} size={24} />
                ))}
                <ConstraintGlyph kind="horizontal" state={s} />
              </Row>
            ))}
            <div className="rounded-lg bg-viewport-bg p-3">
              <div className="flex flex-wrap gap-4">
                {dims.map((d) => (
                  <DimensionLabel key={d} kind={d} value={d === 'angle' ? '40°' : '24 mm'} />
                ))}
                <DimensionLabel kind="horizontal" value="24 mm" state="driven" />
                <DimensionLabel kind="horizontal" value="24 mm" state="editing" />
                <DimensionLabel kind="horizontal" value="24 mm" state="conflict" />
              </div>
            </div>
          </Section>

          <Section id="workspace" title="Mock workspace (900 × 520)">
            <div className={cn('overflow-x-auto')}>
              <MockWorkspace />
            </div>
          </Section>
        </div>
      </ToastProvider>
    </TooltipProvider>
  )
}

function SidebarDemo() {
  const [tab, setTab] = useState('history')
  const [open, setOpen] = useState(true)
  const [rb, setRb] = useState(4)
  return (
    <div className="h-72">
      <SidebarPanel
        className="h-full"
        value={tab}
        onValueChange={setTab}
        open={open}
        onOpenChange={setOpen}
        tabs={[
          { value: 'history', label: 'History', content: <HistoryList rollback={rb} setRollback={setRb} /> },
          { value: 'items', label: 'Items', content: <EmptyState icon={<Box strokeWidth={1.75} />} title="Nothing here yet" description="Every sketch and solid you make shows up here, ready to edit." /> },
        ]}
      />
    </div>
  )
}

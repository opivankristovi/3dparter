import { useMemo } from 'react'
import {
  ArrowUpFromLine,
  Box,
  FlipHorizontal2,
  Grid2x2,
  Layers,
  Palette,
  PenLine,
  Scissors,
  Upload,
  Variable,
  Wind,
} from 'lucide-react'
import { setBodyAppearance, setBodyVisible } from '../../doc/commands'
import { useProjectStore } from '../../doc/store'
import type { Feature } from '../../doc/types'
import { handlePick } from '../../modeling/picking'
import { DropdownMenu } from '../../ui/DropdownMenu'
import { EmptyState } from '../../ui/EmptyState'
import { IconButton } from '../../ui/IconButton'
import { ChamferIcon, CombineIcon, FilletIcon, MoveIcon, PlaneIcon, RevolveIcon, ShellIcon } from '../../ui/ModelIcons'
import { Tree } from '../../ui/Tree'
import type { TreeNode } from '../../ui/Tree'
import { cn } from '../../ui/cn'
import { HistoryList } from './HistoryList'
import { useToolStore } from './toolStore'

export type FeatureStatuses = Record<string, { ok: boolean; message?: string; warning?: string }>

const ic = { size: 16, strokeWidth: 1.75 } as const

const BODY_COLORS: { value: string | null; label: string; dotClass: string }[] = [
  { value: null, label: 'Default', dotClass: 'bg-body' },
  { value: 'token:accent', label: 'Blue', dotClass: 'bg-accent' },
  { value: 'token:success', label: 'Green', dotClass: 'bg-success' },
  { value: 'token:warning', label: 'Amber', dotClass: 'bg-warning' },
  { value: 'token:danger', label: 'Red', dotClass: 'bg-danger' },
]

const BODY_OPACITIES = [1, 0.75, 0.5, 0.25] as const

function swatchDotClass(color: string | null): string {
  return BODY_COLORS.find((c) => c.value === color)?.dotClass ?? 'bg-body'
}

function featureIcon(type: Feature['type']) {
  switch (type) {
    case 'sketch':
      return <PenLine {...ic} />
    case 'extrude':
      return <ArrowUpFromLine {...ic} />
    case 'revolve':
      return <RevolveIcon {...ic} />
    case 'sweep':
      return <Wind {...ic} />
    case 'loft':
      return <Layers {...ic} />
    case 'fillet':
      return <FilletIcon {...ic} />
    case 'chamfer':
      return <ChamferIcon {...ic} />
    case 'shell':
      return <ShellIcon {...ic} />
    case 'boolean':
      return <CombineIcon {...ic} />
    case 'split':
      return <Scissors {...ic} />
    case 'transform':
      return <MoveIcon {...ic} />
    case 'mirror':
      return <FlipHorizontal2 {...ic} />
    case 'pattern':
      return <Grid2x2 {...ic} />
    case 'plane':
      return <PlaneIcon {...ic} />
    case 'import':
      return <Upload {...ic} />
  }
}

export function HistoryTab({ statuses }: { statuses?: FeatureStatuses }) {
  return <HistoryList statuses={statuses} icons={featureIcon} />
}

export function ItemsTab() {
  const bodies = useProjectStore((s) => s.doc.bodies)
  const selection = useProjectStore((s) => s.selection)
  const liveBodies = useToolStore((s) => s.liveBodies)

  const nodes: TreeNode[] = useMemo(
    () =>
      Object.entries(bodies)
        .filter(([id]) => liveBodies === null || liveBodies.includes(id))
        .map(([id, b]) => ({
          id,
          label: b.name,
          icon:
            b.color || b.opacity < 1 ? (
              <span
                aria-hidden="true"
                className={cn('inline-block size-3 rounded-pill border border-border', swatchDotClass(b.color))}
                style={b.opacity < 1 ? { opacity: b.opacity } : undefined}
              />
            ) : (
              <Box {...ic} />
            ),
          hidden: !b.visible,
          trailing: (
            <span
              className="inline-flex shrink-0 items-center"
              onClick={(e) => e.stopPropagation()}
            >
              <DropdownMenu
                align="end"
                trigger={
                  <IconButton
                    size={28}
                    label={`Appearance for ${b.name}`}
                    icon={<Palette size={14} strokeWidth={1.75} />}
                  />
                }
                items={[
                  { type: 'label', label: 'Colour' },
                  ...BODY_COLORS.map((c) => ({
                    type: 'checkbox' as const,
                    label: c.label,
                    checked: (b.color ?? null) === c.value,
                    onCheckedChange: () => setBodyAppearance(id, { color: c.value }),
                  })),
                  { type: 'separator' },
                  { type: 'label', label: 'Opacity' },
                  ...BODY_OPACITIES.map((op) => ({
                    type: 'checkbox' as const,
                    label: `${Math.round(op * 100)}%`,
                    checked: Math.abs(b.opacity - op) < 0.01,
                    onCheckedChange: () => setBodyAppearance(id, { opacity: op }),
                  })),
                  { type: 'separator' },
                  {
                    label: b.visible ? 'Hide' : 'Show',
                    onSelect: () => setBodyVisible(id, !b.visible),
                  },
                  {
                    label: 'Reset appearance',
                    disabled: b.color === null && Math.abs(b.opacity - 1) < 0.01,
                    onSelect: () => setBodyAppearance(id, { color: null, opacity: 1 }),
                  },
                ]}
              />
            </span>
          ),
        })),
    [bodies, liveBodies],
  )

  const selectedIds = useMemo(
    () => selection.filter((r) => r.kind === 'body').map((r) => r.name),
    [selection],
  )

  if (nodes.length === 0) {
    return (
      <EmptyState
        icon={<Box strokeWidth={1.75} />}
        title="No solids yet"
        description="Extrude a sketch and your first solid appears here."
      />
    )
  }

  return (
    <Tree
      label="Solids"
      nodes={nodes}
      selectedIds={selectedIds}
      onSelect={(id) => handlePick({ kind: 'body', name: id }, false)}
      onToggleHidden={(id) => setBodyVisible(id, !bodies[id]?.visible)}
    />
  )
}

export function VariablesTab() {
  return (
    <EmptyState
      icon={<Variable strokeWidth={1.75} />}
      title="Variables arrive soon"
      description="Name a number once, use it in any dimension."
    />
  )
}

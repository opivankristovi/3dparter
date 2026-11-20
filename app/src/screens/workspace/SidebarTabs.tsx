import { useMemo } from 'react'
import { ArrowUpFromLine, Box, PenLine, Variable } from 'lucide-react'
import { setBodyVisible } from '../../doc/commands'
import { useProjectStore } from '../../doc/store'
import type { Feature } from '../../doc/types'
import { handlePick } from '../../modeling/picking'
import { EmptyState } from '../../ui/EmptyState'
import { ChamferIcon, CombineIcon, FilletIcon, MoveIcon, PlaneIcon, RevolveIcon, ShellIcon } from '../../ui/ModelIcons'
import { Tree } from '../../ui/Tree'
import type { TreeNode } from '../../ui/Tree'
import { HistoryList } from './HistoryList'
import { useToolStore } from './toolStore'

export type FeatureStatuses = Record<string, { ok: boolean; message?: string; warning?: string }>

const ic = { size: 16, strokeWidth: 1.75 } as const

function featureIcon(type: Feature['type']) {
  switch (type) {
    case 'sketch':
      return <PenLine {...ic} />
    case 'extrude':
      return <ArrowUpFromLine {...ic} />
    case 'revolve':
      return <RevolveIcon {...ic} />
    case 'fillet':
      return <FilletIcon {...ic} />
    case 'chamfer':
      return <ChamferIcon {...ic} />
    case 'shell':
      return <ShellIcon {...ic} />
    case 'boolean':
      return <CombineIcon {...ic} />
    case 'transform':
      return <MoveIcon {...ic} />
    case 'plane':
      return <PlaneIcon {...ic} />
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
          icon: <Box {...ic} />,
          hidden: !b.visible,
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

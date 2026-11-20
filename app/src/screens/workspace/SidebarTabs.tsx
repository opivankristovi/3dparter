import { useMemo, useState } from 'react'
import { ArrowUpFromLine, Box, History, PenLine, Variable } from 'lucide-react'
import { deleteFeature, renameFeature, setBodyVisible } from '../../doc/commands'
import { useProjectStore } from '../../doc/store'
import type { Feature } from '../../doc/types'
import { handlePick } from '../../modeling/picking'
import { ConstraintList } from '../../sketch/ConstraintList'
import { ContextMenu } from '../../ui/ContextMenu'
import { EmptyState } from '../../ui/EmptyState'
import { ChamferIcon, CombineIcon, FilletIcon, MoveIcon, PlaneIcon, RevolveIcon, ShellIcon } from '../../ui/ModelIcons'
import { Tree } from '../../ui/Tree'
import type { TreeNode } from '../../ui/Tree'
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
  const features = useProjectStore((s) => s.doc.features)
  const rollbackIndex = useProjectStore((s) => s.doc.rollbackIndex)
  const editingId = useProjectStore((s) => s.editingFeatureId)
  const setEditing = useProjectStore((s) => s.setEditingFeature)
  const [menuId, setMenuId] = useState<string | null>(null)

  const nodes: TreeNode[] = useMemo(
    () =>
      features.map((f, idx) => {
        const st = statuses?.[f.id]
        return {
          id: f.id,
          label: f.name,
          icon: featureIcon(f.type),
          suppressed: f.suppressed,
          beyondRollback: rollbackIndex !== null && idx >= rollbackIndex,
          error: st && !st.ok ? (st.message ?? 'This step could not be built.') : undefined,
          warning: st?.ok ? st.warning : undefined,
        }
      }),
    [features, statuses, rollbackIndex],
  )

  if (features.length === 0) {
    return (
      <EmptyState
        icon={<History strokeWidth={1.75} />}
        title="Nothing here yet"
        description="Every sketch and solid you make shows up here, ready to edit."
      />
    )
  }

  return (
    <>
      <ContextMenu
        items={[
          { label: 'Edit', onSelect: () => menuId && setEditing(menuId) },
          { type: 'separator' },
          { label: 'Delete', shortcut: 'Del', danger: true, onSelect: () => menuId && deleteFeature(menuId) },
        ]}
      >
        <div
          onContextMenuCapture={(e) => {
            const row = (e.target as HTMLElement).closest<HTMLElement>('[data-tree-id]')
            setMenuId(row?.dataset.treeId ?? null)
          }}
        >
          <Tree
            label="History"
            nodes={nodes}
            selectedId={editingId ?? undefined}
            onSelect={setEditing}
            onRename={renameFeature}
            onDelete={deleteFeature}
          />
        </div>
      </ContextMenu>
      <ConstraintList />
    </>
  )
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

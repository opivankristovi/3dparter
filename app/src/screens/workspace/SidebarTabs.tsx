import { useMemo, useState } from 'react'
import { ArrowUpFromLine, Box, History, PenLine, Variable } from 'lucide-react'
import { deleteFeature, renameFeature, setBodyVisible } from '../../doc/commands'
import { useProjectStore } from '../../doc/store'
import type { Feature } from '../../doc/types'
import { ContextMenu } from '../../ui/ContextMenu'
import { EmptyState } from '../../ui/EmptyState'
import { Tree } from '../../ui/Tree'
import type { TreeNode } from '../../ui/Tree'

export type FeatureStatuses = Record<string, { ok: boolean; message?: string }>

const ic = { size: 16, strokeWidth: 1.75 } as const

function featureIcon(type: Feature['type']) {
  return type === 'sketch' ? <PenLine {...ic} /> : <ArrowUpFromLine {...ic} />
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
  )
}

export function ItemsTab() {
  const bodies = useProjectStore((s) => s.doc.bodies)
  const selection = useProjectStore((s) => s.selection)
  const setSelection = useProjectStore((s) => s.setSelection)

  const nodes: TreeNode[] = useMemo(
    () =>
      Object.entries(bodies).map(([id, b]) => ({
        id,
        label: b.name,
        icon: <Box {...ic} />,
        hidden: !b.visible,
      })),
    [bodies],
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

  const selected = selection.find((r) => r.kind === 'body')?.name
  return (
    <Tree
      label="Solids"
      nodes={nodes}
      selectedId={selected}
      onSelect={(id) => setSelection([{ kind: 'body', name: id }])}
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

// The Fillet and Chamfer tools: the picked edges become a draft feature that the kernel previews live; Apply
// writes it as one undo step. The two tools differ only in a word and a parameter name.
import { useCallback, useEffect } from 'react'
import type { ReactNode } from 'react'
import { newId, nextFeatureName } from '../doc/commands'
import { useProjectStore } from '../doc/store'
import type { ChamferFeature, DisplayUnit, FilletFeature, Ref } from '../doc/types'
import type { KernelState } from '../screens/workspace/useKernel'
import { useToolStore } from '../screens/workspace/toolStore'
import { NumericInput } from '../ui/NumericInput'
import { ParameterCard, ParameterRow } from '../ui/ParameterCard'
import { RemovableChip } from '../ui/RemovableChip'
import { ChamferIcon, FilletIcon } from '../ui/ModelIcons'
import { applyDraft, cancelDraft, changeDraft, useLengthInput } from './draft'
import { countLabel, refsOfKind, sameRefSet } from './logic'

export type BlendKind = 'fillet' | 'chamfer'
type Blend = FilletFeature | ChamferFeature

const CONFIG = {
  fillet: { title: 'Fillet', field: 'Radius', param: 'radius', noEdges: 'Pick the edges to round.' },
  chamfer: { title: 'Chamfer', field: 'Distance', param: 'distance', noEdges: 'Pick the edges to bevel.' },
} as const

const paramOf = (f: Blend): string => (f.type === 'fillet' ? f.params.radius : f.params.distance)

function startDraft(kind: BlendKind, edges: Ref[]) {
  const doc = useProjectStore.getState().doc
  const base = { id: newId(), name: nextFeatureName(doc, kind), suppressed: false }
  const f: Blend =
    kind === 'fillet'
      ? { ...base, type: 'fillet', params: { edges, radius: '1' } }
      : { ...base, type: 'chamfer', params: { edges, distance: '1' } }
  useToolStore.getState().setDraft(f, null)
}

export interface EdgeBlendToolResult {
  card: ReactNode
  /** Edges of the open draft, to highlight in the viewport. */
  edges: Ref[]
}

export function useEdgeBlendTool(kind: BlendKind, kernel: KernelState): EdgeBlendToolResult {
  const activeTool = useProjectStore((s) => s.activeTool)
  const selection = useProjectStore((s) => s.selection)
  const features = useProjectStore((s) => s.doc.features)
  const units = useProjectStore((s) => s.doc.units)
  const draft = useToolStore((s) => s.draft)
  const draftReplaces = useToolStore((s) => s.draftReplaces)
  const blend = draft?.type === kind ? (draft as Blend) : null
  const cfg = CONFIG[kind]

  // Tool turned on with no draft: the edges already selected become the tool's edges.
  useEffect(() => {
    if (activeTool !== kind || draft) return
    startDraft(kind, refsOfKind(useProjectStore.getState().selection, 'edge'))
  }, [activeTool, kind, draft])

  // Another tool was chosen: drop the draft.
  useEffect(() => {
    if (blend && activeTool !== kind) cancelDraft()
  }, [blend, activeTool, kind])

  // While the card is open the selected edges ARE the draft's edges (clicking an edge toggles it).
  useEffect(() => {
    if (!blend || activeTool !== kind) return
    const picked = refsOfKind(selection, 'edge')
    if (sameRefSet(picked, blend.params.edges)) return
    changeDraft<Blend>(kind, { edges: picked })
  }, [selection, blend, activeTool, kind])

  // The step being edited was deleted (undo, or deleted in History).
  useEffect(() => {
    if (draftReplaces && blend && !features.some((f) => f.id === draftReplaces)) cancelDraft()
  }, [draftReplaces, blend, features])

  const change = useCallback((expr: string) => changeDraft<Blend>(kind, { [cfg.param]: expr }), [kind, cfg.param])

  const apply = useCallback(() => {
    // The preview on screen must be for what is in the card now, or Apply would write something never checked.
    if (!kernel.isDraftCurrent()) return
    const done = applyDraft(cfg.title)
    if (done) useProjectStore.getState().setSelection([])
  }, [kernel, cfg.title])

  const status = blend ? kernel.statuses[blend.id] : undefined
  const stepIndex = draftReplaces ? features.findIndex((f) => f.id === draftReplaces) + 1 : undefined

  const card = blend ? (
    <EdgeBlendCard
      key={blend.id}
      kind={kind}
      draft={blend}
      units={units}
      busy={kernel.busy}
      isCurrent={kernel.isDraftCurrent}
      failure={status && !status.ok ? (status.message ?? 'This shape could not be built.') : undefined}
      editingStep={stepIndex}
      onChange={change}
      onClearEdges={() => useProjectStore.getState().setSelection([])}
      onApply={apply}
      onCancel={() => {
        cancelDraft()
        useProjectStore.getState().setActiveTool(null)
      }}
    />
  ) : null

  return { card, edges: blend?.params.edges ?? [] }
}

interface CardProps {
  kind: BlendKind
  draft: Blend
  units: DisplayUnit
  busy: boolean
  isCurrent: () => boolean
  failure?: string
  editingStep?: number
  onChange: (expr: string) => void
  onClearEdges: () => void
  onApply: () => void
  onCancel: () => void
}

function EdgeBlendCard({ kind, draft, units, busy, isCurrent, failure, editingStep, onChange, onClearEdges, onApply, onCancel }: CardProps) {
  const cfg = CONFIG[kind]
  const length = useLengthInput(paramOf(draft), units, onChange)
  const edges = draft.params.edges
  const noEdges = edges.length === 0

  return (
    <ParameterCard
      title={cfg.title}
      icon={kind === 'fillet' ? <FilletIcon size={16} strokeWidth={1.75} /> : <ChamferIcon size={16} strokeWidth={1.75} />}
      busy={busy}
      isCurrent={isCurrent}
      editingStep={editingStep}
      failure={noEdges ? { message: cfg.noEdges } : failure ? { message: failure } : undefined}
      applyDisabled={busy || length.invalid || noEdges || !!failure}
      onApply={length.guard(onApply)}
      onCancel={onCancel}
    >
      <ParameterRow label="Edges">
        {noEdges ? (
          <p className="text-sm text-text-muted">None picked. Click edges in the view.</p>
        ) : (
          <div className="flex">
            <RemovableChip label={countLabel(edges.length, 'edge')} removeLabel="Clear edges" onRemove={onClearEdges} />
          </div>
        )}
      </ParameterRow>
      <NumericInput label={cfg.field} {...length.field} />
    </ParameterCard>
  )
}

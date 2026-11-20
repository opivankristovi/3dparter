// The Combine tool: join, cut or intersect solids. The first solid picked is the target, the others are tools.
// Same flow as the other cards: a draft feature previewed by the kernel, Apply / Cancel.
import { useCallback, useEffect } from 'react'
import type { ReactNode } from 'react'
import { newId, nextFeatureName } from '../doc/commands'
import { useProjectStore } from '../doc/store'
import type { BodyAppearance, BooleanFeature, Ref } from '../doc/types'
import type { KernelState } from '../screens/workspace/useKernel'
import { useToolStore } from '../screens/workspace/toolStore'
import { ParameterCard, ParameterRow } from '../ui/ParameterCard'
import { RemovableChip } from '../ui/RemovableChip'
import { SegmentedControl } from '../ui/SegmentedControl'
import { Switch } from '../ui/Switch'
import { CombineIcon } from '../ui/ModelIcons'
import { applyDraft, cancelDraft, changeDraft } from './draft'
import { OP_WORDS, combineParts, newCombine, refsOfKind, sameRefSet } from './logic'

export interface CombineToolResult {
  card: ReactNode
}

export function useCombineTool(kernel: KernelState): CombineToolResult {
  const activeTool = useProjectStore((s) => s.activeTool)
  const selection = useProjectStore((s) => s.selection)
  const features = useProjectStore((s) => s.doc.features)
  const bodies = useProjectStore((s) => s.doc.bodies)
  const draft = useToolStore((s) => s.draft)
  const draftReplaces = useToolStore((s) => s.draftReplaces)
  const combine = draft?.type === 'boolean' ? draft : null

  // Tool turned on with no draft: solids already selected become the target and tools.
  useEffect(() => {
    if (activeTool !== 'combine' || draft) return
    const s = useProjectStore.getState()
    const f = newCombine(newId(), nextFeatureName(s.doc, 'boolean'), refsOfKind(s.selection, 'body'))
    useToolStore.getState().setDraft(f, null)
  }, [activeTool, draft])

  useEffect(() => {
    if (combine && activeTool !== 'combine') cancelDraft()
  }, [combine, activeTool])

  // While the card is open the selected solids ARE the draft's target and tools.
  useEffect(() => {
    if (!combine || activeTool !== 'combine') return
    const { target, tools } = combineParts(selection)
    if ((target?.name ?? '') === combine.params.target.name && sameRefSet(tools, combine.params.tools)) return
    changeDraft<BooleanFeature>('boolean', { target: target ?? { kind: 'body', name: '' }, tools })
  }, [selection, combine, activeTool])

  useEffect(() => {
    if (draftReplaces && combine && !features.some((f) => f.id === draftReplaces)) cancelDraft()
  }, [draftReplaces, combine, features])

  const apply = useCallback(() => {
    if (!kernel.isDraftCurrent()) return
    const done = applyDraft('Combine')
    if (done) useProjectStore.getState().setSelection([])
  }, [kernel])

  const status = combine ? kernel.statuses[combine.id] : undefined
  const stepIndex = draftReplaces ? features.findIndex((f) => f.id === draftReplaces) + 1 : undefined

  const card = combine ? (
    <CombineCard
      key={combine.id}
      draft={combine}
      bodies={bodies}
      busy={kernel.busy}
      failure={status && !status.ok ? (status.message ?? 'These solids could not be combined.') : undefined}
      editingStep={stepIndex}
      onChange={(p) => changeDraft<BooleanFeature>('boolean', p)}
      onRemove={(r) => useProjectStore.getState().setSelection(selection.filter((x) => !(x.kind === r.kind && x.name === r.name)))}
      onApply={apply}
      onCancel={() => {
        cancelDraft()
        useProjectStore.getState().setActiveTool(null)
      }}
    />
  ) : null

  return { card }
}

interface CardProps {
  draft: BooleanFeature
  bodies: Record<string, BodyAppearance>
  busy: boolean
  failure?: string
  editingStep?: number
  onChange: (partial: Partial<BooleanFeature['params']>) => void
  onRemove: (r: Ref) => void
  onApply: () => void
  onCancel: () => void
}

function CombineCard({ draft, bodies, busy, failure, editingStep, onChange, onRemove, onApply, onCancel }: CardProps) {
  const p = draft.params
  const nameOf = (r: Ref) => bodies[r.name]?.name ?? r.name
  const noTarget = p.target.name === ''
  const noTools = p.tools.length === 0
  const missing = noTarget ? 'Pick the solid to keep as the target.' : noTools ? 'Pick at least one more solid to combine with it.' : undefined

  return (
    <ParameterCard
      title="Combine"
      icon={<CombineIcon size={16} strokeWidth={1.75} />}
      busy={busy}
      editingStep={editingStep}
      failure={missing ? { message: missing } : failure ? { message: failure } : undefined}
      applyDisabled={busy || !!missing || !!failure}
      onApply={onApply}
      onCancel={onCancel}
    >
      <ParameterRow label="Operation">
        <SegmentedControl
          label="Operation"
          value={p.op}
          onValueChange={(v) => onChange({ op: v as BooleanFeature['params']['op'] })}
          options={(Object.keys(OP_WORDS) as (keyof typeof OP_WORDS)[]).map((k) => ({ value: k, label: OP_WORDS[k] }))}
        />
      </ParameterRow>
      <ParameterRow label="Target">
        {noTarget ? (
          <p className="text-sm text-text-muted">Click a solid in the view or in Items.</p>
        ) : (
          <div className="flex">
            <RemovableChip label={nameOf(p.target)} removeLabel={`Remove ${nameOf(p.target)} as target`} onRemove={() => onRemove(p.target)} />
          </div>
        )}
      </ParameterRow>
      <ParameterRow label="Tools">
        {noTools ? (
          <p className="text-sm text-text-muted">Click more solids to add them.</p>
        ) : (
          <div className="flex flex-wrap gap-1">
            {p.tools.map((t) => (
              <RemovableChip key={t.name} label={nameOf(t)} removeLabel={`Remove ${nameOf(t)}`} onRemove={() => onRemove(t)} />
            ))}
          </div>
        )}
      </ParameterRow>
      <Switch label="Keep tool solids" checked={p.keepTools} onCheckedChange={(keepTools) => onChange({ keepTools })} />
    </ParameterCard>
  )
}

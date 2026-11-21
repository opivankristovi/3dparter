// The Scale tool: resizes solids uniformly, about the origin or about each solid's own centre.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Scaling } from 'lucide-react'
import { newId, nextFeatureName } from '../doc/commands'
import { evalExpr, isNumberLiteral } from '../doc/expr'
import { useProjectStore } from '../doc/store'
import type { BodyAppearance, Ref, ScaleFeature } from '../doc/types'
import { useVariableSuggestions } from '../doc/useVariableSuggestions'
import { scopeOf } from '../doc/variables'
import { useToolStore } from '../screens/workspace/toolStore'
import type { KernelState } from '../screens/workspace/useKernel'
import { NumericInput } from '../ui/NumericInput'
import type { FieldFeedback } from '../ui/NumericInput'
import { ParameterCard, ParameterRow } from '../ui/ParameterCard'
import { RemovableChip } from '../ui/RemovableChip'
import { SegmentedControl } from '../ui/SegmentedControl'
import { applyDraft, cancelDraft, changeDraft } from './draft'
import { bodyOfFace, countLabel, refsOfKind, sameRefSet } from './logic'

/** A number followed by a unit ("2in", "3 mm"): a factor is unitless, so this is refused. */
const UNIT_SUFFIX = /[\d.]\s*(mm|cm|m|in|ft|deg)(?![a-z0-9_])/i

const FACTOR_MESSAGE = 'Enter a scale factor above zero, such as 2 for double size.'

/** A unitless factor field: a number or an expression that comes out above zero. */
function useFactorInput(expr: string, onChange: (expr: string) => void) {
  const [typed, setTypedState] = useState<string | null>(null)
  const typedNow = useRef<string | null>(null)
  const suggestions = useVariableSuggestions('mm')
  const setTyped = (t: string | null) => {
    typedNow.current = t
    setTypedState(t)
  }
  const parse = (text: string): { ok: true; expr: string; isExpr: boolean; value: number } | { ok: false; message: string } => {
    const trimmed = text.trim()
    if (!trimmed) return { ok: false, message: FACTOR_MESSAGE }
    if (UNIT_SUFFIX.test(trimmed)) return { ok: false, message: 'A scale factor has no unit. Type a plain number, such as 2.' }
    const r = evalExpr(trimmed, scopeOf(useProjectStore.getState().doc))
    if (!r.ok) return { ok: false, message: r.message }
    if (!Number.isFinite(r.value) || r.value <= 0) return { ok: false, message: FACTOR_MESSAGE }
    return { ok: true, expr: trimmed, isExpr: !isNumberLiteral(trimmed), value: r.value }
  }
  const check = (text: string): FieldFeedback => {
    const r = parse(text)
    if (!r.ok) return { error: r.message }
    return r.isExpr ? { preview: String(Number(r.value.toFixed(6))) } : {}
  }
  return {
    field: {
      value: typed ?? expr,
      error: typed !== null ? check(typed).error : undefined,
      check,
      suggestions,
      step: 0.1,
      onValueChange: (text: string) => {
        const r = parse(text)
        if (!r.ok) {
          setTyped(text)
          return
        }
        setTyped(null)
        onChange(r.expr)
      },
    },
    invalid: typed !== null,
    guard: (apply: () => void) => () => {
      if (typedNow.current !== null) return
      apply()
    },
  }
}

export interface ScaleToolResult {
  card: ReactNode
}

export function useScaleTool(kernel: KernelState): ScaleToolResult {
  const activeTool = useProjectStore((s) => s.activeTool)
  const selection = useProjectStore((s) => s.selection)
  const features = useProjectStore((s) => s.doc.features)
  const bodies = useProjectStore((s) => s.doc.bodies)
  const draft = useToolStore((s) => s.draft)
  const draftReplaces = useToolStore((s) => s.draftReplaces)
  const liveBodies = useToolStore((s) => s.liveBodies)
  const scale = draft?.type === 'scale' ? draft : null

  useEffect(() => {
    if (activeTool !== 'scale' || draft) return
    const s = useProjectStore.getState()
    let picked = refsOfKind(s.selection, 'body')
    if (picked.length === 0) {
      const seen = new Set<string>()
      for (const face of refsOfKind(s.selection, 'face')) {
        const id = bodyOfFace(face.name, kernel.meshes)
        if (id && !seen.has(id)) {
          seen.add(id)
          picked.push({ kind: 'body', name: id })
        }
      }
      if (picked.length > 0) s.setSelection(picked)
    }
    if (picked.length === 0) {
      const visible = (liveBodies ?? []).filter((id) => s.doc.bodies[id]?.visible !== false)
      if (visible.length === 1) {
        picked = [{ kind: 'body', name: visible[0] }]
        s.setSelection(picked)
      }
    }
    const f: ScaleFeature = {
      id: newId(),
      type: 'scale',
      name: nextFeatureName(s.doc, 'scale'),
      suppressed: false,
      params: { bodies: picked, factor: '1', center: 'origin' },
    }
    useToolStore.getState().setDraft(f, null)
  }, [activeTool, draft, kernel.meshes, liveBodies])

  useEffect(() => {
    if (scale && activeTool !== 'scale') cancelDraft()
  }, [scale, activeTool])

  useEffect(() => {
    if (!scale || activeTool !== 'scale') return
    const picked = refsOfKind(selection, 'body')
    if (sameRefSet(picked, scale.params.bodies)) return
    changeDraft<ScaleFeature>('scale', { bodies: picked })
  }, [selection, scale, activeTool])

  useEffect(() => {
    if (draftReplaces && scale && !features.some((f) => f.id === draftReplaces)) cancelDraft()
  }, [draftReplaces, scale, features])

  const change = useCallback((partial: Partial<ScaleFeature['params']>) => changeDraft<ScaleFeature>('scale', partial), [])

  const apply = useCallback(() => {
    const done = applyDraft('Scale')
    if (done) useProjectStore.getState().setSelection([])
  }, [])

  const status = scale ? kernel.statuses[scale.id] : undefined
  const stepIndex = draftReplaces ? features.findIndex((f) => f.id === draftReplaces) + 1 : undefined

  const card = scale ? (
    <ScaleCard
      key={scale.id}
      draft={scale}
      bodies={bodies}
      busy={kernel.busy}
      isCurrent={kernel.isDraftCurrent}
      failure={status && !status.ok ? (status.message ?? 'These solids could not be scaled.') : undefined}
      editingStep={stepIndex}
      onChange={change}
      onRemove={(r) =>
        useProjectStore.getState().setSelection(selection.filter((x) => !(x.kind === r.kind && x.name === r.name)))
      }
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
  draft: ScaleFeature
  bodies: Record<string, BodyAppearance>
  busy: boolean
  isCurrent: () => boolean
  failure?: string
  editingStep?: number
  onChange: (partial: Partial<ScaleFeature['params']>) => void
  onRemove: (r: Ref) => void
  onApply: () => void
  onCancel: () => void
}

function ScaleCard({ draft, bodies, busy, isCurrent, failure, editingStep, onChange, onRemove, onApply, onCancel }: CardProps) {
  const p = draft.params
  const factor = useFactorInput(p.factor, (f) => onChange({ factor: f }))
  const noBodies = p.bodies.length === 0
  return (
    <ParameterCard
      title="Scale"
      icon={<Scaling size={16} strokeWidth={1.75} />}
      busy={busy}
      isCurrent={isCurrent}
      editingStep={editingStep}
      failure={noBodies ? { message: 'Pick at least one solid to scale.' } : failure ? { message: failure } : undefined}
      applyDisabled={busy || factor.invalid || noBodies || !!failure}
      onApply={factor.guard(onApply)}
      onCancel={onCancel}
    >
      <ParameterRow label={`Solids (${countLabel(p.bodies.length, 'solid')})`}>
        {noBodies ? (
          <p className="text-sm text-text-muted">Click solids in the view or in Items.</p>
        ) : (
          <div className="flex flex-wrap gap-1">
            {p.bodies.map((b) => {
              const nm = bodies[b.name]?.name ?? b.name
              return <RemovableChip key={b.name} label={nm} removeLabel={`Remove ${nm}`} onRemove={() => onRemove(b)} />
            })}
          </div>
        )}
      </ParameterRow>
      <NumericInput label="Factor" {...factor.field} />
      <ParameterRow label="Center">
        <SegmentedControl
          label="Scale center"
          value={p.center}
          onValueChange={(v) => onChange({ center: v as ScaleFeature['params']['center'] })}
          options={[
            { value: 'origin', label: 'Origin' },
            { value: 'bodyCenter', label: 'Body center' },
          ]}
        />
      </ParameterRow>
    </ParameterCard>
  )
}

// The Revolve tool: sweeps sketch profiles around a line or origin axis, with New / Join / Cut / Intersect.
import { useCallback, useEffect, useMemo } from 'react'
import type { ReactNode } from 'react'
import { newId, nextFeatureName } from '../doc/commands'
import { useProjectStore } from '../doc/store'
import type { BodyAppearance, BooleanMode, Feature, LineEntity, Ref, RevolveFeature } from '../doc/types'
import { applyDraft, cancelDraft, changeDraft, useAngleInput } from './draft'
import { MODE_WORDS, sameRef, sameSketchRegions, sketchOfRegion } from './logic'
import { extrudeTargetPool } from './picking'
import { useToolStore } from '../screens/workspace/toolStore'
import type { KernelState } from '../screens/workspace/useKernel'
import { Button } from '../ui/Button'
import { RevolveIcon } from '../ui/ModelIcons'
import { NumericInput } from '../ui/NumericInput'
import { wholeTextName } from '../sketch/text/regionRef'
import { ParameterCard, ParameterRow } from '../ui/ParameterCard'
import { RemovableChip } from '../ui/RemovableChip'
import { SegmentedControl } from '../ui/SegmentedControl'

const ORIGIN_AXES: { ref: Ref; label: string }[] = [
  { ref: { kind: 'originAxis', name: 'X' }, label: 'X axis' },
  { ref: { kind: 'originAxis', name: 'Y' }, label: 'Y axis' },
  { ref: { kind: 'originAxis', name: 'Z' }, label: 'Z axis' },
]

interface AxisChoice {
  ref: Ref
  label: string
}

function sketchAxisChoices(sketchId: string, features: Feature[]): AxisChoice[] {
  const sk = features.find((f) => f.id === sketchId)
  if (sk?.type !== 'sketch') return []
  const lines = sk.sketch.entities.filter((e): e is LineEntity => e.type === 'line')
  const cons = lines.filter((e) => e.construction)
  const regular = lines.filter((e) => !e.construction)
  const out: AxisChoice[] = []
  cons.forEach((e, idx) => {
    out.push({
      ref: { kind: 'sketchEdge', name: `${sketchId}/${e.id}` },
      label: cons.length === 1 ? 'Construction line' : `Construction ${idx + 1}`,
    })
  })
  regular.forEach((e, idx) => {
    out.push({
      ref: { kind: 'sketchEdge', name: `${sketchId}/${e.id}` },
      label: `Line ${idx + 1}`,
    })
  })
  return out
}

function defaultAxis(profiles: Ref[], features: Feature[]): Ref {
  if (profiles.length === 0) return { kind: 'originAxis', name: '' }
  const choices = sketchAxisChoices(sketchOfRegion(profiles[0]), features)
  return choices[0]?.ref ?? { kind: 'originAxis', name: '' }
}

const sameNames = (a: Ref[], b: Ref[]) => a.length === b.length && a.every((r) => b.some((x) => x.name === r.name))

export interface RevolveToolResult {
  card: ReactNode
  picking: boolean
  profiles: Ref[]
}

export function useRevolveTool(kernel: KernelState): RevolveToolResult {
  const activeTool = useProjectStore((s) => s.activeTool)
  const selection = useProjectStore((s) => s.selection)
  const features = useProjectStore((s) => s.doc.features)
  const bodies = useProjectStore((s) => s.doc.bodies)
  const draft = useToolStore((s) => s.draft)
  const draftReplaces = useToolStore((s) => s.draftReplaces)
  const revolve = draft?.type === 'revolve' ? draft : null

  // Tool turned on with no draft: pick the selected region(s) or the last sketch's single region.
  useEffect(() => {
    if (activeTool !== 'revolve' || draft) return
    const doc = useProjectStore.getState().doc
    const picked = sameSketchRegions(selection.filter((r) => r.kind === 'sketchRegion'))
    let profiles = picked
    if (profiles.length === 0) {
      const last = [...features].reverse().find((f) => f.type === 'sketch' && !f.suppressed)
      const regs = last ? kernel.regions[last.id] : undefined
      if (regs && regs.length === 1) {
        const ref: Ref = { kind: 'sketchRegion', name: wholeTextName(regs[0].name) ?? regs[0].name }
        useProjectStore.getState().setSelection([ref])
        profiles = [ref]
      }
    }
    if (profiles.length === 0) return
    const f: RevolveFeature = {
      id: newId(),
      type: 'revolve',
      name: nextFeatureName(doc, 'revolve'),
      suppressed: false,
      params: {
        profiles,
        axis: defaultAxis(profiles, features),
        angle: '360',
        mode: 'new',
        targets: [],
      },
    }
    useToolStore.getState().setDraft(f, null)
  }, [activeTool, draft, selection, features, kernel.regions])

  useEffect(() => {
    if (revolve && activeTool !== 'revolve') cancelDraft()
  }, [revolve, activeTool])

  // Picking profiles while the card is open updates the draft.
  useEffect(() => {
    if (!revolve) return
    const picked = sameSketchRegions(selection.filter((r) => r.kind === 'sketchRegion'))
    if (picked.length === 0 || sameNames(picked, revolve.params.profiles)) return
    const nextSk = sketchOfRegion(picked[0])
    const curSk = revolve.params.profiles[0] ? sketchOfRegion(revolve.params.profiles[0]) : ''
    const axis =
      nextSk !== curSk && revolve.params.axis.kind === 'sketchEdge'
        ? defaultAxis(picked, features)
        : revolve.params.axis
    changeDraft<RevolveFeature>('revolve', { profiles: picked, axis })
  }, [selection, revolve, features])

  useEffect(() => {
    if (draftReplaces && revolve && !features.some((f) => f.id === draftReplaces)) cancelDraft()
  }, [draftReplaces, revolve, features])

  const change = useCallback((partial: Partial<RevolveFeature['params']>) => changeDraft<RevolveFeature>('revolve', partial), [])

  const apply = useCallback(() => {
    if (!kernel.isDraftCurrent()) return
    const done = applyDraft('Revolve')
    if (done?.type === 'revolve') {
      useProjectStore.getState().setSelection(done.params.mode === 'new' ? [{ kind: 'body', name: done.id }] : [])
    }
  }, [kernel])

  const sketchId = revolve?.params.profiles[0] ? sketchOfRegion(revolve.params.profiles[0]) : ''
  const lineChoices = useMemo(() => (sketchId ? sketchAxisChoices(sketchId, features) : []), [sketchId, features])

  const status = revolve ? kernel.statuses[revolve.id] : undefined
  const stepIndex = draftReplaces ? features.findIndex((f) => f.id === draftReplaces) + 1 : undefined

  const card = revolve ? (
    <RevolveCard
      key={revolve.id}
      draft={revolve}
      bodies={bodies}
      lineChoices={lineChoices}
      busy={kernel.busy}
      isCurrent={kernel.isDraftCurrent}
      failure={status && !status.ok ? (status.message ?? 'This shape could not be built.') : undefined}
      editingStep={stepIndex}
      onChange={change}
      onApply={apply}
      onCancel={() => {
        cancelDraft()
        useProjectStore.getState().setActiveTool(null)
      }}
    />
  ) : null

  return { card, picking: activeTool === 'revolve' && !revolve, profiles: revolve?.params.profiles ?? [] }
}

interface CardProps {
  draft: RevolveFeature
  bodies: Record<string, BodyAppearance>
  lineChoices: AxisChoice[]
  busy: boolean
  isCurrent: () => boolean
  failure?: string
  editingStep?: number
  onChange: (partial: Partial<RevolveFeature['params']>) => void
  onApply: () => void
  onCancel: () => void
}

function RevolveCard({ draft, bodies, lineChoices, busy, isCurrent, failure, editingStep, onChange, onApply, onCancel }: CardProps) {
  const p = draft.params
  const angle = useAngleInput(p.angle, (a) => onChange({ angle: a }), { positiveMax360: true })
  const noProfile = p.profiles.length === 0
  const noAxis = p.axis.name === ''
  const noTargets = p.mode !== 'new' && p.targets.length === 0
  const missing = noProfile
    ? 'Pick a shape to revolve.'
    : noAxis
      ? 'Pick an axis line or origin axis.'
      : noTargets
        ? 'Pick at least one solid to work on.'
        : undefined

  const choices: AxisChoice[] = [...lineChoices, ...ORIGIN_AXES]

  return (
    <ParameterCard
      title="Revolve"
      icon={<RevolveIcon size={16} strokeWidth={1.75} />}
      busy={busy}
      isCurrent={isCurrent}
      editingStep={editingStep}
      failure={missing ? { message: missing } : failure ? { message: failure } : undefined}
      applyDisabled={busy || angle.invalid || noProfile || noAxis || noTargets || !!failure}
      onApply={angle.guard(onApply)}
      onCancel={onCancel}
    >
      <ParameterRow label="Axis">
        <div className="flex flex-wrap gap-1" role="group" aria-label="Axis">
          {choices.map((c) => {
            const selected = sameRef(p.axis, c.ref)
            return (
              <Button
                key={`${c.ref.kind}:${c.ref.name}`}
                size="sm"
                variant={selected ? 'primary' : 'secondary'}
                aria-pressed={selected}
                onClick={() => onChange({ axis: c.ref })}
              >
                {c.label}
              </Button>
            )
          })}
        </div>
      </ParameterRow>
      <NumericInput label="Angle" {...angle.field} />
      <ParameterRow label="Operation">
        <SegmentedControl
          label="Operation"
          value={p.mode}
          onValueChange={(v) => {
            const mode = v as BooleanMode
            const targets = mode === 'new' ? [] : p.targets.length > 0 ? p.targets : extrudeTargetPool(draft.id)
            onChange({ mode, targets })
          }}
          options={(Object.keys(MODE_WORDS) as BooleanMode[]).map((k) => ({ value: k, label: MODE_WORDS[k] }))}
        />
      </ParameterRow>
      {p.mode !== 'new' ? (
        <ParameterRow label="Targets">
          {p.targets.length === 0 ? (
            <p className="text-sm text-text-muted">Click solids in the view or in Items.</p>
          ) : (
            <div className="flex flex-wrap gap-1">
              {p.targets.map((t) => {
                const nm = bodies[t.name]?.name ?? t.name
                return (
                  <RemovableChip
                    key={t.name}
                    label={nm}
                    removeLabel={`Remove ${nm}`}
                    onRemove={() => onChange({ targets: p.targets.filter((x) => x.name !== t.name) })}
                  />
                )
              })}
            </div>
          )}
        </ParameterRow>
      ) : null}
    </ParameterCard>
  )
}

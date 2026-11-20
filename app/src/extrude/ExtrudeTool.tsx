// The Extrude tool: picks a profile, previews the solid through a draft feature, and applies it as one undo step.
import { useCallback, useEffect, useMemo } from 'react'
import type { ReactNode } from 'react'
import { ArrowUpFromLine } from 'lucide-react'
import { newId, nextFeatureName } from '../doc/commands'
import { useProjectStore } from '../doc/store'
import { ORIGIN_PLANES } from '../doc/types'
import type { BodyAppearance, BooleanMode, DisplayUnit, ExtrudeFeature, OriginPlaneName, Ref, Vec3 } from '../doc/types'
import { toExpr } from '../doc/units'
import type { SketchRegionData } from '../kernel/api'
import { applyDraft, cancelDraft, changeDraft, useLengthInput } from '../modeling/draft'
import { MODE_WORDS, sameSketchRegions, sketchOfRegion } from '../modeling/logic'
import { AxisDragHandle } from '../modeling/ModelHandles'
import { extrudeTargetPool } from '../modeling/picking'
import { useToolStore } from '../screens/workspace/toolStore'
import type { KernelState } from '../screens/workspace/useKernel'
import { NumericInput } from '../ui/NumericInput'
import { ParameterCard, ParameterRow } from '../ui/ParameterCard'
import { RemovableChip } from '../ui/RemovableChip'
import { SegmentedControl } from '../ui/SegmentedControl'
import type { ViewportEngine } from '../viewport/engine'

const sameNames = (a: Ref[], b: Ref[]) => a.length === b.length && a.every((r) => b.some((x) => x.name === r.name))

export function cancelExtrude() {
  cancelDraft()
}

function applyExtrude() {
  const done = applyDraft('Extrude')
  if (done?.type === 'extrude') {
    useProjectStore.getState().setSelection(done.params.mode === 'new' ? [{ kind: 'body', name: done.id }] : [])
  }
}

function startDraft(profiles: Ref[]) {
  const doc = useProjectStore.getState().doc
  const f: ExtrudeFeature = {
    id: newId(),
    type: 'extrude',
    name: nextFeatureName(doc, 'extrude'),
    suppressed: false,
    params: { profiles, distance: '10', direction: 1, mode: 'new', targets: [] },
  }
  useToolStore.getState().setDraft(f, null)
}

function regionCenter(region: SketchRegionData): Vec3 {
  const p = region.fill.positions
  if (p.length < 3) return [0, 0, 0]
  let sx = 0
  let sy = 0
  let sz = 0
  const n = Math.floor(p.length / 3)
  for (let i = 0; i < n; i++) {
    sx += p[i * 3]
    sy += p[i * 3 + 1]
    sz += p[i * 3 + 2]
  }
  return [sx / n, sy / n, sz / n]
}

export interface ExtrudeToolResult {
  /** The parameter card, or null when no extrusion is open. */
  card: ReactNode
  /** On-model distance drag handle rendered over the viewport. */
  handle: ReactNode
  /** The extrude tool is on but no shape is chosen yet. */
  picking: boolean
  /** Profiles of the open draft, to highlight in the viewport. */
  profiles: Ref[]
}

export function useExtrudeTool(kernel: KernelState, engine: ViewportEngine | null): ExtrudeToolResult {
  const activeTool = useProjectStore((s) => s.activeTool)
  const selection = useProjectStore((s) => s.selection)
  const features = useProjectStore((s) => s.doc.features)
  const bodies = useProjectStore((s) => s.doc.bodies)
  const units = useProjectStore((s) => s.doc.units)
  const draft = useToolStore((s) => s.draft)
  const draftReplaces = useToolStore((s) => s.draftReplaces)
  const sketchFrames = useToolStore((s) => s.sketchFrames)
  const extrude = draft?.type === 'extrude' ? draft : null

  // Tool turned on with no draft: use the selected region(s), or the last sketch if it has exactly one.
  useEffect(() => {
    if (activeTool !== 'extrude' || draft) return
    const picked = sameSketchRegions(selection.filter((r) => r.kind === 'sketchRegion'))
    if (picked.length > 0) {
      startDraft(picked)
      return
    }
    const last = [...features].reverse().find((f) => f.type === 'sketch' && !f.suppressed)
    const regs = last ? kernel.regions[last.id] : undefined
    if (regs && regs.length === 1) {
      const ref: Ref = { kind: 'sketchRegion', name: regs[0].name }
      useProjectStore.getState().setSelection([ref])
      startDraft([ref])
    }
  }, [activeTool, draft, selection, features, kernel.regions])

  // Another tool was chosen: drop the draft.
  useEffect(() => {
    if (extrude && activeTool !== 'extrude') cancelExtrude()
  }, [extrude, activeTool])

  // Picking more shapes while the card is open changes the profiles.
  useEffect(() => {
    if (!extrude) return
    const picked = sameSketchRegions(selection.filter((r) => r.kind === 'sketchRegion'))
    if (picked.length === 0 || sameNames(picked, extrude.params.profiles)) return
    changeDraft<ExtrudeFeature>('extrude', { profiles: picked })
  }, [selection, extrude])

  // The step being edited was deleted (undo, or deleted in History).
  useEffect(() => {
    if (draftReplaces && extrude && !features.some((f) => f.id === draftReplaces)) cancelExtrude()
  }, [draftReplaces, extrude, features])

  const change = useCallback((partial: Partial<ExtrudeFeature['params']>) => changeDraft<ExtrudeFeature>('extrude', partial), [])

  const status = extrude ? kernel.statuses[extrude.id] : undefined
  const stepIndex = draftReplaces ? features.findIndex((f) => f.id === draftReplaces) + 1 : undefined

  const handleInfo = useMemo(() => {
    if (!extrude || extrude.params.profiles.length === 0) return null
    const first = extrude.params.profiles[0]
    const skId = sketchOfRegion(first)
    const sk = features.find((f) => f.id === skId)
    if (sk?.type !== 'sketch') return null
    const frame =
      sk.params.on.kind === 'originPlane'
        ? ORIGIN_PLANES[sk.params.on.name as OriginPlaneName]
        : sketchFrames[skId]
    if (!frame) return null
    const reg = (kernel.regions[skId] ?? []).find((r) => r.name === first.name)
    if (!reg) return null
    const n = frame.normal
    const dir: Vec3 = extrude.params.direction === -1 ? [-n[0], -n[1], -n[2]] : n
    const dist = Number(extrude.params.distance)
    return {
      origin: regionCenter(reg),
      dir,
      distance: Number.isFinite(dist) && dist > 0 ? dist : 10,
      scale: extrude.params.direction === 0 ? 0.5 : 1,
    }
  }, [extrude, features, sketchFrames, kernel.regions])

  const handle =
    extrude && handleInfo ? (
      <AxisDragHandle
        engine={engine}
        origin={handleInfo.origin}
        dir={handleInfo.dir}
        value={handleInfo.distance}
        scale={handleInfo.scale}
        units={units}
        label="Extrude distance handle"
        min={0.5}
        onChange={(nextMm) => change({ distance: toExpr(nextMm) })}
      />
    ) : null

  const card = extrude ? (
    <ExtrudeCard
      key={extrude.id}
      draft={extrude}
      bodies={bodies}
      units={units}
      busy={kernel.busy}
      failure={status && !status.ok ? (status.message ?? 'This shape could not be built.') : undefined}
      editingStep={stepIndex}
      onChange={change}
      onApply={applyExtrude}
      onCancel={() => {
        cancelExtrude()
        useProjectStore.getState().setActiveTool(null)
      }}
    />
  ) : null

  return { card, handle, picking: activeTool === 'extrude' && !extrude, profiles: extrude?.params.profiles ?? [] }
}

interface CardProps {
  draft: ExtrudeFeature
  bodies: Record<string, BodyAppearance>
  units: DisplayUnit
  busy: boolean
  failure?: string
  editingStep?: number
  onChange: (partial: Partial<ExtrudeFeature['params']>) => void
  onApply: () => void
  onCancel: () => void
}

function ExtrudeCard({ draft, bodies, units, busy, failure, editingStep, onChange, onApply, onCancel }: CardProps) {
  const p = draft.params
  const length = useLengthInput(p.distance, units, (distance) => onChange({ distance }))
  const noProfile = p.profiles.length === 0
  const noTargets = p.mode !== 'new' && p.targets.length === 0
  const missing = noProfile
    ? 'Pick a shape to extrude.'
    : noTargets
      ? 'Pick at least one solid to work on.'
      : undefined

  return (
    <ParameterCard
      title="Extrude"
      icon={<ArrowUpFromLine size={16} strokeWidth={1.75} />}
      busy={busy}
      editingStep={editingStep}
      failure={missing ? { message: missing } : failure ? { message: failure } : undefined}
      applyDisabled={busy || length.invalid || noProfile || noTargets || !!failure}
      onApply={length.guard(onApply)}
      onCancel={onCancel}
    >
      <NumericInput label="Distance" {...length.field} />
      <ParameterRow label="Direction">
        <SegmentedControl
          label="Direction"
          value={String(p.direction)}
          onValueChange={(v) => onChange({ direction: Number(v) as 1 | -1 | 0 })}
          options={[
            { value: '1', label: 'One side' },
            { value: '0', label: 'Both sides' },
            { value: '-1', label: 'Flip' },
          ]}
        />
      </ParameterRow>
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

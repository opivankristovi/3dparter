// The Extrude tool: picks a profile, previews the solid through a draft feature, and applies it as one undo step.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ArrowUpFromLine } from 'lucide-react'
import { newId, nextFeatureName } from '../doc/commands'
import { evalStored } from '../doc/fieldInput'
import { useProjectStore } from '../doc/store'
import { ORIGIN_PLANES } from '../doc/types'
import type { BodyAppearance, BooleanMode, DisplayUnit, ExtrudeFeature, OriginPlaneName, Ref, Vec3 } from '../doc/types'
import { toExpr } from '../doc/units'
import { getKernel } from '../kernel/client'
import type { MeshData, SketchRegionData } from '../kernel/api'
import { applyDraft, cancelDraft, changeDraft, useLengthInput, useSignedLengthInput } from '../modeling/draft'
import { MODE_WORDS, cutDirection, meshVolume, sameSketchRegions, sameVolume, sketchOfRegion } from '../modeling/logic'
import { AxisDragHandle } from '../modeling/ModelHandles'
import { extrudeTargetPool } from '../modeling/picking'
import { textLabelOfRef } from '../modeling/profileLabel'
import { coveredRegions, wholeTextName } from '../sketch/text/regionRef'
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

/**
 * For a profile sketched on a face: which way a Cut or Intersect has to go to enter the solid (see cutDirection).
 * null when the profile is not on a face or the kernel cannot tell.
 */
async function directionIntoSolid(profile: Ref | undefined): Promise<1 | -1 | null> {
  if (!profile) return null
  const sk = useProjectStore.getState().doc.features.find((f) => f.id === sketchOfRegion(profile))
  if (sk?.type !== 'sketch' || sk.params.on.kind !== 'face') return null
  try {
    const kernel = getKernel()
    const [sketchFrame, faceFrame] = await Promise.all([kernel.sketchFrame(sk.id), kernel.planeFrame(sk.params.on)])
    return sketchFrame && faceFrame ? cutDirection(sketchFrame.normal, faceFrame.normal) : null
  } catch {
    return null
  }
}

/** True when a Cut or Intersect preview left every target solid exactly as it was. */
function leavesTargetsUnchanged(targets: Ref[], before: Map<string, MeshData>, after: Map<string, MeshData>): boolean {
  return (
    targets.length > 0 &&
    targets.every((t) => {
      const a = before.get(t.name)
      const b = after.get(t.name)
      if (!a || !b) return false
      return a === b || sameVolume(meshVolume(a.positions, a.indices), meshVolume(b.positions, b.indices))
    })
  )
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
      const ref: Ref = { kind: 'sketchRegion', name: wholeTextName(regs[0].name) ?? regs[0].name }
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

  // The solids as they were before the open draft touched them: what a Cut or Intersect preview is compared with.
  // While editing an existing step the committed meshes already include its effect, so there is no baseline until
  // the draft has been seen in the New mode.
  const baseline = useRef<{ meshes: Map<string, MeshData>; draftId: string | null }>({ meshes: new Map(), draftId: null })
  if (!extrude) baseline.current = { meshes: kernel.meshes, draftId: null }
  else if (extrude.params.mode === 'new') baseline.current = { meshes: kernel.meshes, draftId: extrude.id }
  const baselineKnown = !!extrude && (!draftReplaces || baseline.current.draftId === extrude.id)

  const status = extrude ? kernel.statuses[extrude.id] : undefined
  const noEffect =
    !!extrude &&
    (extrude.params.mode === 'subtract' || extrude.params.mode === 'intersect') &&
    baselineKnown &&
    !kernel.busy &&
    status?.ok === true &&
    kernel.isDraftCurrent() &&
    leavesTargetsUnchanged(extrude.params.targets, baseline.current.meshes, kernel.meshes)
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
    const covered = coveredRegions(kernel.regions[skId] ?? [], first.name)
    if (covered.length === 0) return null
    const n = frame.normal
    const dir: Vec3 = extrude.params.direction === -1 ? [-n[0], -n[1], -n[2]] : n
    const dist = evalStored(extrude.params.distance) ?? NaN
    const startMm = evalStored(extrude.params.startOffset ?? '0') ?? 0
    const centres = covered.map(regionCenter)
    const base: Vec3 = [
      centres.reduce((s, c) => s + c[0], 0) / centres.length,
      centres.reduce((s, c) => s + c[1], 0) / centres.length,
      centres.reduce((s, c) => s + c[2], 0) / centres.length,
    ]
    const origin: Vec3 =
      Number.isFinite(startMm) && startMm !== 0
        ? [base[0] + n[0] * startMm, base[1] + n[1] * startMm, base[2] + n[2] * startMm]
        : base
    return {
      origin,
      dir,
      distance: Number.isFinite(dist) && dist > 0 ? dist : 10,
      scale: extrude.params.direction === 0 ? 0.5 : 1,
    }
  }, [extrude, features, sketchFrames, kernel.regions])

  const handle =
    extrude && handleInfo && (extrude.params.extent ?? 'distance') !== 'throughAll' ? (
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
      isCurrent={kernel.isDraftCurrent}
      shapes={extrude.params.profiles.map((p) => textLabelOfRef(p, features, kernel.regions)).filter((l): l is string => l !== null)}
      failure={status && !status.ok ? (status.message ?? 'This shape could not be built.') : undefined}
      noEffect={noEffect}
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
  isCurrent: () => boolean
  /** Names of the picked profiles that are sketch text, shown in the card ('Text “HELLO”'). */
  shapes?: string[]
  failure?: string
  /** A Cut or Intersect that leaves the solid unchanged. */
  noEffect: boolean
  editingStep?: number
  onChange: (partial: Partial<ExtrudeFeature['params']>) => void
  onApply: () => void
  onCancel: () => void
}

function ExtrudeCard({ draft, bodies, units, busy, isCurrent, shapes, failure, noEffect, editingStep, onChange, onApply, onCancel }: CardProps) {
  const p = draft.params
  const extent = p.extent ?? 'distance'
  const length = useLengthInput(p.distance, units, (distance) => onChange({ distance }))
  const offset = useSignedLengthInput(p.startOffset ?? '0', units, (startOffset) => onChange({ startOffset }))
  const [hasOffset, setHasOffset] = useState(() => !!(p.startOffset && p.startOffset !== '0'))
  const lastDraftId = useRef(draft.id)
  useEffect(() => {
    if (lastDraftId.current !== draft.id) {
      lastDraftId.current = draft.id
      setHasOffset(!!(p.startOffset && p.startOffset !== '0'))
    }
  }, [draft.id, p.startOffset])
  const noProfile = p.profiles.length === 0
  /** The direction was flipped by the card (not by the user) when the operation became Cut or Intersect. */
  const autoFlipped = useRef(false)
  const noTargets = p.mode !== 'new' && p.targets.length === 0
  const missing = noProfile
    ? 'Pick a shape to extrude.'
    : noTargets
      ? 'Pick at least one solid to work on.'
      : undefined
  const note = noEffect
    ? p.mode === 'subtract'
      ? 'This cut does not reach the solid. Try Flip.'
      : 'The result is the same solid. Try Flip or another distance.'
    : undefined
  const applyAction = extent === 'throughAll' ? onApply : length.guard(onApply)

  return (
    <ParameterCard
      title="Extrude"
      icon={<ArrowUpFromLine size={16} strokeWidth={1.75} />}
      busy={busy}
      isCurrent={isCurrent}
      editingStep={editingStep}
      failure={missing ? { message: missing } : failure ? { message: failure } : note ? { message: note } : undefined}
      applyDisabled={
        busy || (extent === 'distance' && length.invalid) || (hasOffset && offset.invalid) || noProfile || noTargets || !!failure || noEffect
      }
      onApply={hasOffset ? offset.guard(applyAction) : applyAction}
      onCancel={onCancel}
    >
      {shapes && shapes.length > 0 ? (
        <ParameterRow label="Shape">
          <p className="text-sm">{shapes.join(', ')}</p>
        </ParameterRow>
      ) : null}
      <NumericInput label="Distance" disabled={extent === 'throughAll'} {...length.field} />
      <ParameterRow label="Extent">
        <SegmentedControl
          label="Extent"
          value={extent}
          onValueChange={(v) => onChange({ extent: v as 'distance' | 'throughAll' })}
          options={[
            { value: 'distance', label: 'Distance' },
            { value: 'throughAll', label: 'Through all' },
          ]}
        />
      </ParameterRow>
      <ParameterRow label="Start">
        <SegmentedControl
          label="Start"
          value={hasOffset ? 'offset' : 'profile'}
          onValueChange={(v) => {
            const next = v === 'offset'
            setHasOffset(next)
            onChange({ startOffset: next ? p.startOffset ?? '0' : undefined })
          }}
          options={[
            { value: 'profile', label: 'From profile' },
            { value: 'offset', label: 'Offset' },
          ]}
        />
      </ParameterRow>
      {hasOffset ? <NumericInput label="Start offset" {...offset.field} /> : null}
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
            const into = mode === 'subtract' || mode === 'intersect'
            if (into && !(p.mode === 'subtract' || p.mode === 'intersect') && p.direction === 1) {
              // A profile on a face points out of the solid: a cut that way removes nothing, so start into the solid.
              void directionIntoSolid(p.profiles[0]).then((dir) => {
                const cur = useToolStore.getState().draft
                if (dir === -1 && cur?.type === 'extrude' && cur.id === draft.id && cur.params.direction === 1 && cur.params.mode === mode) {
                  autoFlipped.current = true
                  onChange({ direction: -1 })
                }
              })
            } else if (!into && autoFlipped.current) {
              autoFlipped.current = false
              if (p.direction === -1) onChange({ direction: 1 })
            }
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

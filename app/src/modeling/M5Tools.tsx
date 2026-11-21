// M5 solid modelling tools: Sweep, Loft, Split, Mirror, and Pattern (Linear & Circular).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { FlipHorizontal2, Grid2x2, Layers, Scissors, Wind } from 'lucide-react'
import { newId, nextFeatureName } from '../doc/commands'
import { evalExpr, isNumberLiteral } from '../doc/expr'
import { useProjectStore } from '../doc/store'
import type {
  BodyAppearance,
  BooleanMode,
  DisplayUnit,
  Feature,
  LoftFeature,
  MirrorFeature,
  PatternFeature,
  Ref,
  SketchEntity,
  SplitFeature,
  SweepFeature,
} from '../doc/types'
import { useVariableSuggestions } from '../doc/useVariableSuggestions'
import { scopeOf } from '../doc/variables'
import { useToolStore } from '../screens/workspace/toolStore'
import type { KernelState } from '../screens/workspace/useKernel'
import { Button } from '../ui/Button'
import { NumericInput } from '../ui/NumericInput'
import type { FieldFeedback } from '../ui/NumericInput'
import { ParameterCard, ParameterRow } from '../ui/ParameterCard'
import { RemovableChip } from '../ui/RemovableChip'
import { SegmentedControl } from '../ui/SegmentedControl'
import { Switch } from '../ui/Switch'
import { applyDraft, cancelDraft, changeDraft, useAngleInput, useSignedLengthInput } from './draft'
import { MODE_WORDS, bodyOfFace, countLabel, refsOfKind, sameRef, sketchOfRegion, toggleRef } from './logic'
import { extrudeTargetPool } from './picking'

export interface M5ToolResult {
  card: ReactNode
  profiles?: Ref[]
}

const PLANE_CHOICES: { label: string; ref: Ref }[] = [
  { label: 'XY', ref: { kind: 'originPlane', name: 'XY' } },
  { label: 'XZ', ref: { kind: 'originPlane', name: 'XZ' } },
  { label: 'YZ', ref: { kind: 'originPlane', name: 'YZ' } },
]

const AXIS_CHOICES: { label: string; ref: Ref }[] = [
  { label: 'X axis', ref: { kind: 'originAxis', name: 'X' } },
  { label: 'Y axis', ref: { kind: 'originAxis', name: 'Y' } },
  { label: 'Z axis', ref: { kind: 'originAxis', name: 'Z' } },
]

function targetList(mode: BooleanMode, targets: Ref[]): Ref[] {
  return mode === 'new' ? [] : targets
}

function bodiesFromSelection(selection: Ref[]): Ref[] {
  const { doc } = useProjectStore.getState()
  const { liveBodies } = useToolStore.getState()
  const isLive = (id: string) => !!doc.bodies[id] && (liveBodies === null || liveBodies.includes(id))
  const out = refsOfKind(selection, 'body').filter((r) => isLive(r.name))
  for (const f of refsOfKind(selection, 'face')) {
    const id = bodyOfFace(f.name)
    if (id && isLive(id) && !out.some((r) => r.name === id)) out.push({ kind: 'body', name: id })
  }
  return out
}

function planeChoicesForDoc(features: Feature[]): { label: string; ref: Ref }[] {
  const custom = features
    .filter((f) => f.type === 'plane' && !f.suppressed)
    .map((f) => ({ label: f.name, ref: { kind: 'constructionPlane' as const, name: f.id } }))
  return [...PLANE_CHOICES, ...custom]
}

function refLabel(
  ref: Ref,
  features: Feature[],
  bodies: Record<string, BodyAppearance>,
  regions?: KernelState['regions'],
): string {
  if (!ref.name) return 'None'
  if (ref.kind === 'body') return bodies[ref.name]?.name ?? ref.name
  if (ref.kind === 'originPlane') return `${ref.name} plane`
  if (ref.kind === 'originAxis') return `${ref.name} axis`
  if (ref.kind === 'constructionPlane') {
    return features.find((f) => f.id === ref.name)?.name ?? ref.name
  }
  if (ref.kind === 'sketchRegion') {
    const [skId] = ref.name.split('/region:')
    const sk = features.find((f) => f.id === skId)?.name ?? 'Sketch'
    const list = regions?.[skId] ?? []
    const idx = list.findIndex((r) => r.name === ref.name)
    return `${sk} · Region ${idx >= 0 ? idx + 1 : 1}`
  }
  if (ref.kind === 'sketchEdge') {
    const slash = ref.name.indexOf('/')
    const skId = slash < 0 ? '' : ref.name.slice(0, slash)
    const eid = slash < 0 ? ref.name : ref.name.slice(slash + 1)
    const sk = features.find((f) => f.id === skId)
    if (sk?.type === 'sketch') {
      const idx = sk.sketch.entities.findIndex((e) => e.id === eid)
      const ent = idx >= 0 ? sk.sketch.entities[idx] : undefined
      const kindWord = ent ? ent.type[0].toUpperCase() + ent.type.slice(1) : 'Edge'
      return `${sk.name} · ${kindWord} ${idx >= 0 ? idx + 1 : eid}`
    }
    return `Sketch edge ${eid}`
  }
  if (ref.kind === 'face') return 'Face'
  if (ref.kind === 'edge') return 'Edge'
  return ref.name
}

interface PathChoice {
  label: string
  ref: Ref
  sameSketch: boolean
}

function entityWord(e: SketchEntity): string {
  return e.type[0].toUpperCase() + e.type.slice(1)
}

function sweepPathChoices(profile: Ref, features: Feature[]): PathChoice[] {
  const profileSkId = profile.name ? sketchOfRegion(profile) : ''
  const out: PathChoice[] = []
  for (const f of features) {
    if (f.type !== 'sketch' || f.suppressed) continue
    const same = f.id === profileSkId
    f.sketch.entities.forEach((e, i) => {
      out.push({
        label: `${f.name} · ${entityWord(e)} ${i + 1}`,
        ref: { kind: 'sketchEdge', name: `${f.id}/${e.id}` },
        sameSketch: same,
      })
    })
  }
  // Prefer open paths in another sketch first, then entities in the same sketch.
  return out.sort((a, b) => Number(a.sameSketch) - Number(b.sameSketch))
}

function TargetsBlock({
  mode,
  targets,
  bodies,
  onRemove,
}: {
  mode: BooleanMode
  targets: Ref[]
  bodies: Record<string, BodyAppearance>
  onRemove: (name: string) => void
}) {
  if (mode === 'new') return null
  return (
    <ParameterRow label="Targets">
      {targets.length === 0 ? (
        <p className="text-sm text-text-muted">Click solids in the view or in Items.</p>
      ) : (
        <div className="flex flex-wrap gap-1">
          {targets.map((t) => {
            const nm = bodies[t.name]?.name ?? t.name
            return (
              <RemovableChip
                key={t.name}
                label={nm}
                removeLabel={`Remove ${nm}`}
                onRemove={() => onRemove(t.name)}
              />
            )
          })}
        </div>
      )}
    </ParameterRow>
  )
}

function OperationRow({
  draftId,
  mode,
  targets,
  onChange,
}: {
  draftId: string
  mode: BooleanMode
  targets: Ref[]
  onChange: (mode: BooleanMode, targets: Ref[]) => void
}) {
  return (
    <ParameterRow label="Operation">
      <SegmentedControl
        label="Operation"
        value={mode}
        onValueChange={(v) => {
          const next = v as BooleanMode
          onChange(next, next === 'new' ? [] : targets.length > 0 ? targets : extrudeTargetPool(draftId))
        }}
        options={(Object.keys(MODE_WORDS) as BooleanMode[]).map((k) => ({ value: k, label: MODE_WORDS[k] }))}
      />
    </ParameterRow>
  )
}

function useCountInput(expr: string, onChange: (expr: string) => void) {
  const [typed, setTypedState] = useState<string | null>(null)
  const typedNow = useRef<string | null>(null)
  const suggestions = useVariableSuggestions('mm')
  const setTyped = (t: string | null) => {
    typedNow.current = t
    setTypedState(t)
  }
  const parse = (text: string): { ok: true; expr: string; isExpr: boolean; value: number } | { ok: false; message: string } => {
    const trimmed = text.trim()
    if (!trimmed) return { ok: false, message: 'Enter a whole number between 2 and 50.' }
    const r = evalExpr(trimmed, scopeOf(useProjectStore.getState().doc))
    if (!r.ok) return { ok: false, message: r.message }
    if (!Number.isFinite(r.value) || r.value < 2 || r.value > 50 || Math.abs(r.value - Math.round(r.value)) > 1e-6) {
      return { ok: false, message: 'Enter a whole number between 2 and 50.' }
    }
    return { ok: true, expr: trimmed, isExpr: !isNumberLiteral(trimmed), value: Math.round(r.value) }
  }
  const check = (text: string): FieldFeedback => {
    const r = parse(text)
    if (!r.ok) return { error: r.message }
    return r.isExpr ? { preview: String(r.value) } : {}
  }
  return {
    field: {
      value: typed ?? expr,
      error: typed !== null ? check(typed).error : undefined,
      check,
      suggestions,
      step: 1,
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

// ---- Sweep ---------------------------------------------------------------------------------------

export function useSweepTool(kernel: KernelState): M5ToolResult {
  const activeTool = useProjectStore((s) => s.activeTool)
  const selection = useProjectStore((s) => s.selection)
  const features = useProjectStore((s) => s.doc.features)
  const bodies = useProjectStore((s) => s.doc.bodies)
  const draft = useToolStore((s) => s.draft)
  const draftReplaces = useToolStore((s) => s.draftReplaces)
  const sweep = draft?.type === 'sweep' ? draft : null

  useEffect(() => {
    if (activeTool !== 'sweep' || draft) return
    const doc = useProjectStore.getState().doc
    const regions = refsOfKind(selection, 'sketchRegion')
    let profile: Ref = regions[0] ?? { kind: 'sketchRegion', name: '' }
    if (!profile.name) {
      const firstSk = features.find((f) => f.type === 'sketch' && !f.suppressed && (kernel.regions[f.id]?.length ?? 0) > 0)
      const reg = firstSk ? kernel.regions[firstSk.id]?.[0] : undefined
      if (reg) profile = { kind: 'sketchRegion', name: reg.name }
    }
    const pickedEdge = refsOfKind(selection, 'edge')[0] ?? refsOfKind(selection, 'sketchEdge')[0]
    const choices = sweepPathChoices(profile, features)
    const defaultPath = pickedEdge ?? choices.find((c) => !c.sameSketch)?.ref ?? { kind: 'sketchEdge', name: '' }
    const f: SweepFeature = {
      id: newId(),
      type: 'sweep',
      name: nextFeatureName(doc, 'sweep'),
      suppressed: false,
      params: { profile, path: defaultPath, mode: 'new', targets: [] },
    }
    useToolStore.getState().setDraft(f, null)
  }, [activeTool, draft, selection, features, kernel.regions])

  useEffect(() => {
    if (sweep && activeTool !== 'sweep') cancelDraft()
  }, [sweep, activeTool])

  useEffect(() => {
    if (draftReplaces && sweep && !features.some((f) => f.id === draftReplaces)) cancelDraft()
  }, [draftReplaces, sweep, features])

  const change = useCallback((partial: Partial<SweepFeature['params']>) => changeDraft<SweepFeature>('sweep', partial), [])

  const apply = useCallback(() => {
    const done = applyDraft('Sweep')
    if (done?.type === 'sweep') {
      useProjectStore.getState().setSelection(done.params.mode === 'new' ? [{ kind: 'body', name: done.id }] : [])
    }
  }, [])

  const status = sweep ? kernel.statuses[sweep.id] : undefined
  const stepIndex = draftReplaces ? features.findIndex((f) => f.id === draftReplaces) + 1 : undefined
  const pathChoices = useMemo(() => (sweep ? sweepPathChoices(sweep.params.profile, features) : []), [sweep, features])
  const allRegions = useMemo(
    () => Object.values(kernel.regions).flat().map((r) => ({ kind: 'sketchRegion' as const, name: r.name })),
    [kernel.regions],
  )

  const card = sweep ? (
    <ParameterCard
      title="Sweep"
      icon={<Wind size={16} strokeWidth={1.75} />}
      busy={kernel.busy}
      isCurrent={kernel.isDraftCurrent}
      editingStep={stepIndex}
      failure={
        !sweep.params.profile.name
          ? { message: 'Pick a closed shape to sweep.' }
          : !sweep.params.path.name
            ? { message: 'Pick a sketch path or solid edge.' }
            : sweep.params.mode !== 'new' && sweep.params.targets.length === 0
              ? { message: 'Pick at least one solid to work on.' }
              : status && !status.ok
                ? { message: status.message ?? 'This sweep could not be built.' }
                : undefined
      }
      applyDisabled={
        kernel.busy ||
        !sweep.params.profile.name ||
        !sweep.params.path.name ||
        (sweep.params.mode !== 'new' && sweep.params.targets.length === 0) ||
        !!(status && !status.ok)
      }
      onApply={apply}
      onCancel={() => {
        cancelDraft()
        useProjectStore.getState().setActiveTool(null)
      }}
    >
      <ParameterRow label="Profile">
        {sweep.params.profile.name ? (
          <RemovableChip
            label={refLabel(sweep.params.profile, features, bodies, kernel.regions)}
            removeLabel="Clear profile"
            onRemove={() => change({ profile: { kind: 'sketchRegion', name: '' } })}
          />
        ) : (
          <p className="text-sm text-text-muted">Click a closed shape in the view or below.</p>
        )}
        {allRegions.length > 0 ? (
          <div className="mt-1 flex flex-wrap gap-1" role="group" aria-label="Profile options">
            {allRegions.map((reg) => {
              const selected = sameRef(sweep.params.profile, reg)
              return (
                <Button
                  key={reg.name}
                  size="sm"
                  variant={selected ? 'primary' : 'secondary'}
                  aria-pressed={selected}
                  className="max-w-full"
                  onClick={() => change({ profile: reg })}
                >
                  <span className="truncate">{refLabel(reg, features, bodies, kernel.regions)}</span>
                </Button>
              )
            })}
          </div>
        ) : null}
      </ParameterRow>
      <ParameterRow label="Path">
        {sweep.params.path.kind === 'edge' && sweep.params.path.name ? (
          <RemovableChip
            label="3D edge"
            removeLabel="Clear path"
            onRemove={() => change({ path: { kind: 'sketchEdge', name: '' } })}
          />
        ) : pathChoices.length === 0 ? (
          <p className="text-sm text-text-muted">Click a solid edge in the view or draw a path sketch.</p>
        ) : null}
        {pathChoices.length > 0 ? (
          <div className="mt-1 flex flex-wrap gap-1" role="group" aria-label="Path options">
            {pathChoices.slice(0, 8).map((c) => {
              const selected = sameRef(sweep.params.path, c.ref)
              return (
                <Button
                  key={c.ref.name}
                  size="sm"
                  variant={selected ? 'primary' : 'secondary'}
                  aria-pressed={selected}
                  className="max-w-full"
                  onClick={() => change({ path: c.ref })}
                >
                  <span className="truncate">{c.label}</span>
                </Button>
              )
            })}
          </div>
        ) : null}
      </ParameterRow>
      <OperationRow
        draftId={sweep.id}
        mode={sweep.params.mode}
        targets={targetList(sweep.params.mode, sweep.params.targets)}
        onChange={(mode, targets) => change({ mode, targets })}
      />
      <TargetsBlock
        mode={sweep.params.mode}
        targets={sweep.params.targets}
        bodies={bodies}
        onRemove={(nm) => change({ targets: sweep.params.targets.filter((t) => t.name !== nm) })}
      />
    </ParameterCard>
  ) : null

  return { card, profiles: sweep?.params.profile.name ? [sweep.params.profile] : [] }
}

// ---- Loft ----------------------------------------------------------------------------------------

export function useLoftTool(kernel: KernelState): M5ToolResult {
  const activeTool = useProjectStore((s) => s.activeTool)
  const selection = useProjectStore((s) => s.selection)
  const features = useProjectStore((s) => s.doc.features)
  const bodies = useProjectStore((s) => s.doc.bodies)
  const draft = useToolStore((s) => s.draft)
  const draftReplaces = useToolStore((s) => s.draftReplaces)
  const loft = draft?.type === 'loft' ? draft : null

  useEffect(() => {
    if (activeTool !== 'loft' || draft) return
    const doc = useProjectStore.getState().doc
    const profiles = refsOfKind(selection, 'sketchRegion')
    const f: LoftFeature = {
      id: newId(),
      type: 'loft',
      name: nextFeatureName(doc, 'loft'),
      suppressed: false,
      params: { profiles, mode: 'new', targets: [] },
    }
    useToolStore.getState().setDraft(f, null)
  }, [activeTool, draft, selection])

  useEffect(() => {
    if (loft && activeTool !== 'loft') cancelDraft()
  }, [loft, activeTool])

  useEffect(() => {
    if (draftReplaces && loft && !features.some((f) => f.id === draftReplaces)) cancelDraft()
  }, [draftReplaces, loft, features])

  const change = useCallback((partial: Partial<LoftFeature['params']>) => changeDraft<LoftFeature>('loft', partial), [])

  const apply = useCallback(() => {
    const done = applyDraft('Loft')
    if (done?.type === 'loft') {
      useProjectStore.getState().setSelection(done.params.mode === 'new' ? [{ kind: 'body', name: done.id }] : [])
    }
  }, [])

  const status = loft ? kernel.statuses[loft.id] : undefined
  const stepIndex = draftReplaces ? features.findIndex((f) => f.id === draftReplaces) + 1 : undefined
  const allRegions = useMemo(
    () => Object.values(kernel.regions).flat().map((r) => ({ kind: 'sketchRegion' as const, name: r.name })),
    [kernel.regions],
  )

  const card = loft ? (
    <ParameterCard
      title="Loft"
      icon={<Layers size={16} strokeWidth={1.75} />}
      busy={kernel.busy}
      isCurrent={kernel.isDraftCurrent}
      editingStep={stepIndex}
      failure={
        loft.params.profiles.length < 2
          ? { message: 'Pick at least two closed shapes to loft between.' }
          : loft.params.mode !== 'new' && loft.params.targets.length === 0
            ? { message: 'Pick at least one solid to work on.' }
            : status && !status.ok
              ? { message: status.message ?? 'This loft could not be built.' }
              : undefined
      }
      applyDisabled={
        kernel.busy ||
        loft.params.profiles.length < 2 ||
        (loft.params.mode !== 'new' && loft.params.targets.length === 0) ||
        !!(status && !status.ok)
      }
      onApply={apply}
      onCancel={() => {
        cancelDraft()
        useProjectStore.getState().setActiveTool(null)
      }}
    >
      <ParameterRow label="Profiles">
        {loft.params.profiles.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {loft.params.profiles.map((p) => {
              const label = refLabel(p, features, bodies, kernel.regions)
              return (
                <RemovableChip
                  key={p.name}
                  label={label}
                  removeLabel={`Remove ${label}`}
                  onRemove={() => change({ profiles: loft.params.profiles.filter((x) => !sameRef(x, p)) })}
                />
              )
            })}
          </div>
        ) : (
          <p className="text-sm text-text-muted">Pick 2 or more closed shapes in order.</p>
        )}
        {allRegions.length > 0 ? (
          <div className="mt-1 flex flex-wrap gap-1" role="group" aria-label="Loft profile options">
            {allRegions.map((reg) => {
              const selected = loft.params.profiles.some((p) => sameRef(p, reg))
              return (
                <Button
                  key={reg.name}
                  size="sm"
                  variant={selected ? 'primary' : 'secondary'}
                  aria-pressed={selected}
                  className="max-w-full"
                  onClick={() => change({ profiles: toggleRef(loft.params.profiles, reg) })}
                >
                  <span className="truncate">{refLabel(reg, features, bodies, kernel.regions)}</span>
                </Button>
              )
            })}
          </div>
        ) : null}
      </ParameterRow>
      <OperationRow
        draftId={loft.id}
        mode={loft.params.mode}
        targets={targetList(loft.params.mode, loft.params.targets)}
        onChange={(mode, targets) => change({ mode, targets })}
      />
      <TargetsBlock
        mode={loft.params.mode}
        targets={loft.params.targets}
        bodies={bodies}
        onRemove={(nm) => change({ targets: loft.params.targets.filter((t) => t.name !== nm) })}
      />
    </ParameterCard>
  ) : null

  return { card, profiles: loft?.params.profiles ?? [] }
}

// ---- Split ---------------------------------------------------------------------------------------

export function useSplitTool(kernel: KernelState): M5ToolResult {
  const activeTool = useProjectStore((s) => s.activeTool)
  const selection = useProjectStore((s) => s.selection)
  const features = useProjectStore((s) => s.doc.features)
  const bodies = useProjectStore((s) => s.doc.bodies)
  const draft = useToolStore((s) => s.draft)
  const draftReplaces = useToolStore((s) => s.draftReplaces)
  const split = draft?.type === 'split' ? draft : null

  useEffect(() => {
    if (activeTool !== 'split' || draft) return
    const doc = useProjectStore.getState().doc
    const body = bodiesFromSelection(selection)[0] ?? { kind: 'body', name: '' }
    const plane =
      selection.find((r) => r.kind === 'originPlane' || r.kind === 'constructionPlane') ??
      ({ kind: 'originPlane', name: 'XY' } as Ref)
    const f: SplitFeature = {
      id: newId(),
      type: 'split',
      name: nextFeatureName(doc, 'split'),
      suppressed: false,
      params: { body, plane },
    }
    useToolStore.getState().setDraft(f, null)
  }, [activeTool, draft, selection])

  useEffect(() => {
    if (split && activeTool !== 'split') cancelDraft()
  }, [split, activeTool])

  useEffect(() => {
    if (draftReplaces && split && !features.some((f) => f.id === draftReplaces)) cancelDraft()
  }, [draftReplaces, split, features])

  const change = useCallback((partial: Partial<SplitFeature['params']>) => changeDraft<SplitFeature>('split', partial), [])

  const apply = useCallback(() => {
    const done = applyDraft('Split')
    if (done?.type === 'split') {
      useProjectStore.getState().setSelection([done.params.body, { kind: 'body', name: `${done.id}:1` }])
    }
  }, [])

  const status = split ? kernel.statuses[split.id] : undefined
  const stepIndex = draftReplaces ? features.findIndex((f) => f.id === draftReplaces) + 1 : undefined
  const planes = useMemo(() => planeChoicesForDoc(features), [features])

  const card = split ? (
    <ParameterCard
      title="Split"
      icon={<Scissors size={16} strokeWidth={1.75} />}
      busy={kernel.busy}
      isCurrent={kernel.isDraftCurrent}
      editingStep={stepIndex}
      failure={
        !split.params.body.name
          ? { message: 'Pick a solid to split.' }
          : !split.params.plane.name
            ? { message: 'Pick a splitting plane or flat face.' }
            : status && !status.ok
              ? { message: status.message ?? 'Could not split along this plane.' }
              : undefined
      }
      applyDisabled={kernel.busy || !split.params.body.name || !split.params.plane.name || !!(status && !status.ok)}
      onApply={apply}
      onCancel={() => {
        cancelDraft()
        useProjectStore.getState().setActiveTool(null)
      }}
    >
      <ParameterRow label="Solid">
        {split.params.body.name ? (
          <RemovableChip
            label={refLabel(split.params.body, features, bodies)}
            removeLabel={`Remove ${refLabel(split.params.body, features, bodies)}`}
            onRemove={() => change({ body: { kind: 'body', name: '' } })}
          />
        ) : (
          <p className="text-sm text-text-muted">Click a solid in the view or in Items.</p>
        )}
      </ParameterRow>
      <ParameterRow label="Splitting plane">
        <div className="flex flex-wrap gap-1" role="group" aria-label="Splitting plane">
          {planes.map((c) => {
            const selected = sameRef(split.params.plane, c.ref)
            return (
              <Button
                key={`${c.ref.kind}:${c.ref.name}`}
                size="sm"
                variant={selected ? 'primary' : 'secondary'}
                aria-pressed={selected}
                onClick={() => change({ plane: c.ref })}
              >
                {c.label}
              </Button>
            )
          })}
          {split.params.plane.kind === 'face' ? (
            <RemovableChip
              label="Face"
              removeLabel="Reset plane"
              onRemove={() => change({ plane: { kind: 'originPlane', name: 'XY' } })}
            />
          ) : null}
        </div>
      </ParameterRow>
    </ParameterCard>
  ) : null

  return { card }
}

// ---- Mirror --------------------------------------------------------------------------------------

export function useMirrorTool(kernel: KernelState): M5ToolResult {
  const activeTool = useProjectStore((s) => s.activeTool)
  const selection = useProjectStore((s) => s.selection)
  const features = useProjectStore((s) => s.doc.features)
  const bodies = useProjectStore((s) => s.doc.bodies)
  const draft = useToolStore((s) => s.draft)
  const draftReplaces = useToolStore((s) => s.draftReplaces)
  const mirror = draft?.type === 'mirror' ? draft : null

  useEffect(() => {
    if (activeTool !== 'mirror' || draft) return
    const doc = useProjectStore.getState().doc
    const picked = bodiesFromSelection(selection)
    const plane =
      selection.find((r) => r.kind === 'originPlane' || r.kind === 'constructionPlane') ??
      ({ kind: 'originPlane', name: 'YZ' } as Ref)
    const f: MirrorFeature = {
      id: newId(),
      type: 'mirror',
      name: nextFeatureName(doc, 'mirror'),
      suppressed: false,
      params: { bodies: picked, plane, merge: false },
    }
    useToolStore.getState().setDraft(f, null)
  }, [activeTool, draft, selection])

  useEffect(() => {
    if (mirror && activeTool !== 'mirror') cancelDraft()
  }, [mirror, activeTool])

  useEffect(() => {
    if (draftReplaces && mirror && !features.some((f) => f.id === draftReplaces)) cancelDraft()
  }, [draftReplaces, mirror, features])

  const change = useCallback((partial: Partial<MirrorFeature['params']>) => changeDraft<MirrorFeature>('mirror', partial), [])

  const apply = useCallback(() => {
    const done = applyDraft('Mirror')
    if (done?.type === 'mirror') {
      useProjectStore
        .getState()
        .setSelection(
          done.params.merge ? done.params.bodies : done.params.bodies.map((_, i) => ({ kind: 'body' as const, name: `${done.id}:${i + 1}` })),
        )
    }
  }, [])

  const status = mirror ? kernel.statuses[mirror.id] : undefined
  const stepIndex = draftReplaces ? features.findIndex((f) => f.id === draftReplaces) + 1 : undefined
  const planes = useMemo(() => planeChoicesForDoc(features), [features])

  const card = mirror ? (
    <ParameterCard
      title="Mirror"
      icon={<FlipHorizontal2 size={16} strokeWidth={1.75} />}
      busy={kernel.busy}
      isCurrent={kernel.isDraftCurrent}
      editingStep={stepIndex}
      failure={
        mirror.params.bodies.length === 0
          ? { message: 'Pick at least one solid to mirror.' }
          : !mirror.params.plane.name
            ? { message: 'Pick a mirror plane or flat face.' }
            : status && !status.ok
              ? { message: status.message ?? 'Could not mirror across this plane.' }
              : undefined
      }
      applyDisabled={kernel.busy || mirror.params.bodies.length === 0 || !mirror.params.plane.name || !!(status && !status.ok)}
      onApply={apply}
      onCancel={() => {
        cancelDraft()
        useProjectStore.getState().setActiveTool(null)
      }}
    >
      <ParameterRow label={`Solids (${countLabel(mirror.params.bodies.length, 'solid')})`}>
        {mirror.params.bodies.length === 0 ? (
          <p className="text-sm text-text-muted">Click solids in the view or in Items.</p>
        ) : (
          <div className="flex flex-wrap gap-1">
            {mirror.params.bodies.map((b) => {
              const nm = refLabel(b, features, bodies)
              return (
                <RemovableChip
                  key={b.name}
                  label={nm}
                  removeLabel={`Remove ${nm}`}
                  onRemove={() => change({ bodies: mirror.params.bodies.filter((x) => x.name !== b.name) })}
                />
              )
            })}
          </div>
        )}
      </ParameterRow>
      <ParameterRow label="Mirror plane">
        <div className="flex flex-wrap gap-1" role="group" aria-label="Mirror plane">
          {planes.map((c) => {
            const selected = sameRef(mirror.params.plane, c.ref)
            return (
              <Button
                key={`${c.ref.kind}:${c.ref.name}`}
                size="sm"
                variant={selected ? 'primary' : 'secondary'}
                aria-pressed={selected}
                onClick={() => change({ plane: c.ref })}
              >
                {c.label}
              </Button>
            )
          })}
          {mirror.params.plane.kind === 'face' ? (
            <RemovableChip
              label="Face"
              removeLabel="Reset plane"
              onRemove={() => change({ plane: { kind: 'originPlane', name: 'YZ' } })}
            />
          ) : null}
        </div>
      </ParameterRow>
      <Switch
        label="Join mirrored solids"
        checked={mirror.params.merge}
        onCheckedChange={(merge) => change({ merge })}
      />
    </ParameterCard>
  ) : null

  return { card }
}

// ---- Pattern (Linear & Circular) -----------------------------------------------------------------

export function usePatternTool(kernel: KernelState): M5ToolResult {
  const activeTool = useProjectStore((s) => s.activeTool)
  const selection = useProjectStore((s) => s.selection)
  const features = useProjectStore((s) => s.doc.features)
  const bodies = useProjectStore((s) => s.doc.bodies)
  const units = useProjectStore((s) => s.doc.units)
  const draft = useToolStore((s) => s.draft)
  const draftReplaces = useToolStore((s) => s.draftReplaces)
  const pattern = draft?.type === 'pattern' ? draft : null

  useEffect(() => {
    if (activeTool !== 'pattern' || draft) return
    const doc = useProjectStore.getState().doc
    const picked = bodiesFromSelection(selection)
    const f: PatternFeature = {
      id: newId(),
      type: 'pattern',
      name: nextFeatureName(doc, 'pattern'),
      suppressed: false,
      params: { kind: 'linear', bodies: picked, axis: { kind: 'originAxis', name: 'X' }, count: '3', spacing: '25' },
    }
    useToolStore.getState().setDraft(f, null)
  }, [activeTool, draft, selection])

  useEffect(() => {
    if (pattern && activeTool !== 'pattern') cancelDraft()
  }, [pattern, activeTool])

  useEffect(() => {
    if (draftReplaces && pattern && !features.some((f) => f.id === draftReplaces)) cancelDraft()
  }, [draftReplaces, pattern, features])

  const change = useCallback((partial: Partial<PatternFeature['params']>) => changeDraft<PatternFeature>('pattern', partial), [])

  const apply = useCallback(() => {
    const done = applyDraft('Pattern')
    if (done?.type === 'pattern') {
      useProjectStore.getState().setSelection(done.params.bodies)
    }
  }, [])

  const status = pattern ? kernel.statuses[pattern.id] : undefined
  const stepIndex = draftReplaces ? features.findIndex((f) => f.id === draftReplaces) + 1 : undefined

  const card = pattern ? (
    <PatternCard
      key={pattern.id}
      draft={pattern}
      features={features}
      bodies={bodies}
      units={units}
      busy={kernel.busy}
      isCurrent={kernel.isDraftCurrent}
      failure={status && !status.ok ? (status.message ?? 'Could not build pattern.') : undefined}
      editingStep={stepIndex}
      onChange={change}
      onApply={apply}
      onCancel={() => {
        cancelDraft()
        useProjectStore.getState().setActiveTool(null)
      }}
    />
  ) : null

  return { card }
}

function PatternCard({
  draft,
  features,
  bodies,
  units,
  busy,
  isCurrent,
  failure,
  editingStep,
  onChange,
  onApply,
  onCancel,
}: {
  draft: PatternFeature
  features: Feature[]
  bodies: Record<string, BodyAppearance>
  units: DisplayUnit
  busy: boolean
  isCurrent: () => boolean
  failure?: string
  editingStep?: number
  onChange: (partial: Partial<PatternFeature['params']>) => void
  onApply: () => void
  onCancel: () => void
}) {
  const p = draft.params
  const count = useCountInput(p.count, (c) => onChange({ count: c }))
  const linearStep = useSignedLengthInput(p.kind === 'linear' ? p.spacing : '25', units, (spacing) => onChange({ spacing }))
  const circularStep = useAngleInput(p.kind === 'circular' ? p.spacing : '90', (spacing) => onChange({ spacing }))
  const activeStep = p.kind === 'circular' ? circularStep : linearStep

  const missing =
    p.bodies.length === 0
      ? 'Pick at least one solid to pattern.'
      : !p.axis.name
        ? 'Pick an axis or edge.'
        : undefined
  const applyFn = count.guard(activeStep.guard(onApply))

  return (
    <ParameterCard
      title="Pattern"
      icon={<Grid2x2 size={16} strokeWidth={1.75} />}
      busy={busy}
      isCurrent={isCurrent}
      editingStep={editingStep}
      failure={missing ? { message: missing } : failure ? { message: failure } : undefined}
      applyDisabled={busy || count.invalid || activeStep.invalid || !!missing || !!failure}
      onApply={applyFn}
      onCancel={onCancel}
    >
      <ParameterRow label="Pattern type">
        <SegmentedControl
          label="Pattern type"
          value={p.kind}
          onValueChange={(v) => {
            const nextKind = v as 'linear' | 'circular'
            const nextAxis: Ref =
              nextKind === 'circular' && p.axis.kind === 'originAxis' && p.axis.name === 'X'
                ? { kind: 'originAxis', name: 'Z' }
                : nextKind === 'linear' && p.axis.kind === 'originAxis' && p.axis.name === 'Z'
                  ? { kind: 'originAxis', name: 'X' }
                  : p.axis
            const nextSpacing = nextKind === 'circular' ? (p.spacing === '25' ? '90' : p.spacing) : p.spacing === '90' ? '25' : p.spacing
            onChange({ kind: nextKind, axis: nextAxis, spacing: nextSpacing })
          }}
          options={[
            { value: 'linear', label: 'Linear' },
            { value: 'circular', label: 'Circular' },
          ]}
        />
      </ParameterRow>
      <ParameterRow label={`Solids (${countLabel(p.bodies.length, 'solid')})`}>
        {p.bodies.length === 0 ? (
          <p className="text-sm text-text-muted">Click solids in the view or in Items.</p>
        ) : (
          <div className="flex flex-wrap gap-1">
            {p.bodies.map((b) => {
              const nm = refLabel(b, features, bodies)
              return (
                <RemovableChip
                  key={b.name}
                  label={nm}
                  removeLabel={`Remove ${nm}`}
                  onRemove={() => onChange({ bodies: p.bodies.filter((x) => x.name !== b.name) })}
                />
              )
            })}
          </div>
        )}
      </ParameterRow>
      <ParameterRow label="Axis">
        <div className="flex flex-wrap gap-1" role="group" aria-label="Pattern axis">
          {AXIS_CHOICES.map((c) => {
            const selected = sameRef(p.axis, c.ref)
            return (
              <Button
                key={c.ref.name}
                size="sm"
                variant={selected ? 'primary' : 'secondary'}
                aria-pressed={selected}
                onClick={() => onChange({ axis: c.ref })}
              >
                {c.label}
              </Button>
            )
          })}
          {p.axis.kind !== 'originAxis' ? (
            <RemovableChip
              label={refLabel(p.axis, features, bodies)}
              removeLabel="Reset axis"
              onRemove={() => onChange({ axis: { kind: 'originAxis', name: p.kind === 'circular' ? 'Z' : 'X' } })}
            />
          ) : null}
        </div>
      </ParameterRow>
      <NumericInput label="Count" {...count.field} />
      {p.kind === 'circular' ? (
        <NumericInput label="Angle" {...circularStep.field} />
      ) : (
        <NumericInput label="Spacing" {...linearStep.field} />
      )}
    </ParameterCard>
  )
}

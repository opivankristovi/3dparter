// The Extrude tool: picks a profile, previews the solid through a draft feature, and applies it as one undo step.
import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { ArrowUpFromLine } from 'lucide-react'
import { addFeature, newId, nextFeatureName, updateFeatureParams } from '../doc/commands'
import { useProjectStore } from '../doc/store'
import type { DisplayUnit, ExtrudeFeature, Ref } from '../doc/types'
import { formatDisplay, parseDisplay, toExpr } from '../doc/units'
import type { SketchRegionData } from '../kernel/api'
import { useToolStore } from '../screens/workspace/toolStore'
import { NumericInput } from '../ui/NumericInput'
import { ParameterCard, ParameterRow } from '../ui/ParameterCard'
import { SegmentedControl } from '../ui/SegmentedControl'

const sketchOf = (r: Ref) => r.name.split('/region:')[0]

/** Regions of the first picked sketch only: an extrusion takes shapes from one sketch. */
function sameSketch(refs: Ref[]): Ref[] {
  if (refs.length === 0) return refs
  const sk = sketchOf(refs[0])
  return refs.filter((r) => sketchOf(r) === sk)
}

const sameNames = (a: Ref[], b: Ref[]) => a.length === b.length && a.every((r) => b.some((x) => x.name === r.name))

export function cancelExtrude() {
  useToolStore.getState().clearDraft()
  const s = useProjectStore.getState()
  s.setEditingFeature(null)
}

function applyExtrude() {
  const { draft, draftReplaces } = useToolStore.getState()
  if (draft?.type !== 'extrude') return
  if (draftReplaces) {
    const p = draft.params
    updateFeatureParams(
      draft.id,
      { profiles: p.profiles, distance: p.distance, direction: p.direction, mode: p.mode, targets: p.targets },
      'Edit Extrude',
    )
  } else addFeature(draft, 'Extrude')
  useToolStore.getState().clearDraft()
  const s = useProjectStore.getState()
  s.setEditingFeature(null)
  s.setActiveTool(null)
  s.setSelection([{ kind: 'body', name: draft.id }])
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

export interface ExtrudeToolResult {
  /** The parameter card, or null when no extrusion is open. */
  card: ReactNode
  /** The extrude tool is on but no shape is chosen yet. */
  picking: boolean
  /** Profiles of the open draft, to highlight in the viewport. */
  profiles: Ref[]
}

export function useExtrudeTool(
  regions: Record<string, SketchRegionData[]>,
  statuses: Record<string, { ok: boolean; message?: string }>,
  busy: boolean,
): ExtrudeToolResult {
  const activeTool = useProjectStore((s) => s.activeTool)
  const selection = useProjectStore((s) => s.selection)
  const features = useProjectStore((s) => s.doc.features)
  const units = useProjectStore((s) => s.doc.units)
  const draft = useToolStore((s) => s.draft)
  const draftReplaces = useToolStore((s) => s.draftReplaces)
  const extrude = draft?.type === 'extrude' ? draft : null

  // Tool turned on with no draft: use the selected region(s), or the last sketch if it has exactly one.
  useEffect(() => {
    if (activeTool !== 'extrude' || draft) return
    const picked = sameSketch(selection.filter((r) => r.kind === 'sketchRegion'))
    if (picked.length > 0) {
      startDraft(picked)
      return
    }
    const last = [...features].reverse().find((f) => f.type === 'sketch' && !f.suppressed)
    const regs = last ? regions[last.id] : undefined
    if (regs && regs.length === 1) {
      const ref: Ref = { kind: 'sketchRegion', name: regs[0].name }
      useProjectStore.getState().setSelection([ref])
      startDraft([ref])
    }
  }, [activeTool, draft, selection, features, regions])

  // Another tool was chosen: drop the draft.
  useEffect(() => {
    if (extrude && activeTool !== 'extrude') cancelExtrude()
  }, [extrude, activeTool])

  // Picking more shapes while the card is open changes the profiles.
  useEffect(() => {
    if (!extrude) return
    const picked = sameSketch(selection.filter((r) => r.kind === 'sketchRegion'))
    if (picked.length === 0 || sameNames(picked, extrude.params.profiles)) return
    useToolStore.getState().setDraft({ ...extrude, params: { ...extrude.params, profiles: picked } }, draftReplaces)
  }, [selection, extrude, draftReplaces])

  // The step being edited was deleted (undo, or deleted in History).
  useEffect(() => {
    if (draftReplaces && !features.some((f) => f.id === draftReplaces)) cancelExtrude()
  }, [draftReplaces, features])

  const change = useCallback(
    (partial: Partial<ExtrudeFeature['params']>) => {
      const cur = useToolStore.getState()
      if (cur.draft?.type !== 'extrude') return
      cur.setDraft({ ...cur.draft, params: { ...cur.draft.params, ...partial } }, cur.draftReplaces)
    },
    [],
  )

  const status = extrude ? statuses[extrude.id] : undefined
  const stepIndex = draftReplaces ? features.findIndex((f) => f.id === draftReplaces) + 1 : undefined

  const card = extrude ? (
    <ExtrudeCard
      key={extrude.id}
      draft={extrude}
      units={units}
      busy={busy}
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

  return { card, picking: activeTool === 'extrude' && !extrude, profiles: extrude?.params.profiles ?? [] }
}

interface CardProps {
  draft: ExtrudeFeature
  units: DisplayUnit
  busy: boolean
  failure?: string
  editingStep?: number
  onChange: (partial: Partial<ExtrudeFeature['params']>) => void
  onApply: () => void
  onCancel: () => void
}

function ExtrudeCard({ draft, units, busy, failure, editingStep, onChange, onApply, onCancel }: CardProps) {
  const [typed, setTyped] = useState<string | null>(null)
  const p = draft.params
  const mm = Number(p.distance)
  const shown = typed ?? (Number.isFinite(mm) ? formatDisplay(mm, units) : p.distance)
  const noProfile = p.profiles.length === 0

  return (
    <ParameterCard
      title="Extrude"
      icon={<ArrowUpFromLine size={16} strokeWidth={1.75} />}
      busy={busy}
      editingStep={editingStep}
      failure={noProfile ? { message: 'Pick a shape to extrude.' } : failure ? { message: failure } : undefined}
      applyDisabled={busy || typed !== null || noProfile || !!failure}
      onApply={onApply}
      onCancel={onCancel}
    >
      <NumericInput
        label="Distance"
        unit={units}
        value={shown}
        error={typed !== null ? 'Enter a number above zero.' : undefined}
        onValueChange={(text) => {
          const v = parseDisplay(text, units)
          if (v === null || v <= 0) {
            setTyped(text)
            return
          }
          setTyped(null)
          onChange({ distance: toExpr(v) })
        }}
      />
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
          onValueChange={() => {}}
          options={[
            { value: 'new', label: 'New' },
            { value: 'union', label: 'Join', disabled: true },
            { value: 'subtract', label: 'Cut', disabled: true },
            { value: 'intersect', label: 'Intersect', disabled: true },
          ]}
        />
        <p className="text-xs text-text-muted">Join, Cut and Intersect: coming in a later version.</p>
      </ParameterRow>
    </ParameterCard>
  )
}

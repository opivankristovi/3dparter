// The Move / Rotate tool: translates and rotates solids (with optional copy), plus a 3-axis gizmo.
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { newId, nextFeatureName } from '../doc/commands'
import { useProjectStore } from '../doc/store'
import type { BodyAppearance, DisplayUnit, Ref, TransformFeature, Vec3 } from '../doc/types'
import { toExpr } from '../doc/units'
import { applyDraft, cancelDraft, changeDraft, useAngleInput, useSignedLengthInput } from './draft'
import { bodyOfFace, refsOfKind, sameRefSet } from './logic'
import { TransformGizmo } from './ModelHandles'
import { useToolStore } from '../screens/workspace/toolStore'
import type { KernelState } from '../screens/workspace/useKernel'
import { MoveIcon } from '../ui/ModelIcons'
import { NumericInput } from '../ui/NumericInput'
import { ParameterCard, ParameterRow } from '../ui/ParameterCard'
import { RemovableChip } from '../ui/RemovableChip'
import { SegmentedControl } from '../ui/SegmentedControl'
import { Switch } from '../ui/Switch'
import type { ViewportEngine } from '../viewport/engine'

type AxisKey = 'X' | 'Y' | 'Z'

const AXIS_VEC: Record<AxisKey, Vec3> = {
  X: [1, 0, 0],
  Y: [0, 1, 0],
  Z: [0, 0, 1],
}

function axisKeyOf(v: Vec3 | undefined): AxisKey {
  if (!v) return 'Z'
  if (Math.abs(v[0]) >= Math.abs(v[1]) && Math.abs(v[0]) >= Math.abs(v[2])) return 'X'
  if (Math.abs(v[1]) >= Math.abs(v[2])) return 'Y'
  return 'Z'
}

export interface TransformToolResult {
  card: ReactNode
  handle: ReactNode
}

export function useTransformTool(kernel: KernelState, engine: ViewportEngine | null): TransformToolResult {
  const activeTool = useProjectStore((s) => s.activeTool)
  const selection = useProjectStore((s) => s.selection)
  const features = useProjectStore((s) => s.doc.features)
  const bodies = useProjectStore((s) => s.doc.bodies)
  const units = useProjectStore((s) => s.doc.units)
  const draft = useToolStore((s) => s.draft)
  const draftReplaces = useToolStore((s) => s.draftReplaces)
  const liveBodies = useToolStore((s) => s.liveBodies)
  const move = draft?.type === 'transform' ? draft : null

  useEffect(() => {
    if (activeTool !== 'move' || draft) return
    const s = useProjectStore.getState()
    let picked = refsOfKind(s.selection, 'body')
    if (picked.length === 0) {
      const faces = refsOfKind(s.selection, 'face')
      const seen = new Set<string>()
      for (const face of faces) {
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
    const f: TransformFeature = {
      id: newId(),
      type: 'transform',
      name: nextFeatureName(s.doc, 'transform'),
      suppressed: false,
      params: { bodies: picked, translate: ['0', '0', '0'], rotate: null, copy: false },
    }
    useToolStore.getState().setDraft(f, null)
  }, [activeTool, draft, kernel.meshes, liveBodies])

  useEffect(() => {
    if (move && activeTool !== 'move') cancelDraft()
  }, [move, activeTool])

  useEffect(() => {
    if (!move || activeTool !== 'move') return
    const picked = refsOfKind(selection, 'body')
    if (sameRefSet(picked, move.params.bodies)) return
    changeDraft<TransformFeature>('transform', { bodies: picked })
  }, [selection, move, activeTool])

  useEffect(() => {
    if (draftReplaces && move && !features.some((f) => f.id === draftReplaces)) cancelDraft()
  }, [draftReplaces, move, features])

  const change = useCallback((partial: Partial<TransformFeature['params']>) => changeDraft<TransformFeature>('transform', partial), [])

  const apply = useCallback(() => {
    const done = applyDraft('Move')
    if (done) useProjectStore.getState().setSelection([])
  }, [])

  // When copying, the moved mesh lives under `<draftId>:<n>`, so the gizmo tracks the copy.
  const gizmoBodies = useMemo<Ref[]>(() => {
    if (!move) return []
    if (!move.params.copy) return move.params.bodies
    return move.params.bodies.map((b, i) => {
      const copyId = `${move.id}:${i + 1}`
      return kernel.meshes.has(copyId) ? { kind: 'body', name: copyId } : b
    })
  }, [move, kernel.meshes])

  const handle =
    move && gizmoBodies.length > 0 ? (
      <TransformGizmo
        engine={engine}
        bodies={gizmoBodies}
        meshes={kernel.meshes}
        translate={move.params.translate}
        units={units}
        onChange={(axisIdx, nextMm) => {
          const cur = useToolStore.getState().draft
          if (cur?.type !== 'transform') return
          const next = [...cur.params.translate] as [string, string, string]
          next[axisIdx] = toExpr(nextMm)
          change({ translate: next })
        }}
      />
    ) : null

  const status = move ? kernel.statuses[move.id] : undefined
  const stepIndex = draftReplaces ? features.findIndex((f) => f.id === draftReplaces) + 1 : undefined

  const card = move ? (
    <TransformCard
      key={move.id}
      draft={move}
      bodies={bodies}
      units={units}
      busy={kernel.busy}
      failure={status && !status.ok ? (status.message ?? 'These solids could not be moved.') : undefined}
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

  return { card, handle }
}

interface CardProps {
  draft: TransformFeature
  bodies: Record<string, BodyAppearance>
  units: DisplayUnit
  busy: boolean
  failure?: string
  editingStep?: number
  onChange: (partial: Partial<TransformFeature['params']>) => void
  onRemove: (r: Ref) => void
  onApply: () => void
  onCancel: () => void
}

function TransformCard({
  draft,
  bodies,
  units,
  busy,
  failure,
  editingStep,
  onChange,
  onRemove,
  onApply,
  onCancel,
}: CardProps) {
  const p = draft.params
  const [rotAxis, setRotAxis] = useState<AxisKey>(() => axisKeyOf(p.rotate?.axis))
  const setTranslate = (idx: 0 | 1 | 2, expr: string) => {
    const next = [...p.translate] as [string, string, string]
    next[idx] = expr
    onChange({ translate: next })
  }
  const mx = useSignedLengthInput(p.translate[0], units, (v) => setTranslate(0, v))
  const my = useSignedLengthInput(p.translate[1], units, (v) => setTranslate(1, v))
  const mz = useSignedLengthInput(p.translate[2], units, (v) => setTranslate(2, v))
  const angle = useAngleInput(p.rotate?.angle ?? '0', (a) => {
    onChange({ rotate: Number(a) === 0 ? null : { axis: AXIS_VEC[rotAxis], pivot: [0, 0, 0], angle: a } })
  })

  const noBodies = p.bodies.length === 0
  const anyInvalid = mx.invalid || my.invalid || mz.invalid || angle.invalid
  const guardedApply = mx.guard(my.guard(mz.guard(angle.guard(onApply))))

  return (
    <ParameterCard
      title="Move"
      icon={<MoveIcon size={16} strokeWidth={1.75} />}
      busy={busy}
      editingStep={editingStep}
      failure={noBodies ? { message: 'Pick at least one solid to move.' } : failure ? { message: failure } : undefined}
      applyDisabled={busy || anyInvalid || noBodies || !!failure}
      onApply={guardedApply}
      onCancel={onCancel}
    >
      <ParameterRow label="Solids">
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
      <div className="grid grid-cols-3 gap-1.5">
        <NumericInput label="Move X" {...mx.field} />
        <NumericInput label="Move Y" {...my.field} />
        <NumericInput label="Move Z" {...mz.field} />
      </div>
      <ParameterRow label="Rotate axis">
        <SegmentedControl
          label="Rotate axis"
          value={rotAxis}
          onValueChange={(v) => {
            const k = v as AxisKey
            setRotAxis(k)
            if (p.rotate) onChange({ rotate: { ...p.rotate, axis: AXIS_VEC[k] } })
          }}
          options={[
            { value: 'X', label: 'X' },
            { value: 'Y', label: 'Y' },
            { value: 'Z', label: 'Z' },
          ]}
        />
      </ParameterRow>
      <NumericInput label="Angle" {...angle.field} />
      <Switch label="Keep original (make a copy)" checked={p.copy} onCheckedChange={(copy) => onChange({ copy })} />
    </ParameterCard>
  )
}

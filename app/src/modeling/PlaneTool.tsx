// The Construction Plane tool: offsets and tilts a new plane from an origin plane, construction plane or flat face.
import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { newId, nextFeatureName } from '../doc/commands'
import { useProjectStore } from '../doc/store'
import { ORIGIN_PLANES, ORIGIN_PLANE_LABELS } from '../doc/types'
import type { DisplayUnit, OriginPlaneName, PlaneFeature, PlaneFrame, Ref, Vec3 } from '../doc/types'
import { toExpr } from '../doc/units'
import { getKernel } from '../kernel/client'
import { applyDraft, cancelDraft, changeDraft, useAngleInput, useSignedLengthInput } from './draft'
import { sameRef } from './logic'
import { AxisDragHandle } from './ModelHandles'
import { useToolStore } from '../screens/workspace/toolStore'
import type { KernelState } from '../screens/workspace/useKernel'
import { Button } from '../ui/Button'
import { PlaneIcon } from '../ui/ModelIcons'
import { NumericInput } from '../ui/NumericInput'
import { ParameterCard, ParameterRow } from '../ui/ParameterCard'
import type { ViewportEngine } from '../viewport/engine'

const ORIGIN_BASE_OPTIONS: OriginPlaneName[] = ['XY', 'XZ', 'YZ']

function isBaseRef(r: Ref | undefined): r is Ref {
  return !!r && (r.kind === 'originPlane' || r.kind === 'constructionPlane' || r.kind === 'face')
}

function baseLabel(r: Ref): string {
  if (r.kind === 'originPlane') return `${ORIGIN_PLANE_LABELS[r.name as OriginPlaneName] ?? r.name} plane`
  if (r.kind === 'constructionPlane') return 'Construction plane'
  if (r.kind === 'face') return 'Flat face'
  return 'None'
}

export interface PlaneToolResult {
  card: ReactNode
  handle: ReactNode
}

export function usePlaneTool(kernel: KernelState, engine: ViewportEngine | null): PlaneToolResult {
  const activeTool = useProjectStore((s) => s.activeTool)
  const selection = useProjectStore((s) => s.selection)
  const features = useProjectStore((s) => s.doc.features)
  const units = useProjectStore((s) => s.doc.units)
  const draft = useToolStore((s) => s.draft)
  const draftReplaces = useToolStore((s) => s.draftReplaces)
  const plane = draft?.type === 'plane' ? draft : null
  const [faceBase, setFaceBase] = useState<{ name: string; frame: PlaneFrame } | null>(null)

  useEffect(() => {
    if (activeTool !== 'plane' || draft) return
    const s = useProjectStore.getState()
    const picked = s.selection.find(isBaseRef)
    const base: Ref = picked ?? { kind: 'originPlane', name: 'XY' }
    if (!picked) s.setSelection([base])
    const f: PlaneFeature = {
      id: newId(),
      type: 'plane',
      name: nextFeatureName(s.doc, 'plane'),
      suppressed: false,
      params: { base, offset: '10', angle: '0' },
    }
    useToolStore.getState().setDraft(f, null)
  }, [activeTool, draft])

  useEffect(() => {
    if (plane && activeTool !== 'plane') cancelDraft()
  }, [plane, activeTool])

  // Picking a plane or flat face while the card is open updates the base.
  useEffect(() => {
    if (!plane || activeTool !== 'plane') return
    const picked = selection.find(isBaseRef)
    if (!picked || sameRef(picked, plane.params.base)) return
    changeDraft<PlaneFeature>('plane', { base: picked })
  }, [selection, plane, activeTool])

  useEffect(() => {
    if (draftReplaces && plane && !features.some((f) => f.id === draftReplaces)) cancelDraft()
  }, [draftReplaces, plane, features])

  // Fetch the face frame when the base is a solid face so the offset handle points along the outward normal.
  const baseKind = plane?.params.base.kind
  const baseName = plane?.params.base.name ?? ''
  useEffect(() => {
    if (!plane || baseKind !== 'face' || !baseName) {
      setFaceBase(null)
      return
    }
    let live = true
    void getKernel()
      .planeFrame(plane.params.base)
      .then((frame) => {
        if (live && frame) setFaceBase({ name: baseName, frame })
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [plane, baseKind, baseName])

  const change = useCallback((partial: Partial<PlaneFeature['params']>) => changeDraft<PlaneFeature>('plane', partial), [])

  const apply = useCallback(() => {
    const done = applyDraft('Plane')
    if (done) useProjectStore.getState().setSelection([])
  }, [])

  let baseFrame: PlaneFrame | null = null
  if (plane) {
    const b = plane.params.base
    if (b.kind === 'originPlane') baseFrame = ORIGIN_PLANES[b.name as OriginPlaneName] ?? null
    else if (b.kind === 'constructionPlane') baseFrame = kernel.planes.find((p) => p.name === b.name)?.frame ?? null
    else if (b.kind === 'face' && faceBase?.name === b.name) baseFrame = faceBase.frame
  }

  let handle: ReactNode = null
  if (plane && baseFrame) {
    const angleRad = ((Number(plane.params.angle) || 0) * Math.PI) / 180
    const c = Math.cos(angleRad)
    const s = Math.sin(angleRad)
    const tiltedNormal: Vec3 = [
      baseFrame.normal[0] * c - baseFrame.yDir[0] * s,
      baseFrame.normal[1] * c - baseFrame.yDir[1] * s,
      baseFrame.normal[2] * c - baseFrame.yDir[2] * s,
    ]
    const off = Number(plane.params.offset)
    handle = (
      <AxisDragHandle
        engine={engine}
        origin={baseFrame.origin}
        dir={tiltedNormal}
        value={Number.isFinite(off) ? off : 0}
        units={units}
        label="Plane offset handle"
        onChange={(nextMm) => change({ offset: toExpr(nextMm) })}
      />
    )
  }

  const status = plane ? kernel.statuses[plane.id] : undefined
  const stepIndex = draftReplaces ? features.findIndex((f) => f.id === draftReplaces) + 1 : undefined

  const card = plane ? (
    <PlaneCard
      key={plane.id}
      draft={plane}
      units={units}
      busy={kernel.busy}
      failure={status && !status.ok ? (status.message ?? 'This plane could not be built.') : undefined}
      editingStep={stepIndex}
      onChange={change}
      onPickOrigin={(name) => useProjectStore.getState().setSelection([{ kind: 'originPlane', name }])}
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
  draft: PlaneFeature
  units: DisplayUnit
  busy: boolean
  failure?: string
  editingStep?: number
  onChange: (partial: Partial<PlaneFeature['params']>) => void
  onPickOrigin: (name: OriginPlaneName) => void
  onApply: () => void
  onCancel: () => void
}

function PlaneCard({ draft, units, busy, failure, editingStep, onChange, onPickOrigin, onApply, onCancel }: CardProps) {
  const p = draft.params
  const offset = useSignedLengthInput(p.offset, units, (v) => onChange({ offset: v }))
  const angle = useAngleInput(p.angle, (a) => onChange({ angle: a }))
  const noBase = p.base.name === ''
  const guardedApply = offset.guard(angle.guard(onApply))

  return (
    <ParameterCard
      title="Plane"
      icon={<PlaneIcon size={16} strokeWidth={1.75} />}
      busy={busy}
      editingStep={editingStep}
      failure={noBase ? { message: 'Pick a plane or flat face.' } : failure ? { message: failure } : undefined}
      applyDisabled={busy || offset.invalid || angle.invalid || noBase || !!failure}
      onApply={guardedApply}
      onCancel={onCancel}
    >
      <ParameterRow label="Base">
        <p className="text-sm text-text">{baseLabel(p.base)} · click a plane or flat face in the view</p>
        <div className="flex flex-wrap gap-1">
          {ORIGIN_BASE_OPTIONS.map((name) => {
            const active = p.base.kind === 'originPlane' && p.base.name === name
            return (
              <Button
                key={name}
                size="sm"
                variant={active ? 'primary' : 'secondary'}
                aria-pressed={active}
                onClick={() => onPickOrigin(name)}
              >
                {ORIGIN_PLANE_LABELS[name]}
              </Button>
            )
          })}
        </div>
      </ParameterRow>
      <NumericInput label="Offset" {...offset.field} />
      <NumericInput label="Angle" {...angle.field} />
    </ParameterCard>
  )
}
